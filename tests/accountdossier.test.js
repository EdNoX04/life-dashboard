// The single-account screen.
//
// Two bugs prompted this, and only one of them was visible.
//
// THE ONE THAT WAS REPORTED: the screen had two scope controls — the tab strip
// above it and a second row inside the card — holding separate state that never
// spoke. Choosing INDstocks at the top left the card listing every account,
// including the US one, and printing "INDmoney US holds 81% of everything"
// under a header that said INDstocks. Two sources of truth for one question.
//
// THE ONE THAT WAS NOT: the rows fed to that screen were never converted to a
// single currency, while every other total on the tab was. A rupee marketValue
// and a dollar one are both just numbers, so they summed without complaint and
// a ₹1,455 position counted as though it were $1,455 — roughly ninety times its
// real weight. That is the same bug lib/indiabook.js was written to kill, in a
// screen nobody thought to check, and it is invisible: the total looks fine.
//
// So the assertions below are mostly about the second kind of failure: numbers
// that are wrong in a way that leaves no trace.

import {
  accountDossier, accountTotals, UNASSIGNED, filterRows,
} from '../src/lib/accounts.js';

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; } else { fail++; console.log('FAIL ' + name); } };
const eq = (a, b, name) => ok(a === b, `${name} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
const near = (a, b, name, tol = 0.01) => ok(a != null && Math.abs(a - b) < tol, `${name} (got ${a}, want ${b})`);

// Everything already converted to dollars by the caller — which is the contract,
// and the thing that was not happening.
const ROWS = [
  { ticker: 'GOLDBEES', marketValue: 16.5, invested: 16.1, dayGain: 0.2, currency: 'INR' },
  { ticker: 'VOO', marketValue: 860, invested: 1950, dayGain: 5 },
  { ticker: 'MSFT', marketValue: 211, invested: 407, dayGain: 1 },
  { ticker: 'LOOSE', marketValue: 100, invested: null, dayGain: 0 },
];
const MAP = { GOLDBEES: 'indstocks', VOO: 'indmoney-us', MSFT: 'indmoney-us' };
const ACCTS = [
  { id: 'indstocks', label: 'INDstocks', kind: 'broker' },
  { id: 'indmoney-us', label: 'INDmoney US', kind: 'broker' },
];

// ------------------------------------------------- one scope, one answer

eq(accountDossier(ROWS, MAP, ACCTS, 'all'), null, 'the combined view has no dossier — it is a different screen');
eq(accountDossier(ROWS, MAP, ACCTS, null), null, 'and neither does a missing scope');

const ind = accountDossier(ROWS, MAP, ACCTS, 'indstocks');
eq(ind.account.label, 'INDstocks', 'the chosen account is named');
eq(ind.holdings.length, 1, 'and holds exactly its own holdings');
ok(!ind.holdings.some(h => h.ticker === 'VOO'), 'the US holdings are NOT in it — the reported bug');
ok(!ind.holdings.some(h => h.ticker === 'LOOSE'), 'and neither is anything unassigned');

const us = accountDossier(ROWS, MAP, ACCTS, 'indmoney-us');
eq(us.holdings.length, 2, 'the other account holds the other two');
eq(us.holdings[0].ticker, 'VOO', 'largest first');

// ---------------------------------------------------------- two weights

// The failure a single "weight" column hides: GOLDBEES is all of its account
// and almost none of the book, and either number alone reads as the other.
near(ind.holdings[0].weightInAccount, 100, 'a lone holding is 100% of its account');
near(ind.holdings[0].weightOfBook, 1.39, 'and about 1.4% of everything owned');
ok(ind.holdings[0].weightInAccount !== ind.holdings[0].weightOfBook,
  'the two weights are different numbers and both are reported');
near(ind.shareOfBook, 1.39, 'the account share of the book matches its one holding');

// The currency bug, stated as arithmetic. If the caller ever stops converting,
// this is the shape the numbers take.
{
  const UNCONVERTED = [
    { ticker: 'GOLDBEES', marketValue: 1455, currency: 'INR' },   // rupees, unconverted
    { ticker: 'VOO', marketValue: 860 },
  ];
  const bad = accountDossier(UNCONVERTED, MAP, ACCTS, 'indstocks');
  ok(bad.shareOfBook > 60,
    'unconverted, one small rupee position claims most of the book — which is how the bug looked on screen');
  const good = accountDossier(ROWS, MAP, ACCTS, 'indstocks');
  ok(good.shareOfBook < 2, 'converted, it is the fraction it really is');
  ok(bad.shareOfBook / good.shareOfBook > 40,
    'the two differ by roughly the exchange rate, which is the tell');
}

// ------------------------------------------------------ share of book

const withBook = accountDossier(ROWS, MAP, ACCTS, 'indstocks', { bookTotal: 2000 });
near(withBook.shareOfBook, 0.825, 'an explicit book total is used when given');
eq(withBook.bookTotal, 2000, 'and reported, so the denominator is visible');
// A book total the caller could not compute must not silently become zero and
// turn every share into 0%.
const noBook = accountDossier(ROWS, MAP, ACCTS, 'indstocks', { bookTotal: null });
ok(noBook.shareOfBook > 0, 'a null book total falls back to summing the rows, not to zero');

// ------------------------------------------------------ the loose pile

const loose = accountDossier(ROWS, MAP, ACCTS, UNASSIGNED);
eq(loose.holdings.length, 1, 'unassigned is a scope like any other');
eq(loose.holdings[0].ticker, 'LOOSE', 'holding what belongs to no account');
eq(loose.account.unassigned, true, 'and flagged, so the screen can say what it is');
ok(/still in every total/.test(loose.account.note), 'with a note saying it is not excluded from anything');

// An account that was deleted while scoped to it must not blank the screen.
const gone = accountDossier(ROWS, { X: 'ghost' }, ACCTS, 'ghost');
eq(gone.account.missing, true, 'a scope pointing at a deleted account is marked missing');
eq(gone.empty, true, 'and reports itself empty rather than throwing');

// ------------------------------------------------------- concentration

eq(ind.concentration.count, 1, 'a one-holding account has one holding');
near(ind.concentration.effectiveN, 1, 'and an effective count of one');
near(ind.concentration.top1, 100, 'its largest is all of it');
near(us.concentration.effectiveN, 1.46, 'a two-holding account spreads a little further');
ok(us.concentration.top1 > 75, 'though it is still mostly one name');

// ---------------------------------------------------------- currencies

eq(ind.currencies.length, 1, 'a single-currency account reports one');
eq(ind.currencies[0].code, 'INR', 'named correctly off the row');
eq(ind.mixed, false, 'and is not mixed');
{
  const mixedRows = [
    { ticker: 'A', marketValue: 100, currency: 'INR' },
    { ticker: 'B', marketValue: 300 },
  ];
  const m = accountDossier(mixedRows, { A: 'x', B: 'x' }, [{ id: 'x', label: 'Mixed', kind: 'broker' }], 'x');
  eq(m.mixed, true, 'an account holding both currencies is flagged as mixed');
  eq(m.currencies.length, 2, 'with both listed');
  near(m.currencies[0].pct, 75, 'and their shares of the account given');
  eq(m.currencies[0].code, 'USD', 'largest first');
}

// ----------------------------------------------------- missing cost basis

// A holding with no cost is not a holding that cost nothing. The return figures
// must cover only the rows that have one, and say so.
eq(loose.totals.unrealised, null, 'an account of unpriced holdings has no unrealised figure');
ok(/no cost basis/.test(loose.totals.costNote || ''), 'and says why rather than printing a dash');
eq(us.totals.unknownCost, 0, 'an account where every cost is known says so');

// --------------------------------------------------------------- hostile

{
  const CASES = [
    ['no rows', [], MAP, ACCTS, 'indstocks'],
    ['no map', ROWS, {}, ACCTS, 'indstocks'],
    ['no accounts', ROWS, MAP, [], 'indstocks'],
    ['rows missing fields', [{}, {}], { undefined: 'indstocks' }, ACCTS, 'indstocks'],
    ['NaN values', [{ ticker: 'X', marketValue: NaN }], { X: 'indstocks' }, ACCTS, 'indstocks'],
    ['negative value', [{ ticker: 'X', marketValue: -50 }], { X: 'indstocks' }, ACCTS, 'indstocks'],
  ];
  for (const [name, r, m, a, sc] of CASES) {
    let threw = null, d = null;
    try { d = accountDossier(r, m, a, sc); } catch (e) { threw = e; }
    ok(threw == null, `the dossier survives ${name}${threw ? `: ${threw.message}` : ''}`);
    if (!d) continue;
    ok(!Number.isNaN(d.shareOfBook), `${name} produces no NaN share`);
    ok(d.holdings.every(h => !Number.isNaN(h.weightInAccount)), `${name} produces no NaN weight`);
  }
  // An empty account is empty, not broken — you can create one before assigning.
  const blank = accountDossier([], {}, ACCTS, 'indstocks');
  eq(blank.empty, true, 'a freshly created account reports itself empty');
  eq(blank.totals.count, 0, 'with nothing in it');
  eq(blank.concentration.effectiveN, null, 'and no effective count, rather than zero or one');
}

console.log(`${pass}/${pass + fail} passing`);
if (fail) process.exit(1);
