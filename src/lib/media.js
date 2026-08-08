// Media shelf logic — the parts of the Movies/TV tracker that are arithmetic
// rather than markup, kept here so they can be tested without rendering.
//
// The `movies` table has six columns: title, type, status, tmdb_id, poster_url,
// rating. Everything this file adds — episode progress, runtimes, year, the
// overview — lives in a `media_meta` memory blob keyed by row id, per the
// project's zero-migration rule. That is why `progressOf` takes the row and the
// blob separately: the row is the shelf, the blob is what we know about it.
//
// Three decisions worth stating:
//
// 1. A series is finished when you have watched the last episode, not when you
//    have moved a dropdown. Status and progress can disagree, and when they do
//    the episode count is the honest one — it is a record of what happened,
//    while status is a record of what you last remembered to click.
//
// 2. Time watched is reported as a range when episode runtimes are unknown,
//    never as a single confident number. A 40-episode series with no runtime
//    recorded is not "0 hours".
//
// 3. Nothing sorts by rating by default. Your unrated backlog is the part you
//    actually need to see, and rating-sorted shelves bury it.

export const STATUSES = [
  { key: 'watchlist', label: 'PLAN TO WATCH', chip: 'c-cyan', color: 'var(--cyan)' },
  { key: 'watching', label: 'WATCHING', chip: 'c-yellow', color: 'var(--yellow)' },
  { key: 'completed', label: 'COMPLETED', chip: 'c-green', color: 'var(--green)' },
  { key: 'dropped', label: 'DROPPED', chip: 'c-red', color: 'var(--red)' },
];

export const statusOf = key =>
  STATUSES.find(s => s.key === String(key || '').toLowerCase()) || STATUSES[0];

// Number(null) and Number('') are both 0, which would make "no rating" and
// "zero stars" the same value, and "no runtime" the same as "instant". Absence
// has to survive the conversion.
//
// Mutation note: removing the guard is currently an EQUIVALENT mutation - every
// call site here also rejects <= 0 or treats a falsy rating as unrated, so 0 and
// null happen to travel the same path. It stays because that coincidence is a
// property of today's callers, not of the function, and this exact conversion
// has now produced three separate live bugs elsewhere in the project.
export const num = v => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// TMDB's /search/multi returns people alongside titles, and rows with no
// release date at all are usually announced-but-unmade projects.
export function normalizeTmdb(r) {
  if (!r || r.media_type === 'person') return null;
  const title = r.title || r.name;
  if (!title) return null;
  const isTv = r.media_type === 'tv' || (!r.media_type && !!r.first_air_date);
  const date = r.release_date || r.first_air_date || '';
  return {
    tmdb_id: r.id ?? null,
    title,
    type: isTv ? 'tv' : 'movie',
    year: /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : null,
    poster_url: r.poster_path ? `https://image.tmdb.org/t/p/w185${r.poster_path}` : null,
    backdrop_url: r.backdrop_path ? `https://image.tmdb.org/t/p/w780${r.backdrop_path}` : null,
    overview: (r.overview || '').trim(),
    tmdb_score: num(r.vote_average),
  };
}

export function normalizeResults(list = []) {
  const seen = new Set();
  return list
    .map(normalizeTmdb)
    .filter(Boolean)
    .filter(r => {
      const k = `${r.type}:${r.tmdb_id ?? r.title.toLowerCase()}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

// ------------------------------------------------------------ progress

// A movie is binary: watched or not. A series has episodes, and "3 of 24" is
// the only useful thing to say about it. Returning null for "no idea how long
// this is" is deliberate — a fake 0% bar is worse than no bar.
export function progressOf(row, meta = {}) {
  const m = meta[row?.id] || {};
  const isTv = String(row?.type) === 'tv';
  if (!isTv) {
    const done = row?.status === 'completed';
    return { kind: 'movie', done, pct: done ? 100 : 0, watched: done ? 1 : 0, total: 1, known: true };
  }
  const watched = Math.max(0, num(m.episodes_watched) ?? 0);
  const total = num(m.episodes_total);
  if (total === null || total <= 0) {
    return { kind: 'tv', done: false, pct: null, watched, total: null, known: false };
  }
  const w = Math.min(watched, total);
  return {
    kind: 'tv',
    done: w >= total,
    pct: (w / total) * 100,
    watched: w,
    total,
    known: true,
  };
}

// Decision 1. The dropdown and the episode count can disagree; when they do,
// the count is what actually happened.
export function statusDisagreement(row, meta = {}) {
  const p = progressOf(row, meta);
  if (p.kind !== 'tv' || !p.known) return null;
  if (p.done && row.status !== 'completed' && row.status !== 'dropped') {
    return { kind: 'finished', text: `All ${p.total} episodes watched, but this is still filed as ${statusOf(row.status).label.toLowerCase()}.` };
  }
  if (!p.done && p.watched > 0 && row.status === 'completed') {
    return { kind: 'unfinished', text: `Filed as completed, but ${p.total - p.watched} of ${p.total} episodes are unwatched.` };
  }
  if (p.watched > 0 && row.status === 'watchlist') {
    return { kind: 'started', text: `${p.watched} episode${p.watched === 1 ? '' : 's'} watched, but this is still on the plan-to-watch shelf.` };
  }
  return null;
}

// Decision 2. Runtime is often unknown, so the answer is a floor and a flag
// rather than a number that pretends to completeness.
export const DEFAULT_EPISODE_MIN = 42;

export function timeWatched(rows = [], meta = {}) {
  let minutes = 0, unknownItems = 0, unknownEpisodes = 0;
  for (const r of rows) {
    const m = meta[r.id] || {};
    const p = progressOf(r, meta);
    if (p.kind === 'movie') {
      if (!p.done) continue;
      const rt = num(m.runtime);
      if (rt === null || rt <= 0) { unknownItems++; continue; }
      minutes += rt;
    } else {
      if (p.watched <= 0) continue;
      const rt = num(m.episode_runtime);
      if (rt === null || rt <= 0) { unknownEpisodes += p.watched; continue; }
      minutes += rt * p.watched;
    }
  }
  const estMinutes = minutes + unknownEpisodes * DEFAULT_EPISODE_MIN;
  return {
    minutes,
    hours: minutes / 60,
    estHours: estMinutes / 60,
    unknownItems,
    unknownEpisodes,
    // `exact` is the only claim this function is willing to make confidently.
    exact: unknownItems === 0 && unknownEpisodes === 0,
  };
}

export function shelfStats(rows = [], meta = {}) {
  const byStatus = {};
  for (const s of STATUSES) byStatus[s.key] = 0;
  let rated = 0, ratingSum = 0, tv = 0, movies = 0;
  for (const r of rows) {
    if (byStatus[r.status] !== undefined) byStatus[r.status]++;
    const rt = num(r.rating);
    if (rt) { rated++; ratingSum += rt; }
    if (String(r.type) === 'tv') tv++; else movies++;
  }
  return {
    total: rows.length,
    byStatus, tv, movies, rated,
    // An average over zero ratings is not 0, it is nothing.
    avgRating: rated ? ratingSum / rated : null,
    unrated: rows.length - rated,
    time: timeWatched(rows, meta),
  };
}

// Decision 3. `added` is the default because the backlog is what you came to
// look at, and the newest thing you added is the one you are still thinking
// about. Rating sorts exist but you have to ask for them.
export const SORTS = [
  { key: 'added', label: 'RECENT' },
  { key: 'title', label: 'A–Z' },
  { key: 'rating', label: 'RATED' },
  { key: 'progress', label: 'PROGRESS' },
];

export function sortRows(rows = [], key = 'added', meta = {}) {
  const out = rows.slice();
  if (key === 'title') {
    out.sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));
  } else if (key === 'rating') {
    // Unrated last rather than first: a null is not a zero-star review.
    out.sort((a, b) => (num(b.rating) ?? -1) - (num(a.rating) ?? -1)
      || String(a.title || '').localeCompare(String(b.title || '')));
  } else if (key === 'progress') {
    out.sort((a, b) => (progressOf(b, meta).pct ?? -1) - (progressOf(a, meta).pct ?? -1));
  } else {
    out.sort((a, b) => String(b.created_at || b.id || '').localeCompare(String(a.created_at || a.id || '')));
  }
  return out;
}

export function filterRows(rows = [], { status = null, type = null, q = '' } = {}) {
  const needle = String(q || '').trim().toLowerCase();
  return rows.filter(r => {
    if (status && r.status !== status) return false;
    if (type && r.type !== type) return false;
    if (needle && !String(r.title || '').toLowerCase().includes(needle)) return false;
    return true;
  });
}
