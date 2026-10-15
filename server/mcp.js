// MCP server (streamable HTTP, stateless): any AI agent can make Tesla light shows through these tools.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { catalog, publicJob, startShowFromUrl, limited, callerOf } from './api.js';
import { getJob } from './jobs.js';
import { validateFseq } from '../engine/fseq.js';
import { fetchToFile } from './fetchsafe.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const text = (o) => ({ content: [{ type: 'text', text: typeof o === 'string' ? o : JSON.stringify(o, null, 1) }] });

function build(q) {
  const s = new McpServer({ name: 'lightcue', version: '1.0.0' }, {
    instructions: 'Make custom Tesla light shows from any song. Call list_options, then create_light_show with an https audio_url; poll get_light_show until status is "done", then give the user the download link (a zip they copy to a USB drive) and the preview page.',
  });
  const cars = z.enum(['model3', 'modely', 'models', 'modelx', 'cybertruck', 'roadster']);
  s.tool('list_options', 'Cars, vibes, colour palettes and closure modes the show generator supports.', {}, async () => text(catalog()));
  s.tool('create_light_show', 'Choreograph a Tesla light show to a song. Returns a job id; poll get_light_show. One car, or a synchronized show for up to 12 cars.', {
    audio_url: z.string().url().describe('https link to an mp3/wav/m4a/flac file (max 40 MB, max 15 minutes)'),
    title: z.string().max(60).optional().describe('show name, used for the file names'),
    car: cars.optional().describe('the car for a single-car show (default modely)'),
    cars: z.array(cars).max(12).optional().describe('for a multi-car show: one entry per car, in parking order left to right'),
    vibe: z.enum(['smooth', 'party', 'insane']).optional(),
    palette: z.enum(['neon', 'sunset', 'ice', 'forest', 'mono', 'inferno', 'candy']).optional().describe('interior light colours'),
    closures: z.enum(['all', 'safe', 'none']).optional().describe('all = doors/liftgate/windows/mirrors/charge port move; safe = only windows, mirrors, charge port; none = lights only'),
    wrap: z.enum(['none', 'aurora', 'chrome', 'synth', 'sakura', 'carbon', 'lava']).optional().describe('add a Paint Shop wrap to the pack'),
    wrap_variant: z.string().max(40).optional().describe('exact body variant for the wrap template, from list_options wrapVariants (e.g. modely-2025-premium)'),
  }, async (a) => {
    const who = callerOf(q);
    if (limited('show:' + who.id, who.max, 3600e3)) return text({ error: 'rate limit: too many shows this hour' });
    try {
      const j = await startShowFromUrl(a.audio_url, { ...a, model: a.car, wrapVariant: a.wrap_variant }, { via: 'mcp', who: who.id });
      return text(publicJob(j));
    } catch (e) { return text({ error: e.message }); }
  });
  s.tool('get_light_show', 'Status of a light show job. When done: download link (USB zip), preview page, song analysis, notes.', { id: z.string().max(40) }, async ({ id }) => {
    const j = getJob(id);
    return text(j ? publicJob(j) : { error: 'not found' });
  });
  s.tool('validate_fseq', 'Check an existing .fseq light show against Tesla\'s rules (format, duration, closure command limits).', { fseq_url: z.string().url() }, async ({ fseq_url }) => {
    const who = callerOf(q);
    if (limited('val:' + who.id, who.max * 5, 3600e3)) return text({ error: 'rate limit' });
    const tmp = path.join(os.tmpdir(), 'sp-' + Math.random().toString(36).slice(2));
    try { await fetchToFile(fseq_url, tmp, 20e6); return text(validateFseq(fs.readFileSync(tmp))); } catch (e) { return text({ ok: false, errors: [e.message] }); } finally { fs.rmSync(tmp, { force: true }); }
  });
  return s;
}

export async function handleMcp(q, s) {
  if (q.method !== 'POST') return s.status(405).set('allow', 'POST').json({ jsonrpc: '2.0', error: { code: -32000, message: 'use POST (stateless streamable HTTP)' }, id: null });
  const server = build(q);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  s.on('close', () => { transport.close(); server.close(); });
  await server.connect(transport);
  await transport.handleRequest(q, s, q.body);
}
