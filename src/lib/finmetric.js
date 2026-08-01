// Financial metric chart — the arithmetic half.
//
// The reference screen is a headline figure (CapEx, say) with a year-on-year
// change and a five-year CAGR beside it, a Quarterly / TTM / Annual toggle, a
// Total / Per-Share toggle, a row of signed bars that can point downward, and a
// GROWTH · CAGR tile row across 1Y, 3Y, 5Y and 10Y.
//
// Rebuilt against the data that actually exists here, six of those parts turn
// out to be traps. Five are traps of the same family — a control that looks
// harmless produces a number that is not merely imprecise but meaningless — and
// the sixth is what happens when a menu offers something the feed never sells.
//
// 1. THE METRIC MENU IS WHATEVER CAME BACK, NEVER A FIXED LIST. Finnhub's free
//    tier returns a `series` blob whose contents vary by company and by whatever
//    the endpoint felt like including. A hard-coded menu with CapEx on it would
//    render a button that is permanently dead for every ticker Neel owns, and a
//    dead button is a standing claim that one more click would produce the
//    chart. So the menu is BUILT from the keys that came back with at least two
//    periods in them, and a company with a thin blob gets a short menu and a
//    sentence saying so.
//
// 2. THERE ARE NO TOTALS HERE, SO THE TOTAL TOGGLE IS A REFUSAL. Every figure in
//    this blob is per-share or a ratio. Turning a per-share figure into a total
//    means multiplying by the share count on that date, and the only share count
//    on offer is today's — the identical problem to the market-cap history on the
//    ticker screen, and identical in consequence: the "total" line would be the
//    per-share line times a constant, the same shape, no new information, and one
//    large invitation to read a 2016 bar as 2016 dollars. The latest period is
//    the one date where today's count is roughly right, so that single figure is
//    offered and the historical bars are refused in a printed sentence.
//
// 3. TTM IS A SUM ONLY FOR FLOWS. A trailing twelve months of earnings per share
//    is four quarters added up. A trailing twelve months of book value per share
//    is NOT — book value is a level measured at an instant, and adding four of
//    them produces roughly four times the company. A trailing twelve months of
//    net margin is worse still: margins are ratios, and the TTM margin is TTM
//    profit over TTM revenue, which needs two underlying totals this feed does
//    not sell. So every metric carries a kind — flow, stock or ratio — TTM sums
//    flows, takes the latest reading for stocks, and refuses outright for ratios.
//
// 4. AN UNKNOWN METRIC IS TREATED AS THE KIND THAT PERMITS THE LEAST. New keys
//    appear in this blob without warning. Guessing "flow" for one would quietly
//    enable a four-quarter summation of something that must never be summed, and
//    the result looks like a number rather than like a bug. Guessing "ratio"
//    costs a disabled TTM button on a metric that might have supported one. The
//    asymmetry is the whole argument.
//
// 5. A CAGR WHOSE BASE IS ZERO OR NEGATIVE IS NOT A LARGE NUMBER, IT IS NO
//    NUMBER. Growth from −5 to +10 is not −300%, and growth from 0 to anything is
//    not infinity: compound growth is defined on ratios, and neither of those
//    ratios means anything. This is the single most common way a financial
//    dashboard prints something confidently false, because the arithmetic
//    completes without complaint. Every CAGR here returns a named state instead.
//
// 6. THE BAR CHART INCLUDES ZERO AND THE LINE CHART DOES NOT, AND THAT IS NOT AN
//    INCONSISTENCY. Bar length encodes magnitude, so a bar chart cropped to
//    [98, 102] draws a 4% move as a full-height bar and is simply wrong. A line
//    chart encodes shape, and forcing it to zero flattens every real move into a
//    horizontal smear. The ticker screen's line therefore does not start at zero
//    and prints its range; this file's bars always contain zero and draw the
//    baseline.

// Fourth copy of this guard, and it stays a copy for the fourth time. `+null`,
// `+''` and `+false` are all 0, so any Number.isFinite(+v) turns a period nobody
// reported into a period the company earned nothing. Missing and zero are the
// two values this file must never confuse — and a zero here does not merely
// misprint, it becomes the base of a CAGR.
export function num(v) {
  if (v === null || v === undefined || typeof v === 'boolean') return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  const n = +v;
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------- kinds

export const KINDS = {
  flow: {
    key: 'flow',
    label: 'flow',
    note: 'Measured over a period. Four quarters of it add up to a year.',
  },
  stock: {
    key: 'stock',
    label: 'level',
    note: 'Measured at an instant. Four quarters of it do not add up to anything — the trailing figure is simply the latest one.',
  },
  ratio: {
    key: 'ratio',
    label: 'ratio',
    note: 'A quotient of two figures. A trailing-twelve-month version needs both underlying totals, which this feed does not sell, so there is no TTM for it.',
  },
};

// The keys this feed is known to return, with the kind each one actually is.
// Anything not on this list falls through to the inference below and lands on
// `ratio` — decision 4.
const CATALOGUE = {
  eps: { label: 'Earnings per share', kind: 'flow', unit: '/sh' },
  salesPerShare: { label: 'Revenue per share', kind: 'flow', unit: '/sh' },
  ebitPerShare: { label: 'EBIT per share', kind: 'flow', unit: '/sh' },
  cashFlowPerShare: { label: 'Cash flow per share', kind: 'flow', unit: '/sh' },
  fcfPerShare: { label: 'Free cash flow per share', kind: 'flow', unit: '/sh' },
  dividendPerShare: { label: 'Dividend per share', kind: 'flow', unit: '/sh' },
  bookValue: { label: 'Book value per share', kind: 'stock', unit: '/sh' },
  tangibleBookValue: { label: 'Tangible book value per share', kind: 'stock', unit: '/sh' },
  totalDebtToEquity: { label: 'Debt to equity', kind: 'ratio', unit: '×' },
  totalDebtToTotalAsset: { label: 'Debt to assets', kind: 'ratio', unit: '×' },
  longtermDebtTotalAsset: { label: 'Long-term debt to assets', kind: 'ratio', unit: '×' },
  netDebtToTotalCapital: { label: 'Net debt to capital', kind: 'ratio', unit: '×' },
  currentRatio: { label: 'Current ratio', kind: 'ratio', unit: '×' },
  quickRatio: { label: 'Quick ratio', kind: 'ratio', unit: '×' },
  cashRatio: { label: 'Cash ratio', kind: 'ratio', unit: '×' },
  grossMargin: { label: 'Gross margin', kind: 'ratio', unit: '%' },
  operatingMargin: { label: 'Operating margin', kind: 'ratio', unit: '%' },
  netMargin: { label: 'Net margin', kind: 'ratio', unit: '%' },
  pretaxMargin: { label: 'Pre-tax margin', kind: 'ratio', unit: '%' },
  roe: { label: 'Return on equity', kind: 'ratio', unit: '%' },
  roa: { label: 'Return on assets', kind: 'ratio', unit: '%' },
  roic: { label: 'Return on invested capital', kind: 'ratio', unit: '%' },
  assetTurnover: { label: 'Asset turnover', kind: 'ratio', unit: '×' },
  inventoryTurnover: { label: 'Inventory turnover', kind: 'ratio', unit: '×' },
  receivablesTurnover: { label: 'Receivables turnover', kind: 'ratio', unit: '×' },
  payoutRatio: { label: 'Payout ratio', kind: 'ratio', unit: '%' },
  sgaToSale: { label: 'SG&A to sales', kind: 'ratio', unit: '%' },
};

// camelCase to a sentence, for keys the catalogue has never seen. This produces
// a readable label without pretending to know what the figure means — which is
// exactly why the kind is not inferred from the same string with any confidence.
export function humanise(key) {
  const s = String(key || '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim();
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

export function metricInfo(key) {
  const k = String(key || '');
  const c = CATALOGUE[k];
  if (c) return { key: k, label: c.label, kind: c.kind, unit: c.unit, known: true };
  // Decision 4: the default is the restrictive kind, not the plausible one.
  return {
    key: k,
    label: humanise(k) || k,
    kind: 'ratio',
    unit: '',
    known: false,
  };
}

export const kindInfo = k => KINDS[k] || KINDS.ratio;

// ---------------------------------------------------------------- reading

export const FREQS = [
  { key: 'annual', label: 'Annual', src: 'annual', note: 'One bar per financial year, as the company filed it.' },
  { key: 'quarterly', label: 'Quarterly', src: 'quarterly', note: 'One bar per quarter. Seasonal businesses swing here in ways the annual view hides entirely.' },
  { key: 'ttm', label: 'TTM', src: 'quarterly', note: 'Trailing twelve months — four quarters summed for flows, the latest reading for levels, and refused for ratios.' },
];
export const freqMeta = k => FREQS.find(f => f.key === k) || FREQS[0];

export const periodOf = p => String(p || '').slice(0, 10);

// Finnhub returns these newest-first. Nothing downstream should have to know
// that, and a chart drawn in the wrong direction is a mistake that looks like a
// business in decline, so the sort happens once, here, on the way in.
export function readSeries(series, freqKey, metricKey) {
  const src = freqMeta(freqKey).src;
  const arr = series && series[src] && series[src][metricKey];
  if (!Array.isArray(arr)) return [];
  return arr
    .map(p => ({ period: periodOf(p?.period), v: num(p?.v) }))
    .filter(p => p.period.length >= 7 && p.v !== null)
    .sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0));
}

// Decision 1: the menu is what came back. A key with one period is excluded
// because one point is a reading and not a series — there is nothing to chart,
// no year-on-year and no CAGR, so offering it would be offering an empty screen.
export function availableMetrics(series, freqKey) {
  const src = freqMeta(freqKey).src;
  const bag = (series && series[src]) || {};
  const out = [];
  for (const k of Object.keys(bag)) {
    const pts = readSeries(series, freqKey, k);
    if (pts.length >= 2) out.push({ ...metricInfo(k), n: pts.length });
  }
  // Known metrics first, then alphabetically. The ordering is stable so the menu
  // does not reshuffle under Neel's finger when a refresh adds one key.
  return out.sort((a, b) => (a.known === b.known
    ? a.label.localeCompare(b.label)
    : (a.known ? -1 : 1)));
}

// ---------------------------------------------------------------- TTM

// Decision 3. Returns a named state rather than a possibly-empty list, because
// "there is no TTM for this metric" and "there is not enough history yet" are
// different facts and the screen should say which one it is.
export function ttmSeries(points, kind) {
  const pts = (points || []).filter(p => num(p?.v) !== null);
  if (kind === 'ratio') return { state: 'refused', rows: [], kind };
  if (kind === 'stock') {
    // A level's trailing figure is the level. This is not a simplification: the
    // twelve-month view of a balance-sheet item IS its latest balance.
    return { state: 'latest', rows: pts.map(p => ({ period: p.period, v: p.v, n: 1 })), kind };
  }
  if (pts.length < 4) return { state: 'too_short', rows: [], kind, have: pts.length, need: 4 };
  const rows = [];
  for (let i = 3; i < pts.length; i++) {
    // Every TTM bar is a full four quarters or it does not exist. A partial sum
    // at the start of the list would draw three real quarters as a year and put
    // a 25% drop at the left edge of every chart.
    const w = pts.slice(i - 3, i + 1);
    rows.push({ period: w[3].period, v: w.reduce((a, p) => a + p.v, 0), n: 4, from: w[0].period });
  }
  return { state: 'ok', rows, kind };
}

// The one call the screen makes: give me the rows for this frequency.
export function rowsFor(series, freqKey, metricKey) {
  const info = metricInfo(metricKey);
  const raw = readSeries(series, freqKey, metricKey);
  if (freqKey !== 'ttm') return { state: raw.length >= 1 ? 'ok' : 'empty', rows: raw, info };
  const t = ttmSeries(raw, info.kind);
  return { ...t, state: t.state === 'latest' ? 'ok' : t.state, rows: t.rows, info, ttmKind: t.state };
}

// ---------------------------------------------------------------- growth

// Year-on-year, where "a year" is however many periods make one at this
// frequency. It is returned with both endpoints attached for the same reason
// changeOver does it on the ticker screen: a percentage without its baseline is
// a number nobody can check.
export function periodsPerYear(freqKey) {
  return freqKey === 'annual' ? 1 : 4;
}

export function yoy(rows, freqKey) {
  const rs = rows || [];
  const step = periodsPerYear(freqKey);
  if (rs.length < step + 1) return null;
  const to = rs[rs.length - 1];
  const from = rs[rs.length - 1 - step];
  if (from.v === 0) return { state: 'base_zero', from, to };
  const pct = ((to.v - from.v) / Math.abs(from.v)) * 100;
  // Dividing by the ABSOLUTE base is deliberate: a metric going from −10 to −5
  // has improved, and dividing by −10 would print that improvement as −50%.
  // Sign changes are still refused below; this only fixes the same-sign case.
  return { state: 'ok', pct, from, to, crossed: (from.v < 0) !== (to.v < 0) };
}

// Decision 5. Every failure mode gets its own name so the screen can print the
// reason instead of a dash that could mean anything.
export function cagr(rows, years, freqKey) {
  const rs = rows || [];
  const step = periodsPerYear(freqKey) * years;
  if (rs.length < step + 1) return { state: 'too_short', years, have: rs.length, need: step + 1 };
  const to = rs[rs.length - 1];
  const from = rs[rs.length - 1 - step];
  if (from.v <= 0) return { state: 'base_nonpositive', years, from, to };
  if (to.v <= 0) return { state: 'ended_nonpositive', years, from, to };
  const pct = (Math.pow(to.v / from.v, 1 / years) - 1) * 100;
  return { state: 'ok', pct, years, from, to };
}

export const CAGR_YEARS = [1, 3, 5, 10];

export function growthRow(rows, freqKey) {
  return CAGR_YEARS.map(y => ({ years: y, ...cagr(rows, y, freqKey) }));
}

export const CAGR_REASONS = {
  too_short: 'not enough history',
  base_nonpositive: 'the starting figure is zero or negative, so a compound rate has no meaning',
  ended_nonpositive: 'the ending figure is zero or negative, so a compound rate has no meaning',
};

// ---------------------------------------------------------------- totals

export const TOTAL_REFUSAL =
  'Every figure in this feed is per-share. Turning one into a company total means multiplying by the share count '
  + 'on that date, and the only share count available is today\'s — so a chart of "totals" would be this chart '
  + 'multiplied by a constant, identical in shape, with older bars quietly stated in the wrong number of shares. '
  + 'The latest period is the one date today\'s count roughly fits, so that single figure is below and the bars stay per-share.';

// The one total this file will compute, and only for the newest period.
export function latestTotal(rows, shareOutstandingM) {
  const rs = rows || [];
  const shares = num(shareOutstandingM);
  if (!rs.length || shares === null || shares <= 0) return null;
  const last = rs[rs.length - 1];
  return { period: last.period, perShare: last.v, shares, totalM: last.v * shares };
}

// ---------------------------------------------------------------- geometry

// Decision 6: the domain always contains zero, and the baseline is returned so
// the screen can draw it. A bar chart without a visible zero is a chart whose
// bars mean nothing.
export function barGeometry(rows, w = 640, h = 200, pad = 10) {
  const rs = (rows || []).filter(r => num(r?.v) !== null);
  if (!rs.length) return null;
  const vals = rs.map(r => r.v);
  let lo = Math.min(0, ...vals);
  let hi = Math.max(0, ...vals);
  if (hi - lo < 1e-12) { hi = 1; lo = 0; }
  const inner = h - pad * 2;
  const y = v => pad + (1 - (v - lo) / (hi - lo)) * inner;
  const zero = y(0);
  // Gaps are a fixed fraction of the slot rather than a fixed pixel count, so a
  // forty-bar quarterly chart does not turn into forty gaps and no bars.
  const slot = (w - pad * 2) / rs.length;
  const bw = Math.max(1, slot * 0.72);
  const bars = rs.map((r, i) => {
    const x = pad + slot * i + (slot - bw) / 2;
    const top = Math.min(y(r.v), zero);
    const bot = Math.max(y(r.v), zero);
    return {
      period: r.period, v: r.v, neg: r.v < 0,
      x, w: bw, y: top,
      // A bar of exactly zero height is invisible, which reads as missing rather
      // than as zero. One pixel is the difference between "nothing was reported"
      // and "it was nothing".
      h: Math.max(1, bot - top),
      cx: x + bw / 2,
    };
  });
  return { w, h, lo, hi, zero, bars, n: rs.length, anyNeg: bars.some(b => b.neg) };
}

// ---------------------------------------------------------------- formatting

export function fmtVal(v, unit = '', cur = '$') {
  const n = num(v);
  if (n === null) return '—';
  if (unit === '%') return `${n.toFixed(2)}%`;
  if (unit === '×') return `${n.toFixed(2)}×`;
  if (unit === '/sh') return `${cur}${n.toFixed(2)}`;
  return n.toFixed(2);
}

// Compact currency for a figure in MILLIONS — the unit share counts arrive in,
// so the product of a per-share figure and a share count in millions is also in
// millions. Getting this wrong is wrong by a factor of a thousand exactly once.
export function fmtTotalM(m, cur = '$') {
  const n = num(m);
  if (n === null) return '—';
  const a = Math.abs(n);
  const s = n < 0 ? '−' : '';
  if (a >= 1e6) return `${s}${cur}${(a / 1e6).toFixed(2)}T`;
  if (a >= 1e3) return `${s}${cur}${(a / 1e3).toFixed(2)}B`;
  return `${s}${cur}${a.toFixed(0)}M`;
}

export const FIN_DISCLAIMER =
  'These figures come from the data provider\'s summary of the filings, not from the filings themselves, and the '
  + 'free tier returns whatever subset it returns — a metric missing here is missing from the feed, not from the '
  + 'company. Growth rates are arithmetic on those figures. Nothing here is investment advice.';
