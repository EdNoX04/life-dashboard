// The market leaderboard: biggest companies by market cap, ranked, with today's
// move and a 30-day shape beside each one.
//
// Six decisions here are load-bearing, and every one of them is a place where a
// leaderboard tells a confident lie:
//
//   1. A company whose market cap has not loaded yet is UNRANKED. It is not rank
//      999 and it is not a cap of zero — either of those parks a trillion-dollar
//      company at the bottom of the table and calls it the smallest one there.
//
//   2. The strip across the top is index ETFs, not futures. SPY is not the S&P
//      future, it tracks the index during cash hours and stops. Calling it a
//      future would be borrowing an authority the data does not have.
//
//   3. On the heat map, AREA is size and COLOUR is today's move. A tile with no
//      move on file is grey. Green-by-default is how a heat map ends up showing
//      an up day that never happened.
//
//   4. The CSV is exactly what is on screen, blanks included. A missing figure
//      exports as an empty cell, never as 0, because a spreadsheet will happily
//      average those zeros later.
//
//   5. A sparkline needs at least two points. One point is drawn as a dot — a
//      flat line across the cell reads as "went nowhere", which is a claim.
//
//   6. Today's move is recomputed from price against previous close. A quote
//      with no previous close has no percentage, and shows a dash.

// ---- the universe --------------------------------------------------------
// Finnhub's free tier has no market-cap screener, so the candidate list is
// curated and the caps are fetched per name and cached for a day. The list is
// the mega-caps, and the user's own holdings are merged in at render time so
// they always appear whether or not they are big enough to make the cut.
export const UNIVERSE = [
  { t: 'NVDA', n: 'NVIDIA', c: 'US' }, { t: 'AAPL', n: 'Apple', c: 'US' },
  { t: 'MSFT', n: 'Microsoft', c: 'US' }, { t: 'GOOGL', n: 'Alphabet', c: 'US' },
  { t: 'AMZN', n: 'Amazon', c: 'US' }, { t: 'META', n: 'Meta Platforms', c: 'US' },
  { t: 'AVGO', n: 'Broadcom', c: 'US' }, { t: 'TSLA', n: 'Tesla', c: 'US' },
  { t: 'BRK.B', n: 'Berkshire Hathaway', c: 'US' }, { t: 'TSM', n: 'TSMC', c: 'TW' },
  { t: 'JPM', n: 'JPMorgan Chase', c: 'US' }, { t: 'WMT', n: 'Walmart', c: 'US' },
  { t: 'LLY', n: 'Eli Lilly', c: 'US' }, { t: 'V', n: 'Visa', c: 'US' },
  { t: 'ORCL', n: 'Oracle', c: 'US' }, { t: 'MA', n: 'Mastercard', c: 'US' },
  { t: 'NFLX', n: 'Netflix', c: 'US' }, { t: 'XOM', n: 'Exxon Mobil', c: 'US' },
  { t: 'COST', n: 'Costco', c: 'US' }, { t: 'JNJ', n: 'Johnson & Johnson', c: 'US' },
  { t: 'HD', n: 'Home Depot', c: 'US' }, { t: 'PG', n: 'Procter & Gamble', c: 'US' },
  { t: 'AMD', n: 'AMD', c: 'US' }, { t: 'ABBV', n: 'AbbVie', c: 'US' },
  { t: 'BAC', n: 'Bank of America', c: 'US' }, { t: 'CRM', n: 'Salesforce', c: 'US' },
  { t: 'KO', n: 'Coca-Cola', c: 'US' }, { t: 'CVX', n: 'Chevron', c: 'US' },
  { t: 'ASML', n: 'ASML', c: 'NL' }, { t: 'PLTR', n: 'Palantir', c: 'US' },
];

// Decision 2: these are the ETFs that track the indexes, named as such.
export const INDEX_PROXIES = [
  { t: 'SPY', label: 'S&P 500', tracks: 'SPX' },
  { t: 'QQQ', label: 'Nasdaq 100', tracks: 'NDX' },
  { t: 'DIA', label: 'Dow 30', tracks: 'DJI' },
  { t: 'IWM', label: 'Russell 2000', tracks: 'RUT' },
];

export const FLAGS = { US: '🇺🇸', TW: '🇹🇼', NL: '🇳🇱', IN: '🇮🇳', CN: '🇨🇳', JP: '🇯🇵', KR: '🇰🇷', GB: '🇬🇧', DE: '🇩🇪', CH: '🇨🇭', FR: '🇫🇷', CA: '🇨🇦' };

const num = v => (v == null || v === '' || typeof v === 'boolean' || !Number.isFinite(Number(v))
  ? null : Number(v));

// ---- rows ----------------------------------------------------------------

// Merge the curated universe, the user's own holdings, live quotes and whatever
// market caps have arrived so far into one list of rows.
//
// `caps` is { TICKER: marketCapInMillions }. A ticker absent from it is not a
// small company, it is a company we have not asked about yet.
export function buildRows({ universe = UNIVERSE, holdings = [], quotes = {}, caps = {}, spark = {} } = {}) {
  const seen = new Map();
  for (const u of universe) seen.set(u.t, { ...u, mine: false });
  for (const h of holdings) {
    const t = String(h.ticker || '').toUpperCase();
    if (!t) continue;
    const prev = seen.get(t);
    // A holding that is already in the universe keeps its curated name and
    // country and simply gains the "yours" mark.
    seen.set(t, prev ? { ...prev, mine: true } : { t, n: h.name || t, c: h.country || 'US', mine: true });
  }
  return [...seen.values()].map(u => {
    const q = quotes[u.t] || {};
    const price = num(q.price);
    const prev = num(q.prevClose);
    return {
      ticker: u.t,
      name: u.n,
      country: u.c,
      flag: FLAGS[u.c] || '',
      mine: !!u.mine,
      price,
      prevClose: prev,
      // Decision 6: no previous close, no percentage.
      changePct: price != null && prev != null && prev > 0 ? ((price - prev) / prev) * 100 : null,
      change: price != null && prev != null ? price - prev : null,
      marketCap: num(caps[u.t]),
      spark: Array.isArray(spark[u.t]) ? spark[u.t].filter(v => num(v) != null).map(Number) : null,
    };
  });
}

// Rank by market cap, biggest first. Rows without a cap keep their identity but
// get rank null and are pushed to the end as a clearly-marked "still loading"
// group rather than being given a number they have not earned.
export function rank(rows = []) {
  const known = rows.filter(r => r.marketCap != null && r.marketCap > 0)
    .sort((a, b) => b.marketCap - a.marketCap)
    .map((r, i) => ({ ...r, rank: i + 1 }));
  const unknown = rows.filter(r => r.marketCap == null || !(r.marketCap > 0))
    .sort((a, b) => (a.ticker < b.ticker ? -1 : 1))
    .map(r => ({ ...r, rank: null }));
  return [...known, ...unknown];
}

export const SORTS = [
  { key: 'cap', label: 'Market cap', get: r => r.marketCap, dir: -1 },
  { key: 'change', label: 'Today', get: r => r.changePct, dir: -1 },
  { key: 'price', label: 'Price', get: r => r.price, dir: -1 },
  { key: 'name', label: 'A–Z', get: r => r.ticker, dir: 1 },
];

// Sorting never promotes a missing value. Whatever the column, whichever way it
// is pointed, rows that lack the figure sink to the bottom — a blank is not a
// low number, and flipping the arrow must not turn it into a high one.
//
// `dir` is 1 for ascending and -1 for descending; omitted, each column uses the
// direction that is actually useful for it (biggest cap first, but A–Z by name).
export function sortRows(rows = [], key = 'cap', dir = null) {
  const s = SORTS.find(x => x.key === key) || SORTS[0];
  const d = dir === 1 || dir === -1 ? dir : s.dir;
  const have = [], lack = [];
  for (const r of rows) (s.get(r) == null ? lack : have).push(r);
  have.sort((a, b) => {
    const x = s.get(a), y = s.get(b);
    const c = typeof x === 'string' || typeof y === 'string'
      ? (String(x) < String(y) ? -1 : String(x) > String(y) ? 1 : 0)
      : x - y;
    return d * c;
  });
  return [...have, ...lack];
}

// ---- summary -------------------------------------------------------------

export function breadth(rows = []) {
  const judged = rows.filter(r => r.changePct != null);
  if (!judged.length) return { up: 0, down: 0, flat: 0, judged: 0, of: rows.length, avg: null };
  let up = 0, down = 0, flat = 0, sum = 0;
  for (const r of judged) {
    if (r.changePct > 0.001) up += 1; else if (r.changePct < -0.001) down += 1; else flat += 1;
    sum += r.changePct;
  }
  return { up, down, flat, judged: judged.length, of: rows.length, avg: sum / judged.length };
}

// Where the weight sits. Only over the rows that actually have a cap, and the
// coverage is reported so a "top 5 are 60% of the list" line can say of what.
export function capConcentration(rows = [], topN = 5) {
  const have = rows.filter(r => r.marketCap > 0).sort((a, b) => b.marketCap - a.marketCap);
  if (!have.length) return null;
  const total = have.reduce((s, r) => s + r.marketCap, 0);
  const top = have.slice(0, topN).reduce((s, r) => s + r.marketCap, 0);
  return { pct: (top / total) * 100, topN: Math.min(topN, have.length), covered: have.length, of: rows.length, total };
}

// ---- heat map ------------------------------------------------------------

// Squarified-ish treemap. Area is market cap; the caller paints by change.
// Rows without a cap are excluded entirely rather than drawn at zero size —
// a zero-area tile is an invisible lie rather than a visible one.
export function treemap(rows = [], width = 640, height = 300) {
  const items = rows.filter(r => r.marketCap > 0).sort((a, b) => b.marketCap - a.marketCap);
  if (!items.length || width <= 0 || height <= 0) return [];
  const total = items.reduce((s, r) => s + r.marketCap, 0);
  const out = [];
  let x = 0, y = 0, w = width, h = height, i = 0, remaining = total;

  while (i < items.length) {
    const horizontal = w >= h;
    const side = horizontal ? h : w;
    // Take a run of items whose combined share fills a reasonable strip.
    const target = Math.max(1, Math.round(Math.sqrt(items.length - i)));
    const run = items.slice(i, i + target);
    const runSum = run.reduce((s, r) => s + r.marketCap, 0);
    const thick = (runSum / remaining) * (horizontal ? w : h);
    let off = 0;
    for (const r of run) {
      const len = (r.marketCap / runSum) * side;
      out.push(horizontal
        ? { ...r, x, y: y + off, w: thick, h: len }
        : { ...r, x: x + off, y, w: len, h: thick });
      off += len;
    }
    if (horizontal) { x += thick; w -= thick; } else { y += thick; h -= thick; }
    remaining -= runSum;
    i += run.length;
    if (w <= 0.5 || h <= 0.5 || remaining <= 0) break;
  }
  return out;
}

// Decision 3: no move on file means grey, not green.
export function heatColour(changePct) {
  if (changePct == null || !Number.isFinite(changePct)) return { fill: 'rgba(140,140,160,0.22)', edge: 'rgba(180,180,200,0.35)' };
  const mag = Math.min(1, Math.abs(changePct) / 4);       // saturates at ±4%
  const a = 0.18 + mag * 0.55;
  return changePct >= 0
    ? { fill: `rgba(57,255,20,${a.toFixed(3)})`, edge: 'rgba(57,255,20,0.8)' }
    : { fill: `rgba(255,77,109,${a.toFixed(3)})`, edge: 'rgba(255,77,109,0.8)' };
}

// ---- sparkline -----------------------------------------------------------

// Decision 5: a single point is a dot, not a line. Returns null when there is
// nothing to draw at all, so the cell can stay empty instead of drawing a
// horizontal rule that reads as a flat month.
export function sparkPath(values = [], w = 62, h = 20) {
  const vals = (values || []).map(v => num(v)).filter(v => v != null);
  if (!vals.length) return null;
  const hi = Math.max(...vals), lo = Math.min(...vals);
  const span = hi - lo || Math.abs(hi) * 0.02 || 1;
  const px = i => (vals.length === 1 ? w / 2 : (i / (vals.length - 1)) * (w - 2) + 1);
  const py = v => h - 1 - ((v - lo) / span) * (h - 2);
  if (vals.length === 1) return { dot: { x: px(0), y: py(vals[0]) }, d: null, up: null, first: vals[0], last: vals[0] };
  const d = vals.map((v, i) => `${i ? 'L' : 'M'}${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(' ');
  return { d, dot: null, up: vals[vals.length - 1] >= vals[0], first: vals[0], last: vals[vals.length - 1] };
}

// ---- export --------------------------------------------------------------

export const CSV_COLUMNS = [
  ['rank', 'Rank'], ['ticker', 'Ticker'], ['name', 'Company'], ['country', 'Country'],
  ['marketCap', 'Market cap ($M)'], ['price', 'Price'], ['changePct', 'Change %'], ['mine', 'Held'],
];

// Decision 4: a blank exports as a blank. Never as zero.
export function toCsv(rows = [], columns = CSV_COLUMNS) {
  const esc = v => {
    if (v == null || v === '') return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = columns.map(c => esc(c[1])).join(',');
  const body = rows.map(r => columns.map(([k]) => {
    const v = r[k];
    if (k === 'mine') return v ? 'yes' : '';
    if (v == null) return '';
    if (typeof v === 'number') return Number.isFinite(v) ? String(Number(v.toFixed(4))) : '';
    return esc(v);
  }).join(','));
  return [head, ...body].join('\n');
}
