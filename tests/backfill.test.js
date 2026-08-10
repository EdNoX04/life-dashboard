// Filling in posters and runtimes from TMDB.
//
// Letterboxd publishes neither: the films list has no artwork and nothing
// anywhere carries a runtime. So the shelf came out factually correct and
// looked broken — 58 titles, blank posters, "TIME WATCHED ~0.0h".
//
// The matching is the whole risk. A backfill that always picks something will,
// on a title TMDB does not carry, attach an unrelated poster and a runtime to
// match — and nothing about the result looks wrong afterwards. The shelf would
// simply appear complete. So most of what follows tests REFUSAL.

import {
  normTitle, pickMatch, needsBackfill, backfillGroups, applyMatch, markUnmatched,
  pending, resetChecks, YEAR_SLACK,
} from '../src/lib/backfill.js';

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; } else { fail++; console.log('FAIL ' + name); } };
const eq = (a, b, name) => ok(a === b, `${name} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

// ---------------------------------------------------------- title shapes

eq(normTitle('Your Name.'), 'your name', 'trailing punctuation does not make it a different film');
eq(normTitle('Spider-Man: Into the Spider-Verse'), 'spider man into the spider verse', 'hyphens and colons flatten');
eq(normTitle("Don't Look Up"), 'dont look up', 'apostrophes vanish rather than becoming spaces');
eq(normTitle('WALL·E'), 'wall e', 'and any other punctuation');
eq(normTitle('  Heat  '), 'heat', 'whitespace is trimmed');
eq(normTitle(null), '', 'nothing is nothing');

// ------------------------------------------------------------- matching

const HEATS = [
  { tmdb_id: 949, title: 'Heat', year: 1995, votes: 8000, runtime: 170 },
  { tmdb_id: 1, title: 'Heat', year: 1986, votes: 200, runtime: 101 },
  { tmdb_id: 2, title: 'Heat Wave', year: 1990, votes: 50 },
];

eq(pickMatch(HEATS, { title: 'Heat', year: 1995 }).tmdb_id, 949, 'the right year wins');
eq(pickMatch(HEATS, { title: 'Heat', year: 1986 }).tmdb_id, 1, 'in both directions — not just the popular one');
eq(pickMatch(HEATS, { title: 'Heat' }).tmdb_id, 949,
  'with no year to go on, the most-voted exact title is the best guess available');

// Release years differ by a year across regions routinely, so exact-only would
// reject correct matches.
eq(pickMatch(HEATS, { title: 'Heat', year: 1996 }).tmdb_id, 949,
  `a year within ${YEAR_SLACK} still matches`);
eq(pickMatch(HEATS, { title: 'Heat', year: 2005 }), null,
  'but a year far off is a DIFFERENT film with the same name, and is refused');

// The refusals that keep wrong data off the shelf.
eq(pickMatch(HEATS, { title: 'Heat Wave 2' }), null, 'a near-title is not a match');
eq(pickMatch([{ title: 'Vadh 2', year: 2025, votes: 10 }], { title: 'Vadh', year: 2022 }), null,
  'Vadh and Vadh 2 are different films — prefix matching is how you get the wrong one');
eq(pickMatch([], { title: 'Anything' }), null, 'no candidates, no match');
eq(pickMatch(HEATS, { title: '' }), null, 'and no title to match on is not a match either');

// Original titles matter for exactly the films this library is full of.
eq(pickMatch([{ tmdb_id: 7, title: 'RRR', original_title: 'Rise Roar Revolt', year: 2022, votes: 5 }],
  { title: 'Rise Roar Revolt', year: 2022 }).tmdb_id, 7,
  'a film listed under its original title still matches');

// ------------------------------------------------------------- the queue

const LOG = [
  { id: 'a', title: 'Heat', year: 1995, on: '2026-06-01', poster_url: 'p', runtime: 170 },
  { id: 'b', title: 'Heat', year: 1995, on: '2026-07-01' },              // rewatch, no data
  { id: 'c', title: 'Tamasha', year: 2015, on: '2026-08-01' },
  { id: 'd', title: 'Old One', year: 1999, on: null, poster_url: 'p', runtime: 120 },
];

const todo = needsBackfill(LOG);
eq(todo.length, 2, 'only entries missing a poster or a runtime are queued');
ok(!todo.some(e => e.id === 'd'), 'a complete entry is left alone');
eq(todo[0].id, 'c', 'newest first — a long run stopped halfway leaves you the half you look at');

// One lookup per FILM, not per viewing.
const groups = backfillGroups(LOG);
eq(groups.length, 2, 'two lookups for two distinct films');
const heatGroup = groups.find(g => g.title === 'Heat');
eq(heatGroup.ids.length, 1, 'only the incomplete viewing of Heat is in its group');
eq(backfillGroups([
  { id: 'x', title: 'Dune', year: 2021, on: '2026-01-01' },
  { id: 'y', title: 'Dune', year: 2021, on: '2026-02-01' },
]).length, 1, 'two viewings of one film are ONE search, not two');

// --------------------------------------------------------------- applying

const match = { tmdb_id: 949, poster_url: 'https://img/heat.jpg', runtime: 170, year: 1995 };
const filled = applyMatch(LOG, ['b'], match);
const b = filled.find(e => e.id === 'b');
eq(b.poster_url, 'https://img/heat.jpg', 'the poster lands');
eq(b.runtime, 170, 'and the runtime, which is what "time watched" was missing');
eq(b.tmdb_id, 949, 'and the id, so the shelf and the diary can link up');

// Gaps only. A field you answered is not overwritten by a lookup.
const mine = applyMatch(
  [{ id: 'm', title: 'Heat', poster_url: 'MY-POSTER', runtime: 165 }], ['m'], match,
);
eq(mine[0].poster_url, 'MY-POSTER', 'your poster stands');
eq(mine[0].runtime, 165, 'and your runtime — TMDB is not more authoritative than you are');

eq(applyMatch(LOG, ['a'], null)[0].poster_url, 'p', 'a null match changes nothing at all');
eq(applyMatch(LOG, [], match).length, LOG.length, 'and an empty id list touches no rows');

// ------------------------------------------------------------- not found

// A title TMDB does not carry must be remembered as such, or every future run
// spends the same requests failing the same way.
const missed = markUnmatched(LOG, ['c']);
eq(missed.find(e => e.id === 'c').tmdb_miss, true, 'the miss is recorded');
eq(pending(missed), 1, 'and it drops out of the pending count');
eq(pending(LOG), 2, 'which was two before');
eq(pending([]), 0, 'an empty log needs nothing');

// ---------------------------------------------- the counter that never cleared

// After a successful run the panel still read "1 TO LOOK UP" and would not go
// away. Two separate reasons, both the same shape: work that HAPPENED was not
// recorded, so it was offered again for ever.
//
//   A film TMDB carries with no artwork can never fill its poster gap, so
//   "missing a poster" kept it queued permanently.
//   A lookup that threw was counted as a miss but never marked, so it returned
//   to the queue on the next run.

const NOART = { tmdb_id: 5, poster_url: null, runtime: 18, year: 2025 };
const asked = applyMatch(
  [{ id: 'o', title: 'Obsession', year: 2025 }], ['o'], NOART,
);
eq(asked[0].tmdb_checked, true, 'a lookup that returned something is recorded as asked');
eq(asked[0].poster_url, null, 'even though the poster gap could not be closed');
eq(pending(asked), 0, 'and it leaves the queue — asking again gets the same answer');

// The pre-fix behaviour, stated so the regression is visible: a gap alone used
// to be enough to re-queue.
eq(pending([{ id: 'z', title: 'Something', year: 2020 }]), 1, 'an unasked entry IS queued');

// An error must mark too.
eq(pending(markUnmatched([{ id: 'e', title: 'Broke' }], ['e'])), 0,
  'a failed lookup does not come back on the next run');

// Deliberate reset, for when TMDB has since added a title or a match was wrong.
const cleared = resetChecks(asked);
eq(cleared[0].tmdb_checked, undefined, 'the mark is removed, not set to false');
eq(pending(cleared), 1, 'so it is offered again');
eq(resetChecks([{ id: 'a', title: 'Clean' }])[0].id, 'a', 'an untouched entry passes through unchanged');

// ---------------------------------------------- artwork breaks the tie

// "Obsession (2025)" matched an 18-minute festival short: exact title, right
// year, no poster. Within the rules and plainly not the film that was watched.
const OBSESSIONS = [
  { tmdb_id: 1, title: 'Obsession', year: 2025, votes: 3, poster_url: null, runtime: 18 },
  { tmdb_id: 2, title: 'Obsession', year: 2025, votes: 1, poster_url: 'https://img/o.jpg' },
];
eq(pickMatch(OBSESSIONS, { title: 'Obsession', year: 2025 }).tmdb_id, 2,
  'the candidate WITH artwork wins, even on fewer votes — a real feature has a poster');
eq(pickMatch([
  { tmdb_id: 3, title: 'Heat', year: 1995, votes: 10, poster_url: 'a' },
  { tmdb_id: 4, title: 'Heat', year: 1995, votes: 8000, poster_url: 'b' },
], { title: 'Heat', year: 1995 }).tmdb_id, 4,
  'when both have artwork, votes decide as before');

console.log(`${pass}/${pass + fail} passing`);
if (fail) process.exit(1);
