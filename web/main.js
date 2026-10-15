import { Stage } from './stage.js';
import { parseFseq, emulate } from '../engine/emulate.js';
import { choreograph, directRules, liftoffWindow } from '../engine/choreo.js';
import { CHANNELS } from '../engine/channels.js';

const $ = (id) => document.getElementById(id);
const CARS = [['roadster', 'Roadster'], ['modely', 'Model Y'], ['model3', 'Model 3'], ['models', 'Model S'], ['modelx', 'Model X'], ['cybertruck', 'Cybertruck']];
const VIBES = [['smooth', 'Smooth'], ['party', 'Party'], ['insane', 'Insane']];
const PALETTES = { neon: ['#ff0078', '#00dcff'], sunset: ['#ff5000', '#ff005a'], ice: ['#00a0ff', '#b4f0ff'], forest: ['#00ff78', '#c8ff00'], mono: ['#ffffff', '#a0a0a0'], inferno: ['#ff0000', '#ff5a00'], candy: ['#ff5ac8', '#78dcff'] };
const CLOSURES = [['all', 'All'], ['safe', 'Some'], ['none', 'Lights only']];
const MOOD_SHADE = { intro: '#1d1e22', breathe: '#26272c', pulse: '#3a3b42', build: '#5a5b63', party: '#c9cad0', strobe: '#ffffff', outro: '#1d1e22', blackout: '#111' };
const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

const WRAPS = [['none', 'No wrap'], ['aurora', 'Aurora'], ['chrome', 'Liquid Chrome'], ['synth', 'Synthwave'], ['sakura', 'Sakura'], ['carbon', 'Carbon Gold'], ['lava', 'Lava']];
const VARIANTS = {
  modely: [['modely', '2020–2024'], ['modely-2025-base', '2025+ Standard'], ['modely-2025-premium', '2025+ Premium'], ['modely-2025-performance', '2025+ Performance'], ['modely-l', 'Model Y L']],
  model3: [['model3', '2017–2023'], ['model3-2024-base', '2024+'], ['model3-2024-performance', '2024+ Performance']],
  models: [['models-2021', '2021–2024'], ['models-2025-plaid', '2025+ Plaid']], modelx: [['modelx-2021', '2021+']], cybertruck: [['cybertruck', 'Cybertruck']],
};
const state = { car: 'modely', n: 1, vibe: 'party', palette: 'neon', closures: 'all', wrap: 'none', variant: '', file: null, job: null };
document.querySelectorAll('.origin').forEach((e) => (e.textContent = location.origin));

// ---------- controls ----------
function seg(el, items, key, onPick) {
  el.innerHTML = items.map(([v, l]) => `<button type="button" data-v="${v}">${l}</button>`).join('');
  const paint = () => el.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === state[key]));
  el.onclick = (e) => { const b = e.target.closest('button'); if (!b) return; state[key] = b.dataset.v; paint(); onPick?.(); };
  paint();
}
seg($('car'), CARS, 'car', () => { applyCar(); paintVariant(); });
seg($('vibe'), VIBES, 'vibe', () => rechoreo());
seg($('closures'), CLOSURES, 'closures', () => rechoreo());
$('palette').innerHTML = Object.entries(PALETTES).map(([k, [a, b]]) => `<button type="button" data-v="${k}" title="${k}" style="background:linear-gradient(135deg,${a} 50%,${b} 50%)"></button>`).join('');
const paintPal = () => $('palette').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === state.palette));
$('palette').onclick = (e) => { const b = e.target.closest('button'); if (b) { state.palette = b.dataset.v; paintPal(); rechoreo(); } };
paintPal();
$('wrap').innerHTML = WRAPS.map(([id, name]) => `<button type="button" data-v="${id}" title="${name}" style="${id === 'none' ? '' : `background-image:url(/wraps/${id}.jpg)`}">${id === 'none' ? '∅' : ''}</button>`).join('');
const paintWrap = () => { $('wrap').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === state.wrap)); paintVariant(); };
function paintVariant() {
  const v = VARIANTS[state.car] || [];
  $('variant-row').hidden = state.wrap === 'none' || v.length < 2 || isRoadster();
  if (!v.length) return;
  if (!v.some(([id]) => id === state.variant)) state.variant = v[0][0];
  $('variant').innerHTML = v.map(([id, n]) => `<option value="${id}" ${id === state.variant ? 'selected' : ''}>${n}</option>`).join('');
}
$('wrap').onclick = (e) => { const b = e.target.closest('button'); if (b) { state.wrap = b.dataset.v; paintWrap(); applyWrap(); } };
$('variant').onchange = () => { state.variant = $('variant').value; markStale(); };
paintWrap();
function repaintControls() {
  seg($('car'), CARS, 'car', () => { applyCar(); paintVariant(); });
  seg($('vibe'), VIBES, 'vibe', () => rechoreo());
  seg($('closures'), CLOSURES, 'closures', () => rechoreo());
  paintPal(); paintWrap(); paintN();
  const r = isRoadster();
  for (const id of ['row-n', 'row-wrap', 'row-cl']) $(id).hidden = r;
  $('rd-note').hidden = !r;
}
const paintN = () => { $('n').textContent = state.n; $('st-title').textContent = state.n > 1 ? `Make a ${state.n}-car show` : 'Make a show'; };
$('n-dn').onclick = () => { state.n = Math.max(1, state.n - 1); paintN(); rechoreo(); };
$('n-up').onclick = () => { state.n = Math.min(12, state.n + 1); paintN(); rechoreo(); };

function pickFile(f) {
  if (!f) return;
  if (f.size > 40e6) { $('msg').textContent = 'That file is over 40 MB.'; return; }
  state.file = f;
  $('drop').classList.add('has');
  $('drop-main').textContent = f.name.replace(/\.[^.]+$/, '');
  $('drop-sub').textContent = `${(f.size / 1e6).toFixed(1)} MB · tap to change`;
  $('go').disabled = false; $('msg').textContent = '';
}
$('file').onchange = () => pickFile($('file').files[0]);
const drop = $('drop');
['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (e) => pickFile(e.dataTransfer.files[0]));

// ---------- stage + player ----------
const stage = new Stage($('stage'));
window.__lc = { stage, state };
const isRoadster = () => state.car === 'roadster';
async function applyCar() {
  const r = isRoadster();
  for (const id of ['row-n', 'row-wrap', 'row-cl']) $(id).hidden = r;
  if (r) { state.n = 1; paintN(); $('variant-row').hidden = true; }
  $('rd-note').hidden = !r;
  $('rec-demo').hidden = !(r && show && !state.job);
  const car = state.car;
  await stage.setCar(KIND[car] || 'crossover');
  if (state.car !== car) return; // the user already picked another car; that call finishes the job
  applyWrap();
  rechoreo();
}
const KIND = { roadster: 'roadster', cybertruck: 'truck', model3: 'sedan', models: 'sedan', modely: 'crossover', modelx: 'crossover' };
function applyWrap() {
  stage.setWrap(state.wrap !== 'none' && !isRoadster() ? `/wraps/${state.wrap}.jpg` : null);
  markStale();
}
// re-run the choreographer in the browser on the current song, so every setting shows up instantly
function rechoreo() {
  if (!show?.analysis) { renderCues(); return; }
  const a = show.analysis;
  const plan = directRules(a, { vibe: state.vibe });
  const out = choreograph(a, { model: state.car, vibe: state.vibe, palette: state.palette, closures: isRoadster() ? 'none' : state.closures, plan, ensemble: { i: 0, n: isRoadster() ? 1 : state.n } });
  show.emu = emulate({ frames: out.frames, frameCount: out.frameCount, channels: CHANNELS, stepMs: 20 });
  show.liftoff = liftoffWindow(a);
  show.sections = a.sections.map((x, i) => ({ start: x.start, end: x.end, mood: plan.sections[i].mood }));
  stage.setShow(show.emu, state.car);
  stage.setLiftoff(isRoadster() ? show.liftoff : null);
  renderBands(); renderCues(); markStale();
}
const settingsKey = () => JSON.stringify([state.car, state.vibe, state.palette, isRoadster() ? 'none' : state.closures, isRoadster() ? 1 : state.n, isRoadster() ? 'none' : state.wrap, state.wrap === 'none' ? '' : state.variant]);
function markStale() {
  if (!state.job) return;
  const stale = settingsKey() !== state.jobKey;
  $('ready').hidden = stale;
  $('msg').textContent = stale ? (state.file ? 'Settings changed: press Choreograph again to update your download.' : 'Settings changed: drop the song again to make a pack with these settings.') : state.jobMsg;
}
const audio = $('audio');
let clock = { t: 0, last: performance.now() }; // a silent clock so the car performs before anyone presses play
let show = null; // { emu, duration, sections, cues }

function loadShow({ analysis, fseq, audioUrl, sections, duration, title, liftoff }) {
  show = { analysis, duration, sections, liftoff, cues: [] };
  if (analysis) rechoreo();
  else { show.emu = emulate(parseFseq(fseq)); stage.setShow(show.emu, state.car); stage.setLiftoff(isRoadster() ? liftoff : null); renderBands(); renderCues(); }
  audio.src = audioUrl; audio.load();
  clock.t = 0;
  $('now').textContent = title;
}
function renderBands() {
  const { sections, duration } = show;
  $('bands').innerHTML = sections.map((s) => `<i style="width:${((s.end - s.start) / duration) * 100}%;background:${MOOD_SHADE[s.mood] || '#333'}" title="${s.mood}"></i>`).join('');
  const lead = sections[0]?.start || 0;
  if (lead > 0) $('bands').insertAdjacentHTML('afterbegin', `<i style="width:${(lead / duration) * 100}%;background:#111"></i>`);
}
function renderCues() {
  if (!show?.emu) return;
  show.cues = cuesOf(show.emu, show.duration);
  $('cues').innerHTML = show.cues.map((c) => `<span style="left:${(c.t / show.duration) * 100}%" data-t="${c.t}">${c.label}</span>`).join('');
}

// closure moments for the timeline, from the emulated show
function cuesOf(emu, duration) {
  const out = [];
  if (isRoadster()) return show?.liftoff ? [{ t: show.liftoff.start, label: 'liftoff' }] : [];
  const add = (t, label) => { if (!out.some((c) => Math.abs(c.t - t) < duration * 0.08)) out.push({ t, label }); };
  const scan = (arr, label, onDance) => {
    if (!arr?.[0]) return;
    const { pos, dance } = arr[0];
    for (let f = 1; f < emu.frameCount; f++) {
      if (onDance && dance[f] && !dance[f - 1]) add(f / 50, onDance);
      else if (!onDance && pos[f] > 0.05 && pos[f - 1] <= 0.05) add(f / 50, label);
    }
  };
  scan(emu.closures.liftgate, state.car === 'cybertruck' ? 'frunk' : 'liftgate'); scan(emu.closures.falcon, 'falcon doors');
  scan(emu.closures.window, null, 'windows dance'); scan(emu.closures.chargePort, null, 'charge port');
  scan(emu.closures.mirror, 'mirrors');
  if (isRoadster() && show?.liftoff) add(show.liftoff.start, 'liftoff');
  return out.sort((a, b) => a.t - b.t);
}

const now = () => (audio.paused ? clock.t : audio.currentTime);
function frame() {
  const p = performance.now();
  if (audio.paused && show) { clock.t += (p - clock.last) / 1000; if (clock.t > show.duration) clock.t = 0; }
  clock.last = p;
  const t = now();
  stage.render(t);
  if (show) {
    $('head').style.left = `${(t / show.duration) * 100}%`;
    $('time').textContent = `${fmt(t)} / ${fmt(show.duration)}`;
    document.querySelectorAll('.cues span').forEach((s) => s.classList.toggle('live', Math.abs(t - s.dataset.t) < 2.5));
  }
  requestAnimationFrame(frame);
}
$('play').onclick = () => {
  if (audio.paused) { audio.currentTime = Math.min(clock.t, show?.duration || 0); audio.play().catch(() => {}); }
  else { clock.t = audio.currentTime; audio.pause(); }
};
audio.onplay = () => $('play-ico').setAttribute('d', 'M6 4h4v16H6zM14 4h4v16h-4z');
audio.onpause = () => { clock.t = audio.currentTime; $('play-ico').setAttribute('d', 'M7 4.5v15l13-7.5z'); };
audio.onended = () => { clock.t = 0; };
$('bar').onclick = (e) => {
  if (!show) return;
  const r = $('bar').getBoundingClientRect();
  const t = ((e.clientX - r.left) / r.width) * show.duration;
  clock.t = t; if (!audio.paused) audio.currentTime = t;
};

// ---------- generate ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
$('go').onclick = async () => {
  if (!state.file) return;
  const go = $('go'), msg = $('msg');
  go.disabled = true; $('ready').hidden = true;
  const cars = Array.from({ length: state.n }, () => state.car).join(',');
  const title = state.file.name.replace(/\.[^.]+$/, '').slice(0, 60);
  const q = new URLSearchParams({ cars, vibe: state.vibe, palette: state.palette, closures: state.closures, title });
  if (state.wrap !== 'none') { q.set('wrap', state.wrap); q.set('wrapVariant', state.variant); }
  try {
    go.textContent = 'Uploading…';
    const r = await fetch(`/api/v1/shows?${q}`, { method: 'POST', headers: { 'content-type': state.file.type || 'application/octet-stream' }, body: state.file });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'upload failed');
    const words = { queued: 'Waiting in line…', analyzing: 'Listening to the song…', choreographing: 'Choreographing…' };
    for (let i = 0; i < 240; i++) {
      await sleep(1000);
      const s = await (await fetch(`/api/v1/shows/${j.id}`)).json();
      if (s.status === 'done') return openJob(s, true);
      if (s.status === 'failed') throw new Error(s.error || 'failed');
      go.textContent = words[s.status] || 'Working…';
    }
    throw new Error('this is taking too long, try again');
  } catch (e) {
    msg.textContent = e.message; go.disabled = false; go.textContent = 'Choreograph';
  }
};

async function openJob(s, autoplay) {
  const analysis = await fetch(`/api/v1/shows/${s.id}/analysis.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const buf = analysis ? null : await (await fetch(s.preview.fseq[0])).arrayBuffer();
  // the page takes the job's settings, so the preview matches the download
  Object.assign(state, { car: s.cars[0], n: s.cars.length, vibe: s.vibe, palette: s.palette, closures: s.closures, wrap: s.wrap || 'none' });
  if (s.wrapVariant) state.variant = s.wrapVariant;
  repaintControls();
  await stage.setCar(KIND[state.car] || 'crossover'); applyWrap();
  state.job = null;
  loadShow({ analysis, fseq: buf, audioUrl: s.preview.audio, sections: s.analysis.sections, duration: s.analysis.duration, title: s.title, liftoff: s.analysis.liftoff });
  state.job = s; state.jobKey = settingsKey();
  $('go').textContent = 'Choreograph again'; $('go').disabled = !state.file;
  $('ready').hidden = false;
  $('dl').hidden = !s.download; $('rec').hidden = !s.previewOnly; $('wl').hidden = !s.previewOnly; $('rec-demo').hidden = true;
  if (s.download) $('dl').href = s.download;
  $('dl').textContent = s.cars.length > 1 ? `Download ${s.cars.length}-car pack` : 'Download USB pack';
  state.jobMsg = s.previewOnly ? `${Math.round(s.analysis.bpm)} BPM · liftoff at ${fmt(s.analysis.liftoff?.start || 0)}` : `${Math.round(s.analysis.bpm)} BPM · ${s.notes[0].join(' · ')}`;
  $('msg').textContent = state.jobMsg;
  history.replaceState(null, '', `/s/${s.id}`);
  if (autoplay) audio.play().catch(() => {});
}
$('share').onclick = async () => {
  if (!state.job) return;
  await navigator.clipboard?.writeText(`${location.origin}/s/${state.job.id}`).catch(() => {});
  $('share').textContent = 'Link copied'; setTimeout(() => ($('share').textContent = 'Copy share link'), 1600);
};

// code tabs
document.querySelectorAll('.code-tabs button').forEach((b) => (b.onclick = () => {
  document.querySelectorAll('.code-tabs button').forEach((x) => x.classList.toggle('on', x === b));
  $('code-mcp').hidden = b.dataset.tab !== 'mcp'; $('code-rest').hidden = b.dataset.tab !== 'rest';
}));

// ---------- boot ----------
(async () => {
  state.car = 'roadster'; repaintControls();
  await stage.setCar('roadster');
  requestAnimationFrame(frame);
  const m = location.pathname.match(/^\/s\/([\w-]+)/);
  if (m) {
    const s = await (await fetch(`/api/v1/shows/${m[1]}`)).json().catch(() => null);
    if (s?.status === 'done') { await openJob(s, false); stage.preload(WRAPS.filter(([id]) => id !== 'none').map(([id]) => `/wraps/${id}.jpg`)); return; }
  }
  if (location.pathname === '/docs') document.getElementById('agents').scrollIntoView();
  const analysis = await fetch('/demo/analysis.json').then((r) => r.json());
  loadShow({ analysis, audioUrl: '/demo/demo.mp3', duration: analysis.duration, title: 'Demo · LightCue Original' });
  await applyCar();
  stage.preload(WRAPS.filter(([id]) => id !== 'none').map(([id]) => `/wraps/${id}.jpg`));
})();

// ---------- record a clip (canvas + song) for X ----------
let actx = null, adest = null;
function audioStream() {
  if (!actx) {
    actx = new AudioContext();
    const src = actx.createMediaElementSource(audio);
    adest = actx.createMediaStreamDestination();
    src.connect(actx.destination); src.connect(adest);
  }
  return adest.stream;
}
async function recordClip(btn) {
  if (!show) return;
  const mime = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'].find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m));
  if (!mime) { $('msg').textContent = 'This browser cannot record video. Try Chrome or Safari.'; return; }
  const lift = show.liftoff;
  const from = lift ? Math.max(0, lift.start - 6) : 0, len = Math.min(18, show.duration - from);
  stage.controls.autoRotate = true; stage.controls.autoRotateSpeed = 1.1;
  const stream = new MediaStream([...$('stage').captureStream(30).getVideoTracks(), ...audioStream().getAudioTracks()]);
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8e6 });
  const chunks = []; rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const label = btn.textContent; btn.classList.add('rec-on');
  audio.currentTime = from; await actx.resume(); await audio.play().catch(() => {});
  rec.start(250);
  const t0 = performance.now();
  const tick = setInterval(() => { btn.textContent = `Recording… ${Math.max(0, Math.ceil(len - (performance.now() - t0) / 1000))}s`; }, 250);
  await new Promise((r) => setTimeout(r, len * 1000));
  clearInterval(tick); rec.stop(); audio.pause();
  await new Promise((r) => (rec.onstop = r));
  stage.controls.autoRotateSpeed = 0.35;
  btn.classList.remove('rec-on'); btn.textContent = label;
  let blob = new Blob(chunks, { type: mime.split(';')[0] });
  if (!mime.includes('mp4a')) { // make it X-ready (h264 + aac) on the server
    btn.textContent = 'Preparing…';
    const r = await fetch('/api/v1/remux', { method: 'POST', headers: { 'content-type': blob.type }, body: blob }).catch(() => null);
    if (r?.ok) blob = await r.blob();
    btn.textContent = label;
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `lightcue-roadster.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`; a.click();
}
$('rec').onclick = () => recordClip($('rec'));
$('rec-demo').onclick = () => recordClip($('rec-demo'));
$('wl').onsubmit = async (e) => {
  e.preventDefault();
  const r = await fetch('/api/v1/waitlist', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ contact: $('wl-in').value, car: 'roadster' }) });
  const j = await r.json().catch(() => ({}));
  $('msg').textContent = r.ok ? "You're on the Roadster list." : j.error || 'Try again';
  if (r.ok) $('wl').hidden = true;
};
