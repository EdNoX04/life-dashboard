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

import { homeContext, classNow, HOME_READS, HOME_WITHHELD } from '../src/lib/ally.js';

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
eq(scopeFor('journal'), null, 'nor the journal — and this one is permanent');

// The count assertion that used to live here ("exactly one tab is wired") did its
// job: widening had to come here and be argued for. Now that eleven more tabs are
// wired, a count says nothing useful — it would pass just as happily if someone
// added `money`. So the rule is stated as the rule.
for (const forbidden of ['money', 'journal']) {
  eq(scopeFor(forbidden), null, `${forbidden} has no scope and must never get one`);
}
// Health DOES have a scope now. That was a decision, not an oversight: the health
// tab holds weight, sleep hours and workout counts — numbers that reveal little in
// isolation. The journal is words, and words are a different category entirely.
ok(scopeFor('health'), 'health is scoped — numbers, not words');

// Every scope must name its tables one at a time. "Whatever this tab loaded" is
// how a store added next year silently starts leaving the browser.
for (const [tab, sc] of Object.entries(SCOPES)) {
  ok(Array.isArray(sc.reads) && sc.reads.length > 0, `${tab} names the tables it may read`);
  ok(typeof sc.blurb === 'string' && sc.blurb.length > 0, `${tab} can describe its own limits to the model`);
}

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
ok(/can see ONLY/i.test(sys) && /watch diary/i.test(sys),
   'the prompt states the boundary in words the model will follow');
ok(/name the tab that can/i.test(sys),
   'and tells it where to send the question instead of just refusing');
ok(/Never recommend a title in the ALREADY WATCHED list/i.test(sys), 'and the exclusion rule');
ok(/runtime/i.test(sys), 'asks for runtime, since "how long will this take" was the actual question');
ok(/out of date/i.test(sys),
  'and forbids claiming streaming availability, which it cannot see and would confidently invent');
ok(/not invent a rating/i.test(sys), 'and forbids inventing data outright');
ok(/at most three titles/i.test(sys),
   'and caps the suggestions — GLM-5.2 will otherwise return ten with headings, and nobody choosing what to watch tonight can use ten');
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

// (The summary used to print HERE, in the middle of the file. Everything below
// it still ran, but its failures were counted after the total had been printed
// and after the only `process.exit(1)` — so the entire home-dock context
// section could not fail the suite. Moved to the true end of the file.)

// --------------------------------------------------- the home dock's context

// Written because the dock shipped answering "what's my second class on Monday"
// with "I don't have access to your class schedule". That was TRUE — it was sent
// nothing — and useless to read on your own dashboard.

const HNOW = new Date('2026-08-15T12:00:00Z');   // a Saturday
const TT = [
  { day: 'Monday', start: '11:00', subject: 'DBMS', room: 'B-204' },
  { day: 'Monday', start: '09:00', subject: 'Operating Systems', room: 'A-101' },
  { day: 'Monday', start: '14:00', subject: 'Maths III' },
  { day: 'Tuesday', start: '10:00', subject: 'Networks' },
];

const hc = homeContext({
  timetable: TT,
  todos: [{ title: 'Finish DBMS assignment', due_date: '2026-08-17', completed: false },
          { title: 'Old thing', due_date: '2026-01-01', completed: true }],
  events: [{ summary: 'Dentist', start: '2026-08-20T10:00:00Z', accountLabel: 'Personal' }],
  habits: [{ name: 'Gym' }],
  goals:  [{ title: 'Crack placements' }],
  now: HNOW,
});

// The question that started it. "Second class" is a question about POSITION, so
// the ordering is the answer — a list sorted by anything else cannot be right,
// and a model handed an unordered list will pick one confidently anyway.
ok(/Monday classes, in order/.test(hc), 'Monday is grouped as an ordered sequence');
ok(/1\) Operating Systems/.test(hc), 'the 09:00 class is first, not the one listed first in the data');
ok(/2\) DBMS/.test(hc), 'and the 11:00 class is second — the actual answer to the question');

ok(/Finish DBMS assignment/.test(hc), 'open tasks are present');
ok(!/Old thing/.test(hc), 'completed tasks are not');
ok(/Dentist/.test(hc), 'upcoming events are present');
ok(/Gym/.test(hc) && /Crack placements/.test(hc), 'habit and goal names are present');

// The boundary, stated as a test. This context goes to NVIDIA's free tier, whose
// terms say inputs are logged and used for training. The dock must not become the
// side door that carries personal data out of the screens that route to the paid
// provider.
for (const k of HOME_WITHHELD) {
  ok(!HOME_READS.includes(k), `${k} is never read into the home dock's prompt`);
}
ok(/not available to you/.test(hc), 'and the model is told what it cannot see, so it says so instead of guessing');

// ---------------------------------------------------------------------------
// The clock. The dock answered "what is my next period" with "I have no access
// to your schedule" while holding the timetable, because it was never told the
// time. These guard the three defects that caused it.

// Local, not UTC. 23:30 IST is still the 29th; toISOString() would say the 30th
// while getDay() beside it still said Saturday — a context contradicting itself.
const LATE = new Date(2026, 7, 29, 23, 30);      // Sat 29 Aug 2026, 23:30 local
const late = homeContext({ timetable: TT, now: LATE });
ok(/2026-08-29/.test(late), 'an evening in IST still reports today, not tomorrow');
ok(/Saturday/.test(late), 'and the weekday agrees with the date it printed');
ok(!/2026-08-30/.test(late), 'the UTC rollover bug is gone');

// The time of day itself, without which "next" is unanswerable.
ok(/23:30/.test(late), 'the context states the current time, not just the date');
ok(/Right now it is/.test(late), 'and states it first, where it will be read');

// Next class is COMPUTED. A model doing this arithmetic itself gets it wrong.
const sat = classNow(TT, new Date(2026, 7, 29, 12, 0));   // Saturday, no classes
ok(/Next class: Operating Systems at 09:00/.test(sat.next), 'from a Saturday it looks forward to Monday 09:00');
ok(/on Monday/.test(sat.next), 'and names the day rather than leaving it to be inferred');
ok(/No class is in progress/.test(sat.current), 'and says plainly that nothing is running now');

const mon = classNow(TT, new Date(2026, 7, 31, 9, 30));   // Monday 09:30, mid-OS
ok(/In progress right now: Operating Systems/.test(mon.current), 'a class that has started and not ended is in progress');
ok(/Next class: DBMS at 11:00/.test(mon.next), 'and the next one is the following slot, not tomorrow');
ok(/later today/.test(mon.next), 'described as later today');

const fri = classNow(TT, new Date(2026, 8, 4, 12, 0));    // Friday — wraps the week
ok(/Operating Systems/.test(fri.next), 'the search wraps past Sunday to next Monday');

ok(classNow([], new Date()) === null, 'no timetable returns null rather than a confident sentence');

// Attendance — the most obvious college question, previously unanswerable
// because subjects were never passed in at all.
const att = homeContext({
  now: HNOW,
  subjects: [
    { name: 'IoT System Design', attendance_pct: 100 },
    { name: 'Blockchain', attendance_pct: 0.9 },      // fraction form
    { name: 'Prof Programming', attendance_pct: 72 },
    { name: 'Unsynced Thing', attendance_pct: 0 },
  ],
});
ok(/IoT System Design 100%/.test(att), 'percent values pass through');
ok(/Blockchain 90%/.test(att), 'fraction values are normalised to percent');
ok(!/Unsynced Thing/.test(att), 'subjects with no attendance yet are not reported as 0%');
ok(/Below the 75% requirement: Prof Programming \(72%\)/.test(att), 'a subject under 75% is called out by name');
ok(/Average 87%/.test(att), 'and the average is over rated subjects only');

const safe = homeContext({ now: HNOW, subjects: [{ name: 'X', attendance_pct: 90 }] });
ok(/Nothing is below the 75%/.test(safe), 'the all-clear is stated rather than left as silence');

// Exams and the FBL deadline are imported facts, so no caller can omit them.
ok(/Minor exams/.test(hc), 'the exam timetable is always present');
ok(/Blockchain 4:00 PM/.test(hc), 'with real times, not just dates');
// HNOW (15 Aug) sits BETWEEN FBL windows, so the absence of an FBL line there is
// correct — module 1 opens on the 17th. Asserted on a date inside a window.
const fblOpen = homeContext({ now: new Date(2026, 7, 19, 10, 0) });   // 19 Aug, module 1 open
ok(/Spanish FBL/.test(fblOpen), 'an OPEN FBL window is stated, deadline and all');
ok(/cannot be attempted later/.test(fblOpen), 'together with the rule that makes it urgent');
ok(!/Spanish FBL/.test(hc), 'and nothing is claimed when no window is open');

// An absent section reads to a model as "nothing scheduled", and "you have no
// classes" is a wrong answer wearing a helpful face.
const empty = homeContext({ now: HNOW });
ok(/No timetable rows are stored/.test(empty), 'an empty timetable is stated, not left silent');
ok(/No open tasks/.test(empty), 'and so is an empty task list');

console.log(`${pass}/${pass + fail} passing`);
if (fail) process.exit(1);
