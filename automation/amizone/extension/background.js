// PLAYER ONE — Amizone bridge.
//
// WHY AN EXTENSION, AFTER TRYING EVERYTHING ELSE
//
// Two hard facts, both measured today rather than assumed:
//
// 1. `.ASPXAUTH` IS HttpOnly. `document.cookie` on an Amizone page returns the
//    empty string while requests from that same page are perfectly
//    authenticated. So the bookmarklet — which reads document.cookie — cannot
//    work, and nothing in the web sandbox can. `chrome.cookies` can, and it is
//    the only thing that can.
//
// 2. THE SESSION DOES NOT TRAVEL. A ticket that had been serving Neel's own
//    browser happily for 33 minutes died within minutes of being used from two
//    datacenters. Whether the cause is IP binding or one-session-per-user was
//    never separated, and it does not matter here: both are avoided by never
//    moving the credential off this machine.
//
// So this runs where the session already is, and the credential never leaves the
// browser. Not even into Supabase.
//
// WHAT IT DELIBERATELY DOES NOT DO
//
// It does not parse. Parsing Amizone's markup is genuinely fiddly — duplicate
// elective rows, attendance registers that beat the rounded donut, a diary
// endpoint with a silent range cliff — and `scripts/lib/amizone-parse.mjs` plus
// `amizone-cookie-sync.mjs` already do it correctly with 57 tests behind them.
// A second parser in here would drift from that one, and the drift would show up
// as quietly wrong attendance rather than as an error.
//
// So this fetches, stores the raw responses, and the existing pipeline parses
// them exactly as it always has. The only thing that changes is WHERE the fetch
// happens. That is the whole fix.

const AMIZONE = 'https://s.amizone.net';
const ALARM = 'amizone-pull';

const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** The login page has a username field; MyCourses has neither that nor Turnstile. */
const looksLoggedOut = html =>
  /name=['"]?_?UserName/i.test(html) || /challenges\.cloudflare\.com/i.test(html);

async function settings() {
  const s = await chrome.storage.local.get(['supabaseUrl', 'serviceKey', 'everyMinutes']);
  return {
    url: String(s.supabaseUrl || '').replace(/\/+$/, ''),
    key: String(s.serviceKey || ''),
    every: Math.max(5, Number(s.everyMinutes) || 30),
  };
}

async function memPut(cfg, key, value) {
  const r = await fetch(`${cfg.url}/rest/v1/memory`, {
    method: 'POST',
    headers: {
      apikey: cfg.key,
      Authorization: `Bearer ${cfg.key}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify({ key, value }),
  });
  if (!r.ok) throw new Error(`supabase ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

/** Merge one worker's health into sync_status without clobbering the others. */
async function report(cfg, state) {
  try {
    const r = await fetch(`${cfg.url}/rest/v1/memory?key=eq.sync_status&select=value`, {
      headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}` },
    });
    const rows = r.ok ? await r.json() : [];
    const cur = rows?.[0]?.value ?? {};
    await memPut(cfg, 'sync_status', {
      ...cur,
      amizone: { ...state, at: new Date().toISOString(), via: 'chrome-extension' },
    });
  } catch { /* a health note is not worth failing the run over */ }
}

async function get(path) {
  // credentials:'include' plus host_permissions is what carries the HttpOnly
  // ticket. If a future Chrome tightens this, the login-page check below turns
  // it into a clear message instead of silently storing the login page as data.
  const r = await fetch(AMIZONE + path, { credentials: 'include', cache: 'no-store' });
  return { status: r.status, body: await r.text() };
}

/**
 * THE DIARY RANGE CLIFF.
 *
 * GetDiaryEvents silently drops every class event once the requested window gets
 * long enough — measured against the live endpoint: 7d→22 classes, 35d→87,
 * 42d→117, 60d→0. A cliff, not a taper, and it still answers 200 with the
 * holidays intact. Every earlier version asked for 74 days and therefore
 * received zero classes on every run it ever made while looking successful.
 *
 * So: short windows, stitched together.
 */
const DIARY_CHUNK_DAYS = 21;

async function pullDiary(from, to) {
  const out = [];
  let cur = new Date(from);
  while (cur <= to) {
    const hi = new Date(cur);
    hi.setDate(hi.getDate() + DIARY_CHUNK_DAYS);
    const end = hi > to ? to : hi;
    const r = await get(`/Calendar/home/GetDiaryEvents?start=${ymd(cur)}&end=${ymd(end)}`);
    out.push({ start: ymd(cur), end: ymd(end), status: r.status, body: r.body });
    cur = new Date(end);
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

async function run(reason = 'alarm') {
  const cfg = await settings();
  if (!cfg.url || !cfg.key) {
    return { ok: false, reason: 'not configured — open the extension options and paste your Supabase URL and service key' };
  }

  const courses = await get('/Academics/MyCourses');
  if (looksLoggedOut(courses.body)) {
    await report(cfg, { ok: false, configured: true, reason: 'not signed in to Amizone in this browser — open s.amizone.net and log in' });
    return { ok: false, reason: 'not signed in to Amizone in this browser' };
  }

  // Per-course attendance registers. The id comes out of an onclick attribute,
  // and it is read here only to know WHICH pages to fetch — the parsing of them
  // still happens downstream.
  const ids = [...courses.body.matchAll(/FnAttendance\(\s*['"]?(\d+)/g)].map(m => m[1]);
  const registers = [];
  for (const id of [...new Set(ids)]) {
    const r = await get(`/Academics/MyCourses/_Attendance?id=${id}`);
    registers.push({ id, status: r.status, body: r.body });
  }

  const from = new Date(); from.setDate(from.getDate() - 60);
  const to = new Date(); to.setDate(to.getDate() + 21);
  const diary = await pullDiary(from, to);

  await memPut(cfg, 'amizone_raw', {
    fetched_at: new Date().toISOString(),
    source: 'chrome-extension',
    reason,
    window: { start: ymd(from), end: ymd(to) },
    courses: courses.body,
    registers,
    diary,
  });

  await report(cfg, {
    ok: true, configured: true,
    reason: `raw pages captured in this browser (${registers.length} registers, ${diary.length} diary chunks)`,
  });
  return { ok: true, registers: registers.length, diary: diary.length };
}

// ---------------------------------------------------------------- scheduling

async function arm() {
  const { every } = await settings();
  await chrome.alarms.clear(ALARM);
  // Alarms survive the service worker being torn down, which is the whole
  // reason the timer is not a setInterval: MV3 workers are killed aggressively
  // and a setInterval dies with them, silently, after about thirty seconds.
  chrome.alarms.create(ALARM, { periodInMinutes: every, delayInMinutes: 1 });
}

chrome.runtime.onInstalled.addListener(arm);
chrome.runtime.onStartup.addListener(arm);
chrome.storage.onChanged.addListener(arm);

chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== ALARM) return;
  try { await run('alarm'); } catch (e) { console.error('[amizone]', e); }
});

// The options page calls this for its "Run now" button.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'run-now') return false;
  run('manual').then(sendResponse).catch(e => sendResponse({ ok: false, reason: String(e.message || e) }));
  return true;                                   // keep the channel open for the async reply
});
