// Tests for intrinsic.js — the four absolute valuation models.
//
// Run: bun tests/intrinsic.test.js
//
// The reason this file is unusually literal: a discounting bug does not throw
// and does not produce a silly number. Compound at the wrong rate, apply the
// discount factor one year off, or fade growth in the wrong half of the window,
// and the model returns a plausible valuation — a number in the right order of
// magnitude, formatted nicely, sitting next to a share price. Nothing about the
// screen looks wrong. So every headline figure here is a literal I computed by
// hand on paper first, NOT a value copied out of a passing run. If the
// implementation changes its arithmetic these numbers stop matching, which is
// the whole point; re-deriving the expectation from the code would pin the text
// rather than the behaviour and this suite would be decorative.
//
// The four anchors, worked out longhand:
//
//   DDM      D₀ 20 at 6% growth, 10% required → D₁ = 21.20, spread 4 points,
//            21.20 / 0.04 = 530.00 exactly.
//
//   GRAHAM   EPS 50, growth 8, bond 7 → multiple 8.5 + 16 = 24.5,
//            50 × 24.5 × 4.4 / 7 = 5390 / 7 = 770.00 exactly.
//
//   DCF      FCF 10, 12% for years 1–5, 6% for 6–10, 3% terminal, 10% discount.
//            Year 10 cash flow 23.5841; terminal 23.5841 × 1.03 / 0.07 =
//            347.023; discounted by 1.1¹⁰ = 2.593742 → 133.786. The ten
//            explicit years present-value to 101.821. Total 235.61, of which
//            133.786 / 235.607 = 56.8% is terminal value.
//
//   RANGE    Those same inputs run bear/base/bull give roughly 144 / 236 / 428,
//            so a price of 150 sits inside the band and the correct output is a
//            refusal to call it, not the base case.

import {
  num, discount, terminalValue,
  advancedDCF, simpleDCF, grahamValue, dividendDiscount, runModel, runScenarios,
  scenarioInputs, marginOfSafety, upside, readRange, sensitivityGrid,
  SCENARIOS, SPREAD, MODELS, modelMeta, GRAHAM_BASE, GRAHAM_BOND_NORM,
  MAX_YEARS, DEFAULT_YEARS, GROWTH_CAP, RATE_CAP,
  IV_MEMORY_KEY, inputKey, readInputs, writeInputs, DISCLAIMER,
} from '../src/lib/intrinsic.js';

let pass = 0, fail = 0;
function ok(what, cond, got) {
  if (cond) { pass++; }
  else { fail++; console.log(`FAIL: ${what}${got !== undefined ? `  (got ${got})` : ''}`); }
}
const near = (a, b, eps = 0.01) => Number.isFinite(a) && Math.abs(a - b) < eps;

// The DCF fixture, named once. Every DCF assertion below refers to it, so the
// hand-worked arithmetic in the header applies to all of them.
const DCF = { fcf: 10, growth: 12, growth2: 6, terminal: 3, rate: 10, years: 10 };

// ----------------------------------------------------------- the num() guard
{
  ok('num passes a number through', num(12.5) === 12.5);
  ok('num parses a numeric string', num('7.25') === 7.25);
  ok('num rejects null', num(null) === null);
  ok('num rejects undefined', num(undefined) === null);
  ok('num rejects the empty string', num('') === null);
  ok('num rejects a whitespace string', num('   ') === null);
  ok('num rejects booleans', num(false) === null && num(true) === null);
  ok('num rejects a non-numeric string', num('abc') === null);
  ok('num rejects Infinity', num(Infinity) === null);
  // This is the distinction the guard exists for. Every one of the rejected
  // values above coerces to 0 under `+v`, and a growth rate of "unset" reaching
  // a DCF as "zero percent" is a valuation, not a refusal.
  ok('num keeps a real zero', num(0) === 0);
  ok('num keeps a real negative', num(-4.4) === -4.4);
}

// ------------------------------------------------------- discount / terminal
{
  // 100 two years out at 10% is 100 / 1.21. Written as the division rather than
  // as 82.6446 so the intent survives a reader who wonders where it came from.
  ok('discount is division by (1+r)^y', near(discount(100, 10, 2), 100 / 1.21, 1e-9));
  ok('discount at year 0 is the amount itself', discount(100, 10, 0) === 100);
  ok('discount at zero rate is the amount itself', discount(100, 0, 5) === 100);
  ok('discount refuses a missing rate', discount(100, null, 2) === null);

  // Gordon: CF × (1+g) / (r−g). 100 at 3% terminal, 10% discount → 103 / 0.07.
  ok('terminalValue grows the cash flow one year before capitalising',
    near(terminalValue(100, 10, 3), 103 / 0.07, 1e-6), terminalValue(100, 10, 3));

  // Decision 3, at the boundary and just inside it. The equality case is the one
  // that matters: at g === r the denominator is exactly zero, and JavaScript
  // returns Infinity rather than throwing, so a `>` here instead of `>=` yields
  // a company of infinite value and no error anywhere.
  ok('terminal growth equal to the discount rate is refused', terminalValue(100, 10, 10) === null);
  ok('terminal growth above the discount rate is refused', terminalValue(100, 10, 12) === null);
  ok('terminal growth just below is allowed', terminalValue(100, 10, 9.99) !== null);
  ok('and the allowed case is a real number, not Infinity',
    Number.isFinite(terminalValue(100, 10, 9.99)));
}

// -------------------------------------------------------------- 1. DCF
{
  const r = advancedDCF(DCF);
  ok('the DCF computes', r.ok === true, r.reason);
  ok('the DCF values at 235.61', near(r.value, 235.61, 0.01), r.value && r.value.toFixed(4));
  ok('the ten explicit years present-value to 101.82', near(r.pvExplicit, 101.82, 0.01), r.pvExplicit);
  ok('the terminal value is 347.02', near(r.terminal, 347.02, 0.01), r.terminal);
  ok('discounted, the terminal is 133.79', near(r.terminalPV, 133.79, 0.01), r.terminalPV);
  ok('56.8% of the answer is terminal value', near(r.terminalShare * 100, 56.8, 0.05),
    r.terminalShare && (r.terminalShare * 100).toFixed(3));

  // The three parts must actually sum to the whole. Cheap, and it catches the
  // class of bug where a component is computed correctly and then added twice.
  ok('explicit + terminal + net cash = value',
    near(r.pvExplicit + r.terminalPV + r.netCash, r.value, 1e-9));

  ok('ten rows for ten years', r.rows.length === 10, r.rows.length);
  ok('the split falls after year 5', r.split === 5, r.split);

  // The fade. Years 1–5 grow at 12, years 6–10 at 6 — asserted on the row's own
  // stated growth AND on the cash flows, because the row could report one rate
  // and compound at another.
  ok('years 1-5 are stamped with the first-stage growth', r.rows.slice(0, 5).every(x => x.growth === 12));
  ok('years 6-10 are stamped with the second-stage growth', r.rows.slice(5).every(x => x.growth === 6));
  ok('year 1 cash flow is 10 grown once at 12%', near(r.rows[0].cashFlow, 11.2, 1e-9), r.rows[0].cashFlow);
  ok('year 5 cash flow is 10 × 1.12^5', near(r.rows[4].cashFlow, 10 * Math.pow(1.12, 5), 1e-9));
  ok('year 6 applies the SECOND rate to the fifth year, not the first',
    near(r.rows[5].cashFlow, 10 * Math.pow(1.12, 5) * 1.06, 1e-9), r.rows[5].cashFlow);
  ok('year 10 cash flow is 23.5841', near(r.rows[9].cashFlow, 23.5841, 0.0001), r.rows[9].cashFlow);

  // Discount factors, hand-typed. Year 1 is 1/1.1 and year 10 is 1/1.1^10; if
  // the loop were off by one the whole valuation would be 10% out and still
  // look entirely reasonable.
  ok('the year-1 factor is 1/1.1', near(r.rows[0].factor, 0.909091, 1e-6), r.rows[0].factor);
  ok('the year-10 factor is 1/1.1^10', near(r.rows[9].factor, 0.385543, 1e-6), r.rows[9].factor);
  ok('each row pv is its cash flow times its factor',
    r.rows.every(x => near(x.pv, x.cashFlow * x.factor, 1e-9)));

  // Net cash is added undiscounted — it exists today.
  const withCash = advancedDCF({ ...DCF, netCash: 50 });
  ok('net cash is added at face value, not discounted', near(withCash.value, r.value + 50, 1e-9),
    withCash.value - r.value);
  const withDebt = advancedDCF({ ...DCF, netCash: -30 });
  ok('negative net cash subtracts', near(withDebt.value, r.value - 30, 1e-9));

  // Year count.
  ok('the projection window is honoured', advancedDCF({ ...DCF, years: 5 }).rows.length === 5);
  ok('and clamped to MAX_YEARS', advancedDCF({ ...DCF, years: 999 }).rows.length === MAX_YEARS);
  ok('and never below one year', advancedDCF({ ...DCF, years: 0 }).rows.length === 1);
  ok('an odd window splits with the extra year in the first stage',
    advancedDCF({ ...DCF, years: 7 }).split === 4, advancedDCF({ ...DCF, years: 7 }).split);
}

// ----------------------------------------------------------- DCF refusals
{
  const noFcf = advancedDCF({ ...DCF, fcf: null });
  ok('a missing cash flow is refused', noFcf.ok === false);
  ok('and says what is missing', /free cash flow/i.test(noFcf.reason));

  const burning = advancedDCF({ ...DCF, fcf: -3 });
  ok('negative cash flow is refused rather than valued negative', burning.ok === false);
  ok('and the refusal explains why the model does not apply',
    /burning cash|negative/i.test(burning.reason), burning.reason);
  ok('a refusal carries no value field', burning.value === undefined);

  ok('zero cash flow is refused too', advancedDCF({ ...DCF, fcf: 0 }).ok === false);

  const noRate = advancedDCF({ ...DCF, rate: null });
  ok('a missing discount rate is refused', noRate.ok === false);
  ok('and does not silently assume one', /discount rate/i.test(noRate.reason));

  ok('a zero discount rate is refused', advancedDCF({ ...DCF, rate: 0 }).ok === false);
  ok('a negative discount rate is refused', advancedDCF({ ...DCF, rate: -5 }).ok === false);

  // Those two pass even with the rate guard removed, because a 3% terminal
  // growth is already >= a 0% rate and the terminal check refuses them a few
  // lines later. Pairing each with a terminal growth BELOW the rate is what
  // actually isolates the guard — and the case matters: at a 0% discount rate
  // every factor is 1 and the model returns the undiscounted sum of a decade of
  // cash flows, which is not a valuation, it is an addition.
  const zeroRate = advancedDCF({ ...DCF, rate: 0, terminal: -1 });
  ok('a zero discount rate is refused even when terminal growth is below it',
    zeroRate.ok === false, zeroRate.value);
  ok('and the refusal is about the rate, not the terminal growth',
    /future rupees/i.test(zeroRate.reason), zeroRate.reason);
  const negRate = advancedDCF({ ...DCF, rate: -5, terminal: -8 });
  ok('a negative discount rate is refused even when terminal growth is below it',
    negRate.ok === false, negRate.value);
  ok('the DDM applies the same rate guard', dividendDiscount({ dividend: 20, growth: -3, rate: 0 }).ok === false);
  ok('a discount rate above the cap is refused', advancedDCF({ ...DCF, rate: RATE_CAP + 1 }).ok === false);
  ok('a discount rate at the cap is allowed', advancedDCF({ ...DCF, rate: RATE_CAP, terminal: 3 }).ok === true);

  // The typo guard. 1200 entered for 12 compounds to something with the wrong
  // number of digits, and a decade of compounding hides the mistake behind a
  // number too large to sanity-check by eye.
  const typo = advancedDCF({ ...DCF, growth: 1200 });
  ok('an absurd growth rate is refused', typo.ok === false);
  ok('and the refusal suggests the decimal', /12\.00/.test(typo.reason), typo.reason);
  ok('growth exactly at the cap is allowed', advancedDCF({ ...DCF, growth: GROWTH_CAP }).ok === true);
  ok('a large NEGATIVE growth is refused too — the guard is on magnitude',
    advancedDCF({ ...DCF, growth: -(GROWTH_CAP + 1) }).ok === false);

  const diverges = advancedDCF({ ...DCF, terminal: 11 });
  ok('terminal growth above the discount rate is refused', diverges.ok === false);
  ok('and the message names both numbers so the fix is obvious',
    diverges.reason.includes('11%') && diverges.reason.includes('10%'), diverges.reason);
  ok('terminal growth EQUAL to the discount rate is refused',
    advancedDCF({ ...DCF, terminal: 10 }).ok === false);
}

// ------------------------------------------------------------ 2. simple DCF
{
  const s = simpleDCF({ fcf: 10, growth: 12, terminal: 3, rate: 10, years: 10 });
  ok('the simple DCF computes', s.ok === true, s.reason);
  ok('it labels itself sdcf, not dcf', s.model === 'sdcf', s.model);
  ok('every year grows at the one rate', s.rows.every(x => x.growth === 12));

  // The equivalence that justifies delegating: the advanced model with both
  // stages set the same IS the simple model. If they ever diverge, one of them
  // has grown a stage-specific behaviour that the other lacks.
  const a = advancedDCF({ fcf: 10, growth: 12, growth2: 12, terminal: 3, rate: 10, years: 10 });
  ok('it equals the advanced model with both stages identical', near(s.value, a.value, 1e-9),
    `${s.value} vs ${a.value}`);

  // …and it must NOT equal the faded one, or the fade is doing nothing.
  ok('and it does NOT equal the faded model', !near(s.value, advancedDCF(DCF).value, 1));

  const bad = simpleDCF({ fcf: -1, growth: 12, terminal: 3, rate: 10 });
  ok('a refusal passes through without being relabelled', bad.ok === false && bad.model === undefined);
}

// --------------------------------------------------------------- 3. Graham
{
  const g = grahamValue({ eps: 50, growth: 8, bond: 7 });
  ok('Graham computes', g.ok === true, g.reason);
  ok('Graham values at 770.00 — 50 × 24.5 × 4.4 / 7', near(g.value, 770, 1e-9), g.value);
  ok('the multiple is 8.5 + 2g', g.multiple === 24.5, g.multiple);
  ok('the bond adjustment is 4.4 / y', near(g.bondAdj, 4.4 / 7, 1e-12), g.bondAdj);
  ok('the constants are Graham\'s', GRAHAM_BASE === 8.5 && GRAHAM_BOND_NORM === 4.4);

  // A second, independent anchor at the no-growth point, where the whole formula
  // collapses to EPS × 8.5 × 4.4 / 4.4 = EPS × 8.5. Chosen because a bug in the
  // 2g term is invisible at one growth rate and obvious across two.
  const flat = grahamValue({ eps: 10, growth: 0, bond: 4.4 });
  ok('at zero growth and a 4.4% bond, Graham is exactly 8.5 × EPS',
    near(flat.value, 85, 1e-9), flat.value);

  // Doubling the bond yield halves the answer. States the normalisation as a
  // relationship rather than a third magic number.
  const y7 = grahamValue({ eps: 50, growth: 8, bond: 7 }).value;
  const y14 = grahamValue({ eps: 50, growth: 8, bond: 14 }).value;
  ok('doubling the bond yield halves the value', near(y14, y7 / 2, 1e-9), `${y7} → ${y14}`);

  ok('a loss-making company is refused', grahamValue({ eps: -2, growth: 8, bond: 7 }).ok === false);
  ok('zero EPS is refused', grahamValue({ eps: 0, growth: 8, bond: 7 }).ok === false);
  ok('a missing bond yield is refused rather than defaulted',
    grahamValue({ eps: 50, growth: 8 }).ok === false);
  ok('a zero bond yield is refused — it would divide by zero',
    grahamValue({ eps: 50, growth: 8, bond: 0 }).ok === false);
  ok('a missing growth rate is refused', grahamValue({ eps: 50, bond: 7 }).ok === false);

  // Below −4.25%/yr the multiple itself goes negative and the formula stops
  // meaning anything. That is a refusal, not a negative valuation.
  const deep = grahamValue({ eps: 50, growth: -10, bond: 7 });
  ok('growth low enough to make the multiple negative is refused', deep.ok === false, deep.value);
  ok('and the refusal names the multiple', /multiple/i.test(deep.reason));

  // The exact zero. At −4.25%/yr growth the multiple is 8.5 − 8.5 = 0, so the
  // formula returns a value of exactly zero — a company worth nothing, produced
  // by a multiple that has ceased to be a multiple. It has to be a refusal, and
  // only this fixture reaches it: every other negative-growth case gives a
  // negative multiple, which a plain `< 0` guard would also catch.
  const exactZero = grahamValue({ eps: 50, growth: -4.25, bond: 7 });
  ok('growth that makes the multiple exactly zero is refused', exactZero.ok === false, exactZero.value);
  ok('growth a hair above that is still allowed',
    grahamValue({ eps: 50, growth: -4.2, bond: 7 }).ok === true);
}

// ------------------------------------------------------------------ 4. DDM
{
  const d = dividendDiscount({ dividend: 20, growth: 6, rate: 10 });
  ok('the DDM computes', d.ok === true, d.reason);
  ok('the DDM values at 530.00 — 21.20 / 0.04', near(d.value, 530, 1e-9), d.value);
  ok('D1 is D0 grown one year', near(d.d1, 21.2, 1e-9), d.d1);
  ok('D0 is kept as entered', d.d0 === 20);
  ok('the spread is r − g', d.spread === 4, d.spread);

  // The fragility this model has and the screen warns about: a quarter point off
  // the discount rate moves the answer by more than 6% here, and by far more at
  // a narrower spread. Asserted as a relationship so it cannot be tuned away.
  const tight = dividendDiscount({ dividend: 20, growth: 9, rate: 10 });
  ok('a one-point spread values at a hundred times the dividend',
    near(tight.value, 21.8 / 0.01, 1e-6), tight.value);
  ok('narrowing the spread from 4 points to 1 more than triples the value',
    tight.value > d.value * 3);

  ok('a non-payer is refused rather than valued at zero',
    dividendDiscount({ dividend: 0, growth: 6, rate: 10 }).ok === false);
  ok('and the refusal says it is a fact about the model, not the company',
    /statement about the model/i.test(dividendDiscount({ dividend: 0, growth: 6, rate: 10 }).reason));
  ok('growth equal to the discount rate is refused', dividendDiscount({ dividend: 20, growth: 10, rate: 10 }).ok === false);
  ok('growth above the discount rate is refused', dividendDiscount({ dividend: 20, growth: 12, rate: 10 }).ok === false);
  ok('a missing dividend is refused', dividendDiscount({ growth: 6, rate: 10 }).ok === false);
}

// -------------------------------------------------------------- dispatch
{
  ok('runModel routes dcf', runModel('dcf', DCF).model === 'dcf');
  ok('runModel routes sdcf', runModel('sdcf', DCF).model === 'sdcf');
  ok('runModel routes graham', runModel('graham', { eps: 50, growth: 8, bond: 7 }).model === 'graham');
  ok('runModel routes ddm', runModel('ddm', { dividend: 20, growth: 6, rate: 10 }).model === 'ddm');
  const unknown = runModel('nope', {});
  ok('an unknown model is refused rather than falling through to a default',
    unknown.ok === false && /nope/.test(unknown.reason), unknown.reason);

  ok('MODELS has four entries', MODELS.length === 4, MODELS.length);
  ok('every model has a key, label, blurb and needs list',
    MODELS.every(m => m.key && m.label && m.blurb && Array.isArray(m.needs) && m.needs.length));
  ok('modelMeta finds each by key', MODELS.every(m => modelMeta(m.key).key === m.key));
  ok('modelMeta falls back rather than returning undefined', modelMeta('nope').key === MODELS[0].key);
  ok('the defaults are sane', DEFAULT_YEARS === 10 && MAX_YEARS === 20 && DEFAULT_YEARS <= MAX_YEARS);
}

// ------------------------------------------------------------- scenarios
{
  ok('there are exactly three scenarios', SCENARIOS.length === 3);
  ok('and they are ordered bear, base, bull',
    SCENARIOS.map(s => s.key).join(',') === 'bear,base,bull', SCENARIOS.map(s => s.key).join(','));
  ok('the base case adjusts nothing', SCENARIOS[1].growthAdj === 0 && SCENARIOS[1].rateAdj === 0);
  // The signs are the whole model of what "bear" means. Flipped, the bear case
  // is the optimistic one and the range still looks like a range.
  ok('bear cuts growth and raises the rate', SCENARIOS[0].growthAdj === -1 && SCENARIOS[0].rateAdj === +1);
  ok('bull raises growth and cuts the rate', SCENARIOS[2].growthAdj === +1 && SCENARIOS[2].rateAdj === -1);
  ok('the spread is a third of growth and two points of rate',
    SPREAD.growthPct === 1 / 3 && SPREAD.ratePoints === 2);

  // Hand-computed: 12% growth cut by a third is 8%; 10% rate plus two points is
  // 12%. Typed as literals rather than as `12 - 12 * SPREAD.growthPct`, which
  // would move with the constant and assert nothing.
  const bear = scenarioInputs(12, 10, 'bear');
  ok('bear moves 12% growth to 8%', near(bear.growth, 8, 1e-9), bear.growth);
  ok('bear moves a 10% rate to 12%', near(bear.rate, 12, 1e-9), bear.rate);
  const bull = scenarioInputs(12, 10, 'bull');
  ok('bull moves 12% growth to 16%', near(bull.growth, 16, 1e-9), bull.growth);
  ok('bull moves a 10% rate to 8%', near(bull.rate, 8, 1e-9), bull.rate);
  const base = scenarioInputs(12, 10, 'base');
  ok('base leaves both alone', base.growth === 12 && base.rate === 10);

  // Magnitude, not sign: a company already shrinking should shrink FURTHER in
  // the bear case, not head back towards zero.
  const negBear = scenarioInputs(-6, 10, 'bear');
  ok('a negative growth rate gets more negative in the bear case', near(negBear.growth, -8, 1e-9), negBear.growth);
  ok('an unknown scenario key falls back to base rather than throwing',
    scenarioInputs(12, 10, 'sideways').growth === 12);
  ok('missing inputs give null rather than a scenario built on nothing',
    scenarioInputs(null, 10, 'bear') === null);
}

// --------------------------------------------------------- runScenarios
{
  const runs = runScenarios('dcf', DCF);
  ok('three runs come back', runs.length === 3);
  ok('in bear, base, bull order', runs.map(r => r.scenario.key).join(',') === 'bear,base,bull');
  ok('the base run reproduces the plain model exactly',
    near(runs[1].result.value, 235.61, 0.01), runs[1].result.value);
  ok('bear is below base and bull above it',
    runs[0].result.value < runs[1].result.value && runs[1].result.value < runs[2].result.value,
    runs.map(r => r.result.value && r.result.value.toFixed(0)).join(' / '));

  // The fade must move with the first stage. Without this the bear case cuts
  // years 1–5 and leaves 6–10 at the optimistic rate, which is not a coherent
  // story about a business disappointing — and the resulting range is too narrow
  // in exactly the direction that flatters the holding.
  ok('bear fades the second stage too — 6% becomes 4%', near(runs[0].inputs.growth2, 4, 1e-9),
    runs[0].inputs.growth2);
  ok('bull raises the second stage too — 6% becomes 8%', near(runs[2].inputs.growth2, 8, 1e-9),
    runs[2].inputs.growth2);
  ok('base leaves the second stage alone', near(runs[1].inputs.growth2, 6, 1e-9));

  // Graham's rate-shaped input is the bond yield, and higher is bearish there
  // too because it divides. Getting this backwards would make Graham's bear case
  // the highest of the three, silently, in a row of three numbers.
  const gr = runScenarios('graham', { eps: 50, growth: 8, bond: 7 });
  ok('Graham\'s bear case raises the bond yield', near(gr[0].inputs.bond, 9, 1e-9), gr[0].inputs.bond);
  ok('and leaves no stray rate field behind', gr[0].inputs.rate === undefined);
  ok('so Graham\'s bear is still the lowest of the three',
    gr[0].result.value < gr[1].result.value && gr[1].result.value < gr[2].result.value,
    gr.map(x => x.result.value && x.result.value.toFixed(0)).join(' / '));

  // A model with no growth2 must not acquire one.
  const dd = runScenarios('ddm', { dividend: 20, growth: 6, rate: 10 });
  ok('the DDM gains no second-stage growth', dd.every(x => x.inputs.growth2 === undefined));
  ok('the DDM base still values at 530', near(dd[1].result.value, 530, 1e-9), dd[1].result.value);

  // A scenario that pushes into invalid territory must refuse, not disappear.
  const tight = runScenarios('ddm', { dividend: 20, growth: 9, rate: 10 });
  ok('a scenario that pushes growth past the rate refuses rather than vanishing',
    tight.length === 3 && tight[2].result.ok === false, tight[2].result.value);
}

// -------------------------------------------------- margin of safety / upside
{
  // The distinction decision 5 turns on. Same two numbers, two divisions, and
  // the larger one is the one people quote.
  ok('a stock at half its value has a 50% margin of safety', marginOfSafety(200, 100) === 50);
  ok('and 100% upside', upside(200, 100) === 100);
  ok('the two are not the same number', marginOfSafety(200, 100) !== upside(200, 100));

  ok('margin of safety is negative when the price is above value',
    near(marginOfSafety(100, 150), -50, 1e-9), marginOfSafety(100, 150));
  ok('and zero when they match', marginOfSafety(100, 100) === 0);

  // The denominators are what distinguishes them, so each is pinned by a case
  // where swapping them gives a different answer.
  ok('margin of safety divides by VALUE', near(marginOfSafety(400, 100), 75, 1e-9), marginOfSafety(400, 100));
  ok('upside divides by PRICE', near(upside(400, 100), 300, 1e-9), upside(400, 100));

  ok('a zero or negative value gives null rather than a division artefact',
    marginOfSafety(0, 100) === null && marginOfSafety(-50, 100) === null);
  ok('a zero price gives null for upside', upside(100, 0) === null);
  ok('missing inputs give null', marginOfSafety(null, 100) === null && upside(100, null) === null);
}

// ------------------------------------------------------------- readRange
{
  const runs = runScenarios('dcf', DCF);
  const vals = runs.map(r => r.result.value);
  const lo = Math.min(...vals), hi = Math.max(...vals);

  // Decision 2. The price is inside the band, so the only honest output is that
  // the model cannot call it — NOT the base case with a verdict attached.
  const inside = readRange(runs, 150);
  ok('a price inside the band is inconclusive', inside.verdict === 'inconclusive', inside.verdict);
  ok('and the headline says the assumptions do not distinguish',
    /do not distinguish/i.test(inside.headline), inside.headline);
  ok('and the detail refuses to lean on the base case',
    /cannot call this one/i.test(inside.detail));
  ok('the base case is still reported, just not as the answer', near(inside.base, 235.61, 0.01));

  ok('a price below every scenario reads below_range', readRange(runs, 50).verdict === 'below_range');
  ok('a price above every scenario reads above_range', readRange(runs, 5000).verdict === 'above_range');

  // The boundaries are inclusive, and that is deliberate: a price exactly on the
  // bear case has not been shown to be cheap. Strict inequalities here would
  // call the edges, which is precision the range does not have.
  ok('a price exactly at the low edge is inconclusive, not cheap',
    readRange(runs, lo).verdict === 'inconclusive', readRange(runs, lo).verdict);
  ok('a price exactly at the high edge is inconclusive, not dear',
    readRange(runs, hi).verdict === 'inconclusive', readRange(runs, hi).verdict);
  ok('a hair below the low edge does flip to below_range',
    readRange(runs, lo - 0.01).verdict === 'below_range');
  ok('a hair above the high edge does flip to above_range',
    readRange(runs, hi + 0.01).verdict === 'above_range');

  const noPrice = readRange(runs, null);
  ok('no price is its own verdict, not a guess', noPrice.verdict === 'no_price');
  ok('and it still reports the range', near(noPrice.lo, lo, 1e-9) && near(noPrice.hi, hi, 1e-9));

  // lo/hi come from the scenarios that computed, not from bear and bull by
  // position — a refused bull must not be read as a bull of zero.
  // Deliberately NOT in value order. Running the real models always yields
  // bear < base < bull, so every fixture built from them leaves min-and-max
  // indistinguishable from first-and-last — and readRange's contract is the
  // former. This list puts the largest value in the middle so that a version
  // reading the ends instead of the extremes gives a visibly wrong range.
  const mixed = [
    { scenario: { key: 'bear' }, result: { ok: true, value: 100 } },
    { scenario: { key: 'base' }, result: { ok: true, value: 200 } },
    { scenario: { key: 'bull' }, result: { ok: false, reason: 'nope' } },
    { scenario: { key: 'stress' }, result: { ok: true, value: 140 } },
  ];
  const m = readRange(mixed, 150);
  ok('a refused scenario is excluded from the range rather than counted as zero',
    m.lo === 100 && m.hi === 200, `${m.lo}-${m.hi}`);
  ok('the range is the min and max of the values, not the first and last',
    m.hi === 200, m.hi);
  ok('the base case is found by key, not by position', m.base === 200, m.base);
  ok('all-refused gives null rather than an empty range',
    readRange([{ scenario: { key: 'base' }, result: { ok: false } }], 100) === null);
  ok('an empty list gives null', readRange([], 100) === null);
}

// ---------------------------------------------------------- sensitivity
{
  const grid = sensitivityGrid('dcf', DCF);
  ok('the grid is 5 × 5 by default', grid.rates.length === 5 && grid.terms.length === 5);
  ok('the cell matrix matches', grid.cells.length === 5 && grid.cells.every(r => r.length === 5));

  // Centred on the inputs: rate 10 with a 1-point step gives 8..12, terminal 3
  // with a 0.25-point step gives 2.5..3.5. Typed out so an off-centre grid —
  // which would quietly move the whole table away from the user's actual
  // assumption — fails here.
  ok('the rate axis is centred on the input', grid.rates.join(',') === '8,9,10,11,12', grid.rates.join(','));
  ok('the terminal axis is centred on the input',
    grid.terms.map(t => t.toFixed(2)).join(',') === '2.50,2.75,3.00,3.25,3.50',
    grid.terms.map(t => t.toFixed(2)).join(','));

  const centre = grid.cells[2][2];
  ok('the centre cell is the base valuation', near(centre.value, 235.61, 0.01), centre.value);
  ok('and it carries its own coordinates', centre.rate === 10 && centre.terminal === 3);

  // The point of the grid: the corners must differ a lot. A grid whose corners
  // agree is a grid that has failed to make its argument.
  const loRate = grid.cells[0][4].value;   // cheapest money, fastest forever
  const hiRate = grid.cells[4][0].value;   // dearest money, slowest forever
  ok('the corners differ by more than twofold', loRate > hiRate * 2, `${hiRate} → ${loRate}`);

  // A cell that cannot be computed reports the refusal rather than a zero, which
  // would render as a valuation of nothing in the middle of a table of numbers.
  const nearMiss = sensitivityGrid('dcf', { ...DCF, rate: 3, terminal: 3 });
  const bad = nearMiss.cells.flat().filter(c => c.value === null);
  ok('invalid combinations null out and keep their reason',
    bad.length > 0 && bad.every(c => typeof c.reason === 'string' && c.reason.length > 0), bad.length);

  ok('a custom shape is honoured',
    sensitivityGrid('dcf', DCF, { rateSteps: 3, growthSteps: 7 }).cells.length === 3);
  ok('a model without a terminal rate has no grid',
    sensitivityGrid('graham', { eps: 50, growth: 8, bond: 7 }) === null);
}

// -------------------------------------------------------------- storage
{
  ok('the memory key is the agreed one', IV_MEMORY_KEY === 'iv_inputs');
  ok('the slot key upper-cases the ticker', inputKey('tcs', 'dcf') === 'iv:TCS:dcf');
  ok('and is per model', inputKey('TCS', 'dcf') !== inputKey('TCS', 'ddm'));

  const blob = writeInputs({}, 'TCS', 'dcf', { fcf: 10, growth: 12 });
  ok('inputs round-trip', readInputs(blob, 'TCS', 'dcf').fcf === 10);
  ok('reading is case-insensitive on the ticker', readInputs(blob, 'tcs', 'dcf').growth === 12);
  ok('an unwritten slot reads as empty, not undefined',
    JSON.stringify(readInputs(blob, 'INFY', 'dcf')) === '{}');

  // Per-model isolation. Growth means one thing in a DCF and another in Graham's
  // formula, so carrying one into the other would produce a valuation from a
  // number the user typed for a different purpose.
  const both = writeInputs(blob, 'TCS', 'graham', { eps: 50, growth: 8 });
  ok('writing one model does not disturb another', readInputs(both, 'TCS', 'dcf').growth === 12);
  ok('and the second model keeps its own', readInputs(both, 'TCS', 'graham').growth === 8);

  ok('blank fields are dropped rather than stored as zero',
    writeInputs({}, 'X', 'dcf', { fcf: 10, growth: '' })['iv:X:dcf'].growth === undefined);
  ok('a real zero IS stored', writeInputs({}, 'X', 'dcf', { terminal: 0 })['iv:X:dcf'].terminal === 0);
  ok('numeric strings are coerced on the way in',
    writeInputs({}, 'X', 'dcf', { fcf: '10.5' })['iv:X:dcf'].fcf === 10.5);
  ok('emptying every field deletes the slot rather than leaving a husk',
    writeInputs(blob, 'TCS', 'dcf', { fcf: '', growth: null })['iv:TCS:dcf'] === undefined);
  ok('writeInputs does not mutate the blob it was given',
    JSON.stringify(blob) === JSON.stringify(writeInputs({}, 'TCS', 'dcf', { fcf: 10, growth: 12 })));
  ok('readInputs returns a copy, not the stored object',
    readInputs(blob, 'TCS', 'dcf') !== blob['iv:TCS:dcf']);
  ok('a null blob reads as empty', JSON.stringify(readInputs(null, 'TCS', 'dcf')) === '{}');
}

// ------------------------------------------------------------ disclaimer
{
  ok('the disclaimer exists and is substantial', DISCLAIMER.length > 120);
  ok('it says the inputs are typed by hand', /by hand/i.test(DISCLAIMER));
  ok('it says the output is a range because the inputs are estimates', /range/i.test(DISCLAIMER));
  ok('and it says this is not advice', /not investment advice/i.test(DISCLAIMER));
}

console.log(`\n${pass}/${pass + fail} passing`);
if (fail) process.exit(1);
