// ---- Risk index, portfolio health, and where the book sits ----
//
// Item 10 of the money spec, built from the reference screenshots. Two honest
// caveats are baked into this file rather than hidden behind a pretty gauge:
//
// 1. The 0–600 risk scale is *mine*. There is no industry-standard 600-point risk
//    index — the number in the reference screenshot came out of one broker's
//    proprietary model. So rather than reverse-engineer a screenshot, this builds
//    the score from five things that genuinely drive portfolio risk (volatility,
//    drawdown, concentration, growth-asset share, market beta), each scored 0–100
//    against published bands, weighted, and multiplied by six. Every component is
//    returned alongside the total so the number is always explainable.
//
// 2. "How you compare" in the reference compares you against other users of that
//    platform. There is no user base here, and inventing a peer distribution would
//    be fiction. Instead the comparison runs against a ladder of textbook model
//    portfolios — all-cash through 100% equity — scored on the exact same scale.
//    That is a real comparison, and the UI says plainly what it is.
//
// Nothing here is advice. It is measurement.

// Map a value onto 0–100 through a low/high band, clamped at both ends.
const band = (v, lo, hi) => {
  if (!Number.isFinite(v)) return null;
  const t = (v - lo) / (hi - lo);
  return Math.max(0, Math.min(100, t * 100));
};
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const avg = xs => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

export const RISK_MAX = 600;

// Bands chosen so that a plain broad-market equity index fund — roughly 16% vol,
// −34% worst drawdown, beta 1, fully in equity, well diversified — lands near the
// middle of "moderately aggressive". That is the anchor the whole scale hangs on,
// and the test suite asserts it rather than trusting this comment.
export const RISK_BANDS = [
  { upTo: 130, label: 'Conservative', color: 'var(--cyan)' },
  { upTo: 280, label: 'Moderate', color: 'var(--green)' },
  { upTo: 430, label: 'Moderately aggressive', color: 'var(--yellow)' },
  { upTo: 520, label: 'Aggressive', color: 'var(--orange)' },
  { upTo: Infinity, label: 'Very aggressive', color: 'var(--red)' },
];

export const bandOf = score => RISK_BANDS.find(b => score <= b.upTo) || RISK_BANDS[RISK_BANDS.length - 1];

const RISK_PARTS = [
  {
    key: 'volatility',
    label: 'Volatility',
    weight: 0.30,
    note: 'How much the book swings, annualised. Cash sits near 2%; a broad index fund runs about 16%; a concentrated growth book can top 28%.',
    score: ({ volatility }) => band(volatility, 2, 28),
  },
  {
    key: 'drawdown',
    label: 'Worst drawdown',
    weight: 0.20,
    note: 'The deepest peak-to-trough fall on record. Under 3% is a deposit book; 45% is what a concentrated equity book can do in a bad year.',
    // Math.abs() is the trap here: Math.abs(null) is 0, so a *missing* drawdown
    // would sail through band() as a perfectly measured zero and quietly report
    // "this book has never fallen". Check finiteness before taking the absolute.
    score: ({ maxDD }) => (Number.isFinite(maxDD) ? band(Math.abs(maxDD), 3, 45) : null),
  },
  {
    key: 'concentration',
    label: 'Concentration',
    weight: 0.20,
    note: 'Effective number of holdings (1/HHI). Twenty equal positions is diversified; two is a bet.',
    score: ({ effectiveN }) => (Number.isFinite(effectiveN) && effectiveN > 0 ? 100 - band(effectiveN, 2, 20) : null),
  },
  {
    key: 'growth',
    label: 'Growth-asset share',
    weight: 0.20,
    note: 'Share sitting in equity, equity ETFs and crypto rather than deposits, bonds or gold. Read straight through — 40% in growth assets scores 40.',
    score: ({ growthPct }) => band(growthPct, 0, 100),
  },
  {
    key: 'beta',
    label: 'Market beta',
    weight: 0.10,
    note: 'Sensitivity to the chosen index. Zero is market-neutral, 1.0 moves with the market, 1.6 moves half again as hard.',
    score: ({ beta }) => band(beta, 0, 1.6),
  },
];

// Inputs come from analytics.analyse(), assets.concentration() and
// assets.allocationBreakdown(). Any of them may be missing on a young portfolio,
// and a missing component is dropped rather than guessed — the weights of the
// components that *did* compute are renormalised, and `coverage` reports how much
// of the model actually ran.
export function riskScore(inputs = {}) {
  const parts = RISK_PARTS.map(p => ({ ...p, value: p.score(inputs) }))
    .map(p => ({ key: p.key, label: p.label, note: p.note, weight: p.weight, score: p.value }));

  const live = parts.filter(p => p.score != null);
  const wSum = live.reduce((s, p) => s + p.weight, 0);
  if (!wSum) {
    return { score: null, band: null, parts, coverage: 0, max: RISK_MAX };
  }
  const norm = live.reduce((s, p) => s + p.score * p.weight, 0) / wSum;
  const score = Math.round(clamp(norm, 0, 100) * (RISK_MAX / 100));
  return {
    score,
    band: bandOf(score),
    parts: parts.map(p => ({ ...p, contribution: p.score == null ? null : (p.score * p.weight) / wSum })),
    coverage: wSum,
    max: RISK_MAX,
  };
}

// ---- reference ladder ----
// Long-run characteristics of textbook allocations. These are round numbers from
// the standard literature on asset-class behaviour, not fitted to anything — they
// exist to give the risk score a ruler, and they are deliberately coarse.
//
// Every rung except the last is modelled as fully diversified (effectiveN 20+), so
// the ladder is driven by the things that genuinely separate these allocations —
// volatility, drawdown, growth share and beta — rather than by an arbitrary
// holding count. Getting this wrong once put the cash rung *above* the 20/80 rung,
// which is how I found out it mattered.
export const MODEL_PORTFOLIOS = [
  { label: 'All cash / deposits', volatility: 1, maxDD: -1, effectiveN: 20, growthPct: 0, beta: 0.02 },
  { label: 'Conservative 20/80', volatility: 5, maxDD: -8, effectiveN: 20, growthPct: 20, beta: 0.22 },
  { label: 'Balanced 40/60', volatility: 8, maxDD: -18, effectiveN: 20, growthPct: 40, beta: 0.44 },
  { label: 'Classic 60/40', volatility: 11, maxDD: -27, effectiveN: 20, growthPct: 60, beta: 0.62 },
  { label: 'Growth 80/20', volatility: 14, maxDD: -33, effectiveN: 20, growthPct: 80, beta: 0.82 },
  { label: 'Index fund, 100% equity', volatility: 16, maxDD: -34, effectiveN: 25, growthPct: 100, beta: 1.0 },
  { label: 'Concentrated growth', volatility: 26, maxDD: -48, effectiveN: 6, growthPct: 100, beta: 1.35 },
];

// Place the book on that ladder: the score, every model's score, and how many
// models sit below it.
export function placement(score) {
  const rungs = MODEL_PORTFOLIOS.map(m => ({ label: m.label, score: riskScore(m).score }))
    .sort((a, b) => a.score - b.score);
  if (score == null) return { rungs, below: null, percentile: null, nearest: null };
  const below = rungs.filter(r => r.score < score).length;
  const nearest = rungs.reduce((best, r) =>
    Math.abs(r.score - score) < Math.abs(best.score - score) ? r : best, rungs[0]);
  return { rungs, below, percentile: (below / rungs.length) * 100, nearest };
}

// ---- health ----
// Five things a portfolio can be good or bad at, each scored out of 5, then
// weighted. Deliberately separate from the risk score: a high-risk book can be
// perfectly healthy, and a timid one can be badly built.

const HEALTH_PARTS = [
  {
    key: 'diversification',
    label: 'Diversification',
    weight: 1.1,
    note: 'Effective number of holdings, so one oversized position drags this down even if the count looks fine.',
    score: ({ effectiveN }) => (Number.isFinite(effectiveN) && effectiveN > 0 ? clamp(band(effectiveN, 1, 18) / 20, 0, 5) : null),
  },
  {
    key: 'riskAdjusted',
    label: 'Risk-adjusted return',
    weight: 1.2,
    note: 'Sharpe ratio — return earned per unit of volatility endured. Around 1.0 is good; above 1.5 is excellent.',
    score: ({ sharpe }) => (Number.isFinite(sharpe) ? clamp(band(sharpe, -0.5, 2.0) / 20, 0, 5) : null),
  },
  {
    key: 'drawdown',
    label: 'Drawdown control',
    weight: 1.0,
    note: 'Worst fall relative to the index over the same window. Falling less than the market scores well.',
    score: ({ maxDD, benchMaxDD }) => {
      if (!Number.isFinite(maxDD)) return null;
      if (!Number.isFinite(benchMaxDD) || benchMaxDD === 0) return clamp(5 - band(Math.abs(maxDD), 5, 45) / 20, 0, 5);
      const ratio = Math.abs(maxDD) / Math.abs(benchMaxDD); // <1 means shallower than the index
      return clamp(5 - band(ratio, 0.6, 1.8) / 20, 0, 5);
    },
  },
  {
    key: 'consistency',
    label: 'Monthly consistency',
    weight: 0.9,
    note: 'Share of months finishing green. Coin-flip is 50%; a steady book runs nearer 60%.',
    score: ({ winRate }) => (Number.isFinite(winRate) ? clamp(band(winRate, 30, 70) / 20, 0, 5) : null),
  },
  {
    key: 'edge',
    label: 'Edge over the index',
    weight: 1.0,
    note: 'Annualised return above (or below) the benchmark. Zero is par, and par is respectable.',
    score: ({ excessCagr }) => (Number.isFinite(excessCagr) ? clamp(band(excessCagr, -12, 12) / 20, 0, 5) : null),
  },
];

export const HEALTH_GRADES = [
  { upTo: 1.5, label: 'Fragile', color: 'var(--red)' },
  { upTo: 2.5, label: 'Shaky', color: 'var(--orange)' },
  { upTo: 3.5, label: 'Reasonable', color: 'var(--yellow)' },
  { upTo: 4.3, label: 'Strong', color: 'var(--green)' },
  { upTo: Infinity, label: 'Excellent', color: 'var(--cyan)' },
];
export const gradeOf = s => HEALTH_GRADES.find(g => s <= g.upTo) || HEALTH_GRADES[HEALTH_GRADES.length - 1];

export function healthScore(inputs = {}) {
  const parts = HEALTH_PARTS.map(p => ({
    key: p.key, label: p.label, note: p.note, weight: p.weight, score: p.score(inputs),
  }));
  const live = parts.filter(p => p.score != null);
  const wSum = live.reduce((s, p) => s + p.weight, 0);
  if (!wSum) return { score: null, grade: null, parts, measured: 0, of: parts.length };
  const score = live.reduce((s, p) => s + p.score * p.weight, 0) / wSum;
  return {
    score: Math.round(score * 100) / 100,
    grade: gradeOf(score),
    parts,
    measured: live.length,
    of: parts.length,
  };
}

// ---- Wall Street consensus, weighted by what you actually own ----
// One analyst rating on a 0.4% position should not count the same as one on a 30%
// position, so ratings are weighted by position value. `fetch` is injected so this
// stays testable without a network.
export async function streetConsensus(held, priceOf, fetchOne) {
  const rows = [];
  let buy = 0, hold = 0, sell = 0, covered = 0, total = 0;

  for (const h of held || []) {
    const value = Number(h.qty) * Number(priceOf(h) || 0);
    total += value;
    let rec = null;
    try { rec = await fetchOne(h.ticker); } catch { rec = null; }
    if (!rec || !rec.total) { rows.push({ ticker: h.ticker, value, rec: null }); continue; }
    covered += value;
    const w = value / (rec.total || 1);
    buy += rec.buy * w; hold += rec.hold * w; sell += rec.sell * w;
    rows.push({
      ticker: h.ticker, value, rec,
      buyPct: (rec.buy / rec.total) * 100,
      holdPct: (rec.hold / rec.total) * 100,
      sellPct: (rec.sell / rec.total) * 100,
      lean: rec.buy > rec.sell + rec.hold ? 'buy' : rec.sell > rec.buy ? 'sell' : 'hold',
    });
  }

  const sum = buy + hold + sell;
  rows.sort((a, b) => b.value - a.value);
  return {
    rows,
    coveragePct: total ? (covered / total) * 100 : 0,
    buyPct: sum ? (buy / sum) * 100 : null,
    holdPct: sum ? (hold / sum) * 100 : null,
    sellPct: sum ? (sell / sum) * 100 : null,
    verdict: !sum ? null : buy > hold + sell ? 'Bullish' : sell > buy ? 'Bearish' : 'Mixed',
  };
}

// Below this many days of stored daily value, anything derived from the return
// series is treated as unmeasured rather than as measured-and-calm.
//
// This matters more than it looks. analyse() reports volatility 0 and drawdown 0
// for an empty or one-point series, which is indistinguishable from a genuinely
// placid book — so without this guard a brand-new, entirely concentrated equity
// portfolio scores 0 and the dial prints "Conservative" over it on day one. A
// portfolio with no history is unmeasured, not riskless, and the single worst
// thing this gauge could do is confuse the two. Concentration and growth share
// survive the guard because they are read from the holdings themselves and are
// true the moment the first position exists.
export const MIN_HISTORY_DAYS = 20;

// Fold everything the risk tab needs into one call, so the component stays dumb.
export function riskProfile({ stats = {}, conc = {}, alloc = null }) {
  // A caller that hands over raw inputs (no `days` field) is trusted as-is; only
  // a real analyse() result, which always reports days, gets gated.
  const enough = !Number.isFinite(stats.days) || stats.days >= MIN_HISTORY_DAYS;
  const hist = v => (enough ? v : null);

  const growthPct = (() => {
    if (!alloc?.total) return null;
    const growthLabels = new Set(['Equity', 'Equity ETF', 'Crypto']);
    const g = alloc.byClass.filter(s => growthLabels.has(s.label)).reduce((s, x) => s + x.value, 0);
    return (g / alloc.total) * 100;
  })();

  const inputs = {
    volatility: hist(stats.volatility),
    maxDD: hist(stats.maxDD ?? stats.drawdown?.maxDD),
    effectiveN: conc.effectiveN,
    growthPct,
    beta: hist(stats.beta),
    sharpe: hist(stats.sharpe),
    benchMaxDD: hist(stats.benchMaxDD),
    // analyse() nests these two; accept either shape so the whole output of
    // analyse() can be handed over untouched.
    winRate: hist(stats.winRate ?? stats.consistency?.winRate),
    excessCagr: enough && Number.isFinite(stats.cagr) && Number.isFinite(stats.benchCagr) ? stats.cagr - stats.benchCagr : null,
    days: stats.days ?? null,
    enoughHistory: enough,
  };

  const risk = riskScore(inputs);
  return {
    inputs,
    risk,
    health: healthScore(inputs),
    placement: placement(risk.score),
  };
}
