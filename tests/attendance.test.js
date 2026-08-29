// Pins the distinction the old code could not make: a subject at a genuine 0%
// versus a subject with no attendance data at all.
//
// Three files each carried `const attPct = raw => Number(raw) || 0`, which folds
// null, '', undefined and 0 into one value, and every caller then tested
// `p > 0`. So Spanish — 0/1 after one missed class — rendered as "—", was left
// out of the average, and never tripped the below-75% warning. Every expected
// value below is hand-typed rather than re-derived from the module.

import { attPct, isLowAttendance } from '../src/lib/attendance.js';

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; } else { fail++; console.log('FAIL ' + name); } };
const is = (a, b, name) => ok(Object.is(a, b), `${name} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

// ------------------------------------------------------------ missing is null
is(attPct(null), null, 'null is missing, not zero');
is(attPct(undefined), null, 'undefined is missing, not zero');
is(attPct(''), null, 'empty string is missing, not zero');
is(attPct('not a number'), null, 'unparseable is missing, not zero');
is(attPct(NaN), null, 'NaN is missing, not zero');

// ------------------------------------------------------------ zero is zero
// The whole point. If this ever returns null again, Spanish disappears.
is(attPct(0), 0, 'a real zero survives as zero');
is(attPct('0'), 0, 'a zero string survives as zero');
is(attPct('0.00'), 0, 'a zero decimal survives as zero');

// ------------------------------------------------------------ normal range
is(attPct(80), 80, 'percent passes through');
is(attPct('67'), 67, 'numeric string passes through');
is(attPct(100), 100, 'one hundred is not rescaled');
is(attPct(74.9), 74.9, 'fractional percent keeps its precision');

// ------------------------------------------------------------ legacy fractions
is(attPct(0.8), 80, 'a 0-1 fraction is scaled to percent');
is(attPct(0.667), 66.7, 'scaling rounds to one decimal');
is(attPct(1), 100, 'exactly 1 reads as 100%, not 1% — the safer misread');

// ------------------------------------------------------------ the 75% rule
ok(isLowAttendance(0) === true, '0% is low — this is the case that was missed');
ok(isLowAttendance(67) === true, '67% is low');
ok(isLowAttendance(74.9) === true, 'just under the line is low');
ok(isLowAttendance(75) === false, 'exactly 75 meets the requirement');
ok(isLowAttendance(80) === false, '80% is fine');
ok(isLowAttendance(null) === false, 'unknown is not low — it must not raise an alarm');
ok(isLowAttendance(undefined) === false, 'undefined is not low');

// ------------------------------------------------------------ the average
// College.jsx averages over `!= null`, not `> 0`. A 0% subject must drag it down.
const avg = xs => { const r = xs.map(attPct).filter(p => p != null); return Math.round(r.reduce((a, b) => a + b, 0) / r.length); };
is(avg([80, 89, 92, 67, 0]), 66, 'a 0% subject is counted in the average');
is(avg([80, 89, 92, 67, null]), 82, 'a subject with no data is not counted');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
