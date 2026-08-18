// How old is what the College tab is showing?
//
// Written because it showed three-week-old attendance exactly the way it shows
// today's: same numbers, same layout, same confidence. Attendance that has not
// moved is indistinguishable from attendance nobody recorded, which is why this
// cannot be left to the reader to notice.

import { ageOf, freshnessNote, STALE_DAYS, DEAD_DAYS, TONE } from '../src/lib/collegefresh.js';

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; } else { fail++; console.log('FAIL ' + name); } };
const eq = (a, b, name) => ok(a === b, `${name} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const NOW = new Date('2026-08-16T12:00:00Z');
const ago = d => new Date(NOW.getTime() - d * 86400000).toISOString();

eq(ageOf(ago(0), NOW).state, 'fresh', 'today is fresh');
eq(ageOf(ago(0), NOW).label, 'today', 'and says so in a word rather than "0 days ago"');
eq(ageOf(ago(1), NOW).label, 'yesterday', 'yesterday too');
eq(ageOf(ago(2), NOW).state, 'fresh', 'two days still counts — that covers a weekend');
eq(ageOf(ago(3), NOW).state, 'stale', 'three days does not');
eq(ageOf(ago(22), NOW).state, 'dead', 'three weeks is not stale, it is historical');
ok(STALE_DAYS < DEAD_DAYS, 'the thresholds are ordered');

eq(ageOf(null, NOW).state, 'never', 'no timestamp is "never", not "0 days ago"');
eq(ageOf('not a date', NOW).state, 'never', 'and neither is junk');

// A device clock behind the server produces a negative age. "-1 days ago" is
// nonsense; treating it as fresh is the honest reading.
eq(ageOf(new Date(NOW.getTime() + 3600e3).toISOString(), NOW).state, 'fresh',
   'a clock running behind does not produce a negative age');

// ------------------------------------------------------------- the sentence

const never = freshnessNote(null, null, NOW);
eq(never.state, 'never', 'never-synced is its own state');
ok(/by hand/.test(never.text), 'and it says where the numbers actually came from');

// A sync that RAN AND FAILED is a different situation from one that never ran,
// and the difference is what you do next.
const failed = freshnessNote(ago(1), { ok: false, reason: '401 row-level security' }, NOW);
eq(failed.state, 'error', 'a failed run is an error, not merely old data');
ok(/401/.test(failed.text), 'and carries the reason the worker gave');
ok(/from before that/.test(failed.text), 'while making clear the figures predate the failure');

eq(freshnessNote(ago(0), { ok: true }, NOW).state, 'fresh', 'a good recent sync is quiet');
ok(/Synced today/.test(freshnessNote(ago(0), { ok: true }, NOW).text), 'and brief about it');

const stale = freshnessNote(ago(4), { ok: true }, NOW);
eq(stale.state, 'stale', 'four days is stale');
ok(/may have moved/.test(stale.text), 'and warns about the consequence, not the mechanism');

const dead = freshnessNote(ago(22), { ok: true }, NOW);
eq(dead.state, 'dead', 'three weeks is dead');
ok(/not current/.test(dead.text) && /historical/.test(dead.text),
   'and says plainly that what is on screen is not today');

// Colour is never the only carrier: every state has words too, because a warning
// you have seen for three days stops registering as a colour first.
for (const s of ['fresh', 'stale', 'dead', 'error', 'never']) {
  ok(TONE[s], `${s} has a tone`);
  const n = freshnessNote(s === 'never' ? null : ago(30), s === 'error' ? { ok: false } : { ok: true }, NOW);
  ok(n.text && n.text.length > 10, `${s} has a sentence, not just a colour`);
}

console.log(`${pass}/${pass + fail} passing`);
if (fail) process.exit(1);
