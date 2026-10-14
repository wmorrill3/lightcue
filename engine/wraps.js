// Wrap gallery + Tesla's per-variant templates. compose() fits artwork into a template (engine/wrap.py).
import path from 'node:path';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const HERE = path.dirname(new URL(import.meta.url).pathname);

export const GALLERY = {
  aurora: 'Aurora', chrome: 'Liquid Chrome', synth: 'Synthwave', sakura: 'Sakura', carbon: 'Carbon Gold', lava: 'Lava',
};
// Tesla publishes one template per body variant (github.com/teslamotors/custom-wraps)
export const VARIANTS = {
  modely: [['modely', '2020–2024'], ['modely-2025-base', '2025+ Standard'], ['modely-2025-premium', '2025+ Premium'], ['modely-2025-performance', '2025+ Performance'], ['modely-l', 'Model Y L']],
  model3: [['model3', '2017–2023'], ['model3-2024-base', '2024+'], ['model3-2024-performance', '2024+ Performance']],
  models: [['models-2021', '2021–2024'], ['models-2025-plaid', '2025+ Plaid']],
  modelx: [['modelx-2021', '2021+']],
  cybertruck: [['cybertruck', 'Cybertruck']],
};
export const variantFor = (car, v) => (VARIANTS[car].find(([id]) => id === v) || VARIANTS[car][0])[0];
export const artPath = (id) => {
  if (GALLERY[id]) return path.join(HERE, 'wrap-art', `${id}.jpg`);
  return null;
};

/** → PNG Buffer (≤ 1 MB) for this car variant */
export async function compose(art, variant) {
  const tpl = path.join(HERE, 'wraps', `${variant}.png`);
  if (!fs.existsSync(tpl)) throw new Error(`no wrap template for ${variant}`);
  const out = path.join(fs.mkdtempSync('/tmp/lcw-'), 'w.png');
  try {
    await run('python3', ['-I', path.join(HERE, 'wrap.py'), art, tpl, out], { timeout: 60e3 });
    return fs.readFileSync(out);
  } finally { fs.rmSync(path.dirname(out), { recursive: true, force: true }); }
}
