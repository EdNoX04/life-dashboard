// Adherence, and the four ways every implementation of it is quietly wrong.
//
// This number exists to answer "did I finish the antibiotics". It is only worth
// having if it is right on a Tuesday afternoon as well as at midnight — and the
// failures below are all ones that leave it looking plausible while being wrong
// in the direction that matters.

import {
  normaliseCourse, dueOn, dayFor, adherence, dueToday, takenOn,
  datesBetween, courseFlags, isActive, isPrn, lastDay, GRACE_MIN, DOSE_STATE,
} from '../src/lib/meds.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log('FAIL ' + n); } };
const eq = (a, b, n) => ok(Object.is(a, b), `${n} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

// A five-day course of antibiotics, morning and night.
const AZ = { id: 'az', name: 'Azithral 500', dose: '1', unit: 'tablet',
             schedule: { kind: 'times', times: ['09:00', '21:00'] }, from: '2026-09-10', to: '2026-09-14' };
const log = obj => obj;
const logOf = (date, n, name = 'Azithral 500') =>
  ({ [date]: Array.from({ length: n }, (_, i) => ({ id: i, name })) });

// -------------------------------------------------------------- the schedule
{
  eq(dueOn(AZ, '2026-09-10').length, 2, 'two doses a day while the course runs');
  eq(dueOn(AZ, '2026-09-09').length, 0, 'nothing before it starts');
  eq(dueOn(AZ, '2026-09-15').length, 0, 'and nothing after it ends');
  eq(dueOn(AZ, 'whenever').length, 0, 'a date that is not a date expects nothing rather than throwing');

  const alt = { ...AZ, schedule: { kind: 'everyN', times: ['09:00'], n: 2 }, to: '2026-09-20' };
  eq(dueOn(alt, '2026-09-10').length, 1, 'every-2-days counts from the start date');
  eq(dueOn(alt, '2026-09-11').length, 0, 'so the day between expects nothing');
  eq(dueOn(alt, '2026-09-12').length, 1, 'and the one after expects a dose again');

  const stopped = { ...AZ, stopped: '2026-09-11' };
  eq(dueOn(stopped, '2026-09-12').length, 0, 'coming off a course early stops it expecting doses');
  eq(lastDay(stopped), '2026-09-11', 'and the record still says when it ran to');
  eq(datesBetween('2026-09-10', '2026-09-12').length, 3, 'date ranges are inclusive at both ends');
}

// ------------------------------------------- 1. as-needed expects NOTHING
{
  const prn = { id: 'p', name: 'Dolo 650', schedule: { kind: 'prn' }, from: '2026-09-01' };
  ok(isPrn(prn), 'a painkiller taken when it hurts is as-needed');
  eq(dueOn(prn, '2026-09-12').length, 0, 'so it never expects a dose');
  const a = adherence(prn, logOf('2026-09-12', 1, 'Dolo 650'), { from: '2026-09-01', to: '2026-09-12', today: '2026-09-12' });
  eq(a.pct, null, 'and has NO adherence figure — not 0%, which would read as a failure, and not 100%');
  eq(a.missed, 0, 'nothing about it can ever be missed');

  const dueList = dueToday([prn, AZ], {}, '2026-09-12', 600);
  ok(!dueList.some(d => d.course.id === 'p'), 'and it never appears on the list of what is owed today');
}

// ------------------------------------------- 2. the future is not missed
{
  const a = adherence(AZ, logOf('2026-09-10', 2), { from: '2026-09-10', to: '2026-09-14', today: '2026-09-10', nowMin: 23 * 60 });
  eq(a.expected, 2, 'on day one of a five-day course, only day one has been asked of you');
  eq(a.taken, 2, 'both taken');
  eq(a.pct, 100, 'which is 100%, not 20% — the remaining four days have not happened yet');
  eq(a.missed, 0, 'and nothing is missed');
}

// ------------------------------------------- 3. tonight is pending, not missed
{
  const morning = dayFor(AZ, '2026-09-12', { taken: 1, nowMin: 10 * 60 });   // 10:00
  eq(morning.taken, 1, 'the 09:00 dose is taken');
  eq(morning.pending, 1, 'and the 21:00 one is PENDING at ten in the morning');
  eq(morning.missed, 0, 'not missed');
  eq(morning.doses[1].state, DOSE_STATE.PENDING, 'by name');

  const night = dayFor(AZ, '2026-09-12', { taken: 1, nowMin: 23 * 60 });
  eq(night.missed, 1, 'by eleven at night it is missed');

  const grace = dayFor(AZ, '2026-09-12', { taken: 0, nowMin: 9 * 60 + GRACE_MIN - 1 });
  eq(grace.missed, 0, 'a dose is not missed the second the clock passes it — there is an hour of grace');

  const yesterday = dayFor(AZ, '2026-09-11', { taken: 0, nowMin: null });
  eq(yesterday.missed, 2, 'but a past day has no pending doses, only taken and missed');

  // The percentage must not be dragged down all day by a dose still to come.
  const a = adherence(AZ, logOf('2026-09-12', 1), { from: '2026-09-12', to: '2026-09-14', today: '2026-09-12', nowMin: 10 * 60 });
  eq(a.pending, 1, 'tonight is pending');
  eq(a.pct, 100, 'so the morning reads 100%, not 50% — pending is out of the denominator, not counted against you');
}

// ------------------------------------------- 4. taking it twice is not 200%
{
  const d = dayFor(AZ, '2026-09-11', { taken: 4 });
  eq(d.taken, 2, 'four logs against two scheduled doses is two doses taken');
  eq(d.extra, 2, 'and two extra, surfaced rather than scored');
  const a = adherence(AZ, logOf('2026-09-11', 4), { from: '2026-09-11', to: '2026-09-11', today: '2026-09-12' });
  eq(a.pct, 100, 'adherence caps at 100');
  eq(a.extra, 2, 'with the doubles still visible — it is a thing to notice, not credit');
}

// ---------------------------------------------------------------- matching
{
  eq(takenOn(logOf('2026-09-12', 1), AZ, '2026-09-12'), 1, 'a log matches its course by name');
  eq(takenOn(logOf('2026-09-12', 1, 'azithral 500'), AZ, '2026-09-12'), 1, 'case and spacing are not a difference');
  eq(takenOn(logOf('2026-09-12', 1, 'Dolo 650'), AZ, '2026-09-12'), 0, 'a different medicine is a different medicine');
  eq(takenOn({ '2026-09-12': [{ courseId: 'az', name: 'renamed later' }] }, AZ, '2026-09-12'), 1,
     'and a log tied to the course id survives the medicine being renamed');
  eq(takenOn(null, AZ, '2026-09-12'), 0, 'no log at all is zero, not a throw');
}

// ---------------------------------------------------------------- what is owed
{
  const list = dueToday([AZ], logOf('2026-09-12', 1), '2026-09-12', 10 * 60);
  eq(list.length, 2, 'both of the day’s doses are listed');
  eq(list[0].state, DOSE_STATE.TAKEN, 'the morning one taken');
  eq(list[1].state, DOSE_STATE.PENDING, 'the evening one still to come');
  eq(dueToday([{ ...AZ, from: '2026-09-20' }], {}, '2026-09-12', 600).length, 0,
     'a course that has not started is not on today’s list');
  eq(dueToday(null, null, '2026-09-12', 600).length, 0, 'and rubbish in gives an empty list');
}

// ------------------------------------------------------------------- flags
{
  eq(courseFlags(AZ, {}, '2026-09-14')[0].text, 'last day', 'the last day of a course is called out');
  ok(courseFlags(AZ, {}, '2026-09-13').some(f => f.kind === 'ending'), 'as is the day before');
  ok(!courseFlags(AZ, {}, '2026-09-11').length, 'but not the whole way through — that would be noise');

  const over = courseFlags(AZ, logOf('2026-09-20', 1), '2026-09-20');
  ok(over.some(f => f.kind === 'overrun'),
     'STILL LOGGING after the end date is flagged — either the dates are wrong or it is being taken too long, and both matter');

  ok(courseFlags({ name: 'x' }, {}, '2026-09-12').some(f => f.kind === 'nostart'),
     'and a course with no start date says so, rather than silently expecting nothing forever');
}

// ---------------------------------------------------------------- normalise
{
  const c = normaliseCourse({ name: 'X', schedule: { kind: 'times', times: [] } });
  eq(c.schedule.times.length, 1, 'a scheduled course with no times gets one, rather than expecting nothing while claiming to be scheduled');
  eq(normaliseCourse({ unit: 'sploogs' }).unit, 'tablet', 'an unknown unit falls back rather than being stored');
  eq(normaliseCourse({ from: 'soon' }).from, null, 'and a date that is not a date is null, never today');
  ok(!isActive(normaliseCourse({ name: 'x' }), '2026-09-12'), 'a course with no start date is not active');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
