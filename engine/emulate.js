// What the car does with a show, frame by frame: light intensities (with ramps), interior RGB, light bars and
// closure positions. Browser + Node. Used by the 3D preview.
import { CHANNELS, STEP_MS, rampOf, closureOf, C, MOVE_S, RGB } from './channels.js';

export function parseFseq(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const start = dv.getUint16(4, true), channels = dv.getUint32(10, true), frameCount = dv.getUint32(14, true), stepMs = dv.getUint8(18);
  return { channels, frameCount, stepMs, frames: u8.subarray(start, start + channels * frameCount) };
}

const LIGHTS = 30; // channels 1..30 are lights
// these follow ramp codes; everything else is boolean (≥ 50% = on)
const RAMPING = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);

export function emulate(show) {
  const { frames, frameCount, channels } = show;
  const step = show.stepMs || STEP_MS;
  const light = new Float32Array(frameCount * LIGHTS);
  // lights
  for (let ch = 1; ch <= LIGHTS; ch++) {
    let level = 0;
    for (let f = 0; f < frameCount; f++) {
      const v = frames[f * channels + ch - 1];
      if (RAMPING.has(ch)) {
        const r = rampOf(v);
        const target = r.on ? 1 : 0;
        if (!r.ms) level = target;
        else level += Math.sign(target - level) * Math.min(Math.abs(target - level), step / r.ms);
      } else level = v >= 128 ? 1 : 0;
      light[f * LIGHTS + ch - 1] = level;
    }
  }
  // closures: position 0 (closed / mirror unfolded) .. 1 (open / folded); dance oscillates
  const closures = {};
  const span = { liftgate: [MOVE_S.liftgateOpen, MOVE_S.liftgateClose], falcon: [MOVE_S.falconOpen, MOVE_S.falconClose], frontDoor: [MOVE_S.frontDoorOpen, MOVE_S.frontDoorClose], window: [MOVE_S.window, MOVE_S.window], mirror: [MOVE_S.mirror, MOVE_S.mirror], handle: [MOVE_S.handle, MOVE_S.handle], chargePort: [MOVE_S.chargePort, MOVE_S.chargePort] };
  const sim = (ch, kind) => {
    const pos = new Float32Array(frameCount), dance = new Uint8Array(frameCount);
    let p = 0, target = 0, prev = 'idle', dancing = false;
    for (let f = 0; f < frameCount; f++) {
      const c = closureOf(frames[f * channels + ch - 1]);
      if (c !== prev) { if (c === 'open') target = 1; else if (c === 'close') target = 0; else if (c === 'stop') target = p; }
      if (c !== 'dance') dancing = false;
      else if (kind === 'window' || p > 0.95) dancing = true;
      if (dancing) {
        dance[f] = 1;
        const t = (f * step) / 1000;
        p = kind === 'window' ? 0.25 + 0.25 * Math.sin(t * 2 * Math.PI * 0.5) : 0.85 + 0.15 * Math.sin(t * 2 * Math.PI * 0.7);
      } else {
        const dur = (target > p ? span[kind][0] : span[kind][1]) * 1000;
        p += Math.sign(target - p) * Math.min(Math.abs(target - p), step / dur);
      }
      pos[f] = p; prev = c;
    }
    return { pos, dance };
  };
  for (const [kind, chs] of Object.entries({ falcon: C.falcon, frontDoor: C.frontDoor, mirror: C.mirror, window: C.window, handle: C.handle, liftgate: [C.liftgate], chargePort: [C.chargePort] }))
    closures[kind] = chs.map((ch) => sim(ch, kind));
  return {
    frameCount, stepMs: step,
    light: (f, ch) => light[Math.min(frameCount - 1, f) * LIGHTS + ch - 1],
    rgb: (f, slot = RGB.display) => { const o = Math.min(frameCount - 1, f) * channels + slot - 1; return channels >= 193 ? [frames[o], frames[o + 1], frames[o + 2]] : [0, 0, 0]; },
    raw: (f, ch) => frames[Math.min(frameCount - 1, f) * channels + ch - 1],
    closures,
  };
}
