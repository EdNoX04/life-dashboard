import { render } from './shell.mjs';
import fs from 'node:fs';
import path from 'node:path';

const subjects = ['ans', 'blockchain', 'iot'];
// Defaults to the repo's public/study so `node build.mjs` from tools/study-guide
// rewrites the deployed guides in place. Pass an argument to send them elsewhere.
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const outDir = process.argv[2] || path.resolve(HERE, '../../public/study');
fs.mkdirSync(outDir, { recursive: true });

for (const s of subjects) {
  const mod = (await import(`./data/${s}.mjs`)).default;
  const html = render(mod);
  const file = path.join(outDir, `${s === 'ans' ? 'advanced-network-security'
    : s === 'blockchain' ? 'blockchain'
    : 'iot-system-design'}.html`);
  fs.writeFileSync(file, html);
  // crude sanity: every section id must appear as both a TOC anchor and a target
  const ids = [...html.matchAll(/id="([a-z0-9-]+)"/g)].map(m => m[1]);
  const anchors = [...html.matchAll(/href="#([a-z0-9-]+)"/g)].map(m => m[1]);
  const orphan = anchors.filter(a => !ids.includes(a));
  console.log(`${path.basename(file)}  ${(html.length / 1024).toFixed(0)}KB  sections:${mod.sections.length}  cards:${(html.match(/class="card/g)||[]).length}  broken-anchors:${orphan.length}${orphan.length?' ['+orphan.join(',')+']':''}`);
}
