// ---- Indian equities + benchmark index series ----
//
// Two jobs:
//   1. Quotes for NSE/BSE holdings. Finnhub's free tier is US-only, so the live
//      socket in live.js never sees an Indian ticker — this fills that hole.
//   2. Daily close series for the indices the portfolio gets compared against
//      (NIFTY 50, SENSEX, S&P 500, Nasdaq 100 …) — the input to the "returns vs
//      benchmark" view.
//
// WHY A PROVIDER CHAIN INSTEAD OF ONE ENDPOINT
// I could not verify any market-data host from the build environment (its egress
// proxy returns 403 for everything that isn't allow-listed), so shipping a single
// hardcoded provider would be a guess dressed up as a decision. Instead every
// fetch walks a chain, remembers which link worked, and there's a self-test panel
// (`runSelfTest`) that runs the same chain from the browser and reports exactly
// what succeeded. Whatever wins on Neel's machine is what gets used.
//
// Everything fetched is cached into a `memory` blob, so once a series has been
// pulled it survives provider outages, rate limits and offline use.

import { getConfig } from './db.js';
import { memGet, memSet } from './advisor.js';

const DAY = 86400e3;
const iso = d => new Date(d).toISOString().slice(0, 10);
const num = x => (Number.isFinite(Number(x)) ? Number(x) : 0);

// ---------------------------------------------------------------- benchmarks

// `td` = Twelve Data symbol, `stooq` = Stooq symbol. Both are tried in turn.
export const BENCHMARKS = [
  { key: 'NIFTY50', label: 'NIFTY 50', short: 'NIFTY', region: 'IN', cur: '₹', color: 'var(--orange)', td: 'NIFTY 50', tdExchange: 'NSE', stooq: '^nsei' },
  { key: 'SENSEX', label: 'BSE SENSEX', short: 'SENSEX', region: 'IN', cur: '₹', color: 'var(--yellow)', td: 'SENSEX', tdExchange: 'BSE', stooq: '^snx' },
  { key: 'NIFTYBANK', label: 'NIFTY Bank', short: 'BANKNIFTY', region: 'IN', cur: '₹', color: 'var(--pink)', td: 'NIFTY BANK', tdExchange: 'NSE', stooq: '^nsebank' },
  { key: 'SPX', label: 'S&P 500', short: 'S&P 500', region: 'US', cur: '$', color: 'var(--cyan)', td: 'SPX', stooq: '^spx' },
  { key: 'NDX', label: 'Nasdaq 100', short: 'NASDAQ', region: 'US', cur: '$', color: 'var(--purple)', td: 'NDX', stooq: '^ndx' },
  { key: 'DJI', label: 'Dow Jones', short: 'DOW', region: 'US', cur: '$', color: 'var(--green)', td: 'DJI', stooq: '^dji' },
];

export const benchmarkOf = key => BENCHMARKS.find(b => b.key === key) || BENCHMARKS[0];

// Which index does a holding get judged against by default?
export const defaultBenchmark = market => (market === 'IN' ? 'NIFTY50' : 'SPX');

// ------------------------------------------------------------------ symbols

// Twelve Data wants the bare symbol plus an exchange param; our tickers carry a
// Yahoo-style suffix (RELIANCE.NS). Split them back apart.
export function splitIndian(ticker) {
  const t = String(ticker || '').toUpperCase().trim();
  const m = t.match(/^(.+)\.(NS|NSE|BO|BSE)$/);
  if (!m) return { symbol: t, exchange: null };
  return { symbol: m[1], exchange: m[2].startsWith('N') ? 'NSE' : 'BSE' };
}

// Stooq uses lower-case with .ns / .bo — same suffix idea, different casing.
const stooqSymbol = ticker => {
  const { symbol, exchange } = splitIndian(ticker);
  if (!exchange) return String(ticker || '').toLowerCase();
  return `${symbol.toLowerCase()}.${exchange === 'NSE' ? 'ns' : 'bo'}`;
};

// ------------------------------------------------------------------ plumbing

// A public CORS relay for hosts that don't send the header themselves. OFF by
// default: it means routing a request through a third party, and that should be
// a conscious choice rather than something that quietly happens. No credentials
// or personal data ever go through it — only public index symbols.
const PROXY = 'https://api.allorigins.win/raw?url=';
export const proxyEnabled = () => getConfig().allowMarketProxy === true;

async function getText(url, { timeout = 12000, proxy = false } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const target = proxy ? PROXY + encodeURIComponent(url) : url;
    const r = await fetch(target, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally {
    clearTimeout(timer);
  }
}

const getJSON = async (url, opts) => JSON.parse(await getText(url, opts));

// Stooq hands back `Date,Open,High,Low,Close,Volume`. Anything else (an error
// page, an empty body) parses to nothing rather than to garbage.
function parseStooqCsv(text) {
  const lines = String(text || '').trim().split('\n');
  if (lines.length < 2 || !/^date/i.test(lines[0])) return [];
  const cols = lines[0].toLowerCase().split(',');
  const di = cols.indexOf('date'), ci = cols.indexOf('close');
  if (di < 0 || ci < 0) return [];
  return lines.slice(1).map(l => {
    const p = l.split(',');
    return { d: (p[di] || '').slice(0, 10), v: num(p[ci]) };
  }).filter(p => /^\d{4}-\d{2}-\d{2}$/.test(p.d) && p.v > 0);
}

// -------------------------------------------------------------- series cache

const CACHE_KEY = 'bench_history';
const FRESH_MS = 12 * 3600e3;

let cache = null;
export async function loadBenchCache() {
  if (cache) return cache;
  cache = (await memGet(CACHE_KEY)) || {};
  return cache;
}
async function saveBenchCache() {
  if (cache) await memSet(CACHE_KEY, cache);
}

// Union two series on date, newer values winning. Lets a short "top-up" fetch
// extend a long stored history without re-downloading years of closes.
export function mergeSeries(oldPts, newPts) {
  const m = new Map((oldPts || []).map(p => [p.d, num(p.v)]));
  for (const p of newPts || []) if (p?.d && num(p.v) > 0) m.set(p.d, num(p.v));
  return [...m.entries()].map(([d, v]) => ({ d, v })).sort((a, b) => a.d.localeCompare(b.d));
}

// --------------------------------------------------------------- providers

// Each provider returns [{d, v}] or throws. Order matters: keyed first (more
// reliable, higher limits), keyless next, proxy last.

async function twelveSeries(bm, size = 2000) {
  const key = (getConfig().twelveKey || '').trim();
  if (!key) throw new Error('NO_KEY');
  const q = new URLSearchParams({ symbol: bm.td, interval: '1day', outputsize: String(size), order: 'ASC', apikey: key });
  if (bm.tdExchange) q.set('exchange', bm.tdExchange);
  const j = await getJSON(`https://api.twelvedata.com/time_series?${q}`);
  if (j.status === 'error') throw new Error(j.message || 'Twelve Data error');
  const values = Array.isArray(j.values) ? j.values : [];
  const pts = values.map(v => ({ d: String(v.datetime).slice(0, 10), v: num(v.close) })).filter(p => p.v > 0);
  if (!pts.length) throw new Error('empty');
  return pts;
}

async function stooqSeries(bm, { proxy = false } = {}) {
  if (!bm.stooq) throw new Error('no stooq symbol');
  const pts = parseStooqCsv(await getText(`https://stooq.com/q/d/l/?s=${encodeURIComponent(bm.stooq)}&i=d`, { proxy }));
  if (!pts.length) throw new Error('empty');
  return pts;
}

function providerChain(bm) {
  const chain = [
    { name: 'twelvedata', run: () => twelveSeries(bm) },
    { name: 'stooq', run: () => stooqSeries(bm) },
  ];
  if (proxyEnabled()) chain.push({ name: 'stooq+proxy', run: () => stooqSeries(bm, { proxy: true }) });
  return chain;
}

// -------------------------------------------------------------- public API

// Daily close series for one index, newest data merged into whatever's stored.
// Never throws: on total failure it returns the cached series (possibly empty)
// with `stale: true`, because a benchmark chart that renders yesterday's data is
// far better than one that renders an error.
export async function fetchBenchmark(key, { force = false } = {}) {
  const bm = benchmarkOf(key);
  const store = await loadBenchCache();
  const hit = store[bm.key];
  if (!force && hit?.at && Date.now() - hit.at < FRESH_MS && hit.points?.length) {
    return { key: bm.key, points: hit.points, source: hit.source, at: hit.at, stale: false };
  }

  const tried = [];
  for (const p of providerChain(bm)) {
    try {
      const pts = await p.run();
      const merged = mergeSeries(hit?.points, pts);
      store[bm.key] = { at: Date.now(), source: p.name, points: merged };
      await saveBenchCache();
      return { key: bm.key, points: merged, source: p.name, at: Date.now(), stale: false, tried };
    } catch (e) {
      tried.push({ provider: p.name, error: e.message || String(e) });
    }
  }
  return {
    key: bm.key,
    points: hit?.points || [],
    source: hit?.source || null,
    at: hit?.at || null,
    stale: true,
    tried,
  };
}

// Several at once, sequential — free tiers rate-limit hard (Twelve Data is 8
// requests a minute) and a Promise.all here would trip it every time.
export async function fetchBenchmarks(keys, { force = false, onProgress } = {}) {
  const out = {};
  const list = keys?.length ? keys : BENCHMARKS.map(b => b.key);
  for (let i = 0; i < list.length; i++) {
    onProgress?.({ i, total: list.length, key: list[i] });
    out[list[i]] = await fetchBenchmark(list[i], { force });
    if (i < list.length - 1) await new Promise(r => setTimeout(r, 900));
  }
  return out;
}

// Whatever is already stored, with no network at all — for first paint.
export async function cachedBenchmark(key) {
  const store = await loadBenchCache();
  const hit = store[benchmarkOf(key).key];
  return hit?.points || [];
}

// ------------------------------------------------------------ India quotes

async function twelveQuote(ticker) {
  const key = (getConfig().twelveKey || '').trim();
  if (!key) throw new Error('NO_KEY');
  const { symbol, exchange } = splitIndian(ticker);
  const q = new URLSearchParams({ symbol, apikey: key });
  if (exchange) q.set('exchange', exchange);
  const j = await getJSON(`https://api.twelvedata.com/quote?${q}`);
  if (j.status === 'error') throw new Error(j.message || 'Twelve Data error');
  const price = num(j.close), prev = num(j.previous_close);
  if (!price) throw new Error('empty');
  return { price, prevClose: prev || price, change: prev ? price - prev : 0, currency: j.currency || 'INR' };
}

async function stooqQuote(ticker, { proxy = false } = {}) {
  const text = await getText(`https://stooq.com/q/l/?s=${stooqSymbol(ticker)}&f=sd2t2ohlcv&h&e=csv`, { proxy });
  const rows = parseStooqCsv(text);
  const lines = String(text || '').trim().split('\n');
  if (rows.length) {
    const last = rows[rows.length - 1];
    return { price: last.v, prevClose: last.v, change: 0, currency: 'INR' };
  }
  // the quote endpoint's header differs from the history one — parse it directly
  if (lines.length >= 2) {
    const cols = lines[0].toLowerCase().split(',');
    const p = lines[1].split(',');
    const ci = cols.indexOf('close'), oi = cols.indexOf('open');
    const price = num(p[ci]);
    if (price > 0) return { price, prevClose: num(p[oi]) || price, change: 0, currency: 'INR' };
  }
  throw new Error('empty');
}

// Quotes for a batch of Indian tickers. Same shape live.js emits, so Money.jsx
// can merge the two maps and not care where a price came from.
export async function fetchIndiaQuotes(tickers, { onProgress } = {}) {
  const list = [...new Set((tickers || []).filter(Boolean))];
  const quotes = {}, errors = {};
  let source = null;
  for (let i = 0; i < list.length; i++) {
    onProgress?.({ i, total: list.length, ticker: list[i] });
    const chain = [
      { name: 'twelvedata', run: () => twelveQuote(list[i]) },
      { name: 'stooq', run: () => stooqQuote(list[i]) },
    ];
    if (proxyEnabled()) chain.push({ name: 'stooq+proxy', run: () => stooqQuote(list[i], { proxy: true }) });
    let got = null, lastErr = null;
    for (const p of chain) {
      try { got = await p.run(); source = p.name; break; } catch (e) { lastErr = e.message || String(e); }
    }
    if (got) quotes[list[i]] = { ...got, source, at: Date.now() };
    else errors[list[i]] = lastErr || 'failed';
    if (i < list.length - 1) await new Promise(r => setTimeout(r, 900));
  }
  return { quotes, errors, source };
}

// ------------------------------------------------------------- self-test

// Runs the whole chain from the browser and reports what actually worked. This
// exists because the provider question genuinely cannot be settled from the
// build environment — this panel settles it on the machine that matters.
export async function runSelfTest({ sampleIndian = 'RELIANCE.NS' } = {}) {
  const started = Date.now();
  const results = [];
  // `probe: true` marks a row that actually hit the network — the verdict counts
  // those only. (Don't infer it from elapsed time: a fast or mocked response can
  // legitimately take 0ms and would be silently discounted.)
  const record = async (label, fn) => {
    const t0 = Date.now();
    try {
      const detail = await fn();
      results.push({ label, ok: true, probe: true, ms: Date.now() - t0, detail });
    } catch (e) {
      results.push({ label, ok: false, probe: true, ms: Date.now() - t0, detail: e.message || String(e) });
    }
  };

  const hasKey = !!(getConfig().twelveKey || '').trim();
  results.push({
    label: 'Twelve Data API key',
    ok: hasKey,
    probe: false,
    ms: 0,
    detail: hasKey ? 'present' : 'not set — add it in Settings to unlock the primary provider',
  });

  const nifty = benchmarkOf('NIFTY50');
  const spx = benchmarkOf('SPX');

  if (hasKey) {
    await record('NIFTY 50 · Twelve Data', async () => {
      const p = await twelveSeries(nifty, 30);
      return `${p.length} closes, latest ${p[p.length - 1].d} = ${p[p.length - 1].v}`;
    });
    await record('S&P 500 · Twelve Data', async () => {
      const p = await twelveSeries(spx, 30);
      return `${p.length} closes, latest ${p[p.length - 1].d} = ${p[p.length - 1].v}`;
    });
    await record(`${sampleIndian} quote · Twelve Data`, async () => {
      const q = await twelveQuote(sampleIndian);
      return `${q.currency} ${q.price}`;
    });
  }

  await record('NIFTY 50 · Stooq (keyless)', async () => {
    const p = await stooqSeries(nifty);
    return `${p.length} closes, latest ${p[p.length - 1].d} = ${p[p.length - 1].v}`;
  });
  await record('S&P 500 · Stooq (keyless)', async () => {
    const p = await stooqSeries(spx);
    return `${p.length} closes, latest ${p[p.length - 1].d} = ${p[p.length - 1].v}`;
  });
  await record(`${sampleIndian} quote · Stooq (keyless)`, async () => {
    const q = await stooqQuote(sampleIndian);
    return `₹${q.price}`;
  });

  if (proxyEnabled()) {
    await record('NIFTY 50 · Stooq via relay', async () => {
      const p = await stooqSeries(nifty, { proxy: true });
      return `${p.length} closes, latest ${p[p.length - 1].d} = ${p[p.length - 1].v}`;
    });
  } else {
    results.push({
      label: 'Stooq via relay',
      ok: null,
      probe: false,
      ms: 0,
      detail: 'off — enable "market data relay" in Settings only if the direct calls above fail',
    });
  }

  const working = results.filter(r => r.probe && r.ok === true).map(r => r.label);
  return {
    results,
    ms: Date.now() - started,
    verdict: working.length
      ? `${working.length} provider call(s) succeeded — benchmarks will load.`
      : 'No provider reached. Benchmarks will fall back to whatever is already cached.',
  };
}

// A tiny status line for the Money header: what do we have, and how old is it?
export async function benchmarkStatus() {
  const store = await loadBenchCache();
  const rows = BENCHMARKS.map(b => {
    const hit = store[b.key];
    return {
      key: b.key,
      label: b.short,
      points: hit?.points?.length || 0,
      source: hit?.source || null,
      ageHours: hit?.at ? (Date.now() - hit.at) / 3600e3 : null,
      last: hit?.points?.length ? hit.points[hit.points.length - 1] : null,
    };
  });
  return { rows, any: rows.some(r => r.points > 0) };
}
