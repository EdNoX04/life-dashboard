// Timed tasks in the calendar export.
//
// The .ics export sent every open task as an all-day banner, which was right
// when nothing had a time. Now that tasks have a start and a length, exporting
// them all as all-day would flatten a booked afternoon into a row of banners at
// the top of the day — the same lie the app refuses to tell on its own screens,
// told to Apple Calendar instead.

import { buildICS } from '../src/lib/ics.js';

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; } else { fail++; console.log('FAIL ' + name); } };
const eq = (a, b, name) => ok(a === b, `${name} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const blockFor = (ics, title) => {
  const parts = ics.split('BEGIN:VEVENT').filter(p => p.includes(title));
  return parts[0] || '';
};

const TODOS = [
  { id: '1', title: 'Deep work', due_date: '2026-08-16', due_time: '09:00', duration_min: 120 },
  { id: '2', title: 'Buy milk', due_date: '2026-08-16' },
  { id: '3', title: 'Late night', due_date: '2026-08-16', due_time: '23:30', duration_min: 60 },
  { id: '4', title: 'No length', due_date: '2026-08-16', due_time: '14:00' },
  { id: '5', title: 'Already done', due_date: '2026-08-16', due_time: '08:00', completed: true },
  { id: '6', title: 'No date at all' },
];
const ics = buildICS({ timetable: [], events: [], todos: TODOS });

// A task with a time becomes a real event of its real length.
const deep = blockFor(ics, 'Deep work');
ok(/DTSTART:20260816T090000/.test(deep), 'a timed task starts at its time, not as an all-day banner');
ok(/DTEND:20260816T110000/.test(deep), 'and ends two hours later, which is its actual length');
ok(!/VALUE=DATE/.test(deep), 'so it carries no all-day marker');

// A task with only a date stays a deadline. It is owed by the end of the day,
// not happening at midnight.
const milk = blockFor(ics, 'Buy milk');
ok(/DTSTART;VALUE=DATE:20260816/.test(milk), 'a dateless-time task stays an all-day reminder');
// Checked on the DTSTART line specifically — DTSTAMP legitimately carries a
// clock time (it is when the file was written), and testing the whole block
// would have caught that instead of the thing being asserted.
ok(!/DTSTART[^\n]*T\d{6}/.test(milk), 'with no clock time invented for it');

// Past midnight has to roll into the next day. An end before its start is a
// thing several calendars silently drop, which would look like the export
// losing the task.
const late = blockFor(ics, 'Late night');
ok(/DTSTART:20260816T233000/.test(late), 'a late task starts on its own day');
ok(/DTEND:20260817T003000/.test(late), 'and ends on the NEXT day rather than before it began');

// The stated default block, so a timed task with no length is still visible.
const nolen = blockFor(ics, 'No length');
ok(/DTSTART:20260816T140000/.test(nolen), 'a timed task with no length still starts on time');
ok(/DTEND:20260816T143000/.test(nolen), 'and gets the stated default block rather than zero height');

// Completed work is not exported as something still to do.
eq(/Already done/.test(ics), false, 'a completed task is not exported');
eq(/No date at all/.test(ics), false, 'and neither is one with no date to put it on');

// The file still parses as a calendar.
ok(ics.startsWith('BEGIN:VCALENDAR'), 'the export is still a calendar');
ok(ics.trim().endsWith('END:VCALENDAR'), 'and is closed properly');
eq(ics.split('BEGIN:VEVENT').length - 1, 4, 'four events: three timed tasks and one all-day');

// Notes ride along, since a task with a checklist is worth reading on a phone.
const withNotes = buildICS({ todos: [{ title: 'Has notes', due_date: '2026-08-16', notes: 'remember the thing' }] });
ok(/DESCRIPTION:remember the thing/.test(withNotes), 'notes are exported as the description');

// Hostile input must not produce a broken file — a calendar that fails to
// import gives no clue which row did it.
for (const [name, todos] of [
  ['nulls', [null, undefined]],
  ['empty', [{}]],
  ['bad time', [{ title: 'x', due_date: '2026-08-16', due_time: 'noon' }]],
  ['negative length', [{ title: 'x', due_date: '2026-08-16', due_time: '09:00', duration_min: -60 }]],
  ['huge length', [{ title: 'x', due_date: '2026-08-16', due_time: '09:00', duration_min: 5000 }]],
]) {
  let threw = null, out = '';
  try { out = buildICS({ todos: todos.filter(Boolean) }); } catch (e) { threw = e; }
  ok(threw == null, `the export survives ${name}${threw ? `: ${threw.message}` : ''}`);
  ok(out.startsWith('BEGIN:VCALENDAR') && out.trim().endsWith('END:VCALENDAR'), `${name} still yields a valid file`);
  ok(!/NaN|undefined/.test(out), `${name} puts no NaN or undefined in the file`);
}

console.log(`${pass}/${pass + fail} passing`);
if (fail) process.exit(1);
