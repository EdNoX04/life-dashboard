// Net worth, and the one mistake that would make it worthless.
//
// A total that has quietly absorbed something it could not value looks exactly
// like a correct total. This repo has already paid for that lesson once: the
// daily brief summed qty × price across currencies with no conversion, and a
// GOLDBEES position worth about fifteen dollars entered the brief as 1,479 —
// then the brief sorted by that number and called GOLDBEES the second largest
// holding. The right answer and the wrong one were the same digits.
//
// So most of what is tested here is refusal: what happens when a sleeve cannot
// be valued, and whether the number still claims to be net worth afterwards.

import {
  SLEEVES, SLEEVE_KEYS, sleeveOf, isLiability, normaliseEntry, daysOld,
  sleeves, netWorth, mix, drift, headline,
} from '../src/lib/wealth.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log('FAIL ' + n); } };
const eq = (a, b, n) => ok(Object.is(a, b), `${n} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const TODAY = '2026-09-13';
const BOOK = { base: 'INR', value: 500000, note: null };
const CRYPTO = { valueUsdt: 100, inrPerUsdt: 105.49, updated: '2026-09-12T00:00:00Z' };
const by = (list, k) => list.find(s => s.key === k);

// ------------------------------------------------------------ the shape
{
  eq(SLEEVES.filter(s => s.kind === 'liability').length, 1, 'debt is its own kind, not a negative asset');
  ok(isLiability('loans'), 'loans are a liability');
  ok(!isLiability('cash'), 'cash is not');
  eq(sleeveOf('nope'), null, 'an unknown sleeve is null rather than a guess');

  const e = normaliseEntry({ sleeve: 'loans', label: 'Education loan', amount: -250000 });
  eq(e.amount, 250000, 'a loan entered as negative and one entered as positive mean the same thing — the sign comes off and the SLEEVE decides direction');
  eq(normaliseEntry({ sleeve: 'made up' }).sleeve, 'other', 'an unknown sleeve falls into Other rather than vanishing');
  eq(normaliseEntry({ sleeve: 'cash', currency: 'rupees' }).currency, 'INR', 'a currency that is not a code falls back');
  eq(normaliseEntry({ sleeve: 'cash', at: 'march' }).at, null, 'and a date that is not a date is null, never today');
}

// =========================================================================
// THE RULE: UNVALUED IS EXCLUDED AND NAMED — NEVER ZERO, NEVER CONVERTED AT 1
// =========================================================================
{
  // The book priced in USD with no rate loaded.
  const s = sleeves({ book: { base: 'USD', value: 6000 }, fx: null, base: 'INR', today: TODAY });
  eq(by(s, 'equity').value, null, 'a book in another currency with no rate is NOT valued');
  ok(/no USD→INR rate/.test(by(s, 'equity').why), 'and says exactly what is missing');
  ok(by(s, 'equity').value !== 6000, 'it is emphatically not passed through at 1.0 — that is the GOLDBEES bug');

  const nw = netWorth(s);
  eq(nw.complete, false, 'so the net worth is not complete');
  ok(nw.excluded.some(e => e.key === 'equity'), 'with the sleeve named');
  eq(nw.net, 0, 'and the total contains only what was valued');

  // The book refusing to combine currencies is carried through, not re-derived.
  const mixedBook = { base: 'USD', value: null, note: 'Your book holds 2 currencies and the INR→USD rate has not loaded' };
  ok(/2 currencies/.test(by(sleeves({ book: mixedBook }), 'equity').why),
     "indiabook's own refusal is passed on word for word rather than restated");
}

// ------------------------------------------------- an empty sleeve is not a gap
{
  const s = sleeves({ book: BOOK, crypto: CRYPTO, entries: [], today: TODAY });
  const nw = netWorth(s);
  eq(nw.complete, true, 'holding no gold does not make the net worth incomplete');
  eq(nw.excluded.length, 0, 'a permanent warning is an invisible warning');
  eq(Math.round(nw.net), 510549, 'and the number is the book plus the crypto');
}

// ------------------------------------------------------ assets minus debt
{
  const s = sleeves({
    book: BOOK, crypto: CRYPTO, today: TODAY,
    entries: [
      { sleeve: 'cash', label: 'HDFC', amount: 120000, at: TODAY },
      { sleeve: 'retirement', label: 'EPF', amount: 80000, at: '2026-09-01' },
      { sleeve: 'loans', label: 'Education loan', amount: 300000, at: TODAY },
    ],
  });
  const nw = netWorth(s);
  eq(Math.round(by(s, 'crypto').value), 10549, 'crypto is valued at HIS OWN last P2P rate, the one he actually got');
  eq(nw.assets, 500000 + 120000 + 80000 + 10549, 'assets add up');
  eq(nw.liabilities, 300000, 'debt is counted');
  eq(nw.net, 410549, 'and SUBTRACTED — a net worth that omits the loans is the most flattering mistake this file could make');
  eq(nw.missingDebt, false, 'nothing about the debt is missing');
}

// -------------------------------------- a missing DEBT is louder than a missing asset
{
  const s = sleeves({ book: BOOK, crypto: CRYPTO, today: TODAY, entries: [{ sleeve: 'loans', label: 'Loan', amount: null }] });
  const nw = netWorth(s);
  eq(nw.missingDebt, true, 'an unvalued liability is flagged on its own');
  ok(nw.excluded.some(e => e.liability), 'and marked as the liability it is');
  // The direction of the error is the point: an unvalued asset makes you look
  // poorer, an unvalued debt makes you look richer.
  ok(nw.net >= 0, 'the number is still produced');
  eq(nw.complete, false, 'but never as the whole picture');
}

// ------------------------------- THE TRAP THIS FILE EXISTS TO AVOID, IN THIS FILE
{
  // indiabook's `num` is right for its own job and wrong for this one:
  // Number(null) and Number('') are both 0. A loan whose amount was never
  // filled in used to arrive here as ZERO DEBT — the exact failure this module
  // is built around, inside the module.
  for (const blank of [null, undefined, '', '   ']) {
    eq(normaliseEntry({ sleeve: 'loans', amount: blank }).amount, null,
       `an amount of ${JSON.stringify(blank)} is NOT zero — it is a thing nobody has told us yet`);
  }
  eq(normaliseEntry({ sleeve: 'cash', amount: 0 }).amount, 0, 'while a real zero survives — an empty account is an amount');
  eq(normaliseEntry({ sleeve: 'cash', amount: 'lots' }).amount, null, 'and a word is not an amount');
}

// ---------------------------------------------------------------- crypto
{
  eq(by(sleeves({ crypto: null }), 'crypto').value, null, 'no Binance sync means no crypto figure');
  ok(/has not synced/.test(by(sleeves({ crypto: null }), 'crypto').why), 'said plainly');
  ok(/not priced/.test(by(sleeves({ crypto: { valueUsdt: 100 } }), 'crypto').why),
     'and holdings known but unpriced is a DIFFERENT answer from holdings unknown');
}

// ------------------------------------------------------------------ staleness
{
  eq(daysOld('2026-09-01', TODAY), 12, 'ages are counted in days');
  eq(daysOld(null, TODAY), null, 'no date, no age');
  const s = sleeves({ today: TODAY, entries: [{ sleeve: 'cash', label: 'HDFC', amount: 5, at: '2026-01-01' }] });
  eq(by(s, 'cash').stale, true, 'a balance typed in January is flagged in September');
  ok(netWorth(s).stale.includes('Cash & bank'), 'and named on the total — it is not a lie, but it is not today either');
  const fresh = sleeves({ today: TODAY, entries: [{ sleeve: 'cash', label: 'HDFC', amount: 5, at: TODAY }] });
  eq(by(fresh, 'cash').stale, false, "today's balance is not stale");
}

// -------------------------------------------------------------------- the mix
{
  const s = sleeves({ book: BOOK, today: TODAY, entries: [
    { sleeve: 'cash', label: 'HDFC', amount: 500000 },
    { sleeve: 'loans', label: 'Loan', amount: 400000 },
  ] });
  const m = mix(s);
  eq(m.rows.length, 2, 'only valued assets are slices');
  eq(m.basis, 'assets', 'and the pie is of ASSETS — a debt is not a slice of one');
  eq(Math.round(m.rows[0].pct), 50, 'the split is of what was valued');
  ok(!m.rows.some(r => r.key === 'loans'), 'the loan is not in the pie');
  eq(mix([]).total, 0, 'an empty book is an empty pie, not a throw');
}

// =========================================================================
// DRIFT — and the target this app must never have
// =========================================================================
{
  const m = mix(sleeves({ book: BOOK, today: TODAY, entries: [{ sleeve: 'cash', label: 'HDFC', amount: 500000 }] }));

  const none = drift(m, null);
  eq(none.known, false, 'with NO target there is no drift figure');
  ok(/does not have an opinion/.test(none.why),
     'and the app says outright that it has no view on how his money should be split — a default target would be advice with arithmetic in front of it');
  eq(drift(m, {}).known, false, 'an empty target is still no target');
  eq(drift(m, { nonsense: 50 }).known, false, 'and a target naming no real sleeve is no target');

  const d = drift(m, { equity: 70, cash: 30 });
  eq(d.known, true, 'a target HE set produces a comparison');
  eq(Math.round(d.rows[0].diff), -20, 'the largest gap leads');
  const norm = drift(m, { equity: 140, cash: 60 });
  eq(Math.round(norm.rows[0].target), 70, 'a target that adds to 200 is read as the SHAPE he meant, not as everything being adrift');
  eq(norm.normalised, true, 'and it says it had to normalise');
}

// ------------------------------------------------------------- no advice
{
  const s = sleeves({ book: BOOK, crypto: CRYPTO, today: TODAY, entries: [
    { sleeve: 'cash', label: 'HDFC', amount: 900000 }, { sleeve: 'loans', label: 'Loan', amount: 50000 },
  ] });
  const words = JSON.stringify([s, netWorth(s), mix(s), drift(mix(s), { equity: 70, cash: 30 }), headline(netWorth(s))]).toLowerCase();
  ok(!/\b(buy|sell|should|consider|recommend|trim|add to|opportunity|underweight|overweight|rebalance now)\b/.test(words),
     'NOTHING anywhere reads as advice — the same ban notify.js is held to. Money is read-only');
}

// ------------------------------------------------------------------ headline
{
  const full = headline(netWorth(sleeves({ book: BOOK, today: TODAY })));
  ok(/₹5,00,000 net/.test(full), 'the headline is the number, grouped the way rupees are written');
  const partial = headline(netWorth(sleeves({ book: { base: 'USD', value: 6000 }, fx: null, today: TODAY })));
  ok(/left out/.test(partial), 'and when something could not be valued it says so in the headline, not in a footnote');
  eq(headline(null), '', 'nothing in, nothing out');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
