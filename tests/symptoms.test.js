// Symptom episodes — and mostly, what this file REFUSES to say.
//
// One person, a few episodes, a dozen metrics. That is a machine for producing
// coincidences that read as findings, and the danger is not that a number is
// slightly off: it is that "you slept 5.8h on fever days and 7.1h otherwise"
// gets believed, quoted, and acted on, from a sample that cannot support it.
// Being ill also wrecks your sleep, so the arrow probably points the other way.
//
// So the tests that matter most here are the ones asserting that nothing is
// shown at all below the thresholds — not that a warning is shown beside it.

import {
  normaliseEpisode, isOngoing, spanDays, datesOf, severitySeries, trend,
  medsDuring, compare, compareAll, enoughHistory, describe, severityWord,
  ENOUGH, MIN_EPISODES, MIN_TREND_POINTS,
} from '../src/lib/symptoms.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log('FAIL ' + n); } };
const eq = (a, b, n) => ok(Object.is(a, b), `${n} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const TODAY = '2026-09-12';
const FEVER = normaliseEpisode({
  id: 'f1', name: 'Fever', from: '2026-09-08', to: '2026-09-11',
  severity: { '2026-09-08': 7, '2026-09-09': 8, '2026-09-10': 4, '2026-09-11': 2 },
});

// ------------------------------------------------------------- the episode
{
  eq(spanDays(FEVER, TODAY), 4, 'an episode is counted inclusively at both ends');
  eq(datesOf(FEVER, TODAY).length, 4, 'and covers those four dates');
  ok(!isOngoing(FEVER, TODAY), 'one that ended yesterday is not ongoing');

  const open = normaliseEpisode({ name: 'Cough', from: '2026-09-10' });
  ok(isOngoing(open, TODAY), 'an episode with no end date is ONGOING');
  eq(open.to, null, 'and stays open — defaulting `to` to today would silently close every episode as it was written');
  eq(spanDays(open, TODAY), 3, 'its length runs to today');

  eq(spanDays({ name: 'x' }, TODAY), null, 'no start date means no length, rather than a length of zero');
}

// ------------------------------------------------ a blank day is not a zero
{
  const ep = normaliseEpisode({ name: 'Flu', from: '2026-09-10', to: '2026-09-12', severity: { '2026-09-10': 6, '2026-09-12': 3 } });
  const s = severitySeries(ep, TODAY);
  eq(s.length, 3, 'every day of the episode is in the series');
  eq(s[1].value, null, 'a day you did not score is NULL, not 0');
  ok(s[1].value !== 0, 'because 0 means "it was gone that day", and drawing them the same shows a recovery that never happened');
  eq(severityWord(0), 'gone', 'zero has its own word');
  eq(severityWord(8), 'bad', 'and the scale reads in English');
  eq(normaliseEpisode({ severity: { '2026-09-10': 99 } }).severity['2026-09-10'], 10, 'a score above the scale is clamped, not stored');
}

// -------------------------------------------------------------- the trend
{
  const t = trend(FEVER, TODAY);
  eq(t.dir, 'better', 'a fever that fell from 7-8 to 4-2 is getting better');
  eq(t.points, 4, 'on four scored days');

  const two = normaliseEpisode({ name: 'x', from: '2026-09-11', to: TODAY, severity: { '2026-09-11': 8, [TODAY]: 3 } });
  eq(trend(two, TODAY).known, false, `two points is a line through any two numbers — nothing is claimed below ${MIN_TREND_POINTS}`);
  ok(/at least 3/.test(trend(two, TODAY).why), 'and it says what it is waiting for');

  const wobble = normaliseEpisode({ name: 'x', from: '2026-09-10', to: TODAY,
    severity: { '2026-09-10': 5, '2026-09-11': 6, [TODAY]: 5 } });
  eq(trend(wobble, TODAY).dir, 'flat', 'half a point of movement on a scale you typed in while ill is not a direction');
}

// ---------------------------------------------------------- meds in window
{
  const log = {
    '2026-09-07': [{ name: 'Dolo 650' }],                       // the day before
    '2026-09-08': [{ name: 'Dolo 650' }, { name: 'Dolo 650' }],
    '2026-09-09': [{ name: 'Dolo 650' }, { name: 'Azithral 500' }],
    '2026-09-11': [{ name: 'Azithral 500' }],
  };
  const m = medsDuring(FEVER, log, TODAY);
  eq(m.length, 2, 'only medicines logged INSIDE the window are listed');
  eq(m[0].name, 'Dolo 650', 'ordered by how much of it there was');
  eq(m[0].count, 3, 'counting doses');
  eq(m[0].days, 2, 'and the days they fell on');
  ok(!m[0].dates.includes('2026-09-07'), 'the day before the episode is outside it');

  const words = JSON.stringify(m).toLowerCase();
  ok(!/(caus|because|cured|treated|helped|worked)/.test(words),
     'and nothing in the result claims any of them DID anything — this is a list of what was taken while it was going on');
}

// =========================================================================
// THE COMPARISON — the part that must refuse
// =========================================================================
const rows = (metric, spec) => Object.entries(spec).map(([date, value]) => ({ metric, date, value }));
const many = (metric, from, n, value) => Array.from({ length: n }, (_, i) => {
  const d = new Date(`${from}T00:00:00`); d.setDate(d.getDate() + i);
  return { metric, date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, value };
});

{
  // Two nights inside an episode is not an average — one bad night IS the average.
  const thin = compare(FEVER, [
    ...rows('sleep_hours', { '2026-09-08': 5, '2026-09-09': 5.5 }),
    ...many('sleep_hours', '2026-08-01', 20, 7),
  ], 'sleep_hours', TODAY);
  eq(thin.enough, false, `${ENOUGH.insideDays} days inside is the floor — two is refused`);
  eq(thin.inside, undefined, 'and NO number is produced at all — not a number with a warning beside it');
  ok(/at least 3/.test(thin.why), 'the reason says what would be enough');

  // A baseline of four days is a mood, not a baseline.
  const noBase = compare(FEVER, [
    ...rows('sleep_hours', { '2026-09-08': 5, '2026-09-09': 5.5, '2026-09-10': 6 }),
    ...many('sleep_hours', '2026-08-01', 4, 7),
  ], 'sleep_hours', TODAY);
  eq(noBase.enough, false, `and a baseline under ${ENOUGH.outsideDays} days is refused too`);
  ok(/baseline/.test(noBase.why), 'saying which side was short');

  // With enough of both, it describes — and only describes.
  const full = compare(FEVER, [
    ...rows('sleep_hours', { '2026-09-08': 5, '2026-09-09': 5, '2026-09-10': 6, '2026-09-11': 6 }),
    ...many('sleep_hours', '2026-08-01', 20, 7),
  ], 'sleep_hours', TODAY);
  eq(full.enough, true, 'four days inside and twenty outside is enough to say something');
  eq(full.inside, 5.5, 'the average inside');
  eq(full.outside, 7, 'and out');
  eq(full.n.inside, 4, 'with n attached');
  eq(full.n.outside, 20, 'on both sides, always, so a figure cannot be quoted without its sample');
  ok(/differed/.test(full.verdict), 'the verdict word is "differed"');
  ok(!/(caus|because|linked|due to|led to|responsible)/i.test(full.verdict),
     'NEVER a word of causation — being ill wrecks your sleep, so the arrow does not point anywhere on its own');
}

// --------------------------------------------- withheld is returned, not dropped
{
  const data = [
    ...rows('sleep_hours', { '2026-09-08': 5, '2026-09-09': 5, '2026-09-10': 6, '2026-09-11': 6 }),
    ...many('sleep_hours', '2026-08-01', 20, 7),
    ...rows('steps', { '2026-09-08': 900 }),
  ];
  const r = compareAll(FEVER, data, TODAY);
  eq(r.shown.length, 1, 'only what passed is shown');
  ok(r.withheld.some(w => w.metric === 'steps'), 'and what did not is RETURNED rather than dropped');
  ok(r.withheld.length >= 3, 'including metrics with no data at all');
  ok(r.withheld.every(w => w.why), 'each saying why, so the panel is honest about being partial rather than looking complete');
}

// ------------------------------------------------- "usually" needs a history
{
  const few = [{ name: 'Fever' }, { name: 'Fever' }];
  eq(enoughHistory(few, 'Fever').enough, false, `two fevers do not support "your fevers usually…" — ${MIN_EPISODES} is the floor`);
  eq(enoughHistory(few, 'Fever').n, 2, 'and it says how many there are');
  eq(enoughHistory([...few, { name: 'Fever' }, { name: 'Fever' }], 'Fever').enough, true, 'four does');
  eq(enoughHistory([...few, { name: 'Cough' }, { name: 'Cough' }], 'Fever').enough, false, 'counting only the same thing');
}

// ---------------------------------------------------------------- describe
{
  const d = describe(FEVER, TODAY);
  ok(/4 days/.test(d), 'the line says how long');
  ok(/worst 8\/10 \(bad\)/.test(d), 'how bad it got, in numbers and words');
  ok(/getting better/.test(d), 'and which way it was going');
  ok(!/caus|should|take|see a doctor/i.test(d), 'and tells him nothing to do about it — this is a diary, not a diagnosis');
  ok(/no start date/.test(describe({ name: 'x' }, TODAY)), 'an episode with no start says so rather than showing a length of 0 days');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
