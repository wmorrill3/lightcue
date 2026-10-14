// node engine/cli.js <audio> [model] [vibe] [palette] → data/out/<name>/<name>.zip
import path from 'node:path';
import { buildPack } from './pack.js';

const [audio, model = 'modely', vibe = 'party', palette = 'neon'] = process.argv.slice(2);
const title = path.basename(audio).replace(/\.[^.]+$/, '');
const t = Date.now();
const r = await buildPack({ audioPath: audio, title, model, vibe, palette, closures: 'all', seed: 7, outDir: path.resolve('data/out', title + '-' + model) });
console.log(JSON.stringify({ zip: r.zipPath, bpm: r.analysis.bpm, sections: r.show.plan.sections.map((s) => s.mood).join(' '), notes: r.show.notes, validation: r.validation, chimeAt: r.chimeAt, ms: Date.now() - t }, null, 1));
