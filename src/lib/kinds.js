// What kind of thing is this, and how do you track it?
//
// The shelf had two kinds: movie and tv. That was enough when the only question
// was "watched or not", and it stops being enough the moment you track episodes,
// because the four things on this shelf behave completely differently:
//
//   A FILM is one sitting. Done or not done.
//   A DRAMA you watch through once, in order, and finishing matters.
//   A SITCOM you dip into. Nobody watches Modern Family in order, "next episode"
//     is not a meaningful concept, and progress toward 250 episodes is not a
//     goal anyone has. Season-and-episode is a LOCATION, not a percentage.
//   ANIME has seasons that are really separate shows, cours that split a season
//     in half, and numbering that restarts or doesn't depending on the licensor.
//
// Collapsing sitcoms and anime into "tv" is what makes a tracker feel wrong
// without being obviously broken: it shows you 37/250 and a progress bar for a
// show you are not trying to complete.
//
// So `kind` is widened, and each kind carries how it should be COUNTED. Nothing
// here changes the `movies` table — a sitcom is still type 'tv' on the row, with
// the finer kind living in media_meta, per the zero-migration rule.

export const KINDS = [
  {
    key: 'movie',
    label: 'FILM',
    type: 'movie',
    icon: '▶',
    color: 'var(--pink)',
    episodic: false,
    // A film's progress is binary, so a bar would only ever read 0 or 100.
    progress: 'binary',
  },
  {
    key: 'tv',
    label: 'SERIES',
    type: 'tv',
    icon: '📺',
    color: 'var(--cyan)',
    episodic: true,
    // Watched in order, finishing is the point: a bar is the right readout.
    progress: 'completion',
  },
  {
    key: 'anime',
    label: 'ANIME',
    type: 'tv',
    icon: '⛩',
    color: 'var(--purple)',
    episodic: true,
    progress: 'completion',
    // Seasons are frequently separate entries on TMDB rather than seasons of
    // one entry, so a season number here means less than it does for a drama.
    seasonsAreLoose: true,
  },
  {
    key: 'sitcom',
    label: 'SITCOM',
    type: 'tv',
    icon: '🎭',
    color: 'var(--yellow)',
    episodic: true,
    // The important one. See the header: a sitcom is a place you visit, not a
    // thing you complete, and a completion bar misreads the entire relationship.
    progress: 'position',
  },
];

export const kindOf = key => KINDS.find(k => k.key === String(key || '').toLowerCase())
  || KINDS.find(k => k.key === (String(key) === 'tv' ? 'tv' : 'movie'));

export const isEpisodic = key => !!kindOf(key)?.episodic;

// Sitcoms TMDB will not tell you about. It has no "sitcom" genre — it has
// "Comedy", which also covers everything from Fleabag to a stand-up special.
// Rather than guess from genre alone, a title is offered AS a sitcom and you
// confirm; this list only pre-selects the suggestion so the common cases need no
// thought. Both the American and Indian ones asked for are here.
export const SITCOM_HINTS = [
  'modern family', 'the office', 'friends', 'seinfeld',
  'brooklyn nine-nine', 'parks and recreation', 'how i met your mother',
  'the big bang theory', 'arrested development', 'community', 'frasier',
  'cheers', 'scrubs', 'new girl', 'the good place', 'ted lasso', 'abbott elementary',
  // Indian
  'sarabhai vs sarabhai', 'taarak mehta ka ooltah chashmah', 'khichdi',
  'office office', 'f.i.r.', 'bhabiji ghar par hain', 'the great indian kapil show',
  'permanent roommates', 'tvf pitchers', 'gullak', 'panchayat', 'kota factory',
  'yeh meri family', 'flames', 'hostel daze',
];

// Guessing the kind from what TMDB returns, as a STARTING POINT only — the user
// can always override, and the suggestion is shown as a suggestion.
//
// House is deliberately in the sitcom hint list and is a medical drama, which
// looks like a mistake and is not: it was named as one of the shows to track
// this way, and how you WATCH something is a fact about you, not about its
// genre. The hint list is about tracking style.
export function guessKind({ title = '', type = 'movie', genres = [], countries = [], languages = [] } = {}) {
  if (String(type) === 'movie') return 'movie';
  const t = String(title).toLowerCase().trim();
  const g = genres.map(x => String(x).toLowerCase());

  const isAnimation = g.includes('animation');
  const jp = countries.map(c => String(c).toUpperCase()).includes('JP')
    || languages.some(l => /japanese/i.test(String(l)));
  // Animation ALONE is not anime — that would file Bluey and Rick and Morty as
  // anime. Japanese origin is the part that carries the meaning.
  if (isAnimation && jp) return 'anime';

  // Genres decide when we have them. TMDB has no "sitcom" genre, but a comedy
  // series that is not also a drama is the closest honest reading, and it is
  // per-title truth rather than a guess from a name.
  if (g.length) {
    if (g.includes('comedy') && !g.includes('drama')) return 'sitcom';
    return 'tv';
  }

  // Only with no genres at all does the hint list get a say. It is a list of
  // names, so it cannot know about a show it has never heard of and it mislabels
  // anything sharing a title — which is precisely how a medical drama called
  // "House" ended up badged SITCOM.
  if (SITCOM_HINTS.some(h => t === h || t.startsWith(`${h}:`) || t.startsWith(`${h} `))) return 'sitcom';

  return 'tv';
}

/**
 * How far through, in the terms that kind deserves.
 *
 * A sitcom returns `pct: null` on purpose. There is no honest completion figure
 * for a show you dip into, and drawing a bar at 15% implies a goal you never
 * set. It reports WHERE you are instead — the last episode you logged — which is
 * the thing you actually need when you sit down.
 */
export function progressFor(kind, { watched = 0, total = null, lastSeason = null, lastEpisode = null } = {}) {
  const k = kindOf(kind);
  if (k.progress === 'binary') {
    return { style: 'binary', done: watched > 0, pct: watched > 0 ? 100 : 0, text: watched > 0 ? 'watched' : 'not yet' };
  }
  if (k.progress === 'position') {
    const at = lastSeason != null
      ? `S${String(lastSeason).padStart(2, '0')}${lastEpisode != null ? `E${String(lastEpisode).padStart(2, '0')}` : ''}`
      : null;
    return {
      style: 'position',
      done: false,
      pct: null,
      // The count is still true and still worth showing — it just is not a
      // fraction of a target.
      text: at ? `last at ${at}` : `${watched} episode${watched === 1 ? '' : 's'} logged`,
      watched,
    };
  }
  if (total == null || !(total > 0)) {
    return { style: 'completion', done: false, pct: null, text: `${watched} episode${watched === 1 ? '' : 's'} · total unknown`, watched };
  }
  const w = Math.min(watched, total);
  return { style: 'completion', done: w >= total, pct: (w / total) * 100, text: `${w}/${total}`, watched: w, total };
}
