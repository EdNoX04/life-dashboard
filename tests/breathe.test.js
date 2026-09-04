// Guided breathing.
//
// The whole exercise is one function — "given a pattern and how many seconds
// have passed, what should I be doing" — and the failures it can have are all
// small and all ruinous: a cue that fires twice, a countdown that shows 0, a
// ring that jumps at the turn. Any of those pulls you out of exactly the state
// the thing exists to put you in. So the boundaries are tested to the exact
// second rather than by breathing along with it.
//
// Everything takes time as an argument, so none of this depends on when it runs.

import {
  PATTERNS, LABEL, DURATIONS, normalize, patternById, cycleSeconds, cyclesFor,
  plannedSeconds, phaseAt, phaseKey, scaleAt, countdown, fmtClock, sessionLabel,
  stats, MODE, cueSchedule, CUE,
} from '../src/lib/breathe.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log('FAIL ' + n); } };
const eq = (a, b, n) => ok(Object.is(a, b), `${n} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
const near = (a, b, tol, n) => ok(Math.abs(a - b) <= tol, `${n} (got ${a}, want ~${b})`);

const box = patternById('box');          // 4·4·4·4 → in, hold, out, holdOut
const calm = patternById('calm');        // 4·6     → in, out

// ---------------------------------------------------------------- the patterns
{
  ok(PATTERNS.length >= 3, 'there is more than one way to breathe');
  ok(PATTERNS.every(p => p.id && p.label && p.rhythm && p.note),
     'every pattern says what it is and what it is for');
  ok(PATTERNS.every(p => p.phases.every(ph => LABEL[ph.kind])),
     'every phase kind has a label — an unlabelled phase would render blank mid-exercise');
  ok(PATTERNS.every(p => p.phases.some(ph => ph.kind === 'in') && p.phases.some(ph => ph.kind === 'out')),
     'and every one both inhales and exhales');
  ok(DURATIONS.every(d => d > 0), 'the durations are all real lengths');

  eq(cycleSeconds(box), 16, 'a box cycle is sixteen seconds');
  eq(cycleSeconds(calm), 10, 'and a long-exhale cycle is ten');
  eq(patternById('nonsense').id, PATTERNS[0].id, 'an unknown id falls back rather than crashing');
  eq(cycleSeconds(null), 0, 'and nothing at all is zero seconds, not NaN');
}

// ---------------------------------------------------------------- zero-length phases
{
  // A zero-second phase is not a fast phase — it can never be shown, but it
  // still occupies an index, so the cue would fire for a phase nobody sees.
  const weird = normalize({ id: 'x', label: 'X', rhythm: '4·0·4', phases: [
    { kind: 'in', secs: 4 }, { kind: 'hold', secs: 0 }, { kind: 'out', secs: 4 },
  ]});
  eq(weird.phases.length, 2, 'a zero-length phase is dropped');
  eq(weird.phases[1].kind, 'out', 'leaving the real ones in order');
  eq(normalize({ phases: [{ kind: 'in', secs: 0 }] }), null, 'a pattern of nothing but zeroes is no pattern');
  eq(normalize(null), null, 'and null is null');
}

// ---------------------------------------------------------------- where am I
{
  eq(phaseAt(box, 0).kind, 'in', 'a session opens on the inhale');
  eq(phaseAt(box, 0).progress, 0, 'at the very start of it');
  eq(phaseAt(box, 2).kind, 'in', 'still inhaling halfway through');
  eq(phaseAt(box, 2).progress, 0.5, 'halfway');
  eq(phaseAt(box, 2).left, 2, 'with two seconds to go');

  // THE BOUNDARY. At exactly 4.0s you are at the START of the hold, not the end
  // of the inhale. Off by one frame here and the cue lands after the turn.
  eq(phaseAt(box, 4).kind, 'hold', 'at exactly four seconds the hold has begun');
  eq(phaseAt(box, 4).progress, 0, 'at its start');
  eq(phaseAt(box, 3.999).kind, 'in', 'and a thousandth earlier it has not');

  eq(phaseAt(box, 8).kind, 'out', 'then the exhale');
  eq(phaseAt(box, 12).kind, 'holdOut', 'then the empty hold');
  eq(phaseAt(box, 15.5).kind, 'holdOut', 'to the end of the cycle');

  eq(phaseAt(box, 16).kind, 'in', 'and sixteen seconds in, it comes round again');
  eq(phaseAt(box, 16).cycle, 1, 'as the second cycle');
  eq(phaseAt(box, 0).cycle, 0, 'the first being zero');
  eq(phaseAt(box, 33).cycle, 2, 'and it keeps counting');
  eq(phaseAt(box, 33).kind, 'in', 'from the right place in the cycle');

  eq(phaseAt(box, -5).kind, 'in', 'a negative time starts at the beginning');
  eq(phaseAt(box, -5).progress, 0, 'rather than showing a phase from before it began');
  eq(phaseAt(null, 3), null, 'no pattern, no phase');
}

// ---------------------------------------------------------------- fractional seconds
{
  const coh = patternById('coherent');    // 5.5 each way
  eq(cycleSeconds(coh), 11, 'a coherent cycle is eleven seconds');
  eq(phaseAt(coh, 5.4).kind, 'in', 'the half-second is respected on the way in');
  eq(phaseAt(coh, 5.5).kind, 'out', 'and on the turn');
  eq(phaseAt(coh, 11).cycle, 1, 'and the cycle rolls over on a fraction as cleanly as on a whole number');
}

// ---------------------------------------------------------------- the cue fires once
{
  // Every frame asks "what phase is this"; only a CHANGE should make a sound.
  // Sampling at 60fps through a whole cycle must produce exactly four cues for
  // box breathing, not two hundred and forty.
  const seen = new Set();
  for (let f = 0; f < 16 * 60; f++) seen.add(phaseKey(phaseAt(box, f / 60)));
  eq(seen.size, 4, 'one cycle of box breathing is four distinct phases, however often you sample it');

  const overTwo = new Set();
  for (let f = 0; f < 32 * 60; f++) overTwo.add(phaseKey(phaseAt(box, f / 60)));
  eq(overTwo.size, 8, 'and two cycles are eight — the second cycle does not reuse the first cycle’s keys');
  eq(phaseKey(null), '', 'no phase has no key, rather than "undefined:undefined"');
}

// ---------------------------------------------------------------- the ring
{
  eq(scaleAt('in', 0), 0, 'the inhale starts empty');
  eq(scaleAt('in', 1), 1, 'and ends full');
  near(scaleAt('in', 0.5), 0.5, 1e-9, 'passing through the middle at the middle');
  eq(scaleAt('out', 0), 1, 'the exhale starts full');
  eq(scaleAt('out', 1), 0, 'and ends empty');
  eq(scaleAt('hold', 0.5), 1, 'a hold stays full');
  eq(scaleAt('holdOut', 0.5), 0, 'and an empty hold stays empty');

  // CONTINUITY IS THE POINT. If the ring jumped between phases it would read as
  // a glitch at exactly the moment you are meant to be turning around.
  near(scaleAt('in', 1), scaleAt('hold', 0), 1e-9, 'inhale ends where the hold begins');
  near(scaleAt('hold', 1), scaleAt('out', 0), 1e-9, 'the hold ends where the exhale begins');
  near(scaleAt('out', 1), scaleAt('holdOut', 0), 1e-9, 'and the exhale ends where the empty hold begins');
  near(scaleAt('holdOut', 1), scaleAt('in', 0), 1e-9, 'which is where the next inhale starts — the loop closes');

  // Eased, not linear: slowest at the turns, which is what tells you when to switch.
  const early = scaleAt('in', 0.1) - scaleAt('in', 0);
  const middle = scaleAt('in', 0.55) - scaleAt('in', 0.45);
  ok(middle > early, 'the ring moves fastest mid-breath and slowest at the turns');

  ok(scaleAt('in', 5) <= 1 && scaleAt('in', -5) >= 0, 'and it cannot escape 0–1 however it is called');
}

// ---------------------------------------------------------------- the cues
{
  // These are scheduled on the audio clock the moment the session starts, which
  // is what keeps them on the beat after the screen goes off. So the schedule
  // has to be right in one pass — there is no loop coming along later to fix it.
  const cues = cueSchedule(box, 1);                  // 60s ÷ 16 → 4 cycles
  eq(cues.length, 16, 'a one-minute box session is four cycles of four cues');
  eq(cues[0].at, 0, 'the first lands at the start');
  eq(cues[1].at, 4, 'and the rest on their phase boundaries');
  eq(cues[2].at, 8, 'exactly');
  eq(cues[4].at, 16, 'including the first cue of the second cycle');
  eq(cues.at(-1).at, 60, 'and the last opens the final empty hold');

  // Pitched so the exercise can be followed with your eyes shut: in is the
  // highest, out the lowest, holds quieter and in between.
  ok(CUE.in.hz > CUE.hold.hz && CUE.hold.hz > CUE.out.hz,
     'the inhale is the highest note and the exhale the lowest');
  ok(CUE.hold.peak < CUE.in.peak, 'and a hold is quieter than a breath');

  const boundaries = cueSchedule(box, 1).map(c => c.at);
  ok(boundaries.every((v, i) => i === 0 || v > boundaries[i - 1]),
     'cue times only ever move forward');
  ok(cues.every(c => c.len > 0 && c.hz > 0), 'every cue is a real note');

  // A cue must not outlast the phase it announces, or it bleeds into the next.
  const c478 = cueSchedule(patternById('478'), 1);
  ok(c478.every((c, i) => i === c478.length - 1 || c.at + c.len <= c478[i + 1].at + 1e-9),
     'no cue runs past the start of the next one');

  eq(cueSchedule(null, 2).length, 0, 'no pattern, no cues');
  eq(cueSchedule(box, 0).length, 4, 'and a zero-minute session still gets its one cycle');
}

// ---------------------------------------------------------------- the countdown
{
  // Counts 4, 3, 2, 1 — a zero would mean "do nothing for a second" and a five
  // would mean the phase is longer than it is.
  eq(countdown(phaseAt(box, 0)), 4, 'a four-second phase opens on 4');
  eq(countdown(phaseAt(box, 0.5)), 4, 'and stays on 4 for its first second');
  eq(countdown(phaseAt(box, 1)), 3, 'then 3');
  eq(countdown(phaseAt(box, 3.5)), 1, 'and 1 at the end');
  eq(countdown(phaseAt(box, 3.99)), 1, 'never 0');
  eq(countdown(phaseAt(patternById('478'), 4)), 7, 'a seven-second hold opens on 7');
  eq(countdown(null), 0, 'and nothing counts down from nothing');
}

// ---------------------------------------------------------------- session length
{
  eq(cyclesFor(box, 2), 8, 'two minutes of box breathing is eight cycles');
  eq(plannedSeconds(box, 2), 128, 'which is 128 seconds — the honest length, not 120');
  eq(cyclesFor(calm, 1), 6, 'a minute of long-exhale is six cycles');
  eq(plannedSeconds(calm, 1), 60, 'and that one happens to land exactly');
  eq(cyclesFor(box, 0.1), 1, 'a duration too short for one cycle still gets one');
  eq(cyclesFor(box, 0), 1, 'and so does zero — never a session of nothing');
  eq(cyclesFor(null, 5), 0, 'but no pattern is no cycles');
}

// ---------------------------------------------------------------- formatting
eq(fmtClock(0), '0:00', 'a zero clock');
eq(fmtClock(9), '0:09', 'seconds are padded');
eq(fmtClock(60), '1:00', 'a minute');
eq(fmtClock(128), '2:08', 'and the real length of a two-minute box session');
eq(fmtClock(-4), '0:00', 'negatives do not print a minus');
ok(/Box/.test(sessionLabel(box)) && /4·4·4·4/.test(sessionLabel(box)),
   'the recorded label names the exercise AND the rhythm, so it is readable a year later');

// ---------------------------------------------------------------- history
{
  const now = new Date(2026, 8, 4, 21, 0, 0);
  const at = (daysAgo, h = 12) => new Date(2026, 8, 4 - daysAgo, h, 0, 0).toISOString();
  const rows = [
    { mode: MODE, minutes: 2, ended_at: at(0) },
    { mode: MODE, minutes: 3, ended_at: at(0, 23) },     // late today, still today
    { mode: MODE, minutes: 2, ended_at: at(3) },
    { mode: MODE, minutes: 5, ended_at: at(20) },        // outside the week
    { mode: 'focus', minutes: 25, ended_at: at(0) },     // study, not breathing
  ];
  const s = stats(rows, now);
  eq(s.today, 2, "today's sessions are counted");
  eq(s.week, 3, 'and the week holds three');
  eq(s.minutes, 7, 'summing only the ones inside it');
  ok(!Number.isNaN(s.minutes), 'with no NaN from the row that has no minutes');

  // THE SEPARATION THAT MATTERS: focus.js counts only mode 'focus', so breathing
  // can never inflate "you studied for six hours". Assert the mode is not focus.
  ok(MODE !== 'focus', 'breathing is recorded under its own mode, never as focus time');

  eq(stats([], now).week, 0, 'no rows is no sessions');
  eq(stats(null, now).week, 0, 'and neither is no list at all');
  eq(stats([{ mode: MODE, ended_at: 'nonsense' }], now).week, 0, 'an unparseable row is skipped, not counted');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
