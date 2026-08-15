// Episode runtimes.
//
// The shelf said "~59.6h estimated · no runtime for … +31" — a headline number
// with under half its input measured, and a caveat that admitted it without
// saying which half was which.
//
// Most of these tests are about the difference between MEASURED and INFERRED. An
// hours figure that blends the two silently is the old estimate wearing better
// clothes, and it is the failure this module exists to prevent — not the missing
// data itself, which is often genuinely missing.

import {
  seasonKey, median, episodeMinutes, minutesFor, locate, missingSeasons, accuracyNote,
  syncMinutes,
} from '../src/lib/episodes.js';

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; } else { fail++; console.log('FAIL ' + name); } };
const eq = (a, b, name) => ok(a === b, `${name} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

// Season 1: a double-length pilot, then 22-minute episodes. This shape is the
// whole argument for per-episode runtimes — episode_run_time[0] would call the
// pilot 22 minutes and be wrong by 22.
const S1 = { episodes: [
  { episode: 1, runtime: 44 },
  { episode: 2, runtime: 22 },
  { episode: 3, runtime: 22 },
  { episode: 4, runtime: 22 },
] };
// Season 2 has a hole: TMDB has the episode but no runtime for it.
const S2 = { episodes: [
  { episode: 1, runtime: 22 },
  { episode: 2, runtime: null },
  { episode: 3, runtime: 25 },
] };
const SEASONS = { '99:1': S1, '99:2': S2 };

eq(seasonKey(99, 2), '99:2', 'a season has a stable key');
eq(seasonKey(99, undefined), '99:1', 'and defaults to the first');

// ------------------------------------------------------------------- median
eq(median([22, 22, 44]), 22, 'the median ignores the outlier');
eq(median([22, 24]), 23, 'an even count averages the middle pair');
eq(median([]), null, 'no data is null, not zero — zero would be a claim');
eq(median([0, -5, 'x']), null, 'and junk is not data');

// --------------------------------------------------------- one episode
eq(episodeMinutes(SEASONS, 99, 1, 1).minutes, 44, 'the double pilot is 44, not the series average');
eq(episodeMinutes(SEASONS, 99, 1, 1).source, 'episode', 'and that came from the episode itself');

// The hole in season 2 falls back to the season median, and SAYS it did.
const hole = episodeMinutes(SEASONS, 99, 2, 2);
eq(hole.minutes, 24, 'a missing runtime borrows its own season median (22 and 25 → 23.5 → 24)');
eq(hole.source, 'season', 'and reports that it was inferred, not measured');

// A season we have never fetched falls further back, still labelled.
eq(episodeMinutes(SEASONS, 99, 5, 1, 30).source, 'show', 'an unknown season falls back to the show length');
eq(episodeMinutes(SEASONS, 99, 5, 1, null).minutes, null,
   'and with nothing to fall back on it returns null rather than inventing a zero');

// ------------------------------------------------------------------ totals
const four = minutesFor(SEASONS, 99, 4);
eq(four.minutes, 44 + 22 + 22 + 22, 'four episodes sum their real lengths');
eq(four.measured, 4, 'all four were measured');
eq(four.exact, true, 'so the total is exact');

// Crossing into season 2 picks up the inferred episode, and the flag flips.
const six = minutesFor(SEASONS, 99, 6);
eq(six.minutes, 110 + 22 + 24, 'the run continues into the next season');
eq(six.measured, 5, 'five episodes had their own runtime');
eq(six.inferred, 1, 'and one was borrowed');
eq(six.exact, false, 'which makes the total no longer exact — and it says so');

// Claiming more episodes than we hold data for must not silently shrink the
// total. Counting them as inferred is the honest handling; dropping them would
// make the number quietly too small, which is the harder error to notice.
const nine = minutesFor(SEASONS, 99, 9, 30);
eq(nine.inferred, 3, 'episodes beyond known seasons are filled and counted as inferred');
ok(nine.minutes > six.minutes, 'and the total grows rather than stalling');

eq(minutesFor(SEASONS, 99, 0).minutes, 0, 'nothing watched is zero minutes');
eq(minutesFor(SEASONS, 99, 0).exact, true, 'and zero is exactly right');

// ------------------------------------------------------------------ locate
eq(JSON.stringify(locate(SEASONS, 99, 1)), '{"season":1,"episode":1}', 'the first episode');
eq(JSON.stringify(locate(SEASONS, 99, 4)), '{"season":1,"episode":4}', 'the last of season one');
eq(JSON.stringify(locate(SEASONS, 99, 5)), '{"season":2,"episode":1}', 'and the next one rolls over');
eq(locate(SEASONS, 99, 99), null, 'past what we know is null, not a guess');

// --------------------------------------------------------- what to fetch
// A twelve-season show is twelve requests if you ask blindly and one if you ask
// for what you need.
const need = missingSeasons({ '99:1': S1 }, 99, 3, 6);
eq(need.length, 0, 'season one already covers three episodes — fetch nothing');
ok(missingSeasons({}, 99, 3, 6).includes(1), 'with nothing cached, season one is needed');

// ------------------------------------------------------------------ words
ok(/exact/.test(accuracyNote({ measured: 4 })), 'an exact total says so');
ok(/estimated/.test(accuracyNote({ measured: 5, inferred: 1 })), 'a mixed total names both parts');
ok(/no runtime at all/.test(accuracyNote({ measured: 1, unknown: 2 })),
   'and episodes with nothing at all are counted separately from estimates');
eq(accuracyNote({}), 'nothing watched yet', 'an empty shelf entry is not "0 exact"');

// -------------------------------------------------------------- syncMinutes

// Only genuinely measured episodes may be claimed as measured. If inferred ones
// were counted too, shelfStats would treat the total as exact when it is not —
// which is the whole failure being fixed, reintroduced one layer up.
const patch = await syncMinutes({
  tmdbId: 99, watched: 6, totalSeasons: 2, cache: SEASONS,
  fetchSeason: async () => { throw new Error('should not be called — both seasons cached'); },
});
eq(patch.minutes_measured, 110 + 22 + 24, 'the patch carries the summed minutes');
eq(patch.episodes_measured, 5, 'and counts only the five with their own runtime');
ok(/estimated/.test(patch.runtime_note), 'and states that one was estimated');

// A season that fails to fetch must not lose the ones that arrived.
let calls = 0;
const partial = await syncMinutes({
  tmdbId: 99, watched: 6, totalSeasons: 3, cache: { '99:1': S1 },
  fetchSeason: async (id, sn) => { calls++; if (sn === 2) return S2; throw new Error('offline'); },
  saveCache: async () => {},
});
ok(calls > 0, 'missing seasons are fetched');
ok(partial.minutes_measured > 110, 'and a failure on one season still yields a total from the rest');

eq(await syncMinutes({ tmdbId: 99, watched: 0 }), null, 'nothing watched needs no fetch at all');

console.log(`${pass}/${pass + fail} passing`);
if (fail) process.exit(1);
