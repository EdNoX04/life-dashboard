// Pins the Amizone parse rules — in particular the two that produced the bug
// Neel reported: a Wednesday showing three classes when only two exist, and an
// attendance figure that never moved. Every expected value below is hand-typed
// rather than re-derived from the module.

import {
  DAYS, normalizeTime, normalizeDay, validSlot, dedupeSlots, countByDay,
  replacePlan, COLLAPSE_RATIO, attendancePct, usableAttendance,
} from '../scripts/lib/amizone-parse.mjs';

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; } else { fail++; console.log('FAIL ' + name); } };
const eq = (a, b, name) => ok(a === b, `${name} (got ${a}, want ${b})`);

// ------------------------------------------------------------ normalizing
eq(normalizeTime('9:15'), '09:15', 'single-digit hour is padded');
eq(normalizeTime('09:15'), '09:15', 'padded hour is left alone');
eq(normalizeTime('24:00'), null, 'hour 24 is refused');
eq(normalizeTime('10:75'), null, 'minute 75 is refused');
eq(normalizeTime('lunch'), null, 'non-time is refused');
eq(normalizeTime(null), null, 'null time is refused');

eq(normalizeDay('wednesday'), 'Wednesday', 'day is case-insensitive');
eq(normalizeDay(' Friday '), 'Friday', 'day is trimmed');
eq(normalizeDay('Someday'), null, 'a non-day is null, not a default');
eq(normalizeDay(null), null, 'a null day stays null');
eq(DAYS.length, 7, 'seven days');

// ---------------------------------------------------------------- validity
// Decision 2: a slot with no day is a parse failure, not a timetable entry.
eq(validSlot({ start_time: '09:15', end_time: '10:10', code: 'IOT401' }), null,
  'a slot with no day is rejected outright');
eq(validSlot({ day: 'Monday', start_time: '09:15', end_time: '10:10' }), null,
  'a slot with no course code is rejected');
eq(validSlot({ day: 'Monday', start_time: '11:10', end_time: '09:15', code: 'X101' }), null,
  'a slot that ends before it starts is rejected');
eq(validSlot({ day: 'Monday', start_time: '09:15', end_time: '09:15', code: 'X101' }), null,
  'a zero-length slot is rejected');
const v = validSlot({ day: 'monday', start_time: '9:15', end_time: '10:10', code: 'iot401' });
eq(v.day, 'Monday', 'valid slot normalizes the day');
eq(v.start_time, '09:15', 'valid slot normalizes the time');
eq(v.code, 'IOT401', 'valid slot upper-cases the code');
eq(v.room, null, 'a missing room is null, not undefined');

// ---------------------------------------------------------------- dedupe
// Decision 1: the actual reported bug. The <td> and its inner <div> both
// matched, so this one Wednesday class was scraped twice.
const WED_DUP = [
  { day: 'Wednesday', start_time: '09:15', end_time: '10:10', code: 'IOT401', room: null, faculty: null },
  { day: 'Wednesday', start_time: '9:15',  end_time: '10:10', code: 'IOT401', room: 'E3-318', faculty: 'Krati' },
  { day: 'Wednesday', start_time: '10:15', end_time: '11:10', code: 'ANS402', room: 'E3-318', faculty: 'Shilpi' },
];
const wed = dedupeSlots(WED_DUP);
eq(wed.length, 2, 'Wednesday collapses to the two classes that exist');
eq(countByDay(wed).Wednesday, 2, 'the day count is 2, not 3');
// The richer copy survives, so de-duplication does not cost the room.
eq(wed[0].room, 'E3-318', 'the copy carrying the room wins');
eq(wed[0].faculty, 'Krati', 'the copy carrying the faculty wins');
// Order of arrival must not decide the winner.
const wedRev = dedupeSlots([WED_DUP[1], WED_DUP[0], WED_DUP[2]]);
eq(wedRev[0].room, 'E3-318', 'richness beats arrival order in either direction');

// Two genuinely different classes at the same time are not duplicates.
eq(dedupeSlots([
  { day: 'Monday', start_time: '09:15', end_time: '10:10', code: 'AAA111' },
  { day: 'Monday', start_time: '09:15', end_time: '10:10', code: 'BBB222' },
]).length, 2, 'same slot, different course, is two entries');
// The same course on two days is not a duplicate either.
eq(dedupeSlots([
  { day: 'Monday',  start_time: '09:15', end_time: '10:10', code: 'AAA111' },
  { day: 'Tuesday', start_time: '09:15', end_time: '10:10', code: 'AAA111' },
]).length, 2, 'same course on two days is two entries');

// Invalid rows are dropped by dedupe, not passed through.
eq(dedupeSlots([{ start_time: '09:15', end_time: '10:10', code: 'AAA111' }]).length, 0,
  'a day-less row does not survive dedupe');

// Sorting is by weekday then time, so Monday precedes Tuesday regardless of input.
const sorted = dedupeSlots([
  { day: 'Friday',  start_time: '09:15', end_time: '10:10', code: 'FFF111' },
  { day: 'Monday',  start_time: '15:15', end_time: '17:10', code: 'MMM222' },
  { day: 'Monday',  start_time: '09:15', end_time: '10:10', code: 'MMM111' },
]);
eq(sorted[0].code, 'MMM111', 'sort puts the earlier Monday class first');
eq(sorted[1].code, 'MMM222', 'sort orders within a day by start time');
eq(sorted[2].day, 'Friday', 'sort puts Friday after Monday');

// ----------------------------------------------------------- replace plan
// Decision 3: the unconditional DELETE. A scrape that found nothing must not
// be allowed to present itself as an empty timetable.
const empty = replacePlan([], 16);
eq(empty.replace, false, 'an empty scrape never replaces a populated timetable');
ok(/16/.test(empty.reason), 'the refusal names how many rows were protected');
eq(replacePlan([], 0).replace, false, 'an empty scrape with nothing stored still writes nothing');

const good = [
  { day: 'Monday', start_time: '09:15', end_time: '11:10', code: 'ANS402' },
  { day: 'Monday', start_time: '13:15', end_time: '15:10', code: 'SKE401' },
  { day: 'Tuesday', start_time: '09:15', end_time: '10:10', code: 'BLK301' },
  { day: 'Tuesday', start_time: '10:15', end_time: '11:10', code: 'ANS402' },
];
eq(replacePlan(good, 4).replace, true, 'a like-for-like scrape replaces');
eq(replacePlan(good, 0).replace, true, 'a first-ever scrape replaces');
eq(replacePlan(good, 4).slots.length, 4, 'the plan carries the deduped slots');
// 4 against 16 stored is a quarter — well under half, so it is a collapse.
eq(replacePlan(good, 16).replace, false, 'a scrape that collapses to a quarter is refused');
// 4 against 8 is exactly half, and the rule is strictly-less-than, so it stands.
eq(replacePlan(good, 8).replace, true, 'exactly half is not yet a collapse');
eq(replacePlan(good, 9).replace, false, 'just under half is a collapse');
eq(COLLAPSE_RATIO, 0.5, 'the collapse threshold is half');
// The guard must measure DEDUPED slots, or the duplicate bug would mask a collapse.
eq(replacePlan([...good, ...good], 8).slots.length, 4, 'the plan dedupes before counting');

// ------------------------------------------------------------- attendance
// Decision 4: the register beats the donut.
eq(attendancePct({ attended: 21, total: 26, pct: 80 }), 80.8,
  'the attended/total pair overrides a disagreeing donut');
eq(attendancePct({ pct: 81 }), 81, 'a bare percent is taken as a percent');
eq(attendancePct({ pct: 0.81 }), 81, 'a fraction is scaled to a percent');
eq(attendancePct({ pct: 1 }), 100, 'a bare 1 reads as a full fraction, not 1%');
eq(attendancePct({ attended: 0, total: 26 }), 0, 'nobody-attended is 0, not null');
eq(attendancePct({ pct: 0 }), 0, 'a zero percent survives as 0');
eq(attendancePct({ attended: 30, total: 26 }), null, 'attending more than exist is refused');
eq(attendancePct({ attended: 5, total: 0 }), null, 'a zero total is refused, not divided by');
eq(attendancePct({ pct: 140 }), null, 'a percent above 100 is refused');
eq(attendancePct({ pct: -3 }), null, 'a negative percent is refused');
eq(attendancePct({}), null, 'nothing at all is null');
eq(attendancePct(null), null, 'a null row is null');

const use = usableAttendance([
  { code: 'iot401', attended: 21, total: 26 },
  { code: 'ANS402', pct: null },
  { code: '', pct: 90 },
]);
eq(use.length, 1, 'rows with no usable percent are dropped, not written as zero');
eq(use[0].code, 'IOT401', 'usable rows carry an upper-cased code');
eq(use[0].pct, 80.8, 'usable rows carry the recomputed percent');
eq(use[0].total, 26, 'usable rows keep the register total');

console.log(`${pass}/${pass + fail} passing`);
if (fail) process.exit(1);
