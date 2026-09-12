// The day, assembled from every place that can put something in it.
//
// PLAYER ONE has four things that can occupy a moment — a class, a Google
// calendar event, a meeting it booked itself, and a scheduled todo (which is
// also how PLAYER TWO puts something in the day). Until now each one drew its
// own row in its own tab and nothing ever compared them. Three consequences,
// all of which Neel has hit:
//
//   1. A meeting booked HERE appears TWICE on any combined view — once as the
//      `meetings` row that owns the Meet link and the status, and again as the
//      calendar event Google hands back for it. The fold that already exists
//      (scripts/lib/calendar-fold.mjs) folds calendar against calendar, so it
//      never sees this pair.
//   2. A task scheduled for 09:00 and a class at 09:00 never meet, so nothing
//      says he has double-booked himself.
//   3. "What's next" is answered separately by HQ, the Calendar tab and the
//      notification worker, each from a different subset — so they can, and do,
//      disagree.
//
// This module is the single answer to all three. Pure functions over rows the
// caller already holds, so every rule below is a test rather than something
// discovered on a Tuesday morning when two things turned out to be at once.

const str = v => String(v ?? '').trim();
const norm = s => str(s).toLowerCase().replace(/\s+/g, ' ');

/** Local-time instant for a date + HH:MM. No 'Z' — a class at 09:00 is 09:00 here. */
export function atOf(dateISO, hhmm) {
  const d = str(dateISO), t = str(hhmm).slice(0, 5);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !/^\d{2}:\d{2}$/.test(t)) return null;
  const ms = Date.parse(`${d}T${t}:00`);
  return Number.isFinite(ms) ? ms : null;
}

/** The local calendar date of an instant — NOT toISOString(), which is UTC and
 *  moves an 11pm event to tomorrow for everyone east of Greenwich. */
export function dayISO(ms) {
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return null;
  const z = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

// A minute of length for something that has a start and no end. It has to be
// non-zero or it can never overlap anything, and then conflict detection
// silently stops working for exactly the rows most likely to be sloppy.
export const DEFAULT_MIN = 30;

/**
 * One item shape, whatever it came from.
 *
 *   source   'class' | 'event' | 'meeting' | 'todo'
 *   at/endAt local instants in ms, or null for something with no time
 *   blocking occupies real time, so it can collide with something else
 *   done     already finished — kept in the list, never offered as "next"
 */
const item = o => ({
  id: str(o.id), source: o.source, title: str(o.title) || '(untitled)',
  at: o.at ?? null, endAt: o.endAt ?? null, allDay: !!o.allDay,
  where: str(o.where), url: str(o.url), done: !!o.done,
  blocking: o.at != null && !o.allDay && !o.done,
  color: str(o.color), folded: [], meta: o.meta || {},
});

// ------------------------------------------------------------------ adapters

/** Classes for one day, from today.js `dayRows()`. A dropped class is not in it. */
export function fromClasses(dayRowsResult) {
  const r = dayRowsResult || {};
  const date = r.iso;
  return (Array.isArray(r.rows) ? r.rows : []).map(c => item({
    id: `class:${c.id}`, source: 'class',
    title: c.subject || c.code || 'Class',
    at: atOf(date, c.start_time), endAt: atOf(date, c.end_time),
    where: c.room || '',
    // The room change and the fact it was an extra are the two things about a
    // class that are worth knowing from a combined view, so they survive here
    // rather than only in the College tab.
    meta: { change: c.change || null, usualRoom: c.usualRoom || '', code: c.code || '' },
  }));
}

/** Google events, from memory.calendar_events. Already folded across accounts. */
export function fromCalendar(events) {
  return (Array.isArray(events) ? events : []).map(e => {
    const start = Date.parse(e?.start ?? '');
    const end = Date.parse(e?.end ?? '');
    return item({
      id: `event:${e?.id ?? ''}`, source: 'event', title: e?.summary,
      at: Number.isFinite(start) ? start : null,
      endAt: Number.isFinite(end) ? end : null,
      allDay: !!e?.allDay, where: e?.location, url: e?.meet || e?.htmlLink,
      color: e?.color,
      meta: { gcalId: str(e?.gcalId), account: str(e?.account), response: str(e?.response) },
    });
  }).filter(i => i.at != null || i.allDay);
}

/** Meetings this app booked. These own the join link and the creation status. */
export function fromMeetings(meetings) {
  return (Array.isArray(meetings) ? meetings : []).map(m => {
    const start = Date.parse(m?.start ?? '');
    const end = Date.parse(m?.end ?? m?.start ?? '');
    return item({
      id: `meeting:${m?.id ?? ''}`, source: 'meeting', title: m?.title,
      at: Number.isFinite(start) ? start : null,
      endAt: Number.isFinite(end) ? end : null,
      url: m?.meet, meta: { gcalId: str(m?.gcal_id), status: str(m?.status) },
    });
  }).filter(i => i.at != null);
}

/**
 * Scheduled todos. A todo with a date but no time is a DEADLINE, not a block —
 * it belongs to the day without occupying a moment in it, so it comes back
 * all-day and can never collide with a class.
 */
export function fromTodos(todos, { defaultMin = DEFAULT_MIN } = {}) {
  return (Array.isArray(todos) ? todos : []).filter(t => t?.due_date).map(t => {
    const at = atOf(t.due_date, t.due_time);
    const mins = Number(t.duration_min) > 0 ? Number(t.duration_min) : defaultMin;
    return item({
      id: `todo:${t?.id ?? ''}`, source: 'todo', title: t?.title,
      at, endAt: at == null ? null : at + mins * 60000,
      allDay: at == null, done: !!t.completed,
      meta: { priority: t.priority ?? null, date: t.due_date },
    });
  });
}

// --------------------------------------------------------------------- fold
//
// THE RULE: a meeting booked here and the calendar event Google created for it
// are ONE thing. Nothing else folds.
//
// Two identities, tried in order. The gcal id is exact and is what a meeting
// created since the worker started recording it will match on. The fallback —
// same start instant, same title — covers the older rows whose gcal_id was
// never written back, and is deliberately strict: same MINUTE is not enough,
// because two different meetings at 10:00 and 10:00:30 are still two meetings,
// and a looser key would silently delete one of them.
//
// The meeting wins and the event is folded into it, in that direction on
// purpose: the meeting row carries the Meet link, the guest list and the
// "creating…" status, and the calendar copy carries none of those. Folding the
// other way would lose the link, which is the only reason the row is useful
// ninety seconds before it starts.
export function foldAgenda(items) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  const meetings = list.filter(i => i.source === 'meeting');
  const out = [];

  for (const i of list) {
    if (i.source !== 'event') { out.push(i); continue; }
    const gid = str(i.meta?.gcalId);
    const twin = meetings.find(m =>
      (gid && str(m.meta?.gcalId) === gid)
      || (m.at != null && i.at != null && m.at === i.at && norm(m.title) === norm(i.title)));
    if (twin) { twin.folded = [...twin.folded, i.id]; continue; }
    out.push(i);
  }
  return out;
}

// ---------------------------------------------------------------- conflicts

/** Half-open overlap: a thing ending at 10:00 and one starting at 10:00 do not clash. */
export const overlap = (a, b) =>
  a.at != null && b.at != null
  && a.at < (b.endAt ?? b.at + DEFAULT_MIN * 60000)
  && b.at < (a.endAt ?? a.at + DEFAULT_MIN * 60000);

/**
 * Every pair of blocking items that occupy the same time.
 *
 * Pairs rather than clusters, because the useful sentence is "this meeting is
 * on top of that class" and a cluster cannot say which two things to look at.
 * A done todo never conflicts — the point of a conflict is that it is still
 * about to happen to you.
 */
export function conflicts(items) {
  const b = (Array.isArray(items) ? items : []).filter(i => i?.blocking).sort((x, y) => x.at - y.at);
  const out = [];
  for (let i = 0; i < b.length; i++) {
    for (let j = i + 1; j < b.length; j++) {
      if (b[j].at >= (b[i].endAt ?? b[i].at + DEFAULT_MIN * 60000)) break;
      if (overlap(b[i], b[j])) out.push([b[i], b[j]]);
    }
  }
  return out;
}

// ------------------------------------------------------------------ the day

const rank = { class: 0, meeting: 1, event: 2, todo: 3 };

/**
 * Everything on one date, folded, ordered, with its clashes named.
 *
 * Ordering: by start, then by source so the order never wobbles between two
 * renders of identical data — a list that reshuffles on a poll reads as a bug
 * even when every row in it is right. All-day items come last: they are true of
 * the whole day, so putting them at 00:00 would push a deadline above the 9am
 * class it is not more urgent than.
 */
export function agendaFor(dateISO, { classes = [], events = [], meetings = [], todos = [] } = {}) {
  const date = str(dateISO);
  const all = foldAgenda([
    ...fromClasses(classes), ...fromCalendar(events),
    ...fromMeetings(meetings), ...fromTodos(todos),
  ]);

  const mine = all.filter(i => {
    if (i.at != null) return dayISO(i.at) === date;
    return str(i.meta?.date) === date;   // an all-day todo knows its own date
  });

  mine.sort((a, b) => {
    if (a.allDay !== b.allDay) return a.allDay ? 1 : -1;
    if (a.at !== b.at) return (a.at ?? 0) - (b.at ?? 0);
    if (rank[a.source] !== rank[b.source]) return rank[a.source] - rank[b.source];
    return a.id.localeCompare(b.id);
  });

  return { date, items: mine, conflicts: conflicts(mine) };
}

/**
 * The single next thing — the answer HQ, the Calendar tab and the notifier
 * should all be giving.
 *
 * Something happening RIGHT NOW wins over something later, which is the whole
 * point: at 09:05 the useful answer is the class you are in, not the one at
 * ten. Anything already finished, all-day, or ticked off is never it.
 */
export function nextUp(items, now = Date.now()) {
  const live = [], soon = [];
  for (const i of Array.isArray(items) ? items : []) {
    if (!i || i.done || i.allDay || i.at == null) continue;
    const end = i.endAt ?? i.at + DEFAULT_MIN * 60000;
    if (i.at <= now && now < end) live.push(i);
    else if (i.at > now) soon.push(i);
  }
  if (live.length) return { ...live.sort((a, b) => a.at - b.at)[0], live: true, inMin: 0 };
  const n = soon.sort((a, b) => a.at - b.at)[0];
  return n ? { ...n, live: false, inMin: Math.round((n.at - now) / 60000) } : null;
}
