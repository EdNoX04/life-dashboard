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
