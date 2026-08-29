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
is(ACTION_NAMES.length, 4, 'four verbs, and adding one is a deliberate act');
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

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
