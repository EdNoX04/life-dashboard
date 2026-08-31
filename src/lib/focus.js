// Focus history — what the pomodoro timer was actually spent on.
//
// The timer used to count rounds and forget them. A number that resets at
// midnight cannot answer "how much time has this subject had this week", which
// is the only question worth asking of a focus timer once you have used it for
// more than a day.
//
// Everything here is pure and takes its rows and its `now` as arguments, so the
// aggregation can be tested without a database and without a clock.

/** Minutes are stored, not derived — see the note in the migration. */
export const MIN_LABEL = 'Focus';

/** Trim, collapse whitespace, cap the length, and never return an empty string. */
export function cleanLabel(raw, fallback = MIN_LABEL) {
  const s = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
  return s || fallback;
}

/**
 * Build the row for a completed block.
 *
 * `endedAt` comes from the timer's own deadline rather than from the clock at
 * the moment the UI noticed. A block that finished while the laptop was shut
 * ended when it ended, not when you opened the lid.
 */
export function sessionRow({ mode = 'focus', label, todo, minutes, endedAt = Date.now() }) {
  const mins = Math.max(1, Math.round(Number(minutes) || 0));
  const end = new Date(endedAt);
  const start = new Date(end.getTime() - mins * 60000);
  return {
    mode,
    // A copy of the title, not just the id: deleting the task must not erase
    // the record that you worked on it.
    label: cleanLabel(label || todo?.title, mode === 'focus' ? MIN_LABEL : 'Break'),
    todo_id: todo?.id ?? null,
    started_at: start.toISOString(),
    ended_at: end.toISOString(),
    minutes: mins,
  };
}

const isFocus = r => (r?.mode ?? 'focus') === 'focus';
const mins = r => Math.max(0, Math.round(Number(r?.minutes) || 0));

/** Local calendar date of a row, as YYYY-MM-DD. Local, not UTC — see exams.js. */
export function dayOf(row) {
  const d = new Date(row?.ended_at ?? 0);
  if (Number.isNaN(d.getTime())) return '';
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function todayKey(now = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** Total focus minutes on a given local day. */
export function minutesOn(rows, day) {
  if (!Array.isArray(rows)) return 0;
  return rows.filter(r => isFocus(r) && dayOf(r) === day).reduce((s, r) => s + mins(r), 0);
}

/** Focus minutes in the last n days, including today. */
export function minutesSince(rows, days = 7, now = new Date()) {
  if (!Array.isArray(rows)) return 0;
  const cutoff = now.getTime() - (days - 1) * 86400000;
  const start = new Date(cutoff); start.setHours(0, 0, 0, 0);
  return rows
    .filter(r => isFocus(r) && new Date(r.ended_at).getTime() >= start.getTime())
    .reduce((s, r) => s + mins(r), 0);
}

/**
 * Total focus time per label, most time first.
 *
 * Grouped by label rather than by todo id, because the same work often spans a
 * task that was completed and recreated, and because free-text blocks have no
 * id at all. The todo id is carried through when every row in a group agrees on
 * it, so the UI can still link back.
 */
export function totalsByLabel(rows) {
  if (!Array.isArray(rows)) return [];
  const map = new Map();
  for (const r of rows) {
    if (!isFocus(r)) continue;
    const key = cleanLabel(r.label);
    const cur = map.get(key) || { label: key, minutes: 0, sessions: 0, todo_id: r.todo_id ?? null, last: 0 };
    cur.minutes += mins(r);
    cur.sessions += 1;
    if (cur.todo_id !== (r.todo_id ?? null)) cur.todo_id = cur.todo_id ?? r.todo_id ?? null;
    const t = new Date(r.ended_at).getTime();
    if (t > cur.last) cur.last = t;
    map.set(key, cur);
  }
  return [...map.values()].sort((a, b) => b.minutes - a.minutes || b.last - a.last);
}

/** Focus minutes per day for the last n days, oldest first — for a sparkline. */
export function dailySeries(rows, days = 14, now = new Date()) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400000);
    const key = todayKey(d);
    out.push({ day: key, minutes: minutesOn(rows, key) });
  }
  return out;
}

/**
 * Consecutive days ending today (or yesterday) with at least one focus block.
 *
 * Yesterday counts as the anchor so the streak does not read zero every morning
 * before the first session — a counter that punishes you for not having started
 * yet is a counter people stop looking at.
 */
export function streak(rows, now = new Date()) {
  if (!Array.isArray(rows)) return 0;
  const days = new Set(rows.filter(isFocus).map(dayOf));
  if (!days.size) return 0;
  let n = 0;
  let cursor = new Date(now);
  if (!days.has(todayKey(cursor))) {
    cursor = new Date(cursor.getTime() - 86400000);
    if (!days.has(todayKey(cursor))) return 0;
  }
  while (days.has(todayKey(cursor))) {
    n += 1;
    cursor = new Date(cursor.getTime() - 86400000);
  }
  return n;
}

/** "1h 25m", "45m", "—". */
export function fmtMinutes(m) {
  const n = Math.max(0, Math.round(Number(m) || 0));
  if (!n) return '—';
  const h = Math.floor(n / 60), r = n % 60;
  if (!h) return `${r}m`;
  return r ? `${h}h ${r}m` : `${h}h`;
}

/** "today", "yesterday", "3 days ago", or a date. */
export function ago(iso, now = new Date()) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const a = todayKey(now), b = todayKey(new Date(t));
  if (a === b) return 'today';
  if (todayKey(new Date(now.getTime() - 86400000)) === b) return 'yesterday';
  const days = Math.round((new Date(a).getTime() - new Date(b).getTime()) / 86400000);
  if (days > 0 && days < 7) return `${days} days ago`;
  return new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/**
 * Candidate tasks to attach a block to.
 *
 * Open todos only, soonest due first, undated last — the same order the Todo tab
 * uses, so the picker does not present a different idea of priority than the
 * list it came from.
 */
export function pickableTodos(todos, limit = 12) {
  // A default parameter does not apply to an explicit `null`, and useCollection
  // can hand one over before its first load resolves. Guard the value, not the
  // signature.
  if (!Array.isArray(todos)) return [];
  return todos
    .filter(t => t && !t.completed && t.title)
    .sort((a, b) => {
      const ad = a.due_date || '9999-12-31', bd = b.due_date || '9999-12-31';
      if (ad !== bd) return ad < bd ? -1 : 1;
      return (a.sort_order ?? 0) - (b.sort_order ?? 0);
    })
    .slice(0, limit);
}
