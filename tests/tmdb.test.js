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

console.log(`${pass}/${pass + fail} passing`);
if (fail) process.exit(1);
