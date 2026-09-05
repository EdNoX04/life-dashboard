// What is actually on today.
//
// Neel's correction, and it is the one that matters: "sometimes extra classes
// are added and sometimes the room number is also changed."
//
// The weekly `timetable` table cannot carry either, by construction — it keeps
// only slots that recur on two or more distinct dates, which is exactly what
// stops makeups being welded into a permanent grid. So the grid is right about
// the pattern and silent about the day, and the day is what you turn up to.
//
// The diary knows. Nothing was reading it. These tests are about the difference
// between the two being surfaced rather than averaged away — and about the one
// failure that would be worse than the original problem: confidently showing an
// empty morning because the diary simply was not asked about today.

import {
  parseAmz, isoDay, dayName, covers, todayClasses, changeSummary, startingSoon, CHANGE_LABEL,
  dayRows, dateOfDay,
} from '../src/lib/today.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log('FAIL ' + n); } };
const eq = (a, b, n) => ok(Object.is(a, b), `${n} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const NOW = new Date(2026, 8, 7, 8, 0);            // Monday 7 Sep 2026, 08:00 local
const ISO = '2026-09-07';

const ev = (start, title, extra = {}) => ({
  start: `${ISO} ${start}`, end: `${ISO} ${start.replace(/^(\d+)/, m => String(+m + 1))}`,
  title, sType: 'C', ...extra,
});
const diaryOf = (events, window = { start: '2026-08-01', end: '2026-09-30' }) => ({ window, events });

const GRID = [
  { id: 'g1', day: 'Monday', start_time: '09:00', end_time: '10:00', subject: 'Blockchain', room: 'LT-3' },
  { id: 'g2', day: 'Monday', start_time: '11:00', end_time: '12:00', subject: 'IoT', room: 'LAB-2' },
  { id: 'g9', day: 'Tuesday', start_time: '09:00', end_time: '10:00', subject: 'ANS', room: 'LT-1' },
];

// ---------------------------------------------------------------- parsing
eq(parseAmz('2026-09-07 09:00:00')?.hm, '09:00', "Amizone's datetime parses");
eq(parseAmz('2026-09-07 1:30 PM')?.hm, '13:30', 'including 12-hour with PM');
eq(parseAmz('2026-09-07 12:15 AM')?.hm, '00:15', 'and midnight, which naive AM handling gets wrong');
eq(parseAmz('rubbish'), null, 'and nonsense is null rather than a wrong time');
eq(isoDay(new Date(2026, 8, 7, 23, 30)), '2026-09-07', 'a late-evening local day is still today');
eq(dayName('2026-09-07'), 'Monday', 'weekday from an ISO date');

// ---------------------------------------------------------------- the empty-day trap
{
  // THE WORST POSSIBLE FAILURE. A date the sync never asked about has no events
  // for a boring reason, and rendering that as "no classes today" would be a
  // confidently empty morning — worse than the stale grid this replaces.
  const outside = diaryOf([ev('09:00', 'Blockchain')], { start: '2026-01-01', end: '2026-01-31' });
  eq(covers(outside, ISO), false, 'a date outside the fetched window is not covered');
  eq(todayClasses(outside, GRID, NOW).known, false, 'so the day is reported as UNKNOWN, not as empty');
  eq(todayClasses(null, GRID, NOW).known, false, 'no diary at all is unknown too');
  eq(todayClasses({ events: [] }, GRID, NOW).known, false, 'and a diary with no window cannot vouch for any date');
  eq(covers(diaryOf([]), ISO), true, 'a covered date with genuinely no events IS known');
  eq(todayClasses(diaryOf([]), GRID, NOW).classes.length, 0, 'and correctly holds no classes');
}

// ---------------------------------------------------------------- the ordinary day
{
  const t = todayClasses(diaryOf([ev('09:00', 'Blockchain', { room: 'LT-3' }), ev('11:00', 'IoT', { room: 'LAB-2' })]), GRID, NOW);
  eq(t.known, true, 'a covered day is known');
  eq(t.classes.length, 2, 'both classes appear');
  eq(t.classes[0].change, null, 'a class matching the grid is not flagged');
  eq(t.classes[0].room, 'LT-3', 'with its room');
  eq(t.dropped.length, 0, 'and nothing is reported missing');
  eq(changeSummary(t), '', 'a normal day says nothing — silence is the point');
}

// ---------------------------------------------------------------- AN EXTRA CLASS
{
  const t = todayClasses(diaryOf([
    ev('09:00', 'Blockchain', { room: 'LT-3' }),
    ev('14:00', 'ANS', { room: 'LT-1', faculty: 'Dr K' }),     // not in Monday's grid at all
  ]), GRID, NOW);
  eq(t.classes.length, 2, 'the extra class is shown, not filtered out as noise');
  const x = t.classes.find(c => c.subject === 'ANS');
  eq(x.change, 'extra', 'and is marked as extra');
  eq(x.room, 'LT-1', 'carrying the room it is actually in');
  eq(x.faculty, 'Dr K', 'and who is taking it');
  ok(/1 extra class/.test(changeSummary(t)), 'the summary names it');
  ok(CHANGE_LABEL.extra, 'and there is a label for the chip');
}

// ---------------------------------------------------------------- A ROOM CHANGE
{
  const t = todayClasses(diaryOf([ev('09:00', 'Blockchain', { room: 'LT-9' })]), GRID, NOW);
  const c = t.classes[0];
  eq(c.change, 'room', 'a different room is flagged');
  eq(c.room, 'LT-9', "TODAY'S room is the one shown");
  eq(c.usualRoom, 'LT-3', 'and the usual one is named so the change is legible');
  ok(/room change/.test(changeSummary(t)), 'the summary says so');

  const same = todayClasses(diaryOf([ev('09:00', 'Blockchain', { room: ' lt-3 ' })]), GRID, NOW);
  eq(same.classes[0].change, null, 'whitespace and case do not invent a room change');
}

// ---------------------------------------------------------------- a slot with no event
{
  const t = todayClasses(diaryOf([ev('09:00', 'Blockchain', { room: 'LT-3' })]), GRID, NOW);
  eq(t.dropped.length, 1, "a grid slot with no diary event is reported");
  eq(t.dropped[0].subject, 'IoT', 'by name');
  ok(!t.classes.some(c => c.subject === 'IoT'), 'and NEVER listed as a class — "probably cancelled" must not look like "definitely on"');
  ok(/not on the diary/.test(changeSummary(t)), 'the wording stays cautious rather than claiming a cancellation');
}

// ---------------------------------------------------------------- noise the diary carries
{
  const t = todayClasses(diaryOf([
    ev('09:00', 'Blockchain', { room: 'LT-3' }),
    ev('00:00', 'Independence Day', { sType: 'H', allDay: true }),
    ev('10:00', 'Fee notice', { sType: 'E' }),
    ev('09:00', 'Blockchain', { room: 'LT-3' }),          // chunk overlap: the same class twice
  ]), GRID, NOW);
  eq(t.classes.length, 1, 'holidays, notices and duplicate chunk entries are all excluded');
}

// ---------------------------------------------------------------- the notification
{
  const at0852 = new Date(2026, 8, 7, 8, 52);
  const soon = startingSoon(diaryOf([ev('09:00', 'Blockchain', { room: 'LT-3' })]), GRID, at0852, 10);
  eq(soon.length, 1, 'a class eight minutes out notifies');
  ok(/Blockchain in 8 min/.test(soon[0].title), 'saying how long you have');
  ok(/LT-3/.test(soon[0].body), 'and where to go');

  const moved = startingSoon(diaryOf([ev('09:00', 'Blockchain', { room: 'LT-9' })]), GRID, at0852, 10);
  ok(/room changed from LT-3/.test(moved[0].title), 'a room change is IN the notification — the whole point');
  ok(/LT-9/.test(moved[0].body), 'pointing at the new room');

  const extra = startingSoon(diaryOf([ev('09:00', 'ANS', { room: 'LT-1' })]), GRID, at0852, 10);
  ok(/extra class/.test(extra[0].title), 'and an extra class announces itself as one');

  eq(startingSoon(diaryOf([ev('08:45', 'Blockchain')]), GRID, at0852, 10).length, 0,
     'a class that already started is not news');
  eq(startingSoon(null, GRID, at0852, 10).length, 0, 'and an unknown day notifies nothing rather than guessing');
}

// ---------------------------------------------------------------- the shape the app already speaks
//
// Every existing consumer — HQ's card, the brief's "first is X at 09:00", the
// College tab — reads `start_time`/`subject`/`room` off a grid row. dayRows is
// the translation layer, and the whole reason it exists is that the wiring must
// not require rewriting those call sites.
{
  const d = dayRows(diaryOf([ev('09:00', 'Blockchain', { room: 'LT-9' }), ev('14:00', 'ANS', { room: 'LT-1' })]), GRID, NOW);
  ok(d.known, 'a covered date is known');
  eq(d.rows.length, 2, 'both of today\'s classes come through');
  eq(d.rows[0].start_time, '09:00', 'as start_time, not start — the field the app reads');
  eq(d.rows[0].subject, 'Blockchain', 'with the subject where it was');
  eq(d.rows[0].room, 'LT-9', "and TODAY's room, not the grid's");
  eq(d.rows[0].change, 'room', 'carrying the change for the chip');
  eq(d.rows[0].usualRoom, 'LT-3', 'and what it changed from');
  eq(d.rows[0].id, 'g1', 'a matched class keeps its slot id so React reuses the node');
  eq(d.rows[1].change, 'extra', 'the added class is flagged');
  ok(typeof d.rows[1].id === 'string' && d.rows[1].id.includes(ISO), 'and gets a stable synthetic key rather than undefined');
  ok(d.rows[0].id !== d.rows[1].id, 'keys are distinct');
}

// The failure that would be worse than the bug: an unfetched date rendering as
// a free day. It must render as the usual week instead.
{
  const d = dayRows(diaryOf([], { start: '2026-01-01', end: '2026-01-31' }), GRID, NOW);
  ok(!d.known, 'a date outside the fetched window is not known');
  eq(d.rows.length, 2, 'and the caller gets the weekly grid back, not an empty day');
  eq(d.rows[0].subject, 'Blockchain', 'in start_time order');
  eq(d.rows[1].subject, 'IoT', 'both of them');
  eq(d.rows[0].change, null, 'with nothing claimed about changes it cannot know about');
  eq(dayRows(null, GRID, NOW).rows.length, 2, 'no diary at all behaves the same way');
  eq(dayRows(null, null, NOW).rows.length, 0, 'and no timetable either is empty rather than a crash');
}

// ---------------------------------------------------------------- which Monday
//
// HQ rolls over to the next teaching day after 9pm. The grid is keyed by
// weekday and the diary by date, so something has to say which date that
// weekday means.
{
  const monday9pm = new Date(2026, 8, 7, 21, 30);
  eq(isoDay(dateOfDay('Monday', monday9pm, false)), '2026-09-07', 'unrolled, the viewed date is simply today');
  eq(isoDay(dateOfDay('Tuesday', monday9pm, true)), '2026-09-08', 'rolled at 9pm Monday, it is Tuesday');
  const sunday = new Date(2026, 8, 6, 10, 0);
  eq(isoDay(dateOfDay('Monday', sunday, true)), '2026-09-07', 'and Sunday folds forward to Monday');
  const sat9pm = new Date(2026, 8, 12, 22, 0);
  eq(isoDay(dateOfDay('Monday', sat9pm, true)), '2026-09-14', 'Saturday night skips the empty Sunday');
}

// Rolled forward, the diary still answers — tomorrow is inside the window.
{
  const monday9pm = new Date(2026, 8, 7, 21, 30);
  const tue = dateOfDay('Tuesday', monday9pm, true);
  const d = dayRows(diaryOf([{ start: '2026-09-08 09:00', end: '2026-09-08 10:00', title: 'ANS', room: 'LT-7', sType: 'C' }]), GRID, tue);
  ok(d.known, "tomorrow is inside the fetched window, so it is known too");
  eq(d.rows.length, 1, 'and tomorrow\'s classes are tomorrow\'s');
  eq(d.rows[0].subject, 'ANS', 'the right subject');
  eq(d.rows[0].change, 'room', 'with tonight\'s warning that the room moved');
  eq(d.rows[0].usualRoom, 'LT-1', 'from the usual one');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
