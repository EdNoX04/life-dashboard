// Batch 3: anime and sitcoms as their own kinds, and episodes you click rather
// than count.
//
// The old model was an integer — "episodes watched: 37" — which cannot say WHICH
// 37, cannot record three in one night, and drifts the moment you skip around.
// An episode is now watched when a log entry exists for it, so the count is
// derived and cannot disagree with the diary.
//
// Two judgement calls get most of the assertions, because both are places where
// the obvious implementation is subtly wrong:
//
//   A SITCOM HAS NO COMPLETION PERCENTAGE. Nobody is working through Modern
//   Family toward 250. A bar at 15% implies a goal you never set.
//   AN UNAIRED EPISODE IS NOT ONE YOU ARE BEHIND ON. Six of twelve aired, six
//   watched, means caught up — not 50%.

import { KINDS, kindOf, isEpisodic, guessKind, progressFor } from '../src/lib/kinds.js';
import {
  normaliseSeason, seasonList, watchedSet, isWatched, seasonProgress, nextUp,
  seasonAsViewings, showProgress, SPECIALS_SEASON,
} from '../src/lib/seasons.js';

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; } else { fail++; console.log('FAIL ' + name); } };
const eq = (a, b, name) => ok(a === b, `${name} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

// ------------------------------------------------------------------- kinds

eq(KINDS.length, 4, 'four kinds: film, series, anime, sitcom');
eq(kindOf('sitcom').type, 'tv', 'a sitcom is still type tv on the shelf row — no migration');
eq(kindOf('anime').type, 'tv', 'and so is anime');
eq(kindOf('nonsense').key, 'movie', 'an unknown kind falls back rather than throwing');
eq(kindOf('tv').key, 'tv', 'a bare "tv" from an old row still resolves');
ok(isEpisodic('sitcom') && isEpisodic('anime') && isEpisodic('tv'), 'three kinds have episodes');
ok(!isEpisodic('movie'), 'a film does not');

// Guessing. A suggestion, never a verdict — the user can override.
eq(guessKind({ title: 'Heat', type: 'movie' }), 'movie', 'films are films');
eq(guessKind({ title: 'Modern Family', type: 'tv' }), 'sitcom', 'a known sitcom is spotted by name');
eq(guessKind({ title: 'MODERN FAMILY', type: 'tv' }), 'sitcom', 'case-insensitively');
eq(guessKind({ title: 'Panchayat', type: 'tv' }), 'sitcom', 'and the Indian ones are in the list too');

eq(guessKind({ title: 'Naruto', type: 'tv', genres: ['Animation'], countries: ['JP'] }), 'anime',
  'Japanese animation is anime');
// The assertion that keeps the heuristic honest.
eq(guessKind({ title: 'Bluey', type: 'tv', genres: ['Animation'], countries: ['AU'] }), 'tv',
  'animation ALONE is not anime — otherwise Bluey and Rick and Morty get filed as anime');
eq(guessKind({ title: 'Shogun', type: 'tv', genres: ['Drama'], countries: ['JP'] }), 'tv',
  'and a Japanese live-action drama is not anime either');
eq(guessKind({ title: 'Some New Show', type: 'tv' }), 'tv', 'anything unrecognised is a plain series');

// -------------------------------------------------------------- progress

const film = progressFor('movie', { watched: 1 });
eq(film.pct, 100, 'a watched film is 100%');
eq(progressFor('movie', { watched: 0 }).done, false, 'an unwatched one is not done');

const drama = progressFor('tv', { watched: 6, total: 12 });
eq(drama.pct, 50, 'a drama gets a completion percentage');
eq(drama.text, '6/12', 'read as a fraction');
eq(progressFor('tv', { watched: 12, total: 12 }).done, true, 'and finishing is a real state');
eq(progressFor('tv', { watched: 3, total: null }).pct, null,
  'an unknown total gives no percentage rather than a bar pinned at zero');

// The sitcom case — the reason this file exists.
const sit = progressFor('sitcom', { watched: 37, total: 250, lastSeason: 3, lastEpisode: 12 });
eq(sit.pct, null, 'a sitcom has NO completion percentage, even when the total is known');
eq(sit.style, 'position', 'it reports a position instead');
eq(sit.text, 'last at S03E12', 'which is where to pick up — the thing you actually need');
eq(progressFor('sitcom', { watched: 4 }).text, '4 episodes logged',
  'and with no position recorded it still says something true');

// --------------------------------------------------------------- seasons

const RAW = {
  seasons: [
    { season_number: 0, name: 'Specials', episode_count: 3 },
    { season_number: 2, name: 'Season 2', episode_count: 12 },
    { season_number: 1, name: 'Season 1', episode_count: 10 },
  ],
};
const list = seasonList(RAW);
eq(list.map(s => s.season).join(','), '1,2,0', 'seasons in order with specials LAST — nobody starts there');
eq(seasonList({}).length, 0, 'no seasons is an empty list');
eq(SPECIALS_SEASON, 0, 'specials are season zero, per TMDB');

const S1 = normaliseSeason({
  season_number: 1,
  episodes: [
    { season_number: 1, episode_number: 1, name: 'Pilot', air_date: '2026-01-01', runtime: 42 },
    { season_number: 1, episode_number: 2, name: 'Two', air_date: '2026-01-08', runtime: 42 },
    { season_number: 1, episode_number: 3, name: 'Three', air_date: '2026-01-15', runtime: 42 },
    { season_number: 1, episode_number: 4, name: 'Four', air_date: '2099-01-01', runtime: 42 },
  ],
});
eq(S1.episodes.length, 4, 'episodes are read');
eq(S1.episodes[0].name, 'Pilot', 'with their titles');
eq(normaliseSeason(null), null, 'a missing season payload is null');

// --------------------------------------------------------- watched lookup

const LOG = [
  { tmdb_id: 1408, title: 'House', season: 1, episode: 1, on: '2026-06-01' },
  { tmdb_id: 1408, title: 'House', season: 1, episode: 2, on: '2026-06-01' },
  // A different show, same evening. Must not leak into House's count.
  { tmdb_id: 999, title: 'Other', season: 1, episode: 1, on: '2026-06-01' },
  // The show logged as a whole night rather than an episode: real, and not an
  // episode tick.
  { tmdb_id: 1408, title: 'House', season: null, episode: null, on: '2026-06-02' },
];
const set = watchedSet(LOG, { tmdb_id: 1408 });
eq(set.size, 2, 'only this show\'s episode-level entries count');
ok(isWatched(set, 1, 1) && isWatched(set, 1, 2), 'the two logged episodes are watched');
ok(!isWatched(set, 1, 3), 'the third is not');
eq(watchedSet(LOG, { title: 'house' }).size, 2, 'matching by title works when there is no tmdb id');
eq(watchedSet([], { tmdb_id: 1 }).size, 0, 'an empty log watches nothing');

// ------------------------------------------------- airing vs being behind

const TODAY = new Date('2026-02-01T00:00:00Z');
const p = seasonProgress(S1.episodes, set, { today: TODAY });
eq(p.total, 4, 'four episodes exist');
eq(p.aired, 3, 'but only three have aired');
eq(p.watched, 2, 'two watched');
eq(p.upcoming, 1, 'one still to come');
ok(Math.abs(p.pct - 66.67) < 0.1, 'the percentage is of AIRED episodes, not of all of them');

const all = watchedSet([
  { tmdb_id: 1408, season: 1, episode: 1 }, { tmdb_id: 1408, season: 1, episode: 2 },
  { tmdb_id: 1408, season: 1, episode: 3 },
], { tmdb_id: 1408 });
const caught = seasonProgress(S1.episodes, all, { today: TODAY });
eq(caught.pct, 100, 'watching everything aired is 100%, not 75%');
eq(caught.complete, true, 'the aired run is complete');
eq(caught.caughtUp, true, 'but flagged as caught-up, not finished — one episode is still coming');
eq(seasonProgress(S1.episodes, all, { today: new Date('2099-06-01T00:00:00Z') }).caughtUp, false,
  'once everything has aired and been watched, it is finished rather than caught up');

// ---------------------------------------------------------------- next up

eq(nextUp(S1.episodes, set, { today: TODAY }).episode, 3, 'next up is the first unwatched aired episode');
eq(nextUp(S1.episodes, all, { today: TODAY }), null, 'caught up means nothing is next');
// The gap case: seen 1, 2 and 4 — the next thing is the one you skipped.
const gappy = watchedSet([
  { tmdb_id: 1408, season: 1, episode: 1 }, { tmdb_id: 1408, season: 1, episode: 2 },
  { tmdb_id: 1408, season: 1, episode: 4 },
], { tmdb_id: 1408 });
eq(nextUp(S1.episodes, gappy, { today: TODAY }).episode, 3,
  'a gap is the frontier — pointing past it would hide the hole');

// -------------------------------------------------------- fill a season

const fill = seasonAsViewings(S1.episodes, set, {
  on: '2026-02-01', title: 'House', tmdb_id: 1408, kind: 'tv', today: TODAY,
});
eq(fill.length, 1, 'only the unwatched, aired episode is added');
eq(fill[0].episode, 3, 'which is episode 3');
eq(fill[0].runtime, 42, 'carrying its runtime, so the time totals stay exact');
eq(seasonAsViewings(S1.episodes, all, { on: '2026-02-01', title: 'House', today: TODAY }).length, 0,
  'pressing it again adds nothing — it is idempotent');

// ------------------------------------------------------------ show totals

const loaded = { 1: S1 };
const sp = showProgress(list, loaded, set);
eq(sp.watched, 2, 'two episodes watched across loaded seasons');
eq(sp.seasonsKnown, 1, 'one season loaded');
eq(sp.seasonsTotal, 3, 'of three');
eq(sp.partial, true,
  'so the total is a FLOOR and says so — an unopened season is unknown, not empty');
eq(showProgress(list, { 1: S1, 2: S1, 0: S1 }, set).partial, false,
  'with every season loaded it is a real total');

console.log(`${pass}/${pass + fail} passing`);
if (fail) process.exit(1);

// ------------------------------------------------- genre beats the name list

// House M.D. was badged SITCOM on the shelf. The cause was ordering: a hardcoded
// list of sitcom TITLES was consulted before the genres TMDB actually returns,
// and 'house' was on it. A list of names cannot know about a show it has never
// heard of, and it mislabels anything that shares a title.
eq(guessKind({ title: 'House', type: 'tv', genres: ['Drama', 'Mystery'] }), 'tv',
   'a medical drama is not a sitcom, whatever it is called');
eq(guessKind({ title: 'Modern Family', type: 'tv', genres: ['Comedy'] }), 'sitcom',
   'a comedy series still reads as a sitcom');
eq(guessKind({ title: 'The Bear', type: 'tv', genres: ['Comedy', 'Drama'] }), 'tv',
   'comedy-drama is not a sitcom — the drama tag is the tiebreak');

// The name list survives only where there is nothing better to go on.
eq(guessKind({ title: 'Friends', type: 'tv', genres: [] }), 'sitcom',
   'with no genres at all, the hint list still helps');
eq(guessKind({ title: 'House', type: 'tv', genres: [] }), 'tv',
   'and House is no longer on it');

// Unchanged rules, asserted so the reordering did not quietly break them.
eq(guessKind({ title: 'Anything', type: 'movie', genres: ['Comedy'] }), 'movie',
   'a film is a film regardless of genre');
eq(guessKind({ title: 'Frieren', type: 'tv', genres: ['Animation'], countries: ['JP'] }), 'anime',
   'Japanese animation is anime');
eq(guessKind({ title: 'Bluey', type: 'tv', genres: ['Animation', 'Comedy'], countries: ['AU'] }), 'sitcom',
   'animation alone is not anime');
