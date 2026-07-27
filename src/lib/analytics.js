// ---- Portfolio statistics engine ----
//
// Everything the benchmark / consistency / risk-return cards need, computed from
// two inputs only: a daily value series [{d:'YYYY-MM-DD', v:Number}] and the order
// ledger (for real money-weighted returns). No dependencies, no network.
//
// Money-weighted (XIRR) is what you actually earned given when you put money in.
// Time-weighted (CAGR of the value line) is what the *picks* did. Both are shown
// because for a portfolio that's still being funded monthly they diverge a lot.

const DAY = 86400e3;
const YEAR = 365.25;
const iso = d => (d instanceof Date ? d : new Date(d)).toISOString().slice(0, 10);
const num = x => (Number.isFinite(Number(x)) ? Number(x) : 0);

// portfolioHistory emits {t, v}; benchmarks and the report emit {d, v}. Accept both
// so nothing has to be rewritten on either side.
export function normalise(series) {
  return (series || [])
    .map(p => ({ d: String(p.d ?? p.t ?? '').slice(0, 10), v: num(p.v) }))
    .filter(p => p.d && p.v > 0)
    .sort((a, b) => a.d.localeCompare(b.d));
}

// How many observations a year does this series actually carry? A trading-day line
// gives ~252, a calendar-day line ~365, a weekly one ~52. Annualising with a
// hardcoded 252 would silently inflate or deflate every risk number, so measure it.
export function periodsPerYear(series) {
  const s = normalise(series);
  if (s.length < 3) return 252;
  const years = (new Date(s[s.length - 1].d) - new Date(s[0].d)) / (DAY * YEAR);
  if (years <= 0.05) return 252;
  return Math.min(366, Math.max(12, (s.length - 1) / years));
}

// ---------- returns ----------

// Daily simple returns from a value series, ignoring days where money moved in or
// out (those aren't performance). `flowsByDay` maps 'YYYY-MM-DD' -> net cash in.
// The returned array carries a `.ppy` (periods per year) tag so every annualising
// function downstream scales by what the series actually is, not by an assumption.
export function dailyReturns(series, flowsByDay = {}) {
  const s = normalise(series);
  const out = [];
  for (let i = 1; i < s.length; i++) {
    const prev = num(s[i - 1].v);
    const cur = num(s[i].v);
    if (prev <= 0) continue;
    const flow = num(flowsByDay[s[i].d]);
    // strip the contribution out before measuring the day's move
    const r = (cur - flow - prev) / prev;
    if (Number.isFinite(r) && Math.abs(r) < 1) out.push({ d: s[i].d, r });
  }
  out.ppy = periodsPerYear(s);
  return out;
}

// Whatever the caller passed, then whatever the series tagged itself as, then 252.
const ppyOf = (returns, ppy) => num(ppy) || num(returns?.ppy) || 252;

export function cumulative(returns) {
  return returns.reduce((acc, x) => acc * (1 + x.r), 1) - 1;
}

export function annualise(returns, ppy) {
  if (returns.length < 2) return 0;
  const total = cumulative(returns);
  const years = returns.length / ppyOf(returns, ppy);
  if (years <= 0) return 0;
  if (total <= -1) return -1;
  return Math.pow(1 + total, 1 / years) - 1;
}

// CAGR straight off the value line's endpoints (time-weighted-ish, quick).
export function cagr(series) {
  const s = normalise(series);
  if (s.length < 2) return 0;
  const a = num(s[0].v), b = num(s[s.length - 1].v);
  if (a <= 0 || b <= 0) return 0;
  const years = (new Date(s[s.length - 1].d) - new Date(s[0].d)) / (DAY * YEAR);
  if (years < 0.02) return (b - a) / a;
  return Math.pow(b / a, 1 / years) - 1;
}

// ---------- XIRR ----------
// Cashflows: [{ date, amount }] with negative = money in, positive = money out /
// final value. Bisection rather than Newton — slower but it never diverges, which
// matters because a student's ledger has lumpy, closely-spaced flows.
export function xirr(flows) {
  const f = flows.filter(x => Number.isFinite(num(x.amount)) && x.date).map(x => ({ t: new Date(x.date).getTime(), a: num(x.amount) }));
  if (f.length < 2) return null;
  const hasNeg = f.some(x => x.a < 0), hasPos = f.some(x => x.a > 0);
  if (!hasNeg || !hasPos) return null;
  const t0 = Math.min(...f.map(x => x.t));
  const npv = rate => f.reduce((s, x) => s + x.a / Math.pow(1 + rate, (x.t - t0) / (DAY * YEAR)), 0);

  let lo = -0.9999, hi = 10;
  let flo = npv(lo), fhi = npv(hi);
  if (flo * fhi > 0) return null; // no sign change in a sane range
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fm = npv(mid);
    if (Math.abs(fm) < 1e-7) return mid;
    if (flo * fm <= 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
  }
  return (lo + hi) / 2;
}

// Turn the order ledger into XIRR cashflows, closed out with today's value.
export function ledgerFlows(orders, currentValue, asOf = new Date()) {
  const flows = [];
  for (const o of orders || []) {
    const qty = num(o.qty), px = num(o.price), fee = num(o.fee);
    if (!qty || !px || !o.date) continue;
    const gross = qty * px;
    // buy = money leaves your pocket (negative), sell = money comes back
    flows.push({ date: o.date, amount: o.side === 'S' ? gross - fee : -(gross + fee) });
  }
  if (!flows.length) return [];
  flows.push({ date: iso(asOf), amount: num(currentValue) });
  return flows;
}

// ---------- risk ----------

export function stdev(xs) {
  if (xs.length < 2) return 0;
  const m = xs.reduce((s, x) => s + x, 0) / xs.length;
  const v = xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v);
}

export const volatility = (returns, ppy) => stdev(returns.map(x => x.r)) * Math.sqrt(ppyOf(returns, ppy));

// Downside deviation — only moves below the target count as risk.
export function downsideDev(returns, targetAnnual = 0, ppy) {
  const n = ppyOf(returns, ppy);
  const t = targetAnnual / n;
  const bad = returns.map(x => Math.min(0, x.r - t));
  if (!bad.length) return 0;
  return Math.sqrt(bad.reduce((s, x) => s + x * x, 0) / bad.length) * Math.sqrt(n);
}

export function sharpe(returns, rf = 0.065, ppy) {
  const n = ppyOf(returns, ppy);
  const vol = volatility(returns, n);
  if (!vol) return 0;
  return (annualise(returns, n) - rf) / vol;
}

export function sortino(returns, rf = 0.065, ppy) {
  const n = ppyOf(returns, ppy);
  const dd = downsideDev(returns, rf, n);
  if (!dd) return 0;
  return (annualise(returns, n) - rf) / dd;
}

// Historical 95% VaR, annualised — "in a bad year, roughly this much can vanish".
export function var95(returns, ppy) {
  if (returns.length < 20) return 0;
  const sorted = returns.map(x => x.r).sort((a, b) => a - b);
  const daily = sorted[Math.floor(sorted.length * 0.05)];
  return Math.abs(daily) * Math.sqrt(ppyOf(returns, ppy));
}

// Max drawdown plus how long it took to get back — the "loss recovery" stat.
export function drawdown(series) {
  const s = normalise(series);
  let peak = -Infinity, peakDate = null, maxDD = 0, trough = null, ddStart = null, ddEnd = null;
  let recoveredIn = null, longestUnderwater = 0, underwaterFrom = null;
  for (const p of s) {
    const v = num(p.v);
    if (v <= 0) continue;
    if (v >= peak) {
      if (underwaterFrom) {
        const days = Math.round((new Date(p.d) - new Date(underwaterFrom)) / DAY);
        longestUnderwater = Math.max(longestUnderwater, days);
        if (ddStart && underwaterFrom === ddStart && recoveredIn == null) recoveredIn = days;
        underwaterFrom = null;
      }
      peak = v; peakDate = p.d;
    } else {
      if (!underwaterFrom) underwaterFrom = peakDate || p.d;
      const dd = (v - peak) / peak;
      if (dd < maxDD) { maxDD = dd; trough = p.d; ddStart = peakDate; ddEnd = p.d; }
    }
  }
  if (underwaterFrom && s.length) {
    longestUnderwater = Math.max(longestUnderwater, Math.round((new Date(s[s.length - 1].d) - new Date(underwaterFrom)) / DAY));
  }
  const last = num(s[s.length - 1]?.v);
  const currentDD = peak > 0 && last > 0 ? (last - peak) / peak : 0;
  return {
    maxDD: maxDD * 100,
    currentDD: Math.min(0, currentDD) * 100,
    trough, from: ddStart, to: ddEnd,
    recoveredInDays: recoveredIn,
    longestUnderwaterDays: longestUnderwater,
    recovered: recoveredIn != null,
  };
}

// ---------- vs a benchmark ----------

// Align two series on shared dates so the comparison is apples to apples.
export function align(a, b) {
  const mb = new Map(normalise(b).map(p => [p.d, num(p.v)]));
  const A = [], B = [];
  for (const p of normalise(a)) {
    if (mb.has(p.d)) { A.push({ d: p.d, v: num(p.v) }); B.push({ d: p.d, v: mb.get(p.d) }); }
  }
  return [A, B];
}

export function beta(pRet, bRet) {
  const mb = new Map(bRet.map(x => [x.d, x.r]));
  const pairs = pRet.filter(x => mb.has(x.d)).map(x => [x.r, mb.get(x.d)]);
  if (pairs.length < 20) return null;
  const mp = pairs.reduce((s, [p]) => s + p, 0) / pairs.length;
  const mbm = pairs.reduce((s, [, b]) => s + b, 0) / pairs.length;
  let cov = 0, varb = 0;
  for (const [p, b] of pairs) { cov += (p - mp) * (b - mbm); varb += (b - mbm) ** 2; }
  return varb ? cov / varb : null;
}

export function trackingError(pRet, bRet, ppy) {
  const mb = new Map(bRet.map(x => [x.d, x.r]));
  const diff = pRet.filter(x => mb.has(x.d)).map(x => x.r - mb.get(x.d));
  return diff.length > 2 ? stdev(diff) * Math.sqrt(ppyOf(pRet, ppy)) : 0;
}

export function informationRatio(pRet, bRet, ppy) {
  const n = ppyOf(pRet, ppy);
  const te = trackingError(pRet, bRet, n);
  if (!te) return 0;
  return (annualise(pRet, n) - annualise(bRet, n)) / te;
}

// Up/down capture: of the benchmark's gain on its good days, how much did you catch?
export function captureRatios(pRet, bRet, ppy) {
  const n = ppyOf(pRet, ppy);
  const mb = new Map(bRet.map(x => [x.d, x.r]));
  let pu = 1, bu = 1, pd = 1, bd = 1, nu = 0, nd = 0;
  for (const x of pRet) {
    if (!mb.has(x.d)) continue;
    const b = mb.get(x.d);
    if (b > 0) { pu *= 1 + x.r; bu *= 1 + b; nu++; }
    else if (b < 0) { pd *= 1 + x.r; bd *= 1 + b; nd++; }
  }
  const ann = (prod, k) => (k > 1 && prod > 0 ? Math.pow(prod, n / k) - 1 : prod - 1);
  const upB = ann(bu, nu), downB = ann(bd, nd);
  return {
    up: nu > 5 && upB !== 0 ? (ann(pu, nu) / upB) * 100 : null,
    down: nd > 5 && downB !== 0 ? (ann(pd, nd) / downB) * 100 : null,
    upDays: nu, downDays: nd,
  };
}

export function alpha(pRet, bRet, rf = 0.065, ppy) {
  const n = ppyOf(pRet, ppy);
  const b = beta(pRet, bRet);
  if (b == null) return null;
  return annualise(pRet, n) - (rf + b * (annualise(bRet, n) - rf));
}

// ---------- period slicing ----------

export const RANGES = [
  ['1W', 7], ['1M', 30], ['3M', 91], ['6M', 182], ['1Y', 365], ['3Y', 1095], ['5Y', 1826], ['MAX', null],
];

export function sliceRange(series, days) {
  const s = normalise(series);
  if (!days || !s.length) return s;
  const cut = new Date(new Date(s[s.length - 1].d).getTime() - days * DAY);
  return s.filter(p => new Date(p.d) >= cut);
}

// Trailing return over a window, annualised past a year (what fund factsheets show).
export function trailingReturn(series, days) {
  const s = sliceRange(series, days);
  if (s.length < 2) return null;
  const a = num(s[0].v), b = num(s[s.length - 1].v);
  if (a <= 0) return null;
  const simple = (b - a) / a;
  if (!days || days <= 365) return simple * 100;
  return (Math.pow(1 + simple, 365 / days) - 1) * 100;
}

// Month-by-month returns — the "performance consistency" grid.
export function monthlyReturns(series, flowsByDay = {}) {
  const rets = dailyReturns(series, flowsByDay);
  const byMonth = new Map();
  for (const x of rets) {
    const m = x.d.slice(0, 7);
    byMonth.set(m, (byMonth.has(m) ? byMonth.get(m) : 1) * (1 + x.r));
  }
  return [...byMonth.entries()]
    .map(([month, prod]) => ({ month, ret: (prod - 1) * 100 }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

export function consistency(months) {
  if (!months.length) return { winRate: 0, best: null, worst: null, positive: 0, total: 0, streak: 0 };
  const positive = months.filter(m => m.ret > 0).length;
  let streak = 0, run = 0;
  for (const m of months) { run = m.ret > 0 ? run + 1 : 0; streak = Math.max(streak, run); }
  const sorted = [...months].sort((a, b) => b.ret - a.ret);
  return {
    winRate: (positive / months.length) * 100,
    best: sorted[0], worst: sorted[sorted.length - 1],
    positive, total: months.length, streak,
  };
}

// ---------- the whole picture in one call ----------
export function analyse({ series, benchmark = [], orders = [], flowsByDay = {}, currentValue, rf = 0.065 }) {
  const s = normalise(series);
  const pRet = dailyReturns(s, flowsByDay);
  // Benchmark stats run on the *aligned* pair — the portfolio line and the index
  // line rarely share every date, and comparing across mismatched dates is noise.
  const [sa, ba] = benchmark.length ? align(s, benchmark) : [s, []];
  const paRet = ba.length ? dailyReturns(sa, flowsByDay) : pRet;
  const bRet = ba.length ? dailyReturns(ba) : [];
  const dd = drawdown(s);

  const flows = ledgerFlows(orders, currentValue ?? num(s[s.length - 1]?.v));
  const rate = xirr(flows);

  // benchmark XIRR: same cashflows, but bought into the index instead
  let benchXirr = null;
  if (ba.length && flows.length) {
    const bmap = new Map(ba.map(p => [p.d, p.v]));
    const dates = ba.map(p => p.d);
    const priceOn = d => {
      if (bmap.has(d)) return bmap.get(d);
      const before = dates.filter(x => x <= d);
      return before.length ? bmap.get(before[before.length - 1]) : bmap.get(dates[0]);
    };
    const last = ba[ba.length - 1].v;
    let units = 0;
    for (const f of flows.slice(0, -1)) {
      const px = priceOn(iso(f.date));
      if (px > 0) units += -f.amount / px; // buys are negative → positive units
    }
    benchXirr = xirr([...flows.slice(0, -1), { date: ba[ba.length - 1].d, amount: units * last }]);
  }

  const months = monthlyReturns(s, flowsByDay);
  return {
    days: s.length,
    from: s[0]?.d || null, to: s[s.length - 1]?.d || null,
    cumulative: cumulative(pRet) * 100,
    cagr: cagr(s) * 100,
    xirr: rate == null ? null : rate * 100,
    benchXirr: benchXirr == null ? null : benchXirr * 100,
    benchCumulative: bRet.length ? cumulative(bRet) * 100 : null,
    benchCagr: ba.length ? cagr(ba) * 100 : null,
    volatility: volatility(pRet) * 100,
    benchVolatility: bRet.length ? volatility(bRet) * 100 : null,
    sharpe: sharpe(pRet, rf),
    benchSharpe: bRet.length ? sharpe(bRet, rf) : null,
    sortino: sortino(pRet, rf),
    benchSortino: bRet.length ? sortino(bRet, rf) : null,
    var95: var95(pRet) * 100,
    beta: bRet.length ? beta(paRet, bRet) : null,
    alpha: bRet.length ? (alpha(paRet, bRet, rf) ?? null) : null,
    trackingError: bRet.length ? trackingError(paRet, bRet) * 100 : null,
    informationRatio: bRet.length ? informationRatio(paRet, bRet) : null,
    capture: bRet.length ? captureRatios(paRet, bRet) : { up: null, down: null },
    drawdown: dd,
    months,
    consistency: consistency(months),
    trailing: Object.fromEntries(RANGES.map(([k, d]) => [k, trailingReturn(s, d)])),
    benchTrailing: ba.length ? Object.fromEntries(RANGES.map(([k, d]) => [k, trailingReturn(ba, d)])) : null,
  };
}

// Rebase two series to 100 at their common start — how you plot them together.
export function rebase(series, at = 100) {
  const s = normalise(series);
  const first = s.find(p => num(p.v) > 0);
  if (!first) return s.map(p => ({ ...p, v: at }));
  return s.map(p => ({ d: p.d, v: (num(p.v) / num(first.v)) * at }));
}

// "If I'd put the same money into the index instead" — the INDmoney comparison line.
export function benchmarkEquivalent(orders, benchSeries) {
  const bs = normalise(benchSeries);
  if (!bs.length) return [];
  const bmap = new Map(bs.map(p => [p.d, num(p.v)]));
  const dates = bs.map(p => p.d);
  const priceOn = d => {
    if (bmap.has(d)) return bmap.get(d);
    const before = dates.filter(x => x <= d);
    return before.length ? bmap.get(before[before.length - 1]) : null;
  };
  const byDate = new Map();
  for (const o of orders || []) {
    if (!o.date || !num(o.qty) || !num(o.price)) continue;
    const net = (o.side === 'S' ? -1 : 1) * (num(o.qty) * num(o.price) + num(o.fee));
    byDate.set(iso(o.date), (byDate.get(iso(o.date)) || 0) + net);
  }
  let units = 0;
  return dates.map(d => {
    if (byDate.has(d)) {
      const px = priceOn(d);
      if (px > 0) units += byDate.get(d) / px;
    }
    return { d, v: units * (priceOn(d) || 0) };
  });
}
