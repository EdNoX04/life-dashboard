// Goals, financial independence, and the dividend snowball — the arithmetic only.
//
// Everything here is a projection, which is a polite word for arithmetic applied
// to guesses. The functions take assumptions in and hand rows out; they never
// pretend a number is a forecast. Two design rules hold throughout:
//
//   1. Nothing is smoothed. If a scenario is built on 4% growth, the rows show
//      exactly 4% compounding — no fudge factor, no "typical market" adjustment.
//      A projection that quietly disagrees with its own inputs is worse than none.
//   2. Real terms are computed and carried alongside nominal, because ₹1 crore in
//      2056 is not ₹1 crore. Every UI that shows a final value has the inflation-
//      adjusted twin available and should show it.
//
// No advice is encoded here. There is no "you should contribute more", no optimal
// anything. It projects what the stated assumptions imply and stops.

export const DEFAULT_PLAN = {
  startValue: null,          // null → read live portfolio value
  monthly: 0,                // monthly contribution
  contribGrowthPct: 0,       // annual step-up in contributions (raises, SIP top-ups)
  growthPct: 8,             // nominal annual price growth
  divYieldPct: 1.2,          // starting dividend yield on cost of the book
  divGrowthPct: 6,           // annual dividend per-share growth
  drip: true,                // reinvest dividends
  inflationPct: 5,           // for the real-terms twin (India CPI-ish)
  years: 30,
  valueGoal: 10000000,       // ₹1 crore by default — a legible number, not a target
  incomeGoal: 600000,        // ₹50k/month of passive income
  annualExpenses: 600000,    // for the FIRE number
  swrPct: 3.5,               // safe withdrawal rate
  currentAge: null,
};

// The four scenarios in the reference. They differ ONLY in growth and dividend
// growth — contributions are the one lever you actually control, so "Base" is
// deliberately the no-contribution line and "Base + Contributions" shows what the
// lever is worth. Bear and Bull are not probabilities. They are two other guesses,
// drawn so the base case is never mistaken for a prediction.
export const SCENARIOS = [
  { key: 'base', label: 'Base', color: 'var(--cyan)', growthMul: 1, divGrowthMul: 1, contrib: false },
  { key: 'contrib', label: 'Base + contributions', color: 'var(--green)', growthMul: 1, divGrowthMul: 1, contrib: true },
  { key: 'bear', label: 'Bear', color: 'var(--red)', growthMul: 0.45, divGrowthMul: 0.5, contrib: true },
  { key: 'bull', label: 'Bull', color: 'var(--yellow)', growthMul: 1.5, divGrowthMul: 1.3, contrib: true },
];

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

// One scenario, year by year.
//
// The order of operations inside a year matters and is easy to get subtly wrong,
// so it is spelled out: contributions go in monthly (so they compound for a
// partial year — approximated as a half-year of growth, which is what a monthly
// SIP actually earns), then price growth applies to the whole balance, then the
// year's dividends are computed on the average balance and either reinvested or
// paid out. Computing dividends on the END balance would silently overstate
// income by a full year of growth every single year, and over thirty years that
// compounds into a number that is simply wrong.
export function projectYears({
  start = 0, years = 30, growthPct = 8, divYieldPct = 1.2, divGrowthPct = 6,
  monthly = 0, contribGrowthPct = 0, drip = true, inflationPct = 0, withContrib = true,
} = {}) {
  const g = num(growthPct) / 100;
  const dg = num(divGrowthPct) / 100;
  const infl = num(inflationPct) / 100;
  let value = Math.max(0, num(start));
  let yieldOnValue = Math.max(0, num(divYieldPct)) / 100;
  let contrib = withContrib ? Math.max(0, num(monthly)) * 12 : 0;
  let contributedTotal = 0;
  const rows = [{
    year: 0, value, contributed: 0, annualIncome: value * yieldOnValue,
    monthlyIncome: (value * yieldOnValue) / 12, real: value, cumulativeIncome: 0,
  }];

  let cumulativeIncome = 0;
  for (let y = 1; y <= Math.max(1, Math.round(num(years, 30))); y++) {
    const opening = value;
    // Contributions arrive through the year, so on average they are invested for
    // half of it. This is the standard mid-period convention and it matters: the
    // naive alternatives (all at the start, all at the end) are wrong by roughly
    // half a year of growth in opposite directions.
    const contribGrowth = contrib * (g / 2);
    value = opening * (1 + g) + contrib + contribGrowth;
    contributedTotal += contrib;

    const avgBalance = (opening + value) / 2;
    const income = avgBalance * yieldOnValue;
    cumulativeIncome += income;
    if (drip) value += income;

    // Yield on the current balance drifts: dividends per share grow at dg while
    // price grows at g, so the yield ratchets toward dg/g. This is why a dividend
    // book's income line bends upward faster than its value line.
    yieldOnValue = yieldOnValue * ((1 + dg) / (1 + g || 1));
    if (!Number.isFinite(yieldOnValue) || yieldOnValue < 0) yieldOnValue = 0;

    contrib *= 1 + num(contribGrowthPct) / 100;

    rows.push({
      year: y,
      value,
      contributed: contributedTotal,
      annualIncome: value * yieldOnValue,
      monthlyIncome: (value * yieldOnValue) / 12,
      real: infl ? value / Math.pow(1 + infl, y) : value,
      cumulativeIncome,
    });
  }
  return rows;
}

// Run all four scenarios off one plan object.
export function projectAll(plan = {}) {
  const p = { ...DEFAULT_PLAN, ...plan };
  const out = {};
  for (const s of SCENARIOS) {
    out[s.key] = projectYears({
      start: p.startValue,
      years: p.years,
      growthPct: num(p.growthPct) * s.growthMul,
      divYieldPct: p.divYieldPct,
      divGrowthPct: num(p.divGrowthPct) * s.divGrowthMul,
      monthly: p.monthly,
      contribGrowthPct: p.contribGrowthPct,
      drip: p.drip,
      inflationPct: p.inflationPct,
      withContrib: s.contrib,
    });
  }
  return out;
}

// First year a row's field crosses a target. Returns null — never 0, never the
// last year — when the target is never reached, because "year 0" and "never" are
// completely different answers and a caller that confuses them will render
// "you're already there" over a plan that never gets there.
export function goalYear(rows = [], field = 'value', target = 0) {
  const t = num(target);
  if (!(t > 0) || !rows.length) return null;
  for (const r of rows) if (num(r[field]) >= t) return r.year;
  return null;
}

// The FIRE number: the balance whose safe withdrawal covers a year of spending.
// The withdrawal rate is the entire argument — 4% and 3% differ by a third of the
// target — so it is always an explicit input, never a hidden constant.
export function fireNumber({ annualExpenses = 0, swrPct = 3.5 } = {}) {
  const e = num(annualExpenses), s = num(swrPct) / 100;
  if (!(e > 0) || !(s > 0)) return null;
  return e / s;
}

// Coast FIRE: the balance that, left alone with no further contributions, grows
// into the FIRE number by the target year. Below it you still need to save; above
// it, arithmetically, you don't.
export function coastNumber({ annualExpenses = 0, swrPct = 3.5, growthPct = 8, years = 20 } = {}) {
  const target = fireNumber({ annualExpenses, swrPct });
  if (target == null) return null;
  const g = num(growthPct) / 100, y = Math.max(0, num(years));
  return target / Math.pow(1 + g, y);
}

// A compact summary per scenario for the projection table.
export function summarise(rows = [], { valueGoal = 0, incomeGoal = 0, thisYear } = {}) {
  const last = rows[rows.length - 1] || {};
  const y0 = Number.isFinite(thisYear) ? thisYear : new Date().getFullYear();
  const vy = goalYear(rows, 'value', valueGoal);
  const iy = goalYear(rows, 'annualIncome', incomeGoal);
  return {
    finalValue: last.value ?? null,
    finalReal: last.real ?? null,
    finalAnnualIncome: last.annualIncome ?? null,
    finalMonthlyIncome: last.monthlyIncome ?? null,
    contributed: last.contributed ?? 0,
    cumulativeIncome: last.cumulativeIncome ?? 0,
    valueGoalYear: vy, valueGoalAt: vy == null ? null : y0 + vy,
    incomeGoalYear: iy, incomeGoalAt: iy == null ? null : y0 + iy,
  };
}

// How much of the final balance came from money you put in versus money the
// market and the dividends made. Worth showing plainly: in most long projections
// the second number dwarfs the first, and in most SHORT ones it doesn't, which is
// the single most useful thing a young investor can see.
export function sourceSplit(rows = []) {
  const last = rows[rows.length - 1];
  const first = rows[0];
  if (!last || !first) return null;
  const seed = num(first.value);
  const put = num(last.contributed);
  const total = num(last.value);
  const made = total - seed - put;
  if (!(total > 0)) return null;
  return { seed, contributed: put, earned: made, total,
    seedPct: (seed / total) * 100, contribPct: (put / total) * 100, earnedPct: (made / total) * 100 };
}

// ---- goals ---------------------------------------------------------------
// Free-form goals live in the `goals_money` memory blob. A goal is a target
// amount by a date; progress is measured against the live portfolio value plus
// whatever the plan projects between now and then.

export const EMPTY_GOALS = { goals: [] };

export function goalProgress(goal = {}, { value = 0, rows = [], thisYear } = {}) {
  const target = num(goal.target);
  if (!(target > 0)) return null;
  const y0 = Number.isFinite(thisYear) ? thisYear : new Date().getFullYear();
  const byYear = goal.by ? Number(String(goal.by).slice(0, 4)) : null;
  const horizon = byYear ? byYear - y0 : null;
  const now = num(value);
  const pct = (now / target) * 100;
  // What the plan says you'll have when the goal falls due.
  let projected = null, onTrack = null;
  if (horizon != null && horizon >= 0 && rows.length) {
    const row = rows.find(r => r.year === horizon) || rows[rows.length - 1];
    projected = row ? num(row.value) : null;
    if (projected != null) onTrack = projected >= target;
  }
  return { target, now, pct: Math.max(0, pct), horizon, byYear, projected, onTrack,
    shortfall: projected == null ? null : target - projected };
}
