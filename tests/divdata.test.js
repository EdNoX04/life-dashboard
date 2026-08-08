// Pins the dividend-history parsing. The load-bearing distinction throughout is
// between "pays nothing" and "we could not find out" — opposite conclusions,
// only one of which is a reason to act.

import {
  STATUS, num, normalisePayment, normaliseHistory, ttm, runRate, cacheAge, TTL,
  realisedGrowth, medianExOffset, toDivMeta, toDivMetaAll, CADENCE_TO_FREQ,
} from '../src/lib/divdata.js';
import { normaliseEntry, FREQS } from '../src/lib/dividends.js';

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

// ------------------------------------------------- bridge to div_meta
// Six years of quarterly payments, rising 10% a year, so the CAGR is knowable.
const YEARS = [];
for (let y = 2020; y <= 2026; y++) {
  for (const [mo, day] of [['02', '06'], ['05', '08'], ['08', '07'], ['11', '06']]) {
    YEARS.push({
      ex: `${y}-${mo}-${day}`,
      pay: `${y}-${mo}-${String(Number(day) + 21).padStart(2, '0')}`,
      payEstimated: false,
      amount: Number((0.20 * Math.pow(1.1, y - 2020)).toFixed(4)),
    });
  }
}
YEARS.sort((a, b) => b.ex.localeCompare(a.ex));
const ENTRY = { status: STATUS.ok, rows: YEARS, at: 1700000000000 };

const g = realisedGrowth(YEARS);
near(g, 10, 'a dividend rising 10% a year reports a 10% CAGR', 0.001);
// Partial years at either end would turn a flat dividend into a fake trend.
eq(realisedGrowth(YEARS.slice(0, 3)), null, 'too little history to state a growth rate');
// Exactly three years on record: after dropping the ragged ends there is one
// year left, so there is no span to compound over and the answer must be null
// rather than a growth rate derived from a single point.
const THREE = [
  { ex: '2024-11-06', pay: '2024-11-27', payEstimated: false, amount: 0.30 },
  { ex: '2023-11-06', pay: '2023-11-27', payEstimated: false, amount: 0.25 },
  { ex: '2022-11-06', pay: '2022-11-27', payEstimated: false, amount: 0.20 },
];
eq(realisedGrowth(THREE), null, 'three years collapse to a single year and yield no rate');
// Two years cannot even do that.
eq(realisedGrowth(THREE.slice(0, 2)), null, 'two years yield no rate either');
eq(realisedGrowth([]), null, 'no history, no growth rate');
// A flat dividend is 0% growth, not null — that IS knowable.
const FLAT = YEARS.map(r => ({ ...r, amount: 0.25 }));
near(realisedGrowth(FLAT), 0, 'a flat dividend reports zero growth', 1e-9);

// A history that starts and ends mid-year, which is what a real one looks like.
// A perfectly rectangular fixture cannot tell whether the partial end years are
// being excluded, and excluding them is the entire point of the function.
const RAGGED = [
  // 2020: only ONE payment on record — a partial first year.
  { ex: '2020-11-06', pay: '2020-11-27', payEstimated: false, amount: 0.20 },
  // 2021..2024: four each, flat at 0.20, so the true CAGR is exactly 0.
  ...[2021, 2022, 2023, 2024].flatMap(y => ['02', '05', '08', '11'].map(mo => ({
    ex: `${y}-${mo}-06`, pay: `${y}-${mo}-27`, payEstimated: false, amount: 0.20,
  }))),
  // 2025: THREE payments — a partial last year, and deliberately a different
  // size of partial from 2020's one, so including the ragged ends produces a
  // visibly wrong answer rather than accidentally the right one.
  { ex: '2025-02-06', pay: '2025-02-27', payEstimated: false, amount: 0.20 },
  { ex: '2025-05-06', pay: '2025-05-27', payEstimated: false, amount: 0.20 },
  { ex: '2025-08-06', pay: '2025-08-27', payEstimated: false, amount: 0.20 },
].sort((a, b) => b.ex.localeCompare(a.ex));
// Including the partial ends would compare 0.20 against 0.80 and report a
// collapse that never happened.
near(realisedGrowth(RAGGED), 0, 'a flat dividend with ragged end years still reports zero growth', 1e-9);

eq(medianExOffset(YEARS), 21, 'the ex-to-pay gap is read from the payments');
// A mixture of real and estimated pay dates: the estimated ones have a gap of
// zero by construction, and counting them would halve the median.
const MIXED = [
  { ex: '2026-05-08', pay: '2026-05-29', payEstimated: false },
  { ex: '2026-02-06', pay: '2026-02-27', payEstimated: false },
  { ex: '2025-11-07', pay: '2025-11-07', payEstimated: true },
  { ex: '2025-08-08', pay: '2025-08-08', payEstimated: true },
  { ex: '2025-05-08', pay: '2025-05-08', payEstimated: true },
];
eq(medianExOffset(MIXED), 21, 'estimated pay dates do not drag the median toward zero');
// A corrupt row whose pay date precedes its ex-date must be dropped, not
// counted as a negative gap. This is what makes the `d > 0` guard load-bearing
// rather than a duplicate of the estimated-date check.
eq(medianExOffset([
  { ex: '2026-05-08', pay: '2026-05-29', payEstimated: false },
  { ex: '2026-02-06', pay: '2026-02-27', payEstimated: false },
  { ex: '2025-11-07', pay: '2025-10-01', payEstimated: false },
]), 21, 'a pay date before its ex-date is discarded');
eq(medianExOffset([]), null, 'no payments, no offset');
// Estimated pay dates must not contribute — their gap is zero by construction.
eq(medianExOffset([{ ex: '2026-01-01', pay: '2026-01-01', payEstimated: true }]), null,
  'an estimated pay date is excluded from the offset');

const M = toDivMeta(ENTRY);
near(M.perShare, YEARS[0].amount, 'the rate is the LATEST payment, not an average');
eq(M.freq, 'quarterly', 'the cadence translates to a div_meta frequency');
ok(FREQS.some(f => f.key === M.freq), 'and it is a frequency div_meta recognises');
eq(M.exOffsetDays, 21, 'the ex-offset comes from the history');
eq(M.anchorMonth, 10, 'the anchor month is the latest pay month (November = 10)');
eq(M.payDay, 27, 'and the pay day is that payment-s day');
near(M.growthPct, 10, 'realised growth is carried across', 0.1);
eq(M.source, 'fmp', 'the entry records where it came from');
ok(M.note.includes('Financial Modeling Prep'), 'and says so in the note');
// The bridge must produce something div_meta accepts without alteration.
const round = normaliseEntry(M);
eq(round.freq, M.freq, 'div_meta normalisation preserves the frequency');
near(round.perShare, M.perShare, 'and the rate');
eq(round.exOffsetDays, M.exOffsetDays, 'and the ex-offset');
eq(round.declared.length, M.declared.length, 'and the declared list');

// Declared payments are trimmed to the projection window and sorted forwards.
ok(M.declared.length > 0 && M.declared.length < YEARS.length, 'old payments are trimmed');
ok(M.declared[0].pay < M.declared[M.declared.length - 1].pay, 'declared payments run forwards');
ok(M.declared.every(d => d.perShare > 0), 'every declared payment carries an amount');

// A falling dividend must not be projected forwards as a compounding decline.
// YEARS is newest-first, so a FALLING dividend means the amount RISES with the
// index. Getting this backwards is easy and would have made the fixture test
// the opposite of what it claims.
const FALLING = YEARS.map((r, i) => ({ ...r, amount: 0.20 + i * 0.005 }));
const mf = toDivMeta({ status: STATUS.ok, rows: FALLING, at: 1 });
eq(mf.growthPct, 0, 'a falling dividend projects flat, not shrinking to nothing');
ok(mf.note.includes('negative'), 'and the note says why');

// Anything that did not fetch cleanly produces nothing, so a merge cannot erase.
eq(toDivMeta({ status: STATUS.failed, rows: [] }), null, 'a failed fetch bridges to nothing');
eq(toDivMeta({ status: STATUS.none, rows: [] }), null, 'a no-dividend result bridges to nothing');
eq(toDivMeta(null), null, 'a null entry bridges to nothing');
eq(toDivMeta({ status: STATUS.ok, rows: [] }), null, 'an ok status with no rows bridges to nothing');

const all = toDivMetaAll({ AAPL: ENTRY, BAD: { status: STATUS.failed, rows: [] } });
eq(Object.keys(all).length, 1, 'only clean fetches make it into the bridge output');
eq(Object.keys(all)[0], 'AAPL', 'and it is the right one');
eq(Object.keys(toDivMetaAll({})).length, 0, 'an empty store bridges to an empty object');
eq(CADENCE_TO_FREQ['semi-annual'], 'semiannual', 'the cadence names map across the spelling difference');

console.log(`${pass}/${pass + fail} passing`);
if (fail) process.exit(1);
