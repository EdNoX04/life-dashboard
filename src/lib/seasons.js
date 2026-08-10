// Seasons and episodes — clicking one thing to mark it watched.
//
// The old model was a number in a box: "episodes watched: 37". It cannot answer
// which 37, cannot record that you watched three tonight, and quietly breaks the
// moment you skip around — which is exactly how anyone watches a sitcom.
//
// This maps TMDB's season payload onto the viewing log built in batch 1, so an
// episode is watched when there is a LOG ENTRY for it. That single decision
// gives the rest for free: the diary shows the night you binged four, rewatches
// work, and the count is derived rather than stored, so it can never drift out
// of step with the diary the way a hand-maintained integer does.

export const num = v => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// TMDB numbers specials as season 0. They are not part of the run, they are
// usually recaps or OVAs, and counting them makes "watched 26 of 25" possible.
export const SPECIALS_SEASON = 0;

export function normaliseSeason(j = {}) {
  if (!j) return null;
  return {
    season: num(j.season_number),
    name: j.name || (num(j.season_number) === SPECIALS_SEASON ? 'Specials' : `Season ${j.season_number}`),
    overview: (j.overview || '').trim() || null,
    air_date: j.air_date || null,
    episodes: (j.episodes || []).map(e => ({
      season: num(e.season_number),
      episode: num(e.episode_number),
      name: e.name || `Episode ${e.episode_number}`,
      overview: (e.overview || '').trim() || null,
      air_date: e.air_date || null,
      runtime: num(e.runtime),
      still: e.still_path ? `https://image.tmdb.org/t/p/w300${e.still_path}` : null,
    })).filter(e => e.episode != null),
  };
}

// The seasons a show has, from the detail payload, specials last rather than
// first. TMDB returns season 0 at the top and nobody starts there.
export function seasonList(detail = {}) {
  const list = (detail.seasons || [])
    .map(s => ({
      season: num(s.season_number),
      name: s.name || `Season ${s.season_number}`,
      episodes: num(s.episode_count) ?? 0,
      air_date: s.air_date || null,
      poster: s.poster_path ? `https://image.tmdb.org/t/p/w185${s.poster_path}` : null,
    }))
    .filter(s => s.season != null);
  const main = list.filter(s => s.season !== SPECIALS_SEASON).sort((a, b) => a.season - b.season);
  const specials = list.filter(s => s.season === SPECIALS_SEASON);
  return [...main, ...specials];
}

/**
 * Which episodes of this title are logged.
 *
 * Keyed "S|E" so a lookup is O(1) — a 250-episode sitcom grid asks this once per
 * cell on every render, and a scan per cell is 62,500 comparisons a repaint.
 */
export function watchedSet(log = [], { tmdb_id = null, title = '' } = {}) {
  const idKey = tmdb_id != null ? String(tmdb_id) : null;
  const tKey = String(title || '').toLowerCase().trim();
  const set = new Set();
  for (const e of log) {
    const matches = idKey != null
      ? String(e.tmdb_id ?? '') === idKey
      : String(e.title || '').toLowerCase().trim() === tKey;
    if (!matches) continue;
    if (e.season == null || e.episode == null) continue;
    set.add(`${e.season}|${e.episode}`);
  }
  return set;
}

export const epKey = (s, e) => `${s}|${e}`;
export const isWatched = (set, s, e) => !!set && set.has(epKey(s, e));

/**
 * Progress within one season.
 *
 * Counts only episodes that have AIRED. A season halfway through its run is not
 * "6 of 12 watched, you are behind" — you are current, and reporting 50% on a
 * show you are caught up with is the tracker being wrong in the direction that
 * makes you feel bad about it.
 */
export function seasonProgress(episodes = [], set, { today = new Date() } = {}) {
  const aired = episodes.filter(e => {
    if (!e.air_date) return true;          // unknown air date: assume it exists
    return Date.parse(`${e.air_date}T00:00:00Z`) <= today.getTime();
  });
  const watched = aired.filter(e => isWatched(set, e.season, e.episode)).length;
  const upcoming = episodes.length - aired.length;
  return {
    watched,
    aired: aired.length,
    total: episodes.length,
    upcoming,
    pct: aired.length ? (watched / aired.length) * 100 : null,
    complete: aired.length > 0 && watched === aired.length,
    // "Caught up" and "finished" are different states and the difference
    // matters: one means wait, the other means pick something new.
    caughtUp: aired.length > 0 && watched === aired.length && upcoming > 0,
  };
}

/**
 * The next episode to watch: the first AIRED, unwatched one, in order.
 *
 * Gaps are stepped over rather than treated as the frontier. If you have seen
 * 1-5 and 7, the next thing to watch is 6 — the one you skipped — not 8. A
 * tracker that points at 8 quietly hides the hole.
 */
export function nextUp(episodes = [], set, { today = new Date() } = {}) {
  const inOrder = episodes.slice().sort((a, b) => a.season - b.season || a.episode - b.episode);
  for (const e of inOrder) {
    if (e.air_date && Date.parse(`${e.air_date}T00:00:00Z`) > today.getTime()) continue;
    if (!isWatched(set, e.season, e.episode)) return e;
  }
  return null;
}

/**
 * Every episode of a season as viewings, for the "log the whole season" button.
 *
 * Already-logged episodes are excluded rather than re-added, so pressing it
 * twice is harmless, and unaired episodes are excluded because you have not
 * watched them. The date is the same for all of them and is a KNOWN
 * approximation — stated in the UI rather than dressed up as a real date per
 * episode, which would be inventing history.
 */
export function seasonAsViewings(episodes = [], set, { on, title, tmdb_id = null, kind = 'tv', poster_url = null, today = new Date() } = {}) {
  return episodes
    .filter(e => !e.air_date || Date.parse(`${e.air_date}T00:00:00Z`) <= today.getTime())
    .filter(e => !isWatched(set, e.season, e.episode))
    .map(e => ({
      title, tmdb_id, kind, poster_url,
      on,
      season: e.season,
      episode: e.episode,
      runtime: e.runtime ?? null,
      source: 'season-fill',
    }));
}

// Show-wide totals across whatever seasons have been loaded. `partial` is the
// honest flag: it is true when some seasons were never opened, and the count is
// therefore a floor rather than a total.
export function showProgress(seasons = [], loaded = {}, set) {
  let watched = 0, aired = 0, known = 0;
  for (const s of seasons) {
    const eps = loaded[s.season]?.episodes;
    if (!eps) continue;
    known++;
    const p = seasonProgress(eps, set);
    watched += p.watched;
    aired += p.aired;
  }
  return {
    watched,
    aired,
    seasonsKnown: known,
    seasonsTotal: seasons.length,
    partial: known < seasons.length,
    pct: aired ? (watched / aired) * 100 : null,
  };
}
