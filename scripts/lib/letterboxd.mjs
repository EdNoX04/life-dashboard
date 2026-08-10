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
