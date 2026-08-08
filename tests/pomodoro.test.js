// The pomodoro reset to 25:00 whenever you left the Study tab, and ran slow
// whenever you didn't.
//
// Both came from the same design: a per-second decrement held in component
// state. Unmounting destroyed it; browser throttling starved it. Storing a
// DEADLINE instead makes remaining time a subtraction against the wall clock,
// which is correct across unmounts, throttled intervals, sleep and reloads
// alike — none of which this module has to know about.
//
// Every test below drives an explicit `now`, so none of this depends on the
// test's own timing.

import {
  DUR, emptyState, remaining, settle, start, pause, reset, setMode, nextMode, ROUNDS_PER_LONG,
} from '../src/lib/pomodoro.js';

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; } else { fail++; console.log('FAIL ' + name); } };
const eq = (a, b, name) => ok(a === b, `${name} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const T0 = 1_700_000_000_000;

// ------------------------------------------------------------- the basics

const fresh = emptyState();
eq(remaining(fresh), DUR.focus, 'a fresh timer has the full focus block');
eq(fresh.running, false, 'and is not running');

const run = start(fresh, T0);
eq(run.running, true, 'start runs it');
eq(run.endsAt, T0 + DUR.focus * 1000, 'and sets a deadline 25 minutes out');

// The whole point: elapsed time is read from the clock, not counted.
eq(remaining(run, T0 + 60_000), DUR.focus - 60, 'one minute later, one minute less');
eq(remaining(run, T0 + 600_000), DUR.focus - 600, 'ten minutes later, ten minutes less');

// ------------------------------------------------ the two original failures

// THE UNMOUNT. Switching tabs destroyed the component; the state now lives
// outside it, so the identical object read later is simply further along.
eq(remaining(run, T0 + 300_000), DUR.focus - 300,
  'leaving the tab for five minutes takes five minutes off, not none');

// THE THROTTLE. A backgrounded tab may get one callback a minute, or none.
// Since nothing is being decremented, the count cannot fall behind: reading
// once after twenty minutes gives the same answer as reading every second.
eq(remaining(run, T0 + 20 * 60_000), DUR.focus - 20 * 60,
  'twenty minutes with no callbacks at all still costs twenty minutes');

// ------------------------------------------------------------ pause/resume

const paused = pause(run, T0 + 120_000);
eq(paused.running, false, 'pause stops it');
eq(paused.left, DUR.focus - 120, 'and banks the remaining time');
eq(paused.endsAt, null, 'the deadline is cleared, so it cannot keep counting');

// Paused means paused: an hour later it is still where it was left.
eq(remaining(paused, T0 + 3600_000), DUR.focus - 120, 'a paused timer does not drain');

const resumed = start(paused, T0 + 3600_000);
eq(remaining(resumed, T0 + 3600_000), DUR.focus - 120, 'resuming picks up the banked time');
eq(resumed.endsAt, T0 + 3600_000 + (DUR.focus - 120) * 1000, 'with a fresh deadline from now');

// ---------------------------------------------------------- the roll-over

eq(remaining(run, T0 + DUR.focus * 1000 + 5_000), 0, 'past the deadline it reads zero, never negative');

const done = settle(run, T0 + DUR.focus * 1000 + 1);
eq(done.mode, 'short', 'a finished focus block becomes a short break');
eq(done.rounds, 1, 'and credits one completed round');
eq(done.running, false, 'the break waits to be started');
eq(remaining(done), DUR.short, 'loaded with the break length');
eq(done.finished?.mode, 'focus', 'and reports what just ended, so the UI can say so');

// THE LONG ABSENCE — the case worth being careful about. Three hours would
// mechanically roll the cycle six times and claim four pomodoros you did not
// do. Exactly one session settles and the timer stops.
const slept = settle(run, T0 + 3 * 3600_000);
eq(slept.rounds, 1, 'three hours away credits ONE round, not six');
eq(slept.mode, 'short', 'and lands on the very next session');
eq(slept.running, false, 'stopped, because a break you slept through is not a break you took');

// Settling is idempotent: reading the state repeatedly must not keep advancing.
eq(settle(slept, T0 + 9 * 3600_000).rounds, 1, 'settling an already-settled state changes nothing');
eq(settle(slept, T0 + 9 * 3600_000), slept, 'and returns the same object');

// A break ending does NOT count as a round — only focus blocks do.
const breakRun = start({ ...done }, T0);
eq(settle(breakRun, T0 + DUR.short * 1000 + 1).rounds, 1, 'finishing a break credits no extra round');
eq(settle(breakRun, T0 + DUR.short * 1000 + 1).mode, 'focus', 'and returns to focus');

// ------------------------------------------------------------- the cycle

eq(nextMode('focus', 0), 'short', 'the first focus block leads to a short break');
eq(nextMode('focus', ROUNDS_PER_LONG - 1), 'long', 'the fourth leads to the long one');
eq(nextMode('short', 3), 'focus', 'any break leads back to focus');
eq(nextMode('long', 3), 'focus', 'including the long one');

// Walk a full cycle and check the long break lands where it should.
let st = emptyState();
const modes = [];
for (let i = 0; i < 8; i++) {
  st = settle(start(st, T0), T0 + DUR[st.mode] * 1000 + 1);
  modes.push(st.mode);
}
eq(modes.join(','), 'short,focus,short,focus,short,focus,long,focus',
  'the long break arrives after the fourth focus block, not the fourth session');
eq(st.rounds, 4, 'four focus blocks completed across those eight sessions');

// ---------------------------------------------------------------- resets

const mid = start(emptyState(), T0);
eq(remaining(reset(mid), T0 + 600_000), DUR.focus, 'reset restores the full block');
eq(reset(mid).running, false, 'and stops the clock');
eq(setMode(mid, 'long').mode, 'long', 'switching mode switches mode');
eq(remaining(setMode(mid, 'long')), DUR.long, 'and loads that mode\'s length');
eq(setMode(mid, 'long').running, false, 'switching mode never leaves it running');

// Starting from a drained timer begins a whole fresh block rather than
// instantly completing a zero-second one.
const drained = { ...emptyState(), left: 0 };
eq(remaining(start(drained, T0), T0), DUR.focus, 'starting an empty timer gives a full block');

console.log(`${pass}/${pass + fail} passing`);
if (fail) process.exit(1);
