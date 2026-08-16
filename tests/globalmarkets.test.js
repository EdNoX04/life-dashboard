// Every market we cover.
//
// The reference screen this is modelled on shows "$80.58T +0.75%" as if both
// halves were the same kind of fact. They are not: the cap is an ANNUAL total
// from the World Federation of Exchanges via the World Bank, and the percentage
// is today. Nobody computes a country's market cap live for free.
//
// So most of these tests are about the seam between those two facts staying
// visible, and about the three ways a missing number could quietly become a
// wrong one: null becoming zero, an unreported country being dropped, and a
// dated figure being printed without its date.

import {
  COUNTRIES, countryOf, worldBankUrl, parseWorldBank, fmtCap, fmtPct,
  capAge, marketRows, sortByCap, coverageNote, WB_INDICATOR,
  FUTURES, quoteUrl, parseQuotes, symbolsFor, capsAreFresh, CAP_TTL_MS,
  searchUrl, parseSearch, rankResults, searchable, MIN_QUERY,
  projectOrtho, globeDots, isOpenNow, openCount,
} from '../src/lib/globalmarkets.js';

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; } else { fail++; console.log('FAIL ' + name); } };
const eq = (a, b, name) => ok(a === b, `${name} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

// ------------------------------------------------------------------ roster

ok(COUNTRIES.length >= 10, 'the roster covers the markets that were asked for');
for (const iso of ['US', 'IN', 'TW', 'KR', 'JP']) {
  ok(COUNTRIES.some(c => c.iso2 === iso), `${iso} is covered — it was named explicitly`);
}
// One index per country. A tile that has to ask "which of the three did you
// mean" is a tile nobody reads.
for (const c of COUNTRIES) {
  ok(!!c.index && !!c.indexName, `${c.iso2} names the one index its change refers to`);
}
eq(countryOf('in').iso2, 'IN', 'lookup is case-insensitive');
eq(countryOf('ZZ'), null, 'and an unknown code is null rather than a guess');

// --------------------------------------------------------------- the URL

const url = worldBankUrl();
ok(url.includes(WB_INDICATOR), 'the request names the indicator');
ok(url.includes('mrnev=1'),
   'and asks for the most recent NON-EMPTY value — coverage is ragged, and a fixed year silently drops whichever countries had not filed');
ok(url.includes('format=json'), 'and asks for JSON rather than the default XML');
ok(!/api[_-]?key/i.test(url), 'no key: this endpoint is free and keyless, which is why it was chosen');

// ---------------------------------------------------------------- parsing

// The shape the World Bank actually returns: [metadata, rows], with nulls for
// country-years nobody filed.
const PAYLOAD = [
  { page: 1 },
  [
    { country: { id: 'US' }, date: '2025', value: 80580000000000 },
    { country: { id: 'IN' }, date: '2025', value: 4300000000000 },
    { country: { id: 'TW' }, date: '2023', value: 2100000000000 },
    { country: { id: 'KR' }, date: '2025', value: null },
    { country: { id: 'JP' }, date: '2024', value: 6600000000000 },
    { country: { id: 'JP' }, date: '2025', value: 7660000000000 },
  ],
];
const caps = parseWorldBank(PAYLOAD);
eq(caps.US.value, 80580000000000, 'a reported value is read');
eq(caps.US.year, 2025, 'with its year, which the tile must print');
eq(caps.JP.year, 2025, 'and the newest year wins when a country appears twice');

// THE one that matters. A null is a country that did not file; a zero is a
// market that collapsed. Rendering the first as the second is the kind of error
// nobody questions because it looks like data.
eq(caps.KR, undefined, 'an unreported country is absent, never zero');

eq(Object.keys(parseWorldBank(null)).length, 0, 'a failed request parses to nothing rather than throwing');
eq(Object.keys(parseWorldBank([{}, null])).length, 0, 'and so does an empty body');

// ------------------------------------------------------------- formatting

eq(fmtCap(80580000000000), '$80.58T', 'trillions to two decimals — the resolution the differences live at');
eq(fmtCap(4300000000000), '$4.30T', 'and a trailing zero is kept, so the column stays aligned');
eq(fmtCap(920000000000), '$920B', 'below a trillion, billions');
eq(fmtCap(null), null, 'no figure formats to null, not "$0.00T"');
eq(fmtCap(0), null, 'and neither does zero');

eq(fmtPct(0.75), '+0.75%', 'a rise carries its sign');
eq(fmtPct(-0.14), '-0.14%', 'and a fall carries its own');
eq(fmtPct(null), null, 'a missing quote is not 0.00%');

// -------------------------------------------------------------- the date

const NOW = new Date('2026-08-16T00:00:00Z');
eq(capAge(2025, NOW).label, '2025', 'the year is printed, which is what stops an annual figure reading as live');
eq(capAge(2025, NOW).stale, false, 'last year is dated, not stale');
eq(capAge(2021, NOW).stale, true, 'five years on, an annual total no longer describes the market');
eq(capAge(null, NOW).label, 'no figure', 'and no year at all says so in words');

// ----------------------------------------------------------------- rows

const rows = marketRows(caps, {
  SPX: { pct: 0.75, level: 6100, state: 'live' },
  'NIFTY 50': { pct: -0.14, level: 24800, state: 'cached' },
}, NOW);

const us = rows.find(r => r.iso2 === 'US');
eq(us.capText, '$80.58T', 'the row carries a formatted cap');
eq(us.pctText, '+0.75%', 'and a formatted change');
eq(us.quoteState, 'live', 'and says how fresh the change is');
eq(us.dir, 1, 'and which way it went, for colour');

const india = rows.find(r => r.iso2 === 'IN');
eq(india.quoteState, 'cached', 'a cached quote is not passed off as live');
eq(india.dir, -1, 'a fall is a fall');

// A market with no quote today is still a market. Dropping the row would quietly
// turn "every market we cover" into "every market that answered", which is the
// same overstatement made by layout rather than by a sentence.
const korea = rows.find(r => r.iso2 === 'KR');
ok(korea, 'a country with neither cap nor quote still appears');
eq(korea.capText, null, 'with no invented cap');
eq(korea.quoteState, 'unreachable', 'and its state named rather than left blank');
eq(korea.dir, 0, 'and no direction implied');

// ---------------------------------------------------------------- sorting

const sorted = sortByCap(rows);
eq(sorted[0].iso2, 'US', 'biggest first');
ok(sorted[sorted.length - 1].cap == null, 'and unreported markets sink to the bottom');
ok(sorted.findIndex(r => r.iso2 === 'IN') < sorted.findIndex(r => r.iso2 === 'TW'),
   'India above Taiwan on 2025 vs 2023 figures — the sort uses the number, not the year');

// -------------------------------------------------------------- the claim

const note = coverageNote(rows);
ok(/4 of \d+ markets sized/.test(note), 'the screen states how much of itself it actually sized');
ok(/World Bank/.test(note) && /WFE/.test(note), 'and cites the source rather than implying it computed it');
ok(/2023–2025/.test(note), 'and spans the years, because they are not all the same year');
ok(/1 quoting live/.test(note), 'and separates "sized" from "quoting", which are different claims');

// ------------------------------------------------------------- fetching

// The binding constraint is eight requests a minute on the free tier. Twelve
// index tiles plus three futures is fifteen — a naive fan-out spends two minutes
// rate-limited and renders a grid of blanks, which reads as "these markets are
// down" rather than "we asked too fast".
const syms = symbolsFor();
eq(syms.length, FUTURES.length + COUNTRIES.length, 'every tile is covered by the symbol list');
eq(new Set(syms).size, syms.length, 'with no duplicates burning a slot');
eq(syms[0], FUTURES[0].symbol,
   'futures first, so a truncated response still fills the strip at the top of the screen');

const u = quoteUrl(['ES=F', 'SPX'], 'KEY');
ok(u.includes('symbol=ES%3DF%2CSPX'), 'one request carries every symbol, comma-separated');
eq((u.match(/apikey=/g) || []).length, 1, 'and one key');

// Twelve Data returns a BARE object for one symbol and a map for many. Handling
// only the map shape means the grid breaks the day eleven of twelve symbols are
// unrecognised — the failure that looks like a total outage and is a typo.
const many = parseQuotes({
  'SPX': { close: '6100.5', percent_change: '0.75', is_market_open: true, datetime: '2026-08-16' },
  'NIFTY 50': { close: '24800', percent_change: '-0.14', is_market_open: false },
  'TAIEX': { status: 'error', code: 404, message: 'symbol not found' },
}, ['SPX', 'NIFTY 50', 'TAIEX']);
eq(many.SPX.pct, 0.75, 'a percentage arrives as a number, not the string the API sends');
eq(many.SPX.state, 'live', 'an open market is live');

// A closed market is not stale. Painting it amber all weekend is how a warning
// stops being read by the third weekend.
eq(many['NIFTY 50'].state, 'cached', 'a closed market is cached, not stale');

// Twelve Data reports per-symbol failures INSIDE a 200. Treating one as a quote
// gives NaN, and NaN renders as a dash that looks like a quiet market rather
// than a rejected symbol.
eq(many.TAIEX, undefined, 'a per-symbol error inside a 200 is dropped, never read as a quote');

const one = parseQuotes({ close: '6100', percent_change: '1.2', symbol: 'SPX' }, ['SPX']);
eq(one.SPX.level, 6100, 'the single-symbol shape parses too');

eq(Object.keys(parseQuotes(null, ['SPX'])).length, 0, 'a failed request parses to nothing');
eq(parseQuotes({ SPX: { close: null, percent_change: null } }, ['SPX']).SPX.pct, null,
   'and a quote with no numbers yields nulls rather than zeros');

// Caps are ANNUAL. Re-fetching hourly spends a request to receive the same
// number, so this cache is measured in days — the opposite of every other feed
// here, for the same reason: it matches what the data actually does.
ok(CAP_TTL_MS >= 24 * 3600e3, 'the cap cache lives for days, not minutes');
ok(!capsAreFresh(null), 'no cache is not fresh');
ok(!capsAreFresh({ caps: {} }), 'and neither is one with no timestamp');
ok(capsAreFresh({ at: new Date().toISOString(), caps: { US: {} } }), 'a cache written just now is fresh');
ok(!capsAreFresh({ at: '2020-01-01T00:00:00Z', caps: { US: {} } }), 'one from years ago is not');

// --------------------------------------------------------------- search

// The requirement was "anything from US to India to Taiwan should pop up", and
// what makes that useful rather than confusing is the EXCHANGE. AAPL is listed on
// a dozen venues; twelve identical-looking rows read as twelve companies, and
// picking the wrong one gets a price in the wrong currency on the wrong session.
const SEARCH = { data: [
  { symbol: 'AAPL', instrument_name: 'Apple Inc', exchange: 'NASDAQ', country: 'United States', currency: 'USD', instrument_type: 'Common Stock' },
  { symbol: 'AAPL', instrument_name: 'Apple Inc', exchange: 'XETR', country: 'Germany', currency: 'EUR', instrument_type: 'Common Stock' },
  { symbol: 'AAPL', instrument_name: 'Apple Inc', exchange: 'NASDAQ', country: 'United States', currency: 'USD', instrument_type: 'Common Stock' },
  { symbol: 'APLE', instrument_name: 'Apple Hospitality REIT Inc', exchange: 'NYSE', country: 'United States', currency: 'USD', instrument_type: 'REIT' },
  { symbol: '', instrument_name: 'nameless', exchange: 'X' },
]};
const found = parseSearch(SEARCH);
eq(found.length, 3, 'a true duplicate is dropped');
ok(found.some(r => r.exchange === 'XETR'),
   'but the SAME ticker on a different venue is kept — deduping on the symbol alone would silently pick a venue for you');
ok(found.every(r => r.symbol), 'a row with no symbol is not a result');
eq(found[0].currency, 'USD', 'currency rides along, since the same ticker prices differently per venue');

eq(parseSearch(null).length, 0, 'a failed search returns nothing rather than throwing');
eq(parseSearch({ data: 'nope' }).length, 0, 'and so does a malformed body');

// Someone typing NVDA wants NVDA, not "NVDA Bull 2X Shares".
const ranked = rankResults([
  { symbol: 'AAPLW', name: 'Apple Inc Warrants', exchange: 'X' },
  { symbol: 'APLE', name: 'Apple Hospitality REIT Inc', exchange: 'X' },
  { symbol: 'AAPL', name: 'Apple Inc', exchange: 'NASDAQ' },
], 'AAPL');
eq(ranked[0].symbol, 'AAPL', 'an exact ticker match comes first');
eq(ranked[1].symbol, 'AAPLW', 'then a prefix match');

// Not arbitrary: on a name match the SHORTEST name is almost always the primary
// listing, which is what someone typing "apple" means.
const byName = rankResults([
  { symbol: 'AAPL34', name: 'Apple Inc BDR', exchange: 'X' },
  { symbol: 'AAPL', name: 'Apple Inc', exchange: 'NASDAQ' },
], 'apple');
eq(byName[0].name, 'Apple Inc', 'the shortest name wins a name match');

const u2 = searchUrl(' nvda ', 'KEY');
ok(u2.includes('symbol=nvda'), 'the query is trimmed before it is spent');
ok(u2.includes('apikey=KEY'), 'and carries the key');

// A one-character query matches half the market and spends one of eight requests
// a minute to return noise.
ok(MIN_QUERY >= 2, 'a query has to be at least two characters');
ok(!searchable('a'), 'one character does not search');
ok(!searchable('   '), 'and neither does whitespace');
ok(searchable('nv'), 'two does');

// ---------------------------------------------------------------- globe

// Decorative, and cheap on purpose: four lines of trigonometry and an SVG
// circle, rather than 300KB of TopoJSON for twelve dots.

// Every country carries a financial-centre coordinate. A dot on Mumbai says
// "this is where that market trades"; a dot in central India says nothing.
for (const c of COUNTRIES) {
  ok(Number.isFinite(c.lat) && Number.isFinite(c.lon), `${c.iso2} has a centre to plot`);
  ok(Math.abs(c.lat) <= 90 && Math.abs(c.lon) <= 180, `${c.iso2}'s coordinates are on Earth`);
}

// The centre of the view projects to the origin and faces us.
const mid = projectOrtho(0, 0, 0, 0);
ok(Math.abs(mid.x) < 1e-9 && Math.abs(mid.y) < 1e-9, 'the point facing the camera sits at the centre');
eq(mid.front, true, 'and is on the front');

// THE test that matters. Half the world is behind the sphere at any rotation,
// and drawing those dots anyway puts Tokyo on top of New York.
eq(projectOrtho(0, 180, 0, 0).front, false, 'the far side of the world is culled');
eq(projectOrtho(0, 90, 0, 0).front, true, 'and the limb is not');
eq(projectOrtho(0, 0, 180, 0).front, false, 'rotation moves what is visible');

// The poles land top and bottom, which is the quickest way to catch a swapped
// axis before it ships looking almost right.
ok(projectOrtho(90, 0, 0, 0).y > 0.99, 'the north pole is up');
ok(projectOrtho(-90, 0, 0, 0).y < -0.99, 'and the south pole is down');

// Nothing ever escapes the disc.
for (const lat of [-90, -45, 0, 45, 90]) {
  for (const lon of [-180, -90, 0, 90, 180]) {
    const p = projectOrtho(lat, lon, 37, 12);
    ok(Math.hypot(p.x, p.y) <= 1.0000001, `(${lat},${lon}) stays inside the sphere`);
  }
}

const dots = globeDots(
  [{ iso2: 'US', name: 'United States', lat: 40.7, lon: -74, dir: 1 },
   { iso2: 'JP', name: 'Japan', lat: 35.7, lon: 139.7, dir: -1 },
   { iso2: 'XX', name: 'No coordinates', dir: 0 }],
  { rotation: 74, tilt: 12, r: 100, cx: 120, cy: 120 },
);
eq(dots.length, 2, 'a row with no coordinates is skipped rather than drawn at the origin');
const usDot = dots.find(d => d.iso2 === 'US');
ok(usDot.front, 'rotated to face New York, the US dot is visible');

// SVG counts y downward and latitude counts up. Forgetting that mirrors the map
// about the equator and it still looks like a globe, which is why it survives.
const north = globeDots([{ iso2: 'N', lat: 60, lon: 0 }], { rotation: 0, tilt: 0, r: 100, cy: 0 })[0];
ok(north.cy < 0, 'a northern market plots ABOVE centre in SVG coordinates');

// Painter's order: a nearer market must draw over a further one.
ok(dots[dots.length - 1].opacity >= dots[0].opacity, 'dots are ordered back to front');
ok(dots.every(d => d.opacity >= 0 && d.opacity <= 1), 'and every opacity is drawable');

// ------------------------------------------------------- which are trading

// "Open" is a fact about the clock and the venue. It has nothing to do with
// whether a quote arrived: a market can be open with a dead feed, and closed
// holding a perfectly good last price. Conflating them is how "we could not
// reach this" gets painted as "this market is shut".
const WED_LUNCH_IST = new Date('2026-08-19T06:00:00Z');   // 11:30 IST, 02:00 UTC-ish
const openRows = marketRows(caps, {}, WED_LUNCH_IST);
const inRow = openRows.find(r => r.iso2 === 'IN');
ok(inRow.session, 'every row carries its venue session');
eq(isOpenNow(inRow), true, 'the NSE is trading at 11:30 on a Wednesday');
eq(inRow.quoteState, 'unreachable', 'while its quote never arrived — the two are independent');

const usRow = openRows.find(r => r.iso2 === 'US');
eq(isOpenNow(usRow), false, 'and New York is still asleep at that moment');

// Weekends close everything, which is the cheapest sanity check on the whole
// session model.
const SAT = new Date('2026-08-22T06:00:00Z');
eq(openCount(marketRows(caps, {}, SAT)), 0, 'nothing trades on a Saturday');

ok(/trading right now/.test(coverageNote(openRows)),
   'and the screen states how many are trading, separately from how many are quoting');

// The globe gets the same fact, so an open market can be marked without asking
// the component to recompute a session.
const litDots = globeDots(openRows, { rotation: 0, r: 100 });
ok(litDots.some(d => d.open === true), 'at least one dot knows its market is open');
ok(litDots.every(d => typeof d.open === 'boolean'), 'and every dot answers the question');

console.log(`${pass}/${pass + fail} passing`);
if (fail) process.exit(1);
