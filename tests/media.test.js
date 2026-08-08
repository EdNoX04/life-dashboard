// Pins the media shelf arithmetic. Hand-typed literals throughout.

import {
  STATUSES, statusOf, normalizeTmdb, normalizeResults, progressOf,
  statusDisagreement, timeWatched, DEFAULT_EPISODE_MIN, shelfStats,
  SORTS, sortRows, filterRows,
} from '../src/lib/media.js';

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; } else { fail++; console.log('FAIL ' + name); } };
const eq = (a, b, name) => ok(a === b, `${name} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
const near = (a, b, name, tol = 1e-6) =>
  ok(a != null && Math.abs(a - b) < tol, `${name} (got ${a}, want ~${b})`);

// ------------------------------------------------------------- statuses
eq(STATUSES.length, 4, 'four shelves');
eq(statusOf('watching').label, 'WATCHING', 'a known status resolves');
eq(statusOf('nonsense').key, 'watchlist', 'an unknown status falls back to the backlog');
eq(statusOf(null).key, 'watchlist', 'a null status falls back too');

// -------------------------------------------------------------- tmdb
eq(normalizeTmdb({ media_type: 'person', name: 'Nolan' }), null, 'people are not titles');
eq(normalizeTmdb({ media_type: 'movie' }), null, 'a title-less result is dropped');
const mv = normalizeTmdb({ id: 27205, media_type: 'movie', title: 'Inception', release_date: '2010-07-16', poster_path: '/x.jpg', vote_average: 8.4, overview: ' A thief. ' });
eq(mv.type, 'movie', 'a movie is typed as a movie');
eq(mv.year, 2010, 'the year comes off the release date');
eq(mv.overview, 'A thief.', 'the overview is trimmed');
eq(mv.poster_url, 'https://image.tmdb.org/t/p/w185/x.jpg', 'the poster path becomes a URL');
near(mv.tmdb_score, 8.4, 'the TMDB score carries through');
// A series with no media_type is still a series if it has an air date.
eq(normalizeTmdb({ id: 1, name: 'Severance', first_air_date: '2022-02-18' }).type, 'tv',
  'an air date implies a series even with no media_type');
eq(normalizeTmdb({ id: 2, media_type: 'movie', title: 'Untitled' }).year, null,
  'a title with no date has no year, not year zero');
eq(normalizeTmdb({ id: 3, media_type: 'movie', title: 'X' }).poster_url, null,
  'no poster path means no poster URL');

const dedup = normalizeResults([
  { id: 1, media_type: 'movie', title: 'A' },
  { id: 1, media_type: 'movie', title: 'A' },
  { id: 1, media_type: 'tv', name: 'A' },
  { media_type: 'person', name: 'B' },
]);
eq(dedup.length, 2, 'duplicates collapse but a movie and series of one name do not');

// ----------------------------------------------------------- progress
const MOVIE = { id: 'm1', type: 'movie', status: 'watchlist' };
const MOVIE_DONE = { id: 'm2', type: 'movie', status: 'completed' };
eq(progressOf(MOVIE).pct, 0, 'an unwatched movie is 0%');
eq(progressOf(MOVIE_DONE).pct, 100, 'a completed movie is 100%');
eq(progressOf(MOVIE_DONE).done, true, 'a completed movie is done');

const TV = { id: 't1', type: 'tv', status: 'watching' };
const META = { t1: { episodes_watched: 3, episodes_total: 24 } };
const p = progressOf(TV, META);
eq(p.watched, 3, 'episodes watched carries through');
eq(p.total, 24, 'episode total carries through');
near(p.pct, 12.5, '3 of 24 is 12.5%');
eq(p.done, false, '3 of 24 is not done');
eq(p.known, true, 'a series with a total is measurable');
// Decision: an unknown total gives no bar rather than a fake 0%.
const unknown = progressOf(TV, { t1: { episodes_watched: 5 } });
eq(unknown.pct, null, 'no episode total means no percentage, not zero');
eq(unknown.known, false, 'an unmeasurable series says so');
eq(unknown.watched, 5, 'the watched count survives an unknown total');
// Over-counting is clamped rather than producing 120%.
eq(progressOf(TV, { t1: { episodes_watched: 30, episodes_total: 24 } }).pct, 100,
  'watching more episodes than exist caps at 100%');
eq(progressOf(TV, {}).watched, 0, 'a series with no meta has watched zero');

// ------------------------------------------------- status disagreement
eq(statusDisagreement(MOVIE_DONE), null, 'a movie cannot disagree with itself');
const finished = statusDisagreement({ id: 't1', type: 'tv', status: 'watching' },
  { t1: { episodes_watched: 24, episodes_total: 24 } });
eq(finished.kind, 'finished', 'all episodes watched but still filed as watching');
ok(finished.text.includes('24'), 'the disagreement names the episode count');
const unfinished = statusDisagreement({ id: 't1', type: 'tv', status: 'completed' },
  { t1: { episodes_watched: 10, episodes_total: 24 } });
eq(unfinished.kind, 'unfinished', 'filed complete with episodes left');
ok(unfinished.text.includes('14'), 'the disagreement names how many remain');
const started = statusDisagreement({ id: 't1', type: 'tv', status: 'watchlist' },
  { t1: { episodes_watched: 2, episodes_total: 24 } });
eq(started.kind, 'started', 'watched episodes but still on the backlog');
eq(statusDisagreement({ id: 't1', type: 'tv', status: 'watching' },
  { t1: { episodes_watched: 3, episodes_total: 24 } }), null,
  'a series mid-watch and filed as watching agrees');
// A finished series filed as dropped is a choice, not a mistake.
eq(statusDisagreement({ id: 't1', type: 'tv', status: 'dropped' },
  { t1: { episodes_watched: 24, episodes_total: 24 } }), null,
  'dropped after finishing is not flagged');
eq(statusDisagreement({ id: 't1', type: 'tv', status: 'watching' },
  { t1: { episodes_watched: 3 } }), null,
  'an unmeasurable series raises no disagreement');

// ---------------------------------------------------------- time watched
const ROWS = [
  { id: 'a', type: 'movie', status: 'completed' },
  { id: 'b', type: 'movie', status: 'watchlist' },
  { id: 'c', type: 'tv', status: 'watching' },
];
const M2 = { a: { runtime: 148 }, c: { episodes_watched: 3, episodes_total: 24, episode_runtime: 50 } };
const t = timeWatched(ROWS, M2);
eq(t.minutes, 298, '148 plus 3 x 50 is 298 minutes');
near(t.hours, 298 / 60, 'hours is minutes over sixty');
eq(t.exact, true, 'with every runtime known the figure is exact');
eq(t.unknownItems, 0, 'nothing unknown');
// An unwatched movie contributes nothing.
eq(timeWatched([{ id: 'b', type: 'movie', status: 'watchlist' }], { b: { runtime: 100 } }).minutes, 0,
  'an unwatched movie adds no time');
// Decision 2: unknown runtimes are estimated separately and flagged, never
// silently counted as zero.
const t2 = timeWatched(ROWS, { c: { episodes_watched: 4, episodes_total: 24 } });
eq(t2.minutes, 0, 'with no runtimes the exact total is zero');
eq(t2.exact, false, 'and it is explicitly not exact');
eq(t2.unknownEpisodes, 4, 'the unknown episodes are counted');
eq(t2.unknownItems, 1, 'the runtime-less completed movie is counted');
near(t2.estHours, (4 * DEFAULT_EPISODE_MIN) / 60, 'the estimate uses the default episode length');
eq(DEFAULT_EPISODE_MIN, 42, 'the default episode length is 42 minutes');
ok(t2.estHours > t2.hours, 'the estimate exceeds the confirmed figure');

// --------------------------------------------------------------- stats
const st = shelfStats([
  { id: '1', type: 'movie', status: 'completed', rating: 5 },
  { id: '2', type: 'movie', status: 'completed', rating: 3 },
  { id: '3', type: 'tv', status: 'watching', rating: null },
  { id: '4', type: 'movie', status: 'watchlist' },
], {});
eq(st.total, 4, 'four titles');
eq(st.byStatus.completed, 2, 'two completed');
eq(st.byStatus.watching, 1, 'one watching');
eq(st.byStatus.dropped, 0, 'a shelf with nothing on it reports zero, not undefined');
eq(st.tv, 1, 'one series');
eq(st.movies, 3, 'three movies');
eq(st.rated, 2, 'two rated');
eq(st.unrated, 2, 'two unrated');
near(st.avgRating, 4, 'the average of 5 and 3 is 4');
// An average over nothing is nothing.
eq(shelfStats([{ id: '1', type: 'movie', status: 'watchlist' }], {}).avgRating, null,
  'an unrated shelf has no average, not zero');
eq(shelfStats([], {}).total, 0, 'an empty shelf is empty');

// ---------------------------------------------------------- sort/filter
eq(SORTS[0].key, 'added', 'the default sort is recency, not rating');
const S = [
  { id: '1', title: 'Zulu', rating: 2, created_at: '2026-01-01', type: 'movie', status: 'completed' },
  { id: '2', title: 'Alpha', rating: null, created_at: '2026-03-01', type: 'tv', status: 'watching' },
  { id: '3', title: 'Mike', rating: 5, created_at: '2026-02-01', type: 'movie', status: 'watchlist' },
];
eq(sortRows(S, 'title')[0].title, 'Alpha', 'A-Z sorts alphabetically');
eq(sortRows(S, 'added')[0].title, 'Alpha', 'recency puts the newest first');
eq(sortRows(S, 'rating')[0].title, 'Mike', 'rated sort puts the highest first');
// Unrated last: null is not a zero-star review.
eq(sortRows(S, 'rating')[2].title, 'Alpha', 'unrated titles sort last, not first');
eq(sortRows([], 'title').length, 0, 'sorting nothing yields nothing');
// Sorting must not mutate the caller's array.
const orig = S.map(x => x.title).join(',');
sortRows(S, 'title');
eq(S.map(x => x.title).join(','), orig, 'sorting leaves the input array alone');

eq(filterRows(S, { status: 'watching' }).length, 1, 'filter by shelf');
eq(filterRows(S, { type: 'movie' }).length, 2, 'filter by type');
eq(filterRows(S, { q: 'al' }).length, 1, 'search is case-insensitive and partial');
eq(filterRows(S, { q: '  ' }).length, 3, 'a blank search filters nothing');
eq(filterRows(S, { type: 'movie', q: 'zul' }).length, 1, 'filters combine');
eq(filterRows(S, { status: 'dropped' }).length, 0, 'an empty shelf filters to nothing');

console.log(`${pass}/${pass + fail} passing`);
if (fail) process.exit(1);
