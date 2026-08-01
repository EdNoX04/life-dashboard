// Run: bun tests/sweep.test.jsx
//
// The cold-open sweep. It renders every default-exported component in
// components/{college,money} against four prop shapes and asserts none throws.
//
// Why this is the most valuable suite in the build, and why it is the first
// thing to rebuild after a reclaim: the state it tests — no data, no network
// answer yet, nothing typed in — is the state nobody writes a fixture for and
// the state every user sees first. It is also the only state in which a single
// missing default prop white-screens the entire tab rather than showing an
// empty card. `Book.jsx`'s `priceOf` was exactly that bug.
//
// It lives in tests/ rather than /tmp because the container has been reclaimed
// six times and taken this file with it every time. Six rewrites is enough.
//
// A FIFTH shape, `null everywhere`, was written and then REMOVED rather than
// satisfied, and the reasoning belongs here rather than in a commit message.
// It failed on twelve components. But `lib/hooks.js`'s `useCollection` holds
// `items` in `useState([])` and only ever sets it to an array, so `held={null}`
// is not a state this app can reach — and a default parameter catches
// `undefined`, not `null`. Satisfying it would have meant twelve `|| []` guards
// that can never fire, each quietly widening a contract that is currently
// exact. Distinguishing that from the one REAL failure in the same run is the
// entire value of this exercise.

import fs from 'fs';
import path from 'path';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

const here = new URL('.', import.meta.url).pathname;
const root = path.join(here, '../src/components');

let pass = 0, fail = 0;
const bad = [];
const ok = (name, cond, got) => {
  if (cond) pass++;
  else { fail++; bad.push(name); console.log('FAIL', name, got === undefined ? '' : `— ${got}`); }
};

// ---------------------------------------------------------------------------
// The four shapes. Each is a plausible moment in the life of a screen, not a
// fuzz case: nothing here is a value the app could not actually produce.
// ---------------------------------------------------------------------------
const SHAPES = [
  // 1. Literally nothing. Every default must carry its own weight.
  ['no props', {}],

  // 2. The loader has returned and there was nothing in the account. This is
  //    the single most common real first-open, and it is NOT the same as (1):
  //    a component can survive missing props via defaults and still divide by
  //    an array's length.
  ['empty arrays', {
    held: [], holdings: [], rows: [], items: [], orders: [], txns: [], series: [],
    benchmark: [], crypto: [], data: [], list: [], events: [], entries: [],
    quotes: {}, blobs: {}, flowsByDay: {}, meta: {},
  }],

  // 3. One row that came back from storage half-written — a position typed in
  //    and abandoned before the price or quantity was filled. Real records look
  //    like this far more often than fixtures do.
  ['one malformed row', {
    // Every row carries an `id`. A row without one is not a state this app can
    // reach — rows come from Postgres tables with primary keys — and omitting it
    // only produces React key warnings that are the fixture's fault, exactly like
    // the `null everywhere` shape above. Same rule: do not widen the contract to
    // satisfy a state the app cannot produce.
    held: [{ id: 1, symbol: 'X' }], holdings: [{ id: 1, symbol: 'X' }],
    rows: [{ id: 1 }], items: [{ id: 1 }],
    orders: [{ id: 1, symbol: 'X' }], txns: [{ id: 1 }], series: [{}], crypto: [{ id: 1, symbol: 'X' }],
    quotes: { X: {} }, blobs: {}, flowsByDay: {},
  }],

  // 4. The fields exist but carry null — a saved blob whose numbers were
  //    cleared rather than removed. Distinct from (2): here `.length` works and
  //    the arithmetic is what breaks.
  ['null fields', {
    held: [{ id: 1, symbol: 'X', qty: null, avg_cost: null, last_price: null }],
    holdings: [{ id: 1, symbol: 'X', qty: null, avg_cost: null, last_price: null }],
    value: null, currentValue: null, series: [], benchmark: [],
    quotes: { X: { c: null } }, blobs: {}, flowsByDay: {}, cur: '₹',
  }],
];

// ---------------------------------------------------------------------------
const dirs = ['college', 'money'];
const files = dirs.flatMap(d =>
  fs.readdirSync(path.join(root, d))
    .filter(f => f.endsWith('.jsx'))
    .map(f => ({ rel: `${d}/${f}`, abs: path.join(root, d, f) }))
);

ok('the sweep found components to sweep', files.length > 25, String(files.length));

// React reports a missing `key` through console.error rather than by throwing,
// so a sweep that only catches exceptions is blind to it. An unkeyed list is a
// real defect — it makes React re-key by position, which silently reuses the
// wrong row's state when the list reorders. So the console is captured and any
// warning is a failure, attributed to the component that produced it.
const warnings = [];
const realError = console.error;
console.error = (...a) => { warnings.push(a.map(String).join(' ')); };

let rendered = 0;
for (const f of files) {
  let mod = null;
  try { mod = await import(f.abs); }
  catch (e) { ok(`${f.rel} imports`, false, e.message); continue; }

  const C = mod.default;
  if (typeof C !== 'function') continue;   // a module with no default export

  for (const [shapeName, props] of SHAPES) {
    let threw = null;
    const before = warnings.length;
    try { renderToStaticMarkup(React.createElement(C, props)); rendered++; }
    catch (e) { threw = e; }
    ok(`${f.rel} · ${shapeName}`, threw == null, threw && threw.message);
    const emitted = warnings.slice(before);
    ok(`${f.rel} · ${shapeName} · renders without a React warning`,
      emitted.length === 0, emitted[0] && emitted[0].split('\n')[0]);
  }
}

// ---------------------------------------------------------------------------
// The sweep's own guard. A harness that silently stops finding components
// reports a clean run forever, which is the most reassuring possible way to
// test nothing — the same failure mode decision 1 of briefing.js exists to
// prevent, one level up in the tooling.
// ---------------------------------------------------------------------------
console.error = realError;
ok('the sweep actually rendered something', rendered > 100, String(rendered));
ok('the console capture was actually installed', typeof realError === 'function');

console.log(`\n${files.length} components · ${rendered} renders · ${pass}/${pass + fail} passing`);
if (fail) { console.log('\nfailing:', bad.join('\n         ')); process.exit(1); }
