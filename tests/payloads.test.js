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

// AN EMPTY QUEUE IS THE NORMAL RESTING STATE, NOT A FAILURE.
//
// This used to assert `files.length > 0`, which was wrong in both directions.
// The apply-payloads workflow archives every file it applies into processed/,
// so the queue is empty most of the time — the test therefore failed on a
// perfectly healthy repo. Worse, when the queue WAS empty none of the shape
// checks below ran at all, so the run that reported "0/1" was also the run
// doing the least work. A guard that only fires when there is nothing to guard
// is not a guard.
//
// So both directories are read. The queue is checked in full. The archive is
// checked too, because it is the only place the shape rules can be exercised
// against payloads that really existed — including the delete-with-an-object
// `match` that produced a duplicate holding.
const dir = new URL('../payloads/', import.meta.url);
const archive = new URL('../payloads/processed/', import.meta.url);
const files = readdirSync(dir).filter(f => f.endsWith('.json'));
const archived = readdirSync(archive).filter(f => f.endsWith('.json'));

ok(archived.length > 0, 'the archive is not empty, so the apply pipeline has really run');
if (files.length === 0) {
  console.log(`queue empty (${archived.length} archived) — nothing pending, which is the normal state`);
}

// The four methods apply-payloads understands. Anything else is a typo that
// would be discovered in CI rather than here.
const METHODS = new Set(['upsert', 'insert', 'update', 'delete']);

// Three payloads from before the ops-array format exist in the archive. They are
// raw blobs the applier of the day understood, they have already been applied,
// and nothing can be done to them now — so they are counted and named rather
// than failed. Every NEW payload passes through the queue above, where the full
// check runs, so nothing can reach the archive without having been checked.
let legacy = 0;
const targets = [
  ...files.map(f => ({ f, url: new URL(f, dir), queued: true })),
  ...archived.map(f => ({ f, url: new URL(f, archive), queued: false })),
];

for (const { f, url, queued } of targets) {
  let doc = null;
  try { doc = JSON.parse(readFileSync(url, 'utf8')); }
  catch (e) { ok(false, `${f} is valid JSON (${e.message})`); continue; }

  if (!Array.isArray(doc?.ops)) {
    if (queued) ok(false, `${f} has an ops array — a raw blob applies as nothing`);
    else legacy++;
    continue;
  }
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
      ok(!!op.row, `${at} has a row to write`);
    }
    // The one that can destroy data. A delete with no filter empties a table,
    // and PostgREST will happily do it.
    //
    // The SHAPE matters as much as the presence, which this test learned the
    // hard way. `match` is pasted straight into the query string, so it has to
    // be a PostgREST filter — "ticker=eq.GOLDBEES". An OBJECT satisfies a
    // truthiness check and stringifies to "[object Object]", producing a URL
    // that matches nothing: the delete quietly does nothing, the insert that
    // follows adds a row anyway, and you get a duplicate holding with two
    // different quantities. That is exactly what happened.
    if (op.method === 'delete' || op.method === 'update') {
      ok(typeof op.match === 'string' && op.match.length > 0,
        `${at} match is a PostgREST filter STRING like "col=eq.value", not an object`);
      ok(typeof op.match === 'string' && /^[^=]+=[a-z]+\./.test(op.match),
        `${at} match looks like col=op.value (got ${JSON.stringify(op.match)})`);
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

if (legacy) console.log(`${legacy} archived payloads predate the ops format and were not shape-checked`);

console.log(`${pass}/${pass + fail} passing`);
if (fail) process.exit(1);
