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

console.log(`${pass}/${pass + fail} passing`);
if (fail) process.exit(1);
