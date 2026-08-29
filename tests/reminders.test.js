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


// ---------------------------------------------------------------- system-wide
// Ticking a module must change what BOTH screens show, and must surface the next
// one rather than leaving the slot blank.
import { fblStatus } from '../src/lib/exams.js';

const DAY = '2026-08-29';                       // first day of the Module 2 window
const ticked = { [fblDoneKey({ from: '2026-08-29' })]: '2026-08-29T10:00:00Z' };

const openState = fblStatus(DAY);
is(openState.state, 'open', 'untouched, the open module reads as open');
ok(/Module 2 closes/.test(openState.text), 'and the card nags about its deadline');

const aheadState = fblStatus(DAY, ticked);
is(aheadState.state, 'ahead', 'ticked, the state becomes "ahead" — a state that did not exist before');
is(aheadState.finished && aheadState.finished.label, 'Module 2', 'it remembers which one was finished');
is(aheadState.next && aheadState.next.label, 'Module 3', 'and points at the next one');
ok(/Module 3 opens/.test(aheadState.text), 'the text names what comes next, not what is gone');

// The Study card reads the same list, so its ticks and HQ's cannot disagree.
const mods = aheadState.modules;
is(mods.length, 6, 'every module comes back, not just the open one');
is(mods[1].done, true, 'Module 2 is flagged done');
is(mods[2].done, false, 'Module 3 is not');
is(mods[0].closed, true, 'Module 1 closed on its own, without being ticked');
ok(mods[1].closed === false, 'a module finished early is done but NOT closed — different things');

// The reminder row swaps rather than vanishing.
const rowsBefore = studyReminders(DAY).filter(r => /Spanish/.test(r.text));
const rowsAfter = studyReminders(DAY, ticked).filter(r => /Spanish/.test(r.text));
is(rowsBefore.length, 1, 'one Spanish row before');
is(rowsAfter.length, 1, 'and still exactly one after — the slot is filled, not emptied');
ok(/Module 2/.test(rowsBefore[0].text), 'before: the module being chased');
ok(/Module 3 opens/.test(rowsAfter[0].text), 'after: the one that comes next');
ok(!rowsAfter[0].done, 'and it offers no tick — you cannot finish a window that has not opened');

// Tick every remaining module and the nagging stops entirely.
const allDone = {};
for (const m of FBL_MODULES) allDone[fblDoneKey(m)] = 'x';
is(fblStatus(DAY, allDone).next, null, 'with everything ticked there is no next module');
is(studyReminders(DAY, allDone).filter(r => /Spanish/.test(r.text)).length, 0, 'and no Spanish row at all');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
