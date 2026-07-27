// ---- Asset classification & the non-equity book ----
//
// The `investments` table only knows ticker/qty/avg_cost/currency, which was fine
// while everything was US stocks. The money tab now splits India vs US, stocks vs
// ETFs, and carries FDs and bonds too. Rather than migrate the table (which needs a
// Supabase migration Neel would have to run by hand), the extra classification lives
// in a single `memory.asset_meta` blob keyed by ticker, and anything not classified
// yet is inferred from the ticker itself. Zero-migration, works on existing rows.

import { memGet, memSet } from './advisor.js';

export const MARKETS = {
  IN: { key: 'IN', label: 'Indian equity', cur: '₹', color: 'var(--orange)' },
  US: { key: 'US', label: 'International equity', cur: '$', color: 'var(--cyan)' },
};

export const KINDS = {
  stock: { key: 'stock', label: 'Stocks' },
  etf: { key: 'etf', label: 'ETFs' },
  fund: { key: 'fund', label: 'Mutual funds' },
};

export const CAPS = ['mega', 'large', 'mid', 'small', 'micro'];
export const CAP_LABEL = { mega: 'Mega cap', large: 'Large cap', mid: 'Mid cap', small: 'Small cap', micro: 'Micro cap' };

// Cap bands in USD market cap. Indian names get compared after FX conversion.
const CAP_BANDS = [[200e9, 'mega'], [10e9, 'large'], [2e9, 'mid'], [300e6, 'small']];
export const capFromMarketCap = mc => (CAP_BANDS.find(([floor]) => mc >= floor) || [0, 'micro'])[1];

// Tickers that are obviously funds/ETFs. Not exhaustive — it only has to be right
// often enough that Neel rarely has to correct it, and he can always override.
const ETF_SET = new Set([
  'SPY', 'VOO', 'IVV', 'VTI', 'QQQ', 'QQQM', 'DIA', 'IWM', 'VT', 'VXUS', 'VEA', 'VWO', 'EFA', 'EEM',
  'SCHD', 'VYM', 'DGRO', 'VIG', 'SPYG', 'SPYV', 'VUG', 'VTV', 'MTUM', 'QUAL', 'USMV', 'VLUE',
  'SMH', 'SOXX', 'XLK', 'XLF', 'XLE', 'XLV', 'XLY', 'XLP', 'XLI', 'XLU', 'XLB', 'XLRE', 'XLC',
  'ARKK', 'ARKG', 'ARKQ', 'ARKX', 'BOTZ', 'ROBO', 'ICLN', 'TAN', 'LIT', 'DRIV', 'IDRV', 'UFO', 'ROKT', 'ARKW',
  'GLD', 'IAU', 'SLV', 'BITO', 'IBIT', 'FBTC', 'ETHA',
  'BND', 'AGG', 'TLT', 'IEF', 'SHY', 'LQD', 'HYG', 'TIP', 'VCIT', 'VCSH', 'MUB',
  'INDA', 'INDY', 'EPI', 'SMIN', 'FLIN',
  'NIFTYBEES', 'JUNIORBEES', 'BANKBEES', 'GOLDBEES', 'LIQUIDBEES', 'ITBEES', 'MON100', 'MOTILALOSWAL',
]);

const DEBT_ETFS = new Set(['BND', 'AGG', 'TLT', 'IEF', 'SHY', 'LQD', 'HYG', 'TIP', 'VCIT', 'VCSH', 'MUB', 'LIQUIDBEES']);
const GOLD_ETFS = new Set(['GLD', 'IAU', 'SLV', 'GOLDBEES']);

// NSE/BSE suffixes INDmoney and Yahoo both use, plus a few well-known bare symbols.
const IN_SUFFIX = /\.(NS|BO|NSE|BSE)$/i;
const IN_KNOWN = new Set([
  'RELIANCE', 'TCS', 'HDFCBANK', 'ICICIBANK', 'INFY', 'ITC', 'SBIN', 'BHARTIARTL', 'LT', 'HINDUNILVR',
  'AXISBANK', 'KOTAKBANK', 'BAJFINANCE', 'ASIANPAINT', 'MARUTI', 'TITAN', 'SUNPHARMA', 'WIPRO', 'HCLTECH',
  'ULTRACEMCO', 'NESTLEIND', 'TATAMOTORS', 'TATASTEEL', 'ADANIENT', 'ADANIPORTS', 'JSWSTEEL', 'POWERGRID',
  'NTPC', 'ONGC', 'COALINDIA', 'GRASIM', 'TECHM', 'DRREDDY', 'CIPLA', 'DIVISLAB', 'BRITANNIA', 'EICHERMOT',
  'HEROMOTOCO', 'BAJAJFINSV', 'BAJAJ-AUTO', 'INDUSINDBK', 'SBILIFE', 'HDFCLIFE', 'APOLLOHOSP', 'TATACONSUM',
  'IRCTC', 'ZOMATO', 'PAYTM', 'NYKAA', 'DMART', 'IRFC', 'SUZLON', 'YESBANK', 'IDEA', 'PNB', 'BANKBARODA',
  'NIFTYBEES', 'JUNIORBEES', 'BANKBEES', 'GOLDBEES', 'LIQUIDBEES', 'ITBEES',
]);

const up = t => String(t || '').trim().toUpperCase();

// Strip the exchange suffix so RELIANCE.NS and RELIANCE are the same holding.
export const baseSymbol = t => up(t).replace(IN_SUFFIX, '');

// ---- inference (used when there's no saved override) ----
export function inferMeta(h) {
  const t = up(h?.ticker);
  const bare = baseSymbol(t);
  const cur = up(h?.currency);
  const market = IN_SUFFIX.test(t) || cur === 'INR' || IN_KNOWN.has(bare) ? 'IN' : 'US';
  let kind = 'stock';
  if (ETF_SET.has(bare) || /BEES$/.test(bare) || /\bETF\b/i.test(h?.name || '')) kind = 'etf';
  if (/fund|mutual/i.test(h?.name || '')) kind = 'fund';
  let sleeve = 'equity';
  if (DEBT_ETFS.has(bare)) sleeve = 'debt';
  else if (GOLD_ETFS.has(bare)) sleeve = 'commodity';
  return { market, kind, sleeve, cap: null, sector: null, exch: market === 'IN' ? 'NSE' : 'US' };
}

// ---- saved overrides ----
let metaCache = null;

export async function loadAssetMeta() {
  if (metaCache) return metaCache;
  metaCache = (await memGet('asset_meta')) || {};
  return metaCache;
}
export function assetMetaSync() { return metaCache || {}; }

export async function saveAssetMeta(ticker, patch) {
  const all = await loadAssetMeta();
  const k = baseSymbol(ticker);
  all[k] = { ...(all[k] || {}), ...patch, updated: new Date().toISOString() };
  metaCache = all;
  await memSet('asset_meta', all);
  return all;
}

// Merge inference with whatever has been saved/learned. Saved values always win.
export function metaOf(h, saved = assetMetaSync()) {
  const base = inferMeta(h);
  const s = saved[baseSymbol(h?.ticker)] || {};
  const out = { ...base };
  for (const k of Object.keys(s)) if (s[k] != null && s[k] !== '') out[k] = s[k];
  return out;
}

// ---- grouping for the Money tab ----
// Returns the sections in display order, each with its holdings and rolled-up P/L.
export function groupHoldings(held, priceOf, saved = assetMetaSync()) {
  const buckets = new Map();
  for (const h of held) {
    const m = metaOf(h, saved);
    const id = `${m.market}:${m.kind}`;
    if (!buckets.has(id)) buckets.set(id, { id, market: m.market, kind: m.kind, rows: [] });
    buckets.get(id).rows.push({ ...h, meta: m });
  }
  const order = ['IN:stock', 'IN:etf', 'IN:fund', 'US:stock', 'US:etf', 'US:fund'];
  return [...buckets.values()]
    .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
    .map(b => {
      const value = b.rows.reduce((s, h) => s + Number(h.qty) * priceOf(h), 0);
      const cost = b.rows.reduce((s, h) => s + Number(h.qty) * Number(h.avg_cost || 0), 0);
      const pnl = value - cost;
      return {
        ...b,
        title: `${MARKETS[b.market].label} · ${KINDS[b.kind].label}`,
        cur: MARKETS[b.market].cur,
        color: MARKETS[b.market].color,
        value, cost, pnl,
        pnlPct: cost ? (pnl / cost) * 100 : 0,
      };
    });
}

// ---- FDs and bonds (memory.fixed_income) ----
export const EMPTY_FI = { fds: [], bonds: [] };

export async function loadFixedIncome() {
  const v = await memGet('fixed_income');
  return { fds: v?.fds || [], bonds: v?.bonds || [] };
}
export const saveFixedIncome = fi => memSet('fixed_income', { ...fi, updated: new Date().toISOString() });

const YEAR = 365.25 * 24 * 3600e3;
const yearsBetween = (a, b) => (new Date(b) - new Date(a)) / YEAR;

// FD value today: quarterly compounding is the Indian bank norm for cumulative FDs.
export function fdValue(fd, now = new Date()) {
  const p = Number(fd.principal || 0);
  const r = Number(fd.rate || 0) / 100;
  if (!p || !r || !fd.start) return { value: p, interest: 0, matured: false, maturityValue: p };
  const elapsed = Math.max(0, yearsBetween(fd.start, now));
  const term = fd.maturity ? Math.max(0, yearsBetween(fd.start, fd.maturity)) : elapsed;
  const grow = t => (fd.payout === 'simple' ? p * (1 + r * t) : p * Math.pow(1 + r / 4, 4 * t));
  const matured = fd.maturity ? new Date(fd.maturity) <= now : false;
  const value = grow(matured ? term : Math.min(elapsed, term || elapsed));
  return { value, interest: value - p, matured, maturityValue: grow(term || elapsed), termYears: term };
}

// Bond value: mark at the entered market price if there is one, else at face.
export function bondValue(b) {
  const qty = Number(b.qty || 0);
  const price = Number(b.price || b.face || 0);
  const face = Number(b.face || 0);
  const value = qty * price;
  const cost = qty * Number(b.avg_cost || b.price || face || 0);
  const annualCoupon = qty * face * (Number(b.coupon || 0) / 100);
  const ytm = value > 0 && b.maturity
    ? ((annualCoupon + (qty * face - value) / Math.max(0.25, yearsBetween(new Date(), b.maturity))) / value) * 100
    : Number(b.coupon || 0);
  return { value, cost, pnl: value - cost, annualCoupon, ytm, currentYield: value ? (annualCoupon / value) * 100 : 0 };
}

// ---- allocation rollups (drives the donut + the report) ----
// Everything is expressed in one display currency; `fx` is USD→INR so Indian
// holdings can be folded into a dollar total (or the reverse).
export function allocationBreakdown({ held, priceOf, saved = assetMetaSync(), fi = EMPTY_FI, crypto = [], fx = 1, inr = false }) {
  const toDisp = (amt, market) => {
    if (inr) return market === 'IN' ? amt : amt * fx;
    return market === 'IN' ? amt / (fx || 1) : amt;
  };
  const byClass = {}; const byCap = {}; const bySector = {}; const byMarket = {};
  const add = (obj, k, v) => { if (!k) return; obj[k] = (obj[k] || 0) + v; };

  for (const h of held) {
    const m = metaOf(h, saved);
    const v = toDisp(Number(h.qty) * priceOf(h), m.market);
    const cls = m.sleeve === 'debt' ? 'Debt' : m.sleeve === 'commodity' ? 'Gold' : m.kind === 'etf' ? 'Equity ETF' : 'Equity';
    add(byClass, cls, v);
    add(byMarket, MARKETS[m.market].label, v);
    add(byCap, m.cap ? CAP_LABEL[m.cap] : 'Unclassified', v);
    add(bySector, m.sector || 'Unclassified', v);
  }
  for (const f of fi.fds) add(byClass, 'Fixed deposits', toDisp(fdValue(f).value, 'IN'));
  for (const b of fi.bonds) add(byClass, 'Bonds', toDisp(bondValue(b).value, b.market || 'IN'));
  for (const c of crypto) add(byClass, 'Crypto', toDisp(Number(c.qty || 0) * Number(c.price || 0), 'US'));

  const total = Object.values(byClass).reduce((s, v) => s + v, 0);
  const rank = obj => Object.entries(obj)
    .map(([label, value]) => ({ label, value, pct: total ? (value / total) * 100 : 0 }))
    .sort((a, b) => b.value - a.value);

  return { total, byClass: rank(byClass), byCap: rank(byCap), bySector: rank(bySector), byMarket: rank(byMarket) };
}

// Herfindahl concentration on position weights: 0 = perfectly spread, 1 = one holding.
export function concentration(held, priceOf) {
  const vals = held.map(h => Number(h.qty) * priceOf(h)).filter(v => v > 0);
  const total = vals.reduce((s, v) => s + v, 0);
  if (!total) return { hhi: 0, top1: 0, top3: 0, top5: 0, effectiveN: 0 };
  const w = vals.map(v => v / total).sort((a, b) => b - a);
  const hhi = w.reduce((s, x) => s + x * x, 0);
  const cum = n => w.slice(0, n).reduce((s, x) => s + x, 0) * 100;
  return { hhi, top1: cum(1), top3: cum(3), top5: cum(5), effectiveN: hhi ? 1 / hhi : 0 };
}
