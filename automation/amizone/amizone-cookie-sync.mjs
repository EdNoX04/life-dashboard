#!/usr/bin/env node
/**
 * amizone-cookie-sync.mjs — the READ half, with no browser at all.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every earlier attempt tried to give an automated browser a logged-in Amizone
 * session, and every one failed, for two reasons that were only found by
 * measuring rather than guessing:
 *
 *   1. Cloudflare Turnstile will not issue a token to a datacenter IP. That is
 *      why GitHub Actions runs #19-#25 all posted turnstile=MISSING.
 *   2. Chrome never writes an expiry-less cookie to disk, and Amizone's session
 *      cookie has no expiry — so handing a profile directory to Playwright
 *      always handed it a logged-out profile.
 *
 * Both of those are about LOGGING IN. Neither applies to a session that already
 * exists. Amizone's auth cookie, .ASPXAUTH, is not HttpOnly and is an ordinary
 * ASP.NET forms-auth ticket: any HTTP client that sends it is logged in. So this
 * script does not drive a browser, does not log in, and never sees a password.
 * It sends one cookie and parses HTML.
 *
 * THE COOKIE LIVES IN SUPABASE, NOT IN A GITHUB SECRET
 * ----------------------------------------------------
 * ASP.NET forms auth uses sliding expiration: once a ticket is more than halfway
 * to its timeout, the server reissues it on the next request via Set-Cookie. A
 * value frozen in a GitHub secret can therefore only ever decay. Keeping it in
 * the memory table means this script can write the reissued value straight back
 * and the session renews itself indefinitely, for as long as the sync keeps
 * running. That is the difference between "works for 30 minutes" and "works
 * until Amizone forces a real re-login".
 *
 *   node amizone-cookie-sync.mjs --out payload.json
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_KEY. Optionally AMIZONE_COOKIE to
 * bootstrap/override (the value is read, never printed).
 */
import fs from 'node:fs';
import { DOMParser } from 'linkedom';

const argv = process.argv.slice(2);
const arg = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1]; };
const OUT = arg('out', 'amizone-payload.json');

/**
 * --from-raw: parse pages the Chrome extension already fetched, instead of
 * fetching them here.
 *
 * WHY THIS MODE EXISTS. Two things were measured on 2026-09-05 and between them
 * they end the cookie-in-the-cloud design:
 *
 *   · `.ASPXAUTH` is HttpOnly. `document.cookie` on an Amizone page is the empty
 *     string while requests from that same page are authenticated — so the
 *     bookmarklet cannot read it, and nothing in the web sandbox can.
 *   · The session does not travel. A ticket serving Neel's browser happily for
 *     33 minutes died within minutes of being used from two datacenters.
 *
 * So the fetching moves to a Chrome extension on his own machine, where the
 * session already is, and this script keeps doing the part it is good at:
 * parsing. Same parser, same tests, same output — only the source of the bytes
 * changes. No credential ever leaves his browser, and nothing here needs one.
 */
const FROM_RAW = argv.includes('--from-raw');

/**
 * How old captured pages may be before this refuses to parse them.
 *
 * The failure this prevents is the one this project keeps meeting: parsing
 * six-day-old HTML and writing it out as today's attendance is not a visible
 * error, it is a dashboard confidently showing stale numbers. Better to fail and
 * say the browser has not run recently.
 */
const RAW_MAX_AGE_MS = 6 * 3600 * 1000;

const SUPA_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY || '';
// The publishable key passes a bare `sb_` test and then fails at the database
// with an RLS error that looks like a policy bug. Name the real problem here.
if (!SUPA_URL || !/^(sb_|eyJ)/.test(SUPA_KEY) || /publishable|anon/i.test(SUPA_KEY)) {
  console.error('FATAL: SUPABASE_SERVICE_KEY is missing, not a Supabase key, or is the'
    + ' PUBLISHABLE key (that one is public and cannot write — use the SECRET key).');
  process.exit(2);
}
const AMIZONE = 'https://s.amizone.net';
// A real Chrome UA. Not an attempt to defeat anything — Cloudflare's managed
// rules drop obvious script user-agents outright, and this request is a genuine
// user's own session either way.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const supaHeaders = (extra = {}) => ({
  apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json', ...extra,
});
async function supa(pathq, opts = {}) {
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
  } catch (e) { console.error('  (could not record sync status:', String(e.message || e) + ')'); }
}

/**
 * Never log, print, or return these to a caller that prints.
 *
 * Order matters and is easy to get backwards: the SUPABASE copy wins, because
 * that is the one this script renews on every run. If the AMIZONE_COOKIE secret
 * took priority, the renewal would be written and then ignored forever, and the
 * session would expire on the secret's original clock — the whole point of
 * storing it in Supabase, defeated. The secret is a BOOTSTRAP and a rescue: it
 * is tried only when Supabase has nothing, or when Supabase's copy turns out to
 * be dead (which is exactly the moment a freshly pasted secret should take over).
 */
async function loadCookies() {
  const envCookie = (process.env.AMIZONE_COOKIE || '').trim();
  let stored = '', firstSeen = null, lastOk = null;
  try {
    const rows = await supa('memory?key=eq.amizone_cookie&select=value');
    const v = rows?.[0]?.value;
    stored = String((typeof v === 'string' ? v : v?.value) || '').trim();
    firstSeen = (typeof v === 'object' && v?.first_seen) || null;
    // The last run that actually reached Amizone with this ticket. Together with
    // first_seen it brackets the session lifetime when the ticket finally dies.
    lastOk = (typeof v === 'object' && v?.updated_at) || null;
  } catch { /* first ever run: the row does not exist yet */ }
  return {
    primary: stored || envCookie,
    fallback: stored && envCookie && stored !== envCookie ? envCookie : '',
    firstSeen,
    lastOk,
  };
}

/** Normalise whatever was pasted into a bare `name=value` cookie header. */
function normaliseCookie(raw) {
  const m = String(raw).match(/\.ASPXAUTH\s*=\s*([^;\s]+)/i);
  return m ? `.ASPXAUTH=${m[1]}` : String(raw).split(';')[0].trim();
}

async function get(path, cookie) {
  const r = await fetch(AMIZONE + path, {
    headers: {
      Cookie: cookie,
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': AMIZONE + '/Home',
    },
    redirect: 'follow',
  });
  const body = await r.text();
  // Node 20+: getSetCookie() keeps multiple Set-Cookie headers separate, which a
  // plain headers.get('set-cookie') would fold into one unparseable string.
  const setCookies = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : [];
  const refreshed = setCookies.map(s => (s.match(/^\.ASPXAUTH=([^;]+)/) || [])[1]).filter(Boolean)[0] || null;
  return { status: r.status, url: r.url, body, refreshed };
}

// Amizone redirects a dead session to the login form rather than returning 401,
// so "did this work" is a content question, not a status-code question. Both
// markers are login-page-only: MyCourses has no username field and no Turnstile.
const looksLoggedOut = (html) =>
  /name=['"]?_?UserName/i.test(html) || /cf-turnstile-response/i.test(html);

const isChallenge = (html) => /challenge-platform|Just a moment|Attention Required|cf_chl_opt/i.test(html);

// MyCourses is FOUR tables, not one. Core courses sit in the first; electives and
// Foreign Business Language sit in a second ("Open/Domain/FBL Courses"); a third
// lists the same electives again as Amigo links. Only the first table's rows carry
// an FnAttendance button, so keying off that button — which every version of this
// scraper did — silently dropped Spanish and HCI entirely. Neel spotted it because
// he knew he had missed a Spanish class and no absence ever appeared.
//
// So: find courses by the COURSE CODE, which every table has, and treat the
// attendance button as optional detail rather than as the thing that defines a
// course. SPAN145 is 4 letters + 3 digits, hence {2,6} and {2,4} in CODE.
const CODE = /^[A-Z]{2,6}\d{2,4}$/;
// "32/40 (80.00)". Anchored, so a stray parenthesised number elsewhere in the row
// cannot be mistaken for a percentage — and courses showing "NA" (Industry
// Internship, Minor Project, an elective with no classes held yet) fall through to
// null rather than being written as a confident 0%.
const PCT = /^(\d+)\s*\/\s*(\d+)\s*\(\s*([\d.]+)\s*\)$/;

function parseCourses(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const found = [];
  for (const tr of doc.querySelectorAll('tr')) {
    const cells = [...tr.querySelectorAll('td')].map(td => td.textContent.replace(/\s+/g, ' ').trim());
    const code = cells.find(c => CODE.test(c));
    if (!code) continue;
    const pm = cells.map(c => c.match(PCT)).find(Boolean);
    const btn = tr.querySelector('[onclick*="FnAttendance"]');
    const attId = btn ? (btn.getAttribute('onclick').match(/FnAttendance\(\s*['"]?(\d+)/) || [])[1] : null;
    const name = cells
      .filter(c => c !== code && /[A-Za-z]{4,}/.test(c) && !PCT.test(c)
        && !/^(view|na)$/i.test(c) && !/Group Name/i.test(c) && !/^compulsory$/i.test(c))
      .sort((a, b) => b.length - a.length)[0] || code;
    found.push({
      code, name, attId: attId || null,
      attended: pm ? +pm[1] : null, held: pm ? +pm[2] : null,
      pct: pm ? Math.round(parseFloat(pm[3])) : null,
    });
  }
  // The Amigo table repeats each elective with no attendance cell, so the same
  // code arrives twice. Merge rather than let arrival order decide which wins:
  // keep the attendance figures wherever they appeared, and the longest name.
  const byCode = new Map();
  for (const f of found) {
    const prev = byCode.get(f.code);
    if (!prev) { byCode.set(f.code, f); continue; }
    if (!prev.attId && f.attId) prev.attId = f.attId;
    if (prev.pct == null && f.pct != null) { prev.pct = f.pct; prev.attended = f.attended; prev.held = f.held; }
    if (f.name.length > prev.name.length) prev.name = f.name;
  }
  return [...byCode.values()];
}

function parseRecords(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out = [];
  for (const tr of doc.querySelectorAll('tr')) {
    const td = [...tr.querySelectorAll('td')].map(x => x.textContent.replace(/\s+/g, ' ').trim());
    if (td.length < 4) continue;
    const dateCell = td.find(x => /\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(x));
    if (!dateCell) continue;
    const nums = td.filter(x => /^\d+$/.test(x)).map(Number);
    const present = nums.length >= 2 ? nums[nums.length - 2] : (nums[0] ?? 0);
    const absent = nums.length >= 2 ? nums[nums.length - 1] : (nums[1] ?? 0);
    const timings = (td.find(x => /\d{1,2}:\d{2}/.test(x)) || '').trim();
    out.push({ dateRaw: dateCell, timings, present, absent });
  }
  return out;
}

const pad = n => String(n).padStart(2, '0');
const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * How long the ticket lasted, in the words of the two timestamps we already keep.
 *
 * WHY THIS EXISTS. Until now the expiry path said "cookie is no longer valid"
 * and nothing else, so the session's actual lifetime was never measured — only
 * guessed. And the guess was bad: the two successful runs were 17 minutes apart
 * and the next scheduled run was 9.5 HOURS later, so the honest bracket was
 * "somewhere between 18 minutes and nine hours", which is far too wide to design
 * a schedule around. I had asserted 30 minutes from the ASP.NET default as
 * though it were measured. It was not.
 *
 * Both numbers were already in the store; nothing was reading them on the path
 * where they matter most. One re-paste now yields the real figure to the minute,
 * and the schedule follows from it instead of from a framework default.
 */
function lifetimeLine(firstSeen, lastOk) {
  const mins = t => (t ? Math.round((Date.now() - Date.parse(t)) / 60000) : null);
  const age = mins(firstSeen);
  const since = mins(lastOk);
  if (age == null && since == null) return 'lifetime: unknown (no timestamps stored yet)';
  const parts = [];
  if (age != null) parts.push(`ticket was ${age} min old`);
  if (since != null) parts.push(`last confirmed working ${since} min ago`);
  // The bracket, stated plainly: alive at `since`, dead by `age`.
  if (age != null && since != null && age >= since) {
    parts.push(`so the session survived at least ${since} min and was dead by ${age} min`);
  }
  return 'lifetime: ' + parts.join(' · ');
}

/** Read what the extension captured, refusing anything stale. */
async function loadRaw() {
  const rows = await supa('memory?key=eq.amizone_raw&select=value');
  const raw = rows?.[0]?.value;
  if (!raw || !raw.courses) {
    await reportStatus({
      ok: false, configured: false,
      reason: 'no captured pages — install the Chrome extension (automation/amizone/extension) and press Run now',
    });
    console.error('FATAL: memory.amizone_raw is empty. The browser extension has never run.');
    process.exit(7);
  }
  const age = Date.now() - Date.parse(raw.fetched_at || 0);
  if (!Number.isFinite(age) || age > RAW_MAX_AGE_MS) {
    const hours = Number.isFinite(age) ? (age / 3.6e6).toFixed(1) : '?';
    await reportStatus({
      ok: false, configured: true,
      reason: `captured pages are ${hours}h old — open Chrome so the Amizone bridge can refresh them`,
    });
    console.error(`FATAL: captured pages are ${hours}h old (limit ${RAW_MAX_AGE_MS / 3.6e6}h). Refusing to publish stale attendance as current.`);
    process.exit(8);
  }
  log(`raw: captured ${(age / 60000).toFixed(0)} min ago by ${raw.source || 'unknown'}`);
  return raw;
}

async function mainFromRaw() {
  const raw = await loadRaw();

  const courses = parseCourses(raw.courses);
  if (!courses.length) {
    await reportStatus({ ok: false, configured: true, reason: 'captured MyCourses parsed to 0 courses — the markup may have changed' });
    console.error('FATAL: 0 courses parsed from the captured page.');
    process.exit(6);
  }
  log(`courses: ${courses.length}`);

  // The extension keys each register by the same id the course row carries, so
  // this is a lookup rather than a second round of requests.
  const byId = new Map((raw.registers || []).map(r => [String(r.id), r.body]));
  for (const c of courses) {
    c.records = [];
    const body = c.attId ? byId.get(String(c.attId)) : null;
    if (body) c.records = parseRecords(body);
  }

  const seen = new Set();
  const events = [];
  for (const chunk of raw.diary || []) {
    try {
      const j = JSON.parse(chunk.body);
      for (const e of (Array.isArray(j) ? j : [])) {
        const k = String(e.id ?? `${e.start}|${e.title}`);
        if (seen.has(k)) continue;
        seen.add(k);
        events.push({
          title: e.title, start: e.start, end: e.end, code: e.CourseCode,
          faculty: e.FacultyName, room: e.RoomNo, sType: e.sType, allDay: e.allDay,
          attendColor: e.AttndColor,
        });
      }
    } catch { /* one bad chunk must not cost the whole window */ }
  }
  const classCount = events.filter(e => String(e.sType).toUpperCase() === 'C').length;
  log(`diary: ${events.length} events (${classCount} classes) across ${raw.window?.start}…${raw.window?.end}`);
  if (!classCount) log('  WARNING: zero class events — the range cliff may have moved, or term is out');

  fs.writeFileSync(OUT, JSON.stringify({
    needLogin: false, window: raw.window || {}, courses, events,
    session: { source: 'chrome-extension', captured_at: raw.fetched_at },
  }, null, 2));

  await reportStatus({
    ok: true, configured: true,
    reason: `parsed pages captured by the browser ${(Date.now() - Date.parse(raw.fetched_at)) / 60000 | 0} min ago`,
  });
  log(`wrote ${OUT} · ${courses.length} subjects, ${events.length} diary events`);
  courses.forEach(c => log(`   ${(c.code || '—').padEnd(8)} ${String(c.pct ?? '—').padStart(3)}%  (${c.records.length} days)`));
}

async function main() {
  if (FROM_RAW) return mainFromRaw();
  const { primary, fallback, firstSeen, lastOk } = await loadCookies();
  if (!primary) {
    await reportStatus({ ok: false, configured: false, reason: 'no Amizone cookie stored — paste .ASPXAUTH into the AMIZONE_COOKIE secret' });
    console.error('FATAL: no cookie in memory.amizone_cookie and no AMIZONE_COOKIE set.');
    process.exit(3);
  }

  let cookie = normaliseCookie(primary);
  let coursesRes = await get('/Academics/MyCourses', cookie);
  if (looksLoggedOut(coursesRes.body) && fallback) {
    log('stored cookie is dead — retrying with the bootstrap secret');
    cookie = normaliseCookie(fallback);
    coursesRes = await get('/Academics/MyCourses', cookie);
  }

  if (isChallenge(coursesRes.body)) {
    await reportStatus({ ok: false, configured: true, reason: 'Cloudflare challenged the request (not a login problem)' });
    console.error('FATAL: Cloudflare served a challenge page to this runner.');
    process.exit(4);
  }
  if (looksLoggedOut(coursesRes.body)) {
    const life = lifetimeLine(firstSeen, lastOk);
    await reportStatus({
      ok: false, configured: true,
      reason: `Amizone cookie expired — log in on Chrome and re-paste .ASPXAUTH (${life})`,
    });
    console.error('FATAL: cookie is no longer valid — Amizone returned the login page.');
    // The measurement. This is the number the whole schedule depends on, and
    // until now the one path guaranteed to know it threw it away.
    console.error(life);
    process.exit(5);
  }

  // The ticket may have been reissued on this very request; carry it forward for
  // the per-course fetches below AND persist it, or the renewal is thrown away.
  if (coursesRes.refreshed) cookie = `.ASPXAUTH=${coursesRes.refreshed}`;

  const courses = parseCourses(coursesRes.body);
  if (!courses.length) {
    await reportStatus({ ok: false, configured: true, reason: 'logged in but parsed 0 courses — MyCourses markup may have changed' });
    console.error('FATAL: 0 courses parsed from a page that looked logged in.');
    process.exit(6);
  }
  log(`courses: ${courses.length}`);

  for (const c of courses) {
    c.records = [];
    if (!c.attId) continue;
    try {
      const r = await get(`/Academics/MyCourses/_Attendance?id=${c.attId}`, cookie);
      if (r.refreshed) cookie = `.ASPXAUTH=${r.refreshed}`;
      c.records = parseRecords(r.body);
    } catch (e) { c.recErr = String(e.message || e); }
  }

  // THE DIARY HAS A RANGE CLIFF, and it fails silently.
  //
  // GetDiaryEvents drops every class event (sType 'C') once the requested range
  // gets long enough, and still returns 200 with the holidays and notices intact.
  // Measured against the live endpoint on 2026-08-29:
  //
  //     7d → 22 classes   14d → 38   28d → 71   35d → 87   42d → 117   60d → 0
  //
  // A cliff, not a taper. Every previous version of this sync asked for -60…+14
  // days — 74 days — and therefore received ZERO classes on every run it ever
  // made, while looking perfectly successful. That is why the timetable has never
  // once come from Amizone and Neel has been living off a weekly grid typed out
  // from a photo in July.
  //
  // So the window is fetched in 28-day chunks and merged, well inside the cliff.
  const CHUNK_DAYS = 28;
  const now = new Date();
  const from = new Date(now); from.setDate(from.getDate() - 56);
  const to = new Date(now); to.setDate(to.getDate() + 14);
  const startDate = fmt(from), endDate = fmt(to);

  const seen = new Set();
  let events = [];
  for (let cur = new Date(from); cur < to;) {
    const chunkEnd = new Date(cur); chunkEnd.setDate(chunkEnd.getDate() + CHUNK_DAYS);
    const hi = chunkEnd > to ? to : chunkEnd;
    try {
      const r = await get(`/Calendar/home/GetDiaryEvents?start=${fmt(cur)}&end=${fmt(hi)}`, cookie);
      if (r.refreshed) cookie = `.ASPXAUTH=${r.refreshed}`;
      const j = JSON.parse(r.body);
      for (const e of (Array.isArray(j) ? j : [])) {
        // Chunks overlap at their boundary dates; id is Amizone's own, and the
        // start+title fallback keeps notices (which have no id) from doubling up.
        const k = String(e.id ?? `${e.start}|${e.title}`);
        if (seen.has(k)) continue;
        seen.add(k);
        events.push({
          title: e.title, start: e.start, end: e.end, code: e.CourseCode,
          faculty: e.FacultyName, room: e.RoomNo, sType: e.sType, allDay: e.allDay,
          attendColor: e.AttndColor,
        });
      }
    } catch { /* one bad chunk must not cost the whole window */ }
    cur = hi;
  }
  const classCount = events.filter(e => String(e.sType).toUpperCase() === 'C').length;
  log(`diary: ${events.length} events (${classCount} classes) across ${startDate}…${endDate}`);
  if (!classCount) log('  WARNING: zero class events — the range cliff may have moved, or term is out');

  // Persist the (possibly renewed) ticket. Written unconditionally so a value
  // bootstrapped from AMIZONE_COOKIE lands in Supabase on the first run.
  //
  // first_seen is the answer to "how long does this session actually last": it
  // survives while the ticket VALUE is unchanged and resets the moment a
  // different one takes over. Without it the only way to learn the lifetime is
  // to wait for a failure and guess backwards from it. `renewed` says whether
  // the server reissued the ticket on this run — the direct evidence that
  // sliding expiration is on, and therefore that the session can outlive its
  // nominal timeout for as long as the sync keeps calling.
  const started = normaliseCookie(primary);
  const renewed = cookie !== started;
  const first_seen = renewed || !firstSeen ? new Date().toISOString() : firstSeen;
  const ageHours = +((Date.now() - Date.parse(first_seen)) / 3.6e6).toFixed(1);
  await upsertMemory('amizone_cookie', { value: cookie, first_seen, updated_at: new Date().toISOString() });

  fs.writeFileSync(OUT, JSON.stringify({
    needLogin: false, window: { start: startDate, end: endDate }, courses, events,
    session: { first_seen, age_hours: ageHours, renewed_this_run: renewed },
  }, null, 2));
  log(`session: ${renewed ? 'RENEWED by the server this run' : 'same ticket'} · age ${ageHours}h`);
  log(`wrote ${OUT} · ${courses.length} subjects, ${events.length} diary events`);
  courses.forEach(c => log(`   ${(c.code || '—').padEnd(8)} ${String(c.pct ?? '—').padStart(3)}%  (${c.records.length} days)`));
}

main().catch(async (e) => {
  console.error('FATAL', e.message || e);
  await reportStatus({ ok: false, configured: true, reason: String(e.message || e).slice(0, 300) }).catch(() => {});
  process.exitCode = 1;
});
