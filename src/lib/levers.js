// levers.js — what actually moves the retirement date.
//
// The Planner answers "where does this plan end up". This file answers the
// question underneath the whole money tab, the one Neel stated as the reason for
// building it: what would make it happen sooner. That is a sensitivity question,
// and sensitivity is the single easiest analysis in personal finance to turn into
// advice by accident — because a sorted table of "this buys you N years" reads as
// a to-do list no matter what is written above it.
//
// Eight decisions, and the first one is the whole shape of the module.
//
// 1. A LEVER YOU CONTROL AND A GUESS YOU MADE ARE DIFFERENT OBJECTS, AND ARE
//    NEVER RANKED IN ONE LIST.
//
//    The seductive output here is one table, sorted by effect:
//
//        +2pp growth ................ 4 years earlier
//        +₹5,000/month .............. 2 years earlier
//        −₹3,000/month spending ..... 1 year earlier
//
//    Every line is a true statement about the model. Only two of them are
//    statements about anything Neel can do. Growth is not a lever, it is a number
//    he typed into an assumptions box, and putting it at the top of a list of
//    actions makes "assume more" look like the most effective action available.
//    So levers carry a `kind` — 'control' or 'assumption' — the two are returned
//    in separate arrays, sorting happens WITHIN a kind and never across, and the
//    assumption side exists mainly to show how much of the answer is guesswork.
//
// 2. THE CROSSING IS MEASURED IN REAL TERMS, BECAUSE THE TARGET IS IN TODAY'S
//    MONEY.
//
//    `fireNumber` is annual expenses ÷ withdrawal rate, and annual expenses are
//    what things cost now. The projection's `value` column is nominal. Comparing
//    the two retires you on paper years before you can retire in fact — at 5%
//    inflation over 20 years the nominal balance is 2.65× the real one, so the
//    error is not a rounding matter, it is the answer. The crossing is therefore
//    taken against `real`, and every figure this file returns says so.
//
// 3. SENSITIVITY IS MEASURED BY RE-RUNNING THE PROJECTION, NEVER BY A FORMULA.
//
//    There is a closed form for "years to reach a multiple at rate g". It does not
//    contain step-ups, drip, the yield ratchet, or the mid-period contribution
//    convention — all of which `projectYears` does contain. A closed form here
//    would be a second, simpler model, and then the Levers screen and the Planner
//    screen would give different answers for the same plan and there would be no
//    way to tell which was wrong. Every number below comes from `projectYears`.
//
// 4. THE DATE IS A YEAR; THE EFFECT IS MEASURED IN MONTHS.
//
//    The projection has one row per year, so a crossing is a year and that is what
//    gets printed as a date — a plan does not have a birthday. But at whole-year
//    resolution almost every realistic lever moves the crossing by zero, and a
//    table of zeros is not caution, it is a broken screen. So the DIFFERENCE
//    between two plans is measured on the linearly-interpolated crossing point
//    inside the year it lands in. That interpolation is an approximation across a
//    year that actually compounds, it is labelled as one, and it is used only for
//    differences — never to print a date.
//
// 5. THE UNIT OF A LEVER IS THE UNIT THE PERSON THINKS IN.
//
//    ₹1,000 a month, not "1% more contribution". One percentage point of growth,
//    not "a 12.5% relative increase in the growth assumption". Every lever carries
//    its unit as text and the screen prints it.
//
// 6. NON-LINEARITY IS SHOWN, NOT AVERAGED INTO A RATE.
//
//    Compounding means the second ₹1,000/month does not buy what the first did,
//    and near the target an extra rupee buys much more than it did at the start.
//    A single "months per ₹1,000" figure is therefore only true at the point it
//    was measured, and the first thing anyone does with a rate is multiply it. So
//    each lever returns a LADDER of rungs and there is no per-unit export in this
//    file at all.
//
// 7. A LEVER THAT DOES NOT MOVE THE DATE IS REPORTED, NOT DROPPED.
//
//    "Your spending barely moves your date, because your contributions dominate
//    it" is one of the more useful things this screen can say. Dropping flat
//    levers leaves a list in which everything matters, which is a different
//    portfolio from the one being described.
//
// 8. IF THE BASELINE NEVER CROSSES, THE DELTAS ARE NOT THE ANSWER.
//
//    When the plan does not reach the number inside its own horizon, every rung
//    reads "never → never" and the table shows a column of dashes, which the eye
//    reads as "nothing helps". What is true is narrower and more useful: nothing
//    at THIS size helps within THIS horizon. `analyse` says so in a field, and the
//    rungs that do bring the crossing inside the horizon are marked, because that
//    is the one genuinely new fact in that state.
//
// Not in this file, deliberately: any function returning a recommended lever, a
// ranked "best action", or a required monthly saving to hit a chosen date. The
// last of those is the most tempting — it is a solve, and it is arithmetic — but
// a single number labelled "save this much" is an instruction with a rupee sign
// on it, and the ladder already shows what each amount buys.

import { DEFAULT_PLAN, projectYears, fireNumber } from './plan.js';

// Written out rather than imported, for the sixth time in this codebase and for
// the same reason: Number(null), Number('') and Number(false) are all 0, and 0 is
// finite, so the naive version turns a missing figure into a real zero. A shared
// helper is one refactor away from being replaced by the naive version again.
const num = v => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const n0 = (v, d = 0) => (num(v) == null ? d : Number(v));

export const REAL_TERMS_NOTE =
  'Measured against the inflation-adjusted balance, because the target is built ' +
  'from what a year costs today.';

// The fractional year at which a series first reaches a target. Returns null for
// "never inside the horizon" — never 0, never the last year, because "you are
// already there" and "it never gets there" are the two answers a caller must not
// be able to confuse.
export function crossFraction(rows = [], field = 'real', target = 0) {
  const t = num(target);
  if (!(t > 0) || !rows.length) return null;
  for (let i = 0; i < rows.length; i++) {
    const v = num(rows[i][field]);
    if (v == null || v < t) continue;
    if (i === 0) return 0;
    const a = num(rows[i - 1][field]);
    // No interpolation across a flat or falling step: the fraction would be a
    // division by zero or a number outside the year it claims to be inside.
    if (a == null || !(v > a)) return rows[i].year;
    return rows[i - 1].year + (t - a) / (v - a);
  }
  return null;
}

// One plan, evaluated. `years` is the whole year the crossing lands in (what gets
// printed as a date); `frac` is the interpolated point (what differences are
// measured on). Decision 4 is the reason there are two.
export function crossing(plan = {}, { thisYear = new Date().getFullYear() } = {}) {
  const p = { ...DEFAULT_PLAN, ...plan };
  const target = fireNumber({ annualExpenses: p.annualExpenses, swrPct: p.swrPct });
  const horizon = Math.max(1, Math.round(n0(p.years, 30)));
  if (target == null || !(target > 0)) {
    return { target: null, rows: [], years: null, frac: null, calYear: null,
      reachable: false, horizon, basis: 'real',
      why: 'No target: a FIRE number needs annual spending and a withdrawal rate.' };
  }
  const rows = projectYears({
    start: n0(p.startValue), years: horizon,
    growthPct: p.growthPct, divYieldPct: p.divYieldPct, divGrowthPct: p.divGrowthPct,
    monthly: p.monthly, contribGrowthPct: p.contribGrowthPct, drip: p.drip,
    inflationPct: p.inflationPct, withContrib: true,
  });
  const frac = crossFraction(rows, 'real', target);
  const years = frac == null ? null : Math.ceil(frac);
  const last = rows[rows.length - 1] || {};
  return {
    target, rows, years, frac, horizon, basis: 'real',
    calYear: years == null ? null : thisYear + years,
    reachable: frac != null,
    endReal: num(last.real),
    shortfall: frac == null ? (num(last.real) == null ? null : target - num(last.real)) : null,
    why: frac == null ? `The plan does not reach the number inside its ${horizon}-year horizon.` : null,
  };
}

// The rungs. Four, spaced so the curve is visible rather than sampled: 1 and 2
// show the local slope, 10 shows how far it bends. A single rung would be a rate
// with extra steps, which decision 6 exists to refuse.
export const RUNGS = [1, 2, 5, 10];

// Every lever carries the field it moves, the size of one rung in the unit a
// person thinks in, the direction that is supposed to HELP, and the screen that
// owns the underlying number. `dir: -1` means the helpful move is downward, which
// is true of spending and of the withdrawal rate for opposite reasons.
export const LEVERS = [
  {
    id: 'monthly', kind: 'control', field: 'monthly', dir: 1,
    label: 'Monthly contribution', step: 1000, unit: '₹/month', view: 'plan',
    note: 'What you put in each month, before any step-up.',
  },
  {
    id: 'stepup', kind: 'control', field: 'contribGrowthPct', dir: 1,
    label: 'Annual step-up', step: 1, unit: 'pp/year', view: 'plan',
    note: 'How much the monthly amount rises each year. A raise you route into the ' +
      'SIP rather than into spending shows up here, not above.',
  },
  {
    id: 'spend', kind: 'control', field: 'annualExpenses', dir: -1, perMonth: true,
    label: 'Monthly spending', step: 12000, unit: '₹/month', view: 'cash',
    note: 'Spending is the only lever that pulls twice: it frees money to invest ' +
      'AND it lowers the number you are aiming at. This ladder moves the target ' +
      'only — the contribution is not raised to match, because whether the saved ' +
      'rupee gets invested is a separate decision and not one this file can assume.',
  },
  {
    id: 'growth', kind: 'assumption', field: 'growthPct', dir: 1,
    label: 'Growth assumption', step: 1, unit: 'pp/year', view: 'plan',
    note: 'Not a lever. This is what happens to the answer when the guess changes, ' +
      'which is a measure of how much of the answer is guess.',
  },
  {
    id: 'inflation', kind: 'assumption', field: 'inflationPct', dir: -1,
    label: 'Inflation assumption', step: 1, unit: 'pp/year', view: 'plan',
    note: 'The crossing is measured in real terms, so this one bites directly on ' +
      'the balance rather than on the target.',
  },
  {
    id: 'swr', kind: 'assumption', field: 'swrPct', dir: 1,
    label: 'Withdrawal rate', step: 0.5, unit: 'pp', view: 'plan',
    note: 'A higher rate is a smaller target and an earlier date, and it is also a ' +
      'larger chance of running out. This ladder shows only the first half of that ' +
      'trade, and cannot show the second.',
  },
];

export const leverById = id => LEVERS.find(l => l.id === id) || null;

// Field-level validity. A withdrawal rate of zero is an infinite target and a
// negative expense is not a thing; clamping here rather than at the caller keeps
// a rung from producing a crossing that is arithmetically fine and meaningless.
const FLOORS = { monthly: 0, contribGrowthPct: -50, annualExpenses: 0, growthPct: -50, inflationPct: -10, swrPct: 0.25 };
function applyRung(plan, lever, rungs) {
  const cur = n0(plan[lever.field], DEFAULT_PLAN[lever.field]);
  const raw = cur + lever.step * rungs * lever.dir;
  const floor = FLOORS[lever.field];
  const next = floor == null ? raw : Math.max(floor, raw);
  return { plan: { ...plan, [lever.field]: next }, value: next, clamped: next !== raw };
}

// One lever, all rungs. `moved` is positive when the date comes forward.
export function ladder(plan = {}, lever, { rungs = RUNGS, thisYear, base = null } = {}) {
  if (!lever) return null;
  const b = base || crossing(plan, { thisYear });
  const steps = rungs.map(r => {
    const { plan: next, value, clamped } = applyRung(plan, lever, r);
    const c = crossing(next, { thisYear });
    const movedYears = (b.frac != null && c.frac != null) ? b.frac - c.frac : null;
    return {
      rungs: r,
      amount: lever.step * r,
      // What the field now reads, and — for spending — what that is per month,
      // since the stored field is annual and the label is monthly.
      value, clamped,
      shown: lever.perMonth ? value / 12 : value,
      years: c.years, calYear: c.calYear, frac: c.frac, reachable: c.reachable,
      movedYears,
      movedMonths: movedYears == null ? null : Math.round(movedYears * 12),
      // Decision 8: the one new fact when the baseline never crosses.
      becomesReachable: !b.reachable && c.reachable,
    };
  });
  const best = steps.reduce((m, s) => Math.max(m, s.movedMonths ?? 0), 0);
  const anyReach = steps.some(s => s.becomesReachable);
  return {
    ...lever, steps, base: b,
    bestMonths: best,
    // Decision 7: flat is a result, not a reason to disappear. A lever is flat
    // only if it neither moved the date NOR brought it inside the horizon.
    flat: best === 0 && !anyReach,
    becomesReachable: anyReach,
  };
}

export function analyse(plan = {}, { thisYear, rungs = RUNGS } = {}) {
  const base = crossing(plan, { thisYear });
  const all = LEVERS.map(l => ladder(plan, l, { rungs, thisYear, base }));
  // Decision 1: sorted within a kind, never across. The two arrays are never
  // concatenated anywhere in this file.
  const bykind = k => all.filter(l => l.kind === k).sort((a, b) => b.bestMonths - a.bestMonths);
  return {
    base,
    controls: bykind('control'),
    assumptions: bykind('assumption'),
    flat: all.filter(l => l.flat).map(l => l.id),
    // Decision 8, stated as a field so the screen cannot forget to branch on it.
    baselineNote: base.reachable
      ? null
      : `Nothing on this screen brings the crossing inside the ${base.horizon}-year ` +
        `horizon on its own unless it is marked below — the ladders show what each ` +
        `change is worth, not what is enough.`,
    realTerms: REAL_TERMS_NOTE,
  };
}

// The assumptions actually used, as printable pairs. This exists so the screen
// cannot render a date without the numbers that produced it: a retirement year
// with its assumptions on another tab is a prediction, and this file does not
// make predictions.
export function assumptionsOf(plan = {}, cur = '₹') {
  const p = { ...DEFAULT_PLAN, ...plan };
  const money = v => `${cur}${Math.round(n0(v)).toLocaleString('en-IN')}`;
  return [
    { label: 'Starting from', value: money(p.startValue) },
    { label: 'Contributing', value: `${money(p.monthly)}/month`, note: n0(p.contribGrowthPct) ? `rising ${p.contribGrowthPct}%/year` : 'flat' },
    { label: 'Growth', value: `${n0(p.growthPct)}%/year` },
    { label: 'Inflation', value: `${n0(p.inflationPct)}%/year` },
    { label: 'Spending', value: `${money(n0(p.annualExpenses) / 12)}/month`, note: `${money(p.annualExpenses)}/year` },
    { label: 'Withdrawal rate', value: `${n0(p.swrPct)}%` },
    { label: 'Horizon', value: `${Math.max(1, Math.round(n0(p.years, 30)))} years` },
  ];
}
