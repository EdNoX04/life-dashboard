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

// The classic cycle, and now only the DEFAULT one.
//
// 25/5/15 works for most people and is what the timer starts as. It is not a
// law: a proof-heavy revision block wants 50 minutes, a tired evening wants 15,
// and someone else's idea of the right number is a bad reason to fight your own
// attention. So the durations are state, stored per person, and DUR is the
// starting point rather than the rule.
export const DUR = { focus: 25 * 60, short: 5 * 60, long: 15 * 60 };
export const MODE_LABEL = { focus: 'Focus', short: 'Short break', long: 'Long break' };
export const MODES = ['focus', 'short', 'long'];

// Bounds, so a typo cannot produce a timer that is over before it starts or one
// that never ends. Stored in MINUTES because that is what the person types.
export const MIN_MINUTES = 1;
export const MAX_MINUTES = 180;
export const MIN_ROUNDS = 2;
export const MAX_ROUNDS = 8;

// Four focus blocks, then the long break — the standard cycle, and the default.
export const ROUNDS_PER_LONG = 4;

/** A few sane starting points, so customising does not mean typing three numbers. */
export const PRESETS = [
  { id: 'classic', label: 'Classic', focus: 25, short: 5, long: 15, perLong: 4 },
  { id: 'long', label: 'Deep work', focus: 50, short: 10, long: 30, perLong: 3 },
  { id: 'sprint', label: 'Sprint', focus: 15, short: 3, long: 10, perLong: 4 },
  { id: 'exam', label: 'Exam hour', focus: 60, short: 10, long: 25, perLong: 2 },
];

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(n) || 0)));

export const defaultConfig = () => ({
  focus: DUR.focus / 60,
  short: DUR.short / 60,
  long: DUR.long / 60,
  perLong: ROUNDS_PER_LONG,
});

/** Durations in whole minutes, clamped, with anything unrecognised falling back. */
export function normalizeConfig(cfg) {
  const d = defaultConfig();
  if (!cfg || typeof cfg !== 'object') return d;
  return {
    focus: clamp(cfg.focus ?? d.focus, MIN_MINUTES, MAX_MINUTES),
    short: clamp(cfg.short ?? d.short, MIN_MINUTES, MAX_MINUTES),
    long: clamp(cfg.long ?? d.long, MIN_MINUTES, MAX_MINUTES),
    perLong: clamp(cfg.perLong ?? d.perLong, MIN_ROUNDS, MAX_ROUNDS),
  };
}

/** Seconds for a mode under this state's configuration. */
export function seconds(st, mode = st?.mode) {
  const cfg = normalizeConfig(st?.cfg);
  return (cfg[mode] ?? defaultConfig()[mode] ?? 25) * 60;
}

export function nextMode(mode, rounds, perLong = ROUNDS_PER_LONG) {
  if (mode !== 'focus') return 'focus';
  return (rounds + 1) % perLong === 0 ? 'long' : 'short';
}

export const emptyState = () => ({
  mode: 'focus',
  rounds: 0,
  running: false,
  // What this block is for. `label` is always what gets recorded; `todoId` only
  // links it to a task when one was picked. A copy of the title is kept rather
  // than only the id, so deleting the task does not erase the history of having
  // worked on it.
  label: '',
  todoId: null,
  // The person's own durations, in minutes, plus how many focus blocks precede
  // a long break.
  cfg: defaultConfig(),
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
  const mode = nextMode(st.mode, st.rounds, normalizeConfig(st.cfg).perLong);
  return {
    ...st,
    mode,
    rounds,
    running: false,
    left: seconds(st, mode),
    endsAt: null,
    // Everything the history needs, captured at the moment the block ended
    // rather than read back later — by the time anything renders this, `mode`
    // and `left` have already moved on to the next session.
    finished: {
      mode: st.mode,
      at: st.endsAt,
      label: st.label || '',
      todoId: st.todoId || null,
      minutes: Math.round(seconds(st, st.mode) / 60),
      logged: false,
    },
  };
}

export function start(st, now = Date.now()) {
  const left = remaining(st, now);
  const secs = left > 0 ? left : seconds(st);
  return { ...st, running: true, endsAt: now + secs * 1000, left: secs, finished: null };
}

export function pause(st, now = Date.now()) {
  return { ...st, running: false, left: remaining(st, now), endsAt: null };
}

export function reset(st, mode = st.mode) {
  return { ...st, mode, running: false, left: seconds(st, mode), endsAt: null, finished: null };
}

export function setMode(st, mode) {
  return reset(st, mode);
}

/**
 * Change the durations.
 *
 * A running timer is left running on the length it was started with. Editing
 * "focus" to 50 while eleven minutes into a 25-minute block should not silently
 * extend the block you are already in — that is the timer moving the finish line
 * while you are running at it. The new length applies from the next session, and
 * a paused or idle timer picks it up immediately so the change is visible.
 */
export function setConfig(st, patch) {
  const cfg = normalizeConfig({ ...normalizeConfig(st?.cfg), ...patch });
  const next = { ...st, cfg };
  if (st?.running) return next;
  return { ...next, left: seconds(next, next.mode), endsAt: null };
}

/**
 * Name what this block is for, optionally linking it to a todo.
 *
 * Changing it mid-block is allowed and deliberate: you often start a timer and
 * only then decide what you are doing with it, and forcing a stop-and-restart to
 * rename it would cost the minutes already spent.
 */
export function setTask(st, { label = '', todoId = null } = {}) {
  return { ...st, label: String(label ?? '').slice(0, 120), todoId: todoId || null };
}

/** Forget the task once a block is finished with — the next one starts clean. */
export function clearTask(st) {
  return { ...st, label: '', todoId: null };
}

/**
 * Mark the finished session as written to history.
 *
 * Without this, a component that re-renders — and React's StrictMode
 * double-invokes effects in development — logs the same block twice, and the
 * history quietly doubles every number in it.
 */
export function markLogged(st) {
  if (!st?.finished || st.finished.logged) return st;
  return { ...st, finished: { ...st.finished, logged: true } };
}

/** Apply one of the named presets. */
export function applyPreset(st, id) {
  const p = PRESETS.find(x => x.id === id);
  return p ? setConfig(st, { focus: p.focus, short: p.short, long: p.long, perLong: p.perLong }) : st;
}

/** Which preset the current configuration matches, or null for a custom one. */
export function presetOf(st) {
  const c = normalizeConfig(st?.cfg);
  const p = PRESETS.find(x => x.focus === c.focus && x.short === c.short && x.long === c.long && x.perLong === c.perLong);
  return p ? p.id : null;
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
    if (!p || !MODES.includes(p.mode)) return emptyState();
    // The stored blob predates custom durations for anyone who used the timer
    // before today, so cfg is normalised rather than trusted — a missing or
    // corrupt config becomes 25/5/15 instead of NaN:NaN on the ring.
    return settle({ ...emptyState(), ...p, cfg: normalizeConfig(p.cfg) });
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
