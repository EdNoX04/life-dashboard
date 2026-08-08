// The holdings table: one row per position, with every column a broker shows and
// a couple they do not.
//
// Three things in here are easy to get quietly wrong, so they are stated plainly
// and pinned by tests:
//
//   1. A missing cost basis is NOT a cost basis of zero. A holding whose average
//      price was never recorded has an unknown return, not a return of 0% — and
//      certainly not an infinite one. Those rows carry nulls and are excluded
//      from the totals rather than dragging them.
//
//   2. The totals row is computed from summed money, never from averaged
//      percentages. Averaging per-row returns weights a ₹500 position the same
//      as a ₹5,00,000 one and produces a number that is not the portfolio's
//      return by any definition.
//
//   3. Weight is a share of market value. Not of invested capital — that would
//      describe the portfolio you bought, not the one you own.

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const nn = v => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

export const COLUMNS = [
  { key: 'ticker', label: 'Holding', align: 'left' },
  { key: 'shares', label: 'Shares', align: 'right' },
  { key: 'drip', label: 'DRIP', align: 'center', sortable: false },
  { key: 'price', label: 'Price', align: 'right' },
  { key: 'dayPct', label: 'Day', align: 'right' },
  { key: 'cost', label: 'Cost/sh', align: 'right' },
  { key: 'invested', label: 'Invested', align: 'right' },
  { key: 'marketValue', label: 'Mkt value', align: 'right' },
  { key: 'weight', label: 'Wt %', align: 'right' },
  { key: 'dayGain', label: 'Day G/L', align: 'right' },
  { key: 'unrealised', label: 'Unrlzd G/L', align: 'right' },
  { key: 'totalReturnPct', label: 'Total rtn', align: 'right' },
];

// Build the rows.
//
// `incomeOf(h)` is optional and supplies dividends credited to the position so
// far — passing it turns the last column from a price return into a real total
// return. It is kept as an injected function rather than computed here because
// the honest version of that number depends on which payments are *declared*,
// which is the dividend module's business, not this one's.
export function holdingRows(held = [], {
  priceOf, costOf, quotes = {}, metaOf, incomeOf, fx = 1,
} = {}) {
  const px = priceOf || (h => num(h.last_price ?? h.price));
  const cx = costOf || (h => nn(h.avg_cost));

  const raw = held.map(h => {
    const ticker = h.ticker || h.symbol || '—';
    const shares = num(h.qty ?? h.shares);
    const price = num(px(h)) * fx;
    const cost = nn(cx(h));
    const costC = cost == null ? null : cost * fx;
    const q = quotes[ticker] || {};

    const marketValue = shares * price;
    const invested = costC == null ? null : shares * costC;
    const unrealised = invested == null ? null : marketValue - invested;

    // Day movement needs a previous close. Quotes that only carry a last price
    // give us nothing to compare against, and "0.00%" is a claim we cannot make.
    const prevClose = nn(q.prevClose);
    const dayPct = nn(q.changePct);
    const dayGain = prevClose != null ? shares * (price - prevClose * fx)
      : dayPct != null && marketValue ? marketValue - marketValue / (1 + dayPct / 100)
        : null;

    const income = incomeOf ? nn(incomeOf(h)) : null;
    const totalGain = unrealised == null ? null : unrealised + (income || 0);
    const totalReturnPct = invested && invested > 0 && totalGain != null
      ? (totalGain / invested) * 100 : null;

    const meta = metaOf ? metaOf(h) || {} : {};

    return {
      id: h.id ?? ticker,
      ticker, shares, price, cost: costC,
      invested, marketValue, unrealised,
      dayPct, dayGain,
      income,
      totalGain, totalReturnPct,
      unrealisedPct: invested && invested > 0 && unrealised != null ? (unrealised / invested) * 100 : null,
      drip: !!meta.drip,
      meta,
      raw: h,
      unknownCost: costC == null,
      estimatedIncome: !!(incomeOf && income != null && income > 0 && meta.incomeEstimated !== false),
    };
  });

  const totalValue = raw.reduce((a, r) => a + r.marketValue, 0);
  return raw.map(r => ({ ...r, weight: totalValue > 0 ? (r.marketValue / totalValue) * 100 : 0 }));
}

// The TOTAL row. Money is summed; percentages are then derived from those sums.
// Rows with an unknown cost basis contribute their market value (you do own
// them) but not their invested capital (we do not know it), and the fact that
// this happened is reported rather than swallowed.
export function totalsRow(rows = []) {
  const marketValue = rows.reduce((a, r) => a + num(r.marketValue), 0);
  const known = rows.filter(r => !r.unknownCost);
  const invested = known.reduce((a, r) => a + num(r.invested), 0);
  const unrealised = known.reduce((a, r) => a + num(r.unrealised), 0);
  const income = rows.reduce((a, r) => a + num(r.income), 0);
  const dayRows = rows.filter(r => r.dayGain != null);
  const dayGain = dayRows.length ? dayRows.reduce((a, r) => a + num(r.dayGain), 0) : null;
  const dayBase = dayRows.reduce((a, r) => a + num(r.marketValue) - num(r.dayGain), 0);
  return {
    marketValue, invested, unrealised, income,
    dayGain,
    dayPct: dayGain != null && dayBase > 0 ? (dayGain / dayBase) * 100 : null,
    unrealisedPct: invested > 0 ? (unrealised / invested) * 100 : null,
    totalReturnPct: invested > 0 ? ((unrealised + income) / invested) * 100 : null,
    weight: marketValue > 0 ? 100 : 0,
    shares: rows.reduce((a, r) => a + num(r.shares), 0),
    count: rows.length,
    missingCost: rows.filter(r => r.unknownCost).map(r => r.ticker),
  };
}

// Sort, with one rule that matters: unknowns sink to the bottom in BOTH
// directions. Ascending by return should surface your worst holding, not the
// three you never entered a cost for.
export function sortRows(rows = [], key = 'marketValue', dir = 'desc') {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = a[key], bv = b[key];
    const an = av == null || (typeof av === 'number' && !Number.isFinite(av));
    const bn = bv == null || (typeof bv === 'number' && !Number.isFinite(bv));
    if (an && bn) return 0;
    if (an) return 1;
    if (bn) return -1;
    if (typeof av === 'string' || typeof bv === 'string') {
      return sign * String(av).localeCompare(String(bv));
    }
    return sign * (av - bv);
  });
}

// The handful of holdings doing the work, and the handful dragging. Used for the
// "largest positions" / "top payers" strips in the overview.
export function topBy(rows = [], key = 'marketValue', limit = 5) {
  return sortRows(rows.filter(r => r[key] != null), key, 'desc').slice(0, limit);
}

// How much of the book sits in how few names.
//
// The measure that gets used here is "how many holdings does it take to reach
// half the portfolio", and it is chosen over a Herfindahl index on purpose:
// nobody has an intuition for 0.184, but everybody has one for "half your money
// is in two stocks". The top-3 and top-5 shares are reported beside it because
// they are the numbers people actually quote to each other.
//
// This function describes. It does not judge. There is no threshold in here at
// which a portfolio becomes "too concentrated" — that depends on things this
// code does not know, and stating a number is information while stating a
// verdict is advice.
export function concentration(rows = []) {
  const vals = rows.map(r => num(r.marketValue)).filter(v => v > 0).sort((a, b) => b - a);
  const total = vals.reduce((a, b) => a + b, 0);
  if (!(total > 0) || !vals.length) {
    return { total: 0, names: 0, top1: null, top3: null, top5: null, namesToHalf: null, largest: null };
  }
  const share = n => (vals.slice(0, n).reduce((a, b) => a + b, 0) / total) * 100;
  let run = 0, toHalf = 0;
  for (const v of vals) { run += v; toHalf += 1; if (run >= total / 2) break; }
  return {
    total,
    names: vals.length,
    top1: share(1),
    top3: vals.length >= 3 ? share(3) : share(vals.length),
    top5: vals.length >= 5 ? share(5) : share(vals.length),
    // A single holding is trivially "one name to half" — true, and worth
    // showing, because it is exactly what a one-stock portfolio looks like.
    namesToHalf: toHalf,
    largest: vals[0],
  };
}

// ------------------------------------------------------ diversification

// The two ways a book can be concentrated are not the same question, and the
// screen lets you switch between them:
//
//   BY VALUE  — where your capital sits, which is what a drawdown hits.
//   BY INCOME — where your cash flow comes from, which is what a dividend cut
//               hits. A 3% position paying 9% can be a tenth of your income.
//
// A book can look diversified on one axis and not the other, and that gap is
// the whole reason the toggle exists rather than a single default.
export const WEIGHT_BASES = [
  { key: 'value', label: 'VALUE', field: 'marketValue', note: 'where your capital sits' },
  { key: 'income', label: 'INCOME', field: 'income', note: 'where your cash flow comes from' },
];

export const weightBasis = key => WEIGHT_BASES.find(b => b.key === key) || WEIGHT_BASES[0];

// Herfindahl-Hirschman index over portfolio weights, and its reciprocal.
//
// HHI on its own is the number nobody has an intuition for - 0.184 means
// nothing to anybody. Its reciprocal does: 1/HHI is the number of EQUALLY sized
// holdings that would give you the same concentration. Ten equal positions score
// 10. Ten positions where one is half the book score about 3. That is a sentence
// a person can act on, so both are returned and the UI leads with the effective
// count.
export function hhiOf(rows = [], field = 'marketValue') {
  const vals = rows.map(r => num(r[field])).filter(v => v > 0);
  const total = vals.reduce((a, b) => a + b, 0);
  if (!(total > 0) || !vals.length) return { hhi: null, effective: null, names: 0, total: 0 };
  const hhi = vals.reduce((a, v) => a + Math.pow(v / total, 2), 0);
  return {
    hhi,
    effective: hhi > 0 ? 1 / hhi : null,
    names: vals.length,
    total,
  };
}

// Slices for the donut, largest first, with everything past `limit` folded into
// one OTHER wedge.
//
// Folding rather than truncating matters: a donut whose wedges do not sum to
// the whole book is a pie chart that lies about the denominator, and the small
// positions are exactly the ones a reader assumes are included.
export const OTHER_KEY = '__other__';

export function allocationSlices(rows = [], { basis = 'value', limit = 10 } = {}) {
  const b = weightBasis(basis);
  const vals = rows
    .map(r => ({ ticker: r.ticker, value: num(r[b.field]) }))
    .filter(r => r.value > 0)
    .sort((a, b2) => b2.value - a.value);
  const total = vals.reduce((a, r) => a + r.value, 0);
  if (!(total > 0)) return { slices: [], total: 0, basis: b, folded: 0 };

  const head = vals.slice(0, limit);
  const tail = vals.slice(limit);
  const slices = head.map(r => ({ ...r, pct: (r.value / total) * 100, other: false }));
  if (tail.length) {
    const v = tail.reduce((a, r) => a + r.value, 0);
    slices.push({ ticker: OTHER_KEY, label: `OTHER (${tail.length})`, value: v, pct: (v / total) * 100, other: true });
  }
  return { slices, total, basis: b, folded: tail.length };
}

// Cumulative arc offsets, so the component does not have to do trigonometry to
// know where a wedge starts. Angles are in degrees from 12 o'clock, clockwise.
export function arcs(slices = []) {
  let at = 0;
  return slices.map(s => {
    const sweep = (s.pct / 100) * 360;
    const a = { ...s, start: at, sweep, end: at + sweep };
    at += sweep;
    return a;
  });
}

// ------------------------------------------------------------- heat map

// The same twelve columns, read as an area instead of a list.
//
// A table is for looking a number up; a heat map is for seeing where the weight
// and the damage are without reading anything. They are not competing views of
// the same data so much as two different questions, which is why this is a
// toggle rather than a replacement.
//
// Two channels carry meaning and they are deliberately separate:
//
//   AREA is always the position's weight. It never changes with the metric,
//   because "how big is this bet" is the constant a reader needs in order to
//   interpret whatever colour is on top of it. A 0.2% position glowing red is
//   not the same news as a 30% position glowing red, and if area moved with the
//   metric you could not tell those apart at a glance.
//
//   COLOUR is the chosen metric, scaled against the largest ABSOLUTE value in
//   view rather than a fixed range. A fixed range means a quiet day renders as
//   a uniform grey rectangle and a violent one saturates everywhere; scaling to
//   the day you are actually looking at keeps the contrast informative.
export const HEAT_METRICS = [
  { key: 'dayPct', label: 'DAY', note: "today's move" },
  { key: 'totalReturnPct', label: 'TOTAL RTN', note: 'return since you bought' },
  { key: 'unrealised', label: 'UNRLZD', note: 'unrealised gain in currency' },
];

export const heatMetric = key => HEAT_METRICS.find(m => m.key === key) || HEAT_METRICS[0];

// Intensity is a fraction of the strongest reading on screen, floored so that a
// real but small move is still visible. A cell that is genuinely at zero gets
// the floor too - it has a value, it just is not moving - while a cell with NO
// value gets null and is rendered as absent rather than as neutral.
export const HEAT_FLOOR = 0.14;

export function heatCells(rows = [], metricKey = 'dayPct') {
  const m = heatMetric(metricKey);
  const totalWeightSource = rows.reduce((a, r) => a + (num(r.marketValue) || 0), 0);
  // `nn`, not `num`: num() defaults a missing value to 0, which would turn "we
  // have no return figure for this position" into "this position returned
  // nothing" — a claim, and a wrong one. This module's own header calls that
  // out as mistake #1 and it is just as easy to make here.
  const vals = rows.map(r => nn(r[m.key])).filter(v => v != null);
  const max = vals.reduce((a, v) => Math.max(a, Math.abs(v)), 0);

  const cells = rows.map(r => {
    const v = nn(r[m.key]);
    const mv = num(r.marketValue) || 0;
    return {
      ticker: r.ticker,
      value: v,
      // Weight recomputed here rather than trusting r.weight, because a filtered
      // table hands us a subset and the bars must sum to the subset shown, not
      // to a whole book that is off screen.
      weight: totalWeightSource > 0 ? (mv / totalWeightSource) * 100 : 0,
      marketValue: mv,
      tone: v == null ? 'none' : v > 0 ? 'up' : v < 0 ? 'down' : 'flat',
      intensity: v == null ? null
        : max > 0 ? Math.max(HEAT_FLOOR, Math.abs(v) / max) : HEAT_FLOOR,
    };
  });

  return {
    metric: m,
    max,
    cells: cells.sort((a, b) => b.weight - a.weight),
    // How many positions have nothing to say for this metric. Surfaced so the
    // screen can admit it rather than letting blanks read as zeros.
    missing: cells.filter(c => c.value == null).length,
  };
}

// Column help. Written as sentences rather than definitions, because the reader
// asking "what is Wt %" is not looking for a formula, they are looking for what
// the number is FOR.
export const COLUMN_HELP = {
  ticker: 'The position. Click a row to open the full research view for it.',
  shares: 'Units held, including fractional shares.',
  drip: 'Whether you have marked this position as reinvesting its dividends. It is a label you set here — it does not reinvest anything on its own.',
  price: 'Latest price seen. Refreshes with the quote feed, not on a fixed schedule.',
  dayPct: "Today's move in percent, from the previous close.",
  cost: 'Your average cost per share. Blank where it was never entered — the row is then left out of the return columns rather than being counted as free.',
  invested: 'What you paid in total: shares times average cost.',
  marketValue: 'What the position is worth now: shares times latest price.',
  weight: 'This position as a share of the whole book. The bar behind the number is the same figure — a column of percentages hides concentration that one long bar does not.',
  dayGain: "Today's move in currency rather than percent, so a big move on a tiny position does not read as loudly as a small move on a large one.",
  unrealised: 'Market value minus what you paid. Not realised until you sell, and not taxed until then either.',
  totalReturnPct: 'Price move plus dividends credited to this position so far this year. Marked ·d where dividends are included. It does not count payments that have not happened yet.',
};

export function toCSV(rows = [], total = null) {
  const head = ['Holding', 'Shares', 'DRIP', 'Price', 'Day %', 'Cost/sh', 'Invested',
    'Market value', 'Weight %', 'Day G/L', 'Unrealised G/L', 'Total return %'];
  const cell = v => (v == null ? '' : typeof v === 'number' ? String(Math.round(v * 100) / 100) : String(v));
  const line = r => [r.ticker, r.shares, r.drip ? 'Y' : 'N', r.price, r.dayPct, r.cost,
    r.invested, r.marketValue, r.weight, r.dayGain, r.unrealised, r.totalReturnPct].map(cell).join(',');
  const out = [head.join(','), ...rows.map(line)];
  if (total) {
    out.push(['TOTAL', '', '', '', cell(total.dayPct), '', cell(total.invested),
      cell(total.marketValue), cell(total.weight), cell(total.dayGain),
      cell(total.unrealised), cell(total.totalReturnPct)].join(','));
  }
  return out.join('\n');
}
