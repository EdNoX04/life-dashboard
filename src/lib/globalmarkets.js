// Every market we cover — and what each number actually is.
//
// The reference screen shows "United States $80.58T +0.75%" as if both halves
// were the same kind of fact measured at the same moment. They are not, and no
// free API makes them so. Nobody computes a country's total market cap live for
// nothing: the sites that show one are either licensing a full equity universe or
// showing a figure from last year without mentioning it.
//
// So this file keeps the two halves apart and labels both:
//
//   CAP is a STOCK — the World Bank's CM.MKT.LCAP.CD, sourced from the World
//   Federation of Exchanges, free and keyless and ANNUAL. It carries its year
//   everywhere it goes. "$80.6T" is a claim about today; "$80.6T · 2025" is true.
//
//   CHANGE is a FLOW — today's move in the country's benchmark index, live. The
//   tile names the index, so it never implies it measured the whole market.
//
// The temptation is to multiply the cap by the index's move since that year end
// and print a "current" figure. That would be a modelled number wearing a
// measured number's clothes, and this is a screen read by someone whose own money
// is in those markets.

import { sessionState } from './markets.js';

export const WB_INDICATOR = 'CM.MKT.LCAP.CD';

// iso2 is the World Bank's key; `index` is the benchmark whose day change the
// tile shows. Deliberately one index per country: a tile showing "which of the
// three did you mean" is a tile nobody reads.
export const COUNTRIES = [
  { iso2: 'US', name: 'United States', flag: '🇺🇸', index: 'SPX',      indexName: 'S&P 500',    exchange: 'NYSE' , lat: 40.7, lon: -74.0},
  { iso2: 'CN', name: 'China',         flag: '🇨🇳', index: '000001.SS', indexName: 'SSE Comp',  exchange: 'SSE'  , lat: 31.2, lon: 121.5},
  { iso2: 'JP', name: 'Japan',         flag: '🇯🇵', index: 'N225',     indexName: 'Nikkei 225', exchange: 'TSE'  , lat: 35.7, lon: 139.7},
  { iso2: 'HK', name: 'Hong Kong',     flag: '🇭🇰', index: 'HSI',      indexName: 'Hang Seng',  exchange: 'HKEX' , lat: 22.3, lon: 114.2},
  { iso2: 'IN', name: 'India',         flag: '🇮🇳', index: 'NIFTY 50', indexName: 'NIFTY 50',   exchange: 'NSE'  , lat: 19.1, lon: 72.9},
  { iso2: 'TW', name: 'Taiwan',        flag: '🇹🇼', index: 'TAIEX',    indexName: 'TAIEX',      exchange: 'TWSE' , lat: 25.0, lon: 121.6},
  { iso2: 'KR', name: 'South Korea',   flag: '🇰🇷', index: 'KS11',     indexName: 'KOSPI',      exchange: 'KRX'  , lat: 37.6, lon: 127.0},
  { iso2: 'CA', name: 'Canada',        flag: '🇨🇦', index: 'GSPTSE',   indexName: 'TSX Comp',   exchange: 'TSX'  , lat: 43.7, lon: -79.4},
  { iso2: 'GB', name: 'United Kingdom',flag: '🇬🇧', index: 'FTSE',     indexName: 'FTSE 100',   exchange: 'LSE'  , lat: 51.5, lon: -0.1},
  { iso2: 'DE', name: 'Germany',       flag: '🇩🇪', index: 'GDAXI',    indexName: 'DAX',        exchange: 'XETRA', lat: 50.1, lon: 8.7},
  { iso2: 'FR', name: 'France',        flag: '🇫🇷', index: 'FCHI',     indexName: 'CAC 40',     exchange: 'EURONEXT' , lat: 48.9, lon: 2.4},
  { iso2: 'AU', name: 'Australia',     flag: '🇦🇺', index: 'AXJO',     indexName: 'ASX 200',    exchange: 'ASX'  , lat: -33.9, lon: 151.2},
];

export const countryOf = iso2 => COUNTRIES.find(c => c.iso2 === String(iso2 || '').toUpperCase()) || null;

// One request for every country. mrnev=1 asks for the most recent non-empty
// value per country, which matters because coverage is ragged — Taiwan is not
// reported in the same years as the United States, and asking for a fixed year
// would silently drop whichever countries had not filed.
export function worldBankUrl(countries = COUNTRIES) {
  const codes = countries.map(c => c.iso2).join(';');
  return `https://api.worldbank.org/v2/country/${codes}/indicator/${WB_INDICATOR}`
    + `?format=json&per_page=${countries.length * 2}&mrnev=1`;
}

/**
 * The World Bank returns [metadata, rows]. Rows carry a null `value` for a
 * country-year with no filing, and those must not become zero — a country
 * rendered as "$0.00T" reads as a collapsed market rather than an unreported one.
 */
export function parseWorldBank(payload) {
  const rows = Array.isArray(payload) ? payload[1] : null;
  const out = {};
  for (const r of rows || []) {
    const iso2 = r?.countryiso3code ? isoFromRow(r) : (r?.country?.id || '').toUpperCase();
    const value = r?.value;
    if (!iso2 || value == null) continue;         // null is unreported, never zero
    const year = Number(r.date);
    // Ragged coverage means the same country can appear twice; keep the newest.
    if (!out[iso2] || year > out[iso2].year) out[iso2] = { value: Number(value), year };
  }
  return out;
}

function isoFromRow(r) {
  const two = (r?.country?.id || '').toUpperCase();
  return two.length === 2 ? two : '';
}

// $80.58T, $4.30T, $920B. Trillions to two decimals because that is the
// resolution the difference between countries actually lives at.
export function fmtCap(v) {
  if (missing(v)) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${Math.round(n / 1e9)}B`;
  return `$${Math.round(n / 1e6)}M`;
}

// Number(null) is 0 and 0 is finite, so a bare Number() check accepts null and
// prints it as a real zero. That is the exact failure this file exists to
// prevent — a market that did not report rendering as a market that did not move
// — and it was committed here first. Nullish is checked before coercion now,
// everywhere.
const missing = v => v == null || v === '';

export function fmtPct(v) {
  if (missing(v)) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
}

/**
 * How old the cap figure is, in words the tile can print.
 *
 * Not a colour and not a boolean. "2025" beside a number is what stops a reader
 * treating an annual figure as a live one, and it costs six characters.
 */
export function capAge(year, now = new Date()) {
  if (missing(year)) return { label: 'no figure', years: null, stale: true };
  const y = Number(year);
  if (!Number.isFinite(y)) return { label: 'no figure', years: null, stale: true };
  const gap = now.getFullYear() - y;
  return {
    label: String(y),
    years: gap,
    // Three years is where an annual total stops describing the market at all.
    // Below that it is dated; above it, it is history.
    stale: gap >= 3,
  };
}

/**
 * One row per country, ready to render.
 *
 * quotes is keyed by index symbol: { SPX: { pct, level, at } }. A country with a
 * cap and no quote is INCLUDED — the market exists whether or not we reached it
 * today, and dropping the row would quietly shrink "every market we cover" to
 * "every market that answered".
 */
export function marketRows(caps = {}, quotes = {}, now = new Date()) {
  return COUNTRIES.map(c => {
    const cap = caps[c.iso2] || null;
    const q = quotes[c.index] || null;
    const age = capAge(cap?.year, now);
    return {
      ...c,
      cap: cap?.value ?? null,
      capText: fmtCap(cap?.value),
      capYear: cap?.year ?? null,
      capAge: age,
      pct: q?.pct ?? null,
      pctText: fmtPct(q?.pct),
      level: q?.level ?? null,
      // Four states, not a green dot. Borrowed wholesale from markets.js, which
      // argues the case at length: a tile with no reading and a tile with a live
      // one must not look the same.
      quoteState: q ? (q.state || 'live') : 'unreachable',
      dir: q?.pct == null ? 0 : (q.pct > 0 ? 1 : q.pct < 0 ? -1 : 0),
      // Whether the market is TRADING, which is a fact about the clock and the
      // venue and nothing to do with whether a quote arrived. A market can be
      // open with a dead feed, and closed holding a perfectly good last price;
      // conflating the two is how "no data" gets painted as "market shut".
      session: sessionState(c.exchange, now),
    };
  });
}

// Biggest first, and countries with no cap figure last rather than treated as
// zero — an unreported market is not a small one.
export function sortByCap(rows = []) {
  return rows.slice().sort((a, b) => {
    if (a.cap == null && b.cap == null) return a.name.localeCompare(b.name);
    if (a.cap == null) return 1;
    if (b.cap == null) return -1;
    return b.cap - a.cap;
  });
}

// What the screen may claim about itself. "Every market we cover" is a promise,
// and this is the sentence that keeps it honest when half the feeds are down.
export const isOpenNow = row => row?.session?.phase === 'open';

export function openCount(rows = []) {
  return rows.filter(isOpenNow).length;
}

export function coverageNote(rows = []) {
  const withCap = rows.filter(r => r.cap != null).length;
  const live = rows.filter(r => r.quoteState === 'live').length;
  const years = [...new Set(rows.filter(r => r.capYear).map(r => r.capYear))].sort();
  const span = years.length > 1 ? `${years[0]}–${years[years.length - 1]}` : (years[0] || '—');
  const open = openCount(rows);
  return `${withCap} of ${rows.length} markets sized (World Bank / WFE, ${span}); `
    + `${live} quoting live; ${open} trading right now.`;
}

// ---------------------------------------------------------------------------
// Fetching.
//
// The binding constraint is Twelve Data's free tier: eight requests a minute.
// Twelve index tiles plus three futures is fifteen, so a naive fan-out on mount
// spends two minutes rate-limited and shows a grid of blanks — which reads as
// "these markets are down" rather than "we asked too fast".
//
// So: ONE request for all of them. Twelve Data's /quote accepts a comma-separated
// symbol list and returns a map, which turns fifteen requests into one and leaves
// the rest of the minute for everything else on the tab.

export const FUTURES = [
  { symbol: 'ES=F', label: 'S&P 500 Futures' },
  { symbol: 'NQ=F', label: 'Nasdaq 100 Futures' },
  { symbol: 'YM=F', label: 'Dow Futures' },
];

export function quoteUrl(symbols = [], apikey = '') {
  const list = symbols.map(s => String(s).trim()).filter(Boolean).join(',');
  return `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(list)}`
    + `&apikey=${encodeURIComponent(apikey)}`;
}

/**
 * Twelve Data returns a bare object for ONE symbol and a map keyed by symbol for
 * many. Handling only the second shape means the whole grid breaks the day
 * eleven of twelve symbols are unrecognised — the failure that looks like a
 * total outage and is actually a typo.
 */
export function parseQuotes(json, symbols = []) {
  if (!json || typeof json !== 'object') return {};
  const single = symbols.length === 1 && (json.close != null || json.symbol);
  const map = single ? { [symbols[0]]: json } : json;
  const out = {};
  for (const [sym, q] of Object.entries(map)) {
    if (!q || typeof q !== 'object') continue;
    // Twelve Data reports a per-symbol failure INSIDE a 200 response. Treating
    // that as a quote gives NaN, and NaN formats as a dash that looks like a
    // quiet market rather than a rejected symbol.
    if (q.status === 'error' || q.code) continue;
    const pct = q.percent_change == null ? null : Number(q.percent_change);
    const level = q.close == null ? null : Number(q.close);
    out[sym] = {
      pct: Number.isFinite(pct) ? pct : null,
      level: Number.isFinite(level) ? level : null,
      // is_market_open is the only honest basis for live-vs-cached here: a market
      // that is shut is not stale, it is closed, and painting it amber all
      // weekend is how a warning stops being read.
      state: q.is_market_open === false ? 'cached' : 'live',
      at: q.datetime || null,
    };
  }
  return out;
}

// Symbols the grid needs, in one list, deduped. Futures first so a truncated
// response still fills the strip at the top of the screen.
export function symbolsFor(countries = COUNTRIES, futures = FUTURES) {
  return [...new Set([...futures.map(f => f.symbol), ...countries.map(c => c.index)])];
}

// The caps are annual. Re-fetching them more than once a day is spending a
// request to receive the same number, so the cache lifetime is measured in days
// rather than minutes — the opposite of every other feed in this app, for the
// same reason: it matches what the data actually does.
export const CAP_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function capsAreFresh(cached, now = Date.now()) {
  if (!cached?.at || !cached?.caps) return false;
  return now - new Date(cached.at).getTime() < CAP_TTL_MS;
}

// ---------------------------------------------------------------------------
// Global symbol search.
//
// The requirement was "anything from US to India to Taiwan to South Korea should
// pop up", and the thing that makes that useful rather than confusing is the
// EXCHANGE. AAPL is listed on a dozen venues; a result list showing "AAPL ·
// Apple Inc" twelve times reads as twelve companies, and picking the wrong row
// gets you a price in the wrong currency on the wrong session.
//
// So the exchange and country ride on every row, deduping is by symbol AND
// venue, and the ranking puts an exact ticker match first — because someone
// typing NVDA wants NVDA, not "NVDA Bull 2X Shares".

export function searchUrl(query, apikey = '', limit = 30) {
  return `https://api.twelvedata.com/symbol_search?symbol=${encodeURIComponent(String(query).trim())}`
    + `&outputsize=${limit}&apikey=${encodeURIComponent(apikey)}`;
}

export function parseSearch(json) {
  const rows = Array.isArray(json?.data) ? json.data : [];
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const symbol = String(r?.symbol || '').trim();
    const exchange = String(r?.exchange || '').trim();
    if (!symbol) continue;
    // Keyed on both, deliberately. Deduping on the symbol alone would collapse
    // the NSE listing and the NASDAQ one into a single row and silently pick a
    // venue for you — which is the exact confusion this screen exists to remove.
    const key = `${symbol}|${exchange}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      symbol,
      exchange,
      name: String(r?.instrument_name || '').trim(),
      country: String(r?.country || '').trim(),
      currency: String(r?.currency || '').trim(),
      type: String(r?.instrument_type || '').trim(),
    });
  }
  return out;
}

/**
 * Rank. Exact ticker first, then prefix, then everything else by name length.
 *
 * The last one is not arbitrary: on a name match, the SHORTEST name is almost
 * always the primary listing. "Apple Inc" before "Apple Inc CDR" before
 * "Apple Hospitality REIT" is what someone typing "apple" means.
 */
export function rankResults(rows = [], query = '') {
  const q = String(query).trim().toUpperCase();
  if (!q) return rows;
  const score = r => {
    const sym = r.symbol.toUpperCase();
    if (sym === q) return 0;
    if (sym.startsWith(q)) return 1;
    if (r.name.toUpperCase().startsWith(q)) return 2;
    if (sym.includes(q)) return 3;
    return 4;
  };
  return rows.slice().sort((a, b) =>
    score(a) - score(b)
    || a.name.length - b.name.length
    || a.symbol.localeCompare(b.symbol));
}

// A query short enough to match half the market is a query that spends a request
// to return noise, and the free tier allows eight a minute.
export const MIN_QUERY = 2;
export function searchable(q) {
  return String(q || '').trim().length >= MIN_QUERY;
}

// ---------------------------------------------------------------------------
// The globe.
//
// Decorative, and worth saying so plainly: it carries nothing the list beside it
// does not carry better. It exists because the reference screen has one and it
// makes the tab feel like a place rather than a table.
//
// So it is built to be cheap. An orthographic projection is four lines of
// trigonometry and an SVG circle — no WebGL, no map library, no 300KB of
// TopoJSON for twelve dots. Coordinates are the FINANCIAL CENTRES rather than
// country centroids: a dot on Mumbai says "this is where that market trades", a
// dot in central India says nothing.

const RAD = Math.PI / 180;

/**
 * Orthographic projection — the view of a globe from infinitely far away.
 *
 * Returns unit coordinates in [-1, 1] plus `front`, which is the part that
 * matters: half the world is behind the sphere at any rotation, and drawing
 * those dots anyway puts Tokyo on top of New York. `front` is the sign of the
 * z component, and it is the entire back-face test.
 */
export function projectOrtho(lat, lon, rotation = 0, tilt = 0) {
  const phi = Number(lat) * RAD;
  const lam = (Number(lon) + rotation) * RAD;
  const t = Number(tilt) * RAD;

  const cosPhi = Math.cos(phi);
  const x = cosPhi * Math.sin(lam);
  const y = Math.cos(t) * Math.sin(phi) - Math.sin(t) * cosPhi * Math.cos(lam);
  const z = Math.sin(t) * Math.sin(phi) + Math.cos(t) * cosPhi * Math.cos(lam);

  return { x, y, front: z >= 0, z };
}

/**
 * Every market as a dot, ready for an SVG of radius r centred at (cx, cy).
 *
 * y is flipped because SVG counts downward and latitude counts up — the single
 * most common way a map of this kind ends up mirrored about the equator with
 * nobody noticing, because the shape still looks like a globe.
 */
export function globeDots(rows = [], { rotation = 0, tilt = 12, r = 100, cx = 0, cy = 0 } = {}) {
  return rows
    .filter(row => Number.isFinite(row?.lat) && Number.isFinite(row?.lon))
    .map(row => {
      const p = projectOrtho(row.lat, row.lon, rotation, tilt);
      return {
        iso2: row.iso2,
        name: row.name,
        dir: row.dir ?? 0,
        open: row?.session?.phase === 'open',
        front: p.front,
        cx: cx + p.x * r,
        cy: cy - p.y * r,
        // Dots near the rim are foreshortened on a real sphere; fading them keeps
        // the silhouette from looking like a flat sticker.
        opacity: p.front ? 0.35 + 0.65 * Math.max(0, p.z) : 0,
      };
    })
    // Painter's order: farthest first, so a nearer market draws over a further
    // one rather than under it.
    .sort((a, b) => a.opacity - b.opacity);
}
