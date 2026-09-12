// Medication courses, and adherence that cannot flatter you.
//
// The Body tab already logs a medicine you took. What it could not do is know
// what you were SUPPOSED to take — so "did I finish the antibiotics" had no
// answer, which is the one question where the answer actually matters.
//
// A course is the prescription: this drug, this dose, at these times, from this
// day to that one. A log entry is the event: you took it. Adherence is the two
// compared, and almost every implementation of it is quietly wrong in the same
// four ways:
//
//   1. AS-NEEDED MEDS COUNT AS MISSED. A painkiller you take when it hurts
//      expects nothing. Folding it into the percentage makes a careful week
//      look like a bad one, and the number stops being read.
//   2. THE FUTURE COUNTS AS MISSED. On Monday, a ten-day course reads 10% and
//      falling. Nothing is missed until its time has passed.
//   3. TONIGHT'S DOSE IS ALREADY MISSED AT BREAKFAST. A 21:00 dose at 09:00 is
//      PENDING. Three states, not two, or the number is wrong all day and right
//      at midnight.
//   4. TAKING IT TWICE COUNTS TWICE. Two logs against one scheduled dose is not
//      200% adherence; it is one dose taken and possibly a mistake.
//
// Every one of those is a test below.
//
// WHAT THIS FILE WILL NOT DO: interactions, dose limits, contraindications.
// Neel did not ask for them and they are the part that would be dangerous to
// get slightly right. Nothing here is clinical advice; it is a record of what
// was prescribed and what was taken.

const str = v => String(v ?? '').trim();
const norm = s => str(s).toLowerCase();
const int = v => { const n = Number(v); return Number.isFinite(n) ? Math.trunc(n) : 0; };
const pad = n => String(n).padStart(2, '0');

export const UNITS = ['tablet', 'capsule', 'ml', 'mg', 'drop', 'puff', 'sachet', 'unit'];

/**
 * How a course repeats.
 *
 *   times   — the same clock times every day. The common case: "1-0-1".
 *   everyN  — those times, but only every Nth day counting from `from`.
 *   prn     — as needed. EXPECTS NOTHING, ever. See failure 1 above.
 */
export const SCHEDULES = [
  { kind: 'times', label: 'Every day' },
  { kind: 'everyN', label: 'Every N days' },
  { kind: 'prn', label: 'As needed' },
];

export const isPrn = c => c?.schedule?.kind === 'prn';

const dayDiff = (a, b) => Math.round((Date.parse(`${b}T00:00:00`) - Date.parse(`${a}T00:00:00`)) / 86400000);
const validDate = d => /^\d{4}-\d{2}-\d{2}$/.test(str(d)) && !Number.isNaN(Date.parse(str(d)));

export function normaliseCourse(c = {}) {
  const kind = ['times', 'everyN', 'prn'].includes(c?.schedule?.kind) ? c.schedule.kind : 'times';
  const times = (Array.isArray(c?.schedule?.times) ? c.schedule.times : [])
    .map(t => str(t).slice(0, 5)).filter(t => /^\d{2}:\d{2}$/.test(t)).sort();
  return {
    id: str(c.id) || `c${Date.now()}`,
    name: str(c.name).slice(0, 120),
    salt: str(c.salt).slice(0, 160),
    dose: str(c.dose).slice(0, 40) || '1',
    unit: UNITS.includes(c.unit) ? c.unit : 'tablet',
    // A course with no times and no prn would expect nothing while claiming to
    // be scheduled — it defaults to one morning dose rather than to silence.
    schedule: { kind, times: kind === 'prn' ? [] : (times.length ? times : ['09:00']), n: Math.max(1, int(c?.schedule?.n) || 1) },
    from: validDate(c.from) ? str(c.from) : null,
    to: validDate(c.to) ? str(c.to) : null,
    // Stopping is not deleting. A course you came off early is part of the
    // record — the dates it covered still happened.
    stopped: str(c.stopped) || '',
    note: str(c.note).slice(0, 400),
    reason: str(c.reason).slice(0, 120),   // what it is for; links to a symptom episode
  };
}

/** The last day this course expects anything: its end, or the day it was stopped. */
export const lastDay = c => {
  const ends = [c?.to, c?.stopped].filter(validDate).sort();
  return ends.length ? ends[0] : null;
};

export const isActive = (c, today) => {
  if (!c?.from || c.from > today) return false;
  const end = lastDay(c);
  return !end || end >= today;
};

/** The doses a course expects on one date. Empty for PRN, and outside its range. */
export function dueOn(course, date) {
  const c = normaliseCourse(course || {});
  if (!validDate(date) || isPrn(c) || !c.from || date < c.from) return [];
  const end = lastDay(c);
  if (end && date > end) return [];
  if (c.schedule.kind === 'everyN' && dayDiff(c.from, date) % c.schedule.n !== 0) return [];
  return c.schedule.times.map(t => ({ time: t, key: `${c.id}|${date}|${t}` }));
}

const DOSE = { TAKEN: 'taken', MISSED: 'missed', PENDING: 'pending' };
export const DOSE_STATE = DOSE;

/**
 * One day of one course: every expected dose, and what became of it.
 *
 * `nowMin` is minutes since midnight on `date`, or null when `date` is not
 * today. It is what separates PENDING from MISSED, and getting it wrong is
 * failure 3 — a percentage that is wrong all day and correct only at midnight.
 *
 * GRACE_MIN exists because a dose is not missed the second the clock passes it.
 * An hour is generous enough not to nag and short enough to still be true.
 */
export const GRACE_MIN = 60;
const minOf = hhmm => int(str(hhmm).slice(0, 2)) * 60 + int(str(hhmm).slice(3, 5));

export function dayFor(course, date, { taken = 0, nowMin = null } = {}) {
  const due = dueOn(course, date);
  let left = Math.max(0, int(taken));
  const doses = due.map(d => {
    // Doses are marked taken in clock order, so two doses and one log reports
    // the MORNING one as taken and the evening one as still to come.
    if (left > 0) { left--; return { ...d, state: DOSE.TAKEN }; }
    if (nowMin == null) return { ...d, state: DOSE.MISSED };
    return { ...d, state: minOf(d.time) + GRACE_MIN > nowMin ? DOSE.PENDING : DOSE.MISSED };
  });
  return {
    date, doses,
    expected: due.length,
    // Capped at what was expected — failure 4. Extra logs are surfaced, not
    // scored: taking it twice is a thing to notice, not credit for.
    taken: Math.min(int(taken), due.length),
    extra: Math.max(0, int(taken) - due.length),
    pending: doses.filter(d => d.state === DOSE.PENDING).length,
    missed: doses.filter(d => d.state === DOSE.MISSED).length,
  };
}

/** Every date from `from` to `to`, inclusive. */
export function datesBetween(from, to) {
  if (!validDate(from) || !validDate(to) || from > to) return [];
  const out = [];
  const d = new Date(`${from}T00:00:00`);
  const end = Date.parse(`${to}T00:00:00`);
  while (d.getTime() <= end) {
    out.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
    d.setDate(d.getDate() + 1);
  }
  return out;
}

/** How many times this med was logged on a date, from the meds_log blob. */
export function takenOn(medLog, course, date) {
  const rows = Array.isArray(medLog?.[date]) ? medLog[date] : [];
  const name = norm(course?.name);
  if (!name) return 0;
  return rows.filter(r => norm(r?.name) === name || (str(r?.courseId) && r.courseId === course.id)).length;
}

/**
 * Adherence for one course over a window.
 *
 * Returns `pct: null` — never 100, never 0 — when nothing was ever expected.
 * A PRN course, or a window entirely before the course began, has no adherence
 * to report, and inventing a number for it is exactly failure 1.
 */
export function adherence(course, medLog, { from, to, today, nowMin = null } = {}) {
  const c = normaliseCourse(course || {});
  const stop = [to, today].filter(validDate).sort()[0] || to;   // never score the future
  const days = datesBetween(from, stop)
    .map(d => dayFor(c, d, { taken: takenOn(medLog, c, d), nowMin: d === today ? nowMin : null }));

  const expected = days.reduce((t, d) => t + d.expected, 0);
  const taken = days.reduce((t, d) => t + d.taken, 0);
  const pending = days.reduce((t, d) => t + d.pending, 0);
  const missed = days.reduce((t, d) => t + d.missed, 0);
  // Pending doses are out of the denominator too. Tonight's dose is not
  // evidence of anything yet, and letting it drag the number down all day is
  // the same lie as counting tomorrow.
  const scored = expected - pending;
  return {
    course: c, days, expected, taken, missed, pending,
    extra: days.reduce((t, d) => t + d.extra, 0),
    pct: scored > 0 ? Math.round((taken / scored) * 100) : null,
    missedDays: days.filter(d => d.missed > 0).map(d => d.date),
  };
}

/** What is still owed today, across every active course — the Body tab's list. */
export function dueToday(courses, medLog, today, nowMin) {
  const out = [];
  for (const raw of Array.isArray(courses) ? courses : []) {
    const c = normaliseCourse(raw);
    if (isPrn(c) || !isActive(c, today)) continue;
    const d = dayFor(c, today, { taken: takenOn(medLog, c, today), nowMin });
    for (const dose of d.doses) out.push({ ...dose, course: c, state: dose.state });
  }
  return out.sort((a, b) => a.time.localeCompare(b.time));
}

/**
 * A course that is nearly over, or has quietly run past its end date.
 *
 * The second one is the useful warning and the one no app gives you: a course
 * whose end date passed while doses are still being logged means either the
 * dates are wrong or it is being taken longer than prescribed, and both are
 * worth seeing.
 */
export function courseFlags(course, medLog, today) {
  const c = normaliseCourse(course || {});
  const end = lastDay(c);
  const flags = [];
  if (!c.from) flags.push({ kind: 'nostart', text: 'no start date, so nothing can be expected of it' });
  if (end && end >= today && dayDiff(today, end) <= 2 && isActive(c, today)) {
    flags.push({ kind: 'ending', text: dayDiff(today, end) === 0 ? 'last day' : `${dayDiff(today, end)} day(s) left` });
  }
  if (end && end < today && takenOn(medLog, c, today) > 0) {
    flags.push({ kind: 'overrun', text: `logged today, but this course ended ${end}` });
  }
  return flags;
}
