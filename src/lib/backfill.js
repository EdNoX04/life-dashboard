// Filling in what Letterboxd does not publish.
//
// The import gives you titles, years, ratings and dates. It does not give you
// posters for anything read off the films list, and it never gives a runtime for
// anything at all — those simply are not in the RSS feed or the HTML. So the
// shelf came out correct and looked broken: 58 titles, blank artwork, and
// "TIME WATCHED ~0.0h · 58 films unmeasured".
//
// TMDB has both. What it does not have is any idea which "Michael" you meant, so
// the matching is the part that needs care: a wrong match writes the wrong
// poster and the wrong runtime onto a film you watched, and nothing about the
// result looks wrong afterwards.

export const num = v => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Titles differ in punctuation more than in words. "Your Name." and "Your Name",
// "Spider-Man" and "Spider Man", "WALL·E" and "WALL-E" are the same film to a
// person and different strings to a computer.
export function normTitle(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[’'`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export const YEAR_SLACK = 1;

/**
 * Choose the TMDB result that is actually this film — or nothing.
 *
 * Returning null is a real outcome and the important one. A backfill that always
 * picks something will, on an obscure Hindi title with no TMDB entry, attach the
 * poster of an unrelated film and a runtime to match, and you would never spot
 * it: the shelf would simply look complete.
 *
 * The rules, in order:
 *   1. Exact title AND a year within one. Release years disagree across regions
 *      by a year routinely, so exact-year-only would reject correct matches.
 *   2. Exact title, when neither side has a year to compare.
 *   3. Nothing. A near-title is not a match — "Vadh" and "Vadh 2" are different
 *      films, and prefix matching is exactly how you get the wrong one.
 *
 * Popularity breaks ties and is never a reason on its own.
 */
export function pickMatch(candidates = [], { title, year = null } = {}) {
  const want = normTitle(title);
  if (!want) return null;
  const y = num(year);

  const exact = candidates.filter(c => {
    const t = normTitle(c.title);
    // Original title too: Indian and Japanese films are often listed under one
    // and searched under the other.
    const ot = normTitle(c.original_title);
    return t === want || ot === want;
  });
  if (!exact.length) return null;

  if (y != null) {
    const close = exact.filter(c => c.year != null && Math.abs(c.year - y) <= YEAR_SLACK);
    if (close.length) {
      // Prefer the exact year over one that merely qualifies.
      const same = close.filter(c => c.year === y);
      return best(same.length ? same : close);
    }
    // Every candidate carries a year and none is near: this is a different film
    // with the same name, which is the case worth refusing.
    if (exact.every(c => c.year != null)) return null;
  }

  return best(exact);
}

function best(list) {
  return list.slice().sort((a, b) => (num(b.votes) ?? 0) - (num(a.votes) ?? 0))[0] || null;
}

/**
 * Which entries still need work, newest first.
 *
 * Newest first because a backfill over hundreds of titles takes several minutes
 * of polite requests, and if you stop halfway the half you got should be the
 * half you are most likely to look at.
 */
export function needsBackfill(log = []) {
  return log
    .filter(e => e.title && (!e.poster_url || e.runtime == null))
    .slice()
    .sort((a, b) => String(b.on || '').localeCompare(String(a.on || '')));
}

// One TMDB lookup covers every viewing of that film. Two viewings of Heat are
// one search, not two — and on a diary with rewatches that is a real saving
// against a rate limit.
export function backfillGroups(log = []) {
  const groups = new Map();
  for (const e of needsBackfill(log)) {
    const key = `${normTitle(e.title)}|${e.year ?? ''}`;
    if (!groups.has(key)) groups.set(key, { title: e.title, year: e.year ?? null, ids: [] });
    groups.get(key).ids.push(e.id);
  }
  return [...groups.values()];
}

/**
 * Apply a match to every viewing of that film.
 *
 * Only fills what is EMPTY. A poster you set by hand, or a runtime you typed
 * because TMDB had it wrong, survives — the backfill is here to fill gaps, not
 * to assert authority over fields you have already answered.
 */
export function applyMatch(log = [], ids = [], match = null) {
  if (!match) return log;
  const set = new Set(ids);
  return log.map(e => {
    if (!set.has(e.id)) return e;
    return {
      ...e,
      poster_url: e.poster_url || match.poster_url || null,
      runtime: e.runtime ?? match.runtime ?? null,
      tmdb_id: e.tmdb_id ?? match.tmdb_id ?? null,
      year: e.year ?? match.year ?? null,
    };
  });
}

// Marks a group as looked-up-and-not-found, so a second run does not spend the
// same requests failing the same way. Recorded on the entries themselves
// because there is nowhere else durable to put it.
export function markUnmatched(log = [], ids = []) {
  const set = new Set(ids);
  return log.map(e => (set.has(e.id) ? { ...e, tmdb_miss: true } : e));
}

export function pending(log = []) {
  return backfillGroups(log.filter(e => !e.tmdb_miss)).length;
}
