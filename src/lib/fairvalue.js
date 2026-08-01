// Fair value — a valuation spectrum built out of arithmetic that can be checked.
//
// The reference screen shows a big verdict ("Good entry"), an implied fair
// value, and a Cheap→Expensive bar. Underneath, all of that is one division:
// price ÷ a per-share figure, collected over years, and asked where today sits
// in its own range. That much is honest. The dishonest parts are the framing,
// and they are the parts a personal app is most tempted to copy. So:
//
// 1. THERE IS NO FUNDAMENTALS FEED AT THIS PRICE, AND PRETENDING OTHERWISE IS
//    THE WHOLE LIE. Twelve Data's free tier sells price history, not earnings
//    history. Every EPS, dividend and cash-flow figure here is typed in by hand,
//    which means each one is exactly as good as the source it was copied from.
//    So a typed number is labelled as typed, everywhere, and the screen refuses
//    to compute rather than fill a gap with an estimate of its own invention.
//
// 2. THE MEDIAN MULTIPLE IS NOT "FAIR VALUE". It is what this market has paid
//    for this company over the chosen window. Those are different claims, and
//    the difference is the entire risk of the screen: a stock that was expensive
//    for ten years has a high median, and measuring today against it says the
//    price is reasonable when what it means is that the price is normal for a
//    stock that has been expensive for ten years. Every label therefore says
//    "implied by the median multiple" and prints the window. The words "fair
//    value" appear only as the name of the reference concept, never as a claim.
//
// 3. A NEGATIVE OR ZERO DENOMINATOR IS A REFUSAL, NOT A BIG NUMBER. Price
//    divided by a loss is a negative multiple, which is not a cheap stock; price
//    divided by a near-zero figure is a multiple of four thousand, which is not
//    an expensive stock. Both are the arithmetic telling you the question does
//    not apply. Those periods are dropped from the band AND counted on screen,
//    because dropping them silently narrows the range and makes the band look
//    tighter than the company's history actually was.
//
// 4. A MULTIPLE IS PRICE DIVIDED BY WHAT WAS KNOWN THEN. Dividing 2019's price
//    by 2024's earnings produces a beautiful, cheap-looking history that nobody
//    could have traded. Each price is paired with the most recent financial year
//    that had already finished on that date, and the pairing is printed.
//
// 5. NOTHING HERE IS A RECOMMENDATION. The verdict line in the reference image
//    says "Good entry". This one says where the price sits against a band and
//    which numbers produced the band. I am not a licensed adviser, the input is
//    hand-typed, and a sentence that reads like a decision is a sentence Neel
//    might act on without re-deriving it.

// ---------- the one number guard ----------

// Same guard as sentiment.js, and it is repeated rather than shared for the same
// reason: `+null`, `+''` and `+false` are all 0, so any naive Number.isFinite(+v)
// turns a missing figure into a company that earned exactly nothing. Missing and
// zero are the two values this file must never confuse.
export function num(v) {
  if (v === null || v === undefined || typeof v === 'boolean') return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  const n = +v;
  return Number.isFinite(n) ? n : null;
}

// ---------- what can be divided into a price ----------

// Everything here is PER SHARE, because the numerator is a share price. For EPS
// and dividends that is how the figure is published anyway. For revenue, EBITDA
// and cash flow it is not: those are company-wide, and turning them per-share
// means dividing by the diluted share count yourself. The note says so on every
// one of them, because "Revenue 96,773" typed into a per-share box is the single
// most likely way this screen produces a confident, absurd answer.
export const METRICS = [
  { key: 'eps', label: 'EPS', short: 'P/E', unit: '/sh',
    note: 'Earnings per share, as published.' },
  { key: 'dividend', label: 'Dividend', short: 'P/D', unit: '/sh',
    note: 'Dividends declared per share for the year. This multiple is the inverse of dividend yield — 25× is a 4% yield.' },
  { key: 'fcf', label: 'FCF', short: 'P/FCF', unit: '/sh',
    note: 'Free cash flow per share — operating cash flow minus capital expenditure, divided by diluted shares.' },
  { key: 'ocf', label: 'OCF', short: 'P/OCF', unit: '/sh',
    note: 'Operating cash flow per share. Divide the cash-flow statement figure by diluted shares yourself.' },
  { key: 'revenue', label: 'Revenue', short: 'P/S', unit: '/sh',
    note: 'Revenue per share. Divide total revenue by diluted shares — the headline revenue figure will not work here.' },
  { key: 'ebitda', label: 'EBITDA', short: 'P/EBITDA', unit: '/sh',
    note: 'EBITDA per share. This is a price multiple, not EV/EBITDA — it ignores debt and cash, which is exactly what EV/EBITDA exists to fix.' },
  { key: 'book', label: 'Book', short: 'P/B', unit: '/sh',
    note: 'Book value per share — total equity divided by diluted shares.' },
];

export const metricMeta = k => METRICS.find(m => m.key === k) || METRICS[0];

// The basis toggle is a LABEL ON NEEL'S OWN TYPED NUMBERS, not a data source.
// Nothing here can tell whether the 5.61 he typed came from an adjusted press
// release or a GAAP filing, so the honest thing a toggle can do is keep the
// three sets apart and print which one is on screen — never silently mix them.
export const BASES = [
  { key: 'adj', label: 'Adj', title: 'Adjusted — the company\'s own figure, excluding items it calls one-off.' },
  { key: 'gaap', label: 'GAAP', title: 'As filed, including every charge. Usually the lower and less flattering number.' },
  { key: 'fwd', label: 'FWD', title: 'Forward estimates for years that have not finished. These have no history, so they produce an implied value but no band.' },
];
export const basisMeta = k => BASES.find(b => b.key === k) || BASES[0];

export const LOOKBACKS = [3, 5, 10, 0]; // 0 = every year that has an entry
export const lookbackLabel = y => (y ? `${y}Y` : 'All');

// A multiple this large is not an expensive stock, it is a denominator rounding
// to nothing. Capping is a judgement call, so the cap is a named constant and
// the count of what it removed is printed rather than folded away.
export const MULTIPLE_CAP = 400;

// ---------- small statistics, written out ----------

export function median(xs) {
  const s = (xs || []).map(num).filter(v => v !== null).sort((a, b) => a - b);
  if (!s.length) return null;
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function quantile(xs, q) {
  const s = (xs || []).map(num).filter(v => v !== null).sort((a, b) => a - b);
  if (!s.length) return null;
  if (s.length === 1) return s[0];
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

// Where a value sits inside a range, 0..100. Used for the marker on the bar and
// for the percentile sentence; clamped so a new all-time high pins at 100 rather
// than sliding off the end of the track.
export function positionOf(v, lo, hi) {
  const x = num(v), a = num(lo), b = num(hi);
  if (x === null || a === null || b === null || a === b) return null;
  return Math.max(0, Math.min(100, ((x - a) / (b - a)) * 100));
}

// ---------- entries ----------

// An entry is { year, value }. Years are financial years as Neel labels them;
// nothing here tries to be clever about April-March fiscal calendars, because
// guessing a company's year-end from a number is exactly the kind of invention
// decision 1 rules out. The screen says "financial year as you labelled it".
export function cleanEntries(entries) {
  const seen = new Map();
  for (const e of entries || []) {
    const y = num(e && e.year), v = num(e && e.value);
    if (y === null || !Number.isInteger(y) || y < 1900 || y > 2200) continue;
    if (v === null) continue;
    seen.set(y, { year: y, value: v }); // a later duplicate wins; the editor de-dupes on save too
  }
  return [...seen.values()].sort((a, b) => a.year - b.year);
}

// Decision 4, in one function. `asOfYear` is the calendar year of the price;
// the answer is the newest financial year that had already finished by then.
export function entryKnownAt(entries, asOfYear) {
  const y = num(asOfYear);
  if (y === null) return null;
  let best = null;
  for (const e of entries) if (e.year <= y - 1 && (!best || e.year > best.year)) best = e;
  return best;
}

// The figure the CURRENT price is divided by. For adjusted and GAAP that is the
// last finished year, same rule as the history. For forward estimates it is the
// newest entry there is — that is what "forward" means — and the year is printed
// beside it so a 2027 estimate can never be mistaken for a 2025 result.
export function currentEntry(entries, basis, thisYear) {
  const y = num(thisYear);
  if (!entries.length || y === null) return null;
  if (basis === 'fwd') return entries[entries.length - 1];
  return entryKnownAt(entries, y);
}

export function entryLabel(e, basis) {
  if (!e) return '—';
  if (basis === 'fwd') return `FY${e.year} estimate`;
  return `FY${e.year} as filed`;
}

// ---------- pairing prices with figures ----------

const yearOf = t => {
  const m = /^(\d{4})/.exec(String(t || ''));
  return m ? +m[1] : null;
};

// One row per candle that could be paired and divided. `state` says why a candle
// produced no multiple, so the counts on screen add up to the number of candles
// rather than trailing off into an unexplained difference.
export function pairMultiples(candles, entries) {
  const rows = [];
  let noEntry = 0, nonPositive = 0, capped = 0;
  for (const c of candles || []) {
    const price = num(c && c.c);
    const yr = yearOf(c && c.t);
    if (price === null || yr === null) continue;
    const e = entryKnownAt(entries, yr);
    if (!e) { noEntry++; continue; }
    if (e.value <= 0) { nonPositive++; continue; }
    const mult = price / e.value;
    if (mult > MULTIPLE_CAP) { capped++; continue; }
    rows.push({ t: c.t, price, mult, fy: e.year, figure: e.value });
  }
  return { rows, noEntry, nonPositive, capped, considered: (candles || []).length };
}

// ---------- the band ----------

export function spectrum(mults) {
  const s = (mults || []).map(num).filter(v => v !== null).sort((a, b) => a - b);
  if (!s.length) return null;
  return {
    n: s.length,
    min: s[0],
    max: s[s.length - 1],
    median: median(s),
    p25: quantile(s, 0.25),
    p75: quantile(s, 0.75),
  };
}

// ---------- the whole computation ----------

// Returns a single object the screen renders directly. `state` is the load-
// bearing field: 'ok' | 'no_entries' | 'no_price' | 'no_history' | 'bad_figure'.
// Every non-ok state carries a `reason` in plain English, because a blank panel
// that does not say what is missing is a bug report waiting to be filed.
export function computeFairValue({
  candles = [],
  entries = [],
  metric = 'eps',
  basis = 'adj',
  lookback = 5,
  price = null,
  target = null,      // a target multiple Neel has overridden; null = use the median
  thisYear = null,
} = {}) {
  const meta = metricMeta(metric);
  const clean = cleanEntries(entries);
  const yr = num(thisYear) ?? new Date().getFullYear();

  // `candles` is normalised once, here. Every later use went through a
  // `(candles || [])` guard except this one, which is exactly how a null gets
  // all the way to a `.length` — the guard that is written six times is the
  // guard that gets forgotten on the seventh.
  const cs = Array.isArray(candles) ? candles : [];
  const px = num(price) ?? num(cs.length ? cs[cs.length - 1].c : null);
  const cur = currentEntry(clean, basis, yr);

  const base = {
    metric, basis, lookback, meta, entries: clean, price: px,
    current: cur, currentLabel: entryLabel(cur, basis),
    spectrum: null, rows: [], counts: null,
    currentMultiple: null, target: null, targetSource: null,
    implied: null, gapPct: null, percentile: null,
  };

  if (!clean.length) {
    return { ...base, state: 'no_entries',
      reason: `No ${meta.label.toLowerCase()} figures have been entered for this ticker on the ${basisMeta(basis).label} basis. There is no free feed for them, so they are typed in below.` };
  }
  if (px === null) {
    return { ...base, state: 'no_price',
      reason: 'No price is loaded yet. Load the price history and the band builds itself from it.' };
  }

  // Only candles inside the window. lookback 0 means every candle there is.
  const cut = lookback ? `${yr - lookback}` : '0000';
  const inWindow = cs.filter(c => String(c.t || '') >= cut);
  const paired = pairMultiples(inWindow, clean);
  const sp = spectrum(paired.rows.map(r => r.mult));

  const curMult = cur && cur.value > 0 ? px / cur.value : null;

  if (!cur) {
    return { ...base, state: 'bad_figure', counts: paired, spectrum: sp, rows: paired.rows,
      reason: `Every entered year is ${yr} or later, so no financial year has finished yet on this basis. Add an earlier year, or switch to the FWD basis if these are estimates.` };
  }
  if (cur.value <= 0) {
    return { ...base, state: 'bad_figure', counts: paired, spectrum: sp, rows: paired.rows,
      currentMultiple: null,
      reason: `${entryLabel(cur, basis)} is ${cur.value}. Price divided by a loss is a negative multiple, which is not a cheap stock — it is the arithmetic saying this metric does not describe this company right now. Try book value or revenue instead.` };
  }
  if (!sp) {
    return { ...base, state: 'no_history', counts: paired, currentMultiple: curMult,
      reason: basis === 'fwd'
        ? 'Forward estimates have no history, so there is no band to place today against — only the implied value from the target multiple below.'
        : `No price in the last ${lookbackLabel(lookback)} could be paired with a finished financial year. Widen the window, load more price history, or add earlier years.` };
  }

  // Decision 2 lives here: the DEFAULT target is the median of what this market
  // actually paid, not a number this file invented, and its source is named so
  // the tile can say which it is.
  const t = num(target);
  const useTarget = t !== null && t > 0 ? t : sp.median;
  const targetSource = t !== null && t > 0 ? 'yours' : `${lookbackLabel(lookback)} median`;

  const implied = useTarget * cur.value;
  const gapPct = ((implied - px) / px) * 100;
  const percentile = positionOf(curMult, sp.min, sp.max);

  return {
    ...base, state: 'ok',
    reason: '',
    spectrum: sp, rows: paired.rows, counts: paired,
    currentMultiple: curMult,
    target: useTarget, targetSource,
    implied, gapPct, percentile,
  };
}

// ---------- what the screen is allowed to say ----------

// Decision 5. The reference image's headline is a verdict; this is a
// measurement. Every branch is a statement about where a number sits, and the
// two sentences together always name both the multiple and the window, so the
// claim can never be quoted without its basis attached.
export function verdictOf(r) {
  if (!r || r.state !== 'ok') return null;
  const g = r.gapPct, sp = r.spectrum, lb = lookbackLabel(r.lookback);
  const dir = g >= 0 ? 'below' : 'above';
  const mag = Math.abs(g);
  const headline = mag < 1.5
    ? `Price sits within 2% of the value implied by the ${r.targetSource} multiple`
    : `Price sits ${mag.toFixed(0)}% ${dir} the value implied by the ${r.targetSource} multiple`;
  const detail =
    `Today's ${r.meta.short} of ${r.currentMultiple.toFixed(1)}× against a ${lb} range of `
    + `${sp.min.toFixed(1)}× to ${sp.max.toFixed(1)}× (median ${sp.median.toFixed(1)}×), `
    + `using the ${r.currentLabel} figure of ${r.current.value}.`;
  return { headline, detail, gap: g };
}

// A one-word tag for the bar, describing the POSITION IN THE RANGE and nothing
// else. "Cheap" here means low against this company's own history — a company
// can sit at the bottom of its band all the way down, which is why the tag never
// appears without the sentence above it.
export function bandTag(pct) {
  const p = num(pct);
  if (p === null) return null;
  if (p <= 20) return { key: 'low', label: 'LOW IN ITS RANGE', color: 'var(--green)' };
  if (p <= 40) return { key: 'below', label: 'BELOW MID-RANGE', color: 'var(--cyan)' };
  if (p <= 60) return { key: 'mid', label: 'MID-RANGE', color: 'var(--yellow)' };
  if (p <= 80) return { key: 'above', label: 'ABOVE MID-RANGE', color: 'var(--orange)' };
  return { key: 'high', label: 'HIGH IN ITS RANGE', color: 'var(--red)' };
}

// ---------- the price-vs-implied chart ----------

// One point per candle: the price that day, and what the target multiple implies
// against the figure that was known that day. Same pairing rule as the band, so
// the chart and the tiles can never disagree.
export function fairSeries(candles, entries, targetMultiple) {
  const clean = cleanEntries(entries);
  const t = num(targetMultiple);
  if (t === null || t <= 0) return [];
  const out = [];
  for (const c of candles || []) {
    const price = num(c && c.c), yr = yearOf(c && c.t);
    if (price === null || yr === null) continue;
    const e = entryKnownAt(clean, yr);
    if (!e || e.value <= 0) continue;
    out.push({ t: c.t, price, fair: t * e.value, fy: e.year });
  }
  return out;
}

// Turns the series into the two polyline strings and the crossing points where
// the fill has to change colour. Splitting on the crossing is what lets the area
// be green below and red above without a gradient faking the boundary.
export function chartGeometry(series, w = 560, h = 190, pad = 6) {
  if (!series || series.length < 2) return null;
  const vals = series.flatMap(p => [p.price, p.fair]).filter(v => Number.isFinite(v));
  if (!vals.length) return null;
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (lo === hi) { lo -= 1; hi += 1; }
  const padY = (hi - lo) * 0.06;
  lo -= padY; hi += padY;
  const x = i => pad + (i / (series.length - 1)) * (w - pad * 2);
  const y = v => pad + (1 - (v - lo) / (hi - lo)) * (h - pad * 2);
  const px = series.map((p, i) => `${x(i).toFixed(1)},${y(p.price).toFixed(1)}`);
  const fx = series.map((p, i) => `${x(i).toFixed(1)},${y(p.fair).toFixed(1)}`);

  // Bands of consecutive points on the same side, so each band closes into its
  // own polygon. A single polygon with one fill would colour the whole area by
  // whichever side happened to be true at the last point.
  const bands = [];
  let cur = null;
  series.forEach((p, i) => {
    const under = p.price <= p.fair;
    if (!cur || cur.under !== under) { cur = { under, from: i, to: i }; bands.push(cur); }
    else cur.to = i;
  });
  const polys = bands.filter(b => b.to > b.from).map(b => {
    const top = [], bottom = [];
    for (let i = b.from; i <= b.to; i++) {
      top.push(`${x(i).toFixed(1)},${y(series[i].price).toFixed(1)}`);
      bottom.push(`${x(i).toFixed(1)},${y(series[i].fair).toFixed(1)}`);
    }
    return { under: b.under, points: [...top, ...bottom.reverse()].join(' ') };
  });
  return { w, h, lo, hi, price: px.join(' '), fair: fx.join(' '), polys };
}

// ---------- storage ----------

// Zero-migration rule: no table gets a column for this. Everything lives in ONE
// memory row under a flat map, because the alternative — a row per ticker — makes
// the read filter depend on what is on screen, and a filter that changes with the
// UI is a filter that will one day be built from a string nobody escaped.
//
// The map key carries the basis, which is the point: switching the Adj/GAAP/FWD
// toggle addresses a different slot, so saving on one basis can never overwrite
// the numbers typed on another.
export const FV_MEMORY_KEY = 'fv_figures';

export const entryKey = (ticker, metric, basis) =>
  `fv:${String(ticker || '').toUpperCase()}:${metric}:${basis}`;

export function readEntries(blob, ticker, metric, basis) {
  const v = blob && blob[entryKey(ticker, metric, basis)];
  return cleanEntries(Array.isArray(v) ? v : []);
}

// Read-modify-write on the whole map. An empty list DELETES the slot rather than
// storing `[]`, so "I cleared these figures" and "I never typed any" are the same
// state on disk — otherwise the blob accumulates empty slots for every ticker
// whose editor was ever opened.
export function writeEntries(blob, ticker, metric, basis, entries) {
  const next = { ...(blob || {}) };
  const k = entryKey(ticker, metric, basis);
  const clean = cleanEntries(entries);
  if (clean.length) next[k] = clean; else delete next[k];
  return next;
}

export const DISCLAIMER =
  'Every financial figure on this screen was typed in by hand — nothing verifies it against a filing. '
  + 'The band is what this market has paid, not what the company is worth, and this is information, not investment advice.';
