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

const SUPA_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY || '';
if (!SUPA_URL || !/^(sb_|eyJ)/.test(SUPA_KEY)) {
  console.error('FATAL: SUPABASE_URL / SUPABASE_SERVICE_KEY missing or not a Supabase key.');
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
  let stored = '', firstSeen = null;
  try {
    const rows = await supa('memory?key=eq.amizone_cookie&select=value');
    const v = rows?.[0]?.value;
    stored = String((typeof v === 'string' ? v : v?.value) || '').trim();
    firstSeen = (typeof v === 'object' && v?.first_seen) || null;
  } catch { /* first ever run: the row does not exist yet */ }
  return {
    primary: stored || envCookie,
    fallback: stored && envCookie && stored !== envCookie ? envCookie : '',
    firstSeen,
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

function parseCourses(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const courses = [];
  for (const tr of doc.querySelectorAll('tr')) {
    const btn = tr.querySelector('[onclick*="FnAttendance"]');
    if (!btn) continue;
    const attId = (btn.getAttribute('onclick').match(/FnAttendance\(\s*['"]?(\d+)/) || [])[1];
    const cells = [...tr.querySelectorAll('td')].map(td => td.textContent.replace(/\s+/g, ' ').trim());
    const rowText = cells.join(' | ');
    const pctM = rowText.match(/\(\s*([\d.]+)\s*\)/);
    const pct = pctM ? Math.round(parseFloat(pctM[1])) : null;
    const code = (cells.find(c => /^[A-Z]{2,4}\d{2,4}$/.test(c)) || '').trim();
    const name = cells
      .filter(c => c !== code && /[A-Za-z]{4,}/.test(c) && !/\d\/\d/.test(c) && !/present|absent|attendance/i.test(c))
      .sort((a, b) => b.length - a.length)[0] || code;
    if (attId || code) courses.push({ code, name, pct, attId });
  }
  return courses;
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

async function main() {
  const { primary, fallback, firstSeen } = await loadCookies();
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
    await reportStatus({ ok: false, configured: true, reason: 'Amizone cookie expired — log in on Chrome and re-paste .ASPXAUTH' });
    console.error('FATAL: cookie is no longer valid — Amizone returned the login page.');
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

  const now = new Date();
  const from = new Date(now); from.setDate(from.getDate() - 60);
  const to = new Date(now); to.setDate(to.getDate() + 14);
  const startDate = fmt(from), endDate = fmt(to);
  let events = [];
  try {
    const r = await get(`/Calendar/home/GetDiaryEvents?start=${startDate}&end=${endDate}`, cookie);
    if (r.refreshed) cookie = `.ASPXAUTH=${r.refreshed}`;
    const j = JSON.parse(r.body);
    events = (Array.isArray(j) ? j : []).map(e => ({
      title: e.title, start: e.start, end: e.end, code: e.CourseCode,
      faculty: e.FacultyName, room: e.RoomNo, sType: e.sType, allDay: e.allDay,
    }));
  } catch { events = []; }

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
