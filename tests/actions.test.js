// Pins what PLAYER TWO is allowed to DO.
//
// The model's output is not a trusted instruction — it proposes, Neel confirms,
// and only then does anything happen. These assertions exist because the gap
// between those two sentences is where a chat assistant becomes a way to write
// arbitrary rows into someone's database.

import {
  ACTIONS, ACTION_NAMES, ACTION_INSTRUCTIONS,
  parseActions, stripActions, describeAction, resolveTodo, resolveHabit,
} from '../src/lib/actions.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log('FAIL ' + n); } };
const is = (a, b, n) => ok(Object.is(a, b), `${n} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
const block = o => '```action\n' + JSON.stringify(o) + '\n```';

// ------------------------------------------------------------ the allowlist
// Not a count. A bare `length === 4` breaks the first time a verb is added and
// gets "fixed" by bumping the number, which tests nothing. Naming them means a
// new verb cannot reach the model without someone writing it down HERE, next to
// the reason the allowlist exists.
const ALLOWED = ['add_todo', 'reschedule_todo', 'complete_todo', 'log_habit', 'unlog_habit', 'fbl_done'];
for (const n of ACTION_NAMES) ok(ALLOWED.includes(n), `${n} is on the reviewed allowlist`);
for (const n of ALLOWED) ok(ACTION_NAMES.includes(n), `${n} is still implemented`);
ok(!ACTION_NAMES.some(n => /delete|remove|drop|money|trade|buy|sell/i.test(n)),
  'nothing destructive and nothing financial is reachable');
for (const n of ACTION_NAMES) ok(ACTION_INSTRUCTIONS.includes(n), `the prompt teaches ${n} — prompt and allowlist must not drift`);

// ------------------------------------------------------------ happy path
const good = parseActions('Adding that now.\n\n' + block({ do: 'add_todo', title: 'Email Krati mam', due: '2026-09-02' }));
is(good.actions.length, 1, 'a valid proposal is read');
is(good.prose, 'Adding that now.', 'and the machinery never reaches the transcript');
is(describeAction(good.actions[0]), 'Add task “Email Krati mam” — due 2026-09-02', 'the card says exactly what will happen');
is(parseActions('Just an answer.').actions.length, 0, 'a plain answer proposes nothing');

// ------------------------------------------------------------ the boundary
// Everything below is a thing a confused or steered model might emit.
is(parseActions(block({ do: 'delete_all', table: 'todos' })).actions.length, 0, 'an unknown verb is refused');
is(parseActions(block({ do: 'add_todo', title: 'x', table: 'memory', id: 9, completed: true })).actions[0].table, undefined,
  'invented fields are not copied — the action is BUILT from the spec, not filtered');
is(Object.keys(parseActions(block({ do: 'add_todo', title: 'x', evil: 1 })).actions[0]).join(','), 'do,title',
  'and only spec fields survive');
is(parseActions(block({ do: 'add_todo' })).actions.length, 0, 'a missing required field is refused');
ok(/needs title/.test(parseActions(block({ do: 'add_todo' })).rejected[0]), 'and says why — a silent drop looks like being ignored');
is(parseActions(block({ do: 'add_todo', title: 'x', due: 'next tuesday' })).actions.length, 0, 'a vague date is refused, not guessed');
is(parseActions('```action\nnot json\n```').actions.length, 0, 'an unreadable block is refused');
is(parseActions(block([{ do: 'add_todo', title: 'a' }, { do: 'add_todo', title: 'b' }, { do: 'add_todo', title: 'c' }])).actions.length, 2,
  'at most two proposals — a real one must not be buried under a pile');
is(parseActions(block({ do: 'add_todo', title: 'y'.repeat(500) })).actions[0].title.length, 200, 'text is capped');
is(parseActions(block(['not', 'objects'])).actions.length, 0, 'junk entries are refused');
is(parseActions(block({ do: 'fbl_done', key: 'fbl:1999-01-01' })).actions[0].key, undefined,
  'fbl_done carries no key — the model may say "mark it done", never WHICH');

// ------------------------------------------------------------ stripping
is(stripActions('hi\n\n' + block({ do: 'add_todo', title: 'x' })), 'hi', 'the block is removed from the prose');
is(stripActions('no block here'), 'no block here', 'prose without a block is untouched');

// ------------------------------------------------------------ resolving
const todos = [
  { id: 1, title: 'Email Krati mam for access of Ai Lab', completed: false },
  { id: 2, title: 'Email the landlord', completed: false },
  { id: 3, title: 'Old done thing', completed: true },
];
ok(resolveTodo('Email Krati mam for access of Ai Lab', todos).ok, 'an exact title resolves');
is(resolveTodo('krati', todos).row.id, 1, 'a unique partial resolves');
ok(!resolveTodo('email', todos).ok, 'an ambiguous partial refuses rather than picking one');
ok(/matches 2/.test(resolveTodo('email', todos).reason), 'and says how many it matched');
ok(!resolveTodo('Old done thing', todos).ok, 'a completed task cannot be completed again');
ok(!resolveTodo('nothing like this', todos).ok, 'no match refuses');
ok(!resolveTodo('', todos).ok, 'an empty name refuses');

const habits = [{ id: 1, name: 'Gym' }, { id: 2, name: 'Read', archived: true }];
is(resolveHabit('gym', habits).row.id, 1, 'habits resolve case-insensitively');
ok(!resolveHabit('Read', habits).ok, 'an archived habit is not loggable');


// ------------------------------------------------------------ time on a task
//
// "remind me to email her at 5" used to lose the 5 entirely: add_todo had no
// time field, so the task landed with a date and nothing else.
{
  const t = parseActions(block({ do: 'add_todo', title: 'Email her', due: '2026-09-08', time: '17:00' }));
  is(t.actions.length, 1, 'a time is accepted');
  is(t.actions[0].time, '17:00', 'and kept');
  ok(/at 17:00/.test(describeAction(t.actions[0])), 'and shown on the card before he confirms');

  // 24-hour only. "5pm" would mean guessing at "5", and a task placed twelve
  // hours from where it was meant is worse than one with no time at all.
  for (const bad of ['5pm', '5:00 PM', '25:00', '17:60', '7:5', 1700]) {
    const r = parseActions(block({ do: 'add_todo', title: 'X', time: bad }));
    is(r.actions.length, 0, `“${bad}” is refused rather than guessed at`);
  }
  ok(/17:00/.test(parseActions(block({ do: 'add_todo', title: 'X', time: '5pm' })).rejected.join(' ')),
     'and the rejection says what a time should look like');

  is(parseActions(block({ do: 'add_todo', title: 'X' })).actions[0].time, undefined,
     'no time stays no time — never defaulted to midnight');
}

// ------------------------------------------------------------ moving a task
{
  const r = parseActions(block({ do: 'reschedule_todo', title: 'OS assignment', due: '2026-09-12' }));
  is(r.actions.length, 1, 'a move is a first-class verb');
  is(describeAction(r.actions[0]), 'Move “OS assignment” to 2026-09-12',
     'described as a move, not as a new task — complete-and-re-add would lose its history');
  is(parseActions(block({ do: 'reschedule_todo', title: 'OS assignment' })).actions.length, 0,
     'a move with nowhere to move to is refused — due is required here, unlike on add_todo');
}

// ------------------------------------------------------------ undoing a log
{
  const r = parseActions(block({ do: 'unlog_habit', name: 'Gym' }));
  is(r.actions.length, 1, 'a habit log can be undone');
  ok(/today/.test(describeAction(r.actions[0])),
     "and the card says TODAY — the history before today is not reachable from a chat message");
}

// ------------------------------------------------------------ still fenced in
//
// The point of widening the allowlist is that it stays an allowlist.
for (const verb of ['delete_todo', 'drop_table', 'buy', 'sell', 'update_investment', 'reschedule_meeting']) {
  is(parseActions(block({ do: verb, title: 'x', due: '2026-09-08' })).actions.length, 0,
     `${verb} is still not a thing PLAYER TWO can propose`);
}
// Two at a time, no matter how many new verbs exist.
{
  const many = ['add_todo', 'reschedule_todo', 'unlog_habit']
    .map(v => block({ do: v, title: 'T', due: '2026-09-08', name: 'Gym' })).join('\n');
  ok(parseActions(many).actions.length <= 2, 'the two-action cap survives a wider allowlist');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
