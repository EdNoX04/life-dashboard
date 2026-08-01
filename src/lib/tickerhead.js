// Ticker summary header + price chart — the arithmetic half.
//
// The reference screen is a company header (logo, name, exchange · industry ·
// sector, price, change chip, market cap, watchlist pill) over a big price chart
// with a Price / Total Return / Market Cap toggle, a 1D…All range row, and a
// date-range brush underneath.
//
// Almost all of that is honest and cheap. Three parts are not, and they are the
// three the reference makes look easiest:
//
// 1. THE LOGO IS THE ONLY PIXEL ON THIS SCREEN THAT PHONES HOME, SO IT IS NOT
//    DRAWN. Finnhub's profile carries a logo URL on its own CDN. Rendering it
//    tells a third party which company Neel opened and when, every single time,
//    for decoration. It also has the worst failure mode on the screen: a broken
//    image icon in the middle of a header. So the logo is GENERATED — two
//    letters of the ticker on a colour derived from the ticker's own characters.
//    No request, no tracking, no broken state, and it suits a pixel dashboard
//    better than a rounded corporate PNG ever would.
//
// 2. MARKET CAP HAS NO HISTORY AT THIS PRICE, SO THE TOGGLE REFUSES TO DRAW ONE.
//    A market-cap line is share count on that date × price on that date. The free
//    tier sells exactly one share count: today's. Multiplying today's count by
//    2016's price gives the market cap of a company that never existed —
//    buybacks alone move a large-cap's share count by a third over a decade. And
//    the fabricated line would be indistinguishable in SHAPE from the price line,
//    because it is the price line multiplied by a constant. So it would add no
//    information whatsoever and one large opportunity to be misread. The Market
//    Cap mode therefore shows today's cap, names both figures it could be, and
//    says in one sentence why there is no line.
//
// 3. TOTAL RETURN COMES FROM NEEL'S OWN TYPED DIVIDENDS OR IT DOES NOT COME.
//    There is no free dividend history either. But the Value screen already has
//    a dividends-per-share editor, and those are the same numbers. So this reads
//    that slot, reinvests them, and — when the slot is empty — says which screen
//    to type them on rather than quietly plotting the price line relabelled.
//
// And one that is only a trap because it looks like the others:
//
// 4. YTD IS A FILTER, NEVER A REQUEST LENGTH. Every other range is a fixed
//    number of bars. YTD is two days on 2 January and a full year on 30
//    December, so asking the feed for "a YTD's worth" undershoots for most of
//    the year — and a YTD chart that silently begins in March is a lie with a
//    correct-looking label on it. YTD always pulls the one-year daily series and
//    cuts it at 1 January, and if the data itself starts later than the window
//    asked for, the screen says where it actually starts.

// Third copy of this guard, and it stays a copy for the third time. `+null`,
// `+''` and `+false` are all 0, so any Number.isFinite(+v) turns a share count
// nobody reported into a company with no shares. Missing and zero are the two
// values this file must never confuse, and importing the guard across module
// boundaries would make deleting one file quietly change the arithmetic in
// another.
export function num(v) {
  if (v === null || v === undefined || typeof v === 'boolean') return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  const n = +v;
  return Number.isFinite(n) ? n : null;
}

const up = t => String(t || '').trim().toUpperCase();

// ---------------------------------------------------------------- ranges

// `tf` is the marketdata.js timeframe to REQUEST. `days` is the window to CUT to
// afterwards, and the two are deliberately different numbers: asking for more
// bars than the window needs costs the same one request, and it means a range
// can never render short because the request was sized exactly.
//
// It also means neighbouring ranges SHARE a request, which is the reason `tf` is
// oversized rather than merely adequate. 1M, 6M, YTD and 1Y all pull the same
// 260 daily bars and then cut to different lengths; 10Y and ALL both pull the
// same 400 monthly ones. marketdata.js caches by (symbol, timeframe), so
// toggling anywhere inside a group after the first press costs nothing — which
// matters a great deal on eight requests a minute.
//
// The temptation this resists is sizing each request to its own window: 6M is
// about 128 trading days and the feed offers a 130-bar option, which fits, right
// up until a range that fits exactly renders one bar short on a week with an
// extra holiday in it.
export const RANGES = [
  { key: '1D', label: '1D', tf: '5m', days: null, intraday: true,
    note: 'The most recent session only, in five-minute bars.' },
  { key: '5D', label: '5D', tf: '30m', days: 7, intraday: true,
    note: 'Roughly a trading week, in half-hour bars. Seven calendar days, so a long weekend does not shorten it.' },
  { key: '1M', label: '1M', tf: '1Y', days: 31, intraday: false,
    note: 'One month of daily closes.' },
  { key: '6M', label: '6M', tf: '1Y', days: 184, intraday: false,
    note: 'Six months of daily closes.' },
  { key: 'YTD', label: 'YTD', tf: '1Y', days: 'ytd', intraday: false,
    note: 'From 1 January of this year. A filter on the one-year series, never a shorter request — see decision 4.' },
  { key: '1Y', label: '1Y', tf: '1Y', days: 366, intraday: false,
    note: 'One year of daily closes.' },
  // 1813, not 1826. The feed sells at most 260 weekly bars here, and 260 weeks is
  // already six days short of five calendar years — so cutting at 1826 would put
  // a window wider than the data behind it. 1813 is 259 weeks, which leaves one
  // whole bar of margin. The margin is the point: `outputsize` is a ceiling and
  // not a promise, and a window that lands exactly on the oldest bar returned is
  // one rounding away from silently losing it.
  { key: '5Y', label: '5Y', tf: '5Y', days: 1813, intraday: false,
    note: 'Five years of weekly closes — 259 weeks, kept one bar inside what the feed returns rather than landing exactly on its oldest.' },
  { key: '10Y', label: '10Y', tf: 'ALL', days: 3653, intraday: false,
    note: 'Ten years of monthly closes.' },
  { key: 'ALL', label: 'All', tf: 'ALL', days: null, intraday: false,
    note: 'Every monthly close the feed will return — about thirty years, or the listing date, whichever is later.' },
];
export const rangeMeta = k => RANGES.find(r => r.key === k) || RANGES[5];

export const MODES = [
  { key: 'price', label: 'Price',
    note: 'The closing price of one share, as traded.' },
  { key: 'treturn', label: 'Total return',
    note: 'Price with dividends reinvested, indexed to 100 at the start of the window. Uses the dividends-per-share figures typed on the Value screen — there is no free dividend feed.' },
  { key: 'mcap', label: 'Market cap',
    note: 'Today\'s market capitalisation. There is no line: the only share count available is today\'s, so a historical cap chart would be the price chart wearing a bigger number.' },
];
export const modeMeta = k => MODES.find(m => m.key === k) || MODES[0];

// ---------------------------------------------------------------- dates

// Candle timestamps are ISO-ish: 'YYYY-MM-DD' or 'YYYY-MM-DD HH:MM:SS'. Both
// sort correctly as plain strings, which is why every window below is a string
// comparison rather than a Date construction per candle.
export const dayOf = t => String(t || '').slice(0, 10);
export function yearOf(t) {
  const y = +String(t || '').slice(0, 4);
  return Number.isFinite(y) && y > 1900 ? y : null;
}

export function isoDaysBefore(now, days) {
  const d = now instanceof Date ? new Date(now.getTime()) : new Date(now);
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

// The cut-off a range begins at, as a date string. null means "no cut" — take
// everything the feed returned.
export function cutoffFor(key, now = new Date()) {
  const r = rangeMeta(key);
  if (r.days === null) return null;
  if (r.days === 'ytd') {
    const d = now instanceof Date ? now : new Date(now);
    const y = Number.isNaN(d.getTime()) ? null : d.getFullYear();
    return y === null ? null : `${y}-01-01`;
  }
  return isoDaysBefore(now, r.days);
}

// ---------------------------------------------------------------- windowing

// Cut a candle list down to a range, and report honestly on what came back.
//
//   `short` means the data itself starts later than the window asked for — a
//   stock that listed eighteen months ago has no five-year chart, and the label
//   "5Y" over eighteen months of line is the kind of quiet lie this whole file
//   exists to avoid. It is a fact about the feed, not an error.
export function windowOf(candles, key, now = new Date()) {
  const all = (Array.isArray(candles) ? candles : [])
    .filter(c => c && num(c.c) !== null && String(c.t || '').length >= 10);
  if (!all.length) return { rows: [], key, short: false, wantedFrom: null, actualFrom: null, dropped: 0 };

  const r = rangeMeta(key);
  let rows;
  let wantedFrom = cutoffFor(key, now);

  if (r.key === '1D') {
    // The most recent SESSION, not the most recent 24 hours. Those differ every
    // Monday, and the difference is a chart that opens on Friday's afternoon.
    const lastDay = dayOf(all[all.length - 1].t);
    rows = all.filter(c => dayOf(c.t) === lastDay);
    wantedFrom = lastDay;
    // An intraday feed that returned only daily bars gives one row here, which
    // is not a chart. Fall back to the last two bars and let `short` say so.
    if (rows.length < 2) rows = all.slice(-2);
  } else if (wantedFrom === null) {
    rows = all;
  } else {
    rows = all.filter(c => dayOf(c.t) >= wantedFrom);
  }

  const actualFrom = rows.length ? dayOf(rows[0].t) : null;
  const feedFrom = dayOf(all[0].t);
  // `short` compares against where the FEED starts, not where the window starts:
  // the window starting late is only notable when there was nothing earlier to
  // include. Otherwise it started late because we cut it, which is the point.
  const short = wantedFrom !== null && r.key !== '1D' && feedFrom > wantedFrom;

  return {
    rows: rows.map(c => ({ t: c.t, price: num(c.c), o: num(c.o), h: num(c.h), l: num(c.l), v: num(c.v) })),
    key, short, wantedFrom, actualFrom, feedFrom,
    dropped: (Array.isArray(candles) ? candles.length : 0) - all.length,
  };
}

// ---------------------------------------------------------------- change

// Decision 4 in one function: a percentage is never returned without the date it
// is measured from, so nothing downstream can print "+2.4%" on its own.
//
// `prevClose` exists because 1D is the one range whose baseline is NOT the first
// bar in the window — an intraday chart starts at the open, and the change every
// other screen quotes for today is against yesterday's close. Passing it in
// keeps this screen's chip agreeing with the rest of the app.
export function changeOver(rows, prevClose = null) {
  const rs = (rows || []).filter(r => num(r?.price) !== null && r.price > 0);
  if (rs.length < 1) return null;
  const to = rs[rs.length - 1];
  const base = num(prevClose);
  const from = base !== null && base > 0
    ? { t: 'previous close', price: base }
    : rs[0];
  if (rs.length < 2 && base === null) return null;
  const abs = to.price - from.price;
  return {
    fromPrice: from.price, toPrice: to.price, abs,
    pct: (abs / from.price) * 100,
    fromLabel: base !== null && base > 0 ? 'previous close' : dayOf(from.t),
    toLabel: dayOf(to.t),
    n: rs.length,
  };
}

// ---------------------------------------------------------------- total return

// Decision 3. `dividends` is [{year, value}] — per-share cash declared for that
// financial year, exactly the shape the Value screen's editor already stores.
//
// The simplification, stated rather than buried: we know the YEAR a dividend
// belongs to and not the ex-date, so the whole year's cash is credited on the
// last bar of that year and reinvested at that close. Real dividends arrive in
// instalments through the year, so this understates compounding slightly on the
// way up. It is off by weeks of reinvestment, not by a factor — and the
// alternative is inventing four ex-dates a year that never happened.
export function totalReturn(rows, dividends) {
  const rs = (rows || []).filter(r => num(r?.price) !== null && r.price > 0);
  if (rs.length < 2) return { state: 'no_history', rows: [], credited: [], skipped: [] };

  const divs = (dividends || [])
    .map(d => ({ year: num(d?.year), value: num(d?.value) }))
    .filter(d => d.year !== null && d.value !== null && d.value > 0)
    .sort((a, b) => a.year - b.year);
  if (!divs.length) return { state: 'no_dividends', rows: [], credited: [], skipped: [] };

  // Last bar of each year present in THIS window.
  const lastIdx = new Map();
  rs.forEach((r, i) => { const y = yearOf(r.t); if (y !== null) lastIdx.set(y, i); });

  const atIdx = new Map();
  const skipped = [];
  for (const d of divs) {
    const i = lastIdx.get(d.year);
    // A dividend for a year this window does not cover is not an error and not a
    // zero — it is simply outside the picture, and it is counted so the screen
    // can say "3 of your 8 years fall inside this range" instead of implying the
    // total return used all of them.
    if (i === undefined) { skipped.push(d); continue; }
    atIdx.set(i, (atIdx.get(i) || 0) + d.value);
  }

  let units = 1;
  const credited = [];
  const out = [];
  const p0 = rs[0].price;
  for (let i = 0; i < rs.length; i++) {
    const p = rs[i].price;
    // Value is measured BEFORE the credit at this bar, which is not an
    // approximation: receiving cash and immediately buying shares with it leaves
    // total value unchanged at that instant. The credit only changes later bars.
    out.push({ t: rs[i].t, px: (p / p0) * 100, tr: ((units * p) / p0) * 100, price: p });
    const d = atIdx.get(i);
    if (d) {
      const added = (units * d) / p;
      units += added;
      credited.push({ year: yearOf(rs[i].t), value: d, t: rs[i].t, price: p, unitsAfter: units });
    }
  }

  const last = out[out.length - 1];
  return {
    state: 'ok',
    rows: out,
    credited,
    skipped,
    units,
    pricePct: last.px - 100,
    totalPct: last.tr - 100,
    // What the dividends were worth, in points of return. This is the only
    // number on the screen that answers "was it worth typing them in".
    dividendPct: last.tr - last.px,
    from: dayOf(rs[0].t),
    to: dayOf(rs[rs.length - 1].t),
  };
}

// ---------------------------------------------------------------- market cap

export const CAP_REFUSAL =
  'There is no market-cap history here. A cap on any past date is that date\'s share count times that date\'s '
  + 'price, and the only share count this feed sells is today\'s — applying it backwards charts a company that '
  + 'never existed, in exactly the shape of the price chart. Today\'s figure is below; the line is refused.';

// Two market caps, because there are genuinely two and they disagree.
//
//   `reported` is what the profile endpoint said, snapshotted whenever it was
//   last cached — up to a day old, and computed against a price from then.
//   `live`     is today's share count times the price on screen right now.
//
// The gap between them is the staleness, made visible. A screen that prints only
// one of these implies a precision that a daily-cached endpoint does not have.
export function capFigure(profile, price) {
  const shares = num(profile?.shareOutstanding);      // millions of shares
  const reported = num(profile?.marketCapitalization); // millions of currency
  const p = num(price);
  const live = shares !== null && shares > 0 && p !== null && p > 0 ? shares * p : null;
  const gapPct = live !== null && reported !== null && reported > 0
    ? ((live - reported) / reported) * 100 : null;
  return {
    shares, reported, live, gapPct,
    // A gap of a couple of percent is a day of price movement and says nothing.
    // A gap of thirty percent means one of the two figures is about a different
    // company, and the screen should stop being confident.
    disagrees: gapPct !== null && Math.abs(gapPct) > 15,
  };
}

// Compact currency for a figure in MILLIONS, which is the unit Finnhub uses and
// therefore the unit every caller here has. Taking millions and printing "B" is
// the sort of thing that is wrong by a thousand exactly once.
export function fmtCapM(m, cur = '$') {
  const n = num(m);
  if (n === null || n <= 0) return '—';
  if (n >= 1e6) return `${cur}${(n / 1e6).toFixed(2)}T`;
  if (n >= 1e3) return `${cur}${(n / 1e3).toFixed(2)}B`;
  return `${cur}${n.toFixed(0)}M`;
}

// ---------------------------------------------------------------- monogram

// Decision 1. Two letters and a colour, both derived from the ticker's own
// characters, so the same ticker always draws the same tile and no two adjacent
// holdings collide by accident more often than six colours allow.
const MONO_COLORS = ['var(--cyan)', 'var(--green)', 'var(--orange)', 'var(--pink)', 'var(--purple)', 'var(--yellow)'];

export function monogram(ticker) {
  const t = up(ticker).replace(/[^A-Z0-9]/g, '');
  if (!t) return null;
  // FNV-1a, 32-bit. Any stable hash works; this one is four lines and has no
  // clustering on short uppercase strings, which is the entire input domain.
  let h = 0x811c9dc5;
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return { text: t.slice(0, 2), color: MONO_COLORS[h % MONO_COLORS.length], hash: h };
}

// ---------------------------------------------------------------- profile

// What the header can actually claim, with the gaps named.
//
// The reference prints EXCHANGE · INDUSTRY · SECTOR. This feed carries an
// exchange and an industry and no sector at all, and the tempting fix — a
// hand-written industry-to-sector table — would put a classification of MY
// invention on screen in the same typeface as two the exchange actually
// publishes. So sector comes from Neel's own saved asset metadata if he set one,
// and is otherwise absent and labelled absent.
export function profileOf(profile, savedMeta) {
  const p = profile || {};
  const name = typeof p.name === 'string' && p.name.trim() ? p.name.trim() : null;
  const exchange = typeof p.exchange === 'string' && p.exchange.trim() ? p.exchange.trim() : null;
  const industry = typeof p.finnhubIndustry === 'string' && p.finnhubIndustry.trim()
    ? p.finnhubIndustry.trim() : null;
  const sector = savedMeta && typeof savedMeta.sector === 'string' && savedMeta.sector.trim()
    ? savedMeta.sector.trim() : null;
  const missing = [];
  if (!name) missing.push('company name');
  if (!exchange) missing.push('exchange');
  if (!industry) missing.push('industry');
  return {
    name, exchange, industry, sector,
    currency: typeof p.currency === 'string' ? p.currency : null,
    ipo: typeof p.ipo === 'string' ? p.ipo : null,
    country: typeof p.country === 'string' ? p.country : null,
    missing,
    // The sector line is the one the reference has and this cannot fill from a
    // feed, so it gets its own flag rather than sitting in `missing` alongside
    // things that a key would fix.
    sectorSource: sector ? 'your saved asset metadata' : null,
  };
}

// ---------------------------------------------------------------- brush

// A range brush that cannot invert and cannot select a window too small to draw.
//
// The swap is deliberate and documented: dragging right-to-left is a normal
// gesture and should select the same window as dragging left-to-right, but most
// implementations achieve that by swapping silently in a place where a genuine
// lo > hi bug also gets swallowed. Here the swap happens once, in the open, and
// every other caller can assume lo <= hi afterwards.
export function brushClamp(a, b, n, min = 3) {
  const N = num(n);
  if (N === null || N < 2) return null;
  const span = Math.min(Math.max(2, Math.round(num(min) ?? 3)), N);
  let lo = Math.round(num(a) ?? 0);
  let hi = Math.round(num(b) ?? N - 1);
  if (!Number.isFinite(lo)) lo = 0;
  if (!Number.isFinite(hi)) hi = N - 1;
  if (lo > hi) { const t = lo; lo = hi; hi = t; }
  lo = Math.max(0, Math.min(N - 1, lo));
  hi = Math.max(0, Math.min(N - 1, hi));
  // Grow to the minimum span, preferring to push the right edge out and falling
  // back to the left. The bounded loop is not a style choice: expanding one side
  // at a time near an edge is the only version of this that stays inside [0,N).
  let guard = 0;
  while (hi - lo + 1 < span && guard++ < N) {
    if (hi < N - 1) hi++;
    else if (lo > 0) lo--;
    else break;
  }
  return { lo, hi, n: N, full: lo === 0 && hi === N - 1 };
}

// ---------------------------------------------------------------- geometry

// One polyline plus a filled area, in the same coordinate space as the brush
// beneath it so a selection lines up with the pixels it selected.
//
// `field` is which number to plot — 'price' for the price chart, 'tr'/'px' for
// the two total-return lines — because the alternative is three near-identical
// geometry functions that drift apart the first time one of them is fixed.
// `scale` is an optional {lo, hi} that overrides the series' own extremes, and it
// exists for exactly one situation: the total-return mode draws TWO lines in one
// box. Two lines each fitted to their own extremes fill the same rectangle
// regardless of how far apart they actually are, so the gap between them — which
// is the entire point of that mode — would be drawn as roughly constant whether
// the dividends added one point or forty. Sharing a scale is not cosmetic there;
// it is the difference between a chart that answers the question and one that
// cannot. Nothing else passes it.
export function chartGeometry(rows, field = 'price', w = 640, h = 220, pad = 8, scale = null) {
  const rs = (rows || []).filter(r => num(r?.[field]) !== null);
  if (rs.length < 2) return null;
  const vals = rs.map(r => r[field]);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const sLo = num(scale?.lo), sHi = num(scale?.hi);
  // A supplied scale must CONTAIN the series, never crop it. A caller that
  // passes a window narrower than the data would silently push points outside
  // the box, so the override widens and is not allowed to narrow.
  if (sLo !== null && sHi !== null && sHi > sLo) { lo = Math.min(lo, sLo); hi = Math.max(hi, sHi); }
  // A perfectly flat series has zero range, and dividing by it puts every point
  // at NaN or at the top edge depending on the order of operations. Give it a
  // nominal band and centre the line in it.
  if (hi - lo < 1e-9) { const m = Math.abs(hi) || 1; lo -= m * 0.01; hi += m * 0.01; }
  const x = i => pad + (i / (rs.length - 1)) * (w - pad * 2);
  const y = v => pad + (1 - (v - lo) / (hi - lo)) * (h - pad * 2);
  const pts = rs.map((r, i) => `${x(i).toFixed(2)},${y(r[field]).toFixed(2)}`);
  return {
    w, h, lo, hi, n: rs.length,
    line: pts.join(' '),
    area: `${pad.toFixed(2)},${(h - pad).toFixed(2)} ${pts.join(' ')} ${x(rs.length - 1).toFixed(2)},${(h - pad).toFixed(2)}`,
    first: rs[0], last: rs[rs.length - 1],
    xAt: i => x(i),
    // Up or down over the window, which is what decides the line's colour. It is
    // computed here, from the same rows the line is drawn from, so the colour can
    // never disagree with the shape.
    up: rs[rs.length - 1][field] >= rs[0][field],
  };
}

// Evenly spaced date labels that always include both ends, because a chart whose
// axis stops short of its own last point invites reading the wrong date off it.
export function axisDates(rows, count = 5) {
  const rs = rows || [];
  if (rs.length < 2) return [];
  const n = Math.max(2, Math.min(count, rs.length));
  const out = [];
  for (let i = 0; i < n; i++) {
    const idx = Math.round((i / (n - 1)) * (rs.length - 1));
    out.push({ idx, label: dayOf(rs[idx].t), pct: (idx / (rs.length - 1)) * 100 });
  }
  return out;
}

export const HEAD_DISCLAIMER =
  'Prices come from the historical feed and are end-of-bar closes, not ticks. Dividends, where used, are the '
  + 'figures typed by hand on the Value screen. This is a record of what happened, not a forecast, and nothing '
  + 'here is investment advice.';
