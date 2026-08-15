// Episode runtimes — how long you have ACTUALLY watched.
//
// The shelf reported "~59.6h estimated · no runtime for … +31". Half the number
// was a guess and the caveat admitted it. Two separate reasons, and only one of
// them is about missing data:
//
//   1. TV runtime came from TMDB's `episode_run_time[0]` — a single nominal
//      length for the whole series. Multiplying that by an episode count is a
//      fiction for anything with a double-length pilot, a 90-minute finale, or a
//      season that changed format. TMDB publishes a real runtime per episode.
//
//   2. Episodes watched was a number you typed. Nobody types it, so it stayed 0,
//      and a show marked "watching" contributed nothing at all.
//
// This module owns the arithmetic and nothing else — no fetching, no storage — so
// every rule below is testable without a network or a database.
//
// THE RULE THAT MATTERS: a runtime that had to be substituted is REPORTED as
// substituted. An hours figure that silently blends measured minutes with guessed
// ones is the same failure as the old estimate wearing better clothes.

const num = v => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

export function seasonKey(tmdbId, season) {
  return `${tmdbId}:${Number(season) || 1}`;
}

// Median rather than mean: one 90-minute finale should not drag the stand-in for
// twenty-two 22-minute episodes.
export function median(list = []) {
  const xs = list.map(num).filter(Boolean).sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = xs.length >> 1;
  return xs.length % 2 ? xs[mid] : Math.round((xs[mid - 1] + xs[mid]) / 2);
}

/**
 * Minutes for one episode, and where that number came from.
 *
 * `source` is not decoration. 'episode' means TMDB published a runtime for this
 * exact episode; 'season' and 'show' mean it was inferred; 'none' means we do not
 * know and the caller must not pretend otherwise by substituting a zero.
 */
export function episodeMinutes(seasons = {}, tmdbId, season, episode, showFallback = null) {
  const s = seasons[seasonKey(tmdbId, season)];
  const eps = s?.episodes || [];
  const hit = eps.find(e => Number(e.episode) === Number(episode));
  if (num(hit?.runtime)) return { minutes: num(hit.runtime), source: 'episode' };

  const med = median(eps.map(e => e.runtime));
  if (med) return { minutes: med, source: 'season' };

  const show = num(showFallback);
  if (show) return { minutes: show, source: 'show' };

  return { minutes: null, source: 'none' };
}

/**
 * Total minutes for a run of episodes, walking season boundaries.
 *
 * Counting from the start of the series rather than trusting a bare
 * `episodes_watched` number, because episode 30 of a show is not "30 × average" —
 * it is somewhere in season two, and which episodes those are is the whole point.
 */
export function minutesFor(seasons = {}, tmdbId, watched = 0, showFallback = null) {
  const total = Math.max(0, Math.floor(Number(watched) || 0));
  if (!total) return { minutes: 0, measured: 0, inferred: 0, unknown: 0, exact: true };

  // Season numbers in order, skipping specials (season 0) — a special is not part
  // of the run you are counting through.
  const order = Object.keys(seasons)
    .filter(k => k.startsWith(`${tmdbId}:`))
    .map(k => Number(k.split(':')[1]))
    .filter(n => n > 0)
    .sort((a, b) => a - b);

  let left = total, minutes = 0, measured = 0, inferred = 0, unknown = 0;

  for (const sn of order) {
    if (left <= 0) break;
    const eps = (seasons[seasonKey(tmdbId, sn)]?.episodes || [])
      .slice().sort((a, b) => Number(a.episode) - Number(b.episode));
    for (const e of eps) {
      if (left <= 0) break;
      const { minutes: m, source } = episodeMinutes(seasons, tmdbId, sn, e.episode, showFallback);
      if (m) { minutes += m; source === 'episode' ? measured++ : inferred++; }
      else unknown++;
      left--;
    }
  }

  // More episodes claimed than we hold season data for. Fill with the best
  // fallback we have and count them as inferred — never as measured, and never
  // silently dropped, which would make the total quietly too small.
  if (left > 0) {
    const fb = num(showFallback) || median(
      order.flatMap(sn => (seasons[seasonKey(tmdbId, sn)]?.episodes || []).map(e => e.runtime)),
    );
    if (fb) { minutes += fb * left; inferred += left; }
    else unknown += left;
    left = 0;
  }

  return { minutes, measured, inferred, unknown, exact: inferred === 0 && unknown === 0 };
}

/**
 * Where episode N of the whole series sits, as season + episode.
 *
 * The +1 button needs this: to fetch the runtime of the episode you just watched
 * it has to know which one that was, and "the 31st episode" is not an address
 * TMDB accepts.
 */
export function locate(seasons = {}, tmdbId, watched = 1) {
  let left = Math.max(1, Math.floor(Number(watched) || 1));
  const order = Object.keys(seasons)
    .filter(k => k.startsWith(`${tmdbId}:`))
    .map(k => Number(k.split(':')[1]))
    .filter(n => n > 0)
    .sort((a, b) => a - b);

  for (const sn of order) {
    const eps = (seasons[seasonKey(tmdbId, sn)]?.episodes || []).length;
    if (left <= eps) return { season: sn, episode: left };
    left -= eps;
  }
  return null;   // beyond what we know — the caller shows "season unknown"
}

// Which seasons we would need to fetch to describe `watched` episodes. Returned
// so a caller can fetch exactly those and no more: a 12-season show is 12 requests
// if you ask blindly and one if you ask for what you need.
export function missingSeasons(seasons = {}, tmdbId, watched = 0, totalSeasons = 0) {
  const need = [];
  let covered = 0;
  for (let sn = 1; sn <= Math.max(0, Number(totalSeasons) || 0); sn++) {
    const s = seasons[seasonKey(tmdbId, sn)];
    if (!s) { need.push(sn); }
    else { covered += (s.episodes || []).length; }
    if (covered >= watched && !need.length) break;
  }
  return need;
}

// A phrase the shelf can print without lying. The old tile said "estimated" for
// everything, which told you nothing about which half was which.
export function accuracyNote({ measured = 0, inferred = 0, unknown = 0 } = {}) {
  const known = measured + inferred;
  if (!known && !unknown) return 'nothing watched yet';
  if (!inferred && !unknown) return `${measured} episode${measured === 1 ? '' : 's'}, exact runtimes`;
  const parts = [];
  if (measured) parts.push(`${measured} exact`);
  if (inferred) parts.push(`${inferred} estimated`);
  if (unknown) parts.push(`${unknown} with no runtime at all`);
  return parts.join(' · ');
}

/**
 * Bring a title's measured minutes up to date.
 *
 * Dependencies are injected rather than imported so this is testable without a
 * network or a database — the same reason everything above it is pure. The
 * component supplies a fetcher and a saver; this decides WHAT to fetch, which is
 * the part with rules in it.
 *
 * Returns the meta patch to store. `minutes_measured` and `episodes_measured` are
 * the fields shelfStats already reads: it adds measured minutes as they are and
 * counts the remainder as unknown rather than filling it with an average. So
 * writing them is what turns "~59.6h estimated" into a number with a stated
 * margin.
 */
export async function syncMinutes({
  tmdbId, watched = 0, totalSeasons = 0, showFallback = null,
  cache = {}, fetchSeason, saveCache,
} = {}) {
  const id = Number(tmdbId);
  if (!id || watched <= 0) return null;

  const need = missingSeasons(cache, id, watched, totalSeasons || 1);
  let next = cache;

  if (need.length && typeof fetchSeason === 'function') {
    next = { ...cache };
    for (const sn of need) {
      try {
        const s = await fetchSeason(id, sn);
        if (s) next[seasonKey(id, sn)] = s;
      } catch {
        // One unreachable season must not lose the seasons that did arrive, and
        // must not stop the total being computed from them. The result simply
        // carries more inferred episodes, and says so.
      }
    }
    if (saveCache && next !== cache) { try { await saveCache(next); } catch { /* cache is an optimisation */ } }
  }

  const t = minutesFor(next, id, watched, showFallback);
  return {
    minutes_measured: t.minutes,
    // Only genuinely measured episodes are claimed as measured. Inferred ones are
    // deliberately left out of this count so shelfStats treats them as the gap
    // they are — the alternative is a total that looks exact and is not.
    episodes_measured: t.measured,
    runtime_note: accuracyNote(t),
  };
}
