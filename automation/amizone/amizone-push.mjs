#!/usr/bin/env node
/**
 * amizone-push.mjs — the second half of amizone-auto.mjs, with the browser removed.
 *
 * amizone-auto.mjs did two jobs in one process: drive a browser that holds the
 * Amizone session, and shape+push what it read. The browser half is what has
 * never worked reliably off a residential machine (Turnstile refuses datacenter
 * IPs, and Chrome will not hand a session cookie to a second profile). So the
 * two halves are split:
 *
 *   1. the READ happens in a real browser on Neel's Mac, driven over the
 *      browser pane, and produces a plain JSON payload — no credentials in it,
 *      just his own attendance numbers;
 *   2. this file does the shaping and the Supabase writes, anywhere with
 *      network — the cloud container included.
 *
 * The Supabase service key is read straight out of the config file (or the
 * environment) and is never printed, logged, or echoed back. It is not passed
 * on the command line, where it would land in shell history and `ps`.
 *
 *   node amizone-push.mjs --payload scrape.json --config amizone.config.json
 *   node amizone-push.mjs --payload scrape.json --dry-run     # no writes
 */
import fs from 'node:fs';
import crypto from 'node:crypto';

const argv = process.argv.slice(2);
const arg = (name, def = null) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? def : argv[i + 1];
};
const DRY = argv.includes('--dry-run');

const PAYLOAD_PATH = arg('payload');
const CFG_PATH = arg('config');
if (!PAYLOAD_PATH) { console.error('need --payload <file.json>'); process.exit(2); }

const cfg = CFG_PATH && fs.existsSync(CFG_PATH)
  ? JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'))
  : {};
const SUPA_URL = String(process.env.SUPABASE_URL || cfg.supabaseUrl || '').replace(/\/$/, '');
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY || cfg.supabaseServiceKey || cfg.supabaseKey || '';
// The timetable now comes from Amizone. It used to default OFF for a good
// reason — the derivation unioned makeups and both lab batches into a noisy
// superset — but that was downstream of a bug: the diary was being asked for a
// 74-day range, past the endpoint's silent range cliff, so it returned no
// classes at all. Fetched in 28-day chunks and filtered to what recurs, the
// derived grid matches the real one. Set AMIZONE_SYNC_TIMETABLE=false (or
// syncTimetable: false in the config) to go back to a hand-maintained table.
const SYNC_TT = process.env.AMIZONE_SYNC_TIMETABLE === 'false' ? false
  : cfg.syncTimetable === false ? false
  : true;
// Never replace a healthy timetable with a suspiciously thin one. A scrape that
// half-worked used to DELETE everything and insert whatever it had — the exact
// failure that wiped the table in August and reported success.
const COLLAPSE_RATIO = 0.5;

// A placeholder is not a key — and neither is the PUBLISHABLE key, which is the
// trap this check originally walked into. `sb_publishable_…` starts with `sb_`,
// so a `/^(sb_|eyJ)/` test passes it happily; the failure then arrives from
// Postgres as `401 42501 new row violates row-level security policy`, which
// reads like a broken policy rather than the wrong key. The publishable key
// ships in the browser bundle; it is public and cannot write.
const keyLooksReal = /^(sb_|eyJ)/.test(SUPA_KEY) && !/publishable|anon/i.test(SUPA_KEY);
if (!DRY && (!SUPA_URL || !keyLooksReal)) {
  console.error('FATAL: no usable Supabase service key.');
  console.error('  Put it in the config file as "supabaseServiceKey", or set SUPABASE_SERVICE_KEY.');
  const why = !SUPA_KEY ? 'MISSING'
    : /publishable|anon/i.test(SUPA_KEY) ? 'is the PUBLISHABLE key — use the SECRET one'
    : 'present but not a Supabase key';
  console.error(`  (url ${SUPA_URL ? 'ok' : 'MISSING'}, key ${why})`);
  process.exit(2);
}

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const supaHeaders = (extra = {}) => ({
  apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json', ...extra,
});
async function supa(pathq, opts = {}) {
  if (DRY) { log('DRY', opts.method || 'GET', pathq); return null; }
  const r = await fetch(`${SUPA_URL}/rest/v1/${pathq}`, { ...opts, headers: supaHeaders(opts.headers) });
  if (!r.ok) throw new Error(`Supabase ${pathq}: ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json().catch(() => null);
}
async function upsertMemory(key, value) {
  await supa('memory', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify([{ key, value, updated_at: new Date().toISOString() }]),
  });
}
async function reportStatus(patch) {
  try {
    const rows = await supa('memory?key=eq.sync_status&select=value');
    const value = rows?.[0]?.value || {};
    await upsertMemory('sync_status', { ...value, amizone: { ...patch, at: new Date().toISOString() } });
  } catch (e) {
    console.error('  (could not record sync status:', String(e.message || e) + ')');
  }
}

// ---- date helpers, copied verbatim from amizone-auto.mjs ----
function isoFromDMY(s) {
  const m = String(s).trim().match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (!m) return null;
  const [, d, mo, y] = m;
  const yr = y.length === 2 ? '20' + y : y;
  return `${yr}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function dayFromIso(iso) { const dt = new Date(iso + 'T00:00:00'); return DAYS[dt.getDay()] || ''; }
function parseAmzDT(s) {
  const m = String(s || '').match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?/i);
  if (!m) return null;
  let [, y, mo, d, hh, mm, ap] = m;
  hh = parseInt(hh, 10);
  if (ap) { const p = ap.toUpperCase(); if (p === 'PM' && hh !== 12) hh += 12; if (p === 'AM' && hh === 12) hh = 0; }
  return { iso: `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`, hm: `${String(hh).padStart(2, '0')}:${mm}` };
}

async function main() {
  const data = JSON.parse(fs.readFileSync(PAYLOAD_PATH, 'utf8'));
  if (data.needLogin) throw new Error('payload says needLogin — the browser session is dead, nothing scraped');

  const courses = (data.courses || []).filter(c => c.code || c.attId);
  if (!courses.length) throw new Error('payload has no courses — refusing to overwrite good data with nothing');

  const logCourses = courses.map(c => {
    const records = (c.records || []).map(r => {
      const iso = isoFromDMY(r.dateRaw);
      const status = r.present === 0 ? 'absent' : r.absent === 0 ? 'present' : 'partial';
      return iso ? { date: iso, day: dayFromIso(iso), timings: r.timings, present: r.present, absent: r.absent, status } : null;
    }).filter(Boolean).sort((a, b) => (a.date < b.date ? -1 : 1));

    // Electives and Foreign Business Language have no day-wise page — Amizone
    // only publishes the running total for them. Counting their days from an
    // empty records list would report Spanish as 0 classes held, which reads as
    // "nothing to worry about" when the truth is one class held and one missed.
    // Fall back to the attended/held pair off MyCourses.
    const hasRecords = records.length > 0;
    const present = hasRecords
      ? records.reduce((s, r) => s + (r.status !== 'absent' ? 1 : 0), 0)
      : (c.attended ?? 0);
    const total = hasRecords ? records.length : (c.held ?? 0);

    return {
      code: c.code, name: c.name,
      present, absent: total - present, total,
      // null, never 0. A course with no classes held yet (Industry Internship,
      // Minor Project) is not a course at 0% attendance, and the dashboard must
      // be able to tell those apart.
      pct: c.pct ?? null,
      detail: hasRecords ? 'day-wise' : (c.held != null ? 'totals-only' : 'none'),
      records,
    };
  });

  // ---- weekly timetable, derived from the diary ----
  // A real weekly class recurs on the same weekday and time across weeks; a
  // makeup or an extra session does not. Grouping by weekday|time|subject and
  // keeping only what appears on 2+ distinct dates is what separates them.
  // Measured over August: 16 slots at x4, Friday IoT at x3 (one week missed),
  // and a pair of Wednesday CSE337 slots at x1 — the makeups, correctly dropped.
  // Friday came out with exactly one IoT class, which is what Neel has been
  // saying all along against a photo-derived grid that showed more.
  //
  // Only the last RECURRENCE_DAYS are considered. Reaching further back drags in
  // the previous timetable revision and unions it with the current one.
  const RECURRENCE_DAYS = 35;
  const cutoff = new Date(Date.now() - RECURRENCE_DAYS * 86400000);
  const groups = {};
  for (const e of (data.events || [])) {
    const t = String(e.sType || '').toUpperCase();
    if (t === 'H' || t === 'E' || e.allDay === true) continue;
    const when = parseAmzDT(e.start);
    if (!when || new Date(when.iso + 'T00:00:00') < cutoff) continue;
    const sdt = parseAmzDT(e.start), edt = parseAmzDT(e.end);
    const st = sdt?.hm, et = edt?.hm || '', iso = sdt?.iso;
    const day = iso ? dayFromIso(iso) : '';
    const subject = (e.title || e.code || '').trim();
    if (!day || !st || st === '00:00' || !subject) continue;
    const k = `${day}|${st}|${subject}`;
    const g = groups[k] || (groups[k] = { day, start_time: st, end_time: et, subject, room: e.room || '', faculty: e.faculty || '', dates: new Set() });
    g.dates.add(iso);
    if (!g.room && e.room) g.room = e.room;
    if (!g.faculty && e.faculty) g.faculty = e.faculty;
  }
  const allSlots = Object.values(groups);
  let picked = allSlots.filter(g => g.dates.size >= 2);
  if (!picked.length) picked = allSlots;
  const ttRows = picked.map(g => ({
    id: crypto.randomUUID(), created_at: new Date().toISOString(),
    day: g.day, start_time: g.start_time, end_time: g.end_time, subject: g.subject, room: g.room, faculty: g.faculty,
  }));

  // ---- placement drives ----
  //
  // Guarded, not merged. If a run parses zero drives — a logged-out capture, a
  // markup change, a page that timed out — the previous list stays. Overwriting
  // a list of live deadlines with an empty array would turn a parsing failure
  // into a silently empty Placement card, which is precisely the failure mode
  // this whole feature exists to prevent.
  const placements = Array.isArray(data.placements) ? data.placements : [];
  if (placements.length) {
    const open = placements.filter(p => p.status !== 'closed' && p.status !== 'ineligible'
      && p.end && Date.parse(p.end) > Date.now()).length;
    await upsertMemory('amizone_placements', {
      at: new Date().toISOString(),
      count: placements.length,
      open,
      rows: placements.slice(0, 200),
    }).catch(() => {});
    log(`placements: ${placements.length} written (${open} open)`);
  } else {
    log('placements: none parsed — keeping whatever is already stored');
  }

  await upsertMemory('amizone_raw_diary', {
    at: new Date().toISOString(), window: data.window || null,
    events: (data.events || []).map(e => ({ start: e.start, end: e.end, title: e.title, code: e.code, room: e.room, faculty: e.faculty, sType: e.sType })).slice(0, 400),
    picked: ttRows.map(r => `${r.day} ${r.start_time}-${r.end_time} ${r.subject}`).sort(),
  }).catch(() => {});

  // PATCH silently matches nothing when the subject isn't in the table — which is
  // how a newly discovered course (Spanish, say) can be scraped correctly and
  // still never appear on the dashboard. Ask for the representation back so a
  // no-op is visible instead of looking like a success.
  const unmatched = [];
  const patch = async (filter, pct) => {
    const res = await supa(`subjects?${filter}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ attendance_pct: pct }),
    });
    return DRY ? 1 : (Array.isArray(res) ? res.length : 0);
  };
  for (const c of courses) {
    if (c.pct == null) continue;
    try {
      let hit = c.code ? await patch(`code=eq.${encodeURIComponent(c.code)}`, c.pct) : 0;
      // Rows added by hand in the Subjects tab have an optional code, so a
      // subject can exist on the dashboard with code null and never be matched
      // by the code filter — the percentage is written to nothing and the row
      // shows "—" forever, looking exactly like a course with no data. Fall back
      // to the name Amizone gives, which is the string that row was named from.
      if (!hit && c.name) hit = await patch(`name=eq.${encodeURIComponent(c.name)}`, c.pct);
      if (!hit) unmatched.push(`${c.code || '?'} (${c.name})`);
      else if (!DRY) log(`   subjects: ${c.code || c.name} → ${c.pct}%`);
    } catch (e) { log('subject patch', c.code, String(e)); }
  }
  if (unmatched.length) log(`subjects: NO ROW MATCHES ${unmatched.join('; ')} — add them in the Subjects tab or the % goes nowhere`);

  let ttWritten = 0;
  if (!SYNC_TT) {
    log(`timetable: sync disabled (${ttRows.length} slots parsed, left alone)`);
  } else if (!ttRows.length) {
    log('timetable: parsed 0 recurring slots — left alone rather than wiped');
  } else {
    const before = (await supa('timetable?select=id').catch(() => null))?.length ?? 0;
    if (before && ttRows.length < before * COLLAPSE_RATIO) {
      log(`timetable: REFUSED — ${ttRows.length} slots would replace ${before}; that is a collapse, not an update`);
      await reportStatus({ ok: false, configured: true, reason: `timetable collapse refused (${ttRows.length} vs ${before})` }).catch(() => {});
    } else {
      await supa('timetable?id=not.is.null', { method: 'DELETE' }).catch(() => {});
      await supa('timetable', { method: 'POST', body: JSON.stringify(ttRows) }).catch(e => log('timetable insert', String(e)));
      ttWritten = ttRows.length;
      log(`timetable: ${ttRows.length} recurring slots written, replacing ${before} (from ${allSlots.length} distinct diary slots)`);
    }
  }

  await upsertMemory('attendance_log', { updated: new Date().toISOString(), courses: logCourses });
  await upsertMemory('amizone_last_sync', {
    at: new Date().toISOString(), ok: true, via: 'browser-pane',
    subjects: courses.length, classes: ttWritten,
  });
  // session comes from the cookie path only; the browser-pane path has no ticket
  // of its own to age. Surfacing it here is what turns "how long will this last?"
  // from a guess into a number on the dashboard.
  await reportStatus({
    ok: true, configured: true, reason: '',
    via: data.session ? 'cookie' : 'browser-pane',
    subjects: courses.length, classes: ttWritten,
    ...(data.session ? { session_age_hours: data.session.age_hours, session_renewed: data.session.renewed_this_run } : {}),
  });

  log(`DONE · ${courses.length} subjects, day-wise for ${logCourses.filter(c => c.records.length).length} courses`);
  // Print the SHAPED record count, not the raw one. A date Amizone formats in a
  // way isoFromDMY misses is silently dropped, and printing the raw length would
  // report a healthy day count for a course whose days all failed to parse.
  logCourses.forEach(c => {
    const raw = (courses.find(x => x.code === c.code && x.name === c.name)?.records || []).length;
    const drop = raw - c.records.length;
    const shape = c.detail === 'day-wise' ? `${c.present}/${c.total} days${drop ? `, ${drop} unparsed` : ''}`
      : c.detail === 'totals-only' ? `${c.present}/${c.total}, totals only`
      : 'no classes held';
    log(`   ${(c.code || '—').padEnd(8)} ${String(c.pct ?? '—').padStart(3)}%  (${shape})`);
  });
}

main().catch(async (e) => {
  console.error('FATAL', e.message || e);
  await reportStatus({ ok: false, configured: true, reason: String(e.message || e).slice(0, 300) }).catch(() => {});
  process.exitCode = 1;
});
