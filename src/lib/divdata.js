// Dividend history from Financial Modeling Prep.
//
// Five screens in the backlog — Dividend Insights, Projected Income, the
// Calendar, Payment History and the Payout Ratio — all need the same thing:
// per-ticker declared payments with ex-dates, pay-dates and amounts, going back
// several years. Finnhub's free tier does not include dividends, which is why
// those screens have had nothing to render.
//
// Design constraints that shaped this file:
//
//   250 REQUESTS A DAY. That sounds tight and is not, because dividend history
//   changes about four times a year per stock. Everything is cached in the
//   `div_data` memory blob with a WEEK-long TTL, and a refresh is a button
//   rather than something that happens on mount. Twenty holdings refreshed
//   weekly is roughly eighty requests a month.
//
//   US ONLY on the free plan. An Indian ticker will return nothing, and nothing
//   must read as "not covered by this source" rather than as "pays no
//   dividend" — those are opposite conclusions and only one of them is a reason
//   to sell.
//
//   A FAILED FETCH RETURNS null, never an empty list. An empty list is a claim
//   that the company pays nothing. This distinction is the whole reason the
//   cache stores a status alongside the rows.

import { getConfig } from './db.js';
import { memGet, memSet } from './advisor.js';

export const CACHE_KEY = 'div_data';
export const TTL = 7 * 24 * 3600e3;
// FMP retired the v3 dividend endpoint for new keys: `historical-price-full/
// stock_dividend` now answers 403 rather than 401, which is why the first run
// of this looked like a broken key rather than a moved endpoint. The current
// one is /stable/dividends. v3 is kept as a fallback for keys old enough to
// still have access, and tried second so a working modern key never pays for
// the extra round trip.
export const BASE = 'https://financialmodelingprep.com/stable';
export const LEGACY_BASE = 'https://financialmodelingprep.com/api/v3';

// Statuses are a closed set so a screen can switch on them exhaustively rather
// than guessing from the shape of the payload.
export const STATUS = {
  ok: 'ok',                 // rows fetched, however many
  none: 'none',             // fetched successfully, company declares nothing
  nokey: 'nokey',           // no API key configured
  uncovered: 'uncovered',   // the source does not cover this listing
  failed: 'failed',         // network or API error — say so, do not imply zero
};

export const num = v => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const iso = v => {
  const s = String(v ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

// FMP returns a `historical` array of records whose field names have changed
// across API versions. Reading several possible names is not defensive
// cargo-culting — `paymentDate` and `date` genuinely both appear, and picking
// the wrong one shifts every payment in the calendar by weeks.
export function normalisePayment(r) {
  if (!r) return null;
  const amount = num(r.adjDividend ?? r.dividend);
  const ex = iso(r.date ?? r.exDate ?? r.recordDate);
  if (amount == null || amount <= 0 || !ex) return null;
  return {
    ex,
    // Pay date is the one that matters for income timing, and it is the one
    // most often missing. Falling back to the ex-date is wrong by a few weeks,
    // so the fallback is FLAGGED rather than silent.
    pay: iso(r.paymentDate) ?? ex,
    payEstimated: !iso(r.paymentDate),
    declared: iso(r.declarationDate),
    record: iso(r.recordDate),
    amount,
  };
}

export function normaliseHistory(payload) {
  // Three shapes seen in the wild: the stable endpoint returns a bare array,
  // v3 wraps it in `historical`, and some stable responses nest it under
  // `data`. Reading all three is cheaper than guessing which key is live this
  // month, and an unrecognised shape still returns null rather than empty.
  const list = Array.isArray(payload) ? payload
    : Array.isArray(payload?.historical) ? payload.historical
      : Array.isArray(payload?.data) ? payload.data : null;
  if (!list) return null;
  const rows = list.map(normalisePayment).filter(Boolean);
  // Newest first is how the API returns it and how a payment history reads;
  // sorting explicitly means a change at the source cannot silently reorder it.
  rows.sort((a, b) => b.ex.localeCompare(a.ex));
  // De-duplicate on ex-date: FMP occasionally repeats a record across pages.
  const seen = new Set();
  return rows.filter(r => (seen.has(r.ex) ? false : (seen.add(r.ex), true)));
}

// Trailing twelve months of declared payments, and the count. Used by every
// yield figure downstream, so it is defined once here rather than four times.
export function ttm(rows = [], asOf = new Date()) {
  const cutoff = new Date(asOf.getTime() - 365 * 864e5).toISOString().slice(0, 10);
  const within = rows.filter(r => r.ex > cutoff);
  if (!within.length) return { total: 0, count: 0, complete: false };
  return {
    total: within.reduce((s, r) => s + r.amount, 0),
    count: within.length,
    // Four payments in a year is the usual US pattern; fewer than expected
    // usually means the history starts mid-year rather than that the company
    // cut. The flag lets a screen hedge instead of reporting a halved yield.
    complete: within.length >= 4,
  };
}

// The declared run-rate: the most recent payment annualised at the observed
// cadence. Preferred over TTM for a FORWARD figure, because a company that
// raised its dividend last quarter has a TTM that understates it.
export function runRate(rows = []) {
  if (!rows.length) return null;
  const last = rows[0];
  if (rows.length < 2) return { perShare: null, perYear: null, cadence: null, reason: 'Only one payment on record — the cadence cannot be inferred from a single point.' };
  // Median gap rather than mean: one missed or special dividend should not drag
  // the estimate.
  const gaps = [];
  for (let i = 0; i < Math.min(rows.length - 1, 8); i++) {
    gaps.push((Date.parse(rows[i].ex) - Date.parse(rows[i + 1].ex)) / 864e5);
  }
  gaps.sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];
  if (!(median > 0)) return null;
  const perYear = 365 / median;
  const cadence = median > 300 ? 'annual' : median > 150 ? 'semi-annual'
    : median > 60 ? 'quarterly' : 'monthly';
  return {
    perShare: last.amount,
    perYear: last.amount * Math.round(perYear),
    payments: Math.round(perYear),
    cadence,
    reason: null,
  };
}

// ------------------------------------------------- bridge to div_meta
//
// Every dividend screen in this app already reads `div_meta`, whose shape
// predates having any dividend source at all: a rate, a frequency, an anchor
// month, and a list of declared payments. Rather than rewrite five screens
// around a new shape, the fetched history is translated INTO that shape. One
// converter lights up the calendar, the income lists, the earnings screen, the
// yield analyzer and the holdings table's total-return column at once.
//
// The translation is where the honesty lives, because div_meta was designed for
// hand entry and cannot express everything the history knows:
//
//   The rate becomes the LATEST declared payment, not an average. div_meta's
//   projection multiplies the rate by the frequency, so an averaged rate would
//   under-project a company that has raised.
//
//   growthPct is the realised CAGR over the available history, floored at zero.
//   A negative growth rate compounded forward would project a dividend shrinking
//   to nothing, which is a forecast, not a record — and div_meta's projections
//   are meant to be "what this pays now, repeated".
//
//   The declared list keeps only payments that will FALL IN the projection
//   window, because that is all the consumer reads, and carrying ten years of
//   history into a blob that gets re-read on every screen is waste.

export const CADENCE_TO_FREQ = {
  monthly: 'monthly',
  quarterly: 'quarterly',
  'semi-annual': 'semiannual',
  annual: 'annual',
};

// Realised compound growth between the oldest and newest full years on record.
// Returns null rather than 0 when there is not enough history to say — a
// confident zero would read as "this dividend has never grown".
export function realisedGrowth(rows = []) {
  if (rows.length < 2) return null;
  const byYear = new Map();
  for (const r of rows) {
    const y = Number(r.ex.slice(0, 4));
    byYear.set(y, (byYear.get(y) || 0) + r.amount);
  }
  const years = [...byYear.keys()].sort((a, b) => a - b);
  // Drop the first and last years: both are usually partial, and a partial year
  // at either end turns a flat dividend into a spectacular rise or collapse.
  //
  // No explicit length guard. With fewer than four years on record the two
  // survivors are the same year or inverted, so `span < 1` below already
  // returns null — and with one year they are undefined, which fails the
  // `a > 0` test. A separate length check could not be shown to matter while
  // those stood, so it is not there.
  const first = years[1], last = years[years.length - 2];
  const a = byYear.get(first), b = byYear.get(last);
  const span = last - first;
  if (!(a > 0) || !(b > 0) || span < 1) return null;
  return (Math.pow(b / a, 1 / span) - 1) * 100;
}

// Median gap between ex-date and pay-date, in days. div_meta stores the inverse
// (exOffsetDays, counted back from the pay date), which is why this exists
// rather than being read off any single payment.
export function medianExOffset(rows = []) {
  // No separate payEstimated filter: an estimated pay date IS the ex-date, so
  // its gap is zero and `d > 0` already excludes it. A second guard doing the
  // same job would be untestable — neither could be shown to matter while the
  // other stood. `d > 0` is the one kept because it also catches a corrupt row
  // whose pay date precedes its ex-date, which the flag would not.
  const gaps = rows
    .map(r => (Date.parse(r.pay) - Date.parse(r.ex)) / 864e5)
    .filter(d => d > 0 && d < 120)
    .sort((a, b) => a - b);
  if (!gaps.length) return null;
  return Math.round(gaps[Math.floor(gaps.length / 2)]);
}

export function toDivMeta(entry, { keepFrom = null } = {}) {
  if (!entry || entry.status !== STATUS.ok || !entry.rows?.length) return null;
  const rows = entry.rows;
  const rate = runRate(rows);
  const latest = rows[0];
  const payDate = new Date(`${latest.pay}T00:00:00Z`);

  const cutoff = keepFrom || `${new Date().getUTCFullYear() - 1}-01-01`;
  const growth = realisedGrowth(rows);
  const offset = medianExOffset(rows);

  return {
    perShare: latest.amount,
    freq: CADENCE_TO_FREQ[rate?.cadence] || 'quarterly',
    anchorMonth: payDate.getUTCMonth(),
    payDay: Math.min(28, Math.max(1, payDate.getUTCDate())),
    exOffsetDays: offset ?? 14,
    // Negative growth is not projected forward. See the header: div_meta's
    // projection is "what this pays now, repeated", and compounding a cut into
    // the future would turn a record into a forecast.
    growthPct: growth != null && growth > 0 ? Math.round(growth * 10) / 10 : 0,
    baseYear: new Date().getUTCFullYear(),
    declared: rows
      .filter(r => r.pay >= cutoff)
      .map(r => ({ ex: r.ex, pay: r.pay, perShare: r.amount, estimated: r.payEstimated }))
      .sort((a, b) => a.pay.localeCompare(b.pay)),
    note: `Imported from Financial Modeling Prep · ${rows.length} payments on record${
      growth != null && growth <= 0 ? ' · realised growth is flat or negative, so no growth is projected' : ''}`,
    source: 'fmp',
    at: entry.at,
  };
}

// The whole store at once, skipping anything that did not fetch cleanly. A
// ticker whose fetch failed keeps whatever div_meta already held for it - the
// caller merges rather than replaces, so a bad day at the API cannot erase
// hand-entered data.
export function toDivMetaAll(store = {}, opts = {}) {
  const out = {};
  for (const [t, entry] of Object.entries(store)) {
    const m = toDivMeta(entry, opts);
    if (m) out[t] = m;
  }
  return out;
}

// ------------------------------------------------------ payment history

// Dividend per share by calendar year, which is what the payment-history bars
// draw and what every growth figure is computed from.
//
// The trap this function exists to avoid: the CURRENT year is always partial.
// A company four payments into 2026 and two payments into 2027 has not halved
// its dividend, but a bar chart that treats both years the same says it has.
// So the current year is returned with `partial: true` and the growth figures
// below never use it as an endpoint.
export function byYear(rows = [], thisYear = new Date().getUTCFullYear()) {
  const map = new Map();
  for (const r of rows) {
    const y = Number(r.ex.slice(0, 4));
    if (!Number.isFinite(y)) continue;
    const e = map.get(y) || { year: y, total: 0, count: 0, payments: [] };
    e.total += r.amount;
    e.count += 1;
    e.payments.push(r);
    map.set(y, e);
  }
  const years = [...map.values()].sort((a, b) => a.year - b.year);

  // Partial-year detection is compared against the company's OWN typical
  // cadence, not against the neighbouring year. Comparing with the previous
  // year cannot work at the oldest end - the first year on record has no
  // predecessor, and the first year is the one most likely to be partial,
  // because a history usually starts mid-year.
  //
  // The mode is taken over completed years only, so a current year with one
  // payment in it so far cannot drag the expected cadence down to one.
  const counts = years.filter(y => y.year < thisYear).map(y => y.count);
  const freq = new Map();
  for (const c of counts) freq.set(c, (freq.get(c) || 0) + 1);
  let typical = 0;
  for (const [c, n] of freq) {
    const bn = freq.get(typical) || 0;
    // Ties go to the LARGER count: a history split evenly between three- and
    // four-payment years is a quarterly payer with a ragged year, not a
    // three-times-a-year payer with a bonus.
    if (n > bn || (n === bn && c > typical)) typical = c;
  }

  return years.map(e => {
    return {
      ...e,
      partial: e.year >= thisYear || (typical > 0 && e.count < typical),
      // Year-on-year is only meaningful between two complete years, so it is
      // null rather than a number whenever either side is partial.
      yoy: null,
    };
  }).map((e, i, arr) => {
    const prev = arr[i - 1];
    if (!prev || e.partial || prev.partial || !(prev.total > 0)) return e;
    return { ...e, yoy: ((e.total / prev.total) - 1) * 100 };
  });
}

export const completeYears = (years = []) => years.filter(y => !y.partial);

// CAGR across a window of complete years. `years` back from the most recent
// complete year, or as many as exist — and it reports which, because "5Y CAGR"
// computed over three years of data is a different claim.
export function cagr(yearRows = [], span = 5) {
  const full = completeYears(yearRows);
  if (full.length < 2) return null;
  const last = full[full.length - 1];
  const wantIdx = Math.max(0, full.length - 1 - span);
  const first = full[wantIdx];
  const n = last.year - first.year;
  if (n < 1 || !(first.total > 0) || !(last.total > 0)) return null;
  return {
    pct: (Math.pow(last.total / first.total, 1 / n) - 1) * 100,
    years: n,
    from: first.year,
    to: last.year,
    // True when we could not reach back as far as asked. The label should then
    // say what it actually measured rather than what was requested.
    short: n < span,
  };
}

// A streak of consecutive complete years with a higher payout than the one
// before. Counted from the most recent complete year backwards, and stopping at
// the first year that did not increase — which is the honest definition, since
// one cut ends a streak however long it was.
export function growthStreak(yearRows = []) {
  const full = completeYears(yearRows);
  if (full.length < 2) return { years: 0, cut: false };
  let n = 0, cut = false;
  for (let i = full.length - 1; i > 0; i--) {
    if (full[i].total > full[i - 1].total) n += 1;
    else { cut = full[i].total < full[i - 1].total; break; }
  }
  return { years: n, cut };
}

// -------------------------------------------- what YOU actually received
//
// A dividend history is a fact about the company. What you received is a fact
// about the company AND your order tape, and they are not the same shape.
//
// Two things decide it, and getting either wrong silently misstates income:
//
//   ENTITLEMENT IS BY EX-DATE, AND STRICTLY BEFORE IT. To receive a payment you
//   must own the shares before the ex-date opens; buying ON the ex-date does
//   not entitle you. So the share count that matters is the one as of the day
//   before, which is why `sharesBefore` compares with `<` rather than `<=`.
//   An off-by-one here hands you a payment you never got.
//
//   THE COUNT CHANGES OVER TIME. Using today's holding to value a payment from
//   eighteen months ago credits you for shares you had not bought yet. Every
//   past payment is valued at the count held on its own ex-date; only the
//   FORWARD projection uses the current count, because that is the only count
//   the future has.

export function sharesBefore(orders = [], ticker, isoDate) {
  const t = String(ticker || '').toUpperCase();
  const d = String(isoDate || '');
  if (!t || !d) return 0;
  let q = 0;
  for (const o of orders) {
    if (String(o?.ticker || '').toUpperCase() !== t) continue;
    const od = String(o?.date || '').slice(0, 10);
    // Strictly before: an order placed ON the ex-date does not entitle.
    if (!od || od >= d) continue;
    const n = num(o.qty);
    if (n == null) continue;
    q += String(o.side).toUpperCase() === 'S' ? -n : n;
  }
  // A rounding artefact from fractional trading should not read as a short
  // position; a genuine short is not something this app models.
  return q > 1e-9 ? q : 0;
}

// When you first owned this, and for how long. Used for the holding-period
// figure and to explain a payment history that starts later than the company's.
export function holdingPeriod(orders = [], ticker, asOf = new Date()) {
  const t = String(ticker || '').toUpperCase();
  const mine = orders
    .filter(o => String(o?.ticker || '').toUpperCase() === t && num(o.qty) != null)
    .map(o => ({ date: String(o.date || '').slice(0, 10), side: String(o.side).toUpperCase(), qty: num(o.qty) }))
    .filter(o => /^\d{4}-\d{2}-\d{2}$/.test(o.date))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!mine.length) return null;
  const firstBuy = mine.find(o => o.side !== 'S');
  if (!firstBuy) return null;

  // Net position now, so a closed position reports its span rather than
  // pretending to be ongoing.
  let q = 0, closedOn = null;
  for (const o of mine) {
    q += o.side === 'S' ? -o.qty : o.qty;
    if (q <= 1e-9) closedOn = o.date; else closedOn = null;
  }
  const endISO = closedOn || asOf.toISOString().slice(0, 10);
  const days = Math.max(0, Math.round((Date.parse(endISO) - Date.parse(firstBuy.date)) / 864e5));
  return {
    first: firstBuy.date,
    end: closedOn,
    open: !closedOn,
    days,
    years: days / 365.25,
    // Long-term capital gains treatment turns on this in both jurisdictions the
    // app deals with, though at different thresholds - so it is reported as a
    // fact, not applied as a rule.
    overOneYear: days >= 365,
  };
}

// Every declared payment, valued at the shares you actually held on its ex-date.
export function receivedHistory(rows = [], orders = [], ticker) {
  return rows.map(r => {
    const shares = sharesBefore(orders, ticker, r.ex);
    return {
      ...r,
      shares,
      // No `shares > 0` guard: sharesBefore already floors at zero, so the
      // multiplication cannot produce a negative. A second guard doing the same
      // job would be untestable while the first one stood.
      amount_received: r.amount * shares,
      // Distinguishes "you owned none" from "the company paid nothing". Both
      // land at zero income and only one is about the company.
      held: shares > 0,
    };
  });
}

export function receivedTotals(received = []) {
  const mine = received.filter(r => r.held);
  const total = mine.reduce((s, r) => s + r.amount_received, 0);
  const missed = received.filter(r => !r.held).length;
  return {
    total,
    payments: mine.length,
    missed,
    first: mine.length ? mine[mine.length - 1].pay : null,
    last: mine.length ? mine[0].pay : null,
  };
}

// The next payments, projected from the observed cadence at the CURRENT share
// count. Forward figures are estimates and are labelled as such all the way
// through - `estimated: true` on every row, not just in a footnote.
export function projectForward(rows = [], shares = 0, { count = 4, asOf = new Date() } = {}) {
  const rate = runRate(rows);
  if (!rate || !rate.payments || !(rate.perShare > 0)) return [];
  const gapDays = 365 / rate.payments;
  const last = rows[0];
  if (!last) return [];
  let cursor = Date.parse(`${last.pay}T00:00:00Z`);
  const exGap = Date.parse(`${last.pay}T00:00:00Z`) - Date.parse(`${last.ex}T00:00:00Z`);
  const out = [];
  const today = asOf.getTime();
  // Walk forward from the last real payment until we are past today, then take
  // the next `count`. Starting from the last payment rather than from today
  // keeps the projected dates on the company's actual rhythm.
  for (let i = 1; i <= count + 8 && out.length < count; i++) {
    const pay = cursor + i * gapDays * 864e5;
    if (pay <= today) continue;
    out.push({
      ex: new Date(pay - exGap).toISOString().slice(0, 10),
      pay: new Date(pay).toISOString().slice(0, 10),
      perShare: rate.perShare,
      shares,
      amount: rate.perShare * shares,
      estimated: true,
    });
  }
  return out;
}

// ------------------------------------------------------- payout ratio

// Dividends as a share of earnings, per year. Above 100% means the company paid
// out more than it earned that year, which is not automatically bad — it is
// normal for a REIT and a warning sign for a cyclical — so this reports the
// number and the breach, never a verdict.
export function payoutRatios(yearRows = [], epsByYear = {}) {
  return yearRows.map(y => {
    const eps = num(epsByYear[y.year]);
    const ratio = eps != null && eps !== 0 ? (y.total / eps) * 100 : null;
    return {
      year: y.year,
      dividend: y.total,
      eps,
      ratio,
      partial: y.partial,
      // Negative earnings make the ratio meaningless rather than negative: you
      // cannot pay out a share of a loss, and printing -240% invites a reader
      // to interpret a sign that carries no information.
      lossYear: eps != null && eps < 0,
      over: ratio != null && ratio > 100,
    };
  });
}

export function payoutSummary(ratios = []) {
  const usable = ratios.filter(r => r.ratio != null && !r.partial && !r.lossYear);
  if (!usable.length) return null;
  const latest = usable[usable.length - 1];
  const avg = usable.reduce((s, r) => s + r.ratio, 0) / usable.length;
  const overs = usable.filter(r => r.over).length;
  return {
    latest: latest.ratio,
    latestYear: latest.year,
    average: avg,
    years: usable.length,
    overs,
    // Tightness is a description of headroom, not a rating. The bands are named
    // so a screen does not have to invent its own.
    band: latest.ratio > 100 ? 'over' : latest.ratio > 75 ? 'tight'
      : latest.ratio > 50 ? 'moderate' : 'comfortable',
  };
}

let cache = null;
let loading = null;

async function ensure() {
  if (cache) return cache;
  if (!loading) {
    loading = memGet(CACHE_KEY)
      .then(v => { cache = (v && typeof v === 'object' ? v : {}); return cache; })
      .catch(() => { cache = {}; return cache; });
  }
  return loading;
}

// A FAILURE MUST NOT BE CACHED FOR A WEEK.
//
// This is the bug that made a fixed endpoint look broken. Every entry - success
// or failure - was held for the full week-long TTL, so once a run failed, FETCH
// short-circuited on the cached failure and never called the API again. The
// symptom is unmistakable once you know it: the screen shows twenty identical
// errors while the provider's dashboard reports zero requests, because no
// request was made. Shipping a fix changed nothing, because the fix was never
// reached.
//
// Successes are cached hard, because dividend history genuinely changes about
// four times a year. Failures are cached only long enough to stop a loop from
// hammering the API, and are retried on the next deliberate press.
export const FAIL_TTL = 5 * 60e3;

export function entryTtl(entry) {
  if (!entry) return 0;
  // `nokey` is not a fetch result at all - it is a setup state, and it must
  // clear the instant a key is saved rather than a week later.
  if (entry.status === STATUS.nokey) return 0;
  if (entry.status === STATUS.failed) return FAIL_TTL;
  return TTL;
}

const fresh = e => e && e.at && Date.now() - e.at < entryTtl(e);

export const hasKey = () => !!(getConfig().fmpKey || '').trim();

// FMP writes share classes with a HYPHEN: BRK-B, not BRK.B. INDmoney writes the
// dot. One character, and it is the difference between a full dividend history
// and a hard failure — which is exactly the kind of mismatch that hides inside
// a generic FAILED row.
export function fmpSymbol(ticker) {
  return String(ticker || '').toUpperCase().replace(/\./g, '-');
}

// One ticker. Returns the cache entry shape: { status, rows, at, note }.
export async function fetchDividends(ticker, { force = false } = {}) {
  const t = String(ticker || '').toUpperCase();
  if (!t) return null;
  await ensure();
  if (!force && fresh(cache[t])) return cache[t];

  const key = (getConfig().fmpKey || '').trim();
  if (!key) return { status: STATUS.nokey, rows: [], at: null, note: 'No Financial Modeling Prep key saved.' };

  let entry;
  try {
    // Stable first, legacy second. A 403 on the legacy path is the retirement,
    // not a bad key, and saying so is the difference between a five-minute fix
    // and an afternoon spent regenerating credentials.
    const sym = fmpSymbol(t);
    let r = await fetch(`${BASE}/dividends?symbol=${encodeURIComponent(sym)}&apikey=${key}`);
    // One retry on a rate limit before giving up. The free plan's cap is daily,
    // but bursts still trip a per-second limiter, and a transient 429 recorded
    // as a permanent failure is indistinguishable from an unsupported symbol.
    if (r.status === 429) {
      await new Promise(res => setTimeout(res, 1500));
      r = await fetch(`${BASE}/dividends?symbol=${encodeURIComponent(sym)}&apikey=${key}`);
    }
    if (r.status === 403 || r.status === 404) {
      r = await fetch(`${LEGACY_BASE}/historical-price-full/stock_dividend/${encodeURIComponent(sym)}?apikey=${key}`);
    }
    if (!r.ok) {
      entry = { status: r.status === 401 ? STATUS.nokey : STATUS.failed, rows: [], at: Date.now(),
        code: r.status,
        note: r.status === 403
          ? 'Both dividend endpoints refused the key (403). Usually this means the key has not finished activating - confirm the signup email and try again in a few minutes - or that the plan does not cover this endpoint.'
          : r.status === 401 ? 'The dividend source rejected the key (401). Check it in Settings.'
            : r.status === 429 ? 'Rate limited (429). The free plan allows 250 requests a day; the cache holds for a week, so FETCH rather than FORCE next time.'
              : `The dividend source returned ${r.status}.` };
    } else {
      const rows = normaliseHistory(await r.json());
      if (rows === null) {
        entry = { status: STATUS.failed, rows: [], at: Date.now(), note: 'Unrecognised response from the dividend source.' };
      } else if (!rows.length) {
        // Genuinely ambiguous on the free plan: a non-US listing and a
        // non-payer both come back empty. Say which one we cannot tell apart
        // rather than picking the flattering reading.
        entry = { status: STATUS.none, rows: [], at: Date.now(),
          note: 'No payments returned. On the free plan this means either that the company declares no dividend or that this listing is not covered — the two are indistinguishable from here.' };
      } else {
        entry = { status: STATUS.ok, rows, at: Date.now(), note: null };
      }
    }
  } catch (e) {
    entry = { status: STATUS.failed, rows: [], at: Date.now(), code: 0,
      note: 'Could not reach the dividend source — a network error or a blocked request, not a rejection.' };
  }

  cache = { ...(cache || {}), [t]: entry };
  memSet(CACHE_KEY, cache).catch(() => {});
  return entry;
}

// Many tickers, paced. The free plan's limit is daily rather than per-second,
// but a burst of twenty parallel requests is still the fastest way to get rate
// limited, so they go one at a time with a small gap.
// The free plan covers US listings. A rupee-denominated holding will always come
// back empty, so it is not fetched at all - spending one of 250 daily requests
// to learn nothing, twenty times over, is worse than useless because it also
// fills the screen with failures that look like a broken key.
export function isFetchable(holding) {
  const c = String(holding?.currency || '').toUpperCase();
  return c !== 'INR';
}

export async function fetchMany(tickers = [], { force = false, onProgress } = {}) {
  const list = [...new Set(tickers.map(t => String(t || '').toUpperCase()).filter(Boolean))];
  const out = {};
  for (let i = 0; i < list.length; i++) {
    out[list[i]] = await fetchDividends(list[i], { force });
    onProgress?.(i + 1, list.length, list[i]);
    // 450ms rather than 260. The daily cap is not the binding constraint; the
    // per-second limiter is, and a burst that trips it turns healthy symbols
    // into scattered failures that look like unsupported listings.
    if (i < list.length - 1) await new Promise(r => setTimeout(r, 450));
  }
  return out;
}

export async function loadCached() {
  await ensure();
  return cache || {};
}

// How stale the whole cache is, for the screen that offers the refresh button.
export function cacheAge(store = {}) {
  const times = Object.values(store).map(e => e?.at).filter(Boolean);
  if (!times.length) return null;
  return Date.now() - Math.max(...times);
}
