// The yield analyser.
//
// A dividend yield on its own is a number without a unit of meaning. 7.63% is
// high for a utility, low for a mortgage REIT, and normal for this particular
// name — and the only way to know which is to compare the yield against its own
// history rather than against a mental average of other companies. That is what
// this module does: it turns a series of daily yields into a distribution, and
// then says where today sits in it.
//
// Four decisions, each preventing one specific way this screen could lie.
//
// 1. "CHEAP" IS A STATEMENT ABOUT THE YIELD, NOT ABOUT THE STOCK. A yield in its
//    90th percentile means the yield has rarely been this high. It does not mean
//    the shares are underpriced. Those coincide when the dividend is safe and
//    diverge violently when it is not, which is exactly the case where somebody
//    reading a single word off a card gets hurt. So every verdict in VERDICTS
//    talks about the yield, and the copy never contains the words buy, sell,
//    cheap stock, or opportunity.
//
// 2. A HIGH YIELD IS SOMETIMES A FALLING PRICE. Yield is dividend over price, so
//    it rises when the numerator grows and it rises when the denominator
//    collapses, and the distribution cannot tell those apart. This is the yield
//    trap, and it is the single most common way an income screen loses money.
//    So the dividend growth row is not a decoration next to the percentile — it
//    is an input to the verdict. When trailing growth is negative and the
//    percentile is high, verdictFor returns the trap reading instead of the
//    cheap one. See the `guard` branch.
//
// 3. A PERCENTILE OF TWELVE OBSERVATIONS IS NOT A PERCENTILE. Ranking today
//    against a handful of points produces a number between 0 and 100 that looks
//    exactly like a real one. MIN_OBS is the floor below which this module
//    declines to render a verdict at all, and stats() carries `thin` so the
//    component can say why rather than showing a confident band over noise.
//
// 4. THE WINDOW IS PART OF THE CLAIM. "49th percentile" is meaningless without
//    "of the last five years", because the same yield is typically cheap on a
//    1Y window and expensive on a 10Y one. Every number this module returns
//    carries the window that produced it, and the component prints it.

/** A number or null. Strings from inputs and nulls from missing data both land here. */
export function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9eE+.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

// ---------- basis ----------

// Forward and trailing are different questions, not two estimates of one. FWD
// asks what the current declared rate implies if it continues; TTM asks what was
// actually paid. They disagree by exactly the size of the last raise, and a
// screen that silently picks one is hiding that disagreement.
export const YIELD_BASIS = [
  { key: 'fwd', label: 'FWD', title: 'Forward',
    note: 'The most recent declared rate, annualised. What you would collect if nothing changes.' },
  { key: 'ttm', label: 'TTM', title: 'Trailing',
    note: 'What was actually paid over the last twelve months. Lags every raise by up to a year.' },
];

export const basisMeta = k => YIELD_BASIS.find(b => b.key === k) || YIELD_BASIS[0];

// ---------- windows ----------

// `months: null` means the whole series. YTD is not a month count, so it carries
// a from() instead — the two kinds are distinguished by which field is present
// rather than by a special-case on the key string.
export const YIELD_RANGES = [
  { key: '6M', label: '6M', months: 6 },
  { key: 'YTD', label: 'YTD', from: today => new Date(today.getFullYear(), 0, 1) },
  { key: '1Y', label: '1Y', months: 12 },
  { key: '3Y', label: '3Y', months: 36 },
  { key: '5Y', label: '5Y', months: 60 },
  { key: '10Y', label: '10Y', months: 120 },
  { key: 'All', label: 'All', months: null },
];

export const rangeMeta = k => YIELD_RANGES.find(r => r.key === k) || YIELD_RANGES[4];

export const DEFAULT_RANGE = '5Y';

/** The cutoff date a range implies, or null for "everything". */
export function rangeStart(rangeKey, today = new Date()) {
  const r = rangeMeta(rangeKey);
  if (r.from) return r.from(today);
  if (r.months === null || r.months === undefined) return null;
  const d = new Date(today.getTime());
  d.setMonth(d.getMonth() - r.months);
  return d;
}

const asDate = t => (t instanceof Date ? t : new Date(t));

/**
 * The slice of a {t, y} series a range selects, oldest first.
 *
 * Sorting here rather than trusting the caller is deliberate: percentile() reads
 * a sorted copy of the VALUES, but first/last in stats() read the ends of the
 * series in TIME order, and a series arriving newest-first would silently invert
 * the change-over-period figure without changing any percentile.
 */
export function windowSeries(series = [], rangeKey = DEFAULT_RANGE, { today = new Date() } = {}) {
  const rows = (series || [])
    .map(p => ({ t: asDate(p.t ?? p.date), y: num(p.y ?? p.yield) }))
    .filter(p => p.y !== null && !Number.isNaN(p.t.getTime()))
    .sort((a, b) => a.t - b.t);
  const cut = rangeStart(rangeKey, today);
  if (!cut) return rows;
  return rows.filter(p => p.t >= cut);
}

// ---------- the distribution ----------

// The seven cuts the card shows. Kept as data so the tiles, the spectrum ticks
// and the stats object cannot drift apart — they are all generated from this.
export const PCTS = [
  { p: 0, key: 'min', label: 'MIN', short: 'Min' },
  { p: 10, key: 'p10', label: '10TH', short: 'P10' },
  { p: 25, key: 'p25', label: '25TH', short: 'P25' },
  { p: 50, key: 'med', label: 'MEDIAN', short: 'Med' },
  { p: 75, key: 'p75', label: '75TH', short: 'P75' },
  { p: 90, key: 'p90', label: '90TH', short: 'P90' },
  { p: 100, key: 'max', label: 'MAX', short: 'Max' },
];

/**
 * Linear-interpolated percentile of an ascending array.
 *
 * Interpolating rather than picking the nearest observation matters at the ends:
 * with 1,254 daily points the 10th percentile falls between two of them, and
 * nearest-rank would quantise the P10 floor drawn on the chart onto whichever
 * single day happened to be there.
 */
export function percentile(sorted, p) {
  if (!sorted || !sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const idx = (Math.max(0, Math.min(100, p)) / 100) * (sorted.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

// Below this many observations the module refuses to publish a verdict. Sixty
// daily points is roughly a quarter — short, but enough that a single day cannot
// move a decile. It is a floor on honesty, not on usefulness: the stats still
// compute and still render, they are just labelled thin.
export const MIN_OBS = 60;

/**
 * Everything the distribution knows. Returns null only for an empty window,
 * because "no data" and "thin data" are different answers and the component
 * says different things about them.
 */
export function stats(series = []) {
  const rows = series || [];
  if (!rows.length) return null;
  const values = rows.map(r => num(r.y)).filter(v => v !== null).sort((a, b) => a - b);
  if (!values.length) return null;
  const out = { n: values.length, thin: values.length < MIN_OBS };
  for (const c of PCTS) out[c.key] = percentile(values, c.p);
  out.first = rows[0];
  out.last = rows[rows.length - 1];
  out.span = { from: rows[0].t, to: rows[rows.length - 1].t };
  return out;
}

/**
 * Where a value sits in the window, 0–100.
 *
 * Counting values strictly below and then adding half the ties is the standard
 * mid-rank definition, and it is the one that makes a flat series answer 50
 * rather than 0 or 100 — which is what a series of identical yields should say.
 */
export function rankOf(series = [], value) {
  const v = num(value);
  if (v === null) return null;
  const values = (series || []).map(r => num(r.y)).filter(x => x !== null);
  if (!values.length) return null;
  let below = 0, equal = 0;
  for (const x of values) { if (x < v) below++; else if (x === v) equal++; }
  return ((below + equal / 2) / values.length) * 100;
}

/** 49 -> "49th", 1 -> "1st". Ordinals, because "49 percentile" reads as a count. */
export function ordinal(n) {
  const r = Math.round(num(n) ?? 0);
  const t = r % 100;
  if (t >= 11 && t <= 13) return `${r}th`;
  return `${r}${['th', 'st', 'nd', 'rd'][r % 10] || 'th'}`;
}

// ---------- the verdict ----------

// Five bands plus two refusals. Every headline is a sentence about the YIELD.
// Note what is absent: no band says the shares are cheap, none says to buy, and
// the two extreme bands both carry a warning rather than an encouragement,
// because a yield at a five-year high is the situation that most often precedes
// a cut.
export const VERDICTS = [
  { key: 'very_expensive', max: 10, label: 'Very expensive', color: 'var(--red)',
    line: 'Yield is near its historical low — the price has rarely been this high relative to the payout.' },
  { key: 'expensive', max: 30, label: 'Expensive', color: 'var(--orange)',
    line: 'Yield sits in the bottom third of its own range.' },
  { key: 'fair', max: 70, label: 'Fair value', color: 'var(--yellow)',
    line: 'Yield is near the historical median — neither cheap nor expensive.' },
  { key: 'cheap', max: 90, label: 'Cheap', color: 'var(--green)',
    line: 'Yield sits in the top third of its own range. Worth asking which side of the ratio moved.' },
  { key: 'very_cheap', max: 101, label: 'Very cheap', color: 'var(--green)',
    line: 'Yield is near its historical high. That happens after a raise and it happens after a fall, and this number cannot tell you which.' },
];

export const TRAP = {
  key: 'trap', label: 'Yield trap risk', color: 'var(--red)',
  line: 'The yield is high by its own history and the dividend has been shrinking. A high yield on a falling payout is the one combination this screen will not call cheap.',
};

export const THIN = {
  key: 'thin', label: 'Not enough history', color: 'var(--ink-3)',
  line: 'Too few observations in this window to place today anywhere meaningful. Widen the range.',
};

export const NODATA = {
  key: 'none', label: 'No yield history', color: 'var(--ink-3)',
  line: 'Nothing saved for this window.',
};

/**
 * Decision 1 and decision 2, together, in one function.
 *
 * `growth1y` is not optional decoration: when it is negative and the percentile
 * is in the top third, the trap reading replaces the band. When growth is simply
 * unknown (null) the band stands — an unknown is not evidence of a cut, and
 * downgrading on missing data would mark every name without a dividend history
 * as a trap.
 */
export function verdictFor(rank, { n = 0, growth1y = null } = {}) {
  if (rank === null || rank === undefined || !n) return NODATA;
  if (n < MIN_OBS) return THIN;
  const g = num(growth1y);
  const band = VERDICTS.find(v => rank < v.max) || VERDICTS[VERDICTS.length - 1];
  const guard = g !== null && g < 0 && (band.key === 'cheap' || band.key === 'very_cheap');
  return guard ? TRAP : band;
}

// ---------- growth ----------

/**
 * Compound annual growth between two amounts over `years`.
 *
 * Returns null rather than a number when the starting amount is zero or
 * negative: the growth rate from nothing is not infinite, it is undefined, and
 * an infinite CAGR printed as "+∞%" next to three real ones is worse than a dash.
 */
export function cagr(from, to, years) {
  const a = num(from), b = num(to), y = num(years);
  if (a === null || b === null || y === null || a <= 0 || b <= 0 || y <= 0) return null;
  return (Math.pow(b / a, 1 / y) - 1) * 100;
}

export const GROWTH_WINDOWS = [1, 3, 5];

/**
 * Trailing dividend growth over each window, from a series of annual dividend
 * per share {t, d}. The comparison point is the observation nearest the target
 * date rather than an interpolation, because a dividend is a discrete event and
 * interpolating between two of them invents a payment that never happened.
 */
// divSeriesFromMeta returns {rows, source, note} because the SOURCE of a
// dividend history changes what it means — declared payments and a back-cast are
// not the same evidence. Every consumer below wants only the points, and one
// caller handed the whole envelope straight through: `(divSeries || []).map`
// then threw "map is not a function" and took the Yield tab down with it.
//
// `|| []` does not catch that. It only replaces null and undefined, and an
// object is neither — so the guard that looked like it covered a bad shape
// covered exactly the two shapes that were never the problem. Unwrapping here
// means the envelope is accepted anywhere the points are, and anything that is
// neither becomes an empty series instead of a crashed screen.
export function asPoints(series) {
  if (Array.isArray(series)) return series;
  if (series && Array.isArray(series.rows)) return series.rows;
  return [];
}

export function growthTable(divSeries = [], { today = new Date(), windows = GROWTH_WINDOWS } = {}) {
  const rows = asPoints(divSeries)
    .map(p => ({ t: asDate(p.t ?? p.date), d: num(p.d ?? p.dividend) }))
    .filter(p => p.d !== null && !Number.isNaN(p.t.getTime()))
    .sort((a, b) => a.t - b.t);
  if (rows.length < 2) return windows.map(w => ({ years: w, cagr: null }));
  const latest = rows[rows.length - 1];
  return windows.map(w => {
    const target = new Date(latest.t.getTime());
    target.setFullYear(target.getFullYear() - w);
    // Only look backwards. Picking the nearest point in either direction would
    // let a 5Y window borrow a 4-year-old observation on a short history and
    // report it as five years of growth.
    const prior = rows.filter(r => r.t <= target).pop();
    if (!prior) return { years: w, cagr: null };
    const actualYears = (latest.t - prior.t) / (365.25 * 24 * 3600 * 1000);
    return { years: w, cagr: cagr(prior.d, latest.d, actualYears), from: prior, to: latest };
  });
}

/** The 1Y number on its own, which is what verdictFor consumes. */
export function growth1y(divSeries = [], opts = {}) {
  const t = growthTable(divSeries, { ...opts, windows: [1] });
  return t[0]?.cagr ?? null;
}

// ---------- the spectrum ----------

/**
 * Where each labelled cut falls along the min→max bar, 0–1.
 *
 * The bar is drawn linearly in yield, not in percentile, which is why the ticks
 * bunch: with a right-skewed distribution P10 and P25 sit close together and the
 * max is far out on its own. That bunching is information — a spectrum spaced by
 * percentile would be a uniform ruler and would tell you nothing at all.
 */
export function spectrum(st) {
  if (!st) return null;
  const lo = st.min, hi = st.max;
  const span = hi - lo;
  const at = v => (span > 0 ? (v - lo) / span : 0.5);
  return {
    lo, hi, span,
    at,
    marks: PCTS.map(c => ({ ...c, value: st[c.key], x: at(st[c.key]) })),
  };
}

export const SPECTRUM_HINT = '◀ Expensive (low yield) — Cheap (high yield) ▶';

// ---------- building the series ----------

/**
 * Daily yield history out of a price history and a dividend history.
 *
 * This is where the fifth lie lives, and it is the subtlest one on the screen.
 * Almost nobody stores a yield series; what they store is prices. Dividing every
 * past price by TODAY'S dividend produces a curve that looks exactly like a real
 * yield history and is not one — it is a picture of the price, flipped, with the
 * company's entire dividend growth erased. On a name that has raised 9% a year
 * for five years, that curve puts the 2021 yield roughly 40% too high and makes
 * today look far more expensive than it is.
 *
 * So the dividend in force is looked up per point: the most recent declaration
 * at or before that date. When the dividend history has only one point there is
 * nothing to look up, and rather than quietly doing the wrong thing the result
 * comes back with `approx: true` and a sentence the component is obliged to
 * print.
 */
export function buildYieldSeries(prices = [], divSeries = [], { basis = 'fwd' } = {}) {
  const px = asPoints(prices)
    .map(p => ({ t: asDate(p.t ?? p.date), c: num(p.c ?? p.close ?? p.price) }))
    .filter(p => p.c !== null && p.c > 0 && !Number.isNaN(p.t.getTime()))
    .sort((a, b) => a.t - b.t);
  const dv = asPoints(divSeries)
    .map(p => ({ t: asDate(p.t ?? p.date), d: num(p.d ?? p.dividend) }))
    .filter(p => p.d !== null && p.d > 0 && !Number.isNaN(p.t.getTime()))
    .sort((a, b) => a.t - b.t);
  if (!px.length || !dv.length) return { rows: [], approx: false, basis, note: null };

  const approx = dv.length < 2;
  let i = 0, cur = dv[0].d;
  const rows = [];
  for (const p of px) {
    // The dividend series is walked forward alongside the prices rather than
    // searched per point: both are sorted, so this is one pass instead of
    // len(px) scans, and on a 10-year daily history that is 2,500 scans saved.
    while (i + 1 < dv.length && dv[i + 1].t <= p.t) { i++; cur = dv[i].d; }
    rows.push({ t: p.t, y: (cur / p.c) * 100, d: cur, c: p.c });
  }
  return {
    rows,
    approx,
    basis,
    note: approx
      ? 'Only one dividend figure is saved, so every past yield here is today\'s payout over that day\'s price. That is not what the yield was at the time — it removes the company\'s dividend growth from the history and biases old yields upward.'
      : null,
  };
}

/**
 * A dividend-per-share history out of a div_meta entry.
 *
 * Three sources, in descending order of how much they are worth, and the caller
 * is told which one it got because they are not interchangeable:
 *
 *   declared — actual declared payments, summed into a trailing annual figure at
 *              each declaration. This is history.
 *   modelled — the current rate walked backwards at the entry's stated growth
 *              rate. This is a smooth curve that no company ever paid; it is
 *              better than nothing only because the alternative (flat) is
 *              actively wrong in a known direction.
 *   flat     — one rate, no growth. Every past yield computed from it is wrong
 *              by the company's cumulative dividend growth.
 *
 * A screen that renders all three identically is telling the reader that a
 * back-cast and a payment record are the same kind of thing.
 */
export function divSeriesFromMeta(entry = {}, { today = new Date(), years = 10, perYear = 4 } = {}) {
  const declared = Array.isArray(entry.declared) ? entry.declared : [];
  const rate = num(entry.perShare);
  const per = num(entry.perYear) ?? perYear;

  const points = declared
    .map(d => ({ t: asDate(d.pay ?? d.date ?? d.ex), a: num(d.perShare ?? d.amount) }))
    .filter(p => p.a !== null && !Number.isNaN(p.t.getTime()))
    .sort((a, b) => a.t - b.t);

  if (points.length >= per) {
    // Trailing twelve months at each declaration, which is the figure a yield is
    // actually quoted against — not the single payment, which would produce a
    // yield four times too low on a quarterly payer.
    const rows = points.map(p => {
      const from = new Date(p.t.getTime());
      from.setFullYear(from.getFullYear() - 1);
      const ttm = points.filter(q => q.t > from && q.t <= p.t).reduce((s, q) => s + q.a, 0);
      return { t: p.t, d: ttm };
    }).filter(r => r.d > 0);
    if (rows.length >= 2) return { rows, source: 'declared', note: null };
  }

  if (rate === null || rate <= 0) return { rows: [], source: 'none', note: null };
  const annual = rate * per;
  const g = num(entry.growthPct) ?? 0;
  if (!g) {
    return {
      rows: [{ t: new Date(today.getFullYear() - years, today.getMonth(), today.getDate()), d: annual }],
      source: 'flat',
      note: 'No declared payment history and no growth rate saved, so the dividend is treated as unchanged for the whole window.',
    };
  }
  const rows = [];
  for (let k = years; k >= 0; k--) {
    const t = new Date(today.getFullYear() - k, today.getMonth(), today.getDate());
    rows.push({ t, d: annual / Math.pow(1 + g / 100, k) });
  }
  return {
    rows,
    source: 'modelled',
    note: `No declared payment history saved, so past dividends are the current ₹${annual.toFixed(2)} walked back at the ${g}% growth rate on file. That is a smooth curve no company actually paid.`,
  };
}

export const DISCLAIMER =
  'This is a description of one number\'s own history. A yield is a dividend divided by a price, so it moves when the company raises the payout and it moves when the shares fall, and a percentile cannot distinguish those. Nothing here is a view on whether the dividend will be maintained, and nothing here is a recommendation to buy or sell anything.';
