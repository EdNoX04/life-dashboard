// The Letterboxd import.
//
// Three ways this goes wrong quietly, which is why they get most of the tests:
//
//   1. RSS looks complete and is not. The feed carries roughly the last fifty
//      entries, so a first import from RSS alone produces a diary that starts
//      fifty films ago and looks finished. The CSV export is the full history.
//   2. watched.csv looks like diary.csv. One is per-viewing, the other is
//      per-film — import the wrong one and every rewatch silently disappears.
//   3. A naive comma split destroys any title containing a comma, shifting
//      every later column so the date lands in the rating field. Nothing errors.

import {
  parseRss, parseCsv, parseRating, splitCsvLine, csvKind, decodeEntities, mergeInto,
} from '../scripts/lib/letterboxd.mjs';

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; } else { fail++; console.log('FAIL ' + name); } };
const eq = (a, b, name) => ok(a === b, `${name} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

// ---------------------------------------------------------------- ratings

eq(parseRating('4.5'), 4.5, 'half stars survive');
eq(parseRating('5'), 5, 'and whole ones');
eq(parseRating(''), null, 'no rating is null, NOT zero — unrated is not zero stars');
eq(parseRating(null), null, 'and neither is nothing');
eq(parseRating('0'), null, 'a literal zero is treated as unrated too — Letterboxd has no 0-star');

// --------------------------------------------------------------- entities

eq(decodeEntities('Tom &amp; Jerry'), 'Tom & Jerry', 'ampersands decode');
eq(decodeEntities('&quot;Heat&quot;'), '"Heat"', 'quotes decode');
// &amp; must decode LAST or "&amp;quot;" becomes a quote rather than the literal
// text "&quot;" — Letterboxd double-encodes inside description HTML.
eq(decodeEntities('&amp;quot;'), '&quot;', 'a double-encoded entity decodes exactly once');

// -------------------------------------------------------------------- RSS

const RSS = `<rss>
<channel>
<item>
  <title>Heat, 1995 - ★★★★½</title>
  <link>https://letterboxd.com/ednox/film/heat/</link>
  <letterboxd:filmTitle>Heat</letterboxd:filmTitle>
  <letterboxd:filmYear>1995</letterboxd:filmYear>
  <letterboxd:watchedDate>2026-06-01</letterboxd:watchedDate>
  <letterboxd:memberRating>4.5</letterboxd:memberRating>
  <letterboxd:rewatch>No</letterboxd:rewatch>
  <tmdb:movieId>949</tmdb:movieId>
  <description>&lt;p&gt;&lt;img src="https://a.ltrbxd.com/heat.jpg"/&gt;&lt;/p&gt;</description>
</item>
<item>
  <title>Sicario, 2015</title>
  <letterboxd:filmTitle>Sicario</letterboxd:filmTitle>
  <letterboxd:watchedDate>2026-06-14</letterboxd:watchedDate>
  <letterboxd:rewatch>true</letterboxd:rewatch>
</item>
<item>
  <title>My Top 100 Films</title>
  <link>https://letterboxd.com/ednox/list/my-top-100/</link>
  <description>A list.</description>
</item>
</channel></rss>`;

const rss = parseRss(RSS);
eq(rss.length, 2, 'the LIST post is skipped — only diary entries are viewings');
eq(rss[0].title, 'Heat', 'the film title comes from the namespaced field, not the display title');
eq(rss[0].on, '2026-06-01', 'with the watched date');
eq(rss[0].rating, 4.5, 'and the rating');
eq(rss[0].tmdb_id, 949, 'the TMDB id comes across, which is what links it to the shelf');
eq(rss[0].year, 1995, 'and the year');
eq(rss[0].poster_url, 'https://a.ltrbxd.com/heat.jpg', 'the poster is dug out of the escaped description HTML');
eq(rss[0].rewatch, false, '"No" is not a rewatch');
eq(rss[1].rewatch, true, 'but "true" is');
eq(rss[1].rating, null, 'an unrated entry stays unrated');
eq(rss[1].tmdb_id, null, 'and a missing id is null rather than NaN');
eq(parseRss('').length, 0, 'an empty feed yields nothing');
eq(parseRss('<rss><channel></channel></rss>').length, 0, 'and so does a feed with no items');

// -------------------------------------------------------------- CSV lines

eq(splitCsvLine('a,b,c').join('|'), 'a|b|c', 'plain fields split');
// The one that silently corrupts an import.
eq(splitCsvLine('"Lock, Stock and Two Smoking Barrels",1998,4.5').join('|'),
   'Lock, Stock and Two Smoking Barrels|1998|4.5',
   'a comma inside quotes does NOT split the row — otherwise every later column shifts');
eq(splitCsvLine('"He said ""hi""",2020').join('|'), 'He said "hi"|2020', 'doubled quotes are one quote');
eq(splitCsvLine('').join('|'), '', 'an empty line is one empty field');

// --------------------------------------------------------------- CSV kind

const DIARY = `Date,Name,Year,Letterboxd URI,Rating,Rewatch,Tags,Watched Date
2026-06-02,Heat,1995,https://boxd.it/x,4.5,No,,2026-06-01
2026-07-21,Heat,1995,https://boxd.it/x,4.0,Yes,,2026-07-20
2026-06-15,"Lock, Stock and Two Smoking Barrels",1998,https://boxd.it/y,5,No,,2026-06-14`;

const WATCHED = `Date,Name,Year,Letterboxd URI
2026-06-02,Heat,1995,https://boxd.it/x`;

eq(csvKind(DIARY), 'diary', 'the diary export is recognised by its Watched Date column');
eq(csvKind(WATCHED), 'watched', 'the film list is recognised as the other thing');
eq(csvKind('garbage'), 'unknown', 'and anything else is unknown rather than assumed');

const d = parseCsv(DIARY);
eq(d.length, 3, 'three rows');
eq(d[0].on, '2026-06-01', 'the WATCHED date is used, not the date you logged it');
eq(d[0].rating, 4.5, 'ratings come through');
eq(d[1].rewatch, true, '"Yes" is a rewatch');
eq(d[2].title, 'Lock, Stock and Two Smoking Barrels', 'and the comma title survives intact');
eq(d[2].year, 1998, 'with its year in the right column');

// Two viewings of Heat, which is the entire reason to prefer diary.csv.
eq(d.filter(x => x.title === 'Heat').length, 2, 'the same film watched twice is two rows');

const w = parseCsv(WATCHED);
eq(w[0].on, '2026-06-02', 'watched.csv falls back to the log date, since it has no other');
eq(w[0].source, 'letterboxd-csv-logdate',
  'and it is labelled as a log date, because presenting it as a watch date would be a lie');
eq(parseCsv('').length, 0, 'an empty file imports nothing');
eq(parseCsv('Nonsense\n1,2').length, 0, 'and a file with no Name column is not guessed at');

// ----------------------------------------------------------------- merge

const keyOf = e => `${String(e.title).toLowerCase()}|${e.on}`;

const existing = [
  // Already logged by hand, with a note the import knows nothing about.
  { id: 'a', title: 'Heat', on: '2026-06-01', rating: 5, note: 'with dad', kind: 'movie' },
];
const r1 = mergeInto(existing, d, { keyOf });
eq(r1.added, 2, 'the two viewings not already present are added');
eq(r1.entries.length, 3, 'giving three in total');

const heat = r1.entries.find(e => e.id === 'a');
eq(heat.rating, 5, 'the rating YOU set is not overwritten by the import\'s 4.5');
eq(heat.note, 'with dad', 'and your note survives');
eq(heat.year, 1995, 'while a field you never had is filled in from the import');

// Idempotence: the sync runs daily, and a second run must change nothing.
const r2 = mergeInto(r1.entries, d, { keyOf });
eq(r2.added, 0, 'a re-run adds nothing');
eq(r2.entries.length, 3, 'and the log does not grow');

// ------------------------------------------------- the films page (the gap)

// A profile has TWO counts: the diary (films logged with a date) and the films
// list (everything ever marked watched). On the real profile this import was
// built against those are 25 and 58 — so a diary-only import silently omits 33
// films that were watched, with nothing anywhere reporting the omission.

import { parseFilmsHtml, onlyMissing, hasNextPage } from '../scripts/lib/letterboxd.mjs';

const FILMS_HTML = `
<ul class="poster-list">
<li><div data-film-slug="the-dark-knight" data-film-name="The Dark Knight" data-film-release-year="2008">
  <span class="rating rated-10">★★★★★</span></div></li>
<li><div data-film-slug="interstellar" data-film-name="Interstellar" data-film-release-year="2014">
  <span class="rating rated-9">★★★★½</span></div></li>
<li><div data-film-slug="tamasha"><img alt="Tamasha (2015)" /></div></li>
<li><div data-film-slug="rang-de-basanti" data-film-name="Rang De Basanti" data-film-release-year="2006"></div></li>
<li><div data-film-slug="the-dark-knight" data-film-name="The Dark Knight"></div></li>
</ul>`;

const films = parseFilmsHtml(FILMS_HTML);
eq(films.length, 4, 'the repeated poster is counted once — grids often render a title twice');
eq(films[0].title, 'The Dark Knight', 'the name comes off the data attribute');
eq(films[0].year, 2008, 'with its year');
eq(films[0].rating, 5, 'rated-10 is five stars — the scale is halves');
eq(films[1].rating, 4.5, 'and rated-9 is four and a half');

// The fallback path: no name attribute, only the image alt "Title (Year)".
eq(films[2].title, 'Tamasha', 'the alt text is split into title…');
eq(films[2].year, 2015, '…and year');

eq(films[3].rating, null, 'an unrated film is null, not zero stars');

// The honest part. Letterboxd does not know when these were watched either.
ok(films.every(f => f.on === null), 'films-list entries carry NO date, because none exists');
ok(films.every(f => f.source === 'letterboxd-films'), 'and are labelled by where they came from');

eq(parseFilmsHtml('').length, 0, 'an empty page yields nothing');
eq(parseFilmsHtml('<ul></ul>').length, 0, 'and so does a page with no posters');

// The dedupe that stops every dated viewing gaining an undated twin.
const diary = [
  { title: 'The Dark Knight', on: '2026-01-05' },
  { title: 'interstellar', on: '2025-11-02' },
];
const missing = onlyMissing(films, diary);
eq(missing.length, 2, 'films already in the diary are not added again');
eq(missing.map(f => f.title).sort().join(','), 'Rang De Basanti,Tamasha',
  'only the ones with no diary entry come through');
ok(!missing.some(f => f.title === 'Interstellar'),
  'a diary entry with no year blocks its title outright — nothing can tell them apart');
eq(onlyMissing(films, []).length, 4, 'with an empty diary, everything is missing');
eq(onlyMissing([], diary).length, 0, 'and no films means nothing to add');

// TWO FILMS, ONE TITLE — the bug that survived the first fix.
//
// Fixing the merge key was necessary and did nothing on its own, because this
// filter runs FIRST: with a title-only match, the second "Home Alone" was
// removed before the merge ever saw it. One import added one of them and every
// import afterwards filtered both out, so the second was permanently
// unreachable and the total sat one short of the profile — forever, silently.
const twoHomes = [
  { title: 'Home Alone', year: 1990, on: null },
  { title: 'Home Alone', year: 2021, on: null },
];
eq(onlyMissing(twoHomes, []).length, 2, 'with nothing on record, both come through');

const oneImported = [{ title: 'Home Alone', year: 1990, on: null }];
const rest = onlyMissing(twoHomes, oneImported);
eq(rest.length, 1, 'once one is imported, the OTHER is still missing');
eq(rest[0].year, 2021, 'and it is the one that has not been seen');

eq(onlyMissing(twoHomes, twoHomes).length, 0, 'with both on record, neither is missing');

// The conservative case: an existing entry with no year blocks the title, since
// there is nothing to distinguish it by. A film you can recover by adding a
// year beats a duplicate that quietly inflates every count.
eq(onlyMissing(twoHomes, [{ title: 'Home Alone', on: '2026-01-01' }]).length, 0,
  'a dated entry with no year blocks both — undercounting is the safer failure');

// A films-list entry with no year, against a record that has one: folded rather
// than added, since the merge key would collapse them anyway.
eq(onlyMissing([{ title: 'Home Alone', year: null }], oneImported).length, 0,
  'a yearless film does not duplicate a known one');

eq(hasNextPage('<a class="next" href="/ednox/films/page/2/">Next</a>'), true, 'pagination is detected');
eq(hasNextPage('<div>no more</div>'), false, 'and its absence too');

// ------------------------------------------- the off-by-one that mispaired all

// The first parser split on `data-film-slug="`, so every chunk ran from one slug
// to the NEXT — and Letterboxd emits a poster's name BEFORE its slug. The first
// name after slug[i] therefore belonged to film[i+1].
//
// What makes this worth a permanent test is how it hid. The SET of titles was
// completely correct, so diffing titles against the profile found nothing. The
// counts disagreed by exactly one, and only because two neighbours happened to
// share a name once the year was stripped. Meanwhile every star rating was
// attached to the wrong film — the one error nobody was looking for.

const REAL_SHAPE = `<ul class="poster-list">
<li class="griditem">
  <div class="react-component" data-item-name="The Odyssey (2026)" data-item-slug="the-odyssey-2026">
    <div class="poster film-poster"><img alt="The Odyssey"/></div>
  </div>
  <p class="poster-viewingdata"><span class="rating rated-9">★★★★½</span></p>
</li>
<li class="griditem">
  <div class="react-component" data-item-name="Aladdin (1992)" data-item-slug="aladdin">
    <div class="poster film-poster"><img alt="Aladdin"/></div>
  </div>
  <p class="poster-viewingdata"><span class="rating rated-8">★★★★</span></p>
</li>
<li class="griditem">
  <div class="react-component" data-item-name="Home Alone (1990)" data-item-slug="home-alone">
    <div class="poster film-poster"><img alt="Home Alone"/></div>
  </div>
  <p class="poster-viewingdata"><span class="rating rated-7">★★★½</span></p>
</li>
</ul>`;

const real = parseFilmsHtml(REAL_SHAPE);
eq(real.length, 3, 'three posters, three films');

// The assertions that would have caught it: title, year, rating and slug must
// all belong to the SAME poster.
eq(real[0].title, 'The Odyssey', 'first title is its own');
eq(real[0].letterboxd_slug, 'the-odyssey-2026', 'paired with its own slug');
eq(real[0].year, 2026, 'and its own year');
eq(real[0].rating, 4.5, 'and its own rating — rated-9 is four and a half');

eq(real[1].title, 'Aladdin', 'the second is Aladdin');
eq(real[1].letterboxd_slug, 'aladdin', 'not shifted onto its neighbour');
eq(real[1].rating, 4, 'with Aladdin\'s rating, not The Odyssey\'s');

eq(real[2].title, 'Home Alone', 'and the third is Home Alone');
eq(real[2].year, 1990, 'with its year read off the name attribute');
eq(real[2].rating, 3.5, 'and its own stars');

// The shape of the bug, stated directly: no title may carry a neighbour's slug.
ok(real.every((f, i) => f.letterboxd_slug !== (real[i + 1] || {}).letterboxd_slug),
  'no two entries share a slug');
ok(!real.some(f => f.title === 'Home Alone' && f.letterboxd_slug === 'aladdin'),
  'the exact mispairing that was live — Home Alone filed under aladdin — cannot recur');

// A poster with no name attribute at all falls back to the img alt, still from
// inside its own <li>.
const altOnly = parseFilmsHtml('<li><div data-film-slug="tamasha"><img alt="Tamasha (2015)"/></div></li>');
eq(altOnly[0].title, 'Tamasha', 'the alt fallback still works');
eq(altOnly[0].year, 2015, 'and carries the year');

// -------------------------------------------------------------- reviews

// Letterboxd packs the poster and the review into one escaped HTML blob. The
// image lives in its own <p>, and stripping tags before removing it puts the
// poster URL at the top of every review you import.

import { reviewOf } from '../scripts/lib/letterboxd.mjs';

const DESC = '<p><img src="https://a.ltrbxd.com/k.jpg"/></p> <p>Really intuitive spy movie would love if you like spy movies</p>';
eq(reviewOf(DESC), 'Really intuitive spy movie would love if you like spy movies',
  'the review comes through without the poster');
ok(!reviewOf(DESC).includes('http'), 'and with no image URL smuggled into the text');

eq(reviewOf('<p><img src="x"/></p>'), null, 'a poster with no words is not a review');
eq(reviewOf(''), null, 'and neither is nothing');
eq(reviewOf('<p>Watched on 26 Apr 2026.</p>'), null,
  "Letterboxd's own footer is not something you wrote");

eq(reviewOf('<p>One.</p><p>Two.</p>'), 'One.\n\nTwo.', 'paragraphs survive as blank lines');
eq(reviewOf('<p>A<br/>B</p>'), 'A\nB', 'and line breaks as line breaks');
eq(reviewOf('<p>Tom &amp; Jerry, basically</p>'), 'Tom & Jerry, basically', 'entities decode');

const withReview = parseRss(`<rss><channel><item>
  <letterboxd:filmTitle>Kingsman: The Secret Service</letterboxd:filmTitle>
  <letterboxd:watchedDate>2026-04-26</letterboxd:watchedDate>
  <letterboxd:memberRating>4.0</letterboxd:memberRating>
  <description>&lt;p&gt;&lt;img src="https://a.ltrbxd.com/k.jpg"/&gt;&lt;/p&gt; &lt;p&gt;Really intuitive spy movie&lt;/p&gt;</description>
</item></channel></rss>`);
eq(withReview[0].review, 'Really intuitive spy movie', 'a real feed entry carries its review through');
eq(withReview[0].poster_url, 'https://a.ltrbxd.com/k.jpg', 'and still finds the poster');

console.log(`${pass}/${pass + fail} passing`);
if (fail) process.exit(1);
