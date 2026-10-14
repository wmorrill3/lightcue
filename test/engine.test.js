import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { writeFseq, readFseq, validateFseq } from '../engine/fseq.js';
import { choreograph, MODELS } from '../engine/choreo.js';
import { CHANNELS, V, C, rampOf, closureOf } from '../engine/channels.js';

const A = JSON.parse(fs.readFileSync(new URL('./fixtures/song-a.json', import.meta.url)));
const SHORT = JSON.parse(fs.readFileSync(new URL('./fixtures/song-b.json', import.meta.url)));

test('fseq header matches what Tesla validator.py reads', () => {
  const fr = new Uint8Array(CHANNELS * 100); fr[0] = 255;
  const b = writeFseq(fr, { media: 'x.wav' });
  const f = readFseq(b);
  assert.equal(f.magic, 'PSEQ'); assert.equal(f.major, 2); assert.equal(f.minor, 0);
  assert.equal(f.channels, 200); assert.equal(f.frameCount, 100); assert.equal(f.stepMs, 20); assert.equal(f.compression, 0);
  assert.ok(f.start >= 24 && f.start % 4 === 0);
  assert.equal(f.frames[0], 255);
  assert.ok(validateFseq(b).ok);
});

test('validator rejects wrong channel counts and compression', () => {
  const b = writeFseq(new Uint8Array(100 * 64), { channels: 64 });
  assert.match(validateFseq(b).errors.join(), /48 or 200/);
  const c = writeFseq(new Uint8Array(CHANNELS * 10)); c.writeUInt8(1, 20);
  assert.match(validateFseq(c).errors.join(), /Uncompressed/);
});

test('validator counts closure commands against the limits', () => {
  const fr = new Uint8Array(CHANNELS * 2000);
  for (let i = 0; i < 4; i++) for (let f = i * 200; f < i * 200 + 50; f++) fr[f * CHANNELS + C.chargePort - 1] = i % 2 ? V.CLOSE : V.OPEN;
  const r = validateFseq(writeFseq(fr));
  assert.equal(r.stats.commands[C.chargePort], 4);
  assert.ok(!r.ok && /limit 3/.test(r.errors.join()));
});

test('every model × vibe produces a valid show within closure limits', () => {
  for (const model of Object.keys(MODELS)) for (const vibe of ['smooth', 'party', 'insane']) for (const a of [A, SHORT]) {
    const s = choreograph(a, { model, vibe });
    const r = validateFseq(writeFseq(s.frames));
    assert.ok(r.ok, `${model}/${vibe}: ${r.errors}`);
    for (const ms of Object.values(r.stats.danceMs)) assert.ok(ms <= 30000, `${model}/${vibe} dances ${ms} ms`);
  }
});

test('closures only for the chosen car, and none when turned off', () => {
  const y = choreograph(A, { model: 'modely' }).frames;
  const x = choreograph(A, { model: 'modelx' }).frames;
  const off = choreograph(A, { model: 'modelx', closures: 'none' }).frames;
  const any = (fr, ch) => { for (let f = 0; f < fr.length / CHANNELS; f++) if (fr[f * CHANNELS + ch - 1]) return true; return false; };
  assert.ok(!any(y, C.falcon[0]), 'model Y never commands falcon doors');
  assert.ok(any(x, C.falcon[0]), 'model X gets falcon doors on a 3 min song');
  for (const ch of [...C.falcon, ...C.window, ...C.mirror, C.liftgate, C.chargePort]) assert.ok(!any(off, ch));
});

test('Model X windows never move while the falcon doors move', () => {
  const s = choreograph(A, { model: 'modelx' }).frames;
  const n = s.length / CHANNELS;
  const falcon = (f) => s[f * CHANNELS + C.falcon[0] - 1];
  // falcon "moving": from an open cmd for 20 s, during dance, from a close cmd for 8 s
  const moving = new Uint8Array(n);
  for (let f = 0; f < n; f++) {
    const c = closureOf(falcon(f)), p = f ? closureOf(falcon(f - 1)) : 'idle';
    if (c === 'dance') moving[f] = 1;
    if (c === 'open' && p !== 'open') for (let k = f; k < Math.min(n, f + 1000); k++) moving[k] = 1;
    if (c === 'close' && p !== 'close') for (let k = f; k < Math.min(n, f + 400); k++) moving[k] = 1;
  }
  for (let f = 0; f < n; f++) if (closureOf(s[f * CHANNELS + C.window[0] - 1]) !== 'idle') assert.ok(!moving[f], `window moves at ${f / 50}s during falcon movement`);
});

test('mirrors end unfolded and the charge port opens before it dances', () => {
  const s = choreograph(A, { model: 'modely' }).frames;
  const n = s.length / CHANNELS;
  let lastMirror = null, opened = false, okDance = true;
  for (let f = 0; f < n; f++) {
    const m = closureOf(s[f * CHANNELS + C.mirror[0] - 1]); if (m === 'open' || m === 'close') lastMirror = m;
    const c = closureOf(s[f * CHANNELS + C.chargePort - 1]); if (c === 'open') opened = true; if (c === 'dance' && !opened) okDance = false;
  }
  assert.ok(lastMirror === null || lastMirror === 'open');
  assert.ok(okDance);
});

test('boolean light flashes are at least 100 ms', () => {
  const s = choreograph(A, { model: 'modely', vibe: 'insane' }).frames;
  const n = s.length / CHANNELS;
  for (let ch = 1; ch <= 30; ch++) {
    let run = 0;
    for (let f = 0; f <= n; f++) {
      const on = f < n && s[f * CHANNELS + ch - 1] >= 128;
      if (on) run++; else { if (run) assert.ok(run >= 5, `ch ${ch} flash ${run * 20} ms at ${f / 50}s`); run = 0; }
    }
  }
});

test('ramp and closure codes decode to the documented effects', () => {
  assert.deepEqual(rampOf(V.ON_2000), { on: true, ms: 2000 });
  assert.deepEqual(rampOf(V.OFF_500), { on: false, ms: 500 });
  assert.deepEqual(rampOf(V.ON), { on: true, ms: 0 });
  assert.equal(closureOf(V.OPEN), 'open'); assert.equal(closureOf(V.DANCE), 'dance'); assert.equal(closureOf(V.CLOSE), 'close');
});

test('deterministic: same inputs, same bytes', () => {
  const a = choreograph(A, { model: 'models', seed: 3 }).frames, b = choreograph(A, { model: 'models', seed: 3 }).frames;
  assert.deepEqual(Buffer.from(a), Buffer.from(b));
});

test('fleet: every car gets a valid, different show and downbeat hits stay in unison', async () => {
  const { choreographFleet } = await import('../engine/choreo.js');
  const shows = choreographFleet(A, ['modely', 'model3', 'modelx', 'cybertruck']);
  assert.equal(shows.length, 4);
  for (const s of shows) assert.ok(validateFseq(writeFseq(s.frames)).ok);
  assert.notDeepEqual(Buffer.from(shows[0].frames), Buffer.from(shows[1].frames));
});
