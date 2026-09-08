// Pins what PLAYER TWO is allowed to DO.
//
// The model's output is not a trusted instruction — it proposes, Neel confirms,
// and only then does anything happen. These assertions exist because the gap
// between those two sentences is where a chat assistant becomes a way to write
// arbitrary rows into someone's database.

import {
  ACTIONS, ACTION_NAMES, ACTION_INSTRUCTIONS,
  parseActions, stripActions, describeAction, resolveTodo, resolveHabit, resolveEvent, isDestructive,
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
const ALLOWED = ['add_todo', 'reschedule_todo', 'complete_todo', 'delete_todo', 'log_habit', 'unlog_habit', 'fbl_done', 'remember', 'queue_build', 'add_event', 'cancel_event'];
for (const n of ACTION_NAMES) ok(ALLOWED.includes(n), `${n} is on the reviewed allowlist`);
for (const n of ALLOWED) ok(ACTION_NAMES.includes(n), `${n} is still implemented`);
// FINANCIAL stays absolute. Money is read-only and no verb here may touch it.
ok(!ACTION_NAMES.some(n => /money|invest|trade|buy|sell|order|portfolio|holding/i.test(n)),
  'nothing financial is reachable — Money is read-only and that is not negotiable');

// DESTRUCTIVE is no longer "none", so it has to be "exactly these". A blanket
// ban was easy to keep and stopped being true the moment Neel asked to be able
// to delete a task; a named set is the version that still means something.
const DESTRUCTIVE = ['delete_todo', 'cancel_event'];
for (const n of ACTION_NAMES) {
  ok(isDestructive(n) === DESTRUCTIVE.includes(n), `${n}'s destructive flag matches the reviewed set`);
}
// The line that matters more than the list, restated when cancel_event was added.
//
// It was "destroys a todo and nothing else", which was the right rule stated too
// narrowly: a calendar event is not a todo, and it is also not the thing the rule
// was protecting. The real distinction is PLANS versus RECORDS.
//
// A plan is something not yet done — a task, a future meeting. Destroying one is
// a normal thing to want, and its consequence is in the future.
//
// A record is what actually happened — attendance, holdings, habit history,
// diary events, dividends. Those are the memory this whole app exists to keep,
// and a chat message must never be able to erase one. Widening the list above is
// only ever allowed to add plans.
const PLANS = ['todo', 'event'];
for (const n of ACTION_NAMES.filter(isDestructive)) {
  ok(PLANS.some(p => n.includes(p)), `${n} destroys a plan, not a record of what happened`);
}
for (const forbidden of ['attendance', 'holding', 'investment', 'habit_log', 'dividend', 'diary', 'brief', 'note']) {
  ok(!ACTION_NAMES.filter(isDestructive).some(n => n.includes(forbidden)),
     `nothing destructive can reach ${forbidden} — that is a record of what happened`);
}
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
// ...but it CAN be deleted. Throwing away something already ticked is ordinary;
// refusing to find it would be baffling.
ok(resolveTodo('Old done thing', todos, { includeDone: true }).ok, 'and includeDone reaches it for delete_todo');
ok(!resolveTodo('email', todos, { includeDone: true }).ok,
   'the ambiguity guard still refuses — which matters most on the one action that cannot be undone');
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
for (const verb of ['delete_habit', 'delete_subject', 'drop_table', 'buy', 'sell', 'update_investment', 'reschedule_meeting']) {
  is(parseActions(block({ do: verb, title: 'x', due: '2026-09-08' })).actions.length, 0,
     `${verb} is still not a thing PLAYER TWO can propose`);
}
// Two at a time, no matter how many new verbs exist.
{
  const many = ['add_todo', 'reschedule_todo', 'unlog_habit']
    .map(v => block({ do: v, title: 'T', due: '2026-09-08', name: 'Gym' })).join('\n');
  ok(parseActions(many).actions.length <= 2, 'the two-action cap survives a wider allowlist');
}


// ------------------------------------------------------------ deleting a task
//
// The first verb here that cannot be undone. Everything else is reversible — a
// task un-completes, a habit log goes back, a due date moves back. So this one
// has to look different at every stage, not just work.
{
  const r = parseActions(block({ do: 'delete_todo', title: 'Old thing' }));
  is(r.actions.length, 1, 'a delete can be proposed');
  ok(isDestructive('delete_todo'), 'and is flagged destructive so the confirm card can say so');
  ok(!isDestructive('complete_todo'), 'while completing something is not');

  const card = describeAction(r.actions[0]);
  ok(/Delete/.test(card), 'the card says delete');
  ok(/cannot be undone/.test(card),
     'and says it cannot be undone — the word "delete" alone reads like "dismiss" on a card you tap through');
  // \b matters: the card legitimately contains "undone", and a loose /done/
  // would have failed on the very phrase that makes it safe.
  ok(!/\bMark\b/i.test(card) && !/\bdone\b/i.test(card),
     'and never reads like completing it — "Mark X as done" and "Delete X" must not be confusable on a card you tap through');

  is(parseActions(block({ do: 'delete_todo' })).actions.length, 0, 'a delete with no title is refused');

  // Taught to the model, with the restraint attached. A verb the prompt
  // describes but the file rejects, or the reverse, is how an assistant starts
  // promising things that never happen — or doing things nobody asked for.
  ok(ACTION_INSTRUCTIONS.includes('delete_todo'), 'the prompt teaches it');
  ok(/only when Neel plainly asks/.test(ACTION_INSTRUCTIONS),
     'and tells it not to propose one as tidying');
  ok(/never in place of complete_todo/.test(ACTION_INSTRUCTIONS),
     'and not to reach for it when he says he has DONE something — that is the dangerous confusion');
}


// ------------------------------------------------------------ writing to the vault
{
  const r = parseActions(block({ do: 'remember', title: 'Why Turnstile blocks it', body: '# One\n\nTwo paragraphs.\n\nSecond.', folder: 'decisions' }));
  is(r.actions.length, 1, 'a note can be proposed');
  is(describeAction(r.actions[0]), 'Save “Why Turnstile blocks it” to the vault under decisions', 'the card says where it lands');
  ok(r.actions[0].body.includes('\n\n'),
     'the body keeps its paragraphs — cleanText collapses whitespace and would have flattened a note into one line');
  ok(!isDestructive('remember'), 'writing a note is not destructive');

  is(parseActions(block({ do: 'remember', title: 'X' })).actions.length, 0, 'a note with no body is refused');
  is(parseActions(block({ do: 'remember', body: 'text' })).actions.length, 0, 'and one with no title');
  is(parseActions(block({ do: 'remember', title: 'X', body: 'y' })).actions[0].folder, undefined,
     'the folder is optional — vault.js supplies the default, not the parser');

  // The model must not be able to queue something enormous. The runner's own
  // ceiling is 400 KB; a chat reply has no business near it.
  const huge = parseActions(block({ do: 'remember', title: 'X', body: 'y'.repeat(20000) }));
  ok(huge.actions[0].body.length <= 8000, 'an oversized body is cut rather than queued whole');

  // The path is never something the model wrote.
  ok(!('path' in parseActions(block({ do: 'remember', title: 'X', body: 'y', path: '.github/workflows/evil.yml' })).actions[0]),
     'a path the model invents is simply not read — build() copies fields from the spec, never from its object');

  ok(ACTION_INSTRUCTIONS.includes('remember'), 'the prompt teaches it');
  ok(/inbox, daily, decisions/.test(ACTION_INSTRUCTIONS), 'and names the folders it may choose from');
  ok(/six months/.test(ACTION_INSTRUCTIONS), 'and tells it to write for a reader who has none of this conversation');
}


// tags: a model asked for "tags" produces an array sometimes and a comma string
// other times. Rejecting one at random means a note that queues sometimes.
{
  const a = parseActions(block({ do: 'remember', title: 'X', body: 'y', tags: ['Amizone', 'College'] })).actions[0];
  ok(Array.isArray(a.tags) && a.tags.join(',') === 'amizone,college', 'an array of tags is lowercased and kept');
  const b = parseActions(block({ do: 'remember', title: 'X', body: 'y', tags: 'amizone, college' })).actions[0];
  ok(b.tags.join(',') === 'amizone,college', 'and a comma string parses the same way');
  is(parseActions(block({ do: 'remember', title: 'X', body: 'y' })).actions[0].tags, undefined, 'tags stay optional');
  is(parseActions(block({ do: 'remember', title: 'X', body: 'y', tags: [] })).actions[0].tags, undefined, 'an empty list is no tags, not a refusal');
  ok(parseActions(block({ do: 'remember', title: 'X', body: 'y', tags: Array(30).fill('t') })).actions[0].tags.length <= 8, 'and the list is capped');
}


// ------------------------------------------------------------ queueing a build
{
  const r = parseActions(block({ do: 'queue_build', title: 'WhatsApp bot',
    why: 'Capture tasks from the phone.', steps: ['S: pick a number', 'L: the webhook, and its verify handshake'] }));
  is(r.actions.length, 1, 'a build can be proposed');
  is(r.actions[0].steps.length, 2, 'with its steps');
  ok(/2 steps/.test(describeAction(r.actions[0])), 'and the card says how many, so it is a plan he can read');

  // THE COMMA TRAP. Tags arrive comma-separated; build steps arrive one per
  // line and routinely contain commas. Splitting steps on commas would shatter
  // "the webhook, and its verify handshake" into two half-steps — a plan that
  // looks longer and means less.
  const nl = parseActions(block({ do: 'queue_build', title: 'X', why: 'y',
    steps: 'S: pick a number\nL: the webhook, and its verify handshake' })).actions[0];
  is(nl.steps.length, 2, 'a newline string splits on lines');
  ok(/webhook, and its verify handshake/.test(nl.steps[1]), 'and a comma INSIDE a step survives');

  // Case matters for steps and not for tags: "S:" is a size, "Amizone" is not a tag.
  ok(/^S:/.test(nl.steps[0]), 'a step keeps its case, because the size prefix is uppercase');
  is(parseActions(block({ do: 'remember', title: 'X', body: 'y', tags: 'Amizone' })).actions[0].tags[0], 'amizone',
     'while tags are still lowercased');

  is(parseActions(block({ do: 'queue_build', title: 'X', why: 'y' })).actions.length, 0, 'a build with no steps is not a plan');
  is(parseActions(block({ do: 'queue_build', title: 'X', steps: ['S: a'] })).actions.length, 0, 'nor one with no reason');
  ok(parseActions(block({ do: 'queue_build', title: 'X', why: 'y', steps: Array(40).fill('S: a') })).actions[0].steps.length <= 20,
     'and a forty-step plan is capped');

  // The promise it must not make.
  ok(/NEVER estimate hours/.test(ACTION_INSTRUCTIONS), 'the model is told not to estimate durations');
  ok(/S: small/.test(ACTION_INSTRUCTIONS), 'and given sizes instead');
  ok(!isDestructive('queue_build'), 'queueing a spec destroys nothing');
}


// ------------------------------------------------------------ the calendar
{
  const a = parseActions(block({ do: 'add_event', title: 'Dentist', date: '2026-09-12', time: '17:00' })).actions[0];
  ok(a, 'an event can be proposed');
  ok(/2026-09-12 at 17:00/.test(describeAction(a)), 'the card says exactly when');
  ok(/17:00–18:30/.test(describeAction(parseActions(block({ do: 'add_event', title: 'X', date: '2026-09-12', time: '17:00', end: '18:30' })).actions[0])),
     'and shows an end time when one is given');
  is(parseActions(block({ do: 'add_event', title: 'X', date: '2026-09-12' })).actions.length, 0,
     'an event with no time is refused — a meeting at midnight is not what he meant');
  is(parseActions(block({ do: 'add_event', title: 'X', time: '17:00' })).actions.length, 0, 'nor one with no date');
  is(parseActions(block({ do: 'add_event', title: 'X', date: '2026-09-12', time: '5pm' })).actions.length, 0,
     'and "5pm" is still refused rather than guessed at');

  // Cancelling is destructive in a way deleting a todo is not: it reaches other
  // people's calendars, and there is no undo.
  const c = parseActions(block({ do: 'cancel_event', title: 'Standup' })).actions[0];
  ok(isDestructive('cancel_event'), 'cancelling is flagged destructive');
  ok(/Cancel/.test(describeAction(c)), 'the card says cancel');
  ok(/for everyone on it/.test(describeAction(c)),
     'and says the consequence reaches other people — the part that makes it different from deleting a task');
  ok(/never to tidy his calendar/.test(ACTION_INSTRUCTIONS), 'the model is told not to propose one unprompted');
}

// ------------------------------------------------------------ finding the event
{
  const now = new Date(2026, 8, 8, 9, 0);
  const events = [
    { id: 'personal:1', summary: 'Dentist', start: '2026-09-12T17:00' },
    { id: 'work:2', summary: 'Standup', start: '2026-09-09T09:30' },
    { id: 'work:3', summary: 'Standup', start: '2026-09-10T09:30' },
    { id: 'personal:4', summary: 'Old thing', start: '2026-09-01T10:00' },
  ];
  is(resolveEvent('Dentist', events, { now }).row.id, 'personal:1', 'an event resolves by name');
  is(resolveEvent('dentist', events, { now }).row.id, 'personal:1', 'case-insensitively');

  // The one that matters: cancelling the wrong recurring instance takes it off
  // other people's calendars too.
  ok(!resolveEvent('Standup', events, { now }).ok, 'two matching events refuse rather than picking one');
  ok(/matches 2/.test(resolveEvent('Standup', events, { now }).reason), 'saying how many');
  is(resolveEvent('Standup', events, { date: '2026-09-10', now }).row.id, 'work:3', 'and a date narrows it to one');

  ok(!resolveEvent('Old thing', events, { now }).ok,
     'a PAST event is never a candidate — cancelling something that already happened is never what was meant');
  ok(!resolveEvent('Dentist', events, { date: '2026-09-30', now }).ok, 'a date with nothing on it refuses');
  ok(!resolveEvent('anything', [], { now }).ok, 'an empty calendar refuses');
  ok(!resolveEvent('x', [{ summary: 'x', start: '2026-09-12T10:00' }], { now }).ok,
     'and an event with no id is not cancellable, because there is nothing to send');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
