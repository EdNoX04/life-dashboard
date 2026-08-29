// Pins which assistant owns which screen.
//
// The bug: PLAYER TWO mounted at the app root with no idea what tab was showing,
// so it rendered on top of LEDGER on Money and on top of Ally on Media — the
// assistant that is forbidden from seeing finance, covering the one that owns
// it. Every expected value below is hand-typed.

import { assistantForTab, ownsTab, PLAYER_TWO, TAB_ASSISTANT } from '../src/lib/assistants.js';

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; } else { fail++; console.log('FAIL ' + name); } };
const is = (a, b, name) => ok(Object.is(a, b), `${name} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

// ------------------------------------------------------------ owned screens
is(assistantForTab('money'), 'ledger', 'Money belongs to LEDGER');
is(assistantForTab('movies'), 'ally', 'the Media tab (id "movies") belongs to Ally');
ok(ownsTab(PLAYER_TWO, 'money') === false, 'PLAYER TWO does not own Money');
ok(ownsTab(PLAYER_TWO, 'movies') === false, 'PLAYER TWO does not own Media');

// ------------------------------------------------------------ everywhere else
is(assistantForTab('hq'), PLAYER_TWO, 'Home belongs to PLAYER TWO');
is(assistantForTab('college'), PLAYER_TWO, 'College belongs to PLAYER TWO');
ok(ownsTab(PLAYER_TWO, 'todos') === true, 'PLAYER TWO owns Todo');

// The journal is a READ restriction in the system prompt, not an ownership one.
// It has no assistant of its own, so hiding the dock would remove help without
// giving any back.
ok(ownsTab(PLAYER_TWO, 'journal') === true, 'PLAYER TWO still appears on Journal');

// ------------------------------------------------------------ the default
// A tab added to App.jsx and forgotten here must still get an assistant.
is(assistantForTab('some-tab-invented-next-month'), PLAYER_TWO, 'an unknown tab falls back to PLAYER TWO');
is(assistantForTab(undefined), PLAYER_TWO, 'undefined falls back rather than hiding the dock');
is(assistantForTab(null), PLAYER_TWO, 'null falls back too');
is(assistantForTab(''), PLAYER_TWO, 'empty string falls back too');

// A bare `TAB_ASSISTANT[tab] || PLAYER_TWO` returns Object's constructor here —
// truthy, so the dock would vanish on a tab with this id.
is(assistantForTab('constructor'), PLAYER_TWO, 'prototype keys do not leak through the lookup');
is(assistantForTab('toString'), PLAYER_TWO, 'nor does toString');
is(assistantForTab('__proto__'), PLAYER_TWO, 'nor does __proto__');

// ------------------------------------------------------------ the map itself
is(Object.keys(TAB_ASSISTANT).length, 2, 'exactly two tabs are spoken for');
ok(!Object.keys(TAB_ASSISTANT).includes('media'), 'the id is "movies" — "media" is only the label');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
