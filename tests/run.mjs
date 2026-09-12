// Run the whole suite.
//
// Until this file existed there were 91 test files in this directory and no way
// to run them together. The cost of that was not theoretical: FIVE of them had
// been failing to even start — they import `bun:test`, node cannot load it, and
// nothing was watching — so their assertions had silently counted for nothing
// for weeks. A suite nobody runs is documentation with a false badge on it.
//
// Two dialects live here, which is a fact rather than a plan:
//
//   node  — a hand-rolled `ok()/eq()` counter that prints "N passed, M failed"
//           and exits non-zero. 80-odd files. No dependencies, runs anywhere.
//   bun   — `import { test, expect } from 'bun:test'`, plus every .test.jsx
//           file, which needs JSX compiled before it can run at all.
//
// The rule this runner holds to: a test that could not RUN is reported as
// loudly as a test that failed, and never as a pass. Skipping quietly is how
// five files went dark in the first place.
//
//   node tests/run.mjs            everything it can run
//   node tests/run.mjs money      only files whose name contains "money"

import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url));
const filter = process.argv[2] || '';

const needsBun = f =>
  f.endsWith('.jsx') || /from\s+['"]bun:test['"]/.test(readFileSync(join(DIR, f), 'utf8'));

const hasBun = spawnSync('bun', ['--version'], { encoding: 'utf8' }).status === 0;

const files = readdirSync(DIR)
  .filter(f => /\.test\.(js|jsx)$/.test(f))
  .filter(f => !filter || f.includes(filter))
  .sort();

if (!files.length) {
  console.error(filter ? `No test file matches "${filter}".` : 'No test files found.');
  process.exit(1);
}

let assertions = 0, failed = [], skipped = [], ran = 0;
const t0 = Date.now();

for (const f of files) {
  const bun = needsBun(f);
  if (bun && !hasBun) { skipped.push(f); continue; }
  const cmd = bun ? ['bun', ['test', join(DIR, f)]] : ['node', [join(DIR, f)]];
  const r = spawnSync(cmd[0], cmd[1], { encoding: 'utf8' });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  // Both dialects are counted, so the total is the real total: the node files
  // print "N passed, M failed"; bun prints "N pass".
  const n = Number(/(\d+)\s+pass(?:ed)?/.exec(out)?.[1] || 0);
  assertions += n;
  ran++;
  if (r.status !== 0) {
    failed.push({ f, out: out.trim() });
    console.log(`✗ ${f.padEnd(34)} ${n || '—'}`);
  } else {
    console.log(`· ${f.padEnd(34)} ${n}`);
  }
}

console.log(`\n${ran} file(s), ${assertions} assertion(s), ${((Date.now() - t0) / 1000).toFixed(1)}s`);

// A file that could not run is named every time. It is not a pass and it is not
// nothing: it is a test whose result is unknown, which is the state this runner
// exists to make impossible to ignore.
if (skipped.length) {
  console.log(`\n${skipped.length} file(s) NOT RUN — they need bun, which is not installed here:`);
  for (const f of skipped) console.log(`  · ${f}`);
  console.log('  install it (curl -fsSL https://bun.sh/install | bash) or port them to the node dialect.');
}

if (failed.length) {
  console.log(`\n${failed.length} FAILING:`);
  for (const { f, out } of failed) {
    console.log(`\n--- ${f} ---`);
    console.log(out.split('\n').filter(l => /FAIL|Error|passed,/.test(l)).slice(0, 12).join('\n') || out.slice(0, 600));
  }
  process.exit(1);
}
console.log('\nall green');
