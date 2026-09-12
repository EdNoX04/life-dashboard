// Routines — the grooming and upkeep half of the Body tab.
//
// "Every morning", "twice a week", "the first of the month" is the same shape
// as a prescription, and lib/meds.js already gets that shape right: what is due
// today, what is still PENDING versus actually missed, an hour of grace, no
// credit for doing it twice, and no adherence figure at all for something
// as-needed. Writing a second scheduler here would mean getting all of that
// wrong again, differently — so this file borrows the engine and adds only what
// is different about a routine.
//
// WHAT IS DIFFERENT
//
//   * A routine has no end date. A course of antibiotics finishes; moisturiser
//     does not. `to` stays null and `courseFlags`' "ending" warning never fires.
//   * It has a PRODUCT, which runs out. That is the one genuinely new thing,
//     and it is the thing people actually forget.
//   * Missing it is not a medical event. The wording is flatter throughout, and
//     nothing here keeps a streak.
//
// THE LINE THIS FILE DOES NOT CROSS
//
// This is about ROUTINE AND UPKEEP, never about appearance as a verdict. No
// before-and-after scoring of a face, no "improvement" percentage on how
// someone looks, nothing that turns a mirror into a scoreboard. The nutrition
// work drew this line for food; it is easier to cross here and matters more.
// A test greps the whole surface for the vocabulary.

import {
  normaliseCourse, dueOn, dayFor, dueToday, adherence, takenOn, isPrn,
  DOSE_STATE, GRACE_MIN,
} from './meds.js';

const str = v => String(v ?? '').trim();
const amt = v => {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const isDate = d => /^\d{4}-\d{2}-\d{2}$/.test(str(d)) && !Number.isNaN(Date.parse(str(d)));

/**
 * What a routine is for. Deliberately plain nouns — "skin", "hair", "teeth" —
 * rather than aspirational ones. A category called "glow-up" would set the tone
 * for everything rendered under it.
 */
export const AREAS = [
  { key: 'skin', label: 'Skin', color: 'var(--cyan)' },
  { key: 'hair', label: 'Hair', color: 'var(--purple)' },
  { key: 'teeth', label: 'Teeth', color: 'var(--green)' },
  { key: 'body', label: 'Body', color: 'var(--yellow)' },
  { key: 'nails', label: 'Nails', color: 'var(--pink)' },
  { key: 'other', label: 'Other', color: 'var(--ink-3)' },
];
export const areaOf = k => AREAS.find(a => a.key === k) || AREAS[AREAS.length - 1];

// Re-exported so a caller never has to import both files to read one screen,
// and so the grooming UI physically cannot end up on a different clock.
export { DOSE_STATE, GRACE_MIN };

/**
 * A routine, expressed as a course meds.js already understands.
 *
 * `to: null` always: a routine does not finish. Everything else maps straight
 * across, which is the whole point — `dueOn`, `dayFor` and `dueToday` then work
 * unchanged and stay tested in one place.
 */
export function normaliseRoutine(r = {}) {
  const area = AREAS.some(a => a.key === r.area) ? r.area : 'other';
  const course = normaliseCourse({
    id: str(r.id) || `r${Date.now()}${Math.random().toString(36).slice(2, 8)}`,
    name: str(r.name).slice(0, 80),
    salt: str(r.product).slice(0, 80),     // the product is the "what", as salt is for a med
    dose: str(r.dose).slice(0, 40) || '1',
    unit: 'unit',
    schedule: r.schedule,
    from: r.from,
    to: null,
    stopped: r.stopped,
    reason: str(r.reason).slice(0, 120),
    note: str(r.note).slice(0, 300),
  });
  return {
    ...course,
    area,
    product: str(r.product).slice(0, 80),
    // When the bottle was opened and how long it lasts. Both optional; with
    // neither, nothing is claimed about running out.
    openedAt: isDate(r.openedAt) ? str(r.openedAt) : null,
    lastsDays: amt(r.lastsDays),
  };
}

export const routineCourse = normaliseRoutine;   // it IS a course; the name is for readers

/** What is due today across every routine — straight through the meds engine. */
export const dueRoutines = (routines, log, today, nowMin) =>
  dueToday((Array.isArray(routines) ? routines : []).map(normaliseRoutine), log, today, nowMin);

/** One routine's day: taken / pending / missed, with the same hour of grace. */
export const routineDay = (routine, log, today, nowMin) =>
  dayFor(normaliseRoutine(routine), today, { taken: takenOn(log, normaliseRoutine(routine), today), nowMin });

/**
 * How often it actually happened, over a window.
 *
 * Same maths as medication adherence and the same refusals — an as-needed
 * routine has NO figure rather than 0%, and today's pending step is out of the
 * denominator. The word is "kept", not "adherence": this is a habit, not a
 * prescription, and the vocabulary should not borrow the weight.
 */
export function kept(routine, log, window = {}) {
  const a = adherence(normaliseRoutine(routine), log, window);
  return { ...a, kept: a.pct };
}

// ------------------------------------------------------------- the product

export const RUNNING_LOW_DAYS = 7;

/**
 * When the product runs out, and whether that is soon.
 *
 * The thing people actually forget is not the routine, it is that the bottle is
 * nearly empty — so this is the one piece of machinery here that does not come
 * from meds.js. Returns null rather than guessing: a shelf life invented by the
 * app would put a date on something nobody decided, and he would plan around it.
 */
export function runsOut(routine, today = null) {
  const r = normaliseRoutine(routine);
  if (!r.openedAt || !r.lastsDays) return null;
  const d = new Date(`${r.openedAt}T00:00:00`);
  d.setDate(d.getDate() + r.lastsDays);
  const z = n => String(n).padStart(2, '0');
  const on = `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
  if (!isDate(today)) return { on, daysLeft: null, low: null, out: null };
  const daysLeft = Math.round((Date.parse(`${on}T00:00:00`) - Date.parse(`${today}T00:00:00`)) / 86400000);
  return { on, daysLeft, low: daysLeft <= RUNNING_LOW_DAYS && daysLeft >= 0, out: daysLeft < 0 };
}

/** Every product that needs replacing soon, or already did. */
export function shoppingList(routines, today) {
  return (Array.isArray(routines) ? routines : [])
    .map(normaliseRoutine)
    .map(r => ({ routine: r, runs: runsOut(r, today) }))
    .filter(x => x.runs && (x.runs.low || x.runs.out))
    .sort((a, b) => (a.runs.daysLeft ?? 0) - (b.runs.daysLeft ?? 0));
}

// ------------------------------------------------------------------ grouping

/** Routines by area, for the screen. Areas with nothing in them are dropped. */
export function byArea(routines, today) {
  const m = new Map();
  for (const raw of Array.isArray(routines) ? routines : []) {
    const r = normaliseRoutine(raw);
    if (r.stopped && (!today || r.stopped <= today)) continue;
    if (!m.has(r.area)) m.set(r.area, []);
    m.get(r.area).push(r);
  }
  return AREAS.filter(a => m.has(a.key)).map(a => ({ ...a, routines: m.get(a.key) }));
}

/**
 * One line for the Body tab.
 *
 * Counts, and nothing else. Not a percentage, not a streak, not an adjective —
 * "3 of 5 done" is a fact about a morning; "60%" invites a target, and a target
 * invites a streak.
 */
export function summary(routines, log, today, nowMin) {
  const due = dueRoutines(routines, log, today, nowMin);
  if (!due.length) return { due: 0, done: 0, text: 'Nothing scheduled today.' };
  const done = due.filter(d => d.state === DOSE_STATE.TAKEN).length;
  const pending = due.filter(d => d.state === DOSE_STATE.PENDING).length;
  return {
    due: due.length, done, pending,
    text: `${done} of ${due.length} done${pending ? `, ${pending} still to come` : ''}`,
  };
}
