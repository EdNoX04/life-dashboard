// Date-range selection — the arithmetic behind the SELECT DATE RANGE brush and
// the 1D/5D/1M/… preset strips.
//
// Three of the screens in the dividend batch share one control: a full-history
// sparkline with a draggable, resizable window over it, two date inputs bound
// both ways, and a row of presets. Building that control three times would
// guarantee three subtly different behaviours at the edges, and the edges are
// where a range picker is actually judged — what happens when you drag the
// window past the end of the data, when the preset is longer than the history
// you have, when the two date inputs cross over.
//
// So the edges are decided once, here, and pinned by tests.
//
// Decisions:
//
// 1. A RANGE IS A PAIR OF INDICES, NOT A PAIR OF DATES. The series is the
//    authority on what dates exist; asking for "2026-03-14" when the market was
//    shut that day has to resolve to a real point rather than to nothing. Dates
//    are the interface, indices are the representation.
//
// 2. CLAMP, NEVER REJECT. Dragging the window past the end of the history is a
//    normal gesture, not an error. It stops at the end and keeps its width where
//    it can. A control that snaps back to a "valid" position on every overshoot
//    feels broken.
//
// 3. A PRESET LONGER THAN THE DATA IS THE WHOLE DATA, and says so. Asking for
//    5Y of a stock you have held eight months should show eight months labelled
//    honestly, not an empty chart or a silently relabelled one.

export const PRESETS = [
  { key: '1d', label: '1D', days: 1 },
  { key: '5d', label: '5D', days: 5 },
  { key: '1m', label: '1M', days: 30 },
  { key: '6m', label: '6M', days: 182 },
  { key: 'ytd', label: 'YTD', days: null },   // computed from the last point
  { key: '1y', label: '1Y', days: 365 },
  { key: '5y', label: '5Y', days: 1825 },
  { key: '10y', label: '10Y', days: 3650 },
  { key: 'all', label: 'ALL', days: Infinity },
];

// The fundamental screens use a shorter strip — annual data has no 1D.
export const FUNDAMENTAL_PRESETS = PRESETS.filter(p => ['1y', '5y', '10y', 'all'].includes(p.key))
  .concat([{ key: '3y', label: '3Y', days: 1095 }])
  .sort((a, b) => (a.days ?? 0) - (b.days ?? 0));

export const presetOf = key => PRESETS.find(p => p.key === key)
  || FUNDAMENTAL_PRESETS.find(p => p.key === key) || null;

const DAY = 864e5;

export const toDate = v => {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === 'number') return new Date(v);
  const s = String(v ?? '').trim();
  if (!s) return null;
  const t = Date.parse(s.length === 10 ? `${s}T00:00:00Z` : s);
  return Number.isFinite(t) ? new Date(t) : null;
};

export const toISO = v => {
  const d = toDate(v);
  return d ? d.toISOString().slice(0, 10) : null;
};

// Decision 1. Nearest point wins, and ties go to the earlier one so that
// dragging a boundary left and right is symmetric rather than sticky.
export function indexForDate(series = [], date) {
  if (!series.length) return null;
  const t = toDate(date)?.getTime();
  if (t == null) return null;
  let best = 0, bestGap = Infinity;
  for (let i = 0; i < series.length; i++) {
    const pt = toDate(series[i]?.date ?? series[i]?.t ?? series[i])?.getTime();
    if (pt == null) continue;
    const gap = Math.abs(pt - t);
    if (gap < bestGap) { bestGap = gap; best = i; }
  }
  return bestGap === Infinity ? null : best;
}

export const dateAt = (series = [], i) => toISO(series[i]?.date ?? series[i]?.t ?? series[i]);

export function clampRange(series = [], from, to) {
  const n = series.length;
  if (!n) return null;
  let a = Math.round(Number(from));
  let b = Math.round(Number(to));
  if (!Number.isFinite(a)) a = 0;
  if (!Number.isFinite(b)) b = n - 1;
  // A backwards drag is a legitimate gesture: you grabbed the right handle and
  // pulled it past the left one. Swap rather than refuse.
  if (a > b) { const t = a; a = b; b = t; }
  a = Math.min(Math.max(a, 0), n - 1);
  b = Math.min(Math.max(b, 0), n - 1);
  return { from: a, to: b, count: b - a + 1 };
}

// Decision 2. Moving the whole window keeps its width until it physically
// cannot, then it stops at the boundary rather than shrinking.
export function moveRange(series = [], range, delta) {
  const n = series.length;
  if (!n || !range) return null;
  const width = range.to - range.from;
  let a = range.from + Math.round(delta);
  if (a < 0) a = 0;
  if (a + width > n - 1) a = n - 1 - width;
  if (a < 0) a = 0;
  return clampRange(series, a, Math.min(a + width, n - 1));
}

// Decision 3. Returns the range AND whether the preset was satisfiable, so the
// caption can say "8 months — all the history there is" rather than "5Y".
export function rangeForPreset(series = [], key) {
  const n = series.length;
  if (!n) return null;
  const p = presetOf(key);
  if (!p) return null;
  const lastIdx = n - 1;
  const last = toDate(dateAt(series, lastIdx));
  if (!last) return null;

  if (p.days === Infinity) {
    return { ...clampRange(series, 0, lastIdx), preset: p.key, truncated: false };
  }

  let cutoff;
  if (p.key === 'ytd') {
    cutoff = new Date(Date.UTC(last.getUTCFullYear(), 0, 1));
  } else {
    cutoff = new Date(last.getTime() - p.days * DAY);
  }

  const firstDate = toDate(dateAt(series, 0));
  // The window wanted more history than exists.
  const truncated = !!firstDate && firstDate.getTime() > cutoff.getTime();
  const fromIdx = truncated ? 0 : indexForDate(series, cutoff);
  return { ...clampRange(series, fromIdx ?? 0, lastIdx), preset: p.key, truncated };
}

// Which preset, if any, the current range corresponds to — so the strip can
// light the right button after a drag lands exactly on one.
export function presetForRange(series = [], range, list = PRESETS) {
  if (!series.length || !range) return null;
  for (const p of list) {
    const r = rangeForPreset(series, p.key);
    if (r && r.from === range.from && r.to === range.to) return p.key;
  }
  return null;
}

export function sliceRange(series = [], range) {
  if (!range) return series.slice();
  return series.slice(range.from, range.to + 1);
}

// Pixel space <-> index space. Kept here rather than in the component because
// off-by-one in a brush is the single most common way one of these controls
// ends up unable to select the last point.
export function xToIndex(x, width, n) {
  if (!(width > 0) || !(n > 0)) return 0;
  // No single-point guard needed here, unlike indexToX below: this MULTIPLIES
  // by (n - 1), so a one-point series yields 0 on its own. indexToX DIVIDES by
  // it and would produce NaN, which is why the guard lives there and not here.
  const r = (x / width) * (n - 1);
  return Math.min(Math.max(Math.round(r), 0), n - 1);
}

export function indexToX(i, width, n) {
  if (!(width > 0) || !(n > 0)) return 0;
  if (n === 1) return 0;
  return (Math.min(Math.max(i, 0), n - 1) / (n - 1)) * width;
}

// The caption under the brush. Says the span in human units and flags a
// truncated preset, because "5Y" over eight months of data is a lie of omission.
export function rangeCaption(series = [], range) {
  if (!series.length || !range) return null;
  const a = dateAt(series, range.from), b = dateAt(series, range.to);
  const da = toDate(a), db = toDate(b);
  if (!da || !db) return null;
  const days = Math.round((db - da) / DAY);
  let span;
  if (days < 1) span = 'single day';
  else if (days < 45) span = `${days} day${days === 1 ? '' : 's'}`;
  // The boundary is a year exactly, not "about a year". 365 days reading as
  // "12 months" is technically true and reads as evasive - you asked for a year
  // and the caption should agree that you got one.
  else if (days < 365) span = `${Math.round(days / 30.44)} months`;
  else span = `${(days / 365.25).toFixed(1)} years`;
  return { from: a, to: b, days, span, points: range.count,
    text: `${a} → ${b} · ${span} · ${range.count} point${range.count === 1 ? '' : 's'}` };
}
