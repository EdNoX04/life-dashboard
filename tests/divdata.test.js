// Pins the dividend-history parsing. The load-bearing distinction throughout is
// between "pays nothing" and "we could not find out" — opposite conclusions,
// only one of which is a reason to act.

import {
  STATUS, num, normalisePayment, normaliseHistory, ttm, runRate, cacheAge, TTL,
  BASE, LEGACY_BASE, isFetchable, FAIL_TTL, entryTtl, fmpSymbol,
  realisedGrowth, medianExOffset, toDivMeta, toDivMetaAll, CADENCE_TO_FREQ,
  byYear, completeYears, cagr, growthStreak, payoutRatios, payoutSummary,
  sharesBefore, holdingPeriod, receivedHistory, receivedTotals, projectForward,
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
// The stable endpoint nests under `data` in some responses.
eq(normaliseHistory({ data: [{ date: '2026-01-01', dividend: 1 }] }).length, 1,
  'a data-wrapped payload parses');
// FMP answers a symbol it holds no dividend data for with an empty OBJECT or a
// null wrapper rather than an empty array. Those must read as "declares
// nothing", not as a garbled response — conflating them turned every non-payer
// into a red failure while the request had actually succeeded.
eq(normaliseHistory({}), null, 'a bare empty object is not a payment list on its own');
eq(normaliseHistory({ historical: null }), null, 'nor is a null wrapper');
// The fetch layer classifies those as empty before calling normaliseHistory —
// these assertions pin that normaliseHistory itself stays strict, so the
// emptiness decision lives in exactly one place.
eq(normaliseHistory([]).length, 0, 'an empty array IS an empty payment list');

// The endpoint that actually works. v3 answers 403 for keys issued after the
// migration, which reads as a bad key rather than a moved endpoint.
ok(BASE.endsWith('/stable'), 'the stable endpoint is the primary');
ok(LEGACY_BASE.includes('/api/v3'), 'and v3 is kept only as a fallback');

// Non-US listings are not fetched at all: the free plan cannot answer for them,
// and twenty guaranteed failures look exactly like a broken key.
eq(isFetchable({ ticker: 'AAPL', currency: 'USD' }), true, 'a US holding is fetchable');
eq(isFetchable({ ticker: 'NVDA' }), true, 'a holding with no currency is treated as US');
eq(isFetchable({ ticker: 'GOLDBEES', currency: 'INR' }), false, 'a rupee holding is skipped');
eq(isFetchable({ ticker: 'GOLDBEES', currency: 'inr' }), false, 'case-insensitively');

// FMP writes share classes with a hyphen; INDmoney writes a dot. One character,
// and the difference between a full history and a hard failure.
eq(fmpSymbol('BRK.B'), 'BRK-B', 'a dotted share class becomes hyphenated');
eq(fmpSymbol('brk.b'), 'BRK-B', 'and upper-cases');
eq(fmpSymbol('AAPL'), 'AAPL', 'an ordinary ticker is unchanged');
eq(fmpSymbol('BF.A'), 'BF-A', 'any dotted class converts');
eq(fmpSymbol(''), '', 'an empty symbol stays empty');

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
eq(TTL, 7 * 24 * 3600e3, 'a successful fetch is cached for a week');

// THE BUG THAT MADE A FIXED ENDPOINT LOOK BROKEN. A cached failure held for the
// full week meant FETCH short-circuited and never called the API again — twenty
// visible errors while the provider reported zero requests, because no request
// was made. Shipping a fix changed nothing, because the fix was never reached.
eq(entryTtl({ status: STATUS.failed }), FAIL_TTL, 'a failure is cached only briefly');
ok(FAIL_TTL < TTL / 100, 'and that window is far shorter than a success');
ok(FAIL_TTL > 0, 'but not zero, so a loop cannot hammer the API');
eq(entryTtl({ status: STATUS.ok }), TTL, 'a success is cached hard');
eq(entryTtl({ status: STATUS.none }), TTL, 'so is a confirmed no-dividend answer');
// A missing key is a setup state, not a result, and must clear the moment one
// is saved rather than a week later.
eq(entryTtl({ status: STATUS.nokey }), 0, 'a no-key entry is never treated as fresh');
eq(entryTtl(null), 0, 'nothing cached is never fresh');

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

// ------------------------------------------------------ payment history
// Flat 0.20 quarterly 2021-2024, one payment in 2020, three in 2025.
const YR = byYear(RAGGED, 2026);
eq(YR.length, 6, 'six calendar years on record');
eq(YR[0].year, 2020, 'years run oldest first');
eq(YR[0].count, 1, 'the first year holds one payment');
eq(YR[0].partial, true, 'and is flagged partial');
eq(YR[1].partial, false, 'a full four-payment year is not partial');
near(YR[1].total, 0.80, 'a full year sums its four payments');
// The trap: 2025 has three payments and must not read as a 25% cut.
eq(YR[5].partial, true, 'a short final year is flagged partial');
eq(YR[5].yoy, null, 'and reports no year-on-year, rather than a fake cut');
// A flat dividend across two full years is 0% YoY, which IS knowable.
near(YR[2].yoy, 0, 'two complete flat years give zero YoY', 1e-9);
eq(completeYears(YR).length, 4, 'four complete years');
// The CURRENT year is always partial, whatever it holds.
eq(byYear(RAGGED, 2022).find(y => y.year === 2022).partial, true,
  'the current year is partial by definition');

// ------------------------------------------------------------------ cagr
const RISING = byYear(YEARS, 2027);
const c5 = cagr(RISING, 5);
near(c5.pct, 10, 'a dividend rising 10% a year reports a 10% CAGR', 0.001);
eq(c5.short, false, 'with enough history the window is not short');
// Asking for more history than exists must say so rather than silently
// relabelling a shorter measurement.
const c10 = cagr(RISING, 10);
eq(c10.short, true, 'a 10Y window over less history is flagged short');
ok(c10.years < 10, 'and reports the span it actually measured');
eq(cagr([], 5), null, 'no years, no CAGR');
eq(cagr(byYear(RAGGED.slice(0, 4), 2026), 5), null, 'one usable year yields no CAGR');
// Non-uniform growth: flat for years, then a jump. A 3Y window and a 6Y window
// must give DIFFERENT answers, or the span argument is doing nothing.
const UNEVEN = byYear([
  ...['2019', '2020', '2021', '2022'].flatMap(y => ['02', '05', '08', '11'].map(mo => ({
    ex: `${y}-${mo}-06`, pay: `${y}-${mo}-27`, payEstimated: false, amount: 0.10,
  }))),
  ...['2023', '2024', '2025'].flatMap(y => ['02', '05', '08', '11'].map(mo => ({
    ex: `${y}-${mo}-06`, pay: `${y}-${mo}-27`, payEstimated: false, amount: 0.40,
  }))),
], 2026);
const short3 = cagr(UNEVEN, 3);
const long6 = cagr(UNEVEN, 6);
ok(short3.pct !== long6.pct, 'a 3Y and a 6Y window measure different things');
eq(short3.from, 2022, 'the 3Y window starts three complete years back');
eq(long6.from, 2019, 'the 6Y window reaches the start of the record');
ok(short3.pct > long6.pct, 'a recent jump shows up hotter over the shorter window');

const st = growthStreak(RISING);
ok(st.years >= 3, 'a consistently rising dividend has a streak');
eq(st.cut, false, 'and no cut');
// One cut ends the streak, however long it was.
const CUT = byYear([
  ...['2024', '2023', '2022', '2021'].flatMap(y => ['02', '05', '08', '11'].map(mo => ({
    ex: `${y}-${mo}-06`, pay: `${y}-${mo}-27`, payEstimated: false,
    amount: y === '2024' ? 0.10 : 0.20,
  }))),
], 2026);
eq(growthStreak(CUT).years, 0, 'a cut in the latest complete year zeroes the streak');
eq(growthStreak(CUT).cut, true, 'and is reported as a cut');
eq(growthStreak([]).years, 0, 'no history, no streak');
// A FLAT year is not a growth year. Held flat is a real and different outcome
// from raised, and a streak that counts it overstates the record.
const FLATRUN = byYear([
  ...['2024', '2023'].flatMap(y => ['02', '05', '08', '11'].map(mo => ({
    ex: `${y}-${mo}-06`, pay: `${y}-${mo}-27`, payEstimated: false, amount: 0.20,
  }))),
  ...['2022', '2021'].flatMap(y => ['02', '05', '08', '11'].map(mo => ({
    ex: `${y}-${mo}-06`, pay: `${y}-${mo}-27`, payEstimated: false, amount: 0.10,
  }))),
], 2026);
eq(growthStreak(FLATRUN).years, 0, 'a flat latest year breaks the streak');
eq(growthStreak(FLATRUN).cut, false, 'flat is not a cut either');

// --------------------------------------------------------- payout ratio
const EPS = { 2021: 1.0, 2022: 1.0, 2023: 0.5, 2024: -0.4 };
const pr = payoutRatios(YR, EPS);
const p2021 = pr.find(r => r.year === 2021);
near(p2021.ratio, 80, '0.80 of dividend on 1.00 of EPS is an 80% payout');
eq(p2021.over, false, 'and is not over 100');
const p2023 = pr.find(r => r.year === 2023);
near(p2023.ratio, 160, 'paying 0.80 out of 0.50 earned is 160%');
eq(p2023.over, true, 'and is flagged as over');
// A loss year cannot have a meaningful payout ratio.
const p2024 = pr.find(r => r.year === 2024);
eq(p2024.lossYear, true, 'a negative-EPS year is flagged as a loss year');
// A year with no EPS on file reports null, not zero.
eq(pr.find(r => r.year === 2020).ratio, null, 'no EPS means no ratio, not a zero one');
// Break-even earnings: dividing by zero would give Infinity, which renders as
// a number and means nothing.
eq(payoutRatios(YR, { 2021: 0 }).find(r => r.year === 2021).ratio, null,
  'zero EPS yields no ratio rather than infinity');

const ps = payoutSummary(pr);
eq(ps.latestYear, 2023, 'the summary reads the latest usable complete year');
near(ps.latest, 160, 'and its ratio');
eq(ps.band, 'over', 'above 100 bands as over');
eq(ps.overs, 1, 'one year breached');
eq(payoutSummary([]), null, 'nothing usable, no summary');
eq(payoutSummary(payoutRatios(YR, {})), null, 'no EPS at all, no summary');
// The bands are described, not judged.
eq(payoutSummary(payoutRatios(YR, { 2021: 4, 2022: 4, 2023: 4 })).band, 'comfortable',
  'a fifth of earnings bands as comfortable');
eq(payoutSummary(payoutRatios(YR, { 2021: 1, 2022: 1, 2023: 0.95 })).band, 'tight',
  'most of earnings bands as tight');

// -------------------------------------------- what you actually received
const ORDERS = [
  { date: '2025-06-01', ticker: 'AAA', side: 'B', qty: 10 },
  { date: '2025-11-07', ticker: 'AAA', side: 'B', qty: 5 },   // ON an ex-date
  { date: '2026-03-01', ticker: 'AAA', side: 'S', qty: 4 },
  { date: '2025-01-01', ticker: 'ZZZ', side: 'B', qty: 99 },
];
eq(sharesBefore(ORDERS, 'AAA', '2025-05-01'), 0, 'before the first buy you held none');
eq(sharesBefore(ORDERS, 'AAA', '2025-08-08'), 10, 'after one buy you held ten');
// THE OFF-BY-ONE: buying ON the ex-date does not entitle you to that payment.
eq(sharesBefore(ORDERS, 'AAA', '2025-11-07'), 10,
  'a purchase ON the ex-date does not count toward that payment');
eq(sharesBefore(ORDERS, 'AAA', '2025-11-08'), 15, 'but does from the next day');
eq(sharesBefore(ORDERS, 'AAA', '2026-06-01'), 11, 'a sale reduces the count');
eq(sharesBefore(ORDERS, 'BBB', '2026-06-01'), 0, 'a ticker you never held is zero');
eq(sharesBefore([], 'AAA', '2026-06-01'), 0, 'no orders, no shares');
eq(sharesBefore(ORDERS, 'AAA', ''), 0, 'no date, no answer');
// A tape that sells more than it bought is a data error, not a short position.
// Floored at zero, so no downstream figure can come out negative.
eq(sharesBefore([
  { date: '2025-01-01', ticker: 'AAA', side: 'B', qty: 5 },
  { date: '2025-02-01', ticker: 'AAA', side: 'S', qty: 9 },
], 'AAA', '2026-01-01'), 0, 'over-selling floors at zero rather than going short');

const hp = holdingPeriod(ORDERS, 'AAA', new Date('2026-06-01T00:00:00Z'));
eq(hp.first, '2025-06-01', 'the holding period starts at the first buy');
eq(hp.open, true, 'a position with shares left is still open');
eq(hp.days, 365, 'a year to the day');
eq(hp.overOneYear, true, 'and is over one year');
eq(holdingPeriod([], 'AAA'), null, 'no orders, no holding period');
// A fully closed position reports its span, not an ongoing one.
const CLOSED = [
  { date: '2026-03-24', ticker: 'RCAT', side: 'B', qty: 0.6726 },
  { date: '2026-04-29', ticker: 'RCAT', side: 'S', qty: 0.6726 },
];
const hc = holdingPeriod(CLOSED, 'RCAT', new Date('2026-08-01T00:00:00Z'));
eq(hc.open, false, 'a fully sold position is closed');
eq(hc.end, '2026-04-29', 'and ends on the sale');
eq(hc.days, 36, 'and spans the days it was actually held');
eq(hc.overOneYear, false, 'a five-week hold is not over a year');

const REC = receivedHistory(H, ORDERS, 'AAA');
// H runs 2026-05-08, 2026-02-06, 2025-11-07, 2025-08-08 at 0.26/0.25/0.25/0.24.
eq(REC[3].shares, 10, 'the oldest payment is valued at the count held then');
near(REC[3].amount_received, 2.4, 'ten shares at 0.24 is 2.40');
eq(REC[2].shares, 10, 'the ex-date purchase does not inflate that payment');
eq(REC[1].shares, 15, 'a later payment reflects the added shares');
near(REC[1].amount_received, 3.75, 'fifteen at 0.25 is 3.75');
// Today's count must NOT be applied backwards.
ok(REC[3].amount_received < REC[1].amount_received,
  'past payments are not credited with shares bought later');

const rt = receivedTotals(receivedHistory(H, ORDERS, 'AAA'));
eq(rt.payments, 4, 'four payments received');
near(rt.total, 2.4 + 2.5 + 3.75 + 0.26 * 11, 'the total sums each at its own count');
eq(rt.missed, 0, 'none missed');
// A payment from before you owned anything is counted as missed, not as zero
// income from a company that pays.
const early = receivedHistory([{ ex: '2024-01-01', pay: '2024-01-20', amount: 1 }], ORDERS, 'AAA');
eq(early[0].held, false, 'a payment predating your first buy was not received');
eq(receivedTotals(early).missed, 1, 'and is counted as missed');
eq(receivedTotals(early).total, 0, 'contributing nothing to income');

// ------------------------------------------------------------- forward
const fwd = projectForward(H, 11, { count: 4, asOf: new Date('2026-06-01T00:00:00Z') });
eq(fwd.length, 4, 'four payments projected');
ok(fwd.every(f => f.estimated === true), 'every projected row is marked estimated');
ok(fwd[0].pay > '2026-06-01', 'the first projection is in the future');
near(fwd[0].perShare, 0.26, 'projected at the latest declared rate');
near(fwd[0].amount, 0.26 * 11, 'and at the CURRENT share count');
ok(fwd[1].pay > fwd[0].pay, 'projections run forwards');
// Roughly a quarter apart, following the company's rhythm.
const gap = (Date.parse(fwd[1].pay) - Date.parse(fwd[0].pay)) / 864e5;
ok(gap > 80 && gap < 100, 'projected payments keep the observed quarterly rhythm');
ok(fwd[0].ex < fwd[0].pay, 'each projection has an ex-date before its pay date');
eq(projectForward([], 10).length, 0, 'no history, no projection');
// Projecting from a year in the future must skip every slot already past, not
// hand back a schedule that started last year.
const late = projectForward(H, 11, { count: 4, asOf: new Date('2027-06-01T00:00:00Z') });
eq(late.length, 4, 'four payments projected from a later vantage point');
ok(late.every(f => f.pay > '2027-06-01'), 'and every one of them is in the future');
eq(projectForward(H, 0, { asOf: new Date('2026-06-01T00:00:00Z') })[0].amount, 0,
  'holding nothing projects nothing, but still shows the schedule');

console.log(`${pass}/${pass + fail} passing`);
if (fail) process.exit(1);
