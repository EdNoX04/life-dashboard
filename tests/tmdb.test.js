// The preview sheet's data layer — batch 2.
//
// Most of this file is about what the data does NOT say. A preview screen that
// renders every field with equal confidence is the failure mode here: a TMDB
// community score looks exactly like an IMDb score, and a JustWatch listing
// three weeks stale looks exactly like a live one. Both are quoted sources with
// their own limits, and the tests pin the places where the code has to keep
// those limits attached to the value.
//
// The one that would actually cost you an evening: TMDB returns nothing for a
// country it has no data on, and nothing for a country where a title genuinely
// is not streaming. Those must not collapse into "not available".

import {
  normaliseDetail, normaliseCast, normaliseCrew, normaliseProviders,
  providersIn, streamingCountries, providerAge, countryName, poster,
  PROVIDER_STALE_DAYS,
} from '../src/lib/tmdb.js';

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; } else { fail++; console.log('FAIL ' + name); } };
const eq = (a, b, name) => ok(a === b, `${name} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

// ------------------------------------------------------------------ images

eq(poster('/abc.jpg'), 'https://image.tmdb.org/t/p/w185/abc.jpg', 'a poster path becomes a URL');
eq(poster(null), null, 'a missing path is null, not a broken image');
eq(poster(''), null, 'and so is an empty one');

// ----------------------------------------------------------------- details

const MOVIE = {
  id: 949, title: 'Heat', release_date: '1995-12-15', runtime: 170,
  tagline: 'A Los Angeles crime saga', overview: 'Obsessive master thief…',
  vote_average: 7.9, vote_count: 8123, status: 'Released',
  genres: [{ name: 'Action' }, { name: 'Crime' }],
  poster_path: '/p.jpg', backdrop_path: '/b.jpg',
  production_countries: [{ iso_3166_1: 'US' }],
  spoken_languages: [{ english_name: 'English' }],
  credits: {
    cast: [{ id: 1, name: 'Al Pacino', character: 'Vincent Hanna / Lt.', profile_path: '/a.jpg' }],
    crew: [{ job: 'Director', name: 'Michael Mann' }, { job: 'Screenplay', name: 'Michael Mann' }],
  },
};

const m = normaliseDetail(MOVIE, 'movie');
eq(m.kind, 'movie', 'a film is a film');
eq(m.year, 1995, 'the year comes off the release date');
eq(m.runtime, 170, 'runtime is a plain number for a film');
eq(m.tmdb_score, 7.9, 'the score is carried');
eq(m.tmdb_votes, 8123, 'and so is the vote count — the two are only useful together');
eq(m.genres.join(','), 'Action,Crime', 'genres are names, not ids');
eq(m.crew.directors.join(','), 'Michael Mann', 'the director is picked out');
eq(m.cast[0].character, 'Vincent Hanna', 'a slashed character list keeps the first name only');

// A series carries its runtime as an ARRAY of episode lengths, which is the
// shape most likely to be mishandled — `runtime` is simply absent on TV.
const TV = {
  id: 1408, name: 'House', first_air_date: '2004-11-16',
  episode_run_time: [44], number_of_seasons: 8, number_of_episodes: 177,
  overview: 'A medical genius…', vote_average: 8.6, vote_count: 4000,
  credits: { cast: [], crew: [{ job: 'Director', name: 'Whoever Did The Pilot' }] },
};
const t = normaliseDetail(TV, 'tv');
eq(t.kind, 'tv', 'a series is a series');
eq(t.runtime, 44, 'episode length is read out of the array');
eq(t.seasons, 8, 'seasons are counted');
eq(t.episodes, 177, 'and episodes');
eq(t.crew.directors.length, 0,
  'a series has NO director — asking returns whoever directed the pilot, which answers nothing');

// Kind is inferred when the caller does not say, because /search/multi rows
// often arrive without media_type.
eq(normaliseDetail(TV).kind, 'tv', 'a first_air_date is enough to know it is a series');
eq(normaliseDetail({ id: 1, title: 'X' }).kind, 'movie', 'and its absence means a film');
eq(normaliseDetail({}), null, 'an empty payload is not a title');
eq(normaliseDetail(null), null, 'and neither is nothing');

// A film with no date at all is usually announced-but-unmade. It must not
// produce a year of 0 or NaN.
eq(normaliseDetail({ id: 2, title: 'Untitled', release_date: '' }).year, null,
  'no release date means no year, not year zero');

eq(normaliseCast({ cast: [{ name: 'A' }, { name: 'B' }] }, 1).length, 1, 'the cast list is capped');
eq(normaliseCast({}).length, 0, 'no credits is an empty cast, not a crash');
eq(normaliseCrew({}).directors.length, 0, 'and no crew is no directors');

// --------------------------------------------------------------- providers

const RAW = {
  results: {
    IN: {
      link: 'https://x',
      flatrate: [{ provider_id: 8, provider_name: 'Netflix', logo_path: '/n.jpg' }],
      rent: [{ provider_id: 2, provider_name: 'Apple TV' }],
    },
    US: { flatrate: [{ provider_id: 9, provider_name: 'Prime Video' }] },
    GB: { flatrate: [{ provider_id: 8, provider_name: 'Netflix' }] },
    DE: { flatrate: [{ provider_id: 8, provider_name: 'Netflix' }] },
    // Rent-only abroad. Kept by normaliseProviders - "rentable in France" is
    // true - but it must not survive into the VPN answer further down.
    FR: { rent: [{ provider_id: 2, provider_name: 'Apple TV' }] },
    // A region TMDB lists with no offers at all — must not survive as an empty
    // entry that reads on screen as "available".
    JP: {},
  },
};

const P = normaliseProviders(RAW);
eq(Object.keys(P).sort().join(','), 'DE,FR,GB,IN,US', 'regions with no offers at all are dropped');
ok(!P.JP, 'a region TMDB lists with an empty offer set does not survive as "available"');
eq(P.IN.offers.flatrate[0].name, 'Netflix', 'subscription offers are kept');
eq(P.IN.offers.rent[0].name, 'Apple TV', 'and rentals separately — they are different answers');
eq(P.FR.offers.rent[0].name, 'Apple TV', 'a rent-only region is kept — it is a true fact about France');
ok(!P.FR.offers.flatrate, 'but it carries no subscription offer, which is what the VPN answer reads');

// The distinction that keeps "unknown" from becoming "unavailable".
eq(providersIn(P, 'IN').offers.flatrate.length, 1, 'the home region resolves');
eq(providersIn(P, 'BR'), null,
  'an absent region returns null — the screen says "no data", never "not available"');
eq(providersIn({}, 'IN'), null, 'no provider block at all is also unknown');

// The VPN question: grouped by provider, home excluded, rentals excluded.
const ab = streamingCountries(P, { exclude: 'IN' });
eq(ab.length, 2, 'two providers carry it abroad');
eq(ab[0].name, 'Netflix', 'the one in the most regions is listed first — most likely reachable');
eq(ab[0].countries.join(','), 'DE,GB', 'with the countries it covers');
ok(!ab.some(p => p.name === 'Apple TV'),
  'the rent-only French listing is excluded: anything rentable abroad is rentable at home');
ok(!ab.some(p => p.countries.includes('IN')), 'and home is never listed as somewhere abroad');
eq(streamingCountries({}, { exclude: 'IN' }).length, 0, 'no data, no suggestions');

// ------------------------------------------------------------------- age

const NOW = Date.parse('2026-08-10T00:00:00Z');
eq(providerAge('2026-08-09T00:00:00Z', NOW).stale, false, 'yesterday is fresh');
eq(providerAge('2026-07-01T00:00:00Z', NOW).stale, true,
  `past ${PROVIDER_STALE_DAYS} days it is called stale, because titles leave services without notice`);
eq(providerAge(null, NOW), null, 'an unknown fetch time is unknown, not fresh');
eq(providerAge('not a date', NOW), null, 'and so is an unparseable one');

// ---------------------------------------------------------------- regions

eq(countryName('IN'), 'India', 'codes become names');
eq(countryName('in'), 'India', 'case-insensitively');
eq(countryName(''), '', 'an empty code is empty');
eq(countryName('ZZ'), 'ZZ', 'and an unknown code falls back to itself rather than blanking');

// --------------------------------------------------- discovery rails (batch 4)

// The poster wall exists because search assumes you already know what you want,
// and most of the time you do not. Two things it must get right:
//
//   Anime and Hindi films need their OWN rails. TMDB popularity is global, so
//   both lose to English-language drama on volume and effectively never appear
//   in a "popular" list — a rail each is the only way they surface at all.
//   A rail card must know its KIND. /trending returns media_type; /tv/popular
//   does not, and a series filed as a film gets no episode grid.

import { RAILS, railOf, normaliseCard, GENRE_ANIMATION } from '../src/lib/tmdb.js';

ok(RAILS.some(r => r.key === 'anime'), 'anime has its own rail');
ok(RAILS.some(r => r.key === 'india'), 'and Hindi films do too');
ok(railOf('anime').path.includes('with_original_language=ja'),
  'the anime rail asks for Japanese originals');
ok(railOf('anime').path.includes(`with_genres=${GENRE_ANIMATION}`),
  'and for animation — the same two-part test the shelf uses to file it');
ok(railOf('india').path.includes('vote_count.gte='),
  'the India rail requires a minimum vote count, or it fills with unreleased noise');
eq(railOf('nonsense').key, 'trending', 'an unknown rail falls back rather than throwing');

// /trending says what each row is.
eq(normaliseCard({ id: 1, name: 'House', media_type: 'tv' }, 'trending').kind, 'tv',
  'trending rows carry their own media_type');
eq(normaliseCard({ id: 2, title: 'Heat', media_type: 'movie' }, 'trending').kind, 'movie',
  'in both directions');
eq(normaliseCard({ id: 3, name: 'Person', media_type: 'person' }, 'trending'), null,
  'people are not titles and are dropped');

// /tv/popular does NOT. The rail is then the only thing that knows.
eq(normaliseCard({ id: 4, name: 'Some Series', first_air_date: '2024-01-01' }, 'tv').kind, 'tv',
  'a popular-TV row is a series even with no media_type');
eq(normaliseCard({ id: 5, name: 'Some Anime' }, 'anime').kind, 'tv',
  'and so is an anime row with no dates at all — the rail knows what it asked for');
eq(normaliseCard({ id: 6, title: 'Some Film' }, 'movies').kind, 'movie',
  'while the films rail yields films');

const card = normaliseCard({
  id: 7, title: 'Dhurandhar', release_date: '2025-12-05', vote_average: 7.2, vote_count: 340,
  original_language: 'hi', genre_ids: [28], poster_path: '/d.jpg',
}, 'india');
eq(card.year, 2025, 'the year is read');
eq(card.tmdb_score, 7.2, 'the score comes across');
eq(card.languages.join(''), 'hi', 'and the language, so the shelf can file it without guessing again');
ok(card.poster_url.includes('w342'), 'posters come at grid size, not thumbnail size');
eq(normaliseCard({}, 'trending'), null, 'an empty row is not a card');
eq(normaliseCard({ id: 8 }, 'trending'), null, 'and neither is one with no title');

// ------------------------------------------------------ two credentials, one API

// The Discover rail came back "TMDB refused: TMDB 401" with a key present and
// non-empty. The cause: TMDB's settings page hands out TWO credentials and the
// more prominent one does not work where the other does.
//
//   API Key (v3)           32 hex chars   ?api_key=…
//   Read Access Token (v4) ~230-char JWT  Authorization: Bearer …
//
// Nothing warns you, and a token sent as api_key returns a bare 401. Rather than
// demand a particular one, both are detected and routed correctly.

import { isBearer, tmdbReq } from '../src/lib/tmdb.js';

const V3 = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
const V4 = 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiIxMjMifQ.signature';

eq(isBearer(V4), true, 'a JWT is recognised — it starts eyJ, the base64 of {"alg');
eq(isBearer(V3), false, 'a 32-char hex key is not');
eq(isBearer(''), false, 'and neither is nothing');
eq(isBearer('  eyJabc'), true, 'leading whitespace from a paste does not fool it');

const [u3, o3] = tmdbReq('https://api.themoviedb.org/3/movie/949', V3);
ok(u3.includes(`api_key=${V3}`), 'a v3 key goes in the query string');
ok(!o3.headers, 'and adds no Authorization header');

const [u4, o4] = tmdbReq('https://api.themoviedb.org/3/movie/949', V4);
eq(u4, 'https://api.themoviedb.org/3/movie/949', 'a v4 token does NOT go in the URL');
eq(o4.headers.Authorization, `Bearer ${V4}`, 'it goes in the Authorization header');
ok(!u4.includes('api_key'), 'and the query string stays clean — sending both is what 401s');

// The separator has to respect a URL that already has a query, or the key lands
// as part of the previous parameter's value and TMDB sees no key at all.
const [u5] = tmdbReq('https://api.themoviedb.org/3/discover/tv?with_genres=16', V3);
ok(u5.includes('?with_genres=16&api_key='), 'an existing query string gets & rather than a second ?');

// Existing headers are preserved rather than replaced — an abort signal or an
// accept header set by the caller must survive.
const [, o6] = tmdbReq('https://x/y', V4, { headers: { 'X-Test': '1' } });
eq(o6.headers['X-Test'], '1', 'caller headers are kept alongside the auth header');

let threw = null;
try { tmdbReq('https://x/y', ''); } catch (e) { threw = e.message; }
eq(threw, 'NO_KEY', 'no credential at all is a named error, not a silent 401');

console.log(`${pass}/${pass + fail} passing`);
if (fail) process.exit(1);
