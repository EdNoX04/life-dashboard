// The notification system.
//
// WHY THIS EXISTS AS A SYSTEM AND NOT AS SIX CALLS TO alarm.notify()
//
// The pomodoro chime taught the lesson: a notification you have to go and find a
// switch for is a notification that never fires. The switch was in the Study
// tab, at the bottom of one card, and it was never pressed — so the feature
// shipped, worked, and did nothing for anybody. Building five more of those
// would produce five more.
//
// So the parts that must be shared are shared: ONE permission prompt, surfaced
// app-wide rather than per feature; ONE list of what may interrupt you, in one
// settings panel; and ONE ledger of what has already been said, so a reload does
// not re-announce this morning's class at four in the afternoon.
//
// WHAT THIS DELIBERATELY DOES NOT DO
//
// It does not fire when PLAYER ONE is closed. Every timer here lives in the
// page. Real background delivery needs Web Push — a service worker subscription,
// VAPID keys, and a server that decides when to send — and none of that exists
// yet. The UI says so in plain words rather than letting you assume otherwise,
// because a notification system you wrongly believe is watching is worse than
// one you know only works while the tab is open.
//
// WHERE THE DATA COMES FROM
//
// Nowhere. This module holds no collections and subscribes to nothing. Each tab
// already loads what it needs, and calls `fire()` when it has fresh data in
// hand. A root component that re-fetched holdings, timetable, todos, SIPs and
// exams every 45 seconds so it could occasionally say something would cost the
// whole app to serve one feature.

const KEY = 'p1_notify';
const SEEN_KEY = 'p1_notify_seen';

/**
 * What is allowed to interrupt, and what it costs to be wrong about each.
 *
 * `on` is the default. Only the two the user asked for by name start on: a
 * dashboard that begins by interrupting you about six different things is one
 * you switch off wholesale on day two, and then the one that mattered is off
 * too.
 *
 * `needs` is the honest part — the tab that must be open for the channel to fire
 * at all, because that is where its data lives. Shown in the settings panel.
 */
export const CHANNELS = [
  {
    id: 'focus', label: 'Focus timer', on: true, needs: 'Study',
    note: 'When a pomodoro block or a breathing session ends. This is the one you asked for.',
  },
  {
    id: 'class', label: 'Class starting', on: true, needs: 'HQ',
    note: 'Ten minutes before a class on your timetable.',
  },
  {
    id: 'todo', label: 'Tasks due', on: false, needs: 'HQ',
    note: 'Once a day, if something due today is still open. Never more than once.',
  },
  {
    id: 'money', label: 'Big market moves', on: false, needs: 'Money',
    note: 'When one of your holdings moves more than the threshold today. A statement of fact about your own book — never a suggestion to do anything about it.',
  },
  {
    id: 'sip', label: 'SIP problems', on: true, needs: 'Money',
    note: 'When an installment has failed. This one actually needs you to do something in the INDmoney app.',
  },
  {
    id: 'exam', label: 'Exam countdown', on: false, needs: 'Study',
    note: 'At seven, three and one day out from a paper.',
  },
  {
    id: 'sync', label: 'A sync has died', on: true, needs: 'HQ',
    note: 'When a background worker stops reporting healthy — the Amizone session expiring, most often. On by default because a dead sync is silent by nature: the dashboard keeps showing the last numbers it had.',
  },
];

export const CHANNEL_IDS = CHANNELS.map(c => c.id);

export const MIN_MOVE = 1;
export const MAX_MOVE = 50;
export const DEFAULT_MOVE = 5;

export function defaults() {
  const enabled = {};
  for (const c of CHANNELS) enabled[c.id] = c.on;
  return { enabled, movePct: DEFAULT_MOVE };
}

/** Nothing stored is trusted — this is one `localStorage` edit from anybody. */
export function normalize(raw) {
  const base = defaults();
  if (!raw || typeof raw !== 'object') return base;
  const enabled = { ...base.enabled };
  if (raw.enabled && typeof raw.enabled === 'object') {
    for (const id of CHANNEL_IDS) {
      if (typeof raw.enabled[id] === 'boolean') enabled[id] = raw.enabled[id];
    }
  }
  const pct = Number(raw.movePct);
  return {
    enabled,
    movePct: Number.isFinite(pct) ? Math.min(MAX_MOVE, Math.max(MIN_MOVE, pct)) : DEFAULT_MOVE,
  };
}

export function enabledFor(prefs, id) {
  return Boolean(normalize(prefs).enabled[id]);
}

// ---------------------------------------------------------------- the ledger
//
// What has already been said. Without this every render, every tab switch and
// every reload re-announces the same thing — and a notification that repeats is
// indistinguishable from a new one, so you stop reading them.

/** A key is `channel:thing:day` — the day is what makes it repeat tomorrow. */
export function seenKey(channel, thing) {
  return `${channel}:${thing}`;
}

export function hasSeen(seen, channel, thing) {
  return Boolean(seen && seen[seenKey(channel, thing)]);
}

export function markSeen(seen, channel, thing, now = Date.now()) {
  return { ...(seen || {}), [seenKey(channel, thing)]: now };
}

/**
 * Drop entries older than three days.
 *
 * Unbounded, this grows for the life of the browser profile and is re-parsed on
 * every check. Three days is comfortably longer than any key's natural life
 * (they are day-stamped) and short enough that the object stays small.
 */
export function prune(seen, now = Date.now(), maxAgeMs = 3 * 86400000) {
  const out = {};
  for (const [k, t] of Object.entries(seen || {})) {
    if (now - Number(t) <= maxAgeMs) out[k] = t;
  }
  return out;
}

/** Local calendar day. `toISOString()` reports tomorrow in IST after 18:30. */
export function dayStamp(now = new Date()) {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- the triggers
//
// Pure: data in, notifications out. Each returns `[{ thing, title, body }]` —
// `thing` being the identity used for de-duplication, so the caller never has to
// invent one and two call sites cannot invent different ones for the same event.

const hhmm = d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const minutes = t => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/**
 * A class starting within the lead window.
 *
 * Only the NEXT one, and only once: firing for every class in the window would
 * mean three notifications at the start of a lab block.
 */
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function classSoon(timetable, now = new Date(), leadMin = 10) {
  if (!Array.isArray(timetable)) return [];
  // The `timetable` table stores the day as a NAME ("Monday"), not a number —
  // checked against the live rows rather than assumed, because a numeric `dow`
  // would silently match nothing and this would look like a feature that simply
  // never fires. A numeric column is still accepted in case that ever changes.
  const todayName = DAY_NAMES[now.getDay()];
  const todayNum = now.getDay();
  const nowMin = minutes(hhmm(now));
  const out = [];
  for (const row of timetable) {
    if (!row) continue;
    const sameDay = row.day != null
      ? String(row.day).trim().toLowerCase() === todayName.toLowerCase()
      : Number(row.dow) === todayNum;
    if (!sameDay) continue;
    const start = minutes(row.start_time || row.start || row.from || row.time);
    if (start == null) continue;
    const away = start - nowMin;
    // Strictly inside the window and not already begun. A class that started two
    // minutes ago is not news.
    if (away <= 0 || away > leadMin) continue;
    const name = row.subject || row.title || row.name || 'Class';
    const where = row.room || row.location || row.venue;
    out.push({
      thing: `${dayStamp(now)}:${row.start_time || row.start || start}`,
      title: `${name} in ${away} min`,
      body: [where, row.faculty, row.type].filter(Boolean).join(' · ') || 'On your timetable.',
    });
  }
  return out.slice(0, 1);
}

/** Anything due today and still open — once a day, as one notification. */
export function todosDue(todos, now = new Date()) {
  if (!Array.isArray(todos)) return [];
  const today = dayStamp(now);
  const due = todos.filter(t => t && !t.completed && t.due_date && String(t.due_date).slice(0, 10) <= today);
  if (!due.length) return [];
  const overdue = due.filter(t => String(t.due_date).slice(0, 10) < today).length;
  return [{
    thing: today,
    title: due.length === 1 ? String(due[0].title || 'One task due') : `${due.length} tasks due`,
    body: overdue
      ? `${overdue} of them already overdue.`
      : due.slice(0, 3).map(t => t.title).filter(Boolean).join(' · ') || 'Due today.',
  }];
}

/**
 * Holdings that have moved more than the threshold today.
 *
 * STATEMENTS OF FACT ONLY. This says what a number did; it never says what to do
 * about it, and the wording must stay that way — a notification is a terrible
 * place for a recommendation, and Money is read-only by standing rule.
 */
export function bigMoves(holdings, pct = DEFAULT_MOVE, now = new Date()) {
  if (!Array.isArray(holdings)) return [];
  const limit = Math.max(MIN_MOVE, Number(pct) || DEFAULT_MOVE);
  const day = dayStamp(now);
  return holdings
    .map(h => ({ h, chg: Number(h?.day_change_pct ?? h?.changePct ?? h?.dayPct) }))
    .filter(x => Number.isFinite(x.chg) && Math.abs(x.chg) >= limit)
    .sort((a, b) => Math.abs(b.chg) - Math.abs(a.chg))
    .slice(0, 3)
    .map(({ h, chg }) => {
      const sym = h.symbol || h.ticker || h.name || 'A holding';
      const dir = chg > 0 ? 'up' : 'down';
      return {
        thing: `${sym}:${day}`,
        title: `${sym} ${dir} ${Math.abs(chg).toFixed(1)}% today`,
        body: 'Reported because you asked to hear about moves this size. No action implied.',
      };
    });
}

/** A failed installment. The one money notification that genuinely needs action. */
export function sipTrouble(sips, now = new Date()) {
  if (!Array.isArray(sips)) return [];
  const day = dayStamp(now);
  const bad = sips.filter(s => /fail/i.test(String(s?.last_status || s?.status || '')));
  if (!bad.length) return [];
  return [{
    thing: day,
    title: bad.length === 1 ? `SIP failed: ${bad[0].name || bad[0].symbol || 'one installment'}` : `${bad.length} SIP installments failed`,
    body: 'Needs fixing in the INDmoney app — nothing here can retry it.',
  }];
}

/**
 * Workers that have stopped reporting healthy.
 *
 * WHY THIS IS ON BY DEFAULT, when the other five are not.
 *
 * Every other notification here tells you about something that happened. This
 * one tells you that something STOPPED happening, and that is a category the
 * dashboard is structurally bad at showing you: when the Amizone sync dies, the
 * attendance card does not go blank or turn red — it keeps displaying the last
 * numbers it successfully fetched, indefinitely, with no indication they are
 * from three weeks ago. That exact failure is recorded twice in the project
 * notes ("attendance stayed frozen for weeks with nothing visibly wrong") and it
 * is the one thing a notification is genuinely better at than a screen.
 *
 * Keyed by worker AND day, so a permanently dead sync says so once a day rather
 * than every minute — enough to be remembered, not enough to be muted.
 */
export function syncDown(status, now = new Date()) {
  if (!status || typeof status !== 'object') return [];
  const day = dayStamp(now);
  const out = [];
  for (const [worker, s] of Object.entries(status)) {
    // `ok` must be explicitly false. A worker that has never reported has no
    // `ok` at all, and "we have never heard from this" is not the same claim as
    // "this is broken" — announcing the first as the second is how a nightly
    // false alarm trains you to ignore the real one.
    if (!s || typeof s !== 'object' || s.ok !== false) continue;
    if (s.configured === false) continue;   // not set up is not the same as broken
    const reason = typeof s.reason === 'string' ? s.reason.trim() : '';
    out.push({
      thing: `${worker}:${day}`,
      title: `${worker} sync has stopped`,
      body: reason || 'It is reporting unhealthy. The dashboard is still showing its last good data.',
    });
  }
  return out.slice(0, 2);
}

export const EXAM_MILESTONES = [7, 3, 1];

/** Seven, three and one day out. Not every day — that is a countdown, not news. */
export function examSoon(exams, now = new Date()) {
  if (!Array.isArray(exams)) return [];
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const out = [];
  for (const e of exams) {
    if (!e?.date) continue;
    const d = new Date(`${String(e.date).slice(0, 10)}T00:00:00`);
    if (Number.isNaN(d.getTime())) continue;
    const days = Math.round((d - today) / 86400000);
    if (!EXAM_MILESTONES.includes(days)) continue;

    // `name`/`short` FIRST, because that is what exams.js actually produces —
    // its rows are { slug, name, short, code, date, start, end }. Written
    // against `subject`/`title` this read "undefined in 7 days", which is the
    // failure mode this whole file keeps running into: a shape mismatch does
    // not throw, it just ships something quietly wrong. Caught by printing one
    // real row rather than by trusting the field names in my head.
    const name = e.name || e.short || e.subject || e.title;
    if (!name) continue;
    const at = e.start || e.time;
    out.push({
      thing: `${name}:${days}`,
      title: days === 1 ? `${name} is tomorrow` : `${name} in ${days} days`,
      body: at ? `${at}${e.room ? ` · ${e.room}` : ''}` : 'On your exam schedule.',
    });
  }
  return out;
}

// ---------------------------------------------------------------- the hub
//
// Everything above is pure. Below is the single piece of state the system has,
// and it is deliberately in the same file: a "notification module" whose
// preferences live somewhere else is how you end up with two switches that
// disagree about whether a thing is on.

import * as alarm from './alarm.js';

let P = null;
let SEEN = null;
const subs = new Set();
const emit = () => { for (const f of [...subs]) f(); };
export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }

function read(key, fallback) {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}
function write(key, value) {
  try { globalThis.localStorage?.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
}

export function prefs() {
  if (!P) P = normalize(read(KEY, null));
  return P;
}

export function setPrefs(patch) {
  P = normalize({ ...prefs(), ...patch });
  write(KEY, P);
  // THE FOCUS CHANNEL IS THE ALARM'S OWN SWITCH, not a second one beside it.
  // The pomodoro shipped with its popup preference in alarm.js; adding an
  // independent one here would give two controls for one behaviour, and the
  // person would be right to expect either of them to work.
  if (patch?.enabled && Object.prototype.hasOwnProperty.call(patch.enabled, 'focus')) {
    alarm.setPrefs({ notify: Boolean(patch.enabled.focus) });
  }
  emit();
  return P;
}

/** The live state of one channel — `focus` reads through to the alarm. */
export function isOn(id) {
  if (id === 'focus') return alarm.prefs().notify;
  return Boolean(prefs().enabled[id]);
}

export const permission = () => alarm.notifyPermission();
export const ask = () => alarm.askNotify();

// The banner is dismissible, and the dismissal is remembered — a bar that comes
// back every reload after you have said no is not a prompt, it is nagging.
const DISMISS_KEY = 'p1_notify_bar';
export function bannerDismissed() { return read(DISMISS_KEY, false) === true; }
export function dismissBanner() { write(DISMISS_KEY, true); emit(); }

/**
 * Say the things worth saying, and only once each.
 *
 * Takes what a trigger produced and does the four checks no call site should be
 * repeating: is the channel on, has permission been given, has this exact thing
 * already been announced, and is the ledger getting long. Returns how many were
 * actually shown, so a caller can tell "nothing happened" from "nothing to say".
 */
export async function fire(channel, items) {
  if (!Array.isArray(items) || !items.length) return 0;
  if (!isOn(channel)) return 0;
  if (permission() !== 'granted') return 0;

  if (!SEEN) SEEN = prune(read(SEEN_KEY, {}));
  let shown = 0;
  for (const it of items) {
    if (!it?.thing || hasSeen(SEEN, channel, it.thing)) continue;
    SEEN = markSeen(SEEN, channel, it.thing);
    // Marked BEFORE the await, not after: two tabs checking the same second
    // would otherwise both pass the check and both announce.
    const okShown = await alarm.notify(it.title, it.body, `p1-${channel}`);
    if (okShown) shown++;
  }
  write(SEEN_KEY, SEEN);
  return shown;
}

/** For tests and for the "test it" button — forget what has been announced. */
export function resetSeen() { SEEN = {}; write(SEEN_KEY, {}); }
