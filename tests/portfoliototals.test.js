// The dashboard tile said $7,307.85 and the Money tab said $6,208.91 for the
// same portfolio at the same moment.
//
// The gap was ₹1,098.94 exactly — nine units of GOLDBEES at about ₹122 — which
// the dashboard added to a dollar total as though ₹122 were $122. Money.jsx had
// been fixed for this months earlier; HQ.jsx had not, because each file worked
// the total out for itself. That is the actual defect being tested here: not
// the arithmetic, which is easy, but the fact that one question had two
// implementations and a fix to one left the other confidently wrong.
//
// So these tests pin the behaviour of the single shared function, and the two
// screens now both call it.

import { portfolioTotals } from '../src/lib/holdings.js';

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; } else { fail++; console.log('FAIL ' + name); } };
const eq = (a, b, name) => ok(a === b, `${name} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
const near = (a, b, name, tol = 0.01) =>
  ok(a != null && Math.abs(a - b) < tol, `${name} (got ${a}, want ${b})`);

const currencyOf = h => (h.currency === 'INR' || h.ticker === 'GOLDBEES' ? 'INR' : 'USD');
const priceOf = h => Number(h.price);

// A US position and the rupee ETF that caused the discrepancy.
const HELD = [
  { ticker: 'SCHD', qty: 100, price: 28.0, avg_cost: 26.0 },
  { ticker: 'GOLDBEES', qty: 9, price: 122.11, avg_cost: 100.0 },
];
const FX = 87.5;

// ------------------------------------------------- the bug, stated as a number

const withFx = portfolioTotals(HELD, { priceOf, fx: FX, currencyOf });
near(withFx.value, 2800 + (9 * 122.11) / FX, 'the rupee position is converted, not counted at par');
near(withFx.value, 2812.56, 'which is $2,812.56, not $3,899.05');
eq(withFx.excludedInr, 0, 'nothing is excluded when the rate is known');

// The old arithmetic, for contrast: this is the number the dashboard printed.
const naive = HELD.reduce((s, h) => s + h.qty * h.price, 0);
near(naive, 3898.99, 'summing qty x price with no currency check gives $3,898.99');
ok(naive - withFx.value > 1000, 'a single rupee holding shifted the total by over a thousand dollars');

// ------------------------------------------------------ no rate is not par 1.0

const noFx = portfolioTotals(HELD, { priceOf, fx: null, currencyOf });
near(noFx.value, 2800, 'with no rate the rupee row is EXCLUDED, not converted at 1.0');
eq(noFx.excludedInr, 1, 'and the exclusion is counted so the screen can admit the gap');

// The alternative — treating a missing rate as 1.0 — would produce the naive
// total again, silently. This asserts the total is nowhere near it.
ok(Math.abs(noFx.value - naive) > 1000, 'a missing rate never quietly becomes par');

// --------------------------------------------------------------- cost and P&L

near(withFx.cost, 2600 + 900 / FX, 'cost is converted per holding too, not just value');
near(withFx.pnl, withFx.value - withFx.cost, 'P&L is value less cost');
near(withFx.pnlPct, (withFx.pnl / withFx.cost) * 100, 'and the percentage is off the converted cost');

// A holding excluded from value must ALSO be excluded from cost. Dropping it
// from one side only would compute a real value against a phantom cost and
// report a wild percentage — which is how a 6.38% and a 25.21% appeared next to
// each other on the two screens.
near(noFx.cost, 2600, 'an excluded holding leaves the cost side too');
near(noFx.pnlPct, ((2800 - 2600) / 2600) * 100, 'so the percentage stays coherent');

// ------------------------------------------------------------- degenerate input

const empty = portfolioTotals([], { priceOf, fx: FX, currencyOf });
eq(empty.value, 0, 'no holdings, no value');
eq(empty.pnlPct, 0, 'and no division by a zero cost');

const zeroCost = portfolioTotals([{ ticker: 'X', qty: 1, price: 10, avg_cost: 0 }], { priceOf, fx: FX, currencyOf });
eq(zeroCost.pnlPct, 0, 'a zero cost basis reports 0%, not Infinity');
near(zeroCost.value, 10, 'though the value is still counted');

// Both screens pass the same three arguments, so the same inputs must give
// byte-identical output. This is the property that was missing.
const a = portfolioTotals(HELD, { priceOf, fx: FX, currencyOf });
const b = portfolioTotals(HELD, { priceOf, fx: FX, currencyOf });
eq(JSON.stringify(a), JSON.stringify(b), 'the same inputs give the same totals every time');

console.log(`${pass}/${pass + fail} passing`);
if (fail) process.exit(1);
