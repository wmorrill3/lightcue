import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import { apiRouter } from './api.js';
import { handleMcp } from './mcp.js';
import { sweep, ROOT } from './jobs.js';

const PORT = Number(process.env.PORT || 3150);
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', false);

app.use('/api', apiRouter());
app.post('/mcp', express.json({ limit: '256kb' }), (q, s) => handleMcp(q, s).catch((e) => { console.error('mcp', e); if (!s.headersSent) s.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'internal error' }, id: null }); }));
app.all('/mcp', (q, s) => handleMcp(q, s));
app.get('/health', (_q, s) => s.json({ ok: true }));

const DIST = path.join(ROOT, 'web', 'dist');
app.use('/wraps', express.static(path.join(ROOT, 'engine', 'wrap-art'), { maxAge: '7d' }));
app.use(express.static(DIST, { maxAge: '1h', setHeaders: (res, p) => { if (p.endsWith('.html')) res.setHeader('cache-control', 'no-cache'); } }));
// SPA routes: /s/<id> (a show's preview page), /docs, /studio
app.get(/^\/(s\/[\w-]+|docs|studio)\/?$/, (_q, s) => {
  const f = path.join(DIST, 'index.html');
  fs.existsSync(f) ? s.sendFile(f) : s.status(503).send('building');
});

app.use((err, _q, s, _n) => {
  if (err?.type === 'entity.too.large') return s.status(413).json({ error: 'file too large (max 40 MB)' });
  console.error(err);
  s.status(500).json({ error: 'server error' });
});

sweep(); setInterval(sweep, 3600e3).unref();
app.listen(PORT, '127.0.0.1', () => console.log(`showpack on ${PORT}`));
