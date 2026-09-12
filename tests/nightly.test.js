// The night summary, and the one rule it lives or dies by.
//
//   Zero is a fact. Unmeasured is not.
//
// The morning brief gets corrected by the day within hours. This does not — it
// becomes the record of what happened. So the tests that matter most here are
// not about formatting; they are about the difference between "you did nothing"
// and "nothing was measured", which is invisible on screen once it has been
// collapsed, and which collapses by default in every naive implementation.

import { nightly, headline, fmtMin, localDay } from '../src/lib/nightly.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log('FAIL ' + n); } };
const eq = (a, b, n) => ok(Object.is(a, b), `${n} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const D = '2026-09-12';
const at = (h, m = 0) => new Date(`${D}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`).toISOString();
const sec = (r, k) => r.sections.find(s => s.key === k);
const gap = (r, what) => r.notMeasured.find(g => g.what === what);
const text = r => r.sections.map(s => `${s.title}\n${s.body}`).join('\n');

// ------------------------------------------------- unmeasured is never zero
{
  const blank = nightly({ date: D });
  ok(!sec(blank, 'focus'), 'with no focus data there is NO focus section — not one reading "0m"');
  ok(gap(blank, 'focus time'), 'it is reported as not measured');
  ok(/migration 009/.test(gap(blank, 'focus time').why), 'naming the reason, so it is a thing to fix rather than a silence');
  ok(gap(blank, 'tasks'), 'an unreadable todo list is a gap, not an empty day');
  ok(!/\b0\b/.test(text(blank)), 'and nothing anywhere renders an unmeasured source as a zero');

  // The other half of the rule: measured-and-empty IS sayable.
  const quiet = nightly({ date: D, todos: [], focusSessions: [] });
  eq(sec(quiet, 'focus').minutes, 0, 'a day with the timer running and nothing in it is a real zero');
  eq(sec(quiet, 'focus').body, 'No focus blocks today.', 'and says so in words');
  eq(sec(quiet, 'done').body, 'Nothing was ticked off today.', 'same for tasks');
  ok(!gap(quiet, 'focus time'), 'neither of which is a gap');
}

// ------------------------------------------------------------------- tasks
{
  const r = nightly({ date: D, todos: [
    { id: 1, title: 'Ship agenda.js', completed: true, completed_at: at(14) },
    { id: 2, title: 'Yesterday thing', completed: true, completed_at: '2026-09-11T14:00:00' },
    { id: 3, title: 'Still open', due_date: D },
    { id: 4, title: 'Overdue', due_date: '2026-09-01' },
  ] });
  eq(sec(r, 'done').count, 1, "only today's completions count as today's work");
  ok(/Ship agenda/.test(sec(r, 'done').body), 'named');
  ok(/2 still open/.test(sec(r, 'done').body), 'and what is carried is stated');
  ok(/overdue/.test(sec(r, 'done').body), 'including that some of it is late');
  ok(!/should|behind|failed|only/i.test(sec(r, 'done').body), 'without a word of judgement about it');
}

// -------------------------------------------------------------------- food
{
  ok(gap(nightly({ date: D }), 'food'), 'an unreadable meal log is a gap, not a day of eating nothing');
  eq(sec(nightly({ date: D, meals: [] }), 'food').body, 'Nothing logged today.',
     'and a log that WAS read, with nothing in it, says so');

  const r = nightly({ date: D, meals: [{ kcal: 600, protein: 30 }, { kcal: 800, protein: 40 }], supps: [{ kcal: 120, protein: 24 }] });
  ok(/1520 kcal/.test(sec(r, 'food').body), 'meals and supplements are summed');
  ok(/94g protein/.test(sec(r, 'food').body), 'macros too');
  ok(!/reference/.test(sec(r, 'food').body),
     'with NO reference figure, because no body profile was given — a target from a default body is as much a lie as a zero for an unmeasured source');

  const withRef = nightly({ date: D, meals: [{ kcal: 1520, protein: 94 }],
    bodyProfile: { weightKg: 70, heightCm: 178, age: 21, sex: 'male', activity: 'moderate' } });
  ok(/reference for the day is 2655 kcal/.test(sec(withRef, 'food').body), 'with a profile, the reference is stated');

  const heavy = nightly({ date: D, meals: [{ kcal: 4200, protein: 40 }],
    bodyProfile: { weightKg: 70, heightCm: 178, age: 21, sex: 'male', activity: 'moderate' } });
  ok(!/(over|too much|should|bad|budget|exceeded|tomorrow you|cut back)/i.test(text(heavy)),
     'and a day well past the reference produces NO verdict — a nightly score on food does real harm');
}

// ------------------------------------------------------------------ habits
{
  const habits = [{ id: 'a', name: 'Read' }, { id: 'b', name: 'Gym' }];
  const r = nightly({ date: D, habits, habitLogs: [{ habit_id: 'a', date: D }] });
  eq(sec(r, 'habits').count, 1, 'habits logged today are counted');
  eq(sec(r, 'habits').of, 2, 'against how many there are');
  ok(!sec(nightly({ date: D, habits: [], habitLogs: [] }), 'habits'),
     'but an empty habit list gets no section — there is nothing to report on, and a 0/0 row is noise');
  ok(gap(nightly({ date: D, habits }), 'habits'), 'and logs that could not be read are a gap, not a zero streak');
}

// ------------------------------------------------------------------- focus
{
  const r = nightly({ date: D, focusSessions: [
    { mode: 'focus', label: 'Compiler Design', minutes: 25, ended_at: at(10) },
    { mode: 'focus', label: 'Compiler Design', minutes: 25, ended_at: at(11) },
    { mode: 'focus', label: 'DSA', minutes: 50, ended_at: at(16) },
    { mode: 'short', label: 'break', minutes: 5, ended_at: at(10, 30) },
    { mode: 'focus', label: 'Old', minutes: 90, ended_at: '2026-09-11T10:00:00' },
  ] });
  eq(sec(r, 'focus').minutes, 100, 'breaks are not focus, and yesterday is not today');
  eq(sec(r, 'focus').blocks, 3, 'blocks counted');
  ok(/Compiler Design — 50m/.test(sec(r, 'focus').body), 'time is grouped by what it was spent on');
  ok(/1h 40m/.test(sec(r, 'focus').body), 'and the total reads as hours once it is hours');
  eq(fmtMin(60), '1h', 'exactly an hour has no stray 0m');
}

// ------------------------------------------------- money says nothing about money
{
  const r = nightly({ date: D, snapshots: [
    { date: '2026-09-11', total_value: 100000 },
    { date: D, total_value: 102500 },
  ] });
  ok(/\+2,500/.test(sec(r, 'money').body), 'the change against the last snapshot is reported');
  ok(/2\.50%/.test(sec(r, 'money').body), 'in percent too');

  const words = text(r).toLowerCase();
  ok(!/\b(buy|sell|should|consider|opportunity|recommend|trim|add to|hold)\b/.test(words),
     'and NOTHING in the summary reads as advice — the same ban notify.js is held to');

  const shut = nightly({ date: D, snapshots: [{ date: '2026-09-10', total_value: 100000 }] });
  ok(/markets were shut/.test(sec(shut, 'money').body),
     'a stale snapshot says the market was closed rather than reporting a flat day that never happened');
  ok(!sec(nightly({ date: D, snapshots: [] }), 'money'), 'no snapshots at all is simply no section');
}

// ----------------------------------------------------------------- college
{
  const r = nightly({ date: D, dayView: { known: true, iso: D, dropped: [{}], rows: [
    { subject: 'Compiler Design', change: null }, { subject: 'IoT', change: 'extra' }, { subject: 'DSA', change: 'room' },
  ] } });
  ok(/3 classes scheduled/.test(sec(r, 'college').body), 'what was on is reported');
  ok(/1 extra: IoT/.test(sec(r, 'college').body), 'extras named');
  ok(/1 moved room/.test(sec(r, 'college').body), 'and room changes counted');
  ok(/nothing in the diary/.test(sec(r, 'college').body), 'and a usual slot the diary never mentioned is said out loud');
  ok(!/attend/i.test(text(r)), 'NOTHING claims he attended anything — this system cannot know that');

  const guess = nightly({ date: D, dayView: { known: false, iso: D, rows: [{ subject: 'X' }] } });
  ok(/the pattern, not the day/.test(sec(guess, 'college').body),
     'and when the diary had nothing, the summary says it is reporting the usual week');
}

// ---------------------------------------------------------------- tomorrow
{
  const r = nightly({ date: D, tomorrow: {
    items: [
      { at: new Date('2026-09-13T09:00:00').getTime(), title: 'Compiler Design', where: 'B-204', allDay: false },
      { at: new Date('2026-09-13T11:00:00').getTime(), title: 'Standup', allDay: false },
    ],
    conflicts: [[{ title: 'Compiler Design' }, { title: 'Gym' }]],
  } });
  ok(/First up 09:00 — Compiler Design \(B-204\)/.test(sec(r, 'tomorrow').body), 'tomorrow opens with the first thing and where');
  ok(/2 things on the day/.test(sec(r, 'tomorrow').body), 'and how much of it there is');
  ok(/⚠ Compiler Design × Gym/.test(sec(r, 'tomorrow').body), "a clash waiting tomorrow is worth knowing tonight, not at 8:55");
  eq(sec(nightly({ date: D, tomorrow: { items: [] } }), 'tomorrow').body, 'Nothing on the calendar.', 'an empty tomorrow is sayable');
}

// ------------------------------------------------------------- never padded
{
  const r = nightly({ date: D, todos: [], habits: [], habitLogs: [], builds: [], viewings: [], snapshots: [] });
  ok(r.sections.length <= 2, 'a day with genuinely nothing in it produces a short summary, not a full-length one padded with empty rows');
  ok(r.notMeasured.some(g => g.what === 'listening time'),
     'and listening time is named as never having had a source rather than silently omitted, which would read as complete');
}

// -------------------------------------------------------------- the headline
{
  const r = nightly({ date: D,
    todos: [{ id: 1, title: 'x', completed: true, completed_at: at(9) }],
    habits: [{ id: 'a', name: 'Read' }], habitLogs: [{ habit_id: 'a', date: D }],
    focusSessions: [{ mode: 'focus', label: 'DSA', minutes: 50, ended_at: at(16) }] });
  eq(headline(r), '1 task done · habits 1/1 · 50m focused', 'the one-line version is counts, not adjectives');
  eq(headline(nightly({ date: D })), 'A quiet day by the numbers.',
     'and with nothing measured it says so plainly instead of inventing a good day');
  eq(headline(null), 'A quiet day by the numbers.', 'rubbish in does not throw');
}

// ------------------------------------------------------------------- dates
{
  eq(localDay('2026-09-12T23:30:00'), '2026-09-12', 'a late entry belongs to the day it happened, not the UTC one');
  eq(localDay('nonsense'), null, 'and an unparseable timestamp is null rather than 1970');
  const r = nightly({ date: D, todos: [{ id: 1, title: 'x', completed: true, completed_at: 'nonsense' }] });
  eq(sec(r, 'done').count, 0, 'a completion with no readable time is not counted into today');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
