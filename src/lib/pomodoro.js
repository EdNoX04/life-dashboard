// The pomodoro timer, as state that outlives the Study tab.
//
// It used to be four useStates inside Study.jsx driving a setInterval that
// decremented a second counter. Both halves of that were wrong, and they failed
// in different ways:
//
//   SWITCHING TABS unmounts Study, so the state was destroyed and the timer
//   restarted at 25:00 the next time you came back. A twenty-minute focus block
//   was lost by looking at your timetable.
//
//   COUNTING DOWN BY ONE per interval assumes the interval fires once a second,
//   and browsers deliberately break that assumption: a backgrounded tab is
//   throttled to roughly one timer callback a minute, and a sleeping machine
//   fires none at all. So even when the component survived, the count drifted
//   slower than real time — the clock ran behind precisely when you were doing
//   the thing you were timing.
//
// Both are fixed by storing a DEADLINE rather than a remaining count. Wall-clock
// time keeps running whether or not this app gets a callback, so remaining() is
// derived by subtraction at read time and is correct after any gap, of any
// length, for any reason. The interval is then only a repaint trigger and can be
// as unreliable as the browser likes.
//
// State lives at module scope, like ambient.js, so it survives unmount, and is
// mirrored into localStorage so it survives a reload too.

export const DUR = { focus: 25 * 60, short: 5 * 60, long: 15 * 60 };
export const MODE_LABEL = { focus: 'Focus', short: 'Short break', long: 'Long break' };

// Four focus blocks, then the long break — the standard cycle.
export const ROUNDS_PER_LONG = 4;

export function nextMode(mode, rounds) {
  if (mode !== 'focus') return 'focus';
  return (rounds + 1) % ROUNDS_PER_LONG === 0 ? 'long' : 'short';
}

export const emptyState = () => ({
  mode: 'focus',
  rounds: 0,
  running: false,
  // Seconds left while paused. The single source of truth when not running.
  left: DUR.focus,
  // Epoch ms at which the current run ends. The single source of truth while
  // running. Exactly one of these two is meaningful at any moment.
  endsAt: null,
  // Set when a session ran out while nobody was looking, so the UI can say so
  // rather than silently presenting a fresh timer as though nothing happened.
  finished: null,
});

export function remaining(st, now = Date.now()) {
  if (!st) return 0;
  if (!st.running || !st.endsAt) return Math.max(0, Math.round(st.left ?? 0));
  return Math.max(0, Math.ceil((st.endsAt - now) / 1000));
}

/**
 * Advance the state to account for real time having passed.
 *
 * The interesting case is a long absence. If you start a 25-minute focus block
 * and close the laptop for three hours, the naive thing is to roll the cycle
 * forward six times and report four completed pomodoros. That would be a lie:
 * you did not take those breaks and you did not do that work.
 *
 * So exactly ONE rollover happens, and the timer stops there. The session that
 * genuinely elapsed is credited, the next one is set up, and it waits for you to
 * start it — because a break you slept through is not a break you took.
 */
export function settle(st, now = Date.now()) {
  if (!st?.running || !st.endsAt || now < st.endsAt) return st;
  const wasFocus = st.mode === 'focus';
  const rounds = wasFocus ? st.rounds + 1 : st.rounds;
  const mode = nextMode(st.mode, st.rounds);
  return {
    ...st,
    mode,
    rounds,
    running: false,
    left: DUR[mode],
    endsAt: null,
    finished: { mode: st.mode, at: st.endsAt },
  };
}

export function start(st, now = Date.now()) {
  const left = remaining(st, now);
  const secs = left > 0 ? left : DUR[st.mode];
  return { ...st, running: true, endsAt: now + secs * 1000, left: secs, finished: null };
}

export function pause(st, now = Date.now()) {
  return { ...st, running: false, left: remaining(st, now), endsAt: null };
}

export function reset(st, mode = st.mode) {
  return { ...st, mode, running: false, left: DUR[mode], endsAt: null, finished: null };
}

export function setMode(st, mode) {
  return reset(st, mode);
}

// ------------------------------------------------------------------ the store

const KEY = 'p1_pomodoro';

function load() {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return emptyState();
    const p = JSON.parse(raw);
    // Anything unrecognised falls back to a clean timer rather than a broken
    // one. A stored blob is not a contract.
    if (!p || !DUR[p.mode]) return emptyState();
    return settle({ ...emptyState(), ...p });
  } catch {
    return emptyState();
  }
}

let state = null;
const subs = new Set();

function persist() {
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify(state)); } catch { /* private mode */ }
}

export function get() {
  if (!state) state = load();
  // Settling on read means a timer that expired while the tab was closed is
  // already correct by the time anything renders it.
  const next = settle(state);
  if (next !== state) { state = next; persist(); }
  return state;
}

export function set(fn) {
  state = fn(get());
  persist();
  for (const s of subs) s(state);
  return state;
}

export function subscribe(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}
