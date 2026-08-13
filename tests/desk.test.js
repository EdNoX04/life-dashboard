// The Desk.
//
// This is the screen closest to becoming an advice engine, so most of these
// tests are about what it must REFUSE to say. The arithmetic is easy; the
// failure modes are all a confident sentence built on data that was not there.
//
// The single most important assertion in this file is that a metric with no
// data produces "could not tell" and never "did not fire". A scanner reporting
// "nothing fired" while a third of the book had nothing to read is the exact
// shape of reassurance this whole app is built to refuse — and unlike a wrong
// number, it leaves no trace that anything went wrong.

import {
  breadth, movers, rangePosition, consensus, consensusAgeMonths, median,
  valuationDrift, MIN_HISTORY, evaluate, validRule, ruleLabel, TEMPLATES,
  METRICS, METRIC, OPS, nextScanAt, scanAge, SCAN_INTERVAL_MIN,
  bandOf, peHistoryOf, currentPeOf,
} from '../src/lib/desk.js';

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; } else { fail++; console.log('FAIL ' + name); } };
const eq = (a, b, name) => ok(a === b, `${name} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
const near = (a, b, name, tol = 0.01) => ok(a != null && Math.abs(a - b) < tol, `${name} (got ${a}, want ${b})`);

// ------------------------------------------------------------- breadth

const BOOK = [
  { ticker: 'A', dayPct: 2, value: 100 },
  { ticker: 'B', dayPct: -1, value: 200 },
  { ticker: 'C', dayPct: 0, value: 50 },
  { ticker: 'D', dayPct: null, value: 500 },   // no quote came back
  { ticker: 'E', value: 400 },                  // field absent entirely
];
const b = breadth(BOOK);
eq(b.up, 1, 'one holding is up');
eq(b.down, 1, 'one is down');
eq(b.flat, 1, 'one is flat');
eq(b.unmeasured, 2, 'and two could not be measured at all');
eq(b.measured, 3, 'so the counts describe three positions');
eq(b.total, 5, 'out of five');
// The assertion that matters: a missing quote is never counted as flat, because
// "flat" is a measurement and "no quote" is the absence of one.
ok(b.flat !== 3, 'a holding with no quote is NOT counted as flat');
near(b.upPct, 33.33, 'the up share is of what was measured, not of the book');
eq(breadth([]).upPct, null, 'an empty book has no up share, not 0%');
eq(breadth([{ dayPct: null }]).upPct, null, 'and nor does a book where nothing could be read');

const mv = movers(BOOK, 5);
eq(mv.gainers[0].ticker, 'A', 'the biggest gainer leads');
eq(mv.losers[0].ticker, 'B', 'and the biggest faller');
eq(mv.unmeasured, 2, 'with the unquoted positions counted, not silently dropped');
ok(!mv.gainers.some(r => r.ticker === 'C'), 'a flat holding is neither a gainer nor a loser');

// ------------------------------------------------------- 52-week position

near(rangePosition(150, 100, 200), 50, 'halfway up the range reads 50');
near(rangePosition(200, 100, 200), 100, 'at the high it reads 100');
near(rangePosition(100, 100, 200), 0, 'at the low, 0');
eq(rangePosition(150, null, 200), null, 'a missing low gives null, not a guess');
eq(rangePosition(null, 100, 200), null, 'and so does a missing price');
// Corrupt data must not become a confident reading at one end of the range.
eq(rangePosition(150, 200, 100), null, 'a high below a low is corrupt, not 100%');
eq(rangePosition(150, 100, 100), null, 'a zero-width range cannot be divided into');
near(rangePosition(250, 100, 200), 100, 'a price above the high clamps rather than exceeding 100');

// --------------------------------------------------------------- analysts

const c = consensus({ buy: 28, hold: 9, sell: 2, period: '2026-07-01' });
eq(c.total, 39, 'the counts are kept');
near(c.buyPct, 71.79, 'and expressed as shares');
eq(c.divided, false, 'a clear majority is not divided');
eq(c.largest, 'buy', 'and the largest camp is named');
eq(c.period, '2026-07-01', 'with the month the brokers filed in — never dropped');

// The case a one-word summary would actively misrepresent.
const split = consensus({ buy: 12, hold: 6, sell: 11 });
eq(split.divided, true, 'no camp over half is flagged as divided');
eq(split.largest, 'buy', 'even though "buy" is still technically the largest');
ok(split.sellPct > 37, 'while more than a third say sell — which is the part a verdict would delete');

eq(consensus(null), null, 'no data gives null');
eq(consensus({ buy: 0, hold: 0, sell: 0 }), null, 'and so does a filing with no analysts in it');

eq(consensusAgeMonths('2026-05-01', new Date('2026-08-13')), 3, 'a consensus can be three months old');
eq(consensusAgeMonths(null), null, 'an undated one has no age rather than an age of zero');
eq(consensusAgeMonths('rubbish'), null, 'and neither does an unparseable one');

// --------------------------------------------------------------- valuation

eq(median([3, 1, 2]), 2, 'the median sorts first');
near(median([1, 2, 3, 4]), 2.5, 'and averages the middle pair when even');
eq(median([]), null, 'an empty list has no median');

const hist = [18, 20, 22, 19, 21, 23].map((v, i) => ({ period: `202${i}`, v }));
const vd = valuationDrift(hist, 30);
eq(vd.enough, true, 'six observations is enough for a median');
near(vd.median, 20.5, 'which is computed from them');
near(vd.vsMedian, 46.34, 'and the current multiple sits well above it');
eq(vd.n, 6, 'with the number of observations reported alongside');

// Decision 3: too little history returns no number at all, rather than a
// statistic-shaped statement built on three points.
const thin = valuationDrift([{ v: 10 }, { v: 12 }, { v: 11 }], 30);
eq(thin.enough, false, 'three observations is not a history');
eq(thin.vsMedian, null, 'so no drift figure is produced');
eq(thin.median, null, 'and no median is quoted either');
eq(thin.need, MIN_HISTORY, 'the screen is told how many it would need');
ok(MIN_HISTORY >= 4, 'and the floor is high enough that "median" means something');

eq(valuationDrift(hist, null), null, 'no current multiple, no comparison');
eq(valuationDrift(hist, 0), null, 'a zero multiple is not a valuation');
eq(valuationDrift(hist, -5), null, 'and neither is a negative one');
ok(valuationDrift([{ v: 0 }, { v: -3 }, ...hist], 30).n === 6,
  'non-positive history points are dropped rather than dragging the median');

// ------------------------------------------------- reading the saved blob

// The saved fundamentals blob, shaped as Finnhub actually returns it.
const ENTRY = {
  metric: { '52WeekHigh': 220, '52WeekLow': 140, peTTM: 31.4 },
  series: { annual: { peTTM: [
    { period: '2021-12-31', v: 22 }, { period: '2022-12-31', v: 18 },
    { period: '2023-12-31', v: 25 }, { period: '2024-12-31', v: 27 },
    { period: '2025-12-31', v: 24 },
  ] } },
};
eq(bandOf(ENTRY).high, 220, 'the 52-week high is read off the saved metric');
eq(bandOf(ENTRY).low, 140, 'and the low');
eq(bandOf(null).high, null, 'an absent entry gives nulls, not zeros');
eq(bandOf({ metric: {} }).low, null, 'and so does an entry with no band in it');

eq(peHistoryOf(ENTRY).length, 5, 'the multiple history comes back');
eq(peHistoryOf(ENTRY)[0].period, '2021-12-31', 'oldest first, so a chart reads left to right');
eq(currentPeOf(ENTRY), 31.4, 'and the current multiple is read too');
eq(peHistoryOf({}).length, 0, 'no series gives an empty history rather than throwing');
eq(currentPeOf({}), null, 'and no current multiple gives null');

// The alternate spellings Finnhub uses. Assuming one name is how a panel ends
// up permanently empty while looking like the company simply has no history.
eq(currentPeOf({ metric: { peBasicExclExtraTTM: 19 } }), 19, 'an alternate spelling of the multiple is found');
eq(bandOf({ metric: { weekHigh52: 90 } }).high, 90, 'and of the 52-week high');

// Annual beats quarterly: a quarterly median describes the noise as much as
// the level.
const both = { series: { annual: { peTTM: [{ period: 'a', v: 1 }] }, quarterly: { peTTM: [{ period: 'b', v: 2 }] } } };
eq(peHistoryOf(both)[0].v, 1, 'annual is preferred over quarterly');

// End to end: the saved blob straight into the drift figure.
const endToEnd = valuationDrift(peHistoryOf(ENTRY), currentPeOf(ENTRY));
eq(endToEnd.enough, true, 'five annual observations clears the floor exactly');
near(endToEnd.median, 24, 'the median of its own history');
near(endToEnd.vsMedian, 30.83, 'and the current multiple sits above it');
near(rangePosition(200, bandOf(ENTRY).low, bandOf(ENTRY).high), 75,
  'and the price sits three-quarters up its own 52-week range');

// ------------------------------------------------------------ rule engine

// Decision 4: nothing is active out of the box.
ok(Array.isArray(TEMPLATES) && TEMPLATES.length > 0, 'templates exist so the builder is not blank');
ok(TEMPLATES.every(t => t.enabled === undefined), 'and not one of them ships enabled');
ok(TEMPLATES.every(t => METRIC[t.metric] && OPS[t.op]), 'every template is a rule the engine can run');
ok(METRICS.every(m => m.note && m.note.length > 20), 'every metric explains what it measures');
ok(METRICS.every(m => m.view), 'and names the screen where you can check it');

eq(validRule({ metric: 'weight', op: 'above', value: 25 }), true, 'a complete rule is valid');
eq(validRule({ metric: 'nope', op: 'above', value: 25 }), false, 'an unknown metric is not');
eq(validRule({ metric: 'weight', op: 'sideways', value: 25 }), false, 'nor an unknown comparison');
eq(validRule({ metric: 'weight', op: 'above', value: null }), false, 'nor a missing threshold');
eq(validRule({ metric: 'weight', op: 'above', value: 0 }), true, 'but zero is a real threshold');
ok(/25%/.test(ruleLabel({ metric: 'weight', op: 'above', value: 25 })), 'a rule reads as a sentence');

const ROWS = [
  { ticker: 'BIG', name: 'Big Co', weight: 40, dayPct: 1 },
  { ticker: 'MID', name: 'Mid Co', weight: 10, dayPct: -8 },
  { ticker: 'DARK', name: 'Dark Co', weight: null, dayPct: null },
];
const RULES = [
  { id: 'r1', metric: 'weight', op: 'above', value: 25 },
  { id: 'r2', metric: 'dayPct', op: 'below', value: -5 },
];
const ev = evaluate(RULES, ROWS);
eq(ev.fired.length, 2, 'two rules fired, one holding each');
ok(ev.fired.some(f => f.ticker === 'BIG' && f.rule.id === 'r1'), 'the oversized position tripped the weight rule');
ok(ev.fired.some(f => f.ticker === 'MID' && f.rule.id === 'r2'), 'the faller tripped the move rule');
eq(ev.active, 2, 'both rules were active');

// THE ASSERTION THIS FILE EXISTS FOR.
eq(ev.blind, 2, 'the holding with no data is counted as could-not-tell, twice — once per rule');
ok(ev.unmeasured.every(u => u.ticker === 'DARK'), 'and it is named');
ok(!ev.fired.some(f => f.ticker === 'DARK'), 'it never fires');
// The inverse, stated separately because it is the half people forget: a blind
// check must not be quietly counted as a pass either.
eq(ev.attempted, 6, 'six checks were attempted');
ok(ev.blind > 0 && ev.fired.length + ev.blind < ev.attempted,
  'so fired + blind + passed accounts for all of them, with blind visible in the middle');

eq(evaluate([{ id: 'x', metric: 'weight', op: 'above', value: 25, enabled: false }], ROWS).active, 0,
  'a disabled rule does not run');
eq(evaluate([{ id: 'x', metric: 'junk', op: 'above', value: 1 }], ROWS).active, 0,
  'and an invalid one is dropped rather than throwing');
eq(evaluate([], ROWS).fired.length, 0, 'no rules, nothing fired');
eq(evaluate([], ROWS).blind, 0, 'and nothing blind either — there was nothing to be blind about');
eq(evaluate(RULES, []).fired.length, 0, 'no holdings, nothing fired');

// Ordering is reproducible from the numbers, not from my ranking of topics.
const ord = evaluate(
  [{ id: 'r1', metric: 'weight', op: 'above', value: 25 }],
  [{ ticker: 'A', weight: 30 }, { ticker: 'B', weight: 60 }, { ticker: 'C', weight: 26 }],
);
eq(ord.fired.map(f => f.ticker).join(''), 'BAC', 'findings are ordered by distance past the threshold');

// Every fired result carries the threshold it passed, so the row can show its
// own working rather than asserting a conclusion.
ok(ev.fired.every(f => f.threshold != null && f.value != null), 'each hit carries both value and threshold');

// byRule lets the UI show a rule that ran and caught nothing — which is
// different from a rule that could not be evaluated, and both are different
// from a rule that fired.
const quiet = evaluate([{ id: 'q', metric: 'weight', op: 'above', value: 99 }], ROWS);
eq(quiet.byRule[0].hits.length, 0, 'a rule can run and catch nothing');
eq(quiet.byRule[0].blind, 1, 'while still being blind to the holding it could not read');

// ------------------------------------------------------------- the clock

const T0 = new Date('2026-08-13T14:00:00Z');
eq(nextScanAt(null, { now: T0 }).due, true, 'never having scanned means one is due');
eq(nextScanAt('rubbish', { now: T0 }).due, true, 'and so does an unparseable stamp');

const justRan = new Date(+T0 - 5 * 60000).toISOString();
eq(nextScanAt(justRan, { now: T0 }).due, false, 'five minutes after a scan, none is due');
const longAgo = new Date(+T0 - 45 * 60000).toISOString();
eq(nextScanAt(longAgo, { now: T0 }).due, true, 'forty-five minutes later, one is');
eq(SCAN_INTERVAL_MIN, 30, 'the interval is thirty minutes');

// Decision 6: the clock stops when the market does, rather than burning quota
// overnight on prices that cannot move.
const closed = nextScanAt(longAgo, { now: T0, marketOpen: false });
eq(closed.due, false, 'with the market closed nothing is due however long it has been');
ok(/closed/.test(closed.reason), 'and the reason says so rather than looking like a bug');

eq(scanAge(new Date(+T0 - 90 * 60000).toISOString(), T0), 90, 'a scan can be an hour and a half old');
eq(scanAge(null), null, 'and an absent scan has no age rather than an age of zero');

// --------------------------------------------------- hostile inputs

// The Desk mounts inside the Money tab's single error boundary, so a throw here
// blanks the whole tab — the Yield crash, again, in a new place. These are the
// shapes a half-loaded blob or a failed fetch actually produces.
{
  const HOSTILE = [
    ['empty everything', [], []],
    ['rows with no fields', [{}, {}], [{ id: 'a', metric: 'weight', op: 'above', value: 1 }]],
    ['null rows', [null, undefined], [{ id: 'a', metric: 'weight', op: 'above', value: 1 }]],
    ['NaN metrics', [{ ticker: 'X', weight: NaN, dayPct: NaN, value: NaN }], [{ id: 'a', metric: 'weight', op: 'above', value: 1 }]],
    ['Infinity', [{ ticker: 'X', weight: Infinity, dayPct: Infinity, value: Infinity }], [{ id: 'a', metric: 'weight', op: 'above', value: 1 }]],
    ['string metrics', [{ ticker: 'X', weight: 'lots', dayPct: 'up' }], [{ id: 'a', metric: 'weight', op: 'above', value: 1 }]],
    ['null rules', [{ ticker: 'X', weight: 30 }], [null, undefined]],
    ['rule with no id', [{ ticker: 'X', weight: 30 }], [{ metric: 'weight', op: 'above', value: 1 }]],
  ];
  for (const [name, rws, rls] of HOSTILE) {
    let threw = null, out = null;
    try {
      out = { b: breadth(rws), m: movers(rws), e: evaluate(rls, rws) };
    } catch (e) { threw = e; }
    ok(threw == null, `the desk survives ${name}${threw ? `: ${threw.message}` : ''}`);
    if (!out) continue;
    // A garbage row may produce nothing. It may NOT produce a number, because a
    // reading computed from NaN looks exactly like one computed from data.
    ok(!Number.isNaN(out.b.upPct), `${name} produces no NaN breadth`);
    ok(out.e.fired.every(f => Number.isFinite(f.value)),
      `${name} fires nothing on an unreadable value`);
  }

  // NaN and Infinity are NOT values. Both must land in could-not-tell, not in
  // fired and not in passed — Infinity above all, because `Infinity > 25` is
  // true and would fire every rule on a corrupt row.
  const nan = evaluate([{ id: 'a', metric: 'weight', op: 'above', value: 25 }], [{ ticker: 'X', weight: NaN }]);
  eq(nan.blind, 1, 'a NaN metric is could-not-tell');
  eq(nan.fired.length, 0, 'and never fires');
  const inf = evaluate([{ id: 'a', metric: 'weight', op: 'above', value: 25 }], [{ ticker: 'X', weight: Infinity }]);
  eq(inf.fired.length, 0, 'an Infinity metric does not fire, though it compares as greater');
  eq(inf.blind, 1, 'it is could-not-tell too');
}

console.log(`${pass}/${pass + fail} passing`);
if (fail) process.exit(1);
