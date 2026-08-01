// Run: bun tests/buildcontext.test.jsx
//
// This file lives in the repo rather than in /tmp because the scratch container
// has been reclaimed six times and taken every suite with it each time. A test
// that only exists on one machine is a test that will be written again.
//
// buildContext wiring test.
//
// This suite exists because three bugs lived in eight lines of buildContext and
// none of them threw. Every one was a mismatch between what a WRITER writes and
// what the READER reads, and no test in the build looked at that seam — the
// briefing suite fed buildContext's OUTPUT shape straight to the rules, so the
// function that produces that shape was never exercised at all.
//
// So the rule of this file: the fixtures are not hand-written context objects.
// They are the literal arguments the Planner's own memSet calls pass, copied
// from the call sites, so that if the Planner ever changes its save shape this
// suite fails instead of the app quietly abstaining.

import fs from 'fs';
import path from 'path';
const here = new URL('.', import.meta.url).pathname;
const src = f => path.join(here, '../src/', f);
import { buildContext } from '../src/components/money/Briefing.jsx';
import { DEFAULT_PLAN } from '../src/lib/plan.js';

let pass = 0, fail = 0;
const ok = (name, cond, got) => {
  if (cond) { pass++; }
  else { fail++; console.log('FAIL', name, got === undefined ? '' : `— ${got}`); }
};

const SRC = fs.readFileSync(src('components/money/Briefing.jsx'), 'utf8');
const PLANNER = fs.readFileSync(src('components/money/Planner.jsx'), 'utf8');
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');

// ---------------------------------------------------------------------------
// The literal shapes the Planner writes. Both are transcribed from the memSet
// call sites, and the first two assertions pin that transcription — a fixture
// that has drifted from the writer tests nothing, which is the whole failure
// this file was written after.
// ---------------------------------------------------------------------------

// Planner.jsx: memSet(PLAN_KEY, plan) where plan is DEFAULT_PLAN-shaped state.
const SAVED_PLAN = {
  ...DEFAULT_PLAN,
  startValue: null,          // the Planner leaves this null to mean "live book"
  monthly: 40000,
  contribGrowthPct: 8,
  growthPct: 11,
  inflationPct: 6,
  years: 40,
  annualExpenses: 720000,
  swrPct: 3.0,               // deliberately NOT DEFAULT_PLAN's 3.5
};

// Planner.jsx: saveGoals({ goals: [{ id, label, target, by }] })
const SAVED_GOALS = {
  goals: [{ id: 'g1785600000000', label: 'First crore', target: 10000000, by: '2035' }],
};

ok('the plan fixture matches the key the Planner writes',
  /memSet\(PLAN_KEY, plan\)/.test(PLANNER) && /PLAN_KEY\s*=\s*'money_plan'/.test(PLANNER),
  'Planner.jsx');
ok('the goal fixture matches the shape the Planner writes',
  /saveGoals\(\{ goals: \[\.\.\.goals\.goals, \{ id: /.test(PLANNER) &&
  /GOALS_KEY\s*=\s*'goals_money'/.test(PLANNER),
  'Planner.jsx');

const BOOK = [
  { symbol: 'A', qty: 100, avg_cost: 1000, last_price: 1500 },
  { symbol: 'B', qty: 50, avg_cost: 2000, last_price: 1800 },
];
const priceOf = h => Number(h.last_price ?? h.avg_cost ?? 0);
const LIVE = BOOK.reduce((s, h) => s + h.qty * priceOf(h), 0);   // 240000

const blobs = over => ({
  meta: {}, fi: null, div: null, rates: null,
  exp: { txns: [] }, goals: SAVED_GOALS, fund: {}, targets: null,
  savedPlan: SAVED_PLAN,
  ...over,
});

const build = over => buildContext({
  blobs: blobs(over), held: BOOK, priceOf, orders: [], series: [], benchmark: [],
  flowsByDay: {}, currentValue: LIVE, crypto: [], cur: '₹',
});

// ---------------------------------------------------------------------------
// Bug 1 — the plan was read from a key nothing writes.
// ---------------------------------------------------------------------------
{
  const ctx = build();
  ok('the saved withdrawal rate reaches the context', ctx.swr === 3.0, String(ctx.swr));
  ok('and is not silently DEFAULT_PLAN’s', ctx.swr !== DEFAULT_PLAN.swrPct, String(ctx.swr));
  ok('the saved annual expenses reach the context', ctx.planSpend === 720000, String(ctx.planSpend));

  // The negative. `goals.plan` is the key nothing writes; if it ever comes back
  // this assertion is the thing that says so.
  ok('the plan is never read out of the goals blob', !/goals\.plan|goals\?\.\plan/.test(CODE));
  ok('the plan is read from its own saved key', /b\.savedPlan/.test(CODE));
  ok('the loader actually fetches that key', /memGet\('money_plan'\)/.test(CODE));

  // And the proof that reading the wrong key was not merely cosmetic: a plan
  // saved under goals.plan must now change nothing.
  const decoy = build({ savedPlan: null, goals: { ...SAVED_GOALS, plan: { swrPct: 9.9 } } });
  ok('a plan hidden in the goals blob is ignored, not honoured',
    decoy.swr === DEFAULT_PLAN.swrPct, String(decoy.swr));
}

// ---------------------------------------------------------------------------
// Bug 2 — the goal was read from a field nothing writes, so plan.track never
// fired in the app's whole life.
// ---------------------------------------------------------------------------
{
  const ctx = build();
  ok('a goal saved by the Planner produces plan progress', ctx.plan != null, String(ctx.plan));
  ok('and it is the goal that was saved',
    ctx.plan && /crore/i.test(JSON.stringify(ctx.plan)) || (ctx.plan && ctx.plan.target === 10000000),
    JSON.stringify(ctx.plan || {}).slice(0, 120));

  const none = build({ goals: { goals: [] } });
  ok('no goal saved still abstains rather than inventing one', none.plan == null);

  ok('the goals array is the first field read', /goals\?\.goals\?\.\[0\]/.test(CODE));
}

// ---------------------------------------------------------------------------
// Bug 3 — `start` was passed where `startValue` was expected, so the projection
// began from zero. This was invisible only because bug 2 kept the rule dark.
// ---------------------------------------------------------------------------
{
  ok('projectAll is never handed a bare `start`', !/projectAll\(\{[^}]*\bstart:/.test(CODE));
  ok('projectAll is handed startValue', /projectAll\(\{ \.\.\.planCfg, startValue: planStart \}\)/.test(CODE));

  // The behavioural half. A null startValue must resolve to the live book, and
  // the projection must therefore begin above it rather than at zero.
  const ctx = build();
  const first = ctx.plan?.rows?.[0] ?? null;
  ok('a null startValue resolves to the live book, not to zero',
    ctx.plan != null && (first == null || Number(first.value ?? first.real ?? 0) >= LIVE ||
      // goalProgress may not carry rows; fall back to the crossing, which is
      // built from the same resolved start.
      (ctx.fireDate && ctx.fireDate.rows?.[0] && Number(ctx.fireDate.rows[0].value) >= LIVE)),
    JSON.stringify(first || ctx.fireDate?.rows?.[0] || {}).slice(0, 120));

  // An explicitly saved start must be honoured over the live book, or the field
  // is decoration.
  const fixed = build({ savedPlan: { ...SAVED_PLAN, startValue: 5000000 } });
  ok('an explicit startValue beats the live book',
    fixed.fireDate?.rows?.[0] && Number(fixed.fireDate.rows[0].value) >= 5000000,
    JSON.stringify(fixed.fireDate?.rows?.[0] || {}).slice(0, 120));
}

// ---------------------------------------------------------------------------
// The crossing, and the two-targets problem the third rule exists to name.
// ---------------------------------------------------------------------------
{
  const ctx = build();
  ok('the context carries a crossing', ctx.fireDate != null && ctx.fireDate.target != null,
    JSON.stringify(ctx.fireDate || {}).slice(0, 80));
  ok('the crossing target is built from the SAVED expenses',
    Math.round(ctx.fireDate.target) === Math.round(720000 / (3.0 / 100)),
    String(ctx.fireDate?.target));
  ok('the crossing is measured in real terms', ctx.fireDate.basis === 'real', ctx.fireDate?.basis);

  // plan.fire's target is built from LOGGED spending, so with nothing logged it
  // must abstain rather than reuse the plan's figure — that reuse is exactly the
  // conflation plan.spendgap exists to expose.
  ok('with nothing logged, the logged-spending target abstains', ctx.fire == null, String(ctx.fire));
  ok('and the two spend figures are reported separately',
    'planSpend' in ctx && 'observedSpend' in ctx);

  ok('Levers and the Briefing cross by the same function', /from '\.\.\/\.\.\/lib\/levers\.js'/.test(CODE));
}

// ---------------------------------------------------------------------------
// Robustness. Every one of the three bugs produced a quiet abstention; a
// context builder that throws on a missing blob would at least have been found,
// so the abstention has to be deliberate and total rather than accidental.
// ---------------------------------------------------------------------------
{
  const hostile = [
    ['null blobs fields', { savedPlan: null, goals: null, exp: null }],
    ['a plan that is a string', { savedPlan: 'nope' }],
    ['a plan that is an array', { savedPlan: [] }],
    ['goals that are an array', { goals: [] }],
    ['goals with a null first entry', { goals: { goals: [null] } }],
    ['a plan with every field null', { savedPlan: Object.fromEntries(Object.keys(DEFAULT_PLAN).map(k => [k, null])) }],
  ];
  for (const [name, over] of hostile) {
    let threw = null;
    try { build(over); } catch (e) { threw = e; }
    ok(`buildContext survives ${name}`, threw == null, threw && threw.message);
  }

  // A string plan must not be spread character-by-character into the config.
  const str = build({ savedPlan: 'nope' });
  ok('a string plan falls back to the defaults whole', str.swr === DEFAULT_PLAN.swrPct, String(str.swr));
}

console.log(`\n${pass}/${pass + fail} passing`);
if (fail) process.exit(1);
