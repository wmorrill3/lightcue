// FSEQ v2.0 uncompressed writer / reader / validator, matching what Tesla's validator.py and the car accept.
import { CHANNELS, STEP_MS, LIMITS, CLOSURE_CHANNELS, closureOf, MOVE_S, C } from './channels.js';

function varHeader(code, str) {
  const data = Buffer.from(str + '\0', 'utf8');
  const h = Buffer.alloc(4);
  h.writeUInt16LE(4 + data.length, 0); h.write(code, 2, 'ascii');
  return Buffer.concat([h, data]);
}

/** frames: Uint8Array(frameCount * channels). → Buffer (.fseq) */
export function writeFseq(frames, { channels = CHANNELS, stepMs = STEP_MS, media = 'lightshow.wav' } = {}) {
  if (frames.length % channels) throw new Error('frame buffer is not a multiple of the channel count');
  const frameCount = frames.length / channels;
  const vars = Buffer.concat([varHeader('mf', media), varHeader('sp', 'showpack')]);
  const start = Math.ceil((32 + vars.length) / 4) * 4;
  const h = Buffer.alloc(start);
  h.write('PSEQ', 0, 'ascii');
  h.writeUInt16LE(start, 4);      // channel data offset
  h.writeUInt8(0, 6);             // minor
  h.writeUInt8(2, 7);             // major
  h.writeUInt16LE(32, 8);         // variable header offset
  h.writeUInt32LE(channels, 10);
  h.writeUInt32LE(frameCount, 14);
  h.writeUInt8(stepMs, 18);
  h.writeUInt8(0, 19);            // flags
  h.writeUInt8(0, 20);            // compression: none
  h.writeUInt8(0, 21);            // compression blocks
  h.writeUInt8(0, 22);            // sparse ranges
  h.writeUInt8(0, 23);
  h.writeBigUInt64LE(BigInt(Date.now()) * 1000n, 24); // unique id
  vars.copy(h, 32);
  return Buffer.concat([h, Buffer.from(frames.buffer, frames.byteOffset, frames.length)]);
}

export function readFseq(buf) {
  const magic = buf.toString('ascii', 0, 4);
  const start = buf.readUInt16LE(4), minor = buf.readUInt8(6), major = buf.readUInt8(7);
  const channels = buf.readUInt32LE(10), frameCount = buf.readUInt32LE(14), stepMs = buf.readUInt8(18), compression = buf.readUInt8(20) & 0x0f;
  return { magic, start, minor, major, channels, frameCount, stepMs, compression, frames: new Uint8Array(buf.buffer, buf.byteOffset + start, Math.min(channels * frameCount, buf.length - start)) };
}

/** Tesla's validator rules + the README's closure rules. Returns { ok, errors, warnings, stats } */
export function validateFseq(buf) {
  const errors = [], warnings = [];
  const f = readFseq(buf);
  if (f.magic !== 'PSEQ' || f.start < 24 || f.frameCount < 1 || f.stepMs < 15) errors.push('Unknown file format, expected FSEQ v2.0');
  if (f.channels !== 48 && f.channels !== 200) errors.push(`Expected 48 or 200 channels, got ${f.channels}`);
  if (f.compression !== 0) errors.push('Expected file format to be V2 Uncompressed');
  if (f.major !== 2 || (f.minor !== 0 && f.minor !== 2)) warnings.push(`FSEQ version ${f.major}.${f.minor}`);
  if (f.stepMs > 100) errors.push('step time above 100 ms');
  const duration = (f.frameCount * f.stepMs) / 1000;
  if (duration > 4 * 3600) errors.push('longer than 4 hours');
  if (f.frames.length !== f.channels * f.frameCount) errors.push('truncated channel data');
  const stats = { frames: f.frameCount, stepMs: f.stepMs, duration, commands: {} };
  if (errors.length) return { ok: false, errors, warnings, stats };

  // closure actuation counts: a command is counted when the value changes INTO open/dance/close
  const counts = {};
  const danceMs = {};
  for (const [chS, kind] of Object.entries(CLOSURE_CHANNELS)) {
    const ch = +chS - 1;
    if (ch >= f.channels) continue;
    let prev = 'idle', n = 0, d = 0;
    for (let i = 0; i < f.frameCount; i++) {
      const cmd = closureOf(f.frames[i * f.channels + ch]);
      if (cmd !== prev && (cmd === 'open' || cmd === 'close' || cmd === 'dance')) n++;
      if (cmd === 'dance') d += f.stepMs;
      prev = cmd;
    }
    counts[chS] = n; danceMs[chS] = d;
    if (n > LIMITS[kind]) errors.push(`channel ${chS} (${kind}) has ${n} commands, limit ${LIMITS[kind]}`);
    if (d > 30000) warnings.push(`channel ${chS} (${kind}) dances ${(d / 1000).toFixed(1)} s (keep it under ~30 s)`);
  }
  stats.commands = counts; stats.danceMs = danceMs;

  // short flashes on lights (< 15 ms can't show; we never write < 1 frame anyway, but < 100 ms is flagged)
  return { ok: !errors.length, errors, warnings, stats };
}

export { C, MOVE_S };
