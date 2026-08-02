// Intrinsic value — four models that each answer "what is this worth" from the
// cash it produces, rather than from what the market has been paying for it.
//
// This is the companion to fairvalue.js and the distinction between them is the
// reason both exist. fairvalue.js is RELATIVE: it takes the multiple this market
// has paid for this company and asks where today sits in that range. That is a
// useful question and a limited one — a stock that was expensive for a decade
// has an expensive median, and measuring against it says "normal" when it means
// "normally expensive". This file is ABSOLUTE: it discounts future cash back to
// today and never once consults the share price to do it. The price only enters
// at the very end, to compute the gap.
//
// Neither is the truth. Run both; when they disagree, the disagreement is the
// information.
//
// Five decisions, and they are the same shape as fairvalue.js's because the same
// temptations apply:
//
// 1. EVERY INPUT IS TYPED IN BY HAND AND SAYS SO. There is no free feed for free
//    cash flow, book value or a growth estimate at this price point, and there is
//    certainly no feed for the discount rate — that one is a judgement, not a
//    fact, and no data provider could supply it. So nothing here is auto-filled
//    from a source that does not exist.
//
// 2. THE OUTPUT IS A RANGE, NEVER A NUMBER. A DCF that prints "₹1,847" invites
//    you to believe the seventh rupee. Change the discount rate by one point and
//    that figure moves fifteen percent. So every model runs three times — bear,
//    base, bull — and the screen leads with the spread. If the bear and bull
//    cases straddle the current price, the honest reading is that the model
//    cannot tell you anything, and it says so instead of leaning on the base.
//
// 3. MATHEMATICALLY INVALID IS A REFUSAL, NOT A BIG NUMBER. When the terminal
//    growth rate meets or exceeds the discount rate, the Gordon terminal value
//    divides by zero or goes negative — which is not an infinitely valuable
//    company, it is the arithmetic saying you have assumed a business that
//    outgrows the economy forever. Those cases return a stated refusal. Same for
//    a DDM on a company that pays no dividend, and a DCF on negative cash flow.
//
// 4. THE ARITHMETIC IS RETURNED, NOT JUST THE ANSWER. Each model hands back its
//    per-year cash flows, discount factors and present values so the screen can
//    show the working. A valuation you cannot check is a valuation you are
//    trusting on my authority, and I have no authority here.
//
// 5. NOTHING HERE IS ADVICE. A margin of safety is a subtraction, not a
//    recommendation, and "the model says cheap" is a statement about the inputs
//    that were typed in — change the growth rate and it says the opposite. I am
//    not a licensed adviser and this file does not become one by having good
//    arithmetic in it.

// Same guard as fairvalue.js and sentiment.js, repeated rather than shared for
// the same reason: `+null`, `+''` and `+false` are all 0, and in a discount model
// the difference between "no growth assumption" and "assumes zero growth" is the
// difference between a refusal and a valuation.
export function num(v) {
  if (v === null || v === undefined || typeof v === 'boolean') return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  const n = +v;
  return Number.isFinite(n) ? n : null;
}

// ---------- limits ----------

// Ten years of explicit projection. Not because ten is correct — nobody can
// forecast a decade of cash flow — but because it is the convention, and beyond
// it the terminal value dominates so completely that adding years is theatre.
// The screen prints what fraction of the answer is terminal value precisely so
// this can be seen rather than assumed.
export const MAX_YEARS = 20;
export const DEFAULT_YEARS = 10;

// A growth rate above this is almost certainly a typo — 500% entered where 5.00
// was meant. Refused rather than compounded, because compounding a typo for ten
// years produces a number with enough zeroes to look like a different unit.
export const GROWTH_CAP = 100;      // percent per year
export const RATE_CAP = 60;         // discount rate percent

// ---------- scenarios ----------

// Bear, base and bull are not three separate opinions — they are one opinion
// with the two most sensitive inputs moved. Growth down and discount rate up
// together is the bear case, because those are the two knobs that actually move
// a DCF, and moving them independently understates how wrong the thing can be.
export const SCENARIOS = [
  { key: 'bear', label: 'BEAR', color: 'var(--red)',
    growthAdj: -1, rateAdj: +1,
    note: 'Growth cut, discount rate raised. What the business is worth if it disappoints and money gets dearer.' },
  { key: 'base', label: 'BASE', color: 'var(--cyan)',
    growthAdj: 0, rateAdj: 0,
    note: 'Your inputs, unmodified.' },
  { key: 'bull', label: 'BULL', color: 'var(--green)',
    growthAdj: +1, rateAdj: -1,
    note: 'Growth raised, discount rate cut. Requires both to go your way at once.' },
];

// How far the bear and bull cases move. A third of the growth rate is a real
// disappointment without being a catastrophe, and two points of discount rate is
// roughly what a genuine change in the rate environment looks like.
export const SPREAD = { growthPct: 1 / 3, ratePoints: 2 };

/** The (growth, rate) pair a scenario actually runs with. */
export function scenarioInputs(growth, rate, scenario) {
  const s = SCENARIOS.find(x => x.key === scenario) || SCENARIOS[1];
  const g = num(growth), r = num(rate);
  if (g === null || r === null) return null;
  return {
    growth: g + s.growthAdj * Math.abs(g) * SPREAD.growthPct,
    rate: r + s.rateAdj * SPREAD.ratePoints,
    scenario: s,
  };
}

// ---------- the models ----------

export const MODELS = [
  {
    key: 'dcf',
    label: 'Advanced DCF',
    short: 'DCF',
    blurb: 'Two-stage discounted cash flow. Projects free cash flow at a high rate, fades it to a terminal rate, discounts everything back.',
    needs: ['fcf', 'growth', 'growth2', 'terminal', 'rate'],
    best: 'Companies with positive, reasonably steady free cash flow.',
  },
  {
    key: 'sdcf',
    label: 'Simple DCF',
    short: 'sDCF',
    blurb: 'One growth rate for the projection window, then a perpetuity. Fewer assumptions, so fewer places to be precisely wrong.',
    needs: ['fcf', 'growth', 'terminal', 'rate'],
    best: 'A sanity check on the advanced model. If they disagree wildly, the fade assumption is doing the work.',
  },
  {
    key: 'graham',
    label: 'Ben Graham',
    short: 'GRAHAM',
    blurb: 'Graham\'s revised 1974 formula: EPS × (8.5 + 2g) × 4.4 ÷ Y. A rule of thumb from before computers, not a cash-flow model.',
    needs: ['eps', 'growth', 'bond'],
    best: 'Stable, profitable, boring companies. Graham himself warned it was not meant for precision.',
  },
  {
    key: 'ddm',
    label: 'Dividend Discount',
    short: 'DDM',
    blurb: 'Gordon growth: next year\'s dividend divided by (discount rate − growth). Values the company purely on what it pays you.',
    needs: ['dividend', 'growth', 'rate'],
    best: 'Established dividend payers with a long, steady raise history. Useless for anything that pays nothing.',
  },
];

export const modelMeta = k => MODELS.find(m => m.key === k) || MODELS[0];

// Every input the four models between them consume, with the units spelled out.
// The unit is on the label because "growth: 12" is ambiguous and a DCF run at
// 1200% produces a number that looks like a valuation.
export const INPUTS = {
  fcf: { label: 'Free cash flow / share', unit: '₹', step: 0.01,
    hint: 'Operating cash flow minus capital expenditure, divided by diluted shares. Not net income.' },
  eps: { label: 'Earnings / share', unit: '₹', step: 0.01,
    hint: 'Trailing twelve months, as published.' },
  dividend: { label: 'Dividend / share', unit: '₹', step: 0.01,
    hint: 'Declared over the last twelve months. This is D₀ — the model grows it one year itself.' },
  growth: { label: 'Growth, years 1–5', unit: '%/yr', step: 0.5,
    hint: 'Your estimate of annual growth in the driver above. This is the single most sensitive input on the screen.' },
  growth2: { label: 'Growth, years 6–10', unit: '%/yr', step: 0.5,
    hint: 'The fade. Almost every company grows more slowly at ten years out than at two.' },
  terminal: { label: 'Terminal growth', unit: '%/yr', step: 0.1,
    hint: 'Growth forever, after the projection ends. Must be below the discount rate, and above long-run GDP growth it implies the company eventually becomes the economy.' },
  rate: { label: 'Discount rate', unit: '%', step: 0.5,
    hint: 'Your required return — what you want for taking this risk instead of holding a government bond. A judgement, not a fact.' },
  bond: { label: 'AAA bond yield', unit: '%', step: 0.1,
    hint: 'Graham\'s formula normalises against the corporate bond yield. In India the 10-year G-sec is the usual stand-in.' },
  shares: { label: 'Diluted shares', unit: 'cr', step: 0.01,
    hint: 'Only needed if you enter company-wide cash flow rather than per-share.' },
  netCash: { label: 'Net cash / share', unit: '₹', step: 0.01,
    hint: 'Cash and equivalents minus total debt, per share. Added to the discounted cash flows; negative for a leveraged company.' },
};

// ---------- shared arithmetic ----------

/** Present value of `amount` received `year` years out at `ratePct` per annum. */
export function discount(amount, ratePct, year) {
  const a = num(amount), r = num(ratePct), y = num(year);
  if (a === null || r === null || y === null) return null;
  return a / Math.pow(1 + r / 100, y);
}

/**
 * Gordon terminal value: the value AT the end of the projection of everything
 * after it. Returns null when the growth rate meets or exceeds the discount
 * rate — see decision 3. That is not a failure to compute, it is the only
 * correct answer, because the sum genuinely does not converge.
 */
export function terminalValue(lastCashFlow, ratePct, terminalPct) {
  const cf = num(lastCashFlow), r = num(ratePct), g = num(terminalPct);
  if (cf === null || r === null || g === null) return null;
  if (g >= r) return null;
  return (cf * (1 + g / 100)) / ((r - g) / 100);
}

/** Shared input validation. Returns a refusal string, or null when all is well. */
function checkRates(rate, terminal, growths) {
  const r = num(rate);
  if (r === null) return 'No discount rate has been set. Without one there is nothing to discount by, and the model cannot guess your required return.';
  if (r <= 0) return `A discount rate of ${r}% means future rupees are worth as much as or more than present ones. Set a rate above zero.`;
  if (r > RATE_CAP) return `A discount rate of ${r}% is almost certainly a typo. If you genuinely require that return, no discounted model will produce a meaningful number.`;
  for (const g of growths) {
    const v = num(g);
    if (v !== null && Math.abs(v) > GROWTH_CAP) {
      return `A growth rate of ${v}% per year compounds to an absurd figure over the projection. Check whether ${v} was meant to be ${(v / 100).toFixed(2)}.`;
    }
  }
  const t = num(terminal);
  if (t !== null && t >= r) {
    return `Terminal growth (${t}%) is not below the discount rate (${r}%). The perpetuity then diverges — the arithmetic is telling you that you have assumed a company which outgrows its cost of capital forever, which no company does. Lower the terminal growth or raise the discount rate.`;
  }
  return null;
}

// ---------- 1. advanced two-stage DCF ----------

/**
 * Free cash flow grows at `growth` for the first half of the window and at
 * `growth2` for the second, then a Gordon perpetuity at `terminal`. Everything
 * discounted at `rate`. Net cash is added at the end, undiscounted, because it
 * already exists today.
 */
export function advancedDCF({
  fcf, growth, growth2, terminal, rate, years = DEFAULT_YEARS, netCash = 0,
} = {}) {
  const cf0 = num(fcf);
  if (cf0 === null) return { ok: false, reason: 'No free cash flow per share has been entered.' };
  if (cf0 <= 0) {
    return { ok: false, reason: `Free cash flow per share is ${cf0}. A company burning cash cannot be valued by discounting the cash it produces — the model would return a negative number and call it a valuation. Use book value or revenue multiples instead.` };
  }

  const g1 = num(growth), g2 = num(growth2) ?? num(growth), t = num(terminal), r = num(rate);
  if (g1 === null) return { ok: false, reason: 'No growth rate has been entered for the first stage.' };
  const bad = checkRates(r, t, [g1, g2]);
  if (bad) return { ok: false, reason: bad };

  const n = Math.max(1, Math.min(MAX_YEARS, Math.round(num(years) ?? DEFAULT_YEARS)));
  const split = Math.ceil(n / 2);

  const rows = [];
  let cf = cf0;
  let pvSum = 0;
  for (let y = 1; y <= n; y++) {
    const g = y <= split ? g1 : g2;
    cf = cf * (1 + g / 100);
    const df = 1 / Math.pow(1 + r / 100, y);
    const pv = cf * df;
    pvSum += pv;
    rows.push({ year: y, growth: g, cashFlow: cf, factor: df, pv });
  }

  const tv = terminalValue(cf, r, t);
  if (tv === null) {
    return { ok: false, reason: `Terminal growth (${t}%) is not below the discount rate (${r}%), so the perpetuity does not converge.` };
  }
  const tvPV = tv / Math.pow(1 + r / 100, n);
  const cash = num(netCash) ?? 0;
  const value = pvSum + tvPV + cash;

  return {
    ok: true, model: 'dcf', rows,
    pvExplicit: pvSum,
    terminal: tv, terminalPV: tvPV,
    // What fraction of the answer is the guess about forever. Printed on screen
    // because a DCF that is 85% terminal value is not really a cash-flow model,
    // it is a perpetuity with a decade of decoration in front of it.
    terminalShare: value !== 0 ? tvPV / value : null,
    netCash: cash,
    value,
    years: n, split,
  };
}

// ---------- 2. simple DCF ----------

/** One growth rate throughout, then the same Gordon perpetuity. */
export function simpleDCF({ fcf, growth, terminal, rate, years = DEFAULT_YEARS, netCash = 0 } = {}) {
  const r = advancedDCF({ fcf, growth, growth2: growth, terminal, rate, years, netCash });
  return r.ok ? { ...r, model: 'sdcf' } : r;
}

// ---------- 3. Ben Graham, revised ----------

// V = EPS × (8.5 + 2g) × 4.4 ÷ Y
//
// 8.5 was Graham's base multiple for a no-growth company. The 2g doubles the
// growth rate into the multiple. 4.4 was the AAA corporate bond yield when he
// wrote it, and dividing by today's yield normalises for the rate environment.
//
// It is a rule of thumb from 1974 and it behaves like one: the 2g term is
// linear, so a 20% grower gets a multiple of 48.5, which is not a claim anyone
// should lean on. Graham warned about this himself. It stays in because it is
// fast, because it disagrees with the DCF in informative ways, and because
// dividenddata.com shows it — but the caveat travels with the number.
export const GRAHAM_BASE = 8.5;
export const GRAHAM_BOND_NORM = 4.4;

export function grahamValue({ eps, growth, bond } = {}) {
  const e = num(eps);
  if (e === null) return { ok: false, reason: 'No earnings per share has been entered.' };
  if (e <= 0) {
    return { ok: false, reason: `Earnings per share is ${e}. The formula multiplies EPS by a positive multiple, so a loss produces a negative "value" — which means the formula does not apply, not that the company is worth less than nothing.` };
  }
  const g = num(growth);
  if (g === null) return { ok: false, reason: 'No growth rate has been entered.' };
  if (Math.abs(g) > GROWTH_CAP) return { ok: false, reason: `A growth rate of ${g}% is out of range for this formula.` };

  const y = num(bond);
  if (y === null) return { ok: false, reason: 'No bond yield has been entered. The formula normalises against it, so there is no sensible default.' };
  if (y <= 0) return { ok: false, reason: `A bond yield of ${y}% would divide by zero or flip the sign. Enter the current yield.` };

  const multiple = GRAHAM_BASE + 2 * g;
  if (multiple <= 0) {
    return { ok: false, reason: `A growth rate of ${g}% gives a multiple of ${multiple.toFixed(1)}, which is not a multiple. The formula assumes growth above −4.25%/yr.` };
  }
  const value = (e * multiple * GRAHAM_BOND_NORM) / y;
  return {
    ok: true, model: 'graham',
    eps: e, growth: g, bond: y,
    multiple,
    // The normalisation shown separately, because it is doing a lot of work: at
    // a 7% bond yield the whole answer is scaled by 0.63.
    bondAdj: GRAHAM_BOND_NORM / y,
    value,
  };
}

// ---------- 4. dividend discount (Gordon growth) ----------

export function dividendDiscount({ dividend, growth, rate } = {}) {
  const d0 = num(dividend);
  if (d0 === null) return { ok: false, reason: 'No dividend per share has been entered.' };
  if (d0 <= 0) {
    return { ok: false, reason: 'This model values a company purely by what it pays out, so a company paying nothing values at zero — which is a statement about the model, not about the company. Use a cash-flow model instead.' };
  }
  const g = num(growth), r = num(rate);
  if (g === null) return { ok: false, reason: 'No dividend growth rate has been entered.' };
  const bad = checkRates(r, g, [g]);
  if (bad) return { ok: false, reason: bad };

  const d1 = d0 * (1 + g / 100);
  const value = d1 / ((r - g) / 100);
  return {
    ok: true, model: 'ddm',
    d0, d1, growth: g, rate: r,
    // How sensitive this is to the spread. When r − g is one point the value is
    // a hundred times the dividend, and a quarter-point change in either input
    // moves it by a third. Printed so that fragility is visible.
    spread: r - g,
    value,
  };
}

// ---------- dispatch ----------

export function runModel(model, inputs) {
  switch (model) {
    case 'dcf': return advancedDCF(inputs);
    case 'sdcf': return simpleDCF(inputs);
    case 'graham': return grahamValue(inputs);
    case 'ddm': return dividendDiscount(inputs);
    default: return { ok: false, reason: `Unknown model "${model}".` };
  }
}

/** All three scenarios of one model. Order is always bear, base, bull. */
export function runScenarios(model, inputs) {
  return SCENARIOS.map(s => {
    const adj = scenarioInputs(inputs.growth, inputs.rate ?? inputs.bond, s.key);
    const next = { ...inputs };
    if (adj) {
      next.growth = adj.growth;
      // Graham has no discount rate; its rate-shaped input is the bond yield,
      // and a HIGHER yield is the bear case there too — it divides the answer.
      if (model === 'graham') next.bond = adj.rate;
      else next.rate = adj.rate;
      // The second-stage growth fades with the first, otherwise the bear case
      // cuts near-term growth and leaves the out-years untouched, which is not
      // a coherent story about a business disappointing.
      if (num(inputs.growth2) !== null) {
        next.growth2 = inputs.growth2 + s.growthAdj * Math.abs(inputs.growth2) * SPREAD.growthPct;
      }
    }
    return { scenario: s, inputs: next, result: runModel(model, next) };
  });
}

// ---------- the gap ----------

/**
 * Margin of safety: how far below the estimated value the price sits, as a
 * fraction OF THE VALUE. Deliberately not "upside from here", which is the same
 * two numbers divided the other way round and always looks larger — a stock at
 * half its estimated value has a 50% margin of safety and 100% upside, and the
 * second framing is the one that sells newsletters.
 */
export function marginOfSafety(value, price) {
  const v = num(value), p = num(price);
  if (v === null || p === null || v <= 0) return null;
  return ((v - p) / v) * 100;
}

/** Upside, stated separately and named, so the two are never confused. */
export function upside(value, price) {
  const v = num(value), p = num(price);
  if (v === null || p === null || p <= 0) return null;
  return ((v - p) / p) * 100;
}

/**
 * What the three scenarios together are entitled to say. Decision 2 lives here:
 * when the price falls inside the bear→bull range, the model has not identified
 * anything, and the honest output says so rather than quoting the base case as
 * though the range were decoration.
 */
export function readRange(scenarios, price) {
  const ok = (scenarios || []).filter(s => s.result && s.result.ok);
  if (!ok.length) return null;
  const values = ok.map(s => s.result.value);
  const lo = Math.min(...values), hi = Math.max(...values);
  const base = ok.find(s => s.scenario.key === 'base')?.result?.value ?? null;
  const p = num(price);
  if (p === null) {
    return { lo, hi, base, price: null, verdict: 'no_price',
      headline: 'No price loaded, so there is nothing to compare the range against.' };
  }

  const straddles = p >= lo && p <= hi;
  if (straddles) {
    return {
      lo, hi, base, price: p, verdict: 'inconclusive',
      headline: 'The price sits inside the bear–bull range, so these assumptions do not distinguish cheap from expensive.',
      detail: `Bear ₹${lo.toFixed(0)} and bull ₹${hi.toFixed(0)} straddle today's ₹${p.toFixed(0)}. That is the model working correctly and telling you it cannot call this one — quoting the base case here would be reading precision into a spread that does not have any.`,
    };
  }
  // `<` rather than `<=` is not a boundary decision here — it cannot be one.
  // The straddle test above already returned for every p in [lo, hi], so by this
  // line p is strictly outside the range and the two comparisons agree. Written
  // as `<` because that is what is meant; a mutation to `<=` is unreachable.
  const below = p < lo;
  return {
    lo, hi, base, price: p,
    verdict: below ? 'below_range' : 'above_range',
    headline: below
      ? 'The price sits below even the bear case for these assumptions.'
      : 'The price sits above even the bull case for these assumptions.',
    detail: below
      ? `Every scenario values this above ₹${p.toFixed(0)}, the lowest at ₹${lo.toFixed(0)}. Worth asking what the market knows that these inputs do not — a price below a pessimistic model usually means the inputs are stale, not that the market is wrong.`
      : `Every scenario values this below ₹${p.toFixed(0)}, the highest at ₹${hi.toFixed(0)}. Either growth beyond what was entered is expected, or the price includes something these inputs do not capture.`,
  };
}

// ---------- sensitivity ----------

/**
 * The grid dividenddata.com shows, and the most useful single object here: value
 * at every combination of discount rate and terminal growth in a band around the
 * inputs. It exists because the point that a DCF is an opinion held loosely is
 * made far better by a table where the corners differ threefold than by any
 * sentence warning about it.
 */
export function sensitivityGrid(model, inputs, { rateSteps = 5, growthSteps = 5, rateStep = 1, growthStep = 0.25 } = {}) {
  const r0 = num(inputs.rate), t0 = num(inputs.terminal);
  if (r0 === null || t0 === null) return null;
  const half = (n) => Math.floor(n / 2);
  const rates = Array.from({ length: rateSteps }, (_, i) => r0 + (i - half(rateSteps)) * rateStep);
  const terms = Array.from({ length: growthSteps }, (_, i) => t0 + (i - half(growthSteps)) * growthStep);
  const cells = rates.map(r => terms.map(t => {
    const res = runModel(model, { ...inputs, rate: r, terminal: t });
    return { rate: r, terminal: t, value: res.ok ? res.value : null, reason: res.ok ? null : res.reason };
  }));
  return { rates, terms, cells };
}

// ---------- storage ----------

// Zero-migration rule, same as fairvalue.js: one memory row, a flat map keyed by
// ticker and model, so switching models cannot overwrite another model's inputs.
export const IV_MEMORY_KEY = 'iv_inputs';

export const inputKey = (ticker, model) =>
  `iv:${String(ticker || '').toUpperCase()}:${model}`;

export function readInputs(blob, ticker, model) {
  const v = blob && blob[inputKey(ticker, model)];
  return v && typeof v === 'object' ? { ...v } : {};
}

export function writeInputs(blob, ticker, model, inputs) {
  const next = { ...(blob || {}) };
  const k = inputKey(ticker, model);
  const clean = {};
  for (const [field, val] of Object.entries(inputs || {})) {
    const n = num(val);
    if (n !== null) clean[field] = n;
  }
  if (Object.keys(clean).length) next[k] = clean; else delete next[k];
  return next;
}

export const DISCLAIMER =
  'Every figure on this screen is typed in by hand, including the growth and discount rates, which are judgements rather than data. '
  + 'The output is a range because the inputs are estimates, and a change of one percentage point in the discount rate moves it materially. '
  + 'This is arithmetic you can check, not investment advice.';
