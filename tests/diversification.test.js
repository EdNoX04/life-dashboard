// Pins the diversification arithmetic added to lib/holdings.js — the HHI and
// its reciprocal, the value/income weighting split, and the OTHER fold.
// Hand-typed literals; the effective-holdings figures below are worked out by
// hand in the comments so the suite cannot agree with a broken module.

import {
  WEIGHT_BASES, weightBasis, hhiOf, allocationSlices, arcs, OTHER_KEY,
  concentration, topBy,
} from '../src/lib/holdings.js';

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; } else { fail++; console.log('FAIL ' + name); } };
const eq = (a, b, name) => ok(a === b, `${name} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
const near = (a, b, name, tol = 1e-6) =>
  ok(a != null && Math.abs(a - b) < tol, `${name} (got ${a}, want ~${b})`);

// ---------------------------------------------------------------- bases
eq(WEIGHT_BASES.length, 2, 'two weighting bases');
eq(weightBasis('income').field, 'income', 'income weights by the income field');
eq(weightBasis('value').field, 'marketValue', 'value weights by market value');
eq(weightBasis('nonsense').key, 'value', 'an unknown basis falls back to value');
eq(weightBasis(null).key, 'value', 'a null basis falls back to value');

// ------------------------------------------------------------------ hhi
// Four equal positions: each weight 0.25, HHI = 4 x 0.0625 = 0.25, 1/HHI = 4.
const EQUAL = [
  { ticker: 'A', marketValue: 250 }, { ticker: 'B', marketValue: 250 },
  { ticker: 'C', marketValue: 250 }, { ticker: 'D', marketValue: 250 },
];
const he = hhiOf(EQUAL);
near(he.hhi, 0.25, 'four equal positions give HHI 0.25');
near(he.effective, 4, 'and four effective holdings');
eq(he.names, 4, 'and four names');
near(he.total, 1000, 'and a thousand of value');

// One position at half, three at a sixth each:
// HHI = 0.5^2 + 3 x (1/6)^2 = 0.25 + 0.0833333 = 0.3333333, 1/HHI = 3.
const SKEWED = [
  { ticker: 'A', marketValue: 500 },
  { ticker: 'B', marketValue: 500 / 3 }, { ticker: 'C', marketValue: 500 / 3 },
  { ticker: 'D', marketValue: 500 / 3 },
];
const hs = hhiOf(SKEWED);
near(hs.hhi, 1 / 3, 'a half-weight position raises HHI to a third', 1e-9);
near(hs.effective, 3, 'four names behave like three equal ones', 1e-9);
// The whole point of the reciprocal: same name count, different concentration.
eq(he.names, hs.names, 'both books hold four names');
ok(hs.effective < he.effective, 'but the skewed book is effectively less diversified');

// A single holding is trivially maximally concentrated.
near(hhiOf([{ ticker: 'A', marketValue: 100 }]).hhi, 1, 'one holding scores HHI 1');
near(hhiOf([{ ticker: 'A', marketValue: 100 }]).effective, 1, 'and one effective holding');
// Absence must stay absence rather than becoming a flattering zero.
eq(hhiOf([]).hhi, null, 'an empty book has no HHI, not zero');
eq(hhiOf([]).effective, null, 'and no effective count');
eq(hhiOf([{ ticker: 'A', marketValue: 0 }]).hhi, null, 'a valueless book has no HHI');
eq(hhiOf([{ ticker: 'A', marketValue: -5 }]).names, 0, 'negative values are excluded');

// Weighting by income is a different question and can give a different answer.
const BOOK = [
  { ticker: 'BIG', marketValue: 900, income: 9 },
  { ticker: 'YLD', marketValue: 100, income: 9 },
];
near(hhiOf(BOOK, 'marketValue').hhi, 0.82, 'by value the book is 0.9/0.1 → 0.82', 1e-9);
near(hhiOf(BOOK, 'income').hhi, 0.5, 'by income it is 50/50 → 0.5', 1e-9);
near(hhiOf(BOOK, 'income').effective, 2, 'income-wise it behaves like two equal holdings', 1e-9);
ok(hhiOf(BOOK, 'income').effective > hhiOf(BOOK, 'marketValue').effective,
  'a small high-yielder makes income better spread than capital');

// -------------------------------------------------------------- slices
const TEN = Array.from({ length: 14 }, (_, i) => ({ ticker: `T${i}`, marketValue: 100 - i }));
const a10 = allocationSlices(TEN, { limit: 10 });
eq(a10.slices.length, 11, 'ten named slices plus one OTHER');
eq(a10.folded, 4, 'four positions were folded');
eq(a10.slices[10].ticker, OTHER_KEY, 'the fold is last');
eq(a10.slices[10].other, true, 'and is flagged as the fold');
ok(a10.slices[10].label.includes('4'), 'and says how many it stands for');
// Decision: the wedges must sum to 100, or the donut lies about its denominator.
near(a10.slices.reduce((s, x) => s + x.pct, 0), 100, 'every slice sums to 100%', 1e-9);
eq(a10.slices[0].ticker, 'T0', 'the largest slice leads');
ok(a10.slices[0].pct > a10.slices[1].pct, 'and slices descend');
// No fold needed when everything fits.
const small = allocationSlices(EQUAL, { limit: 10 });
eq(small.slices.length, 4, 'a short book needs no OTHER wedge');
eq(small.folded, 0, 'and folds nothing');
near(small.slices[0].pct, 25, 'four equal positions are 25% each');
eq(allocationSlices([], {}).slices.length, 0, 'an empty book has no slices');
eq(allocationSlices([], {}).total, 0, 'and no total');
// Income basis picks the income field, not the value one.
const inc = allocationSlices(BOOK, { basis: 'income' });
near(inc.slices[0].pct, 50, 'by income the two positions are equal');
eq(inc.basis.key, 'income', 'the basis is reported back');
// A book with no income data yields nothing rather than zero-width wedges.
eq(allocationSlices(EQUAL, { basis: 'income' }).slices.length, 0,
  'a book with no income recorded produces no income slices');

// A holding that genuinely pays nothing must not appear as a 0% wedge. An
// explicit zero is different from a missing field, and only the explicit zero
// distinguishes "> 0" from "is not null".
const WITHZERO = [
  { ticker: 'PAYS', marketValue: 100, income: 10 },
  { ticker: 'NONE', marketValue: 100, income: 0 },
];
eq(allocationSlices(WITHZERO, { basis: 'income' }).slices.length, 1,
  'a zero-income holding is excluded, not drawn as a zero-width wedge');
eq(allocationSlices(WITHZERO, { basis: 'income' }).slices[0].ticker, 'PAYS',
  'and the paying holding is the one that survives');
eq(hhiOf(WITHZERO, 'income').names, 1, 'a zero-income holding is not a name for HHI either');

// ----------------------------------------------------------------- arcs
const ar = arcs(allocationSlices(EQUAL).slices);
eq(ar.length, 4, 'one arc per slice');
near(ar[0].start, 0, 'the first arc starts at twelve o-clock');
near(ar[0].sweep, 90, 'a quarter slice sweeps ninety degrees');
near(ar[1].start, 90, 'the second arc starts where the first ended');
near(ar[3].end, 360, 'the last arc closes the circle');
eq(arcs([]).length, 0, 'no slices, no arcs');

// --------------------------------------- the existing concentration facts
const c = concentration(EQUAL);
near(c.top1, 25, 'the largest of four equals is a quarter');
eq(c.namesToHalf, 2, 'two equal quarters reach half');
eq(concentration([]).namesToHalf, null, 'an empty book has no names-to-half');
eq(concentration([{ ticker: 'A', marketValue: 100 }]).namesToHalf, 1,
  'a one-stock book needs one name to reach half');
eq(topBy(TEN, 'marketValue', 5).length, 5, 'topBy returns the requested count');
eq(topBy(TEN, 'marketValue', 5)[0].ticker, 'T0', 'and leads with the largest');

console.log(`${pass}/${pass + fail} passing`);
if (fail) process.exit(1);
