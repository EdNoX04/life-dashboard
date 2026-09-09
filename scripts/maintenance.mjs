// Weekly maintenance — DB hygiene and a health check, in the cloud.
//
// Runs on GitHub Actions with the service key. Nothing here needs Neel's laptop
// to be on, which is the entire reason it exists.
//
// WHAT IT REPLACES, AND WHY THAT MATTERS
//
// A Cowork scheduled task tried to do this weekly and failed EVERY SINGLE
// FIRING from 2026-07-21 to 2026-09-01 — five recorded attempts, each one
// rediscovering that Supabase is unreachable from a headless session:
// PROVENANCE_REQUIRED on WebFetch, a blocked CONNECT from the container's own
// curl, and no repo access on api.github.com either. Zero database hygiene has
// ever run. The replacement was written on 2026-08-04 and sat uninstalled for
// five weeks while the task kept failing on schedule.
//
// GitHub Actions is the one channel that works unattended, which is why the
// brief, the news and the prices already live there.
//
// HOW IT REPORTS
//
// A healthy run is SILENT. If something needs Neel it exits non-zero, GitHub
// emails him, and the reason is in memory.maintenance_last where the app can
// read it. That is the replacement for the Cowork push, and it is better: an
// email arrives whether or not any browser is open.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, optionally GITHUB_TOKEN + GITHUB_REPOSITORY.

import { QUIET_AFTER_H } from '../src/lib/notify.js';

const URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const KEY = process.env.SUPABASE_SERVICE_KEY || '';

const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const rest = (p, init = {}) => fetch(`${URL}/rest/v1/${p}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
const json = async p => { try { return await (await rest(p)).json(); } catch { return null; } };
const iso = d => new Date(d).toISOString();
const daysAgo = n => iso(Date.now() - n * 86400000);

/** How many rows a DELETE/PATCH actually touched. */
async function affected(p, init) {
  const r = await rest(p, { ...init, headers: { Prefer: 'return=representation' } });
  if (!r.ok) throw new Error(`${init.method} ${p.split('?')[0]}: ${r.status} ${(await r.text()).slice(0, 120)}`);
  const rows = await r.json();
  return Array.isArray(rows) ? rows.length : 0;
}

const hoursSince = (t, now) => {
  const ms = Date.parse(t || '');
  return Number.isFinite(ms) ? (now.getTime() - ms) / 3600000 : null;
};

/**
 * Everything that needs a person, from the state of the database.
 *
 * Pure, so every rule below is a test rather than something discovered in
 * production a month later. It returns NOTES — each one a sentence naming the
 * thing and what is wrong with it. An empty list means a silent, healthy run.
 */
export function assess({
  syncStatus = null, vaultInbox = [], brainIndex = null, pricesLast = null,
  counts = {}, latestBrief = null, now = new Date(),
} = {}) {
  const notes = [];

  // ---- tables that must not be empty -------------------------------------
  // Empty is different from stale and much worse: a screen with no rows renders
  // as a clean empty state, which looks deliberate.
  for (const [table, label] of [['investments', 'investments'], ['subjects', 'subjects'], ['timetable', 'timetable']]) {
    if (counts[table] === 0) notes.push(`${label} is EMPTY — the tab is rendering a clean empty state over nothing`);
  }

  // ---- the brief -----------------------------------------------------------
  const briefH = hoursSince(latestBrief, now);
  if (latestBrief == null) notes.push('no brief has ever been written');
  else if (briefH > 48) notes.push(`the latest brief is ${Math.round(briefH / 24)} days old — daily-brief.yml has stopped`);

  // ---- every worker in sync_status ----------------------------------------
  //
  // Two failures, and the second one is the one that hides. A worker reporting
  // ok:false is announced. A worker that simply STOPPED still reads ok:true and
  // goes quiet — `ai` sat like that for nine days. QUIET_AFTER_H is imported
  // from the app rather than copied so the two cannot disagree about what a
  // worker's normal cadence is.
  if (syncStatus && typeof syncStatus === 'object') {
    for (const [worker, s] of Object.entries(syncStatus)) {
      if (!s || typeof s !== 'object') continue;
      if (s.configured === false) continue;
      const h = hoursSince(s.at, now);
      if (s.ok === false) {
        notes.push(`${worker} sync is failing${s.reason ? ` — ${String(s.reason).slice(0, 90)}` : ''}`);
      } else if (QUIET_AFTER_H[worker] && h != null && h > QUIET_AFTER_H[worker]) {
        notes.push(`${worker} sync has gone quiet — nothing for ${Math.round(h)}h, normally every ${QUIET_AFTER_H[worker]}h`);
      }
    }
  } else {
    notes.push('memory.sync_status is missing — no worker is reporting at all');
  }

  // ---- a ticker nothing can price ------------------------------------------
  const failed = Array.isArray(pricesLast?.failed) ? pricesLast.failed : [];
  if (failed.length) notes.push(`prices-sync cannot price ${failed.join(', ')} — its last_price is frozen`);

  // ---- notes that never became files ---------------------------------------
  const rejected = vaultInbox.filter(r => r?.status === 'rejected');
  const stuck = vaultInbox.filter(r => {
    if (r?.status !== 'pending') return false;
    const h = hoursSince(r.created_at, now);
    return h != null && h > 1;   // inbox.yml runs every 15 minutes
  });
  if (rejected.length) notes.push(`${rejected.length} vault note(s) were rejected and never reached the vault — ${rejected[0].reason || 'no reason recorded'}`);
  if (stuck.length) notes.push(`${stuck.length} vault note(s) queued over an hour — the brain repo's inbox runner may have stopped`);

  // ---- the vault index -----------------------------------------------------
  const idxH = hoursSince(brainIndex?.built, now);
  if (brainIndex && idxH != null && idxH > 24 * 21) {
    notes.push(`the vault index was last built ${Math.round(idxH / 24)} days ago`);
  }

  return { notes };
}

// ---------------------------------------------------------------- the run

async function count(table) {
  const r = await rest(`${table}?select=*&limit=1`, { headers: { Prefer: 'count=exact' } });
  const cr = r.headers.get('content-range') || '';
  const n = Number(cr.split('/')[1]);
  return Number.isFinite(n) ? n : null;
}

async function main() {
  if (!URL || !KEY) { console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }
  const now = new Date();
  const did = [];

  // ---- hygiene -------------------------------------------------------------
  //
  // NOT INCLUDED: purging orphaned habit_logs. The ready-made version of this
  // job did that, and the schema says it cannot happen —
  // `habit_id uuid references habits(id) ON DELETE CASCADE`. Postgres has been
  // doing it since the table was created. A check that can only ever report
  // zero is not a safety net, it is a line that makes the report look thorough.
  did.push(`requests_failed=${await affected(
    `requests?status=in.(working,pending)&created_at=lt.${daysAgo(2)}`,
    { method: 'PATCH', body: JSON.stringify({ status: 'failed', response: 'timed out — no worker picked it up' }) })}`);

  did.push(`news_purged=${await affected(`news?created_at=lt.${daysAgo(7)}`, { method: 'DELETE' })}`);

  // The extension writes `amizone_raw` and the parser writes `amizone_raw_diary`.
  // Only the dated, superseded blobs are old enough to go; the live ones are
  // rewritten every run and never reach fourteen days.
  did.push(`amizone_blobs=${await affected(`memory?key=like.amizone_raw*&updated_at=lt.${daysAgo(14)}`, { method: 'DELETE' })}`);

  // ---- read the state ------------------------------------------------------
  const mem = await json('memory?key=in.(sync_status,brain_index,prices_last_sync)&select=key,value') || [];
  const at = k => mem.find(r => r.key === k)?.value ?? null;
  const briefRow = await json('briefs?select=created_at&order=created_at.desc&limit=1');
  const counts = {};
  for (const t of ['investments', 'subjects', 'timetable', 'portfolio_snapshots']) counts[t] = await count(t);
  const inbox = await json(`vault_inbox?select=status,reason,created_at&created_at=gt.${daysAgo(7)}`) || [];

  const { notes } = assess({
    syncStatus: at('sync_status'),
    brainIndex: at('brain_index'),
    pricesLast: at('prices_last_sync'),
    vaultInbox: inbox,
    counts,
    latestBrief: briefRow?.[0]?.created_at || null,
    now,
  });

  // ---- the GitHub side, when a token is present ---------------------------
  const repo = process.env.GITHUB_REPOSITORY;
  const tok = process.env.GITHUB_TOKEN;
  if (repo && tok) {
    for (const wf of ['prices-sync.yml', 'daily-brief.yml', 'meetings-sync.yml']) {
      try {
        const r = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${wf}/runs?per_page=1`,
          { headers: { Authorization: `Bearer ${tok}`, Accept: 'application/vnd.github+json' } });
        const c = (await r.json())?.workflow_runs?.[0]?.conclusion;
        if (c && c !== 'success') notes.push(`${wf} last run: ${c}`);
      } catch { /* the workflow check is not worth failing the run over */ }
    }
  }

  const report = {
    at: now.toISOString(),
    did,
    counts,
    ok: notes.length === 0,
    notes,
  };
  console.log(JSON.stringify(report, null, 2));

  await rest('memory?on_conflict=key', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify([{ key: 'maintenance_last', value: report, updated_at: now.toISOString() }]),
  });

  // Silent when healthy. Loud — and therefore an email — only when something
  // needs him. A weekly "everything is fine" trains you to delete the email
  // unread, and then the one that matters goes with it.
  if (notes.length) {
    for (const n of notes) console.error(`::warning::${n}`);
    process.exit(1);
  }
  console.log('healthy — nothing needs you');
}

if (process.argv[1] && process.argv[1].endsWith('maintenance.mjs')) {
  main().catch(e => { console.error(e); process.exit(1); });
}
