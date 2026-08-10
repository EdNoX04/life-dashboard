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

import { parseRss, mergeInto } from './lib/letterboxd.mjs';

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

// The same identity the app uses: a viewing is a title on a date. Not the
// rating — re-rating a film edits the viewing rather than creating a second one.
const keyOf = e => `${String(e.title || '').toLowerCase().trim()}|${e.on || 'undated'}`;

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
  const { entries: merged, added, updated } = mergeInto(existing, entries, { keyOf });

  await memSet('media_log', { entries: merged });

  // The oldest thing the feed reached. If a first import stops here, the diary
  // genuinely begins on that date and the user should know the number is a
  // floor, not a total.
  const oldest = entries.map(e => e.on).filter(Boolean).sort()[0] || null;

  console.log(`+${added} new · ${updated} filled in · ${merged.length} viewings total`);
  console.log(`feed reaches back to ${oldest}`);
  if (existing.length === 0) {
    console.log('FIRST IMPORT: the RSS feed is capped at ~50 entries, so anything');
    console.log('older than the date above is NOT here. Export diary.csv from');
    console.log('Letterboxd (Settings → Import & Export) for the full history.');
  }

  await reportStatus({
    ok: true, configured: true, reason: '',
    added, updated, total: merged.length, oldest, user: LETTERBOXD_USER,
  });
}

run().catch(async e => {
  console.error(e);
  await reportStatus({ ok: false, configured: true, reason: String(e.message || e).slice(0, 400) });
  process.exit(1);
});
