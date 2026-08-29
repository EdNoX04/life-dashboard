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
// syncTimetable defaults OFF. amizone-auto.mjs carries a comment saying the
// hand-verified weekly timetable is left alone unless this is turned on — but
// the code below that comment overwrites it unconditionally, so the config flag
// has never actually done anything. Honour it here.
const SYNC_TT = cfg.syncTimetable === true || process.env.AMIZONE_SYNC_TIMETABLE === 'true';

// A placeholder is not a key. Real Supabase keys start sb_ or eyJ; anything else
// means the config was never filled in, and a run that silently no-ops is how
// three weeks of stale attendance went unnoticed the first time.
const keyLooksReal = /^(sb_|eyJ)/.test(SUPA_KEY);
if (!DRY && (!SUPA_URL || !keyLooksReal)) {
  console.error('FATAL: no usable Supabase service key.');
  console.error('  Put it in the config file as "supabaseServiceKey", or set SUPABASE_SERVICE_KEY.');
  console.error(`  (url ${SUPA_URL ? 'ok' : 'MISSING'}, key ${SUPA_KEY ? 'present but not a Supabase key' : 'MISSING'})`);
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
    const present = records.reduce((s, r) => s + (r.status !== 'absent' ? 1 : 0), 0);
    return { code: c.code, name: c.name, present, absent: records.length - present, total: records.length, pct: c.pct ?? 0, records };
  });

  // weekly timetable, same recurrence filter as amizone-auto.mjs
  const groups = {};
  for (const e of (data.events || [])) {
    const t = String(e.sType || '').toUpperCase();
    if (t === 'H' || t === 'E' || e.allDay === true) continue;
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

  await upsertMemory('amizone_raw_diary', {
    at: new Date().toISOString(), window: data.window || null,
    events: (data.events || []).map(e => ({ start: e.start, end: e.end, title: e.title, code: e.code, room: e.room, faculty: e.faculty, sType: e.sType })).slice(0, 400),
    picked: ttRows.map(r => `${r.day} ${r.start_time}-${r.end_time} ${r.subject}`).sort(),
  }).catch(() => {});

  for (const c of courses) {
    if (!c.code || c.pct == null) continue;
    await supa(`subjects?code=eq.${encodeURIComponent(c.code)}`, { method: 'PATCH', body: JSON.stringify({ attendance_pct: c.pct }) })
      .catch(e => log('subject patch', c.code, String(e)));
  }

  if (SYNC_TT && ttRows.length) {
    await supa('timetable?id=not.is.null', { method: 'DELETE' }).catch(() => {});
    await supa('timetable', { method: 'POST', body: JSON.stringify(ttRows) }).catch(e => log('timetable insert', String(e)));
    log(`timetable: ${ttRows.length} recurring slots written (from ${allSlots.length} distinct diary slots)`);
  } else {
    log(`timetable: left alone (${ttRows.length} slots parsed, syncTimetable=${SYNC_TT})`);
  }

  await upsertMemory('attendance_log', { updated: new Date().toISOString(), courses: logCourses });
  await upsertMemory('amizone_last_sync', {
    at: new Date().toISOString(), ok: true, via: 'browser-pane',
    subjects: courses.length, classes: SYNC_TT ? ttRows.length : 0,
  });
  await reportStatus({ ok: true, configured: true, reason: '', via: 'browser-pane', subjects: courses.length, classes: SYNC_TT ? ttRows.length : 0 });

  log(`DONE · ${courses.length} subjects, day-wise for ${logCourses.filter(c => c.records.length).length} courses`);
  // Print the SHAPED record count, not the raw one. A date Amizone formats in a
  // way isoFromDMY misses is silently dropped, and printing the raw length would
  // report a healthy day count for a course whose days all failed to parse.
  logCourses.forEach(c => {
    const raw = (courses.find(x => x.code === c.code && x.name === c.name)?.records || []).length;
    const drop = raw - c.records.length;
    log(`   ${(c.code || '—').padEnd(8)} ${String(c.pct ?? '—').padStart(3)}%  (${c.records.length} days${drop ? `, ${drop} unparsed` : ''})`);
  });
}

main().catch(async (e) => {
  console.error('FATAL', e.message || e);
  await reportStatus({ ok: false, configured: true, reason: String(e.message || e).slice(0, 300) }).catch(() => {});
  process.exitCode = 1;
});
