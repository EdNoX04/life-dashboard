// One day, four sources, one answer.
//
// The value of this module is entirely in the rules it enforces, and each of
// them is here because getting it wrong is invisible until the morning it
// matters:
//
//   - fold the meeting against its own calendar event, and NOTHING else. Fold
//     too little and every meeting he books shows twice. Fold too much and a
//     real appointment silently disappears, which is far worse.
//   - a deadline is not a block. A task due "Thursday" cannot clash with a
//     Thursday class, and treating it as one manufactures a conflict a day.
//   - "next" means the thing you are in, if you are in one.

import {
  atOf, dayISO, agendaFor, foldAgenda, conflicts, nextUp, overlap,
  fromClasses, fromCalendar, fromMeetings, fromTodos, DEFAULT_MIN,
} from '../src/lib/agenda.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log('FAIL ' + n); } };
const eq = (a, b, n) => ok(Object.is(a, b), `${n} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const DATE = '2026-09-15';               // a Tuesday
const at = hhmm => atOf(DATE, hhmm);
const iso = hhmm => new Date(at(hhmm)).toISOString();

// ---------------------------------------------------------------- time basics
{
  eq(dayISO(at('23:30')), DATE, 'a late-evening instant belongs to the day it is in, not the UTC one');
  eq(atOf(DATE, '09:00') < atOf(DATE, '09:01'), true, 'times order');
  eq(atOf('', '09:00'), null, 'no date, no instant');
  eq(atOf(DATE, 'lunchtime'), null, 'and a time that is not a time is null rather than NaN');
  eq(atOf(DATE, '09:00:00'), atOf(DATE, '09:00'), 'seconds on a HH:MM field are tolerated');
}

// ---------------------------------------------------------------- the adapters
{
  const cls = fromClasses({
    iso: DATE, known: true, dropped: [],
    rows: [{ id: 'r1', subject: 'Compiler Design', code: 'CS402', start_time: '09:00',
             end_time: '09:55', room: 'B-204', change: 'room', usualRoom: 'B-101' }],
  });
  eq(cls.length, 1, 'a class becomes one item');
  eq(cls[0].meta.change, 'room', 'and a room change survives into the combined view');
  eq(cls[0].blocking, true, 'a class occupies real time');

  const ev = fromCalendar([{ id: 'personal:abc', summary: 'Dentist', start: iso('11:00'), end: iso('11:30'), gcalId: 'abc' }]);
  eq(ev[0].title, 'Dentist', 'an event keeps its summary as the title');

  const allDay = fromCalendar([{ id: 'x', summary: 'Holiday', start: DATE, end: DATE, allDay: true }]);
  eq(allDay[0].blocking, false, 'an all-day event blocks nothing');

  eq(fromCalendar([{ id: 'y', summary: 'no start' }]).length, 0, 'an event with no start is dropped, not kept as NaN');

  const td = fromTodos([{ id: 't1', title: 'Gym', due_date: DATE, due_time: '18:00', duration_min: 45 }]);
  eq(td[0].endAt - td[0].at, 45 * 60000, 'a todo with a length gets exactly that length');
  const noLen = fromTodos([{ id: 't2', title: 'Read', due_date: DATE, due_time: '20:00' }]);
  eq(noLen[0].endAt - noLen[0].at, DEFAULT_MIN * 60000, 'and one without gets the stated default, never zero');
}

// ---------------------------------------------------------------- deadline ≠ block
{
  const [d] = fromTodos([{ id: 't3', title: 'Submit the assignment', due_date: DATE }]);
  eq(d.allDay, true, 'a task with a date and no time is a deadline');
  eq(d.blocking, false, 'which cannot collide with anything');

  const day = agendaFor(DATE, {
    classes: { iso: DATE, rows: [{ id: 'c', subject: 'Maths', start_time: '09:00', end_time: '09:55' }] },
    todos: [{ id: 't3', title: 'Submit the assignment', due_date: DATE }],
  });
  eq(day.conflicts.length, 0, 'so a deadline on a class day is not a clash');
  eq(day.items[day.items.length - 1].source, 'todo', 'and an all-day row sorts last, below the timed ones');
}

// ---------------------------------------------------------------- the fold
{
  const both = agendaFor(DATE, {
    meetings: [{ id: 'm1', title: 'Standup', start: iso('10:00'), end: iso('10:30'), gcal_id: 'g9', meet: 'https://meet/x' }],
    events:   [{ id: 'work:g9', summary: 'Standup', start: iso('10:00'), end: iso('10:30'), gcalId: 'g9' }],
  });
  eq(both.items.length, 1, 'a meeting and the calendar event Google made for it are ONE row');
  eq(both.items[0].source, 'meeting', 'and the meeting wins, because it is the copy that has the join link');
  eq(both.items[0].url, 'https://meet/x', 'which is still there after the fold');
  eq(both.items[0].folded.length, 1, 'with the folded twin named rather than silently vanished');

  // The older rows, from before gcal_id was written back.
  const noId = agendaFor(DATE, {
    meetings: [{ id: 'm2', title: 'Review ', start: iso('14:00'), end: iso('14:30') }],
    events:   [{ id: 'e2', summary: 'review', start: iso('14:00'), end: iso('14:30') }],
  });
  eq(noId.items.length, 1, 'same instant and same title folds too — case and spacing are not a difference');

  // AND THE ONE THAT MATTERS MOST: folding too much deletes a real appointment.
  const near = agendaFor(DATE, {
    meetings: [{ id: 'm3', title: 'Standup', start: iso('10:00'), end: iso('10:15') }],
    events:   [{ id: 'e3', summary: 'Standup', start: iso('10:30'), end: iso('10:45') }],
  });
  eq(near.items.length, 2, 'two same-named things at DIFFERENT times are two things, never folded');

  const other = agendaFor(DATE, {
    meetings: [{ id: 'm4', title: 'Standup', start: iso('10:00'), end: iso('10:30') }],
    events:   [{ id: 'e4', summary: 'Dentist', start: iso('10:00'), end: iso('10:30') }],
  });
  eq(other.items.length, 2, 'and two different things at the same time are a CLASH, not a duplicate');
  eq(other.conflicts.length, 1, 'which is reported as one');

  const cls = foldAgenda([
    ...fromClasses({ iso: DATE, rows: [{ id: 'c1', subject: 'Standup', start_time: '10:00', end_time: '10:30' }] }),
    ...fromCalendar([{ id: 'e5', summary: 'Standup', start: iso('10:00'), end: iso('10:30') }]),
  ]);
  eq(cls.length, 2, 'a class is never folded into anything, whatever it is called');
}

// ---------------------------------------------------------------- conflicts
{
  const day = agendaFor(DATE, {
    classes: { iso: DATE, rows: [{ id: 'c', subject: 'Compiler Design', start_time: '09:00', end_time: '09:55' }] },
    todos: [{ id: 't', title: 'Gym', due_date: DATE, due_time: '09:30', duration_min: 60 }],
  });
  eq(day.conflicts.length, 1, 'a task scheduled on top of a class is the thing nothing used to notice');
  eq(day.conflicts[0][0].source, 'class', 'the pair is ordered by start');

  const touching = agendaFor(DATE, {
    classes: { iso: DATE, rows: [{ id: 'c', subject: 'A', start_time: '09:00', end_time: '10:00' }] },
    todos: [{ id: 't', title: 'B', due_date: DATE, due_time: '10:00', duration_min: 30 }],
  });
  eq(touching.conflicts.length, 0, 'back-to-back is not a clash — 10:00 to 10:00 is a handover, not an overlap');

  const done = agendaFor(DATE, {
    classes: { iso: DATE, rows: [{ id: 'c', subject: 'A', start_time: '09:00', end_time: '10:00' }] },
    todos: [{ id: 't', title: 'B', due_date: DATE, due_time: '09:15', completed: true }],
  });
  eq(done.conflicts.length, 0, 'and something already done cannot clash with what is still coming');

  ok(!overlap({ at: null, endAt: null }, { at: at('09:00'), endAt: at('10:00') }), 'a timeless row overlaps nothing');
}

// ---------------------------------------------------------------- ordering
{
  const day = agendaFor(DATE, {
    classes: { iso: DATE, rows: [{ id: 'c', subject: 'Maths', start_time: '09:00', end_time: '09:55' }] },
    meetings: [{ id: 'm', title: 'Call', start: iso('09:00'), end: iso('09:30') }],
  });
  eq(day.items[0].source, 'class', 'at the same minute a class is listed first — it is the one you cannot move');
  eq(JSON.stringify(agendaFor(DATE, {}).items), '[]', 'an empty day is an empty list, not a throw');

  const otherDay = agendaFor(DATE, { meetings: [{ id: 'm', title: 'x', start: new Date(at('09:00') + 86400000).toISOString() }] });
  eq(otherDay.items.length, 0, "and tomorrow's meeting is not on today's agenda");
}

// ---------------------------------------------------------------- what's next
{
  const { items } = agendaFor(DATE, {
    classes: { iso: DATE, rows: [{ id: 'c', subject: 'Maths', start_time: '09:00', end_time: '09:55' }] },
    meetings: [{ id: 'm', title: 'Call', start: iso('11:00'), end: iso('11:30') }],
    todos: [{ id: 't', title: 'Deadline', due_date: DATE }],
  });

  eq(nextUp(items, at('08:00')).title, 'Maths', 'before the day starts, the first class is next');
  eq(nextUp(items, at('08:00')).inMin, 60, 'with how long away it is');
  const now = nextUp(items, at('09:20'));
  eq(now.title, 'Maths', 'DURING the class, the class is the answer — not the meeting after it');
  eq(now.live, true, 'and it says so');
  eq(nextUp(items, at('10:30')).title, 'Call', 'once it has ended, the next thing takes over');
  eq(nextUp(items, at('23:00')), null, 'and at the end of the day there is nothing next, rather than a stale row');

  const ticked = agendaFor(DATE, { todos: [{ id: 't', title: 'Gym', due_date: DATE, due_time: '18:00', completed: true }] });
  eq(nextUp(ticked.items, at('17:00')), null, 'a finished task is never offered as what is next');
  eq(nextUp(null, Date.now()), null, 'and rubbish in gives null, not a crash');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
