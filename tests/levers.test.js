// Run: bun tests/levers.test.js
//
// levers.js is the file most able to turn into advice by accident, and it is
// defended by eight stated decisions rather than by a disclaimer. A disclaimer
// is not testable; these are. Each block below names the decision it guards and
// what specifically goes wrong if the guard is removed.
//
// The decision that matters most is the first: a lever you CONTROL and a guess
// you MADE are different objects and are never ranked in one list. If they ever
// were, "assume 2pp more growth" would sit at the top of a list of actions and
// the screen would be recommending self-deception, ranked first by effect.

import { DEFAULT_PLAN, projectYears, fireNumber } from '../src/lib/plan.js';
import {
  crossFraction, crossing, RUNGS, LEVERS, leverById, ladder, analyse,
  assumptionsOf, REAL_TERMS_NOTE,
} from '../src/lib/levers.js';

let pass = 0, fail = 0;
const bad = [];
const ok = (name, cond, got) => {
  if (cond) pass++;
  else { fail++; bad.push(name); console.log('FAIL', name, got === undefined ? '' : `— ${got}`); }
};

const THIS_YEAR = 2026;   // pinned: a suite whose answers move with the calendar
                          // is a suite that fails in January for no reason.

// A plan that crosses comfortably, and one that cannot inside its horizon. Both
// are plausible: the second is a twenty-five-year-old with a ten-year horizon,
// which is the state the eighth decision exists for.
const REACHES = {
  ...DEFAULT_PLAN, startValue: 2000000, monthly: 60000, contribGrowthPct: 8,
  growthPct: 12, inflationPct: 5, years: 40, annualExpenses: 720000, swrPct: 3.5,
};
const NEVER = { ...REACHES, years: 5, monthly: 5000, startValue: 100000, annualExpenses: 2400000 };

// ---------------------------------------------------------------------------
// crossFraction. The contract worth pinning is the one about zero: "you are
// already there" and "it never gets there" are the two answers a caller must
// not be able to confuse, and both are falsy in JavaScript.
// ---------------------------------------------------------------------------
{
  const rows = [
    { year: 0, real: 100 }, { year: 1, real: 200 }, { year: 2, real: 300 }, { year: 3, real: 400 },
  ];
  ok('a target between two rows interpolates', crossFraction(rows, 'real', 250) === 1.5,
    String(crossFraction(rows, 'real', 250)));
  ok('a target met exactly at a row returns that row', crossFraction(rows, 'real', 300) === 2,
    String(crossFraction(rows, 'real', 300)));
  ok('a target already met at row zero returns zero', crossFraction(rows, 'real', 50) === 0,
    String(crossFraction(rows, 'real', 50)));
  ok('a target never reached returns null — not the last year',
    crossFraction(rows, 'real', 9999) === null, String(crossFraction(rows, 'real', 9999)));
  // The distinction the whole function exists for.
  ok('already-there and never are distinguishable',
    crossFraction(rows, 'real', 50) !== crossFraction(rows, 'real', 9999));

  ok('no rows returns null', crossFraction([], 'real', 100) === null);
  ok('a zero target returns null rather than zero',
    crossFraction(rows, 'real', 0) === null, String(crossFraction(rows, 'real', 0)));
  ok('a negative target returns null', crossFraction(rows, 'real', -5) === null);
  ok('called with nothing at all, returns null', crossFraction() === null);

  // No interpolation across a flat or falling step — the fraction would either
  // divide by zero or name a point outside the year it claims to be inside.
  const flat = [{ year: 0, real: 100 }, { year: 1, real: 100 }, { year: 2, real: 100 }];
  ok('a flat series reaching the target returns a whole year, not a division by zero',
    crossFraction(flat, 'real', 100) === 0, String(crossFraction(flat, 'real', 100)));
  const dip = [{ year: 0, real: 300 }, { year: 1, real: 100 }, { year: 2, real: 250 }];
  ok('a falling step returns the whole year rather than interpolating backwards',
    crossFraction(dip, 'real', 250) === 0, String(crossFraction(dip, 'real', 250)));
  const holes = [{ year: 0, real: null }, { year: 1, real: undefined }, { year: 2, real: 500 }];
  ok('rows with missing values are skipped, not read as zero',
    crossFraction(holes, 'real', 400) === 2, String(crossFraction(holes, 'real', 400)));
  ok('every fraction is finite',
    [250, 300, 50].every(t => Number.isFinite(crossFraction(rows, 'real', t))));
}

// ---------------------------------------------------------------------------
// Decision 2 — the crossing is measured in REAL terms. This is the single
// highest-consequence line in the file: at 5% over 20 years the nominal balance
// is 2.65× the real one, so reading the wrong column does not shift the answer,
// it IS the answer.
// ---------------------------------------------------------------------------
{
  const c = crossing(REACHES, { thisYear: THIS_YEAR });
  ok('the crossing declares its basis', c.basis === 'real', c.basis);
  ok('the module publishes the reason in prose', /inflation-adjusted/.test(REAL_TERMS_NOTE));
  ok('the target is expenses divided by the withdrawal rate',
    Math.round(c.target) === Math.round(fireNumber({ annualExpenses: 720000, swrPct: 3.5 })),
    String(c.target));
  ok('and equals the arithmetic done by hand',
    Math.round(c.target) === Math.round(720000 / 0.035), String(c.target));

  // The proof that `real` and not `value` was read: the same plan crossed on the
  // nominal column must land strictly earlier. If someone swaps the field, this
  // is the assertion that catches it.
  const nominalFrac = crossFraction(c.rows, 'value', c.target);
  ok('the nominal column would have crossed strictly earlier',
    nominalFrac != null && c.frac != null && nominalFrac < c.frac,
    `nominal ${nominalFrac} vs real ${c.frac}`);
  ok('by a margin too large to be a rounding matter',
    c.frac - nominalFrac > 1, String(c.frac - nominalFrac));

  ok('the crossing is reachable for a plan built to reach', c.reachable === true);
  ok('and reports a calendar year', c.calYear === THIS_YEAR + c.years,
    `${c.calYear} vs ${THIS_YEAR}+${c.years}`);
  ok('the printed year is the whole year the crossing lands in',
    c.years === Math.ceil(c.frac), `${c.years} vs ceil(${c.frac})`);
  ok('a reachable crossing reports no shortfall', c.shortfall == null, String(c.shortfall));
  ok('and gives no reason, because there is nothing to explain', c.why == null);
}

// ---------------------------------------------------------------------------
// Decision 8 — a baseline that never crosses. Deltas are not the answer here,
// and the state has to be reported as narrower than "nothing helps".
// ---------------------------------------------------------------------------
{
  const c = crossing(NEVER, { thisYear: THIS_YEAR });
  ok('an unreachable plan says so', c.reachable === false);
  ok('and prints no date rather than the last year',
    c.years == null && c.calYear == null, `${c.years} / ${c.calYear}`);
  ok('and reports the shortfall in real terms', Number.isFinite(c.shortfall) && c.shortfall > 0,
    String(c.shortfall));
  ok('and names the horizon it failed inside',
    /5-year horizon/.test(c.why || ''), c.why);
  ok('the shortfall is target minus the ending real balance',
    Math.abs(c.shortfall - (c.target - c.endReal)) < 1e-6, `${c.shortfall} vs ${c.target - c.endReal}`);

  const a = analyse(NEVER, { thisYear: THIS_YEAR });
  ok('analyse carries a baseline note when nothing crosses', typeof a.baselineNote === 'string');
  // The exact claim matters. "Nothing helps" is false and discouraging; "nothing
  // at this size, inside this horizon" is true.
  ok('and the note is narrow rather than defeatist',
    /horizon/.test(a.baselineNote) && /what each\s+change is worth/.test(a.baselineNote.replace(/\s+/g, ' ')),
    a.baselineNote);
  ok('and it is absent when the baseline does cross',
    analyse(REACHES, { thisYear: THIS_YEAR }).baselineNote == null);
}

// ---------------------------------------------------------------------------
// Decision 1 — controls and assumptions are never ranked in one list. This is
// the block that would have to be deleted for the module to start recommending
// that Neel assume more growth.
// ---------------------------------------------------------------------------
{
  const a = analyse(REACHES, { thisYear: THIS_YEAR });
  ok('analyse returns two separate arrays', Array.isArray(a.controls) && Array.isArray(a.assumptions));
  ok('every lever lands in exactly one of them',
    a.controls.length + a.assumptions.length === LEVERS.length,
    `${a.controls.length}+${a.assumptions.length} vs ${LEVERS.length}`);
  ok('controls are all controls', a.controls.every(l => l.kind === 'control'));
  ok('assumptions are all assumptions', a.assumptions.every(l => l.kind === 'assumption'));
  ok('no lever appears in both',
    !a.controls.some(c => a.assumptions.some(x => x.id === c.id)));
  ok('analyse returns no combined list under any name',
    !Object.values(a).some(v => Array.isArray(v) && v.length === LEVERS.length &&
      v.every(x => x && x.kind)),
    Object.keys(a).join(','));

  // Sorting happens within a kind.
  const sorted = arr => arr.every((l, i) => i === 0 || arr[i - 1].bestMonths >= l.bestMonths);
  ok('controls are sorted by effect', sorted(a.controls), a.controls.map(l => l.bestMonths).join(' '));
  ok('assumptions are sorted by effect', sorted(a.assumptions), a.assumptions.map(l => l.bestMonths).join(' '));

  // And the test that catches the seductive version. If the two were merged and
  // sorted, an assumption would frequently outrank every control — that is
  // exactly why the merged table is tempting. Assert the merge does not exist by
  // showing the module never exposes the ordering that would produce it.
  const merged = [...a.controls, ...a.assumptions];
  const globallySorted = merged.every((l, i) => i === 0 || merged[i - 1].bestMonths >= l.bestMonths);
  ok('the concatenation is NOT globally sorted, i.e. the two orderings are independent',
    !globallySorted || a.assumptions.every(x => x.bestMonths === 0),
    merged.map(l => `${l.id}:${l.bestMonths}`).join(' '));

  ok('no export names a best or recommended lever',
    ![ 'best', 'recommend', 'recommended', 'suggest', 'shouldDo', 'action' ]
      .some(k => k in a), Object.keys(a).join(','));
}

// ---------------------------------------------------------------------------
// The lever definitions themselves — decision 5, the unit is the unit a person
// thinks in.
// ---------------------------------------------------------------------------
{
  ok('there are six levers', LEVERS.length === 6, String(LEVERS.length));
  ok('every lever id is unique', new Set(LEVERS.map(l => l.id)).size === LEVERS.length);
  for (const l of LEVERS) {
    ok(`${l.id} declares a kind`, l.kind === 'control' || l.kind === 'assumption', l.kind);
    ok(`${l.id} names a real plan field`, l.field in DEFAULT_PLAN, l.field);
    ok(`${l.id} declares which direction helps`, l.dir === 1 || l.dir === -1, String(l.dir));
    ok(`${l.id} carries a step in a human unit`, Number.isFinite(l.step) && l.step > 0, String(l.step));
    ok(`${l.id} carries that unit as printable text`, typeof l.unit === 'string' && l.unit.length > 0, l.unit);
    ok(`${l.id} routes to a screen`, typeof l.view === 'string' && l.view.length > 0, l.view);
    ok(`${l.id} explains itself`, typeof l.note === 'string' && l.note.length > 30);
    ok(`${l.id} is findable by id`, leverById(l.id) === l);
  }
  ok('an unknown id returns null rather than undefined', leverById('nope') === null);
  ok('leverById survives no argument', leverById() === null);

  // The two levers whose helpful direction is downward, and the reason they are
  // different: spending is a thing Neel does, the withdrawal rate is a guess.
  ok('spending helps downward', leverById('spend').dir === -1);
  ok('spending is a control, not an assumption', leverById('spend').kind === 'control');
  ok('growth is an assumption, not a control', leverById('growth').kind === 'assumption');
  ok('the growth note says outright that it is not a lever',
    /not a lever/i.test(leverById('growth').note), leverById('growth').note);
  ok('the withdrawal-rate note names the half of the trade it cannot show',
    /cannot show/i.test(leverById('swr').note));
  ok('the spending note refuses to assume the saved rupee gets invested',
    /separate decision/i.test(leverById('spend').note));
}

// ---------------------------------------------------------------------------
// Decision 6 — non-linearity is shown, not averaged into a rate. Four rungs,
// and no per-unit figure anywhere, because the first thing anyone does with a
// rate is multiply it.
// ---------------------------------------------------------------------------
{
  ok('there are four rungs', RUNGS.length === 4, RUNGS.join(','));
  ok('the rungs are ascending and distinct',
    RUNGS.every((r, i) => i === 0 || RUNGS[i - 1] < r), RUNGS.join(','));
  ok('the rungs span an order of magnitude', RUNGS[RUNGS.length - 1] / RUNGS[0] >= 10);

  const l = ladder(REACHES, leverById('monthly'), { thisYear: THIS_YEAR });
  ok('a ladder has one step per rung', l.steps.length === RUNGS.length, String(l.steps.length));
  ok('each step reports the rung count it came from',
    l.steps.every((s, i) => s.rungs === RUNGS[i]), l.steps.map(s => s.rungs).join(','));
  ok('each step reports the amount in the lever’s own unit',
    l.steps.every((s, i) => s.amount === leverById('monthly').step * RUNGS[i]));
  ok('each step reports what the field now reads',
    l.steps.every((s, i) => s.value === REACHES.monthly + leverById('monthly').step * RUNGS[i]),
    l.steps.map(s => s.value).join(','));

  // Bigger rungs move the date at least as far, and the whole point: NOT
  // proportionally. If the effect were linear the ladder would be a rate with
  // extra steps and decision 6 would be pointless.
  const moved = l.steps.map(s => s.movedMonths);
  ok('a larger rung never moves the date less',
    moved.every((m, i) => i === 0 || m >= moved[i - 1]), moved.join(' '));
  const first = moved[0], last = moved[moved.length - 1];
  ok('and the effect is measurably non-linear',
    first > 0 && Math.abs(last / first - RUNGS[3] / RUNGS[0]) > 0.15,
    `${first} → ${last} for ${RUNGS[0]}× → ${RUNGS[3]}×`);

  // No per-unit export, in the module or on a ladder.
  const perUnit = /perUnit|monthsPer|ratePer|perThousand/;
  ok('no ladder field is a per-unit rate',
    !Object.keys(l).some(k => perUnit.test(k)), Object.keys(l).join(','));
  ok('no step field is a per-unit rate',
    !l.steps.some(s => Object.keys(s).some(k => perUnit.test(k))));
}

// ---------------------------------------------------------------------------
// Decision 4 — the date is a year, the effect is measured in months. At whole
// year resolution nearly every realistic lever moves the crossing by zero, and
// a table of zeros is a broken screen rather than a cautious one.
// ---------------------------------------------------------------------------
{
  const l = ladder(REACHES, leverById('monthly'), { thisYear: THIS_YEAR });
  ok('every step prints a whole calendar year, never a fraction',
    l.steps.every(s => s.calYear == null || Number.isInteger(s.calYear)),
    l.steps.map(s => s.calYear).join(','));
  ok('every step carries the interpolated point separately from the printed year',
    l.steps.every(s => s.frac == null || (Number.isFinite(s.frac) && s.years === Math.ceil(s.frac))));
  ok('movement is reported in months', l.steps.every(s => s.movedMonths == null || Number.isInteger(s.movedMonths)));
  ok('and months are the rounded twelve-times of the fractional years',
    l.steps.every(s => s.movedYears == null || s.movedMonths === Math.round(s.movedYears * 12)));
  // The figure the SORT uses has to be the month figure too. Ranking on rounded
  // years would flatten most levers to a tie and then order them by whatever
  // Array.sort felt like — a stable-looking list with nothing behind it.
  ok('the sort key is the best MONTHS figure, not a rounded-year one',
    l.bestMonths === Math.max(...l.steps.map(s => s.movedMonths ?? 0)),
    `${l.bestMonths} vs ${l.steps.map(s => s.movedMonths).join(',')}`);

  // The failure decision 4 exists to prevent, demonstrated: measured on whole
  // years alone, the smallest rung moves nothing.
  const wholeYearMoves = l.steps.map(s => (l.base.years ?? 0) - (s.years ?? 0));
  ok('at least one rung would read as zero on whole years alone',
    wholeYearMoves.some(m => m === 0), wholeYearMoves.join(' '));
  ok('but is non-zero in months', l.steps.some((s, i) => wholeYearMoves[i] === 0 && s.movedMonths > 0),
    l.steps.map(s => s.movedMonths).join(' '));
}

// ---------------------------------------------------------------------------
// Decision 7 — a flat lever is reported, not dropped. Dropping them leaves a
// list in which everything matters, which describes a different portfolio.
// ---------------------------------------------------------------------------
{
  // A plan so dominated by its starting balance that a ₹1,000/month change is
  // noise. This is a real state — it is what a large portfolio looks like.
  const DOMINATED = { ...REACHES, startValue: 60000000, monthly: 1000, years: 40 };
  const a = analyse(DOMINATED, { thisYear: THIS_YEAR });
  const all = [...a.controls, ...a.assumptions];
  ok('every lever is still present when some are flat', all.length === LEVERS.length,
    String(all.length));
  ok('flat levers are named in their own list', Array.isArray(a.flat));
  ok('and every named one really is flat',
    a.flat.every(id => all.find(l => l.id === id)?.flat === true), a.flat.join(','));
  ok('and every flat one is named', all.filter(l => l.flat).every(l => a.flat.includes(l.id)));
  // The precise definition, which is not "moved zero months": a lever that
  // brings an unreachable crossing inside the horizon is not flat even if the
  // months figure is null.
  ok('a lever that becomes reachable is never called flat',
    all.every(l => !(l.becomesReachable && l.flat)));

  // Decision 8's actual payload. A baseline that never crosses turns every
  // delta column into dashes, and the eye reads a column of dashes as "nothing
  // helps". The one genuinely new fact in that state is which rungs DO bring
  // the crossing inside the horizon — so there has to be a plan in this suite
  // where that happens, or the flag is untested and can be hard-coded false
  // without anything noticing. This plan is that state: eighteen years short,
  // but not by much.
  const MARGINAL = { ...DEFAULT_PLAN, startValue: 3000000, monthly: 30000,
    contribGrowthPct: 8, growthPct: 11, inflationPct: 6, years: 18,
    annualExpenses: 720000, swrPct: 3.5 };
  const mg = analyse(MARGINAL, { thisYear: THIS_YEAR });
  const mgAll = [...mg.controls, ...mg.assumptions];
  ok('the marginal plan does not cross on its own', mg.base.reachable === false);
  ok('but some rungs bring the crossing inside the horizon',
    mgAll.some(l => l.becomesReachable), mgAll.map(l => `${l.id}:${l.becomesReachable}`).join(' '));
  ok('and the step that does it is the one marked, not the ladder as a whole',
    mgAll.filter(l => l.becomesReachable)
      .every(l => l.steps.some(s => s.becomesReachable && s.reachable)));
  ok('a rung marked reachable actually carries a date',
    mgAll.flatMap(l => l.steps).filter(s => s.becomesReachable)
      .every(s => Number.isInteger(s.calYear)));
  ok('and a rung not marked carries none',
    mgAll.flatMap(l => l.steps).filter(s => !s.reachable)
      .every(s => s.calYear == null));
  ok('a lever that becomes reachable is never reported as flat',
    mgAll.filter(l => l.becomesReachable).every(l => l.flat === false));

  const un = analyse(NEVER, { thisYear: THIS_YEAR });
  const unAll = [...un.controls, ...un.assumptions];
  ok('when nothing crosses, every rung still reports',
    unAll.every(l => l.steps.length === RUNGS.length));
  ok('and becomesReachable is a boolean on every step, never undefined',
    unAll.every(l => l.steps.every(s => typeof s.becomesReachable === 'boolean')));
}

// ---------------------------------------------------------------------------
// Clamping. A withdrawal rate of zero is an infinite target and a negative
// expense is not a thing; a rung that produces an arithmetically fine and
// meaningless crossing is worse than one that says it was clamped.
// ---------------------------------------------------------------------------
{
  const TINY = { ...REACHES, monthly: 500, annualExpenses: 60000, swrPct: 0.5, growthPct: 1 };
  for (const l of LEVERS) {
    const lad = ladder(TINY, l, { thisYear: THIS_YEAR });
    ok(`${l.id} never drives its field below its floor`,
      lad.steps.every(s => Number.isFinite(s.value)), lad.steps.map(s => s.value).join(','));
    ok(`${l.id} says when a rung was clamped rather than pretending`,
      lad.steps.every(s => typeof s.clamped === 'boolean'));
  }
  const spend = ladder({ ...TINY, annualExpenses: 12000 }, leverById('spend'), { thisYear: THIS_YEAR });
  ok('spending is clamped at zero, not driven negative',
    spend.steps.every(s => s.value >= 0), spend.steps.map(s => s.value).join(','));
  ok('and the clamped rungs are marked', spend.steps.some(s => s.clamped));
  const swr = ladder({ ...REACHES, swrPct: 0.5 }, leverById('swr'), { thisYear: THIS_YEAR });
  ok('the withdrawal rate never reaches zero, which would be an infinite target',
    swr.steps.every(s => s.value > 0), swr.steps.map(s => s.value).join(','));

  // Spending is stored annually and shown monthly — decision 5 again, and the
  // place it is easiest to get wrong by a factor of twelve.
  const sp = ladder(REACHES, leverById('spend'), { thisYear: THIS_YEAR });
  ok('spending steps show a monthly figure alongside the stored annual one',
    sp.steps.every(s => Math.abs(s.shown - s.value / 12) < 1e-9),
    `${sp.steps[0].shown} vs ${sp.steps[0].value}`);
  ok('and a non-monthly lever shows the field value unchanged',
    ladder(REACHES, leverById('growth'), { thisYear: THIS_YEAR })
      .steps.every(s => s.shown === s.value));
}

// ---------------------------------------------------------------------------
// Decision 3 — every number comes from projectYears, never from a closed form.
// A second, simpler model would let the Levers screen and the Planner screen
// disagree about one plan with no way to tell which was wrong.
// ---------------------------------------------------------------------------
{
  const c = crossing(REACHES, { thisYear: THIS_YEAR });
  const direct = projectYears({
    start: REACHES.startValue, years: REACHES.years,
    growthPct: REACHES.growthPct, divYieldPct: REACHES.divYieldPct,
    divGrowthPct: REACHES.divGrowthPct, monthly: REACHES.monthly,
    contribGrowthPct: REACHES.contribGrowthPct, drip: REACHES.drip,
    inflationPct: REACHES.inflationPct, withContrib: true,
  });
  ok('the crossing rows ARE the projection rows', c.rows.length === direct.length,
    `${c.rows.length} vs ${direct.length}`);
  ok('value for value',
    c.rows.every((r, i) => Math.abs(r.real - direct[i].real) < 1e-9));
  ok('so the crossing is reproducible from the Planner’s own function',
    crossFraction(direct, 'real', c.target) === c.frac);
}

// ---------------------------------------------------------------------------
// assumptionsOf — the screen cannot render a date without the numbers that
// produced it. A retirement year with its assumptions on another tab is a
// prediction, and this module does not make predictions.
// ---------------------------------------------------------------------------
{
  const rows = assumptionsOf(REACHES, '₹');
  const labels = rows.map(r => r.label.toLowerCase()).join(' | ');
  for (const need of ['starting', 'contributing', 'growth', 'inflation', 'spending', 'withdrawal', 'horizon']) {
    ok(`the assumptions list states ${need}`, labels.includes(need), labels);
  }
  ok('every row has a printable value',
    rows.every(r => typeof r.value === 'string' && r.value.length > 0));
  ok('no row prints NaN or undefined',
    !rows.some(r => /NaN|undefined/.test(`${r.value} ${r.note || ''}`)),
    JSON.stringify(rows.find(r => /NaN|undefined/.test(`${r.value} ${r.note || ''}`)) || {}));
  ok('the currency symbol passed in is the one used',
    assumptionsOf(REACHES, '$').every(r => !r.value.includes('₹')));
  // The step-up is stated as flat rather than omitted when it is zero: an
  // omitted assumption reads as one that was not made.
  ok('a zero step-up is stated as flat, not left out',
    assumptionsOf({ ...REACHES, contribGrowthPct: 0 })
      .find(r => /contributing/i.test(r.label))?.note === 'flat');
  ok('and a non-zero one names the rate',
    /rising 8%/.test(assumptionsOf(REACHES).find(r => /contributing/i.test(r.label))?.note || ''));
  ok('an empty plan still produces a full assumption list',
    assumptionsOf({}).length === rows.length && !assumptionsOf({}).some(r => /NaN/.test(r.value)));
}

// ---------------------------------------------------------------------------
// Hostile plans. Every one of these is reachable by clearing a field on the
// Plan screen, which stores empty as null rather than deleting the key.
// ---------------------------------------------------------------------------
{
  const HOSTILE = [
    ['an empty plan', {}],
    ['nothing at all', undefined],
    ['every field null', Object.fromEntries(Object.keys(DEFAULT_PLAN).map(k => [k, null]))],
    ['every field an empty string', Object.fromEntries(Object.keys(DEFAULT_PLAN).map(k => [k, '']))],
    ['no expenses', { ...REACHES, annualExpenses: 0 }],
    ['no withdrawal rate', { ...REACHES, swrPct: 0 }],
    ['a negative horizon', { ...REACHES, years: -5 }],
    ['a zero horizon', { ...REACHES, years: 0 }],
    ['NaN throughout', Object.fromEntries(Object.keys(DEFAULT_PLAN).map(k => [k, NaN]))],
    ['strings where numbers belong', { ...REACHES, monthly: 'lots', growthPct: 'high' }],
    ['an absurd horizon', { ...REACHES, years: 500 }],
  ];
  for (const [name, plan] of HOSTILE) {
    let threw = null, c = null, a = null;
    try { c = crossing(plan, { thisYear: THIS_YEAR }); a = analyse(plan, { thisYear: THIS_YEAR }); }
    catch (e) { threw = e; }
    ok(`crossing and analyse survive ${name}`, threw == null, threw && threw.message);
    if (!c) continue;
    // The rule that matters: a plan with no target abstains rather than
    // producing a date. A date computed from a missing withdrawal rate is a
    // retirement year with nothing behind it.
    ok(`${name} never produces a date without a target`,
      !(c.calYear != null && !(c.target > 0)), `${c.calYear} / ${c.target}`);
    ok(`${name} explains itself when it has no target`,
      c.target != null || (typeof c.why === 'string' && c.why.length > 20), c.why);
    ok(`${name} always reports a horizon of at least one year`,
      Number.isFinite(c.horizon) && c.horizon >= 1, String(c.horizon));
    ok(`${name} never returns NaN in a printed field`,
      ![c.target, c.frac, c.years, c.calYear, c.shortfall, c.endReal]
        .some(v => typeof v === 'number' && Number.isNaN(v)),
      JSON.stringify({ t: c.target, f: c.frac, y: c.years }));
    if (a) ok(`${name} still returns both lever arrays`,
      a.controls.length + a.assumptions.length === LEVERS.length);
  }

  // A zero withdrawal rate is an infinite target. It must abstain, not divide.
  const zero = crossing({ ...REACHES, swrPct: 0 }, { thisYear: THIS_YEAR });
  ok('a zero withdrawal rate produces no target rather than Infinity',
    zero.target == null || Number.isFinite(zero.target), String(zero.target));
  ok('and says why in a sentence a person can read',
    typeof zero.why === 'string' && /withdrawal rate/i.test(zero.why), zero.why);
}

// ---------------------------------------------------------------------------
// Determinism. Sensitivity analysis that is not reproducible is not analysis,
// and `new Date()` inside a default parameter is the usual way that breaks.
// ---------------------------------------------------------------------------
{
  const a = JSON.stringify(analyse(REACHES, { thisYear: THIS_YEAR }));
  const b = JSON.stringify(analyse(REACHES, { thisYear: THIS_YEAR }));
  ok('analyse is deterministic', a === b);
  ok('the calendar year is injected, not read from the clock',
    crossing(REACHES, { thisYear: 2000 }).calYear < crossing(REACHES, { thisYear: 2100 }).calYear);
  ok('and shifting the calendar shifts only the date, never the arithmetic',
    crossing(REACHES, { thisYear: 2000 }).frac === crossing(REACHES, { thisYear: 2100 }).frac);
}

console.log(`\n${pass}/${pass + fail} passing`);
if (fail) { console.log('\nfailing:\n  ' + bad.join('\n  ')); process.exit(1); }
