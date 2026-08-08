// Pins the news parsing rules behind three reported faults: the Finance tab
// never loading, Tech headlines arriving with no gist, and My Stocks not saying
// which stock a story is about. Expected values are hand-typed.

import {
  CATEGORIES, decodeEntities, stripHtml, cleanSummary, splitTicker,
  stripSourceSuffix, parseRss, dedupe, balance, countByCategory,
} from '../scripts/lib/newsfeed.mjs';

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; } else { fail++; console.log('FAIL ' + name); } };
const eq = (a, b, name) => ok(a === b, `${name} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

// ------------------------------------------------------------- categories
eq(CATEGORIES.length, 3, 'three feed categories');
ok(CATEGORIES.includes('finance'), 'finance is a real category, not an empty tab');

// ---------------------------------------------------------------- decoding
eq(decodeEntities('AT&amp;T'), 'AT&T', 'named entity decodes');
eq(decodeEntities('it&#39;s'), "it's", 'numeric apostrophe decodes');
eq(decodeEntities('a&nbsp;b'), 'a b', 'non-breaking space becomes a space');
eq(decodeEntities('plain'), 'plain', 'text with no entities is untouched');
eq(stripHtml('<p>Hello <b>world</b></p>'), 'Hello world', 'tags are stripped');
eq(stripHtml('<![CDATA[Fed cuts]]>'), 'Fed cuts', 'CDATA wrapper is removed');
eq(stripHtml('a   b\n c'), 'a b c', 'whitespace collapses');
eq(stripHtml(null), '', 'null strips to empty');
// A stripped tag must leave a separator, or two words fuse into one.
eq(stripHtml('<b>Fed</b><i>cuts</i>'), 'Fed cuts', 'adjacent tags do not fuse words');

// ----------------------------------------------------------- the gist (2)
eq(cleanSummary('<p>Shares rose 4% on strong guidance.</p>', 'Nvidia beats'),
  'Shares rose 4% on strong guidance.', 'a description becomes the gist');
eq(cleanSummary('Nvidia beats — shares rose 4%.', 'Nvidia beats'),
  'shares rose 4%.', 'a gist that restates the headline drops the repetition');
eq(cleanSummary('Nvidia beats', 'Nvidia beats'), '',
  'a gist identical to the headline is no gist at all');
eq(cleanSummary('Fed holds rates. View Full Coverage on Google News', 'Fed'),
  'Fed holds rates.', "Google's coverage link is removed");
eq(cleanSummary('', 'Anything'), '', 'an absent description yields an empty gist');
eq(cleanSummary(null, 'Anything'), '', 'a null description yields an empty gist');
// Truncation cuts on a word boundary and marks itself.
const long = cleanSummary('a'.repeat(40) + ' ' + 'b'.repeat(400), '', 60);
ok(long.endsWith('…'), 'an over-long gist is marked as truncated');
ok(long.length <= 61, 'an over-long gist respects the cap');
eq(cleanSummary('short enough', '', 60), 'short enough', 'a short gist is not truncated');
// Word-boundary cutting: the 40-char run survives whole rather than being split.
ok(long.startsWith('a'.repeat(40)), 'truncation cuts on a space, not mid-word');

// ------------------------------------------------------- the ticker (3)
const st = splitTicker('[NVDA] Nvidia beats on earnings');
eq(st.ticker, 'NVDA', 'the ticker is lifted out of the title');
eq(st.title, 'Nvidia beats on earnings', 'the title loses the prefix');
eq(splitTicker('Fed holds rates').ticker, null, 'an unprefixed title has no ticker');
eq(splitTicker('Fed holds rates').title, 'Fed holds rates', 'an unprefixed title is unchanged');
eq(splitTicker('[BRK.B] Berkshire files').ticker, 'BRK.B', 'a dotted ticker parses');
// Bracketed prose is not a ticker.
eq(splitTicker('[Opinion] Why the Fed is wrong').ticker, null,
  'a lower-case bracketed word is not mistaken for a ticker');
eq(splitTicker('[NVDA]').ticker, null, 'a prefix with no headline behind it is not a ticker');
eq(splitTicker(null).title, '', 'a null title is empty, not a crash');

eq(stripSourceSuffix('Fed holds rates - Reuters', 'Reuters'), 'Fed holds rates',
  'the duplicated source suffix is stripped');
eq(stripSourceSuffix('Reuters wins award', 'Reuters'), 'Reuters wins award',
  'the source name inside a headline is left alone');
eq(stripSourceSuffix('Fed holds rates', ''), 'Fed holds rates', 'no source, no stripping');

// -------------------------------------------------------------- rss parse
const XML = `<rss><channel>
<item><title>Fed holds rates - Reuters</title><link>https://ex.com/a</link>
<source url="x">Reuters</source><pubDate>Tue, 04 Aug 2026 10:00:00 GMT</pubDate>
<description>&lt;p&gt;Policymakers left the target range unchanged.&lt;/p&gt;</description></item>
<item><title>Chip demand surges - The Verge</title><link>https://ex.com/b</link>
<source url="y">The Verge</source><pubDate>Wed, 05 Aug 2026 09:00:00 GMT</pubDate>
<description>AI buildout continues.</description></item>
<item><title></title><link>https://ex.com/c</link></item>
</channel></rss>`;

const parsed = parseRss(XML, 'finance');
eq(parsed.length, 2, 'a title-less item is dropped');
eq(parsed[0].title, 'Fed holds rates', 'the source suffix is gone from the parsed title');
eq(parsed[0].source, 'Reuters', 'the source is its own field');
eq(parsed[0].category, 'finance', 'the parsed item carries the category it was asked for');
eq(parsed[0].summary, 'Policymakers left the target range unchanged.',
  'the double-encoded description parses into a gist');
eq(parsed[0].published_at, '2026-08-04T10:00:00.000Z', 'pubDate becomes an ISO timestamp');
eq(parsed[1].summary, 'AI buildout continues.', 'a plain description parses too');
eq(parseRss('', 'tech').length, 0, 'empty XML yields nothing');
eq(parseRss(null, 'tech').length, 0, 'null XML yields nothing, not a crash');
// A missing pubDate falls back to the supplied clock rather than to NaN.
eq(parseRss('<item><title>T</title><link>u</link></item>', 'tech', 0)[0].published_at,
  '1970-01-01T00:00:00.000Z', 'a missing pubDate uses the supplied now');

// ---------------------------------------------------------------- dedupe
const DUPES = [
  { title: 'Fed holds', url: 'https://ex.com/a', category: 'finance', published_at: '2026-08-05' },
  { title: 'FED HOLDS', url: 'https://ex.com/z', category: 'finance', published_at: '2026-08-04' },
  { title: 'Other', url: 'https://ex.com/a?utm=1', category: 'finance', published_at: '2026-08-03' },
  { title: 'Real second', url: 'https://ex.com/b', category: 'finance', published_at: '2026-08-02' },
];
const dd = dedupe(DUPES);
eq(dd.length, 2, 'case-different titles and query-different URLs both collapse');
eq(dd[0].title, 'Fed holds', 'the first copy survives');
eq(dd[1].title, 'Real second', 'genuinely distinct stories survive');
eq(dedupe([{ title: 'x' }]).length, 0, 'an item with no URL is dropped');

// -------------------------------------------------------------- balancing
// The old global cap of 8 across four tabs is what let one category starve the
// rest. Each category gets its own allowance now.
const MANY = [];
for (let i = 0; i < 12; i++) MANY.push({ title: `s${i}`, url: `u-s${i}`, category: 'stocks', published_at: `2026-08-${String(i + 1).padStart(2, '0')}` });
for (let i = 0; i < 3; i++) MANY.push({ title: `f${i}`, url: `u-f${i}`, category: 'finance', published_at: `2026-07-${String(i + 1).padStart(2, '0')}` });
for (let i = 0; i < 5; i++) MANY.push({ title: `t${i}`, url: `u-t${i}`, category: 'tech', published_at: `2026-06-${String(i + 1).padStart(2, '0')}` });

const bal = balance(MANY, 6);
const c = countByCategory(bal);
eq(c.stocks, 6, 'the crowded category is capped at its allowance');
eq(c.finance, 3, 'a thin category keeps everything it has');
eq(c.tech, 5, 'another thin category is untouched');
eq(bal.length, 14, 'the balanced total is the sum of the allowances taken');
// Within a category the newest survive the cap, not the first seen.
ok(bal.some(n => n.title === 's11'), 'the newest item in a crowded category is kept');
ok(!bal.some(n => n.title === 's0'), 'the oldest item in a crowded category is dropped');
// The output is newest-first overall.
eq(bal[0].title, 's11', 'the balanced list is sorted newest first');
eq(balance([], 6).length, 0, 'balancing nothing yields nothing');

console.log(`${pass}/${pass + fail} passing`);
if (fail) process.exit(1);
