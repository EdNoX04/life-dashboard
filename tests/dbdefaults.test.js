// The empty diary that was not empty.
//
// The Media tab showed "0 viewings on record" while Supabase held 58. Nothing
// errored on screen and the workflow logs were green, so every check pointed at
// the import — which was fine.
//
// The cause: `list()` defaults to `order=created_at`, the `memory` table has no
// such column, and PostgREST rejects the WHOLE query with a 400 rather than
// ignoring the order. Every long-standing caller passed `order: 'key'`, which
// made the workaround look like a style preference instead of a requirement, so
// three new calls omitted it. A `.catch(() => {})` then turned the rejection
// into an empty array, and an empty array reads as "you have watched nothing".
//
// Two lessons, both tested here: the default has to be right per table, and a
// failed read must never be indistinguishable from an empty one.

import { readFileSync } from 'fs';

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; } else { fail++; console.log('FAIL ' + name); } };
const eq = (a, b, name) => ok(a === b, `${name} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const db = readFileSync(new URL('../src/lib/db.js', import.meta.url), 'utf8');

// ------------------------------------------------------- the default itself

ok(/DEFAULT_ORDER\s*=\s*\{[^}]*memory:\s*'key'/.test(db),
  'the memory table has its own default order — it has no created_at column');
ok(/order = DEFAULT_ORDER\[table\]/.test(db),
  'and list() uses the per-table default rather than a single global one');

// ------------------------------------------- no memory read may go unordered

// Any call that leaves the order to chance is a 400 waiting to happen. This
// scans the source because the failure is invisible at runtime — it produces an
// empty array, not an exception anyone sees.
const sources = [
  'src/tabs/Movies.jsx', 'src/tabs/Money.jsx', 'src/lib/advisor.js',
  'src/lib/portfolioHistory.js', 'src/lib/ai.js', 'src/lib/db.js',
];

let checked = 0;
for (const f of sources) {
  const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
  // Each list('memory', { ... }) call with its options object. Matched to the
  // brace that CLOSES the call rather than the first brace seen — advisor.js
  // uses a `key=eq.${key}` template literal, whose own closing brace would end
  // a naive match early and report a false failure. (It did, first run.)
  const calls = src.match(/list\(\s*'memory'\s*,\s*\{[\s\S]*?\}\s*\)/g) || [];
  for (const c of calls) {
    checked++;
    ok(/order\s*:/.test(c), `${f}: every memory read names its order — ${c.slice(0, 60)}…`);
  }
}
ok(checked > 0, 'the scan actually found memory reads to check');

// --------------------------------------------- a failed read is not empty data

// The three media reads must surface their failure rather than swallowing it.
// `.catch(() => {})` is the exact shape that hid this for a whole build.
const movies = readFileSync(new URL('../src/tabs/Movies.jsx', import.meta.url), 'utf8');
const swallowed = (movies.match(/\.catch\(\(\)\s*=>\s*\{\s*\}\)/g) || []).length;
eq(swallowed, 0,
  'no read in the media tab discards its error — an ignored 400 becomes "you have watched nothing"');
ok(/setLoadErr/.test(movies), 'and a failed load is put on screen');
ok(/that is this error, not an empty diary/.test(movies),
  'in words that distinguish a broken read from genuinely having no data');

console.log(`${pass}/${pass + fail} passing`);
if (fail) process.exit(1);
