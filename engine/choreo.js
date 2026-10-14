// The choreographer: song analysis + a director's plan → 200-channel Tesla light show frames (50 fps).
// Pure and deterministic for a given (analysis, plan, opts). Model-specific closures; lights are universal.
import { CHANNELS, FPS, L, C, BAR, RGB, V, MOVE_S, LIMITS } from './channels.js';

export const MODELS = {
  model3: { name: 'Model 3', closures: ['mirror', 'window', 'chargePort', 'liftgate'] },
  modely: { name: 'Model Y', closures: ['mirror', 'window', 'chargePort', 'liftgate'] },
  models: { name: 'Model S', closures: ['mirror', 'window', 'chargePort', 'liftgate', 'handle'] },
  modelx: { name: 'Model X', closures: ['mirror', 'window', 'chargePort', 'liftgate', 'falcon'] },
  cybertruck: { name: 'Cybertruck', closures: ['mirror', 'window', 'chargePort', 'liftgate'], bars: true },
  // the new Roadster: Tesla hasn't published its light-show channels yet, so this is a preview (lights only + liftoff)
  roadster: { name: 'Roadster', closures: [], preview: true },
};

/** The liftoff window for the Roadster preview: the biggest drop, up to 12 s. Same pick as the closures' "big" moment. */
export function liftoffWindow(a) {
  const drops = a.sections.filter((s) => s.drop), highs = a.sections.filter((s) => s.level === 'high');
  const big = (drops.length ? drops : highs).slice().sort((x, y) => y.energy - x.energy)[0] || a.sections[Math.floor(a.sections.length / 2)];
  if (!big) return null;
  const start = big.start, end = Math.min(big.end, start + 12, a.duration - 1);
  return end - start >= 4 ? { start, end } : null;
}

export const PALETTES = {
  neon: [[255, 0, 120], [0, 220, 255], [140, 0, 255], [255, 255, 255]],
  sunset: [[255, 80, 0], [255, 0, 90], [255, 180, 0], [255, 255, 255]],
  ice: [[0, 160, 255], [180, 240, 255], [60, 0, 255], [255, 255, 255]],
  forest: [[0, 255, 120], [200, 255, 0], [0, 120, 60], [255, 255, 255]],
  mono: [[255, 255, 255], [160, 160, 160], [255, 255, 255], [255, 255, 255]],
  inferno: [[255, 0, 0], [255, 90, 0], [120, 0, 0], [255, 255, 255]],
  candy: [[255, 90, 200], [120, 220, 255], [255, 230, 120], [255, 255, 255]],
};

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Rule-based director: picks a mood per section. An LLM director can return the same shape. */
export function directRules(a, { vibe = 'party' } = {}) {
  const secs = a.sections;
  const plan = secs.map((s, i) => {
    const next = secs[i + 1];
    let mood;
    if (i === 0 && s.level === 'low') mood = 'intro';
    else if (i === secs.length - 1 && s.level !== 'high') mood = 'outro';
    else if (s.level === 'low') mood = 'breathe';
    else if (s.level === 'mid') mood = next && (next.drop || next.level === 'high') ? 'build' : 'pulse';
    else mood = vibe === 'insane' ? (s.drop ? 'strobe' : 'party') : vibe === 'smooth' ? 'pulse' : 'party';
    return { mood, intensity: vibe === 'smooth' ? 0.6 : vibe === 'insane' ? 1 : 0.85 };
  });
  return { sections: plan };
}

// ensemble = { i, n }: car i of n in a synchronized multi-car show. Hits stay in unison; chases, alternations and
// breathing travel across the cars, and the interior colours are offset per car.
export function choreograph(a, { model = 'modely', vibe = 'party', palette = 'neon', closures = 'all', seed = 1, plan, ensemble = { i: 0, n: 1 } } = {}) {
  const EI = ensemble.i | 0, EN = Math.max(1, ensemble.n | 0);
  const mine = (k) => ((k % EN) + EN) % EN === EI;
  const n = a.frames + Math.round(FPS); // one second of tail
  const fr = new Uint8Array(n * CHANNELS);
  const R = rng(seed);
  const pal = PALETTES[palette] || PALETTES.neon;
  plan = plan || directRules(a, { vibe });
  const M = MODELS[model] || MODELS.modely;
  const beatLen = Math.max(8, Math.round((60 / a.bpm) * FPS)); // frames per beat
  const notes = [];

  // ---------- primitives ----------
  const set = (ch, f0, f1, v) => { f0 = Math.max(0, f0 | 0); f1 = Math.min(n, f1 | 0); for (let f = f0; f < f1; f++) fr[f * CHANNELS + ch - 1] = v; };
  const get = (ch, f) => fr[f * CHANNELS + ch - 1];
  const both = (pair, f0, f1, v) => { for (const ch of [].concat(pair)) set(ch, f0, f1, v); };
  const side = (pair, s, f0, f1, v) => set(Array.isArray(pair) ? pair[s] : pair, f0, f1, v);
  // 3/Y OR's channels 4-6 together and takes the ramp from channel 4; aux park + side markers are OR'd too: drive them as groups
  const glow = (s, f0, f1, v) => { for (const p of [L.ch4, L.ch5, L.ch6]) s == null ? both(p, f0, f1, v) : side(p, s, f0, f1, v); };
  const markers = (s, f0, f1, v) => { for (const p of [L.auxPark, L.sideMarker]) s == null ? both(p, f0, f1, v) : side(p, s, f0, f1, v); };
  const inRange = (list, f0, f1) => list.filter((x) => x >= f0 && x < f1);
  const FLASH = 6; // 120 ms: comfortably over the 100 ms "pleasing" minimum

  // ---------- light moods ----------
  const moods = {
    intro(f0, f1) {
      // a slow wake-up: signature and glow ramp up, the tails come on
      const mid = f0 + Math.floor((f1 - f0) / 2);
      both(L.signature, f0, mid, V.ON_2000); both(L.signature, mid, f1, V.ON);
      glow(null, mid, f1, V.ON_2000);
      both(L.tail, f0, f1, V.ON); set(L.plate, f0, f1, V.ON);
      for (const d of inRange(a.downbeats, mid, f1)) both(L.inner, d, d + 2 * beatLen, V.ON_1000), both(L.inner, d + 2 * beatLen, d + 4 * beatLen, V.OFF_1000);
    },
    breathe(f0, f1) {
      both(L.tail, f0, f1, V.ON); set(L.plate, f0, f1, V.ON);
      const per = Math.max(beatLen * 4, 110); // a breath every bar (≥ 2.2 s)
      const lag = Math.round((per * EI) / (EN * 2));
      for (let f = f0 + lag, k = 0; f < f1; f += per, k++) {
        const h = Math.floor(per / 2);
        glow(null, f, f + h, V.ON_2000); glow(null, f + h, Math.min(f1, f + per), V.OFF_2000);
        both(L.signature, f, f + h, V.ON_1000); both(L.signature, f + h, Math.min(f1, f + per), V.OFF_1000);
        if (k % 2) both(L.inner, f, f + h, V.ON_2000), both(L.inner, f + h, Math.min(f1, f + per), V.OFF_2000);
      }
    },
    pulse(f0, f1, it) {
      both(L.signature, f0, f1, V.ON); both(L.tail, f0, f1, V.ON); set(L.plate, f0, f1, V.ON);
      let s = 0;
      inRange(a.kicks, f0, f1).forEach((k, j) => { if (EN > 1 && !mine(j)) return; side(L.inner, s, k, k + FLASH, V.ON); s ^= 1; });
      for (const b of inRange(a.beats, f0, f1)) glow(null, b, b + Math.round(beatLen / 2), V.ON_500), glow(null, b + Math.round(beatLen / 2), b + beatLen, V.OFF_500);
      if (it > 0.7) { let t = 0; for (const h of inRange(a.hats, f0, f1)) { if (t++ % 2) continue; markers(t % 4 === 1 ? 0 : 1, h, h + 5, V.ON); } }
      for (const d of inRange(a.downbeats, f0, f1)) both(L.fog, d, d + FLASH, V.ON);
      for (const sn of inRange(a.snares, f0, f1)) set(L.brake, sn, sn + FLASH, V.ON);
    },
    build(f0, f1) {
      both(L.tail, f0, f1, V.ON);
      const beats = inRange(a.beats, f0, f1);
      const last2bars = f1 - 8 * beatLen, lastBar = f1 - 4 * beatLen;
      beats.forEach((b, i) => {
        if (b >= f1 - beatLen) return; // the last beat is a blackout before the drop
        if (b < last2bars) { if (EN > 1 && !mine(i)) return; side(L.frontTurn, i % 2, b, b + Math.round(beatLen * 0.6), V.ON); side(L.rearTurn, i % 2, b, b + Math.round(beatLen * 0.6), V.ON); }
        else {
          const div = b >= lastBar && beatLen / 4 >= FLASH ? 4 : 2;
          const step = Math.round(beatLen / div);
          for (let j = 0; j < div; j++) {
            const f = b + j * step, s = j % 2;
            const len = Math.max(FLASH - 1, Math.floor(step * 0.55));
            side(L.outer, s, f, f + len, V.ON); side(L.inner, 1 - s, f, f + len, V.ON);
            side(L.frontTurn, s, f, f + len, V.ON); side(L.rearTurn, 1 - s, f, f + len, V.ON);
          }
        }
      });
      // rising glow in the last two seconds
      glow(null, Math.max(f0, f1 - beatLen - 100), f1 - beatLen, V.ON_2000);
      both(L.signature, f0, f1 - beatLen, V.ON);
    },
    party(f0, f1, it) {
      both(L.signature, f0, f1, V.ON); glow(null, f0, f1, V.ON);
      const order = [[L.outer, 0], [L.inner, 0], [L.inner, 1], [L.outer, 1]];
      const beats = inRange(a.beats, f0, f1);
      beats.forEach((b, i) => {
        const bar = Math.floor(i / 4);
        if (i % 4 === 0) { both(L.outer, b, b + FLASH + 2, V.ON); both(L.inner, b, b + FLASH + 2, V.ON); both(L.fog, b, b + FLASH + 2, V.ON); return; }
        const step = Math.round(beatLen / 4);
        if (step >= FLASH) for (let j = 0; j < 4; j++) {
          // one comet runs across all cars: 4 positions per car, one step per 16th note
          const g = ((i % 4) * 4 + j) % (4 * EN), pos = bar % 2 ? 4 * EN - 1 - g : g;
          if (EN > 1 && Math.floor(pos / 4) !== EI) continue;
          const [p, s] = order[pos % 4];
          side(p, s, b + j * step, b + j * step + step, V.ON);
        } else if (EN === 1 || mine(i)) side(L.inner, i % 2, b, b + FLASH, V.ON);
      });
      for (const k of inRange(a.kicks, f0, f1)) { set(L.brake, k, k + FLASH, V.ON); both(L.tail, k, k + FLASH, V.ON); set(L.reverse, k, k + FLASH, V.ON); }
      let t = 0;
      for (const h of inRange(a.hats, f0, f1)) { if (it < 0.9 && t % 2) { t++; continue; } both(L.repeater, h, h + 5, V.OFF); side(L.repeater, t % 2, h, h + 5, V.ON); markers(1 - (t % 2), h, h + 5, V.ON); t++; }
      for (const sn of inRange(a.snares, f0, f1)) both(L.frontTurn, sn, sn + FLASH, V.ON), both(L.rearTurn, sn, sn + FLASH, V.ON);
    },
    strobe(f0, f1) {
      both(L.signature, f0, f1, V.ON);
      const beats = inRange(a.beats, f0, f1);
      for (const b of beats) {
        const half = Math.round(beatLen / 2);
        for (const f of [b, b + half]) {
          const len = Math.max(5, Math.floor(half * 0.45));
          for (const p of [L.outer, L.inner, L.fog, L.frontTurn, L.rearTurn, L.tail, L.repeater]) both(p, f, f + len, V.ON);
          glow(null, f, f + len, V.ON); markers(null, f, f + len, V.ON);
          set(L.brake, f, f + len, V.ON); set(L.reverse, f, f + len, V.ON);
        }
      }
    },
    outro(f0, f1) {
      both(L.tail, f0, f1 - beatLen * 2, V.ON); set(L.plate, f0, f1 - beatLen * 2, V.ON);
      const mid = f0 + Math.floor((f1 - f0) / 2);
      both(L.signature, f0, mid, V.ON); both(L.signature, mid, Math.min(f1, mid + 110), V.OFF_2000);
      glow(null, f0, mid, V.ON_2000); glow(null, mid, Math.min(f1, mid + 110), V.OFF_2000);
      const d = inRange(a.downbeats, f0, f1);
      if (d.length) { const last = d[d.length - 1]; both(L.inner, last, last + 60, V.ON); both(L.inner, last + 60, last + 170, V.OFF_2000); }
    },
    blackout() {},
  };

  a.sections.forEach((s, i) => {
    const p = plan.sections[i] || { mood: 'pulse', intensity: 0.8 };
    (moods[p.mood] || moods.pulse)(s.f0, Math.min(s.f1, a.frames), p.intensity ?? 0.8);
  });
  // the final frame block is dark
  for (let f = a.frames; f < n; f++) fr.fill(0, f * CHANNELS, f * CHANNELS + 46);

  // ---------- interior RGB (all cars with an RGB screen / accent lights) ----------
  const rgbSlots = Object.values(RGB);
  const energy = a.energy, low = a.low;
  const kickSet = new Set(a.kicks);
  let flashT = 99;
  a.sections.forEach((s, si) => {
    const mood = (plan.sections[si] || {}).mood || 'pulse';
    const downs = inRange(a.downbeats, s.f0, s.f1), beats = inRange(a.beats, s.f0, s.f1);
    for (let f = s.f0; f < Math.min(s.f1, a.frames); f++) {
      let ci;
      if (mood === 'party' || mood === 'strobe') ci = Math.max(0, beats.findLastIndex((b) => b <= f)) % 3;
      else ci = Math.max(0, downs.findLastIndex((b) => b <= f)) % 3;
      let c = pal[(ci + si + EI) % 3];
      let br = mood === 'breathe' || mood === 'intro' || mood === 'outro' ? 0.25 + 0.6 * (energy[f] / 255) : 0.35 + 0.65 * (low[f] / 255);
      if (kickSet.has(f) && (mood === 'party' || mood === 'strobe')) flashT = 0;
      if (flashT < 10) { const w = 1 - flashT / 10; c = c.map((x, k) => x * (1 - w) + pal[3][k] * w); br = Math.max(br, w); }
      flashT++;
      if (mood === 'blackout') br = 0;
      const o = f * CHANNELS;
      for (const st of rgbSlots) { fr[o + st - 1] = c[0] * br; fr[o + st] = c[1] * br; fr[o + st + 1] = c[2] * br; }
    }
  });

  // ---------- Cybertruck light bars ----------
  if (M.bars) {
    const front = [...Array(30)].map((_, i) => BAR.frontLeft.start + i).concat([...Array(30)].map((_, i) => BAR.frontRight.start + i));
    const rear = [...Array(26)].map((_, i) => BAR.rearLeft.start + i).concat([...Array(26)].map((_, i) => BAR.rearRight.start + i));
    a.sections.forEach((s, si) => {
      const mood = (plan.sections[si] || {}).mood || 'pulse';
      const beats = inRange(a.beats, s.f0, s.f1);
      for (let f = s.f0; f < Math.min(s.f1, a.frames); f++) {
        const o = f * CHANNELS;
        const bi = beats.findLastIndex((b) => b <= f), b0 = bi >= 0 ? beats[bi] : s.f0;
        const ph = Math.min(1, (f - b0) / beatLen);
        const strip = (leds, fn) => leds.forEach((ch, i) => (fr[o + ch - 1] = Math.max(0, Math.min(255, fn(i / (leds.length - 1)) * 255))));
        if (mood === 'breathe' || mood === 'intro' || mood === 'outro') {
          const w = 0.1 + 0.5 * (energy[f] / 255);
          strip(front, (x) => (Math.abs(x - 0.5) < w / 2 ? 0.25 + 0.5 * (energy[f] / 255) : 0));
          strip(rear, (x) => (Math.abs(x - 0.5) < w / 2 ? 0.2 + 0.4 * (energy[f] / 255) : 0));
        } else if (mood === 'pulse' || mood === 'build') {
          const lvl = low[f] / 255;
          strip(front, (x) => (Math.abs(x - 0.5) * 2 < lvl ? 1 : 0)); // VU from the centre out
          strip(rear, (x) => (Math.abs(x - 0.5) * 2 < lvl * 0.8 ? 0.8 : 0));
        } else {
          const dir = bi % 2 ? 1 - ph : ph; // a comet bouncing L↔R each beat
          strip(front, (x) => Math.max(0, 1 - Math.abs(x - dir) * 8) + (kickSet.has(f) ? 1 : 0));
          strip(rear, (x) => Math.max(0, 1 - Math.abs(x - (1 - dir)) * 8));
        }
      }
      if (mood === 'party' || mood === 'strobe') for (const d of inRange(a.downbeats, s.f0, s.f1)) for (let i = 0; i < BAR.offroad.n; i++) set(BAR.offroad.start + i, d, d + FLASH, V.ON);
    });
  }

  // ---------- closures ----------
  const use = closures === 'none' ? [] : M.closures.filter((k) => closures === 'all' || ['mirror', 'window', 'chargePort'].includes(k));
  const busy = []; // [f0, f1, what] spans of door movement (windows must not move during Model X door movement)
  const sec = (s) => Math.round(s * FPS);
  const cmd = (ch, f, v, len = sec(1)) => set(ch, f, f + len, v);
  const end = a.frames;
  const highs = a.sections.filter((s) => s.level === 'high');
  const drops = a.sections.filter((s) => s.drop);
  const big = (drops.length ? drops : highs).slice().sort((x, y) => y.energy - x.energy)[0] || a.sections[Math.floor(a.sections.length / 2)];
  const firstDrop = (drops[0] || highs[0] || big);
  const lastDrop = (drops[drops.length - 1] || highs[highs.length - 1] || big);
  const danceLen = (s, max) => Math.min(sec(max), s.f1 - s.f0);

  if (use.includes('falcon')) {
    const open = big.f0 - sec(MOVE_S.falconOpen + 1);
    const closeAt = end - sec(MOVE_S.falconClose + 2);
    if (open >= 0 && closeAt > big.f0 + sec(4)) {
      const dl = Math.min(danceLen(big, 12), closeAt - big.f0 - sec(1));
      for (const ch of C.falcon) { cmd(ch, open, V.OPEN); set(ch, big.f0, big.f0 + dl, V.DANCE); cmd(ch, closeAt, V.CLOSE); }
      busy.push([open, open + sec(MOVE_S.falconOpen)], [big.f0, big.f0 + dl], [closeAt, closeAt + sec(MOVE_S.falconClose)]);
      notes.push(`falcon doors open at ${(open / FPS).toFixed(1)} s, dance at the drop, close at ${(closeAt / FPS).toFixed(1)} s`);
    } else notes.push('song too short for the falcon doors');
  }
  if (use.includes('liftgate')) {
    const open = big.f0 - sec(MOVE_S.liftgateOpen + 1);
    const closeAt = end - sec(MOVE_S.liftgateClose + 2);
    if (open >= 0 && closeAt > big.f0 + sec(4)) {
      const dl = Math.min(danceLen(big, 10), closeAt - big.f0 - sec(1));
      cmd(C.liftgate, open, V.OPEN); set(C.liftgate, big.f0, big.f0 + dl, V.DANCE); cmd(C.liftgate, closeAt, V.CLOSE);
      notes.push(`${model === 'cybertruck' ? 'frunk' : 'liftgate'} opens at ${(open / FPS).toFixed(1)} s and dances at the drop`);
    }
  }
  if (use.includes('window')) {
    // dance at a drop where no door is moving; Model S/3/Y have no such doors
    const cands = [firstDrop, lastDrop, ...highs].filter(Boolean);
    let done = 0;
    for (const s of cands) {
      if (done >= 2) break;
      const dl = danceLen(s, 10), f0 = s.f0;
      if (busy.some(([b0, b1]) => f0 < b1 && f0 + dl > b0)) continue;
      if (C.window.some((ch) => get(ch, f0))) continue;
      for (const ch of C.window) set(ch, f0, f0 + dl, V.DANCE);
      done++;
    }
    if (done) notes.push(`windows dance ${done}x`);
  }
  if (use.includes('chargePort')) {
    const s = lastDrop, open = Math.max(0, s.f0 - sec(3));
    const dl = danceLen(s, 20);
    if (s.f0 + dl + sec(2) < end) {
      cmd(C.chargePort, open, V.OPEN, Math.max(1, s.f0 - open)); set(C.chargePort, s.f0, s.f0 + dl, V.DANCE); cmd(C.chargePort, s.f0 + dl, V.CLOSE);
      notes.push('charge port flashes rainbow on the last drop');
    }
  }
  const tapDownbeats = (chs, kind, pool, max) => {
    // open/close on downbeats, ≥ movement time apart; ends where it started (mirrors unfolded, handles in)
    const gap = sec(MOVE_S[kind] + 0.6);
    const ds = []; let last = -1e9;
    for (const d of pool) if (d - last >= gap) { ds.push(d); last = d; }
    const k = Math.min(max, ds.length - (ds.length % 2));
    for (let i = 0; i < k; i++) for (const ch of chs) cmd(ch, ds[i], kind === 'mirror' ? (i % 2 ? V.OPEN : V.CLOSE) : (i % 2 ? V.CLOSE : V.OPEN), sec(0.6));
    return k;
  };
  if (use.includes('mirror')) {
    const s = a.sections.find((x, i) => (plan.sections[i] || {}).mood === 'pulse' || (plan.sections[i] || {}).mood === 'build') || a.sections[1] || a.sections[0];
    const k = tapDownbeats(C.mirror, 'mirror', inRange(a.downbeats, s.f0, s.f1), Math.min(LIMITS.mirror - 4, 12));
    if (k) notes.push(`mirrors fold ${k / 2}x on the beat`);
  }
  if (use.includes('handle')) {
    const s = highs[0] || big;
    const k = tapDownbeats(C.handle, 'handle', inRange(a.downbeats, s.f0, s.f1), 12);
    if (k) notes.push(`door handles pop ${k / 2}x`);
  }

  // ---------- minimum on/off times for boolean-ish lights ----------
  for (let ch = 1; ch <= 30; ch++) tidy(fr, n, ch, FLASH - 1, 3);
  return { frames: fr, frameCount: n, plan, notes, model, vibe, palette };
}

// lengthen on-runs shorter than minOn, and fill off-gaps shorter than minOff (between two "on" runs)
function tidy(fr, n, ch, minOn, minOff) {
  const at = (f) => fr[f * CHANNELS + ch - 1];
  const put = (f, v) => (fr[f * CHANNELS + ch - 1] = v);
  for (let f = 0; f < n; ) {
    if (at(f) < 128) { f++; continue; }
    let e = f; const v = at(f);
    while (e < n && at(e) >= 128) e++;
    if (e - f < minOn) for (let k = e; k < Math.min(n, f + minOn); k++) if (at(k) < 128) put(k, v);
    // gap after this run
    let g = Math.max(e, f + minOn);
    let h = g; while (h < n && at(h) === 0) h++;
    if (h < n && h - g > 0 && h - g < minOff && at(h) >= 128) for (let k = g; k < h; k++) put(k, at(h));
    f = Math.max(e, h);
  }
}

/** A synchronized show for n cars of the given models (array). → [{ model, frames, notes }] */
export function choreographFleet(a, cars, opts = {}) {
  const plan = opts.plan || directRules(a, opts);
  return cars.map((model, i) => choreograph(a, { ...opts, model, plan, ensemble: { i, n: cars.length } }));
}
