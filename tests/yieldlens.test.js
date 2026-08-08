// The Yield tab crashed on open with "(n||[]).map is not a function".
//
// The cause was a shape mismatch that `|| []` looked like it guarded and did
// not: divSeriesFromMeta returns {rows, source, note}, YieldDesk passed the
// whole envelope where an array was expected, and `divSeries || []` happily
// returned the object because an object is neither null nor undefined. Every
// consumer then called .map on it.
//
// Two things are tested here and they are not the same thing. First, the
// library accepts either shape now, so no caller can take the screen down with
// this again. Second — and this is the one that actually mattered — the numbers
// that come out of the envelope form must EQUAL the numbers that come out of
// the array form. A guard that swallows the bad shape and quietly returns an
// empty series would pass a "does not throw" test while showing a blank screen,
// which is the failure this project keeps rediscovering.

import { asPoints, growthTable, growth1y, buildYieldSeries, divSeriesFromMeta } from '../src/lib/yieldlens.js';

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; } else { fail++; console.log('FAIL ' + name); } };
const eq = (a, b, name) => ok(a === b, `${name} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
const near = (a, b, name, tol = 1e-6) =>
  ok(a != null && b != null && Math.abs(a - b) < tol, `${name} (got ${a}, want ${b})`);

// ---------------------------------------------------------------- asPoints

eq(asPoints(null).length, 0, 'null is an empty series');
eq(asPoints(undefined).length, 0, 'undefined is an empty series');
eq(asPoints([{ t: '2024-01-01', d: 1 }]).length, 1, 'an array passes through');
eq(asPoints({ rows: [{ t: '2024-01-01', d: 1 }] }).length, 1, 'an envelope is unwrapped');

// The exact shape that crashed the tab: an envelope whose `rows` is fine but
// which is not itself iterable.
ok(Array.isArray(asPoints(divSeriesFromMeta({ perShare: 1, perYear: 4, growthPct: 5 }))),
  'a real divSeriesFromMeta result unwraps to an array');

// Not every object is an envelope. A stray object with no rows must become an
// empty series rather than something .map can be called on by accident.
eq(asPoints({ source: 'declared' }).length, 0, 'an object without rows is empty');
eq(asPoints('SCHD').length, 0, 'a string is not a series');
eq(asPoints(42).length, 0, 'a number is not a series');

// ------------------------------------------------- envelope === array result

const POINTS = [
  { t: '2020-06-01', d: 2.00 },
  { t: '2021-06-01', d: 2.20 },
  { t: '2022-06-01', d: 2.42 },
  { t: '2023-06-01', d: 2.662 },
  { t: '2024-06-01', d: 2.9282 },
];
const ENVELOPE = { rows: POINTS, source: 'declared', note: null };
const TODAY = new Date('2024-06-02T00:00:00Z');

const fromArray = growthTable(POINTS, { today: TODAY });
const fromEnv = growthTable(ENVELOPE, { today: TODAY });

eq(JSON.stringify(fromEnv), JSON.stringify(fromArray),
  'the envelope produces the identical growth table, not an empty one');

// And the figures are real, so the equality above is not two empty arrays
// agreeing with each other — which is exactly how a broken guard would pass.
const g1 = fromArray.find(r => r.years === 1);
near(g1.cagr, 10, '10% a year compounded reads as 10% over one year', 0.05);
ok(fromArray.find(r => r.years === 3).cagr != null, 'the 3Y window has a figure');
near(growth1y(ENVELOPE, { today: TODAY }), 10, 'growth1y unwraps too', 0.05);

// ------------------------------------------------------- buildYieldSeries

const PRICES = [
  { t: '2024-01-01', c: 100 },
  { t: '2024-02-01', c: 80 },
  { t: '2024-03-01', c: 125 },
];
const DIVS = [{ t: '2023-01-01', d: 4 }, { t: '2024-01-01', d: 5 }];

const sArr = buildYieldSeries(PRICES, DIVS);
const sEnv = buildYieldSeries({ rows: PRICES }, { rows: DIVS });

eq(sEnv.rows.length, sArr.rows.length, 'an enveloped price and dividend series build the same length');
ok(sArr.rows.length === 3, 'all three price points produce a yield point');
near(sArr.rows[0].y, 5, 'a $5 dividend on a $100 price is a 5% yield', 1e-9);
near(sArr.rows[1].y, 6.25, 'the same dividend on a $80 price is 6.25%', 1e-9);
near(sArr.rows[2].y, 4, 'and 4% at $125', 1e-9);

// Two dividend observations, so this is not the approximated single-rate case.
eq(sArr.approx, false, 'two dividend points is not an approximation');
eq(buildYieldSeries(PRICES, [{ t: '2024-01-01', d: 5 }]).approx, true,
  'one dividend point IS an approximation and says so');

// The degenerate inputs that used to throw.
eq(buildYieldSeries(null, null).rows.length, 0, 'null inputs give an empty series, not a crash');
eq(buildYieldSeries({ source: 'none' }, { source: 'none' }).rows.length, 0,
  'rowless envelopes give an empty series');

console.log(`${pass}/${pass + fail} passing`);
if (fail) process.exit(1);
