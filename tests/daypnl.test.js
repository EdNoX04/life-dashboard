// Today's move, and what it actually covers.
//
// The Money tab said −$7.63 on a day the broker's own app said +$2.52. Neither
// number was wrong about what it measured. The tab summed the holdings whose
// quote had arrived and skipped the rest — silently — then printed the result
// under the label "TODAY'S P&L" as though it covered the portfolio. The
// percentage was worse: divided by the quoted subset's own prior value, so a
// figure from twelve positions was published as twenty positions' day.
//
// That is the shape of every disagreement with a broker. One side sums the
// book; the other sums the ones that answered; and only one of them says so.

import { dayPnl } from '../src/lib/holdings.js';

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; } else { fail++; console.log('FAIL ' + name); } };
const eq = (a, b, name) => ok(a === b, `${name} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
const near = (a, b, name, tol = 0.01) => ok(a != null && Math.abs(a - b) < tol, `${name} (got ${a}, want ${b})`);

const ccy = h => (h.currency === 'INR' ? 'INR' : 'USD');
const px = h => h.last_price;

const BOOK = [
  { ticker: 'MSFT', qty: 10, last_price: 430 },
  { ticker: 'AAPL', qty: 10, last_price: 200 },
  { ticker: 'GOLDBEES', qty: 12, last_price: 121, currency: 'INR' },
];

// ------------------------------------------------ the arithmetic is unchanged

{
  const all = dayPnl(BOOK, {
    MSFT: { change: 5, prevClose: 425 },
    AAPL: { change: -2, prevClose: 202 },
    GOLDBEES: { change: 1, prevClose: 120 },
  }, { fx: 95.53, currencyOf: ccy, priceOf: px });
  near(all.gain, 10 * 5 + 10 * -2 + (12 * 1) / 95.53, 'the move sums every holding, rupees converted');
  eq(all.whole, true, 'and reports itself as covering the whole book');
  eq(all.quoted, 3, 'three of three quoted');
  near(all.covered, 100, 'covering all of it by value');
  eq(all.missing.length, 0, 'with nothing missing');
}

// ------------------------------------------- what the old version did silently

{
  const partial = dayPnl(BOOK, { MSFT: { change: 5, prevClose: 425 } },
    { fx: 95.53, currencyOf: ccy, priceOf: px });
  near(partial.gain, 50, 'only the quoted holding contributes');
  eq(partial.quoted, 1, 'one of three');
  eq(partial.total, 3, 'out of three held');
  eq(partial.whole, false, 'and the figure does NOT describe the whole book');
  ok(partial.missing.includes('AAPL') && partial.missing.includes('GOLDBEES'),
    'the ones that did not report are named, not just counted');
  near(partial.covered, 68.1, 'and the share of the book it covers is stated', 0.5);

  // The percentage is of what was measured, and could not honestly be anything
  // else — but it must never be presented without the coverage beside it.
  near(partial.pct, 1.176, 'the percentage is of the quoted base', 0.01);
  ok(partial.pct > 0, 'which can point the OTHER WAY from the whole book — the reported bug');
}

// The sign really can flip. One holding up while the unquoted majority is down
// is exactly how −$7.63 and +$2.52 are both honest answers.
{
  const q = { MSFT: { change: 5, prevClose: 425 } };
  const up = dayPnl(BOOK, q, { fx: 95.53, currencyOf: ccy, priceOf: px });
  const down = dayPnl(BOOK, { ...q, AAPL: { change: -8, prevClose: 208 } },
    { fx: 95.53, currencyOf: ccy, priceOf: px });
  ok(up.gain > 0 && down.gain < 0,
    'the same book reports up or down depending only on which quotes arrived');
  ok(up.quoted < down.quoted, 'and the count is what tells you which to trust');
}

// ------------------------------------------------------------- no guessing

eq(dayPnl([], {}, {}).pct, null, 'an empty book has no day percentage — null, not 0%');
eq(dayPnl(BOOK, {}, { fx: 95.53, currencyOf: ccy, priceOf: px }).pct, null,
  'and neither does a book where nothing was quoted');
eq(dayPnl(BOOK, {}, { fx: 95.53, currencyOf: ccy, priceOf: px }).base, 0, 'with no base to divide by');

// A quote with a price but no previous close cannot produce a move. Treating
// the missing close as today's price would report exactly zero, which is a
// claim rather than an absence.
{
  const noPrev = dayPnl(BOOK, { MSFT: { change: 5 } }, { fx: 95.53, currencyOf: ccy, priceOf: px });
  eq(noPrev.quoted, 0, 'a quote with no previous close does not count');
  ok(noPrev.missing.includes('MSFT'), 'and is named as missing');
  const zeroPrev = dayPnl(BOOK, { MSFT: { change: 5, prevClose: 0 } }, { fx: 95.53, currencyOf: ccy, priceOf: px });
  eq(zeroPrev.quoted, 0, 'and a previous close of zero is not a previous close');
}

// ------------------------------------------------------------- currency

{
  // A rupee move is not a dollar move. GOLDBEES rising ₹1 is 12 rupees, about
  // twelve cents — not twelve dollars.
  const g = dayPnl([BOOK[2]], { GOLDBEES: { change: 1, prevClose: 120 } },
    { fx: 95.53, currencyOf: ccy, priceOf: px });
  near(g.gain, 12 / 95.53, 'the rupee move is converted');
  ok(g.gain < 1, 'and is cents, not dollars');

  // With no rate it is excluded and named, never converted at par.
  const noFx = dayPnl(BOOK, { GOLDBEES: { change: 1, prevClose: 120 } },
    { fx: null, currencyOf: ccy, priceOf: px });
  ok(noFx.excluded.includes('GOLDBEES'), 'with no rate the rupee holding is excluded');
  eq(noFx.base, 0, 'and contributes nothing rather than contributing wrongly');
}

// ------------------------------------------------------------- hostile

for (const [name, held, quotes] of [
  ['null rows', [null, undefined], {}],
  ['rows with no fields', [{}, {}], {}],
  ['zero quantity', [{ ticker: 'X', qty: 0, last_price: 10 }], { X: { change: 1, prevClose: 9 } }],
  ['NaN change', [{ ticker: 'X', qty: 1, last_price: 10 }], { X: { change: NaN, prevClose: 9 } }],
  ['NaN price', [{ ticker: 'X', qty: 1, last_price: NaN }], { X: { change: 1, prevClose: 9 } }],
]) {
  let threw = null, r = null;
  try { r = dayPnl(held.filter(Boolean), quotes, { fx: 95.53, currencyOf: ccy, priceOf: px }); }
  catch (e) { threw = e; }
  ok(threw == null, `dayPnl survives ${name}${threw ? `: ${threw.message}` : ''}`);
  if (r) ok(!Number.isNaN(r.gain) && !Number.isNaN(r.base), `${name} produces no NaN`);
}

console.log(`${pass}/${pass + fail} passing`);
if (fail) process.exit(1);
