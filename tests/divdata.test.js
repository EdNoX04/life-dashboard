// Pins the dividend-history parsing. The load-bearing distinction throughout is
// between "pays nothing" and "we could not find out" — opposite conclusions,
// only one of which is a reason to act.

import {
  STATUS, num, normalisePayment, normaliseHistory, ttm, runRate, cacheAge, TTL,
} from '../src/lib/divdata.js';

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; } else { fail++; console.log('FAIL ' + name); } };
const eq = (a, b, name) => ok(a === b, `${name} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
const near = (a, b, name, tol = 1e-6) =>
  ok(a != null && Math.abs(a - b) < tol, `${name} (got ${a}, want ~${b})`);

// -------------------------------------------------------------- statuses
eq(Object.keys(STATUS).length, 5, 'five closed statuses');
ok(STATUS.none !== STATUS.failed, 'declaring nothing is not the same as failing to find out');
ok(STATUS.nokey !== STATUS.failed, 'an unconfigured key is not a failure either');

eq(num('1.5'), 1.5, 'numeric strings parse');
eq(num(null), null, 'null is not zero');
eq(num(''), null, 'empty string is not zero');
eq(num('x'), null, 'nonsense is null');

// ------------------------------------------------------------- payments
const P = normalisePayment({ date: '2026-05-08', paymentDate: '2026-05-29', declarationDate: '2026-04-30', recordDate: '2026-05-09', adjDividend: 0.24, dividend: 0.24 });
eq(P.ex, '2026-05-08', 'the ex-date is read');
eq(P.pay, '2026-05-29', 'the pay date is read');
near(P.amount, 0.24, 'the amount is read');
eq(P.payEstimated, false, 'a real pay date is not flagged as estimated');
eq(P.record, '2026-05-09', 'the record date carries through');

// The fallback that must never be silent: pay date missing.
const noPay = normalisePayment({ date: '2026-05-08', dividend: 0.24 });
eq(noPay.pay, '2026-05-08', 'a missing pay date falls back to the ex-date');
eq(noPay.payEstimated, true, 'and is FLAGGED, because it is wrong by weeks');

// adjDividend wins over dividend when both exist — it is the split-adjusted one.
near(normalisePayment({ date: '2026-01-01', adjDividend: 0.5, dividend: 2 }).amount, 0.5,
  'the adjusted amount is preferred');

eq(normalisePayment({ date: '2026-01-01', dividend: 0 }), null, 'a zero payment is not a payment');
eq(normalisePayment({ date: '2026-01-01', dividend: -1 }), null, 'a negative payment is refused');
eq(normalisePayment({ dividend: 0.5 }), null, 'a payment with no date is unusable');
eq(normalisePayment({ date: 'soon', dividend: 0.5 }), null, 'an unparseable date is refused');
eq(normalisePayment(null), null, 'a null record is null');
// A timestamp rather than a bare date must still yield a date.
eq(normalisePayment({ date: '2026-05-08T00:00:00Z', dividend: 0.24 }).ex, '2026-05-08',
  'a timestamp is trimmed to its date');

// -------------------------------------------------------------- history
const RAW = {
  historical: [
    { date: '2026-05-08', paymentDate: '2026-05-29', adjDividend: 0.26 },
    { date: '2026-02-06', paymentDate: '2026-02-27', adjDividend: 0.25 },
    { date: '2026-02-06', paymentDate: '2026-02-27', adjDividend: 0.25 },  // dupe
    { date: '2025-11-07', paymentDate: '2025-11-28', adjDividend: 0.25 },
    { date: '2025-08-08', paymentDate: '2025-08-29', adjDividend: 0.24 },
    { date: 'garbage', adjDividend: 0.24 },
  ],
};
const H = normaliseHistory(RAW);
eq(H.length, 4, 'duplicates and unusable rows are dropped');
eq(H[0].ex, '2026-05-08', 'newest first');
eq(H[3].ex, '2025-08-08', 'oldest last');
// A bare array is also accepted — the API has returned both shapes.
eq(normaliseHistory([{ date: '2026-01-01', dividend: 1 }]).length, 1, 'a bare array parses too');
// Decision: an unrecognised payload is NULL, not an empty list. An empty list
// would be a claim that the company pays nothing.
eq(normaliseHistory({ error: 'nope' }), null, 'an unrecognised payload is null, not empty');
eq(normaliseHistory(null), null, 'a null payload is null');
eq(normaliseHistory({ historical: [] }).length, 0, 'an explicitly empty history IS empty');

// ------------------------------------------------------------------ ttm
const ASOF = new Date('2026-06-01T00:00:00Z');
const t = ttm(H, ASOF);
near(t.total, 0.26 + 0.25 + 0.25 + 0.24, 'TTM sums the last four payments');
eq(t.count, 4, 'and counts them');
eq(t.complete, true, 'four payments is a complete year');
// A part-year history must say so rather than reporting a halved yield.
const partial = ttm(H.slice(0, 2), ASOF);
eq(partial.count, 2, 'a part-year history counts what it has');
eq(partial.complete, false, 'and is flagged incomplete');
eq(ttm([], ASOF).total, 0, 'no payments sum to zero');
eq(ttm([], ASOF).complete, false, 'but that is explicitly not a complete year');
// Payments older than a year are excluded.
eq(ttm(H, new Date('2027-06-01T00:00:00Z')).count, 0, 'a year later, none of these are in the TTM');

// -------------------------------------------------------------- run rate
const rr = runRate(H);
eq(rr.cadence, 'quarterly', 'roughly-90-day gaps read as quarterly');
eq(rr.payments, 4, 'and annualise to four payments');
near(rr.perShare, 0.26, 'the run rate uses the LATEST payment, not the average');
near(rr.perYear, 0.26 * 4, 'annualised at the observed cadence');
// The forward figure exceeds TTM after a raise, which is the whole point.
ok(rr.perYear > t.total, 'a recent raise makes the forward rate exceed TTM');
// One payment cannot establish a cadence and must not pretend to.
const one = runRate([H[0]]);
eq(one.perYear, null, 'a single payment yields no annual figure');
ok(one.reason.includes('cadence'), 'and says why');
eq(runRate([]), null, 'no payments, no run rate');
// Monthly and annual payers are classified too.
const monthly = [
  { ex: '2026-05-01', amount: 0.1 }, { ex: '2026-04-01', amount: 0.1 },
  { ex: '2026-03-01', amount: 0.1 }, { ex: '2026-02-01', amount: 0.1 },
];
eq(runRate(monthly).cadence, 'monthly', 'monthly gaps read as monthly');
eq(runRate(monthly).payments, 12, 'and annualise to twelve');
const annual = [
  { ex: '2026-05-01', amount: 2 }, { ex: '2025-05-01', amount: 2 }, { ex: '2024-05-01', amount: 2 },
];
eq(runRate(annual).cadence, 'annual', 'yearly gaps read as annual');
eq(runRate(annual).payments, 1, 'and annualise to one');
// The median must survive one anomalous gap.
const withGap = [
  { ex: '2026-05-01', amount: 1 }, { ex: '2026-02-01', amount: 1 },
  { ex: '2025-11-01', amount: 1 }, { ex: '2021-01-01', amount: 1 },
];
eq(runRate(withGap).cadence, 'quarterly', 'one huge gap does not drag the median off quarterly');

// ------------------------------------------------------------------ cache
eq(cacheAge({}), null, 'an empty cache has no age');
eq(cacheAge({ A: { at: null } }), null, 'entries with no timestamp do not count');
ok(cacheAge({ A: { at: Date.now() - 1000 } }) >= 1000, 'the age is measured from the newest entry');
ok(cacheAge({ A: { at: Date.now() - 5e6 }, B: { at: Date.now() - 1000 } }) < 2000,
  'and it is the NEWEST, not the oldest');
eq(TTL, 7 * 24 * 3600e3, 'the cache holds for a week');

console.log(`${pass}/${pass + fail} passing`);
if (fail) process.exit(1);
