// Show jobs: audio in → analysis → choreography → pack. In-process queue, results on disk under data/jobs/<id>.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { zipSync } from 'fflate';
import { analyze, buildPack, safeName, SAFE_IN } from '../engine/pack.js';
import { choreographFleet, MODELS, PALETTES, directRules, liftoffWindow } from '../engine/choreo.js';
import { writeFseq, validateFseq } from '../engine/fseq.js';
import { GALLERY, VARIANTS, variantFor, artPath, compose } from '../engine/wraps.js';

const run = promisify(execFile);
export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
export const JOBS = path.join(ROOT, 'data', 'jobs');
fs.mkdirSync(JOBS, { recursive: true });

export const VIBES = ['smooth', 'party', 'insane'];
export const CLOSURE_MODES = ['all', 'safe', 'none'];
const MAX_CARS = 12;

export function cleanOpts(o = {}) {
  const cars = Array.isArray(o.cars) && o.cars.length ? o.cars.slice(0, MAX_CARS) : [o.model || 'modely'];
  for (const c of cars) if (!MODELS[c]) throw new Error(`unknown car "${c}" (use ${Object.keys(MODELS).join(', ')})`);
  if (cars.includes('roadster') && cars.length > 1) throw new Error('the Roadster preview is single-car only');
  const vibe = VIBES.includes(o.vibe) ? o.vibe : 'party';
  const palette = PALETTES[o.palette] ? o.palette : 'neon';
  const closures = CLOSURE_MODES.includes(o.closures) ? o.closures : 'all';
  const title = String(o.title || 'lightshow').slice(0, 60);
  if (o.wrap && o.wrap !== 'none' && !GALLERY[o.wrap]) throw new Error(`unknown wrap "${o.wrap}" (use ${Object.keys(GALLERY).join(', ')})`);
  const wrap = GALLERY[o.wrap] ? o.wrap : null;
  const wrapVariant = wrap && typeof o.wrapVariant === 'string' ? o.wrapVariant.slice(0, 40) : null;
  return { cars, vibe, palette, closures, title, wrap, wrapVariant, seed: Number.isInteger(o.seed) ? o.seed : 1 };
}

const jobs = new Map(); // id → public status
const queue = [];
let active = 0;
const CONCURRENCY = 4;

export const newId = () => crypto.randomBytes(9).toString('base64url');
export const jobDir = (id) => path.join(JOBS, id.replace(/[^\w-]/g, ''));

export function getJob(id) {
  if (jobs.has(id)) return jobs.get(id);
  const f = path.join(jobDir(id), 'job.json');
  if (fs.existsSync(f)) { const j = JSON.parse(fs.readFileSync(f, 'utf8')); jobs.set(id, j); return j; }
  return null;
}

/** audioPath is a file already inside the job dir. */
const MAX_QUEUE = 60, MAX_DISK = 6e9;
let diskBytes = 0, diskAt = 0;
function diskUsed() {
  if (Date.now() - diskAt < 30e3) return diskBytes;
  let n = 0;
  for (const id of fs.readdirSync(JOBS)) for (const f of fs.readdirSync(path.join(JOBS, id), { withFileTypes: true })) if (f.isFile()) n += fs.statSync(path.join(JOBS, id, f.name)).size;
  diskAt = Date.now(); return (diskBytes = n);
}
/** throws when the service is saturated (checked before accepting an upload) */
export function capacity() {
  if (queue.length >= MAX_QUEUE) throw new Error('busy right now, try again in a minute');
  if (diskUsed() > MAX_DISK) throw new Error('storage is full right now, try again later');
}

export function submit(id, audioPath, opts, meta = {}) {
  capacity();
  const j = { id, status: 'queued', created: Date.now(), opts, meta, position: queue.length + active };
  jobs.set(id, j);
  queue.push(() => work(j, audioPath));
  pump();
  return j;
}

function pump() {
  while (active < CONCURRENCY && queue.length) {
    const fn = queue.shift(); active++;
    fn().finally(() => { active--; pump(); });
  }
}

function save(j) { fs.writeFileSync(path.join(jobDir(j.id), 'job.json'), JSON.stringify(j)); }

async function work(j, audioPath) {
  const dir = jobDir(j.id);
  try {
    j.status = 'analyzing'; save(j);
    const a = await analyze(audioPath);
    if (a.duration < 5) throw new Error('song is shorter than 5 seconds');
    if (a.duration > 15 * 60) throw new Error('song is longer than 15 minutes');
    fs.writeFileSync(path.join(dir, 'analysis.json'), JSON.stringify(a));
    j.status = 'choreographing'; save(j);
    const o = j.opts;
    const plan = directRules(a, { vibe: o.vibe });
    const name = safeName(o.title);
    // preview audio (small mp3 for the web player)
    await run('ffmpeg', ['-v', 'error', '-nostdin', '-y', ...SAFE_IN, '-i', audioPath, '-ac', '2', '-ar', '44100', '-b:a', '128k', path.join(dir, 'preview.mp3')], { timeout: 180e3 });
    const wrapFor = async (car) => (o.wrap ? compose(artPath(o.wrap), variantFor(car, o.wrapVariant)) : null);
    if (o.cars[0] === 'roadster') {
      // preview only: no USB pack until Tesla publishes the Roadster's light-show format
      const shows = choreographFleet(a, ['roadster'], { vibe: o.vibe, palette: o.palette, closures: 'none', seed: o.seed, plan });
      const buf = writeFseq(shows[0].frames, { media: `${name}.wav` });
      fs.writeFileSync(path.join(dir, 'car0.fseq'), buf);
      j.cars = [{ model: 'roadster', notes: ['preview: lights + liftoff at the drop'], validation: validateFseq(buf) }];
      j.previewOnly = true;
    } else if (o.cars.length === 1) {
      const r = await buildPack({ audioPath, title: o.title, model: o.cars[0], vibe: o.vibe, palette: o.palette, closures: o.closures, seed: o.seed, analysis: a, plan, outDir: dir, wrapPng: await wrapFor(o.cars[0]) });
      fs.copyFileSync(path.join(dir, 'usb', 'LightShow', `${name}.fseq`), path.join(dir, 'car0.fseq'));
      j.cars = [{ model: o.cars[0], notes: r.show.notes, validation: r.validation }];
      j.zip = path.basename(r.zipPath);
    } else {
      // fleet: one folder per car, each its own USB root
      const shows = choreographFleet(a, o.cars, { vibe: o.vibe, palette: o.palette, closures: o.closures, seed: o.seed, plan });
      const wav = path.join(dir, 'show.wav');
      await run('ffmpeg', ['-v', 'error', '-nostdin', '-y', ...SAFE_IN, '-i', audioPath, '-ar', '44100', '-ac', '2', '-c:a', 'pcm_s16le', wav], { timeout: 180e3 });
      const wavBytes = new Uint8Array(fs.readFileSync(wav));
      const files = {};
      j.cars = shows.map((s, i) => {
        const buf = writeFseq(s.frames, { media: `${name}.wav` });
        const v = validateFseq(buf);
        if (!v.ok) throw new Error(`car ${i + 1} failed validation: ${v.errors.join('; ')}`);
        fs.writeFileSync(path.join(dir, `car${i}.fseq`), buf);
        const folder = `Car_${i + 1}_${MODELS[s.model].name.replace(/\s/g, '')}`;
        files[`${folder}/LightShow/${name}.fseq`] = new Uint8Array(buf);
        files[`${folder}/LightShow/${name}.wav`] = wavBytes;
        return { model: s.model, notes: s.notes, validation: v };
      });
      if (o.wrap) for (let i = 0; i < o.cars.length; i++) {
        const folder = `Car_${i + 1}_${MODELS[o.cars[i]].name.replace(/\s/g, '')}`;
        files[`${folder}/Wraps/${GALLERY[o.wrap].replace(/\s/g, '_')}.png`] = new Uint8Array(await wrapFor(o.cars[i]));
      }
      files['README.txt'] = new TextEncoder().encode([
        `${o.title}: synchronized show for ${o.cars.length} cars`, '',
        'Each Car_N folder is the root of one USB drive (exFAT/FAT32). Copy the LightShow folder inside it to that car\'s drive.',
        'Park the cars in order (Car 1 on the left as you face them, then Car 2, ...).',
        'On every car: Toybox > Light Show > pick the show > schedule the SAME start time (up to 10 minutes ahead) > Confirm.',
        'Tesla clocks are network-synced, so the cars start together.',
      ].join('\r\n'));
      j.zip = `${name}-fleet.zip`;
      fs.writeFileSync(path.join(dir, j.zip), zipSync(files, { level: 0 }));
      fs.rmSync(wav, { force: true });
    }
    j.analysis = { bpm: a.bpm, duration: a.duration, liftoff: liftoffWindow(a), sections: a.sections.map((s, i) => ({ start: s.start, end: s.end, level: s.level, drop: s.drop, mood: plan.sections[i].mood })) };
    j.name = name;
    j.status = 'done'; j.finished = Date.now();
    fs.rmSync(path.join(dir, 'usb'), { recursive: true, force: true });
    fs.rmSync(audioPath, { force: true }); // keep only what we serve: preview mp3, fseq, zip
  } catch (e) {
    j.status = 'failed'; j.error = String(e.message || e).slice(0, 300);
  }
  save(j);
}

// cleanup: jobs older than 7 days
export function sweep(maxAgeMs = 7 * 864e5) {
  for (const id of fs.readdirSync(JOBS)) {
    const d = path.join(JOBS, id);
    try { if (Date.now() - fs.statSync(d).mtimeMs > maxAgeMs) { fs.rmSync(d, { recursive: true, force: true }); jobs.delete(id); } } catch {}
  }
}
