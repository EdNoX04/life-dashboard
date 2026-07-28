// Stock research arithmetic: what a company earned against what it was expected
// to earn, what you actually made holding it, and how it prices up against the
// handful of companies it competes with.
//
// Five decisions here are load-bearing, and every one of them is a place where a
// stock screen flatters the company by accident:
//
//   1. CAGR is a measurement, not an extrapolation. Annualising four months of
//      return into "+312% a year" is a sentence about arithmetic, not about the
//      company. Under a year, this returns null and the caller shows the plain
//      period return instead.
//
//   2. Total return splits into price and dividends, and the two must sum to the
//      whole. The dividend share is the RESIDUAL of the reinvested path — the
//      compounding of reinvested payments on top of later price moves — not the
//      naive sum of the cash received, which understates it badly over decades.
//
//   3. A quarter with no estimate on file is NOT a beat. It is excluded from the
//      surprise record entirely. Counting it as a 0% surprise is how a company
//      with patchy coverage acquires a spotless history.
//
//   4. A forward P/E on a negative earnings estimate is not a low valuation, it
//      is a meaningless number. Null.
//
//   5. Peers are only comparable on a metric they all have. Ranking five
//      companies on a P/E that two of them lack silently promotes the two.

// Number(null) is 0 and Number('') is 0, which is exactly the confusion this
// whole file exists to avoid: a feed that returns null for return-on-equity is
// saying "we do not have it", not "it is zero".
const num = v => (v == null || v === '' || typeof v === 'boolean' || !Number.isFinite(Number(v))
  ? null : Number(v));
const pos = v => { const n = num(v); return n != null && n > 0 ? n : null; };

// ---- returns -------------------------------------------------------------

// Compound annual growth rate. Requires a real span and a positive start —
// there is no growth rate from zero, and no annual rate from four months.
export function cagr(start, end, years) {
  const s = pos(start), e = num(end), y = num(years);
  if (s == null || e == null || y == null || y < 1 || e <= 0) return null;
  return (Math.pow(e / s, 1 / y) - 1) * 100;
}

export function yearsBetween(from, to = new Date()) {
  const a = from instanceof Date ? from : new Date(String(from) + (String(from).length === 10 ? 'T00:00:00' : ''));
  const b = to instanceof Date ? to : new Date(to);
  if (!(a instanceof Date) || Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return (b - a) / (365.2425 * 24 * 3600e3);
}

// The decomposition behind "+13,919% total, of which +123.94% came from
// dividends reinvested". `divYield` is the average annual yield over the period.
//
// Price-only compounds at the price CAGR. The reinvested path compounds at price
// growth PLUS the yield, because each payment buys shares that then participate
// in every subsequent price move. The difference between the two paths is what
// the dividends were actually worth — a number the cash total never reaches.
export function totalReturnBreakdown({ start, end, years, divYield = 0 } = {}) {
  const s = pos(start), e = num(end), y = num(years);
  if (s == null || e == null || y == null || y <= 0 || e <= 0) return null;
  const priceMult = e / s;
  const priceRet = (priceMult - 1) * 100;
  const g = Math.pow(priceMult, 1 / y) - 1;            // annual price growth
  const yld = Math.max(0, num(divYield) ?? 0) / 100;
  const totalMult = Math.pow(1 + g + yld, y);
  const totalRet = (totalMult - 1) * 100;
  return {
    priceReturn: priceRet,
    totalReturn: totalRet,
    // What reinvesting added, in the same units as the headline, so the two
    // numbers can be read side by side without mental arithmetic.
    fromDividends: totalRet - priceRet,
    priceCagr: y >= 1 ? g * 100 : null,
    totalCagr: y >= 1 ? (Math.pow(totalMult, 1 / y) - 1) * 100 : null,
    years: y,
    reliable: y >= 1,
  };
}

// ---- earnings: actual versus estimate ------------------------------------

// Finnhub's /stock/earnings gives {period, actual, estimate, surprisePercent}.
// Normalised into the shape the chart wants, oldest first.
export function normaliseEarnings(rows = []) {
  return rows
    .map(r => {
      const actual = num(r.actual), estimate = num(r.estimate);
      return {
        period: String(r.period || r.date || ''),
        label: labelFor(r),
        actual, estimate,
        // Recomputed rather than trusted: the surprise percent a feed reports is
        // occasionally rounded to something that disagrees with its own numbers.
        surprisePct: actual != null && estimate != null && estimate !== 0
          ? ((actual - estimate) / Math.abs(estimate)) * 100 : null,
        estimated: actual == null && estimate != null,
      };
    })
    .filter(r => r.period && (r.actual != null || r.estimate != null))
    .sort((a, b) => (a.period < b.period ? -1 : 1));
}

function labelFor(r) {
  if (r.year != null && r.quarter != null) return `Q${r.quarter} '${String(r.year).slice(2)}`;
  const p = String(r.period || '');
  if (/^\d{4}-\d{2}/.test(p)) {
    const q = Math.floor((Number(p.slice(5, 7)) - 1) / 3) + 1;
    return `Q${q} '${p.slice(2, 4)}`;
  }
  return p;
}

// The record. Only quarters where BOTH figures exist can be judged, and the
// count of judged quarters is reported so the reader knows how thin it is.
export function surpriseRecord(rows = []) {
  const judged = rows.filter(r => r.actual != null && r.estimate != null);
  if (!judged.length) return { quarters: 0, beats: 0, misses: 0, inline: 0, beatRate: null, avgSurprise: null };
  let beats = 0, misses = 0, inline = 0, sum = 0;
  for (const r of judged) {
    const d = r.actual - r.estimate;
    if (d > 1e-9) beats += 1; else if (d < -1e-9) misses += 1; else inline += 1;
    sum += r.surprisePct ?? 0;
  }
  return {
    quarters: judged.length, beats, misses, inline,
    beatRate: (beats / judged.length) * 100,
    avgSurprise: sum / judged.length,
  };
}

// Fiscal-year view: EPS by year with year-on-year growth and a forward P/E
// against the current price. Estimates are flagged so the table can dash them.
export function fiscalYears(rows = [], { price = null, from = null } = {}) {
  const byYear = new Map();
  for (const r of rows) {
    const y = Number(String(r.period).slice(0, 4));
    if (!Number.isFinite(y)) continue;
    const cell = byYear.get(y) || { year: y, eps: 0, quarters: 0, estimated: false, any: false };
    const v = r.actual != null ? r.actual : r.estimate;
    if (v == null) continue;
    cell.eps += v;
    cell.quarters += 1;
    cell.any = true;
    if (r.actual == null) cell.estimated = true;
    byYear.set(y, cell);
  }
  const years = [...byYear.values()]
    .filter(c => c.any)
    .sort((a, b) => a.year - b.year)
    .filter(c => from == null || c.year >= from);

  const px = pos(price);
  return years.map((c, i) => {
    const prev = i > 0 ? years[i - 1].eps : null;
    return {
      year: c.year,
      eps: c.eps,
      quarters: c.quarters,
      // A partial year is not a year. Four quarters or it is marked short, and
      // the growth number beside it is not to be trusted.
      partial: c.quarters < 4,
      estimated: c.estimated,
      // Growth off a loss is not a percentage anyone can interpret: going from
      // -$2 to +$1 is not "150% growth", it is a turnaround.
      yoy: prev != null && prev > 0 ? ((c.eps - prev) / prev) * 100 : null,
      // Decision 4: no P/E on negative earnings.
      pe: px != null && c.eps > 0 ? px / c.eps : null,
    };
  });
}

// ---- valuation -----------------------------------------------------------

// Where a metric sits inside its own history. "P/E of 28" says nothing; "P/E of
// 28, against a five-year range of 19 to 44" says where you are standing.
export function band(current, low, high) {
  const c = num(current), l = num(low), h = num(high);
  if (c == null || l == null || h == null || h <= l) return null;
  return { current: c, low: l, high: h, pct: Math.max(0, Math.min(100, ((c - l) / (h - l)) * 100)) };
}

export const METRICS = [
  { key: 'peTTM', label: 'P/E (TTM)', hint: 'Price per rupee of the last year of earnings.' },
  { key: 'pbAnnual', label: 'P/B', hint: 'Price against book value.' },
  { key: 'psTTM', label: 'P/S (TTM)', hint: 'Price against revenue — the one that still works when earnings are negative.' },
  { key: 'currentRatioAnnual', label: 'Current ratio', hint: 'Short-term assets over short-term debts. Under 1 is a squeeze.' },
  { key: 'totalDebt/totalEquityAnnual', label: 'Debt / equity', hint: 'Leverage. High is not automatically bad, but it is automatically fragile.' },
  { key: 'roeTTM', label: 'ROE %', hint: 'What the company earns on the shareholders’ money.' },
  { key: 'netProfitMarginTTM', label: 'Net margin %', hint: 'How much of each rupee of revenue survives to the bottom line.' },
  { key: 'revenueGrowthTTMYoy', label: 'Revenue growth %', hint: 'Top line, year on year.' },
  { key: 'beta', label: 'Beta', hint: 'How hard it moves when the market moves. 1 is the market.' },
  { key: 'dividendYieldIndicatedAnnual', label: 'Dividend yield %', hint: 'Annual payout against the current price.' },
];

// Finnhub's metric blob is flat and inconsistently populated. Anything absent
// stays absent — a missing ratio is not a zero ratio.
export function keyMetrics(metric = {}) {
  return METRICS.map(m => ({ ...m, value: num(metric[m.key]) })).filter(m => m.value != null);
}

export function fiftyTwoWeek(metric = {}, price) {
  const lo = num(metric['52WeekLow']), hi = num(metric['52WeekHigh']), p = num(price);
  if (lo == null || hi == null || p == null || hi <= lo) return null;
  return {
    low: lo, high: hi, price: p,
    pct: Math.max(0, Math.min(100, ((p - lo) / (hi - lo)) * 100)),
    offHigh: ((p - hi) / hi) * 100,
    offLow: ((p - lo) / lo) * 100,
  };
}

// ---- peers ---------------------------------------------------------------

// A peer table is only honest if every column states how many of the peers
// actually have that number. Ranking on a metric half the set lacks is a
// ranking of who reports, not of who is cheap.
export function peerTable(rows = [], keys = ['peTTM', 'psTTM', 'netProfitMarginTTM', 'roeTTM']) {
  const clean = rows.filter(r => r && r.ticker);
  const cols = keys.map(k => {
    const have = clean.filter(r => num(r.metric?.[k]) != null);
    const vals = have.map(r => num(r.metric[k]));
    return {
      key: k,
      label: (METRICS.find(m => m.key === k) || {}).label || k,
      coverage: have.length,
      of: clean.length,
      // Median, not mean: one company on 400x earnings should not become "the
      // industry average".
      median: vals.length ? median(vals) : null,
      complete: have.length === clean.length && clean.length > 0,
    };
  });
  const table = clean.map(r => ({
    ticker: r.ticker,
    name: r.name || '',
    marketCap: num(r.marketCap),
    price: num(r.price),
    changePct: num(r.changePct),
    self: !!r.self,
    values: Object.fromEntries(keys.map(k => [k, num(r.metric?.[k])])),
  }));
  return { cols, rows: table };
}

export function median(a = []) {
  const s = [...a].sort((x, y) => x - y);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Cheap or dear against the peer median, but only where the comparison is
// actually available on both sides.
export function versusPeers(selfMetric = {}, table) {
  if (!table) return [];
  return table.cols.map(c => {
    const mine = num(selfMetric[c.key]);
    if (mine == null || c.median == null || c.median === 0) {
      return { ...c, mine: null, deltaPct: null };
    }
    return { ...c, mine, deltaPct: ((mine - c.median) / Math.abs(c.median)) * 100 };
  });
}
