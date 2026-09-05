// What is ACTUALLY on today.
//
// THE GAP THIS CLOSES
//
// `amizone-push.mjs` builds the `timetable` table from slots that recur on the
// same weekday and time across at least two distinct dates in the last 35 days.
// That rule is right, and it is deliberately lossy: it is what stops makeups and
// one-off sessions from being welded into a permanent weekly grid, and it is why
// Friday finally shows one IoT class instead of the two a photo-derived grid
// claimed.
//
// But a recurring grid cannot, by construction, tell you the two things that
// most often make a morning go wrong:
//
//   · an EXTRA class added for today only
//   · a ROOM that has changed from the usual one
//
// Both of those are already in Supabase. `memory.amizone_raw_diary` holds every
// event the sync saw — start, end, title, code, room, faculty, sType — and
// nothing in the app was reading it. So the dashboard has been showing a correct
// weekly pattern while the actual day drifted away from it.
//
// This module reconciles the two: the diary is the truth about today, the grid
// is what "usually" looks like, and the difference between them is the news.

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Amizone's own datetime shape, parsed exactly as amizone-push.mjs does. */
export function parseAmz(s) {
  const m = String(s || '').match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?/i);
  if (!m) return null;
  const [, y, mo, d, hhRaw, mm, ap] = m;
  let hh = parseInt(hhRaw, 10);
  if (ap) {
    const p = ap.toUpperCase();
    if (p === 'PM' && hh !== 12) hh += 12;
    if (p === 'AM' && hh === 12) hh = 0;
  }
  return { iso: `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`, hm: `${String(hh).padStart(2, '0')}:${mm}` };
}

/** Local calendar day. `toISOString()` reports tomorrow in IST after 18:30. */
export function isoDay(now = new Date()) {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const dayName = iso => DAYS[new Date(`${iso}T00:00:00`).getDay()] || '';

/** Classes only. Holidays and notices are events, not something to turn up to. */
const isClass = e => {
  const t = String(e?.sType || '').toUpperCase();
  return t !== 'H' && t !== 'E' && e?.allDay !== true;
};

const norm = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Is the diary trustworthy for this date?
 *
 * A date outside the window the sync actually fetched has no events for a
 * boring reason — nobody asked. Treating that as "no classes today" would be
 * the worst possible failure of this module: a confidently empty morning.
 */
export function covers(diary, iso) {
  const w = diary?.window;
  if (!w?.start || !w?.end) return false;
  return iso >= String(w.start).slice(0, 10) && iso <= String(w.end).slice(0, 10);
}

/**
 * Today, reconciled.
 *
 * Returns `{ known, day, classes, dropped }`.
 *
 * `known` is false when the diary cannot speak for this date, and the caller
 * must then fall back to the weekly grid rather than render an empty day.
 *
 * Each class carries a `change`:
 *   null    — matches the usual grid
 *   'extra' — no grid slot at this time: an added session
 *   'room'  — grid slot exists, room differs. `usualRoom` says from what.
 *   'time'  — same subject today, but not at a time the grid knows about
 *
 * `dropped` lists grid slots with no diary event today — a likely cancellation.
 * Reported separately and never as a class, because "probably cancelled" and
 * "definitely on" must not look alike.
 */
export function todayClasses(diary, timetable, now = new Date()) {
  const iso = isoDay(now);
  const day = dayName(iso);
  const grid = (Array.isArray(timetable) ? timetable : []).filter(t => t?.day === day);

  if (!covers(diary, iso)) return { known: false, day, iso, classes: [], dropped: [] };

  const events = (diary?.events || []).filter(isClass);
  const seen = new Set();
  const classes = [];

  for (const e of events) {
    const s = parseAmz(e.start);
    if (!s || s.iso !== iso) continue;
    const end = parseAmz(e.end);
    const subject = String(e.title || e.code || '').trim();
    if (!subject || s.hm === '00:00') continue;

    // Amizone repeats events across the overlapping chunk boundaries the sync
    // fetches, so the same class genuinely arrives more than once.
    const key = `${s.hm}|${norm(subject)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // MATCH ON SUBJECT FIRST, then time. Matching on time first looks natural
    // and is wrong: a different subject in the 09:00 slot is a substituted or
    // extra class, and time-first matching reported it as a ROOM CHANGE to the
    // subject that normally sits there — the wrong subject, in the wrong room,
    // with no hint that anything unusual was happening. A test caught it.
    const sameSubject = grid.filter(g => norm(g.subject) === norm(subject));
    const slot = sameSubject.find(g => g.start_time === s.hm) || sameSubject[0] || null;

    let change = null;
    let usualRoom = '';
    if (!slot) change = 'extra';
    else if (slot.start_time !== s.hm) change = 'time';
    else if (e.room && slot.room && norm(e.room) !== norm(slot.room)) { change = 'room'; usualRoom = slot.room; }

    classes.push({
      subject, code: e.code || '', start: s.hm, end: end?.hm || '',
      room: e.room || slot?.room || '', faculty: e.faculty || slot?.faculty || '',
      change, usualRoom, matchedSlot: slot ? (slot.id ?? true) : null,
    });
  }

  classes.sort((a, b) => a.start.localeCompare(b.start));

  // A grid slot counts as held if today's diary has that SUBJECT at all — a
  // class moved an hour is still a class you have, not a cancellation.
  const heldSubjects = new Set(classes.map(c => norm(c.subject)));
  const dropped = grid
    .filter(g => !heldSubjects.has(norm(g.subject)))
    .map(g => ({ subject: g.subject, start: g.start_time, end: g.end_time, room: g.room }));

  return { known: true, day, iso, classes, dropped };
}

/** One short line naming what is different today, or '' when nothing is. */
export function changeSummary(t) {
  if (!t?.known) return '';
  const extra = t.classes.filter(c => c.change === 'extra').length;
  const moved = t.classes.filter(c => c.change === 'room').length;
  const gone = t.dropped.length;
  const bits = [];
  if (extra) bits.push(`${extra} extra class${extra > 1 ? 'es' : ''}`);
  if (moved) bits.push(`${moved} room change${moved > 1 ? 's' : ''}`);
  if (gone) bits.push(`${gone} usual slot${gone > 1 ? 's' : ''} not on the diary`);
  return bits.join(' · ');
}

/** Short label for a chip beside a class. */
export const CHANGE_LABEL = { extra: 'EXTRA', room: 'ROOM CHANGED', time: 'MOVED' };

/**
 * The next class starting within `leadMin`, for the notification.
 *
 * Diary-driven, so an extra class notifies and the room it names is today's
 * room rather than the one the grid remembers.
 */
export function startingSoon(diary, timetable, now = new Date(), leadMin = 10) {
  const t = todayClasses(diary, timetable, now);
  if (!t.known) return [];
  const mins = hm => { const m = /^(\d{1,2}):(\d{2})/.exec(hm || ''); return m ? +m[1] * 60 + +m[2] : null; };
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const out = [];
  for (const c of t.classes) {
    const st = mins(c.start);
    if (st == null) continue;
    const away = st - nowMin;
    if (away <= 0 || away > leadMin) continue;
    const tag = c.change === 'extra' ? ' (extra class)' : c.change === 'room' ? ` (room changed from ${c.usualRoom})` : '';
    out.push({
      thing: `${t.iso}:${c.start}:${norm(c.subject)}`,
      title: `${c.subject} in ${away} min${tag}`,
      body: [c.room && `Room ${c.room}`, c.faculty].filter(Boolean).join(' · ') || 'On your diary.',
    });
  }
  return out.slice(0, 1);
}

/**
 * The viewed day as rows shaped exactly like `timetable` rows.
 *
 * HQ, the brief line and the College tab all read `start_time` / `subject` /
 * `room` off grid rows. Handing them a differently-shaped object would mean
 * touching every one of those call sites, so the reconciliation is translated
 * back into the shape the app already speaks — with `change` and `usualRoom`
 * riding along for the chip.
 *
 * When the diary cannot speak for that date this returns the plain weekly grid
 * with `known: false`. That fallback is the point: an unfetched date must look
 * like "here is the usual Monday", never like "you have nothing on".
 */
export function dayRows(diary, timetable, when = new Date()) {
  const t = todayClasses(diary, timetable, when);
  if (!t.known) {
    const grid = (Array.isArray(timetable) ? timetable : [])
      .filter(r => r?.day === t.day)
      .map(r => ({ ...r, change: null, usualRoom: '' }));
    grid.sort((a, b) => String(a.start_time || '').localeCompare(String(b.start_time || '')));
    return { known: false, day: t.day, iso: t.iso, rows: grid, dropped: [] };
  }
  return {
    known: true, day: t.day, iso: t.iso, dropped: t.dropped,
    rows: t.classes.map((c, i) => ({
      // A real slot id where there is one, so React keeps the same node across
      // polls; a stable synthetic key for extras, which have no grid row.
      id: c.matchedSlot && c.matchedSlot !== true ? c.matchedSlot : `${t.iso}-${c.start}-${i}`,
      day: t.day, subject: c.subject, code: c.code,
      start_time: c.start, end_time: c.end,
      room: c.room, faculty: c.faculty,
      change: c.change, usualRoom: c.usualRoom,
    })),
  };
}

/**
 * The calendar date behind `activeDay()`'s weekday name.
 *
 * After 9pm HQ shows the next teaching day, and the diary is keyed by date, not
 * by weekday — so it has to be told WHICH Monday. Walks forward from today to
 * the next date whose weekday matches, which is also what makes Sunday fold to
 * Monday correctly.
 */
export function dateOfDay(name, now = new Date(), rolled = false) {
  const d = new Date(now);
  if (!rolled) return d;
  for (let i = 0; i < 8; i++) {
    d.setDate(d.getDate() + 1);
    if (dayName(isoDay(d)) === name) return d;
  }
  return d;
}
