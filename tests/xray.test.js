// Look-through exposure.
//
// The screen exists because "nineteen holdings" is misleading when five of them
// are large-cap US index funds holding the same companies. The tests exist
// because every plausible shortcut in computing it fails in the SAME direction —
// making the book look more diversified than it is — and a tool that errs toward
// reassurance on exactly the question you built it to answer is worse than no
// tool.

import {
  lookThrough, overlap, overlapMatrix, concentration, isNonEquity, bySector,
  shelfWeights,
} from '../src/lib/xray.js';
import {
  normSym, toComposition, seedCompositions, mergeCompositions, isFundRow,
  bookPositions,
} from '../src/lib/etfdata.js';

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; } else { fail++; console.log('FAIL ' + name); } };
const eq = (a, b, name) => ok(a === b, `${name} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
const near = (a, b, name, tol = 0.01) => ok(a != null && Math.abs(a - b) < tol, `${name} (got ${a}, want ${b})`);

// Two funds that genuinely overlap, shaped like the real ones.
const COMP = {
  VOO: {
    covered: 0.40,
    holdings: [
      { sym: 'NVDA', name: 'NVIDIA', weight: 0.07 },
      { sym: 'MSFT', name: 'Microsoft', weight: 0.06 },
      { sym: 'AAPL', name: 'Apple', weight: 0.05 },
    ],
  },
  QQQM: {
    covered: 0.50,
    holdings: [
      { sym: 'NVDA', name: 'NVIDIA', weight: 0.09 },
      { sym: 'MSFT', name: 'Microsoft', weight: 0.08 },
      { sym: 'AVGO', name: 'Broadcom', weight: 0.05 },
    ],
  },
};

// ------------------------------------------------- the finding it must surface

const book = [
  { ticker: 'VOO', value: 1900, isFund: true },
  { ticker: 'QQQM', value: 780, isFund: true },
  { ticker: 'MSFT', value: 446 },              // held directly, on top of both
];
const x = lookThrough(book, COMP);

eq(x.total, 3126, 'the total is the whole book');

const msft = x.exposures.find(e => e.sym === 'MSFT');
// 6% of 1900 = 114, 8% of 780 = 62.4, plus 446 held outright = 622.4
near(msft.value, 622.4, 'MSFT exposure sums the direct holding and both funds');
ok(msft.pct > 19, 'which is nearly 20% of the book, not the 14% the shelf shows');
eq(msft.direct, true, 'and it is flagged as partly held outright');
near(msft.directValue, 446, 'with the outright part kept separately, so the gap can be shown');
eq(msft.via.length, 2, 'with both funds named as contributors');
ok(msft.via.some(v => v.fund === 'VOO') && msft.via.some(v => v.fund === 'QQQM'),
  'so you can see WHERE the exposure comes from, which is the actionable part');

const nvda = x.exposures.find(e => e.sym === 'NVDA');
near(nvda.value, 1900 * 0.07 + 780 * 0.09, 'NVDA is owned twice over without appearing on the shelf at all');
eq(nvda.direct, false, 'never bought directly');

eq(x.exposures[0].sym, 'MSFT', 'the largest true exposure leads');

// The shelf's own view, for the side-by-side. MSFT is 446/3126 = 14.3% there and
// 19.9% here, and that gap is the whole screen.
const shelf = shelfWeights(book);
near(shelf.MSFT, (446 / 3126) * 100, 'the shelf weight is the position over the book');
ok(msft.pct > shelf.MSFT + 5, 'and the true exposure is materially larger');

// ------------------------------------------- the four ways this flatters, guarded

// 1. An unknown fund must not vanish. Dropping it shrinks the denominator and
// inflates every percentage — errors all pointing toward "well diversified".
const withUnknown = lookThrough([...book, { ticker: 'ARKK', value: 1000, isFund: true }], COMP);
eq(withUnknown.total, 4126, 'an undecomposable fund still counts in the total');
near(withUnknown.unknown.value, 1000, 'and is reported as uncovered');
eq(withUnknown.unknown.funds[0].sym, 'ARKK', 'by name, so you know what to go and add');
ok(withUnknown.exposures.find(e => e.sym === 'MSFT').pct < msft.pct,
  'and every other percentage falls, because the denominator grew — as it should');
ok(withUnknown.coverage < x.coverage, 'coverage drops to say how much is actually resolved');

// 2. The unlisted remainder of a fund is real money, not absence. VOO's top 25
// is about half of it; the other half must appear somewhere.
near(x.rest.value, 1900 * (1 - 0.18) + 780 * (1 - 0.22),
  'whatever the listed holdings did not account for becomes "rest of fund"');
ok(x.rest.value > 0, 'which on a top-25 list is most of the fund');
eq(x.rest.funds[0].sym, 'VOO', 'attributed to the fund it came from, biggest first');
near(
  x.exposures.reduce((s, e) => s + e.value, 0) + x.rest.value + x.unknown.value + x.nonEquity.value,
  x.total, 'and every rupee is accounted for exactly once', 0.01,
);

// 3. Gold is not a company and not a data gap.
ok(isNonEquity('GOLDBEES'), 'GOLDBEES is bullion');
ok(!isNonEquity('MSFT'), 'MSFT is not');
const withGold = lookThrough([...book, { ticker: 'GOLDBEES', value: 1500 }], COMP);
near(withGold.nonEquity.value, 1500, 'gold lands in its own bucket');
eq(withGold.unknown.value, 0, 'NOT in uncovered — that would read as missing data');
eq(withGold.nonEquity.rows[0].klass, 'Gold', 'and is labelled by asset class');
ok(!withGold.exposures.some(e => e.sym === 'GOLDBEES'), 'it is never treated as a company');

// 4. Share classes are one company. Split apart, Alphabet appears twice at half
// size and drops out of the top names — flattering, and wrong.
eq(normSym('GOOG'), 'GOOGL', 'GOOG folds into GOOGL');
eq(normSym('BRK.B'), 'BRKB', 'punctuation is folded');
eq(normSym('brk-b'), 'BRKB', 'however the source spells it');
eq(normSym('BRK.A'), 'BRKB', 'and both Berkshire classes are one issuer');
eq(normSym(null), '', 'a missing ticker is empty, not the string "null"');

const dual = lookThrough(
  [{ ticker: 'IDX', value: 1000, isFund: true }],
  { IDX: { covered: 1, holdings: [
    { sym: 'GOOGL', name: 'Alphabet', weight: 0.3 },
    { sym: 'GOOG', name: 'Alphabet', weight: 0.3 },
    { sym: 'AAPL', name: 'Apple', weight: 0.4 },
  ] } },
);
eq(dual.exposures.length, 2, 'two share classes of one company make one exposure');
eq(dual.exposures[0].sym, 'GOOGL', 'and it is the larger of the two, not the smaller');
near(dual.exposures[0].value, 600, 'at the combined weight');

// A single stock with no composition is its own exposure, not an unknown fund.
const single = lookThrough([{ ticker: 'PLTR', value: 100 }], {});
eq(single.exposures[0].sym, 'PLTR', 'a plain stock is simply itself');
eq(single.unknown.value, 0, 'and is not reported as a gap');

// ---------------------------------------------------------------- overlap

const o = overlap(COMP.VOO, COMP.QQQM);
// min(7,9) + min(6,8) + min(5,0) = 7 + 6 = 13
near(o.pct, 13, 'overlap is the sum of the SMALLER weight in each shared name');
eq(o.names[0].sym, 'NVDA', 'led by the biggest shared position');
ok(!o.names.some(n => n.sym === 'AVGO'), 'a name in only one fund is not overlap');
eq(o.isFloor, true,
  'and it is flagged as a FLOOR — two top-25 lists cannot see the overlap in the other half');
near(o.coverage, 40, 'reported with the weaker of the two coverages');
eq(overlap(COMP.VOO, { holdings: [] }), null, 'nothing to compare against gives null, not zero');

const matrix = overlapMatrix(['VOO', 'QQQM'], COMP);
eq(matrix.length, 1, 'each pair once, not twice');
near(matrix[0].pct, 13, 'with the same figure');

// ---------------------------------------------------------- concentration

const c = concentration(x.exposures, x.total);
ok(c.top1 > 19, 'the largest single true exposure is around a fifth of the WHOLE book');

// The denominator trap. HHI must be computed over the RESOLVED exposures, not
// the whole book — otherwise the un-enumerated remainder of every fund acts like
// perfect diversification, and the effective holding count comes out ABOVE the
// number of positions. A screen built to reveal concentration would then report
// LESS of it the less data it had. This assertion failed on the first
// implementation, which is how the bug was found.
ok(c.effective < x.exposures.length,
  'the effective number of holdings is BELOW the count — that is what concentration means');
ok(c.effective > 0, 'and is a real number');
ok(c.basis < 100, 'with the share of the book it describes stated, so it is not read as the whole story');
eq(concentration([], 0).effective, null, 'an empty book has no effective count, not zero');

// Equal weights are the reference case: five equal positions should read as five.
const flat = [1, 1, 1, 1, 1].map((v, i) => ({ sym: `S${i}`, value: 20 }));
near(concentration(flat, 100).effective, 5, 'five equal holdings give an effective count of five');
near(concentration(flat, 100).basis, 100, 'and describe the entire book');
near(concentration(flat, 200).effective, 5, 'coverage does not distort the effective count');
near(concentration(flat, 200).basis, 50, 'it is reported alongside instead');

// -------------------------------------------------------------- sectors

const s = bySector(x.exposures, COMP, { MSFT: 'Technology', NVDA: 'Technology' });
eq(s.rows[0].sector, 'Technology', 'sectors aggregate');
ok(s.unknown > 0, 'and anything with no sector on file is counted as unknown, not as "Other"');

// ============================================================ the seed data

const seed = seedCompositions();

// `covered` is computed from the weights, never asserted, so it cannot drift
// away from the list it describes.
for (const [ticker, comp] of Object.entries(seed)) {
  const sum = comp.holdings.reduce((t, h) => t + h.weight, 0);
  near(comp.covered, sum, `${ticker} coverage is the sum of its own weights`, 1e-9);
  ok(comp.covered > 0 && comp.covered < 1, `${ticker} covers part of the fund, not all of it`);
  ok(comp.asOf && /^\d{4}-\d{2}-\d{2}$/.test(comp.asOf), `${ticker} carries the date it was read`);
  ok(comp.count > comp.holdings.length, `${ticker} names more holdings than the top list shows`);
}

// Alphabet appears twice in every S&P and Nasdaq list. It must arrive merged.
ok(seed.VOO.holdings.filter(h => h.sym === 'GOOGL').length === 1,
  'the seed merges the two Alphabet classes into one line');
near(seed.VOO.holdings.find(h => h.sym === 'GOOGL').weight, (3.24 + 2.58) / 100,
  'at their combined weight, which is what moves Alphabet up the table');

// The four US large-cap funds overlap heavily. If this stops being true the
// screen has lost its reason to exist, so it is pinned.
const real = overlap(seed.VOO, seed.QQQM);
ok(real.pct > 25, 'VOO and QQQM share more than a quarter of themselves by weight');
ok(real.isFloor, 'and that is a floor, not a total');
const twins = overlap(seed.QQQ, seed.QQQM);
ok(twins.pct > 60, 'QQQ and QQQM are the same index and overlap almost completely');

// ------------------------------------------------------ composition merging

const older = { VOO: { asOf: '2020-01-01', holdings: [['AAPL', 'Apple', 50]] } };
const merged = mergeCompositions(seed, older);
eq(merged.VOO.asOf, seed.VOO.asOf, 'a stale payload never walks the numbers backwards');
const newer = { VOO: { asOf: '2099-01-01', holdings: [['AAPL', 'Apple', 50]] } };
eq(mergeCompositions(seed, newer).VOO.asOf, '2099-01-01', 'a fresher one does replace it');
eq(Object.keys(mergeCompositions(seed, newer)).length, Object.keys(seed).length,
  'and updating one fund does not delete the other four');
eq(mergeCompositions(seed, { VOO: { holdings: [] } }).VOO.asOf, seed.VOO.asOf,
  'an empty holdings list is ignored rather than blanking a fund');

// Weights arrive as percentages and must become fractions. A factor-of-100 slip
// here would decompose a fund into a hundred times its own value.
const conv = toComposition({ holdings: [['AAPL', 'Apple', 25]] });
near(conv.holdings[0].weight, 0.25, 'a 25% weight is stored as 0.25');

// ------------------------------------------------------------ the book

eq(isFundRow({ ticker: 'VOO' }, seed), true, 'a seeded ETF is a fund');
eq(isFundRow({ ticker: 'ARKK' }, seed), true, 'so is a known ETF with no composition');
eq(isFundRow({ ticker: 'MSFT' }, seed), false, 'a company is not');
eq(isFundRow({ ticker: 'WHATEVER', kind: 'etf' }, seed), true, 'an explicit kind wins over the list');

// One currency, or the position is excluded and counted. GOLDBEES at Rs 122 a
// unit summed as 122 dollars entered the book at ninety times its weight once
// already; converting at 1.0 when the rate is missing is the same bug wearing a
// different hat.
const held = [
  { ticker: 'VOO', qty: 2, last_price: 700 },
  { ticker: 'GOLDBEES', qty: 12, last_price: 122, currency: 'INR' },
];
const ccy = h => (h.currency === 'INR' ? 'INR' : 'USD');
const noFx = bookPositions(held, { priceOf: h => h.last_price, fx: null, currencyOf: ccy, comps: seed });
eq(noFx.positions.length, 1, 'with no FX rate the rupee position is dropped, not converted at 1.0');
eq(noFx.excluded[0].ticker, 'GOLDBEES', 'and it is named, so the omission is visible');
const withFx = bookPositions(held, { priceOf: h => h.last_price, fx: 88, currencyOf: ccy, comps: seed });
eq(withFx.positions.length, 2, 'with a rate loaded it converts');
near(withFx.positions[1].value, (12 * 122) / 88, 'at the rate, into dollars');
eq(withFx.positions[0].isFund, true, 'and the fund is flagged for look-through');
eq(bookPositions([{ ticker: 'X', qty: 0, last_price: 10 }], { priceOf: h => h.last_price }).positions.length, 0,
  'a zero-quantity row is a watchlist entry, not a holding');

console.log(`${pass}/${pass + fail} passing`);
if (fail) process.exit(1);
