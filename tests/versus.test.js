// Run: bun tests/versus.test.js
//
// The "vs index" comparison. Every failure this suite guards is silent and all
// of them point the same way — they flatter the portfolio.
//
//   1. A flow that lands on a day the index did not trade must still buy index
//      units. The first version of benchmarkEquivalent looked the order date up
//      in the close map and, finding no Saturday, dropped the flow entirely.
//      Nothing throws; the index line just ends up funded with less money than
//      you actually spent, and therefore worth less, and therefore you "beat"
//      it. Weekend and holiday orders are not rare in a ledger typed by hand.
//   2. Fees are signed against the trade, not with it. A sale returns
//      gross - fee. Signing the fee with the side made a sale's fee *increase*
//      the money notionally withdrawn from the index — again in the direction
//      that makes the index look worse.
//   3. The line is denominated in the LEDGER's currency, not the index's. This
//      is what lets a dollar portfolio be plotted on one axis against NIFTY.
//      The units cancel: amount / level_then x level_now. If that ever stopped
//      being true, the two lines would differ by a factor of ~88 and the chart
//      would be a flat line and a spike.
//   4. Units never go negative. Selling more than you notionally hold would
//      draw the index line below zero, which is not a thing money does.
//
// It is the arithmetic that is tested here, not the component: the component is
// a chart, and a chart cannot be wrong in a way a test can see. What can be
// wrong is the series handed to it.

import { benchmarkEquivalent, align, normalise, xirr, ledgerFlows } from '../src/lib/analytics.js';

let pass = 0, fail = 0;
const bad = [];
const ok = (name, cond, got) => {
  if (cond) pass++;
  else { fail++; bad.push(name); console.log('FAIL', name, got === undefined ? '' : `— ${got}`); }
};
const near = (a, b, eps = 1e-6) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= eps;

// A five-day index that skips a weekend: Fri 2nd, Mon 5th, Tue 6th, Wed 7th.
// 2026-01-02 is a Friday, 2026-01-03/04 the weekend.
const IDX = [
  { d: '2026-01-02', v: 100 },
  { d: '2026-01-05', v: 110 },
  { d: '2026-01-06', v: 121 },
  { d: '2026-01-07', v: 121 },
];
const last = s => s[s.length - 1];

// ---------------------------------------------------------------------------
// 1. The weekend flow. This is the bug that motivated the rewrite.
// ---------------------------------------------------------------------------
{
  // 1000 spent on the Saturday. The index cannot be bought on a Saturday, so it
  // is bought at Monday's close of 110 and rides to 121 — a 10% gain.
  const sat = benchmarkEquivalent([{ date: '2026-01-03', ticker: 'X', side: 'B', qty: 10, price: 100 }], IDX);
  ok('a Saturday order still buys index units', last(sat).v > 0, String(last(sat).v));
  ok('and it is priced at the NEXT close, not the previous one',
    near(last(sat).v, 1000 * (121 / 110), 1e-9), String(last(sat).v));

  // The same order dated Friday buys at 100 and is worth more. If the roll
  // forward were silently using the previous close these two would be equal,
  // and equality is the specific thing that would hide the bug.
  const fri = benchmarkEquivalent([{ date: '2026-01-02', ticker: 'X', side: 'B', qty: 10, price: 100 }], IDX);
  ok('a Friday order is priced at Friday, not Monday', near(last(fri).v, 1210, 1e-9), String(last(fri).v));
  ok('the two are genuinely distinguishable', last(fri).v !== last(sat).v);

  // Nothing is lost: the money that went in is the money that shows up.
  ok('no flow is dropped — the invested total is fully represented',
    last(sat).v > 1000 && last(fri).v > 1000);
}

// ---------------------------------------------------------------------------
// 2. Fees, signed against the trade.
// ---------------------------------------------------------------------------
{
  const buyFee = benchmarkEquivalent(
    [{ date: '2026-01-02', side: 'B', qty: 10, price: 100, fee: 50 }], IDX);
  ok('a buy fee increases the money put into the index',
    near(last(buyFee).v, 1050 * 1.21, 1e-9), String(last(buyFee).v));

  // Buy 1000 on the 2nd, sell 500 worth on the 5th with a 50 fee. The sale
  // returns 450, so 450/110 units come back out — NOT 550/110.
  const sold = benchmarkEquivalent([
    { date: '2026-01-02', side: 'B', qty: 10, price: 100 },
    { date: '2026-01-05', side: 'S', qty: 5, price: 100, fee: 50 },
  ], IDX);
  const expect = (1000 / 100 - 450 / 110) * 121;
  ok('a sell fee reduces what comes out, it does not increase it',
    near(last(sold).v, expect, 1e-9), `${last(sold).v} vs ${expect}`);

  const noFee = benchmarkEquivalent([
    { date: '2026-01-02', side: 'B', qty: 10, price: 100 },
    { date: '2026-01-05', side: 'S', qty: 5, price: 100 },
  ], IDX);
  ok('and the fee actually moves the answer', last(sold).v > last(noFee).v,
    `${last(sold).v} vs ${last(noFee).v}`);
}

// ---------------------------------------------------------------------------
// 3. Currency. The whole reason this can share an axis with the portfolio.
// ---------------------------------------------------------------------------
{
  const orders = [{ date: '2026-01-02', side: 'B', qty: 10, price: 100 }];
  const usdIdx = IDX;
  // The identical index quoted in a currency 88x larger. Growth is unchanged.
  const inrIdx = IDX.map(p => ({ d: p.d, v: p.v * 88 }));
  const a = benchmarkEquivalent(orders, usdIdx);
  const b = benchmarkEquivalent(orders, inrIdx);
  ok('the index level\'s own currency cancels out',
    near(last(a).v, last(b).v, 1e-9), `${last(a).v} vs ${last(b).v}`);
  ok('and the answer is in the ledger\'s currency — 1000 in, 1210 out',
    near(last(a).v, 1210, 1e-9), String(last(a).v));
  // A scale factor applied to the whole index must not change the result at all,
  // in any period, not just at the end.
  ok('at every point, not only the last',
    a.every((p, i) => near(p.v, b[i].v, 1e-6)));
}

// ---------------------------------------------------------------------------
// 4. Units cannot go negative.
// ---------------------------------------------------------------------------
{
  const over = benchmarkEquivalent([
    { date: '2026-01-02', side: 'B', qty: 1, price: 100 },
    { date: '2026-01-05', side: 'S', qty: 100, price: 100 },
  ], IDX);
  ok('overselling floors at zero rather than drawing a negative line',
    over.every(p => p.v >= 0), JSON.stringify(over.map(p => p.v)));
}

// ---------------------------------------------------------------------------
// Shape. The component aligns this against the portfolio series, so it has to
// come back in the same {d, v} form, sorted, one point per index date.
// ---------------------------------------------------------------------------
{
  const e = benchmarkEquivalent([{ date: '2026-01-02', side: 'B', qty: 10, price: 100 }], IDX);
  ok('one point per index close', e.length === IDX.length, String(e.length));
  ok('dates come back in order', e.every((p, i) => !i || p.d > e[i - 1].d));
  ok('every point carries d and v', e.every(p => typeof p.d === 'string' && Number.isFinite(p.v)));
  ok('an empty index gives an empty series, not a crash', benchmarkEquivalent([{ date: '2026-01-02', side: 'B', qty: 1, price: 1 }], []).length === 0);
  ok('no orders gives a zero line, not a crash',
    benchmarkEquivalent([], IDX).every(p => p.v === 0));

  // The alignment the chart depends on: both lines must land on shared dates,
  // because a chart that plots index-day i against portfolio-day i without
  // checking is comparing different days as soon as one series has a gap.
  const port = [
    { d: '2026-01-02', v: 1000 }, { d: '2026-01-05', v: 1150 },
    { d: '2026-01-06', v: 1300 }, { d: '2026-01-07', v: 1290 },
  ];
  const [A, B] = align(port, e);
  ok('align pairs the two on shared dates', A.length === B.length && A.length === 4, `${A.length}/${B.length}`);
  ok('and the pairing is by date, not by position',
    A.every((p, i) => p.d === B[i].d));

  const gappy = port.filter(p => p.d !== '2026-01-06');
  const [G, H] = align(gappy, e);
  ok('a gap in one series drops that date from both', G.length === 3 && H.length === 3, `${G.length}/${H.length}`);
  ok('and never silently shifts the remaining points',
    G.every((p, i) => p.d === H[i].d));
}

// ---------------------------------------------------------------------------
// The headline pairing. The card shows the portfolio's XIRR beside the index
// equivalent's, and the claim it makes is that they answer the same question
// about the same money. Same flows, different destination.
// ---------------------------------------------------------------------------
{
  // A year-long span, deliberately. xirr() bisects between -99.99% and +1000%
  // and returns null when no sign change exists in that window, and a 17% gain
  // compressed into five days annualises far past +1000% — so the five-day
  // fixture above would have both sides come back null and the assertion would
  // pass for the wrong reason. This is also true of the real screen: XIRR reads
  // '—' for the first weeks of a portfolio's life, which is correct behaviour
  // rather than a bug, because a five-day return annualised is not information.
  const LONG = [
    { d: '2026-01-02', v: 100 },
    { d: '2026-01-05', v: 110 },
    { d: '2026-07-01', v: 115 },
    { d: '2027-01-04', v: 121 },
  ];
  const orders = [
    { date: '2026-01-02', side: 'B', qty: 10, price: 100 },
    { date: '2026-01-05', side: 'B', qty: 5, price: 110 },
  ];
  const e = benchmarkEquivalent(orders, LONG);
  const flows = ledgerFlows(orders, 1700, new Date('2027-01-04'));
  const mine = xirr(flows);
  const theirs = xirr([...flows.slice(0, -1), { date: '2027-01-04', amount: last(e).v }]);
  ok('both XIRRs compute off the same flow list', mine != null && theirs != null,
    `${mine} / ${theirs}`);
  // 1550 in; index takes it to 10*1.21 + 550/110*121 = 1210 + 605 = 1815.
  ok('the index equivalent lands where the arithmetic says',
    near(last(e).v, 1815, 1e-9), String(last(e).v));
  ok('beating the index shows up as the higher XIRR', theirs > mine,
    `mine ${mine} theirs ${theirs}`);

  // normalise() is what both sides pass through before plotting; a zero-valued
  // leading stretch (before the first order) must not survive into the chart as
  // a real point sitting at the bottom of the axis.
  const early = benchmarkEquivalent([{ date: '2026-01-06', side: 'B', qty: 1, price: 100 }], IDX);
  ok('pre-funding days are zero', early[0].v === 0 && early[1].v === 0);
  ok('and normalise strips them out of the plotted line',
    normalise(early).length === 2, String(normalise(early).length));
}

console.log(`\n${pass}/${pass + fail} passing`);
if (fail) { console.log('\nfailing:\n  ' + bad.join('\n  ')); process.exit(1); }
