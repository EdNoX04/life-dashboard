// Letterboxd, parsed. No API, no scraping a logged-in session, no browser.
//
// Letterboxd has no public API — the developer programme has been "coming soon"
// for years. What it does have is two public, free, documented-enough surfaces:
//
//   THE RSS FEED at letterboxd.com/<user>/rss/ carries recent diary entries with
//   the watched date, the star rating and a rewatch flag, in a namespaced XML
//   block. It is the right thing for ONGOING sync.
//
//   THE CSV EXPORT (Settings → Import & Export → Export your data) carries the
//   ENTIRE history. The feed does not: it is capped at roughly the last fifty
//   entries, so a first import that only reads RSS will silently give you a
//   diary that starts fifty films ago and looks complete.
//
// Both are parsed here, into the same viewing shape the app's log uses, because
// the difference between them is coverage rather than meaning.
//
// This runs on a GitHub runner rather than in the browser: letterboxd.com sends
// no CORS header, so a fetch from the app would be blocked after the response
// had already arrived — the same wall the Stooq benchmark feed hit.

// Letterboxd's rating is out of 5 in half-star steps, which is already the
// app's scale. It arrives as a decimal string.
export function parseRating(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 2) / 2;
}

export function decodeEntities(s = '') {
  return String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&');   // last, or every other entity decodes twice
}

const tag = (block, name) => {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  if (!m) return null;
  return decodeEntities(m[1].replace(/^<!\[CDATA\[|\]\]>$/g, '')).trim() || null;
};

// The poster is only ever in the description HTML, as the first <img>.
const posterOf = html => {
  const m = String(html || '').match(/<img src="([^"]+)"/i);
  return m ? decodeEntities(m[1]) : null;
};

// The review text, out of the same description block.
//
// Letterboxd packs the poster and the review into one escaped HTML blob:
// <p><img …/></p><p>Really intuitive spy movie…</p>. The paragraph holding the
// image is the poster, everything after it is what you wrote. Dropping the
// <img> paragraph before stripping tags is the whole trick — strip first and
// the image URL ends up as the first line of your review.
export function reviewOf(html) {
  const withoutPoster = String(html || '').replace(/<p>\s*<img[^>]*>\s*<\/p>/gi, '');
  const text = withoutPoster
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p>/gi, '\n\n')
    .replace(/<[^>]*>/g, '')
    .trim();
  // "Watched on 26 Apr 2026." is Letterboxd's own footer on entries with no
  // review, not something you wrote.
  if (!text || /^watched on /i.test(text)) return null;
  return decodeEntities(text).trim() || null;
}

/**
 * Diary entries out of the RSS feed.
 *
 * A Letterboxd feed mixes diary entries with LIST posts and REVIEWS-without-
 * watches, and only the first kind is a viewing. Diary items are the ones
 * carrying letterboxd:watchedDate; anything else is skipped rather than guessed
 * at, because a list called "Films I want to see" would otherwise import as
 * fifty films you watched.
 */
export function parseRss(xml = '') {
  const items = String(xml).split(/<item>/i).slice(1).map(s => s.split(/<\/item>/i)[0]);
  const out = [];
  for (const it of items) {
    const watched = tag(it, 'letterboxd:watchedDate');
    if (!watched) continue;                       // not a diary entry
    const title = tag(it, 'letterboxd:filmTitle') || tag(it, 'title');
    if (!title) continue;
    const year = Number(tag(it, 'letterboxd:filmYear')) || null;
    const desc = it.match(/<description>([\s\S]*?)<\/description>/i)?.[1] || '';
    out.push({
      title,
      year,
      on: watched,
      rating: parseRating(tag(it, 'letterboxd:memberRating')),
      // Letterboxd writes "true"/"false" as text.
      rewatch: String(tag(it, 'letterboxd:rewatch')).toLowerCase() === 'true',
      tmdb_id: Number(tag(it, 'tmdb:movieId')) || null,
      poster_url: posterOf(decodeEntities(desc)),
      review: reviewOf(decodeEntities(desc)),
      letterboxd_uri: tag(it, 'link'),
      kind: 'movie',
      source: 'letterboxd-rss',
    });
  }
  return out;
}

// ------------------------------------------------------------------- CSV

// A CSV line splitter that respects quotes and doubled-quote escapes. Film
// titles contain commas ("Three Colours: Red, White and Blue" collections,
// "Lock, Stock and Two Smoking Barrels") and a naive split on comma silently
// shifts every later column — the date ends up in the rating field and the
// import looks like it worked.
export function splitCsvLine(line = '') {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map(s => s.trim());
}

/**
 * The full history, from the export.
 *
 * Letterboxd ships several CSVs in the zip and two of them look alike:
 *   diary.csv   — one row per VIEWING, with Watched Date. This is what we want.
 *   watched.csv — one row per FILM, with only the date you logged it.
 * Importing watched.csv gives you one entry per film and destroys every
 * rewatch, so the header is checked rather than the filename.
 */
export function parseCsv(text = '') {
  const lines = String(text).split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return [];
  const head = splitCsvLine(lines[0]).map(h => h.toLowerCase());
  const at = name => head.indexOf(name);

  const iName = at('name');
  const iYear = at('year');
  const iRating = at('rating');
  const iRewatch = at('rewatch');
  const iUri = at('letterboxd uri');
  // "Watched Date" is the diary export; "Date" alone is the day you logged it,
  // which is not the same thing and is the only date watched.csv has.
  const iWatched = at('watched date');
  const iDate = at('date');

  if (iName < 0) return [];

  return lines.slice(1).map(l => {
    const c = splitCsvLine(l);
    const title = c[iName];
    if (!title) return null;
    return {
      title,
      year: Number(c[iYear]) || null,
      on: (iWatched >= 0 ? c[iWatched] : c[iDate]) || null,
      rating: parseRating(iRating >= 0 ? c[iRating] : null),
      rewatch: String(iRewatch >= 0 ? c[iRewatch] : '').toLowerCase() === 'yes',
      tmdb_id: null,
      letterboxd_uri: iUri >= 0 ? c[iUri] : null,
      kind: 'movie',
      // Named for what it is: without a Watched Date column these dates are
      // when you LOGGED the film, not when you saw it.
      source: iWatched >= 0 ? 'letterboxd-csv' : 'letterboxd-csv-logdate',
    };
  }).filter(Boolean);
}

// Whether an export is the diary (per-viewing) or the film list (per-film).
// Worth reporting: importing the wrong one is not an error, it just quietly
// loses every rewatch.
export function csvKind(text = '') {
  const head = splitCsvLine(String(text).split(/\r?\n/)[0] || '').map(h => h.toLowerCase());
  if (head.includes('watched date')) return 'diary';
  if (head.includes('name')) return 'watched';
  return 'unknown';
}

/**
 * Merge imported viewings into an existing log without duplicating.
 *
 * The identity is the same one the app uses: title + date. Re-running the sync
 * every day therefore adds only what is new, and an entry you have since rated
 * by hand keeps that rating — the import only fills fields it actually carries.
 */
export function mergeInto(existing = [], incoming = [], { keyOf }) {
  const byKey = new Map(existing.map(e => [keyOf(e), e]));
  let added = 0, updated = 0;
  for (const inc of incoming) {
    const k = keyOf(inc);
    const prev = byKey.get(k);
    if (!prev) {
      byKey.set(k, { ...inc, id: `lb:${k}` });
      added++;
      continue;
    }
    const merged = { ...prev };
    let changed = false;
    for (const [f, v] of Object.entries(inc)) {
      if (v == null || v === '') continue;
      if (prev[f] == null || prev[f] === '') { merged[f] = v; changed = true; }
    }
    if (changed) { byKey.set(k, merged); updated++; }
  }
  return { entries: [...byKey.values()], added, updated };
}

// ------------------------------------------------------- the films page

// The gap the RSS feed cannot close.
//
// A Letterboxd profile has TWO counts and they are not the same number. The
// diary holds films you logged with a date; the films list holds everything you
// have ever marked watched. On this profile that is 25 against 58 — so a diary
// import alone, however correct, leaves 33 films you have seen missing from the
// app entirely, with no error anywhere to say so.
//
// letterboxd.com/<user>/films/ is public HTML and carries the film name, year
// and your rating in data attributes. Parsed with a regex rather than a DOM
// because this runs on a runner with no browser, and because the attributes are
// stable in a way the surrounding markup is not.
//
// These arrive with NO DATE, and that is the honest outcome: Letterboxd does not
// know when you watched them either. They land in the app's undated bucket,
// where they count toward totals and stay out of the diary.
export function parseFilmsHtml(html = '') {
  // ONE CHUNK PER LIST ITEM. This is the whole correctness argument.
  //
  // The first version split on `data-film-slug="`, which looks equivalent and is
  // not: each chunk then ran from one slug to the NEXT, and Letterboxd emits the
  // poster's name BEFORE its slug —
  //
  //   <li> <div ... data-item-name="Aladdin (1992)" data-item-slug="aladdin">
  //        <img alt="Aladdin"> <span class="rating rated-8"> </li>
  //
  // — so the first `data-item-name` after slug[i] belonged to film[i+1]. Every
  // title was attached to the wrong film while the rating came from the right
  // one, which is the worst possible combination: the set of titles was correct,
  // so a diff of titles found nothing wrong, and the counts only disagreed by
  // one because two neighbours happened to share a name after the year was
  // stripped. Meanwhile every star rating was silently on the wrong film.
  //
  // Splitting on the element makes the mistake structurally impossible: a name
  // and a slug can only pair if they are inside the same <li>.
  const items = String(html).split(/<li\b/i).slice(1);
  const out = [];
  const seen = new Set();
  for (const it of items) {
    const slug = (it.match(/data-(?:film|item)-slug="([^"]+)"/) || [])[1];
    if (!slug || seen.has(slug)) continue;
    const raw = (it.match(/data-(?:film|item)-name="([^"]*)"/) || [])[1]
      || (it.match(/alt="([^"]*)"/) || [])[1] || '';
    if (!raw) continue;
    seen.add(slug);
    // The name attribute carries "Title (Year)"; the img alt carries the bare
    // title. Either is accepted, and the year is taken from whichever has it.
    const inline = decodeEntities(raw).match(/^(.*?)\s*\((\d{4})\)\s*$/);
    const title = (inline ? inline[1] : decodeEntities(raw)).trim();
    if (!title) continue;
    const year = Number(
      (it.match(/data-(?:film|item)-release-year="(\d{4})"/) || [])[1] || (inline ? inline[2] : ''),
    ) || null;
    const rated = (it.match(/rated-(\d+)/) || [])[1];
    out.push({
      title,
      year,
      on: null,                       // Letterboxd does not know either
      rating: rated ? Number(rated) / 2 : null,
      rewatch: false,
      tmdb_id: null,
      letterboxd_slug: slug,
      kind: 'movie',
      source: 'letterboxd-films',
    });
  }
  return out;
}

// Whether the films page has another page after this one.
export function hasNextPage(html = '') {
  return /class="[^"]*next[^"]*"[^>]*href="([^"]+)"/i.test(String(html));
}

/**
 * Films from the list that are NOT already in the diary.
 *
 * Without this, every film you logged with a date would be added a SECOND time
 * as an undated viewing — the diary entry and the films-list entry are the same
 * film seen once, and they have different keys. Matched on title, not on date,
 * precisely because the whole point is that one side has no date.
 */
export function onlyMissing(films = [], existing = []) {
  const t = v => String(v || '').toLowerCase().trim();

  // Two sets, because "already known" means different things depending on how
  // much the existing entry knows about itself.
  //
  // The first version matched on TITLE ALONE, which was right for the diary —
  // a dated viewing and its films-list twin are the same film — and wrong the
  // moment two different films share a title. This profile has two called
  // "Home Alone". The first import added one of them; every import after that
  // filtered BOTH out as already-present, so the second was permanently
  // unreachable and the count sat one short of the profile forever.
  //
  // Fixing the merge key alone did not help: nothing that gets filtered here
  // ever reaches the merge.
  const exact = new Set();      // title|year — enough to tell the two apart
  const titleOnly = new Set();  // title, for entries with no year to compare

  for (const e of existing) {
    const title = t(e.title);
    if (!title) continue;
    if (e.year) exact.add(`${title}|${e.year}`);
    // An entry with no year cannot be distinguished from a same-titled film, so
    // it blocks the title outright. Conservative on purpose: a missing film is
    // recoverable by adding the year, a duplicated one quietly inflates counts.
    else titleOnly.add(title);
  }

  return films.filter(f => {
    const title = t(f.title);
    if (titleOnly.has(title)) return false;
    if (f.year && exact.has(`${title}|${f.year}`)) return false;
    // A films-list entry with no year, when everything known carries one: let it
    // through and let the merge key decide. It will fold into any existing
    // entry that also lacks a year.
    if (!f.year && [...exact].some(k => k.startsWith(`${title}|`))) return false;
    return true;
  });
}
