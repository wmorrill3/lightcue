// Downloads Tesla's official wrap templates (github.com/teslamotors/custom-wraps) into engine/wraps/.
// They are Tesla's files, so they are fetched at setup instead of being bundled in this repo.
import fs from 'node:fs';
import path from 'node:path';
import { VARIANTS } from '../engine/wraps.js';

const BASE = 'https://raw.githubusercontent.com/teslamotors/custom-wraps/master';
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'engine', 'wraps');
fs.mkdirSync(OUT, { recursive: true });

const ids = Object.values(VARIANTS).flat().map(([id]) => id);
let failed = 0;
for (const id of ids) {
  const file = path.join(OUT, `${id}.png`);
  if (fs.existsSync(file) && !process.argv.includes('--force')) { console.log(`  ok    ${id} (cached)`); continue; }
  const r = await fetch(`${BASE}/${id}/template.png`);
  if (!r.ok) { console.error(`  FAIL  ${id}: HTTP ${r.status}`); failed++; continue; }
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  console.log(`  got   ${id}`);
}
console.log(failed ? `${failed} template(s) missing: wraps for those bodies will be skipped.` : `${ids.length} wrap templates ready in engine/wraps/`);
process.exitCode = failed ? 1 : 0;
