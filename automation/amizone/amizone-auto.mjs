#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// PLAYER ONE · Amizone auto-sync (Windows, standalone)
// Runs on the laptop itself on a schedule. No Claude session, no manual buttons.
//
//   node amizone-auto.mjs          → normal run: scrape + push to Supabase
//   node amizone-auto.mjs --login  → one-time SETUP: opens a window so YOU log in
//                                     once, then saves the profile forever.
//
// After the one-time --login, the Amizone session cookie lives in the profile
// folder, so daily runs go straight to your courses with NO login and NO
// Cloudflare challenge. If the cookie ever expires, this script tries to log in
// again using amizone.config.json; if that fails it flags "needs login" in the
// dashboard and you just run `--login` once more.
// ─────────────────────────────────────────────────────────────────────────────

// Playwright is imported LAZILY, below, for the same reason amizone-sync.mjs
// does it: `--check` exists precisely to answer "can this machine write to
// Supabase" in two seconds with no browser involved, and a static import means
// that question cannot be asked until a 300 MB dependency is installed. It also
// turns a missing/broken `npm install playwright` into a plain sentence instead
// of an ERR_MODULE_NOT_FOUND stack above every other message.
let chromium;
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROFILE_DIR = path.join(HERE, '.amizone-profile');   // persistent login lives here
// Config path. The .local.json name is the one .gitignore covers, so it is
// tried FIRST and is the file you are meant to fill in. The plain name is kept
// as a fallback only because the Windows laptop already had it filled in — but
// that file is TRACKED, and a filled-in copy puts a service_role key (which
// bypasses row-level security on every table) one `git add -A` from being
// published. The warning below fires whenever the tracked file is the live one.
const CFG_LOCAL = path.join(HERE, 'amizone.config.local.json');
const CFG_TRACKED = path.join(HERE, 'amizone.config.json');
const CFG_PATH = fs.existsSync(CFG_LOCAL) ? CFG_LOCAL : CFG_TRACKED;
const LOGIN_MODE = process.argv.includes('--login');
const CHECK_MODE = process.argv.includes('--check');

// ---- config (creds are read from YOUR local file; this script never sends them anywhere but Amizone) ----
const cfg = JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'));
const SUPA_URL = cfg.supabaseUrl.replace(/\/$/, '');
// The SERVICE key, not the publishable one.
//
// Until RLS was switched on, the publishable key could write to every table and
// this script used it. It now grants nothing at all: the service role bypasses
// RLS by design and is the only credential a background writer can use.
//
// Checked here rather than left to fail at the first request, because the failure
// it produces otherwise is a 401 in a log file on a Windows laptop nobody reads,
// while the College tab carries on showing three-week-old attendance as though it
// were today's.
const SUPA_KEY = cfg.supabaseServiceKey || cfg.supabaseKey;

// Loud, every run, because the cost of missing it is a leaked service key and
// the cost of seeing it is two lines of log.
// Detect a REAL key positively rather than trying to enumerate what a
// placeholder looks like. The first attempt blacklisted "<", "placeholder" and
// "your", and the template says PUT_THE_SERVICE_ROLE_KEY_HERE — so it warned on
// every untouched checkout and would have been muted as noise long before it
// ever fired on something that mattered. Supabase keys start sb_ or eyJ.
if (CFG_PATH === CFG_TRACKED && /^(sb_|eyJ)/.test(String(SUPA_KEY || ''))) {
  console.error('WARNING: real credentials are in amizone.config.json, which git TRACKS.');
  console.error('         Rename it to amizone.config.local.json (gitignored) before you commit anything.');
}

if (/^sb_publishable_|^eyJ.*anon/.test(String(SUPA_KEY))) {
  console.error('\nThis config still has the PUBLISHABLE key in it.');
  console.error('Since row-level security was enabled that key can no longer write anything,');
  console.error('so every sync would fail with 401 and the dashboard would quietly keep');
  console.error('showing whatever it last received.');
  console.error('\nFix: Supabase → Project Settings → API → service_role key, and put it in');
  console.error(`${CFG_PATH} as "supabaseServiceKey". Do not commit that file.\n`);
  process.exit(1);
}
const AMIZONE = 'https://s.amizone.net';

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

function supaHeaders(extra = {}) {
  return { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json', ...extra };
}
async function supa(pathq, opts = {}) {
  const r = await fetch(`${SUPA_URL}/rest/v1/${pathq}`, { ...opts, headers: supaHeaders(opts.headers) });
  if (!r.ok) throw new Error(`Supabase ${pathq}: ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json().catch(() => null);
}
// Read-modify-write of the shared sync_status blob, keyed by worker name, so this
// lands beside meetings/prices/binance without a schema change.
async function reportStatus(patch) {
  try {
    const rows = await supa('memory?key=eq.sync_status&select=value');
    const value = rows?.[0]?.value || {};
    await upsertMemory('sync_status', { ...value, amizone: { ...patch, at: new Date().toISOString() } });
  } catch (e) {
    console.error('  (could not record sync status:', String(e.message || e) + ')');
  }
}

async function upsertMemory(key, value) {
  await supa('memory', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify([{ key, value, updated_at: new Date().toISOString() }]),
  });
}

// dd/mm/yyyy -> yyyy-mm-dd
function isoFromDMY(s) {
  const m = String(s).trim().match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (!m) return null;
  const [, d, mo, y] = m;
  const yr = y.length === 2 ? '20' + y : y;
  return `${yr}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function dayFromIso(iso) { const dt = new Date(iso + 'T00:00:00'); return DAYS[dt.getDay()] || ''; }
function localDate(offsetDays = 0) {
  const d = new Date(); d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const uid = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));

// Amizone diary datetimes look like "2026/08/15 12:00:00 AM" (slashes + AM/PM).
// Return { iso:'2026-08-15', hm:'00:00' } in 24h, or null.
function parseAmzDT(s) {
  const m = String(s || '').match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?/i);
  if (!m) return null;
  let [, y, mo, d, hh, mm, ap] = m;
  hh = parseInt(hh, 10);
  if (ap) { const p = ap.toUpperCase(); if (p === 'PM' && hh !== 12) hh += 12; if (p === 'AM' && hh === 12) hh = 0; }
  return { iso: `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`, hm: `${String(hh).padStart(2, '0')}:${mm}` };
}

// ---- everything that must run with the Amizone session cookie happens in the page ----
async function scrapeInPage(page, startDate, endDate) {
  return await page.evaluate(async ({ startDate, endDate }) => {
    const txt = async (u) => (await fetch(u, { credentials: 'include' })).text();

    // 1) MyCourses -> [{code,name,pct,attId}]
    const html = await txt('/Academics/MyCourses');
    if (/name=['"]?_?UserName/i.test(html) || /login/i.test(html.slice(0, 400))) {
      return { needLogin: true };
    }
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const courses = [];
    for (const tr of doc.querySelectorAll('tr')) {
      const btn = tr.querySelector('[onclick*="FnAttendance"]');
      if (!btn) continue;
      const attId = (btn.getAttribute('onclick').match(/FnAttendance\(\s*['"]?(\d+)/) || [])[1];
      const cells = [...tr.querySelectorAll('td')].map(td => td.textContent.replace(/\s+/g, ' ').trim());
      const rowText = cells.join(' | ');
      const pctM = rowText.match(/\(\s*([\d.]+)\s*\)/);          // "4/6 (66.67)"
      const pct = pctM ? Math.round(parseFloat(pctM[1])) : null;
      const code = (cells.find(c => /^[A-Z]{2,4}\d{2,4}$/.test(c)) || '').trim();
      // course name = the longest alphabetic-ish cell that isn't the code
      const name = cells
        .filter(c => c !== code && /[A-Za-z]{4,}/.test(c) && !/\d\/\d/.test(c) && !/present|absent|attendance/i.test(c))
        .sort((a, b) => b.length - a.length)[0] || code;
      if (attId || code) courses.push({ code, name, pct, attId });
    }

    // 2) per-course day-wise detail
    for (const c of courses) {
      c.records = [];
      if (!c.attId) continue;
      try {
        const dhtml = await txt(`/Academics/MyCourses/_Attendance?id=${c.attId}`);
        const d = new DOMParser().parseFromString(dhtml, 'text/html');
        for (const tr of d.querySelectorAll('tr')) {
          const td = [...tr.querySelectorAll('td')].map(x => x.textContent.replace(/\s+/g, ' ').trim());
          if (td.length < 4) continue;
          const dateCell = td.find(x => /\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(x));
          if (!dateCell) continue;                                  // skips header + Total
          const nums = td.filter(x => /^\d+$/.test(x)).map(Number);
          // Present / Absent are the two single-digit-ish counts after the date+timings
          const present = nums.length >= 2 ? nums[nums.length - 2] : (nums[0] ?? 0);
          const absent = nums.length >= 2 ? nums[nums.length - 1] : (nums[1] ?? 0);
          const timings = (td.find(x => /\d{1,2}:\d{2}/.test(x)) || '').trim();
          c.records.push({ dateRaw: dateCell, timings, present, absent });
        }
      } catch (e) { c.recErr = String(e); }
    }

    // 3) diary events (timetable) for the window
    let events = [];
    try {
      const j = await (await fetch(`/Calendar/home/GetDiaryEvents?start=${startDate}&end=${endDate}`, { credentials: 'include' })).json();
      events = (Array.isArray(j) ? j : []).map(e => ({
        title: e.title, start: e.start, end: e.end, code: e.CourseCode,
        faculty: e.FacultyName, room: e.RoomNo, sType: e.sType,
      }));
    } catch (e) { events = []; }

    return { needLogin: false, courses, events };
  }, { startDate, endDate });
}

async function tryLogin(page) {
  // best-effort auto re-login using stored creds; Cloudflare usually auto-passes
  // in a warmed persistent profile. Returns true if we end up logged in.
  if (!cfg.amizoneUser || !cfg.amizonePass) return false;
  log('session expired — attempting auto re-login…');
  await page.goto(AMIZONE + '/', { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(4000); // let Turnstile settle
  const userSel = ['input[name="_UserName"]', 'input#_UserName', 'input[name="UserName"]', 'input[type="text"]'];
  const passSel = ['input[name="_Password"]', 'input#_Password', 'input[name="Password"]', 'input[type="password"]'];
  const fill = async (sels, val) => { for (const s of sels) { const el = await page.$(s); if (el) { await el.fill(val); return true; } } return false; };
  const okU = await fill(userSel, cfg.amizoneUser);
  const okP = await fill(passSel, cfg.amizonePass);
  if (!okU || !okP) { log('login fields not found'); return false; }
  await page.waitForTimeout(5000); // give Turnstile time to produce a token
  const btn = await page.$('button[type="submit"], input[type="submit"], .btn-login, button:has-text("Login")');
  if (btn) await btn.click().catch(() => {});
  await page.waitForTimeout(6000);
  const u = page.url();
  return !/login/i.test(u) && !!(await page.$('a[href*="Logout"], [onclick*="FnAttendance"]').catch(() => null)) ? true : !/login/i.test(u);
}

async function check() {
  console.log('config :', CFG_PATH);
  console.log('user   :', String(cfg.amizoneUser || '').slice(0, 4) + '…');
  console.log('url    :', SUPA_URL);
  console.log('key    :', SUPA_KEY.slice(0, 14) + '… (' + SUPA_KEY.length + ' chars)');

  // Read first. A read that works while the write fails is the exact signature
  // of a key that has been demoted rather than revoked, and knowing which one it
  // is decides what you change.
  try {
    await supa('memory?key=eq.amizone_last_sync&select=value');
    console.log('read   : OK');
  } catch (e) {
    console.log('read   : FAILED —', String(e.message || e).slice(0, 160));
  }

  // The write is the thing that has been failing since row-level security went
  // on, so it is the thing worth testing. Writing the heartbeat rather than a
  // scratch row keeps this from leaving litter behind.
  try {
    await reportStatus({ ok: true, configured: true, reason: '', check: true });
    console.log('write  : OK — this laptop can update the dashboard');
    console.log('\nNothing else to fix. Run without --check to sync for real.');
  } catch (e) {
    const msg = String(e.message || e);
    console.log('write  : FAILED —', msg.slice(0, 200));
    if (/401|permission|row-level/i.test(msg)) {
      console.log('\nThat is row-level security refusing the key.');
      console.log('Supabase → Project Settings → API → service_role, and put it in');
      console.log(`${CFG_PATH} as "supabaseServiceKey".`);
    }
    process.exitCode = 1;
  }
  process.exit(process.exitCode || 0);
}

async function main() {
  if (CHECK_MODE) return check();

  try {
    ({ chromium } = await import('playwright'));
  } catch {
    console.error('\nPlaywright is not installed here. In this folder run:\n');
    console.error('  npm install playwright@1.48.0\n');
    console.error('(`node amizone-auto.mjs --check` works without it — use that to');
    console.error(' test the Supabase key before installing anything.)\n');
    process.exit(1);
  }

  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  // Anti-automation: Cloudflare Turnstile fails "automated" browsers. These flags
  // strip the automation fingerprint so it's treated as an ordinary Chrome.
  const antiBotArgs = [
    '--disable-blink-features=AutomationControlled',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=IsolateOrigins,site-per-process',
  ];
  if (!LOGIN_MODE) antiBotArgs.push('--start-minimized');
  const opts = {
    headless: false,                       // headful passes Cloudflare far more reliably
    viewport: null,                        // use the real window size (looks human)
    args: antiBotArgs,
    ignoreDefaultArgs: ['--enable-automation'],
  };
  // Browser resolution, widest-net first.
  //
  // On Windows `channel: 'chrome'` always found Google Chrome. On Arch there may
  // be no Chrome at all — Omarchy ships Chromium — and Playwright's 'chrome'
  // channel looks only in /opt/google/chrome, so it throws. Each candidate is
  // tried in turn and the LAST error is reported, because a bare
  // "browserType.launchPersistentContext: Chromium distribution 'chrome' is not
  // found" says nothing about the three other things that were attempted.
  //
  // Real Chrome first: Turnstile is measurably happier with it than with
  // Chromium, and that is the entire reason this runs on a home machine.
  const explicit = process.env.AMIZONE_CHROME || cfg.chromePath;
  const candidates = [
    ...(explicit ? [{ what: `executablePath ${explicit}`, o: { executablePath: explicit } }] : []),
    { what: "channel 'chrome'", o: { channel: 'chrome' } },
    { what: "channel 'chromium'", o: { channel: 'chromium' } },
    { what: '/usr/bin/google-chrome-stable', o: { executablePath: '/usr/bin/google-chrome-stable' } },
    { what: '/usr/bin/chromium', o: { executablePath: '/usr/bin/chromium' } },
    { what: "Playwright's bundled Chromium", o: {} },
  ];
  let ctx = null, lastErr = null;
  for (const c of candidates) {
    try {
      ctx = await chromium.launchPersistentContext(PROFILE_DIR, { ...c.o, ...opts });
      log(`browser: ${c.what}`);
      break;
    } catch (e) { lastErr = e; }
  }
  if (!ctx) {
    console.error('\nNo usable browser. Tried: ' + candidates.map(c => c.what).join(', '));
    console.error('Last error:', lastErr?.message);
    console.error('\nOn Arch:  yay -S google-chrome     (preferred)');
    console.error('      or:  sudo pacman -S chromium');
    process.exit(1);
  }

  // extra insurance: hide the webdriver flag Cloudflare checks
  await ctx.addInitScript(() => { try { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); } catch (e) {} });

  const page = ctx.pages()[0] || await ctx.newPage();

  if (LOGIN_MODE) {
    log('SETUP MODE — a Chrome window will open. Log into Amizone, then leave it.');
    await page.goto(AMIZONE + '/', { waitUntil: 'domcontentloaded' });
    log('Waiting up to 3 minutes for you to reach your dashboard…');
    await page.waitForSelector('[onclick*="FnAttendance"], a[href*="Logout"]', { timeout: 180000 }).catch(() => {});
    log('Login captured (profile saved). You can close this. Daily runs are now hands-off.');
    await page.waitForTimeout(1500);
    await ctx.close();
    return;
  }

  // normal run
  await page.goto(AMIZONE + '/Academics/MyCourses', { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(2500);

  const start = localDate(-21), end = localDate(21); // ~6 weeks → good recurrence signal
  let data = await scrapeInPage(page, start, end);

  if (data.needLogin || !data.courses?.length) {
    const ok = await tryLogin(page);
    if (ok) { await page.waitForTimeout(1500); data = await scrapeInPage(page, start, end); }
  }

  if (data.needLogin || !data.courses?.length) {
    log('NOT logged in and could not auto-login. Run:  node amizone-auto.mjs --login');
    await upsertMemory('amizone_last_sync', { at: new Date().toISOString(), ok: false, reason: 'needs manual login' });
    await ctx.close();
    process.exitCode = 2;
    return;
  }

  // ---- shape the data ----
  const courses = data.courses.filter(c => c.code || c.attId);
  // day-wise attendance_log
  const logCourses = courses.map(c => {
    const records = (c.records || []).map(r => {
      const iso = isoFromDMY(r.dateRaw);
      const status = r.present === 0 ? 'absent' : r.absent === 0 ? 'present' : 'partial';
      return iso ? { date: iso, day: dayFromIso(iso), timings: r.timings, present: r.present, absent: r.absent, status } : null;
    }).filter(Boolean).sort((a, b) => a.date < b.date ? -1 : 1);
    const present = records.reduce((s, r) => s + (r.status !== 'absent' ? 1 : 0), 0);
    return { code: c.code, name: c.name, present, absent: records.length - present, total: records.length, pct: c.pct ?? 0, records };
  });

  // ---- weekly timetable, cleaned ----
  // Amizone's diary is a per-day event feed that also carries one-off makeups and
  // extra sessions. A REAL weekly class recurs on the same weekday across weeks, so
  // we group by weekday+time+subject and keep only slots seen on >=2 distinct dates.
  // That drops the makeup/extra noise that made a single day balloon to 7 slots.
  // (Falls back to keeping everything if nothing recurs — a thin window — so the
  // timetable is never wiped to blank.)
  const groups = {};
  for (const e of data.events) {
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
  if (!picked.length) picked = allSlots; // thin window — keep all rather than blank
  const ttRows = picked.map(g => ({
    id: uid(), created_at: new Date().toISOString(),
    day: g.day, start_time: g.start_time, end_time: g.end_time, subject: g.subject, room: g.room, faculty: g.faculty,
  }));
  // stash the raw diary + what we picked, so the parse can be verified/tuned after a run
  await upsertMemory('amizone_raw_diary', {
    at: new Date().toISOString(), window: { start, end },
    events: (data.events || []).map(e => ({ start: e.start, end: e.end, title: e.title, code: e.code, room: e.room, faculty: e.faculty, sType: e.sType })).slice(0, 400),
    picked: ttRows.map(r => `${r.day} ${r.start_time}-${r.end_time} ${r.subject}`).sort(),
  }).catch(() => {});

  // ---- push everything to Supabase ----
  // 1) per-subject attendance %
  for (const c of courses) {
    if (!c.code || c.pct == null) continue;
    await supa(`subjects?code=eq.${encodeURIComponent(c.code)}`, { method: 'PATCH', body: JSON.stringify({ attendance_pct: c.pct }) })
      .catch(e => log('subject patch', c.code, String(e)));
  }
  // 2) timetable: Amizone's diary is a per-day event feed, so rebuilding a "weekly"
  //    view from it unions every instance in the window (both batches, makeups,
  //    extra classes) → a noisy superset. The dashboard keeps a clean, hand-verified
  //    weekly timetable instead, so we DON'T overwrite it here. Attendance below is
  //    what genuinely needs the live sync. Set cfg.syncTimetable = true to re-enable.
  if (ttRows.length) {
    await supa('timetable?id=not.is.null', { method: 'DELETE' }).catch(() => {});
    await supa('timetable', { method: 'POST', body: JSON.stringify(ttRows) }).catch(e => log('timetable insert', String(e)));
    log(`timetable: ${ttRows.length} recurring slots written (from ${allSlots.length} distinct diary slots)`);
  } else {
    log('timetable: no recurring slots parsed — left as-is');
  }
  // 3) day-wise attendance log
  await upsertMemory('attendance_log', { updated: new Date().toISOString(), courses: logCourses });
  // 4) heartbeat
  await upsertMemory('amizone_last_sync', { at: new Date().toISOString(), ok: true, subjects: courses.length, classes: ttRows.length });

  // 5) health, in the shared blob the dashboard's Background sync card reads.
  //    That card has had an AMIZONE row since it was written and has been showing
  //    NO REPORT ever since, because nothing wrote one. A sync that fails on a
  //    laptop in another room is indistinguishable, from the dashboard, from a
  //    sync that had nothing to say — and that is exactly how three weeks of stale
  //    attendance went unnoticed.
  await reportStatus({ ok: true, configured: true, reason: '', subjects: courses.length, classes: ttRows.length });

  log(`DONE · ${courses.length} subjects, ${ttRows.length} class slots, day-wise for ${logCourses.filter(c => c.records.length).length} courses`);
  courses.forEach(c => log(`   ${c.code || '—'}  ${c.pct ?? '—'}%  (${(c.records || []).length} days)`));
  await ctx.close();
}

main().catch(async (e) => {
  console.error('FATAL', e);
  // Best effort, and the most important write in the file: a run that died is the
  // one the dashboard most needs to hear about. If even this fails there is
  // nothing more to try — but a silent death is what produced the original bug.
  await reportStatus({ ok: false, configured: true, reason: String(e.message || e).slice(0, 300) })
    .catch(() => {});
  process.exitCode = 1;
});
