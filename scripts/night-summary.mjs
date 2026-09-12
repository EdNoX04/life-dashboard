// The night summary — the evening mirror of daily-brief.mjs.
//
// Runs on GitHub Actions at 22:30 IST and writes `memory.night_summary`, which
// HQ renders after dark. Same channel as the brief for the same reason: it is
// the one that works with no laptop on and no browser open.
//
// THE READ IS THE WHOLE PROBLEM.
//
// daily-brief.mjs reads with a helper that returns `[]` when a fetch fails.
// That is fine for a brief — a missing section reads as a thin morning. It
// would be actively harmful here, because `[]` and "not measured" are the two
// things src/lib/nightly.js exists to keep apart: an empty array means YOU DID
// NOTHING and gets rendered as a zero. focus_sessions in particular may not
// exist at all yet (migration 009), and reporting "0m focused" on a night when
// there was no table to write to would be a lie that reads as a rebuke.
//
// So `table()` below returns null on ANY failure, including a 404 for a table
// that was never created, and every one of those nulls surfaces on screen as a
// named gap instead of a number.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY.

import { nightly, headline } from '../src/lib/nightly.js';
import { dayRows } from '../src/lib/today.js';
import { agendaFor } from '../src/lib/agenda.js';

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { console.error('Missing Supabase env'); process.exit(1); }

const H = { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' };
const rest = (p, init = {}) => fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${p}`, { ...init, headers: { ...H, ...(init.headers || {}) } });

const missing = [];
/** null on any failure — see the note above. Never []. */
async function table(path, label) {
  try {
    const r = await rest(path);
    if (!r.ok) { missing.push(`${label}: ${r.status}`); return null; }
    const j = await r.json();
    return Array.isArray(j) ? j : null;
  } catch (e) { missing.push(`${label}: ${e.message}`); return null; }
}

// IST, because the day this summarises is his day, not UTC's.
const IST = 5.5 * 3600 * 1000;
const z = n => String(n).padStart(2, '0');
const istNow = new Date(Date.now() + IST);
const dayOf = d => `${d.getUTCFullYear()}-${z(d.getUTCMonth() + 1)}-${z(d.getUTCDate())}`;
const TODAY = dayOf(istNow);

async function main() {
  const [todos, habits, habitLogs, focusSessions, snapshots, builds, timetable, memRows] = await Promise.all([
    table('todos?select=id,title,completed,completed_at,due_date', 'todos'),
    table('habits?select=id,name', 'habits'),
    table(`habit_logs?select=habit_id,date&date=gte.${TODAY}`, 'habit_logs'),
    table(`focus_sessions?select=mode,label,minutes,ended_at&ended_at=gte.${TODAY}`, 'focus_sessions'),
    table('portfolio_snapshots?select=date,total_value&order=date.desc&limit=8', 'portfolio_snapshots'),
    table('builds?select=name,status,updated_at', 'builds'),
    table('timetable?select=day,subject,code,start_time,end_time,room', 'timetable'),
    table('memory?select=key,value&key=in.(amizone_raw_diary,calendar_events,meetings,media_log)', 'memory'),
  ]);

  const mem = k => (memRows || []).find(r => r.key === k)?.value ?? null;

  // Today as it actually was, and tomorrow as it is going to be. Both go
  // through the same functions the app uses, so the summary cannot disagree
  // with the screen about what was on.
  const noonToday = new Date(Date.parse(`${TODAY}T12:00:00Z`) - IST);
  const dayView = timetable ? dayRows(mem('amizone_raw_diary'), timetable, noonToday) : null;

  const tmr = new Date(noonToday.getTime() + 86400000);
  const tmrISO = dayOf(new Date(tmr.getTime() + IST));
  const tomorrow = timetable ? agendaFor(tmrISO, {
    classes: dayRows(mem('amizone_raw_diary'), timetable, tmr),
    events: mem('calendar_events')?.events || [],
    meetings: mem('meetings')?.list || [],
    todos: todos || [],
  }) : null;

  const summary = nightly({
    date: TODAY, todos, habits, habitLogs, focusSessions, snapshots, builds,
    viewings: mem('media_log')?.list ?? null,
    dayView, tomorrow,
  });

  const payload = {
    ...summary,
    headline: headline(summary),
    // Said in the blob rather than only in this log, so the app can show that a
    // section is absent because a READ FAILED tonight — which is different from
    // a source that has never existed, and only one of those is worth chasing.
    readFailures: missing,
    updated: new Date().toISOString(),
  };

  await rest('memory?on_conflict=key', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify([{ key: 'night_summary', value: payload, updated_at: new Date().toISOString() }]),
  });

  console.log(`night summary for ${TODAY} — ${payload.headline}`);
  console.log(`  ${summary.sections.length} section(s): ${summary.sections.map(s => s.key).join(', ') || 'none'}`);
  for (const g of summary.notMeasured) console.log(`  · not measured — ${g.what}: ${g.why}`);
  if (missing.length) console.log(`  · reads that failed: ${missing.join('; ')}`);

  // A summary with nothing in it at all means every read failed, and that is a
  // broken job rather than a quiet day — it should go red rather than write an
  // empty page every night for a month.
  if (summary.empty) { console.error('::warning::every source was empty or unreadable'); process.exit(1); }
}

main().catch(e => { console.error(e); process.exit(1); });
