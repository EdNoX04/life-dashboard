// Pull the Letterboxd diary into media_log.
//
// Runs on a GitHub runner, not in the browser, for one hard reason:
// letterboxd.com sends no CORS header, so the app's own fetch would be refused
// after the response had already arrived. Same wall the Stooq benchmark feed
// hit. No API key is needed and nothing is scraped from a logged-in session —
// the RSS feed is public.
//
// WHAT THIS DOES AND DOES NOT COVER.
// The feed carries roughly the last fifty diary entries. That is the right
// surface for keeping up to date and the wrong one for a first import: run it
// alone and you get a diary that begins fifty films ago and looks complete.
// The full history lives in the CSV export (Letterboxd → Settings → Import &
// Export → Export your data), which is handled by the same parser — drop
// diary.csv in payloads/ and it is imported once. This job reports the gap
// rather than papering over it.
//
// Env:
//   SUPABASE_URL, SUPABASE_SERVICE_KEY
//   LETTERBOXD_USER   (defaults to the profile on file)

import { parseRss, parseFilmsHtml, onlyMissing, hasNextPage, mergeInto } from './lib/letterboxd.mjs';

const {
  SUPABASE_URL, SUPABASE_SERVICE_KEY,
  LETTERBOXD_USER = 'ednox',
} = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing Supabase env — nothing to sync against.');
  process.exit(0);
}

const SB = SUPABASE_URL.replace(/\/$/, '');
const headers = {
  apikey: SUPABASE_SERVICE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
  'Content-Type': 'application/json',
};

async function memGet(key) {
  const r = await fetch(`${SB}/rest/v1/memory?key=eq.${key}&select=value`, { headers });
  if (!r.ok) throw new Error(`supabase ${r.status}`);
  const rows = await r.json();
  return rows?.[0]?.value ?? null;
}

async function memSet(key, value) {
  const r = await fetch(`${SB}/rest/v1/memory?on_conflict=key`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify([{ key, value }]),
  });
  if (!r.ok) throw new Error(`supabase ${r.status}: ${await r.text()}`);
}

async function reportStatus(patch) {
  try {
    const cur = (await memGet('sync_status')) || {};
    await memSet('sync_status', { ...cur, letterboxd: { at: new Date().toISOString(), ...patch } });
  } catch { /* the status line is a nicety; never fail the run over it */ }
}

// The identity of a viewing: a title on a date. Not the rating — re-rating a
// film edits the viewing rather than creating a second one.
//
// The YEAR only enters the key for UNDATED entries, and it has to. Films-list
// imports carry no date, so every one of them keyed to `title|undated` — and
// this profile has two different films both called "Home Alone". They collapsed
// into a single entry and the import silently came up one short: 57 where the
// profile says 58. Nothing errored; the count was just quietly wrong, which is
// the only kind of import bug that survives.
//
// A dated entry does NOT get the year, deliberately. Two different films with
// the same title watched on the same day is vanishingly rare, while a year that
// one source knows and another does not is common — putting it in the dated key
// would break the dedupe that stops the daily sync duplicating your diary.
const keyOf = e => {
  const t = String(e.title || '').toLowerCase().trim();
  if (e.on) return `${t}|${e.on}`;
  return `${t}|undated:${e.year ?? '?'}`;
};

async function run() {
  const url = `https://letterboxd.com/${encodeURIComponent(LETTERBOXD_USER)}/rss/`;
  console.log(`reading ${url}`);

  const res = await fetch(url, { headers: { 'User-Agent': 'life-dashboard/1.0 (personal diary sync)' } });
  if (!res.ok) {
    // A 404 here is almost always a private profile or a changed username, and
    // it is worth saying which rather than "sync failed".
    const why = res.status === 404
      ? `no public feed at ${url} — the profile may be private, or the username may have changed`
      : `letterboxd returned ${res.status}`;
    await reportStatus({ ok: false, configured: true, reason: why });
    console.error(`✗ ${why}`);
    process.exit(1);
  }

  const entries = parseRss(await res.text());
  console.log(`${entries.length} diary entries in the feed`);
  if (!entries.length) {
    await reportStatus({ ok: true, configured: true, reason: 'feed carried no diary entries', added: 0 });
    return;
  }

  const blob = (await memGet('media_log')) || {};
  const existing = Array.isArray(blob.entries) ? blob.entries : [];
  let { entries: merged, added, updated } = mergeInto(existing, entries, { keyOf });

  // The other half of the profile.
  //
  // A Letterboxd account has two counts and they are not the same: the DIARY is
  // films logged with a date, the FILMS list is everything ever marked watched.
  // On this profile that is 25 against 58. Importing the diary alone is correct
  // and leaves 33 films you have seen missing from the app, with nothing
  // anywhere to say so — which is the kind of gap you only notice months later
  // when a recommendation suggests something you watched in 2023.
  //
  // These come in WITHOUT a date, because Letterboxd does not know one either.
  // They count toward totals and sit in the app's undated bucket rather than
  // being stamped with a fabricated day.
  let filmsAdded = 0;
  try {
    const films = [];
    for (let page = 1; page <= 10; page++) {
      const u = page === 1
        ? `https://letterboxd.com/${encodeURIComponent(LETTERBOXD_USER)}/films/`
        : `https://letterboxd.com/${encodeURIComponent(LETTERBOXD_USER)}/films/page/${page}/`;
      const fr = await fetch(u, { headers: { 'User-Agent': 'life-dashboard/1.0 (personal diary sync)' } });
      if (!fr.ok) break;
      const html = await fr.text();
      const batch = parseFilmsHtml(html);
      films.push(...batch);
      // Stop on an empty page as well as on a missing "next" link: a layout
      // change that breaks the pagination check must not spin ten requests.
      if (!batch.length || !hasNextPage(html)) break;
    }
    // Films-list entries are fully DERIVED: title, year and rating all come off
    // the page, and nothing on this screen is user-edited. So they are rebuilt
    // rather than merged into.
    //
    // This is not tidiness, it is repair. An earlier parser paired each title
    // with the NEXT poster's slug, which meant every imported star rating sat on
    // the wrong film. Merging would preserve that forever, because the titles
    // themselves were all present and correct as a set — only their attachments
    // were wrong, and no diff of titles could see it. Dropping and re-adding is
    // the only thing that fixes data already written.
    //
    // Dated diary entries are untouched: those carry your ratings and notes.
    if (films.length) {
      const before = merged.length;
      merged = merged.filter(e => !(e.source === 'letterboxd-films' && !e.on));
      const dropped = before - merged.length;
      if (dropped) console.log(`rebuilding ${dropped} films-list entries`);
    }

    const fresh = onlyMissing(films, merged);
    if (fresh.length) {
      const res = mergeInto(merged, fresh, { keyOf });
      merged = res.entries;
      filmsAdded = res.added;
    }
    console.log(`films list: ${films.length} watched · ${filmsAdded} added with no date`);
  } catch (e) {
    // The diary is the important half. A films-page failure is reported and
    // does not lose the import that already succeeded.
    console.error(`films list unavailable (${e.message}) — diary import stands`);
  }

  await memSet('media_log', { entries: merged });

  // The oldest thing the feed reached. If a first import stops here, the diary
  // genuinely begins on that date and the user should know the number is a
  // floor, not a total.
  const oldest = entries.map(e => e.on).filter(Boolean).sort()[0] || null;

  console.log(`+${added} dated · +${filmsAdded} undated · ${updated} filled in · ${merged.length} viewings total`);
  console.log(`feed reaches back to ${oldest}`);
  if (existing.length === 0 && entries.length >= 45) {
    // Only warn when the feed plausibly hit its cap. Saying "this may be
    // incomplete" after a complete import teaches you to ignore the warning.
    console.log('FIRST IMPORT: the feed returned ~50 entries, which is its cap, so');
    console.log('older DATED viewings may be missing. Export diary.csv from');
    console.log('Letterboxd (Settings → Import & Export) to fill them in.');
  }

  await reportStatus({
    ok: true, configured: true, reason: '',
    added, updated, filmsAdded, total: merged.length, oldest, user: LETTERBOXD_USER,
  });
}

run().catch(async e => {
  console.error(e);
  await reportStatus({ ok: false, configured: true, reason: String(e.message || e).slice(0, 400) });
  process.exit(1);
});
