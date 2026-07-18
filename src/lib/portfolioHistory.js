// ---- Portfolio value reconstructed from orders × historical prices ----
// The old chart drew `portfolio_snapshots` (a few sparse rows) → jagged/glitchy,
// and broke when clipped to 1M/3M/6M/1Y. Instead we rebuild a clean daily line:
//   value(date)  = Σ  qty_held(ticker, date) × close(ticker, date)
//   invested(date)= Σ  cost_basis(ticker, date)               (same tickers)
// Both are restricted to your CURRENT holdings so "what I paid" vs "what it's
// worth" track the same positions and compare cleanly. Historical closes are
// fetched once per ticker and cached in Supabase (`memory.price_history`) so it
// isn't re-hammering the API on every open.
import { getConfig, list, upsertMemory } from './db.js';
import { fetchCandles } from './marketdata.js';

const twSym = t => String(t || '').toUpperCase().replace('-', '.');
const iso = d => d.slice(0, 10);

// per-ticker signed order deltas + signed cost, sorted by date
function ledger(orders, tickers) {
  const set = new Set(tickers.map(t => t.toUpperCase()));
  const by = {};
  for (const o of orders) {
    const tk = String(o.ticker || '').toUpperCase();
    if (!set.has(tk) || !o.date || !o.qty || !o.price) continue;
    const sign = o.side === 'S' ? -1 : 1;
    (by[tk] ||= []).push({ date: iso(o.date), dq: sign * Number(o.qty), dc: sign * Number(o.qty) * Number(o.price) });
  }
  for (const tk in by) by[tk].sort((a, b) => a.date.localeCompare(b.date));
  return by;
}

// ---- daily reconstruction ----
// priceHistory: { [ticker]: { 'YYYY-MM-DD': close } }
export function buildDailySeries(orders, tickers, priceHistory, livePrices = {}) {
  const by = ledger(orders, tickers);
  const tks = Object.keys(by);
  if (!tks.length) return { invested: [], value: [] };

  // date axis: union of all close dates for these tickers, from first order onward
  const firstOrder = tks.reduce((m, tk) => { const d = by[tk][0]?.date; return d && (!m || d < m) ? d : m; }, null);
  const dateSet = new Set();
  for (const tk of tks) for (const d in (priceHistory[tk] || {})) if (!firstOrder || d >= firstOrder) dateSet.add(d);
  const axis = [...dateSet].sort();
  if (axis.length < 2) return { invested: [], value: [] };

  // forward-filled close per ticker along the axis
  const filled = {};
  for (const tk of tks) {
    const src = priceHistory[tk] || {};
    let last = null; const row = {};
    for (const d of axis) { if (src[d] != null) last = src[d]; row[d] = last; }
    filled[tk] = row;
  }

  const invested = [], value = [];
  for (const d of axis) {
    let inv = 0, val = 0;
    for (const tk of tks) {
      let qty = 0, cost = 0;
      for (const e of by[tk]) { if (e.date > d) break; qty += e.dq; cost += e.dc; }
      if (qty <= 0 && cost <= 0) continue;
      inv += Math.max(0, cost);
      const px = filled[tk][d];
      if (px != null && qty > 0) val += qty * px;
    }
    invested.push({ t: d, v: Math.round(inv) });
    value.push({ t: d, v: Math.round(val) });
  }

  // pin the last value point to the live total so it matches the tiles exactly
  const liveTotal = tks.reduce((s, tk) => {
    let qty = 0; for (const e of by[tk]) qty += e.dq;
    const lp = livePrices[tk];
    return s + (qty > 0 && lp != null ? qty * lp : 0);
  }, 0);
  if (liveTotal > 0 && value.length) value[value.length - 1] = { t: value[value.length - 1].t, v: Math.round(liveTotal) };

  return { invested, value };
}

// ---- price history cache (Supabase memory.price_history) ----
export async function loadPriceHistory() {
  try { const rows = await list('memory', { filter: 'key=eq.price_history', order: 'key' }); return rows?.[0]?.value || { updated: null, data: {} }; }
  catch { return { updated: null, data: {} }; }
}

// fetch daily closes for the given tickers and merge into the cache. Sequential
// with a gap to respect Twelve Data's 8 req/min free limit; tolerates partials.
export async function refreshPriceHistory(tickers, { onProgress } = {}) {
  if (!(getConfig().twelveKey || '').trim()) throw new Error('NO_KEY');
  const cur = await loadPriceHistory();
  const data = { ...(cur.data || {}) };
  let done = 0;
  for (const t of tickers) {
    const tk = t.toUpperCase();
    try {
      const candles = await fetchDaily(tk);
      if (candles && Object.keys(candles).length) data[tk] = { ...(data[tk] || {}), ...candles };
    } catch { /* skip this ticker, keep going */ }
    done++; onProgress?.(done, tickers.length);
    if (done < tickers.length) await sleep(8000); // stay under 8/min
  }
  const payload = { updated: new Date().toISOString(), data };
  try { await upsertMemory('price_history', payload); } catch {}
  return payload;
}

// ~3+ years of daily closes for one ticker → { 'YYYY-MM-DD': close }
async function fetchDaily(ticker) {
  const key = (getConfig().twelveKey || '').trim();
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(twSym(ticker))}`
    + `&interval=1day&outputsize=900&order=ASC&timezone=America/New_York&apikey=${key}`;
  const r = await fetch(url);
  const j = await r.json();
  if (j.status === 'error') throw new Error(j.message || 'Twelve Data');
  const out = {};
  for (const v of (j.values || [])) { const c = +v.close; if (Number.isFinite(c)) out[iso(v.datetime)] = c; }
  return out;
}

// ---- 1D intraday value line: Σ qty × 5-min close, timestamp-aligned ----
// Fixes the old index-aligned version (different tickers return different candle
// counts → summed mismatched times → a line nowhere near the real total).
// Rules: latest trading day only; per timestamp use each ticker's most recent
// close ≤ t (forward-fill); tickers with no candles at all contribute at their
// static price so the LEVEL always matches the real portfolio worth.
export async function buildIntradaySeries(held, livePrices = {}) {
  const tks = held.filter(h => Number(h.qty) > 0);
  if (!tks.length) return [];
  const per = await Promise.all(tks.map(async h => {
    const qty = Number(h.qty);
    const staticPx = Number(livePrices[String(h.ticker).toUpperCase()] ?? h.last_price ?? h.avg_cost ?? 0);
    try { const c = await fetchCandles(h.ticker, '5m'); return { qty, staticPx, candles: c || [] }; }
    catch { return { qty, staticPx, candles: [] }; }
  }));
  const withC = per.filter(p => p.candles.length);
  if (!withC.length) return [];

  // latest trading day = the max date across all tickers' last candles
  const day = withC.map(p => String(p.candles[p.candles.length - 1].t).slice(0, 10)).sort().pop();
  // time axis = union of that day's timestamps, sorted
  const axis = [...new Set(withC.flatMap(p => p.candles.filter(c => String(c.t).startsWith(day)).map(c => String(c.t))))].sort();
  if (axis.length < 2) return [];

  // per ticker: forward-fill closes along the axis (start from last close before the day)
  const filled = per.map(p => {
    const before = p.candles.filter(c => String(c.t) < day + ' ');
    let last = before.length ? before[before.length - 1].c : null;
    const m = new Map(p.candles.filter(c => String(c.t).startsWith(day)).map(c => [String(c.t), c.c]));
    const row = new Map();
    for (const t of axis) { if (m.has(t)) last = m.get(t); row.set(t, last ?? p.staticPx); }
    return { qty: p.qty, row };
  });

  return axis.map(t => ({ t, v: Math.round(filled.reduce((s, f) => s + f.qty * (f.row.get(t) || 0), 0)) }));
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
