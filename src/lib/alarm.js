// Telling you the block is over.
//
// THE PROBLEM THIS SOLVES
//
// Neel's words: "when it ends I don't know when it does". A pomodoro whose only
// signal is a number changing on a tab you are not looking at is not a timer —
// it is a stopwatch you have to babysit. The whole point of the technique is
// that you can stop watching the clock, and that only works if the clock
// interrupts you.
//
// So there are two signals, and they are deliberately different:
//
//   SOUND       reaches you if the laptop is in front of you but the tab is not.
//   NOTIFICATION reaches you if you have walked away from the screen entirely.
//
// Either alone has a hole. Both are on by default and each can be turned off.
//
// THREE THINGS THAT MAKE THIS HARDER THAN IT LOOKS
//
// 1. Background tabs. Chrome throttles repeating timers in hidden tabs to about
//    once a minute, so a 1-second tick cannot be trusted to notice the deadline.
//    `armAt` schedules ONE long timeout against the actual deadline instead,
//    which browsers treat far more kindly, and the state-change path fires as a
//    backstop. Whichever notices first wins; `fired` makes sure only one rings.
//
// 2. The chime is synthesised, not a file. An audio asset would be one more
//    thing to load, to cache for offline, and to get past a CSP. Three
//    oscillators and an envelope are a few lines and always available.
//
// 3. The chime does NOT go through the ambience master gain. If it did, turning
//    the rain down to nothing would also silence the alarm — the one sound in
//    the app whose whole job is to be heard.

import * as bus from './audiobus.js';

const KEY = 'p1_alarm';

const DEFAULTS = { sound: true, notify: true, volume: 0.5 };

function read() {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return normalize({ ...DEFAULTS, ...JSON.parse(raw) });
  } catch { return { ...DEFAULTS }; }
}

/** Nothing stored is trusted: this file is one `localStorage` edit from anyone. */
export function normalize(p = {}) {
  const v = Number(p.volume);
  return {
    sound: p.sound !== false,
    notify: p.notify !== false,
    volume: Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : DEFAULTS.volume,
  };
}

let P = read();
const subs = new Set();
const emit = () => { for (const f of [...subs]) f(); };
export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }

export function prefs() { return { ...P }; }

export function setPrefs(patch) {
  P = normalize({ ...P, ...patch });
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify(P)); } catch { /* private mode */ }
  emit();
  return { ...P };
}

// ---------------------------------------------------------------- the chime

// Two phrases, chosen so you can tell them apart from the next room without
// looking: work ending rises and resolves, break ending is two flat knocks that
// sound like "back to it".
export const PHRASES = {
  focus: [
    { hz: 659.25, at: 0.00, len: 0.55 },   // E5
    { hz: 830.61, at: 0.13, len: 0.55 },   // G#5
    { hz: 987.77, at: 0.26, len: 0.85 },   // B5
  ],
  break: [
    { hz: 440.00, at: 0.00, len: 0.40 },   // A4
    { hz: 440.00, at: 0.22, len: 0.55 },
  ],
};

export function phraseFor(mode) {
  return mode === 'focus' ? PHRASES.focus : PHRASES.break;
}

/**
 * Ring.
 *
 * Returns false when there is nothing to ring through — no Web Audio, or the
 * context refused to start because nothing has been clicked yet. The caller can
 * then fall back to the notification alone rather than believing it made a
 * sound it did not make.
 */
export function chime(mode = 'focus') {
  if (!P.sound) return false;
  const ctx = bus.context();
  if (!ctx || !ctx.createOscillator) return false;
  try {
    const now = ctx.currentTime;
    // Its own gain straight to the speakers — see the note at the top about why
    // this bypasses the master.
    const out = ctx.createGain();
    out.gain.value = P.volume;
    out.connect(ctx.destination);

    for (const n of phraseFor(mode)) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = n.hz;
      const t0 = now + n.at;
      // A struck-bell envelope: near-instant attack, exponential decay. A square
      // on/off would click, and a click is what a cheap alarm sounds like.
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.9, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + n.len);
      osc.connect(g); g.connect(out);
      osc.start(t0);
      osc.stop(t0 + n.len + 0.05);
    }
    // Release the node once the phrase is over rather than leaving a gain per
    // completed pomodoro hanging off the destination for the life of the page.
    setTimeout(() => { try { out.disconnect(); } catch { /* already gone */ } }, 3000);
    return true;
  } catch {
    return false;
  }
}

/** A one-off test ring, ignoring the on/off preference — for the settings row. */
export function preview(mode = 'focus') {
  const was = P.sound;
  P.sound = true;
  const rang = chime(mode);
  P.sound = was;
  return rang;
}

// ---------------------------------------------------------------- notifications

export function notifyPermission() {
  const N = globalThis.Notification;
  if (!N) return 'unsupported';
  return N.permission || 'default';
}

/**
 * Ask for permission.
 *
 * Must be called from a click. Browsers refuse — and Chrome permanently blocks
 * the origin — if a page asks on load, which is why there is a button for it
 * rather than a prompt the first time a timer runs.
 */
export async function askNotify() {
  const N = globalThis.Notification;
  if (!N) return 'unsupported';
  if (N.permission !== 'default') return N.permission;
  try { return await N.requestPermission(); } catch { return N.permission; }
}

/**
 * Show one.
 *
 * On Android and in any page controlled by a service worker, constructing a
 * `Notification` directly throws — the platform requires it to come from the
 * registration. This is a PWA, so that path is tried first.
 */
export async function notify(title, body, tag = 'p1-pomodoro') {
  if (!P.notify) return false;
  if (notifyPermission() !== 'granted') return false;
  const opts = {
    body,
    tag,                       // replaces the previous one instead of stacking
    renotify: true,
    requireInteraction: true,  // stays up until dismissed — the point is to be missed by nobody
    silent: true,              // the chime is the sound; two at once is a mess
  };
  try {
    const reg = await globalThis.navigator?.serviceWorker?.ready;
    if (reg?.showNotification) { await reg.showNotification(title, opts); return true; }
  } catch { /* fall through to the constructor */ }
  try { new globalThis.Notification(title, opts); return true; } catch { return false; }
}

// ---------------------------------------------------------------- firing once

// Deadlines already announced. Two code paths race to notice the same block —
// the scheduled timeout and the state change — and both are wanted, because
// either one alone has a case where it misses. This is what stops the winner's
// prize being two chimes.
const fired = new Set();

// How late an announcement can still be worth making. Generous enough to cover a
// laptop that was asleep for a minute or a tab that was throttled; far short of
// "you closed the lid and came back after dinner".
export const STALE_MS = 2 * 60 * 1000;

export function hasFired(at) { return fired.has(Number(at) || 0); }
export function resetFired() { fired.clear(); }

/**
 * Announce a finished block, at most once per deadline.
 *
 * `at` is the block's deadline timestamp and doubles as its identity: the same
 * block cannot be announced twice, and a later block is never suppressed by an
 * earlier one.
 */
export async function announce({
  mode = 'focus', at = 0, label = '', minutes = 0, next = '',
  now = Date.now(), maxAgeMs = STALE_MS,
} = {}) {
  const id = Number(at) || 0;
  if (id && fired.has(id)) return false;

  // DO NOT RING FOR A BLOCK THAT ENDED YESTERDAY.
  //
  // The timer is settled against the clock when it loads, so opening the app the
  // morning after leaving a pomodoro running produces a perfectly valid
  // `finished` block dated last night — and without this, the first thing the
  // dashboard would do on open is chime and throw up a notification about a
  // session that ended nine hours ago. It is still marked as fired, so it is
  // announced neither now nor later.
  if (id && now - id > maxAgeMs) { fired.add(id); return false; }

  if (id) fired.add(id);

  const rang = chime(mode === 'focus' ? 'focus' : 'break');

  const what = mode === 'focus'
    ? `${minutes || ''}${minutes ? 'm ' : ''}focus done`.trim()
    : 'Break over';
  const title = mode === 'focus' && label ? `${what} — ${label}` : what;
  const body = next ? `${next} is loaded and waiting.` : 'Back to the dashboard when you are.';
  const shown = await notify(title, body);

  return rang || shown;
}

// ---------------------------------------------------------------- scheduling

/**
 * Fire `fn` at a wall-clock timestamp.
 *
 * One long timeout rather than a poll, because a hidden tab's repeating timers
 * are throttled to roughly once a minute and a poll would therefore be up to a
 * minute late — on the one event the whole feature exists to deliver on time.
 *
 * A deadline already in the past fires immediately; the clock does not go
 * backwards for us and a missed alarm is worse than a late one.
 */
export function armAt(when, fn) {
  const ms = Number(when) - Date.now();
  if (!Number.isFinite(ms)) return () => {};
  // setTimeout's delay is a signed 32-bit int; anything larger wraps around and
  // fires instantly. Nothing here is ever that far out, but a corrupted stored
  // deadline should do nothing rather than ring at once.
  if (ms > 2147483647) return () => {};
  const t = setTimeout(fn, Math.max(0, ms));
  return () => clearTimeout(t);
}
