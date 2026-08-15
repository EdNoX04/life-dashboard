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

// ------------------------------------------------------------------ auth

// TMDB hands out TWO credentials from the same settings page and they are not
// interchangeable:
//
//   API KEY (v3)          — 32 hex characters, sent as ?api_key=…
//   READ ACCESS TOKEN (v4) — a ~230-character JWT, sent as
//                            Authorization: Bearer …
//
// Nothing on that page says the second one will not work in the first one's
// place, and it is the more prominent of the two. Passed as api_key it comes
// back 401 with no hint as to why — which is exactly how the Discover rail
// arrived: "TMDB refused: TMDB 401", key present, key wrong shape.
//
// So rather than require a particular one, detect which is which. A JWT starts
// with "eyJ" because that is the base64 of {"alg" — a stable enough marker that
// every TMDB client uses it.
export const isBearer = key => String(key || '').trim().startsWith('eyJ');

/**
 * Turn a URL and a credential into the fetch arguments TMDB expects.
 *
 * Returned as a pair rather than mutating the URL because the two credentials
 * travel in different places — one in the query string, one in a header — and a
 * caller that only knows about the query string cannot support both.
 */
export function tmdbReq(url, key, init = {}) {
  const k = String(key || '').trim();
  if (!k) throw new Error('NO_KEY');
  if (isBearer(k)) {
    return [url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${k}`, accept: 'application/json' } }];
  }
  const sep = url.includes('?') ? '&' : '?';
  return [`${url}${sep}api_key=${encodeURIComponent(k)}`, init];
}

// One place that actually performs the call, so no screen has to remember which
// credential it is holding.
export async function tmdbFetch(url, key, init = {}) {
  const [u, opts] = tmdbReq(url, key, init);
  const r = await fetch(u, opts);
  if (!r.ok) {
    // 401 on a v3 key that looks like a token is the single most likely
    // misconfiguration, and "TMDB 401" tells you nothing about how to fix it.
    if (r.status === 401) {
      throw new Error(isBearer(key)
        ? 'TMDB 401 — the read access token was rejected. Check it is copied whole.'
        : 'TMDB 401 — that key was rejected. TMDB gives you an "API Key" (32 characters) and a "Read Access Token" (long, starts with eyJ); either works here, but a truncated one does not.');
    }
    throw new Error(`TMDB ${r.status}`);
  }
  return r.json();
}

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
  const url = `${detailPath(kind, id)}?append_to_response=credits,watch/providers,external_ids`;
  const j = await tmdbFetch(url, key, { signal });
  const d = normaliseDetail(j, kind);
  if (!d) throw new Error('empty');
  return { ...d, fetched_at: new Date().toISOString() };
}

// Trending, for batch 4's poster rail — defined here so every TMDB shape lives
// in one file rather than being reinvented per screen.
export async function fetchTrending(kind = 'all', key, { window = 'week', signal } = {}) {
  const j = await tmdbFetch(`${BASE}/trending/${kind}/${window}`, key, { signal });
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
  const rail = railOf(key);
  const j = await tmdbFetch(`${BASE}${rail.path}`, apiKey, { signal });
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


// Search and season lookups, so no component builds a TMDB URL by hand and
// re-invents the credential question.
export async function searchTmdb(term, key, { signal } = {}) {
  const j = await tmdbFetch(`${BASE}/search/multi?query=${encodeURIComponent(term)}`, key, { signal });
  return j.results || [];
}

export async function fetchSeason(tvId, season, key, { signal } = {}) {
  return tmdbFetch(`${BASE}/tv/${tvId}/season/${season}`, key, { signal });
}

export async function fetchRaw(kind, id, key, { signal } = {}) {
  return tmdbFetch(detailPath(kind, id), key, { signal });
}

// ---- one season, with a real runtime per episode ----
// The show detail endpoint gives episode_run_time — a single nominal length for
// the whole series — which is why the shelf's hours figure was a guess. The season
// endpoint publishes each episode's own runtime, and that is the number that makes
// "how long have I watched" answerable rather than estimable.
export async function fetchSeasonRuntimes(tmdbId, season, key, { signal } = {}) {
  const j = await fetchSeason(tmdbId, Number(season) || 1, key, { signal });
  return normaliseSeason(j, tmdbId, season);
}

export function normaliseSeason(j = {}, tmdbId, season) {
  return {
    tmdb_id: Number(tmdbId),
    season: Number(season) || 1,
    name: j.name || `Season ${season}`,
    // runtime is left NULL when TMDB has none. A zero here would be indis-
    // tinguishable from a genuinely zero-length episode and would silently drag
    // every average that touches it.
    episodes: (j.episodes || []).map(e => ({
      episode: num(e.episode_number),
      name: e.name || '',
      runtime: num(e.runtime),
      air_date: e.air_date || null,
    })).filter(e => e.episode != null),
    fetched: new Date().toISOString(),
  };
}
