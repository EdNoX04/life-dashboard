// Tasks with a time and a length.
//
// The tab had the TickTick shape already — smart lists, folders, priorities,
// three view modes. What it had no concept of was WHEN, so every task was a
// thing due some day, and a day is not a plan.
//
// Most of these tests are about the difference between a commitment and a wish.
// A planner earns its keep by refusing to blur them, and every shortcut
// available here blurs them in the same direction: toward a day that looks
// organised.

import {
  normaliseTask, minutesOf, hhmmOf, fmtTime, fmtDuration,
  isScheduled, isEstimated, startMin, endMin, isOverdue, DEFAULT_BLOCK_MIN,
  subtaskProgress, addSubtask, toggleSubtask, removeSubtask,
  nextDue, completeTask, validRepeat, everyN,
  smartView, sortTasks, overlaps, layoutDay, scheduleAt,
  estimateStats, dayLoad, addDays, dowOf, priorityOf,
} from '../src/lib/todos.js';

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; } else { fail++; console.log('FAIL ' + name); } };
const eq = (a, b, name) => ok(a === b, `${name} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
const near = (a, b, name, tol = 0.01) => ok(a != null && Math.abs(a - b) < tol, `${name} (got ${a}, want ${b})`);

const T = rows => rows.map(normaliseTask);

// -------------------------------------------------------------------- time

eq(minutesOf('09:30'), 570, 'a time parses to minutes past midnight');
eq(minutesOf('00:00'), 0, 'midnight is zero, which is a real time');
eq(minutesOf('23:59'), 1439, 'and the last minute of the day parses');
eq(minutesOf('24:00'), null, 'an hour that does not exist is not a time');
eq(minutesOf('09:60'), null, 'and neither is a sixtieth minute');
eq(minutesOf(''), null, 'an empty string is not a time');
eq(minutesOf(null), null, 'and nor is nothing at all');
eq(hhmmOf(570), '09:30', 'minutes come back as a time');
eq(hhmmOf(null), null, 'and nothing comes back as nothing, not as 00:00');
eq(fmtTime('13:05'), '1:05 pm', 'display is twelve-hour');
eq(fmtTime('00:30'), '12:30 am', 'and midnight-thirty is am, not 0:30');
eq(fmtTime(null), '', 'no time displays as nothing');
eq(fmtDuration(90), '1h 30m', 'durations read as hours and minutes');
eq(fmtDuration(60), '1h', 'a round hour drops the minutes');
eq(fmtDuration(45), '45m', 'and under an hour is just minutes');
// A task with no length is not a task that takes no time.
eq(fmtDuration(0), '', 'zero minutes displays as nothing');
eq(fmtDuration(null), '', 'and so does no estimate at all');

// ------------------------------------------- a duration is not a time

const est = normaliseTask({ title: 'Read', due_date: '2026-08-16', duration_min: 45 });
const sched = normaliseTask({ title: 'Call', due_date: '2026-08-16', due_time: '09:00', duration_min: 30 });

eq(isScheduled(sched), true, 'a date and a time is scheduled');
eq(isScheduled(est), false, 'a date alone is a deadline, not a schedule');
eq(isEstimated(est), true, 'a length with no start is estimated');
eq(isEstimated(sched), false, 'once it has a start it is no longer merely estimated');
eq(est.due_time, null, 'and its time stays null');
eq(normaliseTask({ due_time: '' }).due_time, null, 'an empty time never becomes midnight');
eq(normaliseTask({ due_time: 'soon' }).due_time, null, 'and neither does an unparseable one');

// A scheduled task with no length still has to be drawable, and the default is
// stated rather than silently assumed.
eq(endMin(normaliseTask({ due_time: '09:00' })), 540 + DEFAULT_BLOCK_MIN,
  'a timed task with no length occupies the stated default block');
eq(endMin(est), null, 'an unscheduled task has no end, rather than an end at midnight');
eq(startMin(est), null, 'and no start');

// ---------------------------------------------------------------- overdue

const OD = normaliseTask({ title: 'Late', due_date: '2026-08-10' });
eq(isOverdue(OD, '2026-08-16'), true, 'a task due last week is overdue today');
eq(isOverdue(OD, '2026-08-09'), false, 'and was not overdue before it was due');
eq(isOverdue({ ...OD, completed: true }, '2026-08-16'), false, 'a finished task is never overdue');
eq(isOverdue(normaliseTask({ title: 'x' }), '2026-08-16'), false, 'a task with no date cannot be late');
// Decision 6: it is a comparison against a date passed in, never a stored flag.
eq(isOverdue(OD, null), false, 'with no reference date there is no verdict');

// ------------------------------------------------------------- subtasks

{
  let t = normaliseTask({ title: 'Ship it' });
  eq(subtaskProgress(t).pct, null, 'no checklist means no progress figure — null, not 0%');
  t = addSubtask(t, 'Write it');
  t = addSubtask(t, 'Test it');
  t = addSubtask(t, '   ');
  eq(t.subtasks.length, 2, 'a blank subtask is not added');
  eq(subtaskProgress(t).total, 2, 'two subtasks');
  eq(subtaskProgress(t).done, 0, 'none done');
  t = toggleSubtask(t, t.subtasks[0].id);
  eq(subtaskProgress(t).done, 1, 'ticking one counts');
  near(subtaskProgress(t).pct, 50, 'and the progress is half');
  t = toggleSubtask(t, t.subtasks[1].id);
  eq(subtaskProgress(t).all, true, 'every subtask can be done');
  // Decision 7: evidence, not a decision.
  eq(t.completed, false, 'and the parent is STILL not completed — that is your call, not the checklist’s');
  t = removeSubtask(t, t.subtasks[0].id);
  eq(t.subtasks.length, 1, 'a subtask can be removed');
}

// -------------------------------------------------------------- repeats

eq(validRepeat('daily'), true, 'daily is a rule');
eq(validRepeat('every:3'), true, 'and so is every third day');
eq(everyN('every:3'), 3, 'which parses its interval');
eq(validRepeat('every:0'), false, 'but every zero days is not a repeat');
eq(validRepeat('sometimes'), false, 'and nor is a word');
eq(normaliseTask({ repeat_rule: 'sometimes' }).repeat_rule, null, 'an invalid rule is dropped on the way in');

eq(nextDue({ repeat_rule: 'daily' }, '2026-08-16'), '2026-08-17', 'daily advances a day');
eq(nextDue({ repeat_rule: 'weekly' }, '2026-08-16'), '2026-08-23', 'weekly advances seven');
eq(nextDue({ repeat_rule: 'every:3' }, '2026-08-16'), '2026-08-19', 'every-three advances three');
// 2026-08-14 is a Friday; weekdays must skip the weekend.
eq(dowOf('2026-08-14'), 5, 'the 14th is a Friday');
eq(nextDue({ repeat_rule: 'weekdays' }, '2026-08-14'), '2026-08-17', 'weekdays skips Saturday and Sunday');
eq(dowOf(nextDue({ repeat_rule: 'weekdays' }, '2026-08-14')), 1, 'landing on a Monday');
// The 31st of a 30-day month is the trap every naive implementation falls into.
eq(nextDue({ repeat_rule: 'monthly' }, '2026-01-31'), '2026-02-28',
  'monthly from the 31st clamps to the end of a short month rather than skipping it');
eq(nextDue({ repeat_rule: 'monthly' }, '2026-08-31'), '2026-09-30', 'and to the 30th of a 30-day month');
eq(nextDue({ repeat_rule: 'daily', repeat_until: '2026-08-16' }, '2026-08-16'), null,
  'a repeat stops at its end date');
eq(nextDue({}, '2026-08-16'), null, 'a one-off never generates a next occurrence');

// Decision 3: completing never moves the original forward.
{
  const run = normaliseTask({ id: 'r1', title: 'Run', due_date: '2026-08-14', due_time: '06:30', duration_min: 40, repeat_rule: 'weekdays', subtasks: [{ id: 's1', title: 'Stretch', done: true }] });
  const { updated, next } = completeTask(run, { at: new Date('2026-08-14T06:30:00Z'), actualMin: 45 });
  eq(updated.completed, true, 'the task is completed');
  eq(updated.due_date, '2026-08-14', 'ON THE DAY IT WAS DUE — the original never moves');
  eq(updated.actual_min, 45, 'with what it actually took recorded');
  eq(next.due_date, '2026-08-17', 'and the next occurrence is a NEW task');
  eq(next.completed, false, 'not yet done');
  eq(next.id, null, 'with no id, so it is inserted rather than overwriting anything');
  eq(next.repeat_from, 'r1', 'pointing back at where it came from');
  eq(next.due_time, '06:30', 'keeping the time');
  eq(next.actual_min, null, 'but not last time’s logged minutes');
  eq(next.subtasks[0].done, false, 'and its checklist comes back unticked');
  eq(run.completed, false, 'the input is not mutated');
}
eq(completeTask(normaliseTask({ title: 'once', due_date: '2026-08-16' })).next, null,
  'a one-off completes without spawning anything');

// ---------------------------------------------------------- smart views

const BOOK = T([
  { id: '1', title: 'Deep work', due_date: '2026-08-16', due_time: '09:00', duration_min: 120, priority: 3 },
  { id: '2', title: 'Standup', due_date: '2026-08-16', due_time: '10:00', duration_min: 30 },
  { id: '3', title: 'Gym', due_date: '2026-08-16', due_time: '18:00', duration_min: 60 },
  { id: '4', title: 'Read paper', due_date: '2026-08-16', duration_min: 45 },
  { id: '5', title: 'Late thing', due_date: '2026-08-10' },
  { id: '6', title: 'Someday', priority: 1 },
  { id: '7', title: 'Next week', due_date: '2026-08-20' },
  { id: '8', title: 'Finished', due_date: '2026-08-15', completed: true },
]);
const TODAY = '2026-08-16';

// Overdue work shows up under Today, because a task due yesterday is a thing
// you have to do today. Filing it elsewhere is how it stays undone.
ok(smartView(BOOK, 'today', { today: TODAY }).some(t => t.id === '5'),
  'Today includes what is already overdue');
eq(smartView(BOOK, 'today', { today: TODAY }).length, 5, 'four due today plus the late one');
eq(smartView(BOOK, 'overdue', { today: TODAY }).length, 1, 'Overdue counts them on their own too');
eq(smartView(BOOK, 'unscheduled', { today: TODAY }).length, 1, 'No-date holds the one with no date');
eq(smartView(BOOK, 'next7', { today: TODAY }).length, 5, 'the next seven days');
eq(smartView(BOOK, 'done', { today: TODAY }).length, 1, 'Completed holds the finished one');
ok(smartView(BOOK, 'all', { today: TODAY }).every(t => !t.completed), 'All means all OPEN');

// Sorting: timed first in clock order, then priority, then manual, then title.
{
  const s = sortTasks(smartView(BOOK, 'today', { today: TODAY }));
  eq(s[0].id, '1', 'the 9am task leads');
  eq(s[1].id, '2', 'then 10am');
  eq(s[2].id, '3', 'then 6pm');
  ok(s.slice(3).every(t => !t.due_time), 'and everything untimed follows');
}

// ------------------------------------------------------------ the day

{
  const day = layoutDay(BOOK, TODAY);
  eq(day.blocks.length, 3, 'three timed blocks');
  // Only what is due THAT DAY without a time. The overdue task from the 10th is
  // not drawn on the 16th's grid — the Today *view* gathers it up, but a day
  // layout is about the day, and back-dating work onto a calendar would put
  // things on a date they never had.
  eq(day.unscheduled.length, 1, 'the untimed work due that day is kept, not dropped');
  ok(day.unscheduled.some(t => t.id === '4'), 'namely the one with a real estimate');
  ok(!day.unscheduled.some(t => t.id === '5'), 'and last week’s overdue task is not moved onto today');

  // Decision 2: a double-booking is a fact, and it is named.
  eq(day.clashes.length, 1, 'the 9am two-hour block clashes with the 10am standup');
  eq(day.clashes[0].a.id, '1', 'naming the first');
  eq(day.clashes[0].b.id, '2', 'and the second');
  eq(day.blocks[0].columns, 2, 'clashing blocks are laid out side by side');
  eq(day.blocks[0].column, 0, 'first in its own column');
  eq(day.blocks[1].column, 1, 'second beside it');
  // A clash at 9am must not narrow the rest of the day.
  eq(day.blocks[2].columns, 1, 'the evening block still gets the full width');

  eq(day.plannedMin, 210, 'planned minutes are the timed ones');
  eq(day.unplacedMin, 45, 'and estimated-but-unplaced is counted SEPARATELY');
  ok(day.plannedMin !== day.plannedMin + day.unplacedMin,
    'because a commitment and a wish are different facts');
  eq(day.firstStart, 540, 'the day starts at nine');
  eq(day.lastEnd, 1140, 'and the last block ends at seven');
}

eq(layoutDay(BOOK, '2026-08-19').blocks.length, 0, 'an empty day lays out empty');
eq(layoutDay([], TODAY).clashes.length, 0, 'and no tasks means no clashes');
ok(!layoutDay(BOOK, '2026-08-15').blocks.some(b => b.task.completed),
  'completed work is not drawn on the calendar');

eq(overlaps(BOOK[0], BOOK[1]), true, 'two-hour 9am overlaps the 10am');
eq(overlaps(BOOK[1], BOOK[2]), false, 'the 10am and the 6pm do not');
eq(overlaps(BOOK[3], BOOK[0]), false, 'and an unscheduled task overlaps nothing');

// Drag to schedule.
{
  const moved = scheduleAt(BOOK[3], { date: TODAY, time: '14:00', duration: 45 });
  eq(isScheduled(moved), true, 'dropping a task on a slot schedules it');
  eq(moved.due_time, '14:00', 'at that time');
  eq(moved.duration_min, 45, 'keeping its estimate as its length');
  eq(BOOK[3].due_time, null, 'and the original is not mutated');
  eq(scheduleAt(BOOK[0], { date: TODAY, time: null }).due_time, null,
    'dragging it back off the grid unschedules it rather than leaving a stale time');
}

// --------------------------------------------------- estimate vs actual

{
  const none = estimateStats(BOOK);
  eq(none.n, 0, 'nothing has been both estimated and timed');
  eq(none.ratio, null, 'so there is no accuracy figure');
  ok(none.note, 'and it says so rather than showing 0%');

  const timed = T([
    { title: 'a', duration_min: 60, actual_min: 90 },
    { title: 'b', duration_min: 30, actual_min: 30 },
    { title: 'c', duration_min: 120, actual_min: 150 },
    // Decision 4: estimated but never timed. Must not count as instant.
    { title: 'd', duration_min: 60 },
  ]);
  const s = estimateStats(timed);
  eq(s.n, 3, 'only the three with both figures count');
  eq(s.estimated, 210, 'estimated total is of those three');
  eq(s.actual, 270, 'and so is the actual');
  near(s.ratio, 270 / 210, 'the ratio is of the totals, so long tasks weigh more');
  near(s.medianRatio, 1.25, 'with the median beside it, so one runaway does not set the number');
  ok(s.ratio > 1, 'these estimates run short, which is the useful thing to know');
}

// ------------------------------------------------------------- day load

{
  const load = dayLoad(BOOK, TODAY, { capacityMin: 240 });
  eq(load.plannedMin, 210, 'planned against capacity');
  eq(load.unplacedMin, 45, 'plus what is estimated but unplaced');
  eq(load.totalMin, 255, 'which together exceed four hours');
  eq(load.over, true, 'so the day is over capacity');
  eq(load.clashes, 1, 'and it carries the clash count too');
  eq(dayLoad([], TODAY).over, false, 'an empty day is not over anything');
}

// ------------------------------------------------------------- hostile

for (const [name, rows] of [
  ['nulls', [null, undefined]],
  ['empty objects', [{}, {}]],
  ['NaN duration', [{ title: 'x', due_date: '2026-08-16', due_time: '09:00', duration_min: NaN }]],
  ['negative duration', [{ title: 'x', due_date: '2026-08-16', due_time: '09:00', duration_min: -60 }]],
  ['string duration', [{ title: 'x', due_date: '2026-08-16', due_time: '09:00', duration_min: 'ages' }]],
  ['bad date', [{ title: 'x', due_date: 'tomorrow', due_time: '09:00' }]],
  ['subtasks not an array', [{ title: 'x', subtasks: 'nope' }]],
]) {
  let threw = null;
  try {
    const list = rows.filter(Boolean).map(normaliseTask);
    layoutDay(list, '2026-08-16');
    smartView(list, 'today', { today: '2026-08-16' });
    sortTasks(list); estimateStats(list); dayLoad(list, '2026-08-16');
  } catch (e) { threw = e; }
  ok(threw == null, `the model survives ${name}${threw ? `: ${threw.message}` : ''}`);
}
eq(normaliseTask({ duration_min: -60 }).duration_min, null, 'a negative length is no length');
eq(normaliseTask({ duration_min: 'ages' }).duration_min, null, 'and neither is a word');
eq(normaliseTask({ due_date: 'tomorrow' }).due_date, null, 'an unparseable date is dropped');
eq(normaliseTask({ subtasks: 'nope' }).subtasks.length, 0, 'and a broken checklist becomes an empty one');
eq(normaliseTask({}).priority, 0, 'priority defaults to none');
eq(normaliseTask({ priority: 9 }).priority, 0, 'and an unknown priority is none, not nine');
eq(priorityOf(3).label, 'High', 'priorities have labels');
eq(priorityOf(99).label, 'None', 'and an unknown one falls back');
eq(addDays('2026-12-31', 1), '2027-01-01', 'dates cross a year boundary');
eq(addDays('2026-02-28', 1), '2026-03-01', 'and a non-leap February');

console.log(`${pass}/${pass + fail} passing`);
if (fail) process.exit(1);
