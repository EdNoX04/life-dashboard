// Focus history.
//
// The whole value of this feature is that the number is trustworthy — "you spent
// 6h 20m on Blockchain this week" is either true or it is worse than nothing. So
// what is tested here is arithmetic and honesty: breaks are not counted,
// abandoned blocks never arrive, local days are local, and a deleted task does
// not erase the record of having worked on it.
//
// Every function takes `now` as an argument, so none of this depends on when the
// suite runs.

import {
  cleanLabel, sessionRow, dayOf, todayKey, minutesOn, minutesSince,
  totalsByLabel, dailySeries, streak, fmtMinutes, ago, pickableTodos, MIN_LABEL,
} from '../src/lib/focus.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log('FAIL ' + n); } };
const eq = (a, b, n) => ok(Object.is(a, b), `${n} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

// A fixed "now" so the day arithmetic is deterministic. Local midday, so that
// nothing here accidentally passes because of a timezone edge.
const NOW = new Date(2026, 7, 31, 12, 0, 0);          // 31 Aug 2026, local
const dayAgo = n => new Date(NOW.getTime() - n * 86400000);
const row = (mins, daysAgo, label = 'Blockchain', extra = {}) => ({
  mode: 'focus', minutes: mins, label,
  ended_at: dayAgo(daysAgo).toISOString(), ...extra,
});

// ---------------------------------------------------------------- labels
eq(cleanLabel('  revise   module 2  '), 'revise module 2', 'whitespace is collapsed and trimmed');
eq(cleanLabel(''), MIN_LABEL, 'an empty label falls back');
eq(cleanLabel(null), MIN_LABEL, 'and so does null');
eq(cleanLabel('x'.repeat(500)).length, 120, 'a very long label is capped');
eq(cleanLabel('', 'Break'), 'Break', 'the fallback is caller-chosen');

// ---------------------------------------------------------------- building a row
{
  const end = new Date(2026, 7, 31, 10, 25, 0).getTime();
  const r = sessionRow({ label: 'Blockchain', minutes: 25, endedAt: end });
  eq(r.minutes, 25, 'minutes are recorded');
  eq(r.label, 'Blockchain', 'and the label');
  eq(r.todo_id, null, 'with no todo linked');
  eq(new Date(r.ended_at).getTime(), end, 'the end time is the block’s deadline');
  eq((end - new Date(r.started_at).getTime()) / 60000, 25, 'the start is derived backwards from it');
}
{
  // THE POINT OF STORING A COPY: the label survives the task being deleted.
  const r = sessionRow({ todo: { id: 'abc', title: 'Finish IoT lab record' }, minutes: 50 });
  eq(r.todo_id, 'abc', 'a linked todo is recorded by id');
  eq(r.label, 'Finish IoT lab record', 'and its title is copied, not just referenced');
}
{
  const r = sessionRow({ mode: 'short', minutes: 5 });
  eq(r.label, 'Break', 'an unnamed break is labelled as one');
  eq(r.mode, 'short', 'and keeps its mode');
}
eq(sessionRow({ minutes: 0 }).minutes, 1, 'a zero-length block is stored as one minute, never zero');
eq(sessionRow({ minutes: 24.6 }).minutes, 25, 'fractions are rounded');

// ---------------------------------------------------------------- days are LOCAL
{
  // 23:30 local on the 30th is still the 30th, even though it is the 31st in UTC
  // for anyone east of Greenwich. exams.js had to learn this the same way.
  const late = { mode: 'focus', minutes: 25, ended_at: new Date(2026, 7, 30, 23, 30).toISOString() };
  eq(dayOf(late), '2026-08-30', 'a late-evening session belongs to its LOCAL day');
  eq(todayKey(NOW), '2026-08-31', 'todayKey uses the local calendar');
  eq(dayOf({ ended_at: 'nonsense' }), '', 'an unparseable timestamp yields no day rather than NaN');
}

// ---------------------------------------------------------------- totals
{
  const rows = [
    row(25, 0), row(25, 0), row(50, 1, 'IoT'), row(25, 2), row(25, 8, 'Old'),
    { mode: 'short', minutes: 5, label: 'Break', ended_at: dayAgo(0).toISOString() },
  ];
  eq(minutesOn(rows, '2026-08-31'), 50, "today's total counts only today");
  // The break row above is 5 minutes on the same day. If breaks counted, this
  // would be 55 — so removing it must change nothing.
  eq(minutesOn(rows.filter(r => r.mode === 'focus'), '2026-08-31'), 50,
     'dropping the break row does not change the total, because breaks never counted');
  eq(minutesSince(rows, 7, NOW), 125, 'a 7-day window includes today and excludes the 8-day-old row');
  eq(minutesSince(rows, 30, NOW), 150, 'a wider window includes it');

  const t = totalsByLabel(rows);
  eq(t.length, 3, 'totals group by label');
  eq(t[0].label, 'Blockchain', 'the biggest total comes first');
  eq(t[0].minutes, 75, 'and sums its sessions');
  eq(t[0].sessions, 3, 'counting them');
  eq(t[1].label, 'IoT', 'then the next');
  ok(!t.some(x => x.label === 'Break'), 'breaks never appear in the per-task totals');
}

// ---------------------------------------------------------------- series
{
  const rows = [row(25, 0), row(50, 2)];
  const s = dailySeries(rows, 5, NOW);
  eq(s.length, 5, 'the series has one entry per day');
  eq(s[4].minutes, 25, 'the last entry is today');
  eq(s[2].minutes, 50, 'and two days back holds its total');
  eq(s[3].minutes, 0, 'a day with nothing is zero, not missing');
  eq(s[0].day < s[4].day, true, 'oldest first');
}

// ---------------------------------------------------------------- streak
eq(streak([], NOW), 0, 'no sessions is no streak');
eq(streak([row(25, 0)], NOW), 1, 'today alone is a streak of one');
eq(streak([row(25, 0), row(25, 1), row(25, 2)], NOW), 3, 'three consecutive days');
eq(streak([row(25, 0), row(25, 1), row(25, 3)], NOW), 2, 'a gap ends it');
// The forgiving part: before today's first session, yesterday still anchors the
// streak. A counter that reads zero every morning is a counter people stop
// looking at.
eq(streak([row(25, 1), row(25, 2)], NOW), 2, 'yesterday anchors the streak before today’s first block');
eq(streak([row(25, 2), row(25, 3)], NOW), 0, 'but a two-day gap does not');
eq(streak([{ mode: 'short', minutes: 5, ended_at: dayAgo(0).toISOString() }], NOW), 0,
   'a break alone does not keep a streak alive');

// ---------------------------------------------------------------- formatting
eq(fmtMinutes(0), '—', 'zero reads as a dash, not "0m"');
eq(fmtMinutes(45), '45m', 'under an hour');
eq(fmtMinutes(60), '1h', 'exactly an hour drops the minutes');
eq(fmtMinutes(85), '1h 25m', 'and above it shows both');
eq(fmtMinutes(-5), '—', 'negatives cannot happen but do not print');
eq(ago(dayAgo(0).toISOString(), NOW), 'today', 'today');
eq(ago(dayAgo(1).toISOString(), NOW), 'yesterday', 'yesterday');
eq(ago(dayAgo(3).toISOString(), NOW), '3 days ago', 'a few days');
ok(!/days ago/.test(ago(dayAgo(30).toISOString(), NOW)), 'and a date once it is far enough back');

// ---------------------------------------------------------------- the picker
{
  const todos = [
    { id: '1', title: 'Later', completed: false, due_date: '2026-09-10' },
    { id: '2', title: 'Done thing', completed: true, due_date: '2026-08-20' },
    { id: '3', title: 'Sooner', completed: false, due_date: '2026-09-01' },
    { id: '4', title: 'Undated', completed: false },
    { id: '5', completed: false },                       // no title at all
  ];
  const p = pickableTodos(todos);
  eq(p.length, 3, 'completed and untitled todos are not offered');
  eq(p[0].title, 'Sooner', 'soonest due first');
  eq(p[1].title, 'Later', 'then the later one');
  eq(p[2].title, 'Undated', 'and undated tasks come last');
  eq(pickableTodos(todos, 2).length, 2, 'the list is capped');
  eq(pickableTodos([]).length, 0, 'an empty list is fine');
  eq(pickableTodos(null).length, 0, 'and so is no list at all');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
