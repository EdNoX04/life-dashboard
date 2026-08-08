// Every file in payloads/ must be something apply-payloads.mjs can actually
// apply. This exists because two files sat there for weeks in the wrong shape:
// the applier destructured them to zero ops, wrote nothing and exited 0, so the
// workflow went green while doing nothing at all. Adding a guard turned that
// silence into a red workflow — correct, and it then failed on EVERY run until
// the files themselves were fixed.
//
// A test is the right place for this because the failure is not in the code. It
// is in data written by hand, and the applier only meets it after a push, a CI
// run and an email.

import { readdirSync, readFileSync } from 'fs';

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; } else { fail++; console.log('FAIL ' + name); } };
const eq = (a, b, name) => ok(a === b, `${name} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const dir = new URL('../payloads/', import.meta.url);
const files = readdirSync(dir).filter(f => f.endsWith('.json'));

ok(files.length > 0, 'there are payloads to check');

// The four methods apply-payloads understands. Anything else is a typo that
// would be discovered in CI rather than here.
const METHODS = new Set(['upsert', 'insert', 'update', 'delete']);

for (const f of files) {
  let doc = null;
  try { doc = JSON.parse(readFileSync(new URL(f, dir), 'utf8')); }
  catch (e) { ok(false, `${f} is valid JSON (${e.message})`); continue; }

  ok(Array.isArray(doc?.ops), `${f} has an ops array — a raw blob applies as nothing`);
  if (!Array.isArray(doc?.ops)) continue;
  ok(doc.ops.length > 0, `${f} has at least one op — an empty ops list is a file doing nothing`);

  doc.ops.forEach((op, i) => {
    const at = `${f} op[${i}]`;
    ok(!!op.table, `${at} names a table`);
    ok(METHODS.has(op.method), `${at} uses a known method (got ${op.method})`);

    // Each method needs different fields, and getting this wrong fails in CI
    // rather than here — which costs a push, a run and an email to discover.
    if (op.method === 'upsert' || op.method === 'insert') {
      ok(Array.isArray(op.rows) && op.rows.length > 0, `${at} carries rows`);
    }
    if (op.method === 'update') {
      ok(!!op.match, `${at} has a match — an unfiltered update rewrites the table`);
      ok(!!op.row, `${at} has a row to write`);
    }
    // The one that can destroy data. A delete with no filter empties a table,
    // and PostgREST will happily do it.
    if (op.method === 'delete') {
      ok(!!op.match, `${at} has a match — a delete with no filter EMPTIES the table`);
    }

    // memory rows are key/value; a memory upsert missing `key` silently writes
    // nothing useful and is impossible to spot afterwards.
    if (op.table === 'memory' && Array.isArray(op.rows)) {
      op.rows.forEach((r, j) => {
        ok(typeof r.key === 'string' && r.key.length > 0, `${at} row[${j}] has a memory key`);
        ok('value' in r, `${at} row[${j}] has a value`);
      });
    }
  });
}

// A delete-then-insert pair against the same table must delete FIRST. Reversed,
// the insert is wiped by its own delete and the payload silently empties the
// table it meant to populate.
for (const f of files) {
  let doc = null;
  try { doc = JSON.parse(readFileSync(new URL(f, dir), 'utf8')); } catch { continue; }
  if (!Array.isArray(doc?.ops)) continue;
  const tables = new Set(doc.ops.map(o => o.table));
  for (const t of tables) {
    const seq = doc.ops.filter(o => o.table === t).map(o => o.method);
    const lastDelete = seq.lastIndexOf('delete');
    const firstWrite = seq.findIndex(m => m === 'insert' || m === 'upsert');
    if (lastDelete >= 0 && firstWrite >= 0) {
      ok(lastDelete < firstWrite,
        `${f}: delete on ${t} comes before the insert, not after it`);
    }
  }
}

console.log(`${pass}/${pass + fail} passing`);
if (fail) process.exit(1);
