// Fundamentals fetchers. Finnhub's free tier, cached hard.
//
// Fundamentals move once a quarter. Refetching them on every modal open burns a
// rate limit that is shared with the live price feed — which is the one part of
// the app where being a minute stale actually matters. So everything here is
// cached for a day in the same `memory` blob the rest of the app uses, and every
// result carries the timestamp it was fetched at so the screen can say how old
// it is rather than implying it is live.
//
// The other rule: a failed fetch returns null, and null renders as "not
// available". It never falls back to a previous ticker's numbers, and it never
// renders as zero.

import { getConfig } from './db.js';
import { memGet, memSet } from './advisor.js';

const CACHE_KEY = 'fundamentals';
const TTL = 24 * 3600e3;

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

function put(ticker, patch) {
  cache = { ...(cache || {}), [ticker]: { ...(cache?.[ticker] || {}), ...patch, at: Date.now() } };
  memSet(CACHE_KEY, cache);
  return cache[ticker];
}

const key = () => (getConfig().finnhubKey || '').trim();

async function get(path) {
  const k = key();
  if (!k) return null;
  try {
    const r = await fetch(`https://finnhub.io/api/v1/${path}${path.includes('?') ? '&' : '?'}token=${k}`);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// Everything a research screen needs about one company, in one call site.
// Returns { earnings, metric, peers, profile, at, partial } — `partial` names
// the pieces that failed, because a screen missing its peer list should say so
// rather than render an empty peer table that looks like "no competitors".
export async function fetchFundamentals(ticker, { force = false } = {}) {
  const t = String(ticker || '').toUpperCase();
  if (!t) return null;
  await ensure();
  const hit = cache[t];
  if (!force && fresh(hit)) return hit;
  if (!key()) return hit || null;

  const [earnings, metric, peers, profile] = await Promise.all([
    get(`stock/earnings?symbol=${encodeURIComponent(t)}`),
    get(`stock/metric?symbol=${encodeURIComponent(t)}&metric=all`),
    get(`stock/peers?symbol=${encodeURIComponent(t)}`),
    get(`stock/profile2?symbol=${encodeURIComponent(t)}`),
  ]);

  const missing = [];
  if (!Array.isArray(earnings) || !earnings.length) missing.push('earnings');
  if (!metric || !metric.metric) missing.push('ratios');
  if (!Array.isArray(peers) || peers.length < 2) missing.push('peers');
  if (!profile || !profile.name) missing.push('profile');

  return put(t, {
    earnings: Array.isArray(earnings) ? earnings : null,
    metric: metric?.metric || null,
    series: metric?.series || null,
    peers: Array.isArray(peers) ? peers.filter(p => p && p !== t).slice(0, 8) : null,
    profile: profile && profile.name ? profile : null,
    partial: missing,
  });
}

// Forward analyst estimates. This is a paid endpoint on Finnhub, and the free tier
// answers it with a 403 rather than an empty list — which matters, because "no
// analyst covers this company" and "you are not allowed to see who covers this
// company" are completely different facts and the screen must not print the first
// when the second is true. So this one call reports its HTTP status instead of
// collapsing every failure to null.
//
// The status codes it hands back:
//   'ok'      — the endpoint answered; the rows are whatever it said, possibly none
//   'blocked' — 401/403, i.e. the plan does not include this data
//   'nokey'   — no API key configured at all
//   'error'   — anything else, including the network being down
async function getStatus(path) {
  const k = key();
  if (!k) return { status: 'nokey', data: null };
  try {
    const r = await fetch(`https://finnhub.io/api/v1/${path}${path.includes('?') ? '&' : '?'}token=${k}`);
    if (r.status === 401 || r.status === 403) return { status: 'blocked', data: null };
    if (!r.ok) return { status: 'error', data: null };
    return { status: 'ok', data: await r.json() };
  } catch { return { status: 'error', data: null }; }
}

// Annual EPS estimates, cached alongside the rest of the company's fundamentals.
// Returns { forward, forwardStatus, at }. `forward` is the raw Finnhub rows; the
// estimates library normalises them, because parsing belongs next to the maths and
// not next to the fetch.
export async function fetchEstimates(ticker, { force = false } = {}) {
  const t = String(ticker || '').toUpperCase();
  if (!t) return null;
  await ensure();
  const hit = cache[t];
  if (!force && fresh(hit) && hit.forwardStatus) return hit;
  if (!key()) return hit || null;

  const { status, data } = await getStatus(`stock/eps-estimate?symbol=${encodeURIComponent(t)}&freq=annual`);
  const rows = Array.isArray(data?.data) ? data.data : null;
  // A blocked endpoint must not overwrite rows we successfully fetched earlier on
  // a plan that allowed it. Stale-but-real beats absent.
  if (status !== 'ok' && hit?.forward?.length) return put(t, { forwardStatus: status });
  return put(t, { forward: rows, forwardStatus: status });
}

// Peers need their own ratios to be comparable, and that is one call each. Kept
// to six so a modal open never fans out into a rate-limit wall.
export async function fetchPeerMetrics(tickers = []) {
  await ensure();
  const want = tickers.slice(0, 6);
  const out = [];
  for (const t of want) {
    const hit = cache[t];
    if (fresh(hit) && hit.metric) { out.push({ ticker: t, metric: hit.metric, name: hit.profile?.name, marketCap: hit.profile?.marketCapitalization }); continue; }
    if (!key()) continue;
    const [m, p] = await Promise.all([
      get(`stock/metric?symbol=${encodeURIComponent(t)}&metric=all`),
      get(`stock/profile2?symbol=${encodeURIComponent(t)}`),
    ]);
    if (!m?.metric) continue;
    put(t, { metric: m.metric, series: m.series || null, profile: p?.name ? p : null });
    out.push({ ticker: t, metric: m.metric, name: p?.name, marketCap: p?.marketCapitalization });
  }
  return out;
}

// Ratios for every holding in the book, which is what a factor screen needs. Same
// pacing rule as fetchCaps and for the same reason: the free tier answers a burst
// of thirty with rate-limit errors, and a rate-limit error rendered as a factor
// score is a portfolio described from no data at all. So it walks, reports each
// name as it lands, and anything already cached today costs nothing.
export async function fetchMetrics(tickers = [], onEach = null, { gapMs = 220 } = {}) {
  await ensure();
  const out = {};
  const report = (t, v) => { out[t] = v; if (onEach) { try { onEach(t, v, { ...out }); } catch {} } };

  const todo = [];
  for (const raw of tickers) {
    const t = String(raw || '').toUpperCase();
    if (!t || out[t] !== undefined) continue;
    const hit = cache[t];
    if (fresh(hit) && hit.metric) report(t, hit.metric);
    else todo.push(t);
  }
  if (!key()) return out;

  for (const t of todo) {
    const m = await get(`stock/metric?symbol=${encodeURIComponent(t)}&metric=all`);
    // A failed call reports null, which scores as UNMEASURED. It must never report
    // an empty object, because an empty object is indistinguishable from a company
    // whose every ratio happens to be missing, and the two deserve different words.
    if (m?.metric) { put(t, { metric: m.metric, series: m.series || null }); report(t, m.metric); }
    else report(t, null);
    if (gapMs) await new Promise(r => setTimeout(r, gapMs));
  }
  return out;
}

// Market caps for a whole leaderboard. One profile call per name, which on the
// free tier means this has to be paced rather than fired in a wall — 30 names at
// once is a rate-limit error, and a rate-limit error renders as thirty companies
// worth nothing. So it walks the list, reports each one as it lands, and the
// table fills in from the top while it works. Anything already cached today is
// handed back instantly and costs nothing.
export async function fetchCaps(tickers = [], onEach = null, { gapMs = 220 } = {}) {
  await ensure();
  const out = {};
  const report = (t, v) => { out[t] = v; if (onEach) { try { onEach(t, v, { ...out }); } catch {} } };

  const todo = [];
  for (const raw of tickers) {
    const t = String(raw || '').toUpperCase();
    if (!t || out[t] !== undefined) continue;
    const hit = cache[t];
    if (fresh(hit) && hit.profile) report(t, num(hit.profile.marketCapitalization));
    else todo.push(t);
  }
  if (!key()) return out;

  for (const t of todo) {
    const p = await get(`stock/profile2?symbol=${encodeURIComponent(t)}`);
    // A failed call reports null, which the table renders as "still unknown".
    // It must never report 0 — that is a company, ranked last, worth nothing.
    if (p && p.name) { put(t, { profile: p }); report(t, num(p.marketCapitalization)); }
    else report(t, null);
    if (gapMs) await new Promise(r => setTimeout(r, gapMs));
  }
  return out;
}

const num = v => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

export function cachedAt(ticker) {
  const e = cache?.[String(ticker || '').toUpperCase()];
  return e?.at || null;
}

export const hasKey = () => !!key();
