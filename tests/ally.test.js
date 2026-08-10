// The floating assistant's context — batch 6.
//
// The instruction was "it only accesses the tab which is open and not other
// tabs". That is enforceable or it is decoration, so the context is built from
// an explicit per-tab allowlist here, and the chat component is handed a
// finished string it had no hand in assembling.
//
// It matters because of what else is in this app. A helper that quietly folds
// the portfolio into a prompt about films has sent a net worth to a third-party
// API the user did not think they were invoking. The tests below are mostly
// about what must NOT be in the string.

import {
  SCOPES, scopeFor, mediaContext, buildContext, systemPrompt, PROMPTS, MAX_CONTEXT_CHARS,
} from '../src/lib/ally.js';

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; } else { fail++; console.log('FAIL ' + name); } };
const eq = (a, b, name) => ok(a === b, `${name} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const LOG = [
  { title: 'The Dark Knight', year: 2008, rating: 5, on: '2026-01-05' },
  { title: 'Tamasha', year: 2015, rating: 5, on: '2026-02-01', review: 'The one that got under my skin.' },
  { title: 'Anora', year: 2024, rating: 2, on: '2026-03-01' },
  { title: 'The Girl Next Door', year: 2004, rating: 1.5, on: null },   // undated, still watched
  { title: 'Interstellar', year: 2014, rating: 4.5, on: '2026-04-01' },
];
const SHELF = [
  { title: 'Dune', status: 'watchlist' },
  { title: 'Severance', status: 'watching' },
  { title: 'Old Thing', status: 'completed' },
];
const LISTS = [{ name: 'Sunday afternoon', items: [{}, {}] }];
const NOW = new Date('2026-08-10T00:00:00Z');

// ------------------------------------------------------------------ scoping

eq(scopeFor('media').label, 'Media', 'the media tab has a scope');
eq(scopeFor('money'), null, 'the money tab does NOT — no scope, no data');
eq(scopeFor('health'), null, 'nor health');
eq(scopeFor('journal'), null, 'nor the journal');
eq(Object.keys(SCOPES).length, 1, 'exactly one tab is wired so far — widening is a deliberate act');

eq(buildContext('money', { log: LOG }), null, 'an unscoped tab builds NO context even when handed data');
eq(buildContext('health', { log: LOG }), null, 'and cannot be talked into one');
ok(buildContext('media', { log: LOG }), 'the media tab does build one');

// ------------------------------------------------------- what goes in

const ctx = mediaContext({ log: LOG, shelf: SHELF, lists: LISTS, now: NOW });

ok(ctx.includes('The Dark Knight'), 'top-rated films are included');
ok(ctx.includes('5/5'), 'with their ratings — the actual taste signal');
ok(ctx.includes('The one that got under my skin'), 'and reviews, because they say what a number cannot');
ok(ctx.includes('Rated poorly'), 'poorly-rated films are named too');
ok(ctx.includes('Anora'), 'specifically — what someone dislikes rules more out than what they like');
ok(ctx.includes('Dune'), 'the watchlist is there, so it can pick from it');
ok(ctx.includes('Severance'), 'and what they are part-way through');
ok(ctx.includes('Sunday afternoon'), 'lists too');

// The exclusion list is the whole point of "do not suggest what I have watched".
ok(ctx.includes('ALREADY WATCHED'), 'the exclusion list is present and labelled');
for (const t of ['The Dark Knight', 'Tamasha', 'Anora', 'Interstellar']) {
  ok(ctx.includes(t), `${t} is in the context so it can be excluded`);
}
// The one that would slip through a diary-only context.
ok(ctx.includes('The Girl Next Door'),
  'an UNDATED viewing is still watched — 33 of this profile have no date, and a diary-only context would recommend them back');

// ------------------------------------------------------------- limits

const huge = Array.from({ length: 4000 }, (_, i) => ({ title: `Film Number ${i}`, rating: 4, on: '2026-01-01' }));
const big = mediaContext({ log: huge, now: NOW });
ok(big.length <= MAX_CONTEXT_CHARS, 'a huge library is clipped rather than sent whole');
ok(big.length > 1000, 'but not clipped to nothing');

eq(mediaContext({ log: [], shelf: [], lists: [], now: NOW }).includes('0 viewings'), true,
  'an empty library still produces honest context rather than nothing');

// ------------------------------------------------------- the system prompt

const sys = systemPrompt('media', ctx);
ok(/only see the Media tab/i.test(sys), 'the prompt states the boundary in words the model will follow');
ok(/Never recommend a title in the ALREADY WATCHED list/i.test(sys), 'and the exclusion rule');
ok(/runtime/i.test(sys), 'asks for runtime, since "how long will this take" was the actual question');
ok(/out of date/i.test(sys),
  'and forbids claiming streaming availability, which it cannot see and would confidently invent');
ok(/Never invent a rating, a date, or a film/i.test(sys), 'and forbids inventing data outright');
ok(sys.includes(ctx), 'the data is attached');

// With no scope there is no data AND the model is told to say so, rather than
// answering as if it could see the screen.
const blind = systemPrompt('money', null);
ok(/CANNOT see any of their data/i.test(blind), 'an unscoped tab tells the model it is blind');
ok(!blind.includes('The Dark Knight'), 'and carries none of the library');
ok(!/ALREADY WATCHED/.test(blind), 'nor the exclusion list it has no use for');

// The prompt must never carry data from a tab it was not built for. This is the
// leak the whole allowlist exists to prevent.
const moneyish = systemPrompt('media', mediaContext({ log: LOG, now: NOW }));
ok(!/portfolio|holdings|net worth|₹/i.test(moneyish),
  'nothing financial can reach a media prompt — there is no path for it to');

// -------------------------------------------------------------- openers

eq(PROMPTS.length, 4, 'four openers');
ok(PROMPTS.every(p => p.label && p.text), 'each has a label and a real question');
ok(PROMPTS.some(p => /90 minutes/i.test(p.text)), 'one asks about time available, as requested');
ok(PROMPTS.every(p => p.text.length > 30), 'and none is a bare greeting — an opener should do something');

console.log(`${pass}/${pass + fail} passing`);
if (fail) process.exit(1);
