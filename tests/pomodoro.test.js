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
  seconds, setConfig, normalizeConfig, defaultConfig, applyPreset, presetOf, PRESETS,
  MIN_MINUTES, MAX_MINUTES, MIN_ROUNDS, MAX_ROUNDS,
  get, set, poll, subscribe,
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

// ------------------------------------------------- custom durations
// 25/5/15 is a default, not a rule. What must hold: the stored numbers are
// always sane, a running block is never silently lengthened, and a timer that
// predates this feature still opens.

eq(seconds(emptyState()), 25 * 60, 'a fresh timer is still 25 minutes');
eq(seconds(emptyState(), 'short'), 5 * 60, 'and 5 for the short break');

{
  const st = setConfig(emptyState(), { focus: 50, short: 10, long: 30, perLong: 3 });
  eq(seconds(st), 50 * 60, 'a custom focus length is used');
  eq(st.left, 50 * 60, 'and an idle timer picks it up immediately');
  eq(presetOf(st), 'long', 'a configuration matching a preset is recognised');
}

// Clamping. A stray keystroke must not produce a zero-second or week-long block.
eq(setConfig(emptyState(), { focus: 0 }).cfg.focus, MIN_MINUTES, 'zero clamps up to the minimum');
eq(setConfig(emptyState(), { focus: 9999 }).cfg.focus, MAX_MINUTES, 'a huge value clamps down');
eq(setConfig(emptyState(), { focus: '' }).cfg.focus, MIN_MINUTES, 'an empty field does not become NaN');
eq(setConfig(emptyState(), { focus: 'abc' }).cfg.focus, MIN_MINUTES, 'nor does junk text');
eq(setConfig(emptyState(), { perLong: 99 }).cfg.perLong, MAX_ROUNDS, 'rounds clamp too');
eq(setConfig(emptyState(), { perLong: 1 }).cfg.perLong, MIN_ROUNDS, 'and up from below');
eq(setConfig(emptyState(), { focus: 30.6 }).cfg.focus, 31, 'fractions are rounded, not stored');

// THE ONE THAT MATTERS: editing while running must not move the finish line.
{
  const running = start(emptyState(), T0);
  const edited = setConfig(running, { focus: 50 });
  eq(edited.endsAt, running.endsAt, 'a running block keeps its original deadline');
  eq(remaining(edited, T0 + 60_000), 24 * 60, 'so the remaining time is unchanged');
  eq(edited.cfg.focus, 50, 'but the new length is stored');
  // …and it takes effect on the NEXT session.
  const done = settle({ ...edited, endsAt: T0 + 1000 }, T0 + 2000);
  const nextRun = start(reset(done, 'focus'), T0 + 3000);
  eq(remaining(nextRun, T0 + 3000), 50 * 60, 'the next focus block is 50 minutes');
}

// The cycle length is configurable, and settle() must honour it.
eq(nextMode('focus', 2, 3), 'long', 'with perLong 3, the third focus leads to a long break');
eq(nextMode('focus', 1, 3), 'short', 'the second does not');
{
  const st = setConfig(emptyState(), { perLong: 2 });
  const after = settle({ ...st, running: true, endsAt: T0, mode: 'focus', rounds: 1 }, T0 + 1);
  eq(after.mode, 'long', 'settle uses the configured cycle length');
  eq(after.left, st.cfg.long * 60, 'and loads that break at its configured length');
}

// Presets round-trip, and a hand-edited value reads as custom.
PRESETS.forEach(p => {
  eq(presetOf(applyPreset(emptyState(), p.id)), p.id, `preset ${p.id} round-trips`);
});
eq(presetOf(setConfig(emptyState(), { focus: 37 })), null, 'an off-preset value reads as custom');
eq(applyPreset(emptyState(), 'nope').cfg.focus, 25, 'an unknown preset id changes nothing');

// Old stored state, from before durations were configurable.
{
  const legacy = { mode: 'focus', rounds: 2, running: false, left: 900, endsAt: null };
  const cfg = normalizeConfig(legacy.cfg);
  eq(cfg.focus, defaultConfig().focus, 'a state with no cfg gets the defaults');
  eq(normalizeConfig(null).long, 15, 'and so does null');
  eq(normalizeConfig({ focus: null, short: undefined }).short, 5, 'partial configs fill in');
}

// ---------------------------------------------------------------- poll()
// THE BUG THIS FUNCTION EXISTS FOR.
//
// `get()` settles the timer against the clock but deliberately does not notify —
// it is called during render. That meant the one-second tick, which called
// get(), silently flipped `running` to false and told nobody: the subscribed
// state still said the block was running, so nothing re-rendered, and the ring
// sat at 00:00 still labelled FOCUS. Neel described the symptom as not knowing
// when the timer ended. It was not that the signal was quiet; there was no
// signal.
{
  set(st => start({ ...st, mode: 'focus', label: 'Blockchain' }));
  eq(get().running, true, 'a started block is running');

  let told = 0, last = null;
  const off = subscribe(s2 => { told++; last = s2; });

  poll();
  eq(told, 0, 'polling mid-block tells nobody — nothing has happened');
  eq(get().running, true, 'and leaves it running');

  // Exactly what the clock does, without waiting 25 minutes for it.
  set(st => ({ ...st, endsAt: Date.now() - 1000 }));
  told = 0; last = null;

  const after = poll();
  ok(!after.running, 'polling past the deadline settles the block');
  eq(told, 1, 'and TELLS the subscriber — this is the entire point of the function');
  ok(last?.finished, 'the finished block is handed over');
  eq(last.finished.mode, 'focus', 'with the mode that ended');
  eq(last.finished.label, 'Blockchain', 'and what it was for, so the alarm can name it');
  ok(last.finished.minutes > 0, 'and a length, so the alarm can say how long you managed');

  told = 0;
  poll();
  eq(told, 0, 'a second poll says nothing — one settle, one announcement');
  off();
  set(st => reset(st));
}

console.log(`${pass}/${pass + fail} passing`);
if (fail) process.exit(1);
