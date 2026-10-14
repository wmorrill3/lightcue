// Build a USB-ready pack: LightShow/<name>.fseq + .wav, LockChime.wav, Wraps/<name>.png, README.txt → zip.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { zipSync } from 'fflate';
import { choreograph } from './choreo.js';
import { writeFseq, validateFseq } from './fseq.js';
import { FPS } from './channels.js';

const run = promisify(execFile);
// untrusted uploads: audio demuxers only, local file only (no HLS/concat playlists reaching other files or URLs)
export const SAFE_IN = ['-protocol_whitelist', 'file', '-format_whitelist', 'mp3,wav,flac,ogg,mov,mp4,m4a,aac,matroska,webm,aiff,w64'];
const HERE = path.dirname(new URL(import.meta.url).pathname);

export const safeName = (s) => (String(s || 'lightshow').normalize('NFKD').replace(/[^\w -]/g, '').replace(/\s+/g, '_').replace(/^_+|_+$/g, '').slice(0, 28) || 'lightshow');

export async function analyze(audioPath) {
  try {
    const { stdout } = await run('python3', ['-I', path.join(HERE, 'analyze.py'), audioPath], { maxBuffer: 256 * 1024 * 1024, timeout: 180e3 });
    return JSON.parse(stdout);
  } catch { throw new Error('could not read that audio file (use mp3, wav, m4a, flac or ogg)'); }
}

async function toWav(src, dst, extra = []) {
  await run('ffmpeg', ['-v', 'error', '-nostdin', '-y', ...SAFE_IN, '-i', src, ...extra, '-ar', '44100', '-c:a', 'pcm_s16le', dst], { timeout: 180e3 });
}

/** Pick the hook: the strongest kick/downbeat inside the biggest section → a 2 s cut with fades, mono, < 1 MB. */
export function chimeStart(a) {
  const secs = a.sections.slice().sort((x, y) => y.energy - x.energy);
  const s = secs[0] || { f0: 0, f1: a.frames };
  const downs = a.downbeats.filter((d) => d >= s.f0 && d < s.f1 - 2 * FPS);
  const best = downs.sort((x, y) => (a.onset[y] || 0) - (a.onset[x] || 0))[0] ?? s.f0;
  return Math.max(0, best / FPS - 0.03);
}

/**
 * opts: { audioPath, title, model, vibe, palette, closures, seed, wrapPng (Buffer|null), analysis (optional), outDir }
 * → { zipPath, name, show, analysis, validation, files }
 */
export async function buildPack(opts) {
  const name = safeName(opts.title);
  const out = opts.outDir;
  fs.mkdirSync(path.join(out, 'usb', 'LightShow'), { recursive: true });
  const a = opts.analysis || (await analyze(opts.audioPath));
  const show = choreograph(a, { model: opts.model, vibe: opts.vibe, palette: opts.palette, closures: opts.closures, seed: opts.seed, plan: opts.plan });
  const fseq = writeFseq(show.frames, { media: `${name}.wav` });
  const validation = validateFseq(fseq);
  if (!validation.ok) throw new Error('show failed validation: ' + validation.errors.join('; '));
  const files = {};
  const showWav = path.join(out, 'usb', 'LightShow', `${name}.wav`);
  await toWav(opts.audioPath, showWav, ['-ac', '2']);
  fs.writeFileSync(path.join(out, 'usb', 'LightShow', `${name}.fseq`), fseq);
  files[`LightShow/${name}.fseq`] = new Uint8Array(fseq);
  files[`LightShow/${name}.wav`] = new Uint8Array(fs.readFileSync(showWav));
  // lock chime
  const t0 = chimeStart(a);
  const chime = path.join(out, 'usb', 'LockChime.wav');
  await toWav(opts.audioPath, chime, ['-ss', t0.toFixed(3), '-t', '2.0', '-ac', '1', '-af', 'afade=t=in:d=0.02,afade=t=out:st=1.65:d=0.35,loudnorm=I=-12:TP=-1']);
  files['LockChime.wav'] = new Uint8Array(fs.readFileSync(chime));
  if (opts.wrapPng) {
    fs.mkdirSync(path.join(out, 'usb', 'Wraps'), { recursive: true });
    fs.writeFileSync(path.join(out, 'usb', 'Wraps', `${name}.png`), opts.wrapPng);
    files[`Wraps/${name}.png`] = new Uint8Array(opts.wrapPng);
  }
  const readme = [
    `${opts.title || name}: your Tesla show pack`,
    '',
    '1. Format a USB drive as exFAT or FAT32 (not NTFS). Remove any TeslaCam folder, map or firmware files.',
    '2. Copy everything in this zip to the ROOT of the drive (keep the folder names exactly).',
    '3. Plug it into the car.',
    '   Light show: Toybox > Light Show > pick the custom show.',
    '   Lock sound: Toybox > Boombox > Lock Sound > USB (cars with the external speaker).',
    '   Wrap: Toybox > Paint Shop > Wraps.',
    '',
    'Park somewhere safe and open before running a show: the doors, windows and mirrors can move.',
    ...show.notes.map((x) => '- ' + x),
  ].join('\r\n');
  files['README.txt'] = new TextEncoder().encode(readme);
  const zipPath = path.join(out, `${name}.zip`);
  fs.writeFileSync(zipPath, zipSync(files, { level: 0 }));
  return { zipPath, name, show, analysis: a, validation, chimeAt: t0 };
}
