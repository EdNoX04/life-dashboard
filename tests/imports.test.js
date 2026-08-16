// Every relative import resolves — case-sensitively.
//
// Written after fourteen hours of red Vercel builds caused by a single capital
// letter. Money.jsx imported './LEDGERDock.jsx'; the file on disk and in git was
// 'LedgerDock.jsx'. macOS is case-INSENSITIVE, so it resolved locally, the dev
// server ran, every test passed, and every transpile check came back clean.
// Vercel builds on Linux, which is case-sensitive, and could not find the module.
//
// The insidious part is that nothing local can catch it by accident: the whole
// toolchain on this machine agrees the import is fine. It has to be checked
// deliberately, by comparing against a directory listing rather than asking the
// filesystem whether the path exists — because asking is exactly what gives the
// wrong answer here.
//
// This is also why a per-file transpile is not a build. esbuild on one file never
// resolves an import; only a real bundle does. The gap between "it transpiles"
// and "it builds" is precisely this class of bug.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, normalize, sep } from 'node:path';

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; } else { fail++; console.log('FAIL ' + name); } };

const ROOT = new URL('../src/', import.meta.url).pathname;

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(jsx?|mjs)$/.test(e)) out.push(p);
  }
  return out;
}

const files = walk(ROOT);
ok(files.length > 20, 'the scan found the source tree');

let checked = 0;
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const here = dirname(file);
  for (const m of src.matchAll(/(?:from|import)\s+['"](\.[^'"]+)['"]/g)) {
    const spec = m[1];
    const target = normalize(join(here, spec));
    const dir = dirname(target);
    const name = target.split(sep).pop();
    checked += 1;

    let listing = [];
    try { listing = readdirSync(dir); } catch { /* missing directory falls through */ }

    // The load-bearing line: `name` must appear in the DIRECTORY LISTING, not
    // merely satisfy existsSync. On a case-insensitive filesystem existsSync
    // says yes to the wrong case, which is the entire bug this file exists for.
    ok(listing.includes(name),
      `${file.replace(ROOT, 'src/')} imports "${spec}" — no file named exactly "${name}" in that directory`);
  }
}
ok(checked > 40, 'and actually checked a meaningful number of imports');

console.log(`${pass}/${pass + fail} passing`);
if (fail) process.exit(1);
