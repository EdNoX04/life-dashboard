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

export const WB_INDICATOR = 'CM.MKT.LCAP.CD';

// iso2 is the World Bank's key; `index` is the benchmark whose day change the
// tile shows. Deliberately one index per country: a tile showing "which of the
// three did you mean" is a tile nobody reads.
export const COUNTRIES = [
  { iso2: 'US', name: 'United States', flag: '🇺🇸', index: 'SPX',      indexName: 'S&P 500',    exchange: 'NYSE' },
  { iso2: 'CN', name: 'China',         flag: '🇨🇳', index: '000001.SS', indexName: 'SSE Comp',  exchange: 'SSE'  },
  { iso2: 'JP', name: 'Japan',         flag: '🇯🇵', index: 'N225',     indexName: 'Nikkei 225', exchange: 'TSE'  },
  { iso2: 'HK', name: 'Hong Kong',     flag: '🇭🇰', index: 'HSI',      indexName: 'Hang Seng',  exchange: 'HKEX' },
  { iso2: 'IN', name: 'India',         flag: '🇮🇳', index: 'NIFTY 50', indexName: 'NIFTY 50',   exchange: 'NSE'  },
  { iso2: 'TW', name: 'Taiwan',        flag: '🇹🇼', index: 'TAIEX',    indexName: 'TAIEX',      exchange: 'TWSE' },
  { iso2: 'KR', name: 'South Korea',   flag: '🇰🇷', index: 'KS11',     indexName: 'KOSPI',      exchange: 'KRX'  },
  { iso2: 'CA', name: 'Canada',        flag: '🇨🇦', index: 'GSPTSE',   indexName: 'TSX Comp',   exchange: 'TSX'  },
  { iso2: 'GB', name: 'United Kingdom',flag: '🇬🇧', index: 'FTSE',     indexName: 'FTSE 100',   exchange: 'LSE'  },
  { iso2: 'DE', name: 'Germany',       flag: '🇩🇪', index: 'GDAXI',    indexName: 'DAX',        exchange: 'XETRA'},
  { iso2: 'FR', name: 'France',        flag: '🇫🇷', index: 'FCHI',     indexName: 'CAC 40',     exchange: 'EURONEXT' },
  { iso2: 'AU', name: 'Australia',     flag: '🇦🇺', index: 'AXJO',     indexName: 'ASX 200',    exchange: 'ASX'  },
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
export function coverageNote(rows = []) {
  const withCap = rows.filter(r => r.cap != null).length;
  const live = rows.filter(r => r.quoteState === 'live').length;
  const years = [...new Set(rows.filter(r => r.capYear).map(r => r.capYear))].sort();
  const span = years.length > 1 ? `${years[0]}–${years[years.length - 1]}` : (years[0] || '—');
  return `${withCap} of ${rows.length} markets sized (World Bank / WFE, ${span}); `
    + `${live} quoting live right now.`;
}
