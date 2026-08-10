// Server-side Letterboxd bits: the films page, which only the worker fetches.
//
// The PARSERS live in src/lib/letterboxd.js and are re-exported here, because
// the browser needs the same ones for the CSV import. One implementation, two
// callers — a second copy is a second thing to fix and only one of them ever
// gets fixed.
export {
  parseRating, decodeEntities, reviewOf, parseRss, splitCsvLine, parseCsv,
  csvKind, mergeInto,
} from '../../src/lib/letterboxd.js';

import { decodeEntities } from '../../src/lib/letterboxd.js';

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
