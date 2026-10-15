// Public REST API (v1). The website and the MCP server both go through these same functions.
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
import { submit, getJob, jobDir, newId, cleanOpts, capacity, ROOT, VIBES, CLOSURE_MODES } from './jobs.js';
import { MODELS, PALETTES } from '../engine/choreo.js';
import { validateFseq } from '../engine/fseq.js';
import { fetchToFile } from './fetchsafe.js';
import { GALLERY, VARIANTS } from '../engine/wraps.js';

const AUDIO_TYPES = /^(audio\/|application\/octet-stream|video\/mp4)/;
const SITE = (process.env.SITE_URL || 'http://localhost:3150').replace(/\/+$/, '');
const API_KEYS = new Set((process.env.API_KEYS || '').split(',').map((s) => s.trim()).filter(Boolean));

// fixed-window rate limit per caller
const hits = new Map();
export function limited(key, max, windowMs) {
  const now = Date.now(), h = hits.get(key);
  if (!h || now - h.t > windowMs) { hits.set(key, { t: now, n: 1 }); return false; }
  return ++h.n > max;
}
setInterval(() => { const now = Date.now(); for (const [k, h] of hits) if (now - h.t > 3600e3) hits.delete(k); }, 600e3).unref();

export const ipOf = (q) => (q.headers['x-forwarded-for'] || '').split(',').pop().trim() || q.socket.remoteAddress;
export const callerOf = (q) => {
  const k = q.headers['x-api-key'];
  return k && API_KEYS.has(k) ? { id: 'key:' + k.slice(0, 8), max: 500 } : { id: 'ip:' + ipOf(q), max: 20 };
};

export function catalog() {
  return {
    cars: Object.entries(MODELS).map(([id, m]) => ({ id, name: m.name, closures: m.closures, lightBars: !!m.bars, previewOnly: !!m.preview })),
    vibes: VIBES, palettes: Object.keys(PALETTES), closures: CLOSURE_MODES,
    wraps: Object.entries(GALLERY).map(([id, name]) => ({ id, name, preview: `${SITE}/wraps/${id}.jpg` })),
    wrapVariants: Object.fromEntries(Object.entries(VARIANTS).map(([car, v]) => [car, v.map(([id, name]) => ({ id, name }))])),
    limits: { maxCars: 12, maxSongMinutes: 15, maxAudioMB: 40 },
  };
}

export function publicJob(j) {
  if (!j) return null;
  const base = `${SITE}/api/v1/shows/${j.id}`;
  const out = { id: j.id, status: j.status, title: j.opts.title, cars: j.opts.cars, vibe: j.opts.vibe, palette: j.opts.palette, closures: j.opts.closures, wrap: j.opts.wrap, wrapVariant: j.opts.wrapVariant, created: j.created };
  if (j.status === 'failed') out.error = j.error;
  if (j.status === 'done') {
    out.analysis = j.analysis;
    out.notes = j.cars.map((c) => c.notes);
    out.validation = j.cars.map((c) => ({ ok: c.validation.ok, frames: c.validation.stats.frames, duration: c.validation.stats.duration, warnings: c.validation.warnings }));
    out.download = j.previewOnly ? null : `${base}/download`;
    if (j.previewOnly) out.previewOnly = 'The Roadster has no public light-show format yet: this is a preview to watch and record. Join the list at /api/v1/waitlist.';
    out.preview = { page: `${SITE}/s/${j.id}`, audio: `${base}/audio.mp3`, fseq: j.cars.map((_, i) => `${base}/car/${i}.fseq`) };
  }
  return out;
}

/** Start a show from a local file already moved into the job dir. */
export function startShow(id, file, rawOpts, meta) {
  const opts = cleanOpts(rawOpts);
  return submit(id, file, opts, meta);
}

export async function startShowFromUrl(url, rawOpts, meta) {
  const opts = cleanOpts(rawOpts); // validate before downloading anything
  capacity();
  const id = newId();
  fs.mkdirSync(jobDir(id), { recursive: true });
  const file = path.join(jobDir(id), 'input');
  try { await fetchToFile(url, file); } catch (e) { fs.rmSync(jobDir(id), { recursive: true, force: true }); throw e; }
  return submit(id, file, opts, meta);
}

export function apiRouter() {
  const r = express.Router();
  r.get('/v1', (_q, s) => s.json({ name: 'lightcue', version: 1, docs: `${SITE}/docs`, mcp: `${SITE}/mcp`, ...catalog() }));
  r.get('/v1/catalog', (_q, s) => s.json(catalog()));

  // create a show: raw audio body (content-type audio/*) with options in the query, or JSON { audio_url, ...options }
  r.post('/v1/shows', express.json({ limit: '32kb' }), express.raw({ type: (q) => AUDIO_TYPES.test(q.headers['content-type'] || ''), limit: '40mb' }), async (q, s) => {
    const who = callerOf(q);
    if (limited('show:' + who.id, who.max, 3600e3)) return s.status(429).json({ error: 'rate limit: too many shows this hour' });
    try {
      if (Buffer.isBuffer(q.body)) {
        if (q.body.length < 1000) return s.status(400).json({ error: 'audio body is empty' });
        const o = { ...q.query, model: q.query.car || q.query.model, cars: q.query.cars ? String(q.query.cars).split(',') : undefined, seed: q.query.seed ? Number(q.query.seed) : undefined };
        cleanOpts(o); capacity();
        const id = newId();
        fs.mkdirSync(jobDir(id), { recursive: true });
        const file = path.join(jobDir(id), 'input');
        fs.writeFileSync(file, q.body);
        return s.status(202).json(publicJob(startShow(id, file, o, { via: 'upload', who: who.id })));
      }
      const b = q.body || {};
      if (!b.audio_url) return s.status(400).json({ error: 'send an audio file as the body (content-type audio/*), or JSON with audio_url' });
      const j = await startShowFromUrl(b.audio_url, b, { via: 'url', who: who.id });
      s.status(202).json(publicJob(j));
    } catch (e) { s.status(400).json({ error: e.message }); }
  });

  r.get('/v1/shows/:id', (q, s) => {
    const j = getJob(q.params.id);
    if (!j) return s.status(404).json({ error: 'not found' });
    s.set('cache-control', 'no-store').json(publicJob(j));
  });
  const fileOf = (q, s, f, type) => {
    const j = getJob(q.params.id);
    if (!j || j.status !== 'done') return s.status(404).json({ error: 'not ready' });
    const p = path.join(jobDir(j.id), f(j));
    if (!fs.existsSync(p)) return s.status(404).json({ error: 'expired' });
    if (type) s.type(type);
    return p;
  };
  r.get('/v1/shows/:id/download', (q, s) => { const p = fileOf(q, s, (j) => j.zip); if (typeof p === 'string') s.download(p); });
  r.get('/v1/shows/:id/analysis.json', (q, s) => { const p = fileOf(q, s, () => 'analysis.json', 'application/json'); if (typeof p === 'string') s.set('cache-control', 'public, max-age=86400').sendFile(p); });
  r.get('/v1/shows/:id/audio.mp3', (q, s) => { const p = fileOf(q, s, () => 'preview.mp3', 'audio/mpeg'); if (typeof p === 'string') s.set('cache-control', 'public, max-age=86400').sendFile(p); });
  r.get('/v1/shows/:id/car/:n.fseq', (q, s) => {
    const n = Number(q.params.n);
    const p = fileOf(q, s, (j) => (Number.isInteger(n) && n >= 0 && n < j.cars.length ? `car${n}.fseq` : 'nope'), 'application/octet-stream');
    if (typeof p === 'string') s.set('cache-control', 'public, max-age=86400').sendFile(p);
  });

  // turn a recorded clip (webm / mp4-opus) into an X-ready mp4 (h264 + aac)
  r.post('/v1/remux', express.raw({ type: () => true, limit: '40mb' }), async (q, s) => {
    if (limited('mux:' + ipOf(q), 30, 3600e3)) return s.status(429).json({ error: 'rate limit' });
    if (!Buffer.isBuffer(q.body) || q.body.length < 1000) return s.status(400).json({ error: 'send the clip as the body' });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lcmux-'));
    try {
      const inp = path.join(dir, 'in'), out = path.join(dir, 'out.mp4');
      fs.writeFileSync(inp, q.body);
      const vcopy = String(q.headers['content-type'] || '').includes('mp4');
      await run('ffmpeg', ['-v', 'error', '-nostdin', '-y', '-protocol_whitelist', 'file', '-format_whitelist', 'mov,mp4,m4a,matroska,webm', '-i', inp, '-t', '60',
        ...(vcopy ? ['-c:v', 'copy'] : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p']), '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out], { timeout: 120e3 });
      s.type('video/mp4').send(fs.readFileSync(out));
    } catch { s.status(400).json({ error: 'could not convert the clip' }); }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  // Roadster waitlist: an email or an X handle
  r.post('/v1/waitlist', express.json({ limit: '4kb' }), (q, s) => {
    if (limited('wl:' + ipOf(q), 5, 864e5)) return s.status(429).json({ error: 'already on the list' });
    const c = String(q.body?.contact || '').trim().slice(0, 120);
    const ok = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(c) || /^@?[A-Za-z0-9_]{2,15}$/.test(c);
    if (!ok) return s.status(400).json({ error: 'enter an email or an X handle' });
    fs.appendFileSync(path.join(ROOT, 'data', 'waitlist.jsonl'), JSON.stringify({ contact: c, car: String(q.body?.car || 'roadster').slice(0, 20), at: Date.now() }) + '\n');
    s.json({ ok: true });
  });

  // validate any .fseq (Tesla's rules + closure limits)
  r.post('/v1/validate', express.raw({ type: () => true, limit: '20mb' }), (q, s) => {
    const who = callerOf(q);
    if (limited('val:' + who.id, who.max * 5, 3600e3)) return s.status(429).json({ error: 'rate limit' });
    if (!Buffer.isBuffer(q.body) || q.body.length < 32) return s.status(400).json({ error: 'send the .fseq file as the request body' });
    try { s.json(validateFseq(q.body)); } catch (e) { s.status(400).json({ ok: false, errors: ['could not read the file: ' + e.message] }); }
  });
  return r;
}
