// TMDB, shaped for the preview sheet.
//
// Batch 2 covers two asks that look separate and are one API: a preview before
// you add something (synopsis, cast, ratings, runtime) and where you can
// actually watch it, by country, so a VPN decision has something behind it.
//
// The fetching is thin. What is worth writing down is what the data does NOT
// say, because a preview screen that presents everything with equal confidence
// is the failure mode here:
//
//   THE RATING IS TMDB'S, NOT IMDB'S. TMDB carries its own community score and
//   nothing else. IMDb and Rotten Tomatoes are not in this API at any tier, and
//   labelling a 7.4 as "rating" invites you to read it as the IMDb number you
//   know. It is labelled as TMDB's throughout, with the vote count beside it,
//   because a 9.1 from 40 people is a different object from a 7.4 from 40,000.
//
//   AVAILABILITY IS JUSTWATCH'S, AND IT IS DATED. TMDB resells JustWatch's
//   catalogue. It moves weekly - titles leave Netflix with no notice - so every
//   provider answer carries the date it was fetched. A stale "on Netflix" is
//   worse than no answer, because you plan an evening around it.
//
//   A MISSING REGION IS NOT "UNAVAILABLE". TMDB returns nothing for a country it
//   has no data on, which is indistinguishable in the payload from a country
//   where the title genuinely is not streaming. Both are reported as unknown.

export const IMG = 'https://image.tmdb.org/t/p';
export const BASE = 'https://api.themoviedb.org/3';

export const num = v => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export const poster = (path, size = 'w185') => (path ? `${IMG}/${size}${path}` : null);

// Country codes to names without shipping a table. Intl.DisplayNames is in every
// browser this app targets and in Node; the code itself is the fallback, which
// is ugly but never wrong.
export function countryName(code) {
  const c = String(code || '').toUpperCase();
  if (!c) return '';
  try {
    const n = new Intl.DisplayNames(['en'], { type: 'region' }).of(c);
    // Intl answers "Unknown Region" for a code it does not carry, which tells a
    // reader strictly less than the code does. The code is at least googleable.
    if (!n || /unknown/i.test(n)) return c;
    return n;
  } catch {
    return c;
  }
}

// ------------------------------------------------------------------ details

export function detailPath(kind, id) {
  const t = String(kind) === 'movie' ? 'movie' : 'tv';
  return `${BASE}/${t}/${id}`;
}

/**
 * One title, folded into the shape the preview sheet renders.
 *
 * `append_to_response=credits,watch/providers,external_ids` means this is a
 * SINGLE request rather than four. That matters: TMDB's limit is generous but
 * the sheet opens on every search result you tap, and four calls per tap turns
 * browsing into rate-limiting.
 */
export function normaliseDetail(j = {}, kind = 'movie') {
  if (!j || (!j.id && !j.title && !j.name)) return null;
  const isTv = String(kind) === 'tv' || !!j.first_air_date || !!j.number_of_seasons;
  const date = j.release_date || j.first_air_date || '';
  const runtime = isTv
    // TV runtime is an ARRAY of episode lengths, and it is often empty or holds
    // several values for a show that changed format. The first is the usual
    // case; last_episode_to_air is the better answer when it exists.
    ? num(j.episode_run_time?.[0]) ?? num(j.last_episode_to_air?.runtime)
    : num(j.runtime);

  return {
    tmdb_id: j.id ?? null,
    kind: isTv ? 'tv' : 'movie',
    title: j.title || j.name || '',
    original_title: j.original_title || j.original_name || null,
    year: /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : null,
    released: date || null,
    tagline: (j.tagline || '').trim() || null,
    overview: (j.overview || '').trim() || null,
    poster_url: poster(j.poster_path, 'w342'),
    backdrop_url: poster(j.backdrop_path, 'w780'),
    genres: (j.genres || []).map(g => g.name).filter(Boolean),
    runtime,
    seasons: isTv ? num(j.number_of_seasons) : null,
    episodes: isTv ? num(j.number_of_episodes) : null,
    status: j.status || null,
    // Deliberately named for its source. See the header.
    tmdb_score: num(j.vote_average),
    tmdb_votes: num(j.vote_count),
    imdb_id: j.external_ids?.imdb_id || j.imdb_id || null,
    countries: (j.origin_country || (j.production_countries || []).map(c => c.iso_3166_1)).filter(Boolean),
    languages: (j.spoken_languages || []).map(l => l.english_name || l.name).filter(Boolean),
    cast: normaliseCast(j.credits),
    crew: normaliseCrew(j.credits, isTv),
    providers: normaliseProviders(j['watch/providers']),
  };
}

export function normaliseCast(credits = {}, limit = 12) {
  return (credits?.cast || [])
    .filter(c => c && c.name)
    .slice(0, limit)
    .map(c => ({
      id: c.id ?? null,
      name: c.name,
      // "as Vincent Hanna" is the useful half of a cast list. A name with no
      // character attached is a name you cannot place.
      character: (c.character || '').split('/')[0].trim() || null,
      photo: poster(c.profile_path, 'w185'),
    }));
}

// Who made it. Director for a film, creator for a series — asking for a
// "director" of a twelve-season sitcom returns whoever happened to direct the
// pilot, which is not the answer anyone wants.
export function normaliseCrew(credits = {}, isTv = false) {
  const crew = credits?.crew || [];
  const pick = jobs => crew.filter(c => jobs.includes(c.job)).map(c => c.name);
  const directors = isTv ? [] : [...new Set(pick(['Director']))];
  const writers = [...new Set(pick(['Screenplay', 'Writer', 'Story']))].slice(0, 3);
  return { directors, writers };
}

// --------------------------------------------------------------- providers

// The four ways to watch, kept apart. "It is on Netflix" and "you can rent it
// for four dollars" are different answers to the same question, and a screen
// that merges them will send you to a paywall you did not expect.
export const OFFER_TYPES = [
  { key: 'flatrate', label: 'Streaming', note: 'included with a subscription' },
  { key: 'free', label: 'Free', note: 'no subscription needed' },
  { key: 'ads', label: 'Free with ads', note: 'ad-supported' },
  { key: 'rent', label: 'Rent', note: 'pay per view' },
  { key: 'buy', label: 'Buy', note: 'purchase' },
];

export function normaliseProviders(block = {}) {
  const results = block?.results || {};
  const out = {};
  for (const [code, region] of Object.entries(results)) {
    const offers = {};
    for (const t of OFFER_TYPES) {
      const list = (region?.[t.key] || []).map(p => ({
        id: p.provider_id ?? null,
        name: p.provider_name,
        logo: poster(p.logo_path, 'w92'),
      })).filter(p => p.name);
      if (list.length) offers[t.key] = list;
    }
    if (Object.keys(offers).length) out[code] = { link: region?.link || null, offers };
  }
  return out;
}

/**
 * What is available in one country.
 *
 * Returns null rather than an empty object when the country is absent, because
 * TMDB not carrying a region and a title not streaming there produce the same
 * payload, and the screen has to say "no data" rather than "not available".
 */
export function providersIn(providers = {}, code = 'IN') {
  const r = providers?.[String(code).toUpperCase()];
  if (!r) return null;
  return r;
}

/**
 * Countries where this is included with a subscription — the VPN question.
 *
 * Only `flatrate` and `free` count. A title you can rent in twelve countries is
 * rentable at home too, so listing those as "watch it abroad" would be noise
 * around the one thing being asked: where does an existing subscription already
 * cover it.
 *
 * Grouped BY PROVIDER rather than by country, because the decision is "I have
 * Netflix — where does Netflix carry it", not "tell me about Portugal".
 */
export function streamingCountries(providers = {}, { exclude = 'IN', limit = 8 } = {}) {
  const byProvider = new Map();
  const skip = String(exclude || '').toUpperCase();
  for (const [code, region] of Object.entries(providers || {})) {
    if (code.toUpperCase() === skip) continue;
    const list = [...(region.offers.flatrate || []), ...(region.offers.free || [])];
    for (const p of list) {
      if (!byProvider.has(p.name)) byProvider.set(p.name, { name: p.name, logo: p.logo, countries: [] });
      byProvider.get(p.name).countries.push(code.toUpperCase());
    }
  }
  return [...byProvider.values()]
    .map(p => ({ ...p, countries: [...new Set(p.countries)].sort() }))
    // The provider carried in the most places first: that is the one a VPN is
    // most likely to reach and the one you most likely already pay for.
    .sort((a, b) => b.countries.length - a.countries.length || a.name.localeCompare(b.name))
    .slice(0, limit);
}

// How old the availability answer is. Anything past a week is called out on
// screen rather than shown as though it were live.
export const PROVIDER_STALE_DAYS = 7;

export function providerAge(fetchedAt, now = Date.now()) {
  const t = Date.parse(fetchedAt || '');
  if (!Number.isFinite(t)) return null;
  const days = (now - t) / 864e5;
  return { days, stale: days > PROVIDER_STALE_DAYS };
}

// ------------------------------------------------------------------ fetch

export async function fetchDetail(kind, id, key, { signal } = {}) {
  if (!key) throw new Error('NO_KEY');
  const url = `${detailPath(kind, id)}?api_key=${key}&append_to_response=credits,watch/providers,external_ids`;
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`TMDB ${r.status}`);
  const j = await r.json();
  const d = normaliseDetail(j, kind);
  if (!d) throw new Error('empty');
  return { ...d, fetched_at: new Date().toISOString() };
}

// Trending, for batch 4's poster rail — defined here so every TMDB shape lives
// in one file rather than being reinvented per screen.
export async function fetchTrending(kind = 'all', key, { window = 'week', signal } = {}) {
  if (!key) throw new Error('NO_KEY');
  const r = await fetch(`${BASE}/trending/${kind}/${window}?api_key=${key}`, { signal });
  if (!r.ok) throw new Error(`TMDB ${r.status}`);
  const j = await r.json();
  return j.results || [];
}

// ---------------------------------------------------------------- discovery

// The rails on the discovery screen. Trending first because it is the one that
// answers "what is everyone watching right now" — the question that sends you
// to a search box in the first place.
//
// Anime gets its own rail rather than being left inside popular TV, where it
// never surfaces: TMDB's popularity is global and anime loses to English-language
// drama on volume alone. `with_original_language=ja` + the animation genre is
// the same test guessKind uses, kept identical on purpose so a title cannot be
// discovered as anime here and filed as plain TV on the shelf.
export const RAILS = [
  { key: 'trending', label: 'TRENDING', path: '/trending/all/week', note: 'what everyone is watching this week' },
  { key: 'movies', label: 'FILMS', path: '/movie/popular', note: 'popular films right now' },
  { key: 'tv', label: 'SERIES', path: '/tv/popular', note: 'popular series right now' },
  { key: 'anime', label: 'ANIME', path: '/discover/tv?with_original_language=ja&with_genres=16&sort_by=popularity.desc', note: 'Japanese animation, by popularity' },
  { key: 'india', label: 'INDIA', path: '/discover/movie?with_original_language=hi&sort_by=popularity.desc&vote_count.gte=20', note: 'Hindi-language films' },
];

export const railOf = key => RAILS.find(r => r.key === key) || RAILS[0];

export async function fetchRail(key, apiKey, { signal } = {}) {
  if (!apiKey) throw new Error('NO_KEY');
  const rail = railOf(key);
  const sep = rail.path.includes('?') ? '&' : '?';
  const r = await fetch(`${BASE}${rail.path}${sep}api_key=${apiKey}`, { signal });
  if (!r.ok) throw new Error(`TMDB ${r.status}`);
  const j = await r.json();
  return (j.results || []).map(x => normaliseCard(x, rail.key)).filter(Boolean);
}

// A rail card is a poster, a title and enough to open the preview — not a full
// detail. Fetching details for forty posters to draw forty thumbnails would
// spend the rate limit on cards nobody taps.
export function normaliseCard(r = {}, railKey = 'trending') {
  if (!r || r.media_type === 'person') return null;
  const title = r.title || r.name;
  if (!title) return null;
  // The rail knows what it asked for; media_type is only present on /trending.
  const isTv = r.media_type === 'tv'
    || (!r.media_type && (railKey === 'tv' || railKey === 'anime'))
    || (!r.media_type && !!r.first_air_date);
  const date = r.release_date || r.first_air_date || '';
  return {
    tmdb_id: r.id ?? null,
    title,
    kind: isTv ? 'tv' : 'movie',
    year: /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : null,
    poster_url: poster(r.poster_path, 'w342'),
    overview: (r.overview || '').trim() || null,
    tmdb_score: num(r.vote_average),
    tmdb_votes: num(r.vote_count),
    // Carried so the shelf can file it correctly the moment it is added, rather
    // than guessing from the title alone.
    languages: r.original_language ? [r.original_language] : [],
    countries: r.origin_country || [],
    genre_ids: r.genre_ids || [],
  };
}

// TMDB genre 16 is Animation. Kept as a named constant because the number
// appears in the anime rail's query and in the kind guess, and a bare 16 in two
// places is two places to get it wrong.
export const GENRE_ANIMATION = 16;
