// Pins "I did the Spanish module and there was no way to say so".
//
// The Reminders card mixes rows that can be finished with rows that describe a
// state of the world. Only the first kind may get a checkbox, and the two kinds
// of completion (a todo row vs a derived date) must not be conflated.

import { DONE_KEY, fblDoneKey, isDone, withDone, isHidden } from '../src/lib/reminders.js';
import { studyReminders, FBL_MODULES } from '../src/lib/exams.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log('FAIL ' + n); } };
const is = (a, b, n) => ok(Object.is(a, b), `${n} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

// ------------------------------------------------------------ the key
is(DONE_KEY, 'reminder_done', 'the memory key is stable — changing it orphans every tick');
is(fblDoneKey({ n: 2, from: '2026-08-29' }), 'fbl:2026-08-29', 'keyed on the window start');
ok(fblDoneKey(FBL_MODULES[1]) !== fblDoneKey(FBL_MODULES[2]),
  'consecutive modules get different keys');
// Module 2 recurs every semester; the window starting 2026-08-29 does not. A key
// built from the module number would arrive next term already ticked.
ok(!/module|\b2\b/i.test(fblDoneKey({ n: 2, from: '2026-08-29' }).replace('2026-08-29', '')),
  'the key carries no module number to collide on');

// ------------------------------------------------------------ toggling
const K = 'fbl:2026-08-29';
const after = withDone({}, K, true, 'T');
ok(isDone(after, { kind: 'memory', key: K }), 'a ticked reminder reads as done');
is(after[K], 'T', 'the tick records when it happened, not just that it did');
ok(!isDone(withDone(after, K, false), { kind: 'memory', key: K }), 'and can be unticked');

// withDone must not mutate — the caller writes the whole blob back, so a failed
// save has to leave the on-screen map untouched.
const before = {};
withDone(before, K, true);
is(Object.keys(before).length, 0, 'withDone returns a new map and mutates nothing');

// ------------------------------------------------------------ what is NOT done
ok(!isDone({}, { kind: 'memory', key: K }), 'an empty map means nothing is done');
ok(!isDone(null, { kind: 'memory', key: K }), 'a missing map is not a crash');
ok(!isDone(after, undefined), 'a row with no done descriptor is never "done"');
ok(!isDone(after, { kind: 'todo', id: 7 }), 'todo rows are completed on their own row, not here');
// Prototype keys must not read as ticked.
ok(!isDone({}, { kind: 'memory', key: 'constructor' }), 'prototype keys do not read as done');
ok(!isDone({ [K]: '' }, { kind: 'memory', key: K }), 'a falsy stored value is not done');

// ------------------------------------------------------------ hiding
ok(isHidden(after, { text: 'x', done: { kind: 'memory', key: K } }), 'a ticked row is hidden');
ok(!isHidden(after, { text: 'x' }), 'a row with no descriptor is always shown');
ok(!isHidden(after, { text: 'x', done: { kind: 'todo', id: 3 } }),
  'todo rows are hidden by their completed column, not by this map');

// ------------------------------------------------------------ which rows offer a tick
// 2026-08-29 is the first day of the Module 2 window, and 3 days before the
// 1 Sept exams — so both an FBL row and an exam row are produced.
const rows = studyReminders('2026-08-29');
const fblRow = rows.find(r => /Spanish/.test(r.text));
const examRow = rows.find(r => /Minor exams/.test(r.text));
ok(fblRow, 'the Spanish FBL row is produced on 2026-08-29');
ok(fblRow && fblRow.done && fblRow.done.kind === 'memory', 'and it is completable');
is(fblRow && fblRow.done.key, 'fbl:2026-08-29', 'with the key for the open window');
ok(examRow, 'the exam countdown row is produced too');
ok(examRow && !examRow.done, 'but an exam is not something you can tick — it is a date, not a task');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
