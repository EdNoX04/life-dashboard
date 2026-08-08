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
export const BASE = 'https://financialmodelingprep.com/api/v3';

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
  const list = Array.isArray(payload?.historical) ? payload.historical
    : Array.isArray(payload) ? payload : null;
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

const fresh = e => e && e.at && Date.now() - e.at < TTL;

export const hasKey = () => !!(getConfig().fmpKey || '').trim();

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
    const r = await fetch(`${BASE}/historical-price-full/stock_dividend/${encodeURIComponent(t)}?apikey=${key}`);
    if (!r.ok) {
      entry = { status: STATUS.failed, rows: [], at: Date.now(),
        note: `The dividend source returned ${r.status}.` };
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
    entry = { status: STATUS.failed, rows: [], at: Date.now(), note: 'Could not reach the dividend source.' };
  }

  cache = { ...(cache || {}), [t]: entry };
  memSet(CACHE_KEY, cache).catch(() => {});
  return entry;
}

// Many tickers, paced. The free plan's limit is daily rather than per-second,
// but a burst of twenty parallel requests is still the fastest way to get rate
// limited, so they go one at a time with a small gap.
export async function fetchMany(tickers = [], { force = false, onProgress } = {}) {
  const list = [...new Set(tickers.map(t => String(t || '').toUpperCase()).filter(Boolean))];
  const out = {};
  for (let i = 0; i < list.length; i++) {
    out[list[i]] = await fetchDividends(list[i], { force });
    onProgress?.(i + 1, list.length, list[i]);
    if (i < list.length - 1) await new Promise(r => setTimeout(r, 260));
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
