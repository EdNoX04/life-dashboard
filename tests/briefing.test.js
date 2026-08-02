// Run: bun tests/briefing.test.js
//
// The rules engine. This is the suite that guards the four decisions the
// briefing was built on, and each of them is a decision that degrades silently
// if nothing checks it:
//
//   1. A rule with no data ABSTAINS and says what it needed. It never falls
//      back to a default and reports the default as a finding. Coverage — the
//      share of rules that actually ran — is returned beside every result so a
//      briefing built on three rules cannot look like one built on twenty.
//   2. Every rule cites the SOURCE of its threshold, and the three bases are
//      distinct: `yours` (a figure you typed), `convention` (published outside
//      this app), `stated` (a ladder this app publishes on its own screen).
//   3. No rule ever says what to do. It states what is true and where the
//      number came from. This is not a stylistic preference — personalised
//      investment advice is the one thing this app is not allowed to give.
//   4. Severity is distance past the threshold measured in the rule's own band
//      widths, so a 26% position and a 26% drawdown can be ordered against
//      each other without pretending they are the same kind of number.
//
// It lives in tests/ rather than /tmp because the container has been reclaimed
// six times and taken this suite with it every time.

import fs from 'fs';
import path from 'path';
import { RULES, BASIS, brief, SEVERITY, termCrossings } from '../src/lib/briefing.js';
import { MONEY_VIEWS, MONEY_SECTIONS, sectionOf } from '../src/lib/moneynav.js';

let pass = 0, fail = 0;
const bad = [];
const ok = (name, cond, got) => {
  if (cond) pass++;
  else { fail++; bad.push(name); console.log('FAIL', name, got === undefined ? '' : `— ${got}`); }
};

const here = new URL('.', import.meta.url).pathname;

// ---------------------------------------------------------------------------
// Every rule carries a `view` that the Briefing turns into a click-through. A
// typo there produces a dead link, not an error — so the valid set is DERIVED
// from the Money tab's own navigation rather than transcribed. A transcribed
// list would go stale the first time a view is renamed and would then approve
// exactly the broken links it exists to catch.
//
// This used to scrape setView('x') literals out of Money.jsx with a regex, and
// that is precisely the failure the comment above warns about: when the nav
// became data and the buttons were generated in a loop, the literals vanished
// and the derived set would have silently emptied. Importing the real list
// cannot drift that way.
// ---------------------------------------------------------------------------
const VIEWS = new Set(MONEY_VIEWS);
ok('the view set was derived, not empty', VIEWS.size > 15, String(VIEWS.size));
ok('no view id is listed in two sections at once', VIEWS.size === MONEY_VIEWS.length,
  `${VIEWS.size} unique of ${MONEY_VIEWS.length}`);
// Every section must be reachable and non-empty, or its marquee button lands on
// undefined and the view row renders blank.
for (const sec of MONEY_SECTIONS) {
  ok(`section ${sec.id} has views`, sec.views.length > 0);
  ok(`section ${sec.id} has a label`, typeof sec.label === 'string' && sec.label.length > 0);
  for (const v of sec.views) {
    ok(`${sec.id}/${v.id} round-trips to its own section`, sectionOf(v.id) === sec.id, sectionOf(v.id));
  }
}
// An unknown view must still resolve, so a stale stored value cannot blank the strip.
ok('an unknown view falls back to a real section',
  MONEY_SECTIONS.some(s2 => s2.id === sectionOf('no-such-view')), sectionOf('no-such-view'));

// ---------------------------------------------------------------------------
// Shape.
// ---------------------------------------------------------------------------
ok('there are twenty rules', RULES.length === 20, String(RULES.length));
ok('every id is unique', new Set(RULES.map(r => r.id)).size === RULES.length);

for (const r of RULES) {
  ok(`${r.id} has a topic`, typeof r.topic === 'string' && r.topic.length > 0);
  ok(`${r.id} routes to a view that exists`, VIEWS.has(r.view), r.view);
  ok(`${r.id} declares a basis that exists`, BASIS[r.basis] != null, r.basis);
  // The floor is deliberately low. `data.price` needs 'holdings' and there is
  // nothing honest to add to that; a longer minimum would only have bought
  // padding. What is being checked is that the field is a phrase that completes
  // "Needs ___", not that it is verbose.
  ok(`${r.id} says what it needs`, typeof r.needs === 'string' && /^[a-z]/.test(r.needs) && r.needs.length > 5, r.needs);
  // A citation short enough to be a label is not a citation. Decision 2 is only
  // worth anything if the cite names where the number came from, and 60
  // characters is roughly the floor for doing that in a sentence.
  ok(`${r.id} cites the source of its threshold`, typeof r.cite === 'string' && r.cite.length > 60,
    r.cite && String(r.cite.length));
  ok(`${r.id} is runnable`, typeof r.run === 'function');
}

// ---------------------------------------------------------------------------
// Decision 1 — abstention. An empty context must produce twenty abstentions,
// zero findings, and a coverage of zero. The failure this prevents is the
// worst one available to the whole tab: a briefing that reads as "all clear"
// when what happened is that nothing ran.
// ---------------------------------------------------------------------------
{
  const b = brief({});
  ok('an empty context produces no findings', b.flags.length === 0, String(b.flags.length));
  ok('an empty context produces no clear results', b.clear.length === 0, String(b.clear.length));
  ok('an empty context skips every rule', b.skipped.length === 20, String(b.skipped.length));
  ok('an empty context reports zero coverage', b.coverage === 0, String(b.coverage));
  ok('and reports that nothing ran', b.ran === 0, String(b.ran));
  ok('every abstention says what it needed',
    b.skipped.every(s => /^Needs \S.*\.$/.test(s.why)),
    b.skipped.find(s => !/^Needs /.test(s.why))?.why);
  ok('no abstention is marked as broken', b.skipped.every(s => !s.broke));
  // brief() with no argument at all — the literal first render.
  let threw = null;
  try { brief(); } catch (e) { threw = e; }
  ok('brief() survives being called with nothing', threw == null, threw && threw.message);
}

// ---------------------------------------------------------------------------
// The two contexts. Every figure here is a value the app can actually produce;
// nothing is a fuzz case.
// ---------------------------------------------------------------------------
const HELD_PRICED = [
  { ticker: 'A', qty: 100, last_price: 1500, avg_cost: 1000, __px: 1500 },
  { ticker: 'B', qty: 50, last_price: 1800, avg_cost: 2000, __px: 1800 },
  { ticker: 'C', qty: 20, last_price: 900, avg_cost: 800, __px: 900 },
  { ticker: 'D', qty: 10, last_price: 400, avg_cost: 500, __px: 400 },
];

const FIRING = {
  cur: '₹',
  held: [...HELD_PRICED.slice(0, 3), { ticker: 'D', qty: 10, last_price: null, avg_cost: 500, __px: 500 }],
  conc: { top1: 42, effectiveN: 1.4 },
  drift: { targeted: 3, untargeted: 2, actionable: 2, band: 5, turnoverPct: 12,
    worst: { label: 'Equity', driftPp: 14 } },
  alloc: { Equity: 700000 },
  bookValue: 1000000, untagged: 300000,
  tilt: { coverage: 0.3 },
  cash: { avgs: { spend: 50000, savingsRate: 40, months: 6 },
    fixed: { fixedPct: 64, fixed: 64000, total: 100000 } },
  liquid: 100000, monthRate: 10,
  profile: { health: { score: 38, grade: { label: 'Fragile' } } },
  stats: { drawdown: { current: -0.18, maxDD: -0.22 } },
  crossings: [{ ticker: 'A', days: 12 }],
  taxInfo: { fyLabel: 'FY 2026-27', position: { ltcgGain: 110000, exemption: 125000 } },
  income: { year: 60000 },
  divLines: [{ ticker: 'A', income: 9000 }, { ticker: 'B', income: 1000 }],
  plan: { onTrack: false, shortfall: 2000000, target: 10000000, projected: 8000000, byYear: 2035 },
  fire: 20000000, netWorth: 2400000, swr: 3,
  fireDate: { target: 24000000, reachable: false, shortfall: 5000000, horizon: 40 },
  planSpend: 720000, observedSpend: 900000,
};

const HEALTHY = {
  cur: '₹',
  held: HELD_PRICED,
  conc: { top1: 18, effectiveN: 3.6 },
  drift: { targeted: 4, untargeted: 0, actionable: 0, band: 5, turnoverPct: 2,
    worst: { label: 'Equity', driftPp: 2 } },
  alloc: { Equity: 1000000 },
  bookValue: 1000000, untagged: 0,
  tilt: { coverage: 0.82 },
  cash: { avgs: { spend: 50000, savingsRate: 40, months: 6 },
    fixed: { fixedPct: 31, fixed: 31000, total: 100000 } },
  liquid: 400000, monthRate: 38,
  profile: { health: { score: 74, grade: { label: 'Sturdy' } } },
  stats: { drawdown: { current: -0.04, maxDD: -0.22 } },
  crossings: [],
  taxInfo: { fyLabel: 'FY 2026-27', position: { ltcgGain: 40000, exemption: 125000 } },
  income: { year: 600000 },
  // Five payers, largest at 21.8%. Four payers put the largest at 26% and
  // tripped div.source — the fixture, not the rule, and worth the comment
  // because "a healthy book has four dividend payers" is an easy thing to
  // assume and a 25% single-source convention quietly disagrees.
  divLines: [{ ticker: 'A', income: 2400 }, { ticker: 'B', income: 2300 },
    { ticker: 'C', income: 2200 }, { ticker: 'D', income: 2100 },
    { ticker: 'E', income: 2000 }],
  plan: { onTrack: true, shortfall: -1500000, target: 10000000, projected: 11500000, byYear: 2035 },
  fire: 20000000, netWorth: 24000000, swr: 3,
  fireDate: { target: 24000000, reachable: true, calYear: 2058, years: 32 },
  planSpend: 720000, observedSpend: 720000,
};

// The three rules that report and never fire. They are listed explicitly rather
// than inferred, because "this rule can never fire" is a deliberate choice made
// three times for a stated reason — any threshold there would be mine, not
// Neel's — and a rule quietly acquiring or losing that property should break
// this suite rather than pass it.
const ALWAYS_OK = ['div.coverage', 'plan.fire', 'plan.spendgap'];
const FIREABLE = RULES.map(r => r.id).filter(id => !ALWAYS_OK.includes(id));

{
  const b = brief(FIRING);
  ok('a fully populated context runs every rule', b.ran === 20, `${b.ran} of ${b.total}`);
  ok('and abstains from none', b.skipped.length === 0,
    b.skipped.map(s => s.id).join(', '));
  ok('and reports full coverage', Math.round(b.coverage) === 100, String(b.coverage));

  const fired = new Set(b.flags.map(f => f.id));
  for (const id of FIREABLE) ok(`${id} fires on a context built to trip it`, fired.has(id));
  for (const id of ALWAYS_OK) ok(`${id} reports rather than fires`, !fired.has(id));

  // Decision 4. Severity must exist, be finite, and order the list.
  ok('every finding carries a severity', b.flags.every(f => Number.isFinite(f.severity)),
    JSON.stringify(b.flags.find(f => !Number.isFinite(f.severity))?.id));
  const sevs = b.flags.map(f => f.severity);
  ok('findings are ordered by severity, worst first',
    sevs.every((s, i) => i === 0 || sevs[i - 1] >= s), sevs.join(' '));
  ok('severity is distance past threshold in band widths — not the raw excess',
    b.flags.every(f => !(f.band > 0) || Math.abs(f.severity - f.over / f.band) < 1e-9));
  ok('every severity maps to a label', b.flags.every(f => SEVERITY(f.severity)?.label));
  ok('every finding carries its basis note',
    b.flags.every(f => f.basisInfo && f.basisInfo.note && f.basisInfo.label));
}

{
  const b = brief(HEALTHY);
  ok('a healthy context runs every rule', b.ran === 20, `${b.ran} of ${b.total}`);
  ok('and finds nothing', b.flags.length === 0, b.flags.map(f => f.id).join(', '));
  ok('and reports all twenty as clear', b.clear.length === 20, String(b.clear.length));
  ok('the always-report rules still appear when clear',
    ALWAYS_OK.every(id => b.clear.some(c => c.id === id)));
  ok('a reachable crossing prints a date rather than a shortfall',
    b.clear.find(c => c.id === 'plan.date')?.headline.includes('2058'),
    b.clear.find(c => c.id === 'plan.date')?.headline);
}

// ---------------------------------------------------------------------------
// Decision 3 — no advice. Checked against the text every rule actually emits
// in BOTH states, not against the source, because a rule can be blameless in
// its firing branch and prescriptive in its clear branch.
//
// The vocabulary is deliberately narrow. A wide net ("sell", "buy") would flag
// "the Rebalance screen shows what to sell" — naming where a figure lives is
// not advising an action — and a check that cries wolf gets deleted. What is
// banned is the second person plus a directive.
// ---------------------------------------------------------------------------
{
  const BANNED = [
    /\byou should\b/i, /\byou ought\b/i, /\byou need to\b/i, /\bwe recommend\b/i,
    /\bI recommend\b/i, /\bwe suggest\b/i, /\bconsider (?:selling|buying|trimming|adding|moving|switching)\b/i,
    /\bit would be wise\b/i, /\bthe best (?:move|option|choice)\b/i, /\bmust (?:sell|buy|move)\b/i,
    /\badvis(?:e|able)\b/i,
  ];
  const rows = [...brief(FIRING).flags, ...brief(FIRING).clear,
    ...brief(HEALTHY).flags, ...brief(HEALTHY).clear];
  ok('both states between them produced text for every rule',
    new Set(rows.map(r => r.id)).size === 20, String(new Set(rows.map(r => r.id)).size));
  for (const r of rows) {
    const text = `${r.headline} ${r.detail}`;
    const hit = BANNED.find(re => re.test(text));
    ok(`${r.id} states what is true without prescribing`, !hit, hit && text.slice(0, 110));
  }
  for (const r of RULES) {
    const hit = BANNED.find(re => re.test(r.cite));
    ok(`${r.id}'s citation prescribes nothing`, !hit, hit && r.cite.slice(0, 110));
  }
}

// ---------------------------------------------------------------------------
// Decision 2 — the three bases are distinct and each is used. A basis that no
// rule uses is a category that has quietly stopped meaning anything, and a
// build where every rule claims `yours` would be citing Neel for conventions
// he never chose.
// ---------------------------------------------------------------------------
{
  const used = new Set(RULES.map(r => r.basis));
  for (const k of Object.keys(BASIS)) ok(`the '${k}' basis is actually used`, used.has(k));
  ok('every basis carries a note explaining itself',
    Object.values(BASIS).every(v => v.note && v.note.length > 40 && v.label && v.color));
  // The specific confusion worth pinning: a statutory figure is never `yours`.
  ok('tax rules cite convention, never your own number',
    RULES.filter(r => r.topic === 'Tax').every(r => r.basis === 'convention'));
}

// ---------------------------------------------------------------------------
// A broken rule must be visible, not silent. `brief` catches a throwing rule so
// one bad rule cannot take the other nineteen down — but the catch is only
// defensible if the failure surfaces, so it lands in SKIPPED marked `broke`.
// ---------------------------------------------------------------------------
{
  const poison = { id: 'test.poison', topic: 'Test', view: 'book', basis: 'stated',
    needs: 'nothing at all', cite: 'x'.repeat(70),
    run: () => { throw new Error('deliberate'); } };
  RULES.push(poison);
  try {
    const b = brief(HEALTHY);
    ok('a throwing rule does not take the others down', b.clear.length === 20, String(b.clear.length));
    const broken = b.skipped.find(s => s.id === 'test.poison');
    ok('a throwing rule lands in skipped', broken != null);
    ok('and is marked as broken rather than as merely lacking data', broken?.broke === true);
    ok('and carries the error text', /deliberate/.test(broken?.why || ''), broken?.why);
    ok('and is not counted as having run', b.ran === 20, String(b.ran));
    ok('and drags coverage down rather than being excused',
      b.coverage < 100 && b.coverage > 90, String(b.coverage));
  } finally {
    RULES.pop();
  }
  ok('the poison rule was removed again', RULES.length === 20, String(RULES.length));
}

// ---------------------------------------------------------------------------
// Hostile contexts. Every one of the three bugs found in buildContext produced
// a quiet abstention rather than a throw, which is exactly why abstention has
// to be deliberate and total: if a malformed blob could throw, that would have
// been a louder signal than what actually happened.
// ---------------------------------------------------------------------------
{
  const HOSTILE = [
    ['null everywhere', Object.fromEntries(Object.keys(FIRING).map(k => [k, null]))],
    ['arrays where objects belong', { conc: [], drift: [], cash: [], stats: [], plan: [], taxInfo: [] }],
    ['strings where numbers belong', { ...FIRING, bookValue: 'lots', netWorth: 'x', swr: 'three' }],
    ['NaN everywhere it matters', { ...FIRING, bookValue: NaN, liquid: NaN, monthRate: NaN, netWorth: NaN }],
    ['Infinity', { ...FIRING, bookValue: Infinity, liquid: Infinity, fire: Infinity }],
    ['zero book', { ...FIRING, bookValue: 0, netWorth: 0, liquid: 0, untagged: 0 }],
    ['negative book', { ...FIRING, bookValue: -1, netWorth: -50000 }],
    ['empty arrays', { ...FIRING, held: [], crossings: [], divLines: [] }],
    ['rows missing every field', { ...FIRING, held: [{}, {}], divLines: [{}, {}] }],
  ];
  for (const [name, ctx] of HOSTILE) {
    let threw = null, b = null;
    try { b = brief(ctx); } catch (e) { threw = e; }
    ok(`brief survives ${name}`, threw == null, threw && threw.message);
    if (!b) continue;
    ok(`${name} breaks no rule`, b.skipped.every(s => !s.broke),
      b.skipped.filter(s => s.broke).map(s => `${s.id}: ${s.why}`).join(' | '));
    // The real assertion. A garbage context is allowed to produce nothing; it is
    // NOT allowed to produce a number, because a finding computed from NaN reads
    // exactly like a finding computed from data.
    ok(`${name} produces no headline containing NaN or undefined`,
      [...b.flags, ...b.clear].every(r => !/NaN|undefined|Infinity/.test(`${r.headline} ${r.detail}`)),
      [...b.flags, ...b.clear].find(r => /NaN|undefined|Infinity/.test(`${r.headline} ${r.detail}`))?.id);
  }
}

// ---------------------------------------------------------------------------
// A null row inside `held` gets its own block rather than a line in the list
// above, because it is not the same kind of input. `useCollection` holds items
// in useState([]) and fills them from a Supabase select, so a null ROW is not a
// state this app can reach — same category as the `null everywhere` shape the
// sweep removed rather than satisfied. Adding `.filter(Boolean)` to three rules
// would widen three contracts that are currently exact, to catch nothing.
//
// So what is asserted here is not that nothing breaks. It is that when
// something impossible does arrive, the containment holds: the affected rules
// land in SKIPPED marked `broke`, the other seventeen still run, coverage falls
// to say so, and the screen does not white out. That is the property worth
// having, and it is stronger than the guards would have been.
// ---------------------------------------------------------------------------
{
  const b = brief({ ...FIRING, held: [null, undefined] });
  const broke = b.skipped.filter(s => s.broke);
  ok('an impossible row breaks only the rules that read rows',
    broke.length > 0 && broke.every(s => ['conc.top1', 'conc.spread', 'data.price'].includes(s.id)),
    broke.map(s => s.id).join(', '));
  ok('the other rules still run', b.ran >= 17, String(b.ran));
  ok('and coverage falls rather than the failure being excused',
    b.coverage < 100, String(b.coverage));
  ok('the breakage is labelled as breakage, not as missing data',
    broke.every(s => /failed to run/.test(s.why)));
  ok('and no finding is emitted from the broken rules',
    ![...b.flags, ...b.clear].some(r => broke.some(s => s.id === r.id)));
}

// ---------------------------------------------------------------------------
// termCrossings — pure calendar arithmetic over Neel's own orders. The rule it
// feeds says "this lot changes classification on this date" and stops there.
// ---------------------------------------------------------------------------
{
  const asOf = new Date('2026-07-13T00:00:00Z');
  const day = 86400000;
  const at = back => new Date(asOf.getTime() - back * day).toISOString().slice(0, 10);

  const orders = [
    { id: 1, ticker: 'A', side: 'buy', qty: 10, date: at(330) },   // crosses in 35 days
    { id: 2, ticker: 'B', side: 'buy', qty: 10, date: at(400) },   // already long-term
    { id: 3, ticker: 'C', side: 'buy', qty: 10, date: at(30) },    // far away
  ];
  const cr = termCrossings(orders, { asOf });
  ok('termCrossings returns an array', Array.isArray(cr));
  ok('a lot inside the window is reported', cr.some(c => c.ticker === 'A'), JSON.stringify(cr));
  // The deliberate exclusion, and the reason it is deliberate: a lot that has
  // already crossed is not approaching anything. Reporting it would turn a
  // calendar notice into a standing nag about a fact that will never change.
  ok('a lot that already crossed is not reported as approaching',
    !cr.some(c => c.ticker === 'B'), JSON.stringify(cr));
  ok('a lot far outside the window is not reported', !cr.some(c => c.ticker === 'C'));
  ok('crossings are ordered soonest first',
    cr.every((c, i) => i === 0 || cr[i - 1].days <= c.days), cr.map(c => c.days).join(' '));
  ok('every crossing carries a day count inside the window',
    cr.every(c => Number.isFinite(c.days) && c.days >= 0 && c.days <= 60));

  let threw = null;
  try { termCrossings(); termCrossings([]); termCrossings([null, {}, { date: 'nonsense' }], { asOf }); }
  catch (e) { threw = e; }
  ok('termCrossings survives no orders and malformed ones', threw == null, threw && threw.message);

  // A foreign holding has a different statutory period, and the classifier is
  // injected rather than inferred from the ticker — inferring it from a suffix
  // would be this app deciding a tax question it has no business deciding.
  const foreign = termCrossings(
    [{ id: 4, ticker: 'VOO', side: 'buy', qty: 1, date: at(700) }],
    { asOf, foreignOf: t => t === 'VOO' });
  ok('the foreign holding period is applied when the classifier says so',
    foreign.some(c => c.ticker === 'VOO'), JSON.stringify(foreign));
  const domestic = termCrossings(
    [{ id: 4, ticker: 'VOO', side: 'buy', qty: 1, date: at(700) }], { asOf });
  ok('and is not applied when it does not', !domestic.some(c => c.ticker === 'VOO'),
    JSON.stringify(domestic));
}

console.log(`\n${pass}/${pass + fail} passing`);
if (fail) { console.log('\nfailing:\n  ' + bad.join('\n  ')); process.exit(1); }
