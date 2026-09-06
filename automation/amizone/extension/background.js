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
//
// AND "WHERE" TURNED OUT TO MEAN A TAB, NOT THIS WORKER.
//
// Two versions of this file tried to make the service worker's own fetch carry
// the ticket and both failed — see amizoneTab() below for what was measured.
// The requests now run inside a page on s.amizone.net, which is the context
// that was proven to work rather than the one that ought to.

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

// ------------------------------------------------- fetching from a real tab

/**
 * THE PATH THAT ACTUALLY WORKS, AND WHY IT TOOK THREE TRIES TO GET HERE.
 *
 * Measured from Neel's signed-in browser: `/Academics/MyCourses` requested from
 * an Amizone PAGE returns 200, 29,150 bytes, five courses. The identical request
 * from this service worker returns the login page. Two attempts to make the
 * worker's own fetch carry the ticket — `credentials: 'include'`, then a
 * declarativeNetRequest Cookie header off `chrome.cookies` — each failed for a
 * different reason, and the third failure was a bare "TypeError: Failed to
 * fetch" with nothing to read.
 *
 * So stop trying to reconstruct a first-party request and just BE one. A script
 * injected into a tab on s.amizone.net fetches with that page's origin: same
 * site, cookies attached by Chrome itself, no SameSite question, no cookie jar
 * to query, nothing to get subtly wrong. It is exactly the context that was
 * measured working.
 *
 * The tab is reused if Neel already has Amizone open, and otherwise opened
 * inactive and closed afterwards — on the always-on machine that is an
 * invisible background tab for a few seconds every half hour.
 */
async function amizoneTab() {
  const open = await chrome.tabs.query({ url: 'https://s.amizone.net/*' });
  const ready = open.find(t => t.status === 'complete');
  if (ready) return { tabId: ready.id, ours: false };

  const wins = await chrome.windows.getAll({ windowTypes: ['normal'] });
  let tab;
  if (wins.length) {
    tab = await chrome.tabs.create({ windowId: wins[0].id, url: AMIZONE + '/Home', active: false });
  } else {
    // `--no-startup-window` means there may be no window at all. Minimized so
    // it never steals focus from whatever is on screen.
    const w = await chrome.windows.create({ url: AMIZONE + '/Home', focused: false, state: 'minimized' });
    tab = w.tabs[0];
  }
  await new Promise((resolve) => {
    const done = () => { chrome.tabs.onUpdated.removeListener(on); clearTimeout(bail); resolve(); };
    const on = (id, info) => { if (id === tab.id && info.status === 'complete') done(); };
    chrome.tabs.onUpdated.addListener(on);
    // A tab that never finishes loading must not hang the run forever; the
    // fetches below will fail loudly on their own if the page really is broken.
    const bail = setTimeout(done, 20000);
  });
  return { tabId: tab.id, ours: true };
}

/** Run every fetch inside the page, in one round trip. */
async function fetchInTab(tabId, paths) {
  const [hit] = await chrome.scripting.executeScript({
    target: { tabId },
    args: [paths],
    func: async (list) => {
      const out = [];
      for (const p of list) {
        try {
          const r = await fetch(p, { credentials: 'include', cache: 'no-store' });
          out.push({ path: p, status: r.status, body: await r.text() });
        } catch (e) {
          out.push({ path: p, status: 0, body: '', error: String(e && e.message || e) });
        }
      }
      return out;
    },
  });
  if (!hit || !Array.isArray(hit.result)) throw new Error('the injected fetch returned nothing — the tab may have navigated away');
  return hit.result;
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

async function run(reason = 'alarm') {
  const cfg = await settings();
  if (!cfg.url || !cfg.key) {
    return { ok: false, reason: 'not configured — open the extension options and paste your Supabase URL and service key' };
  }

  // Every stage is named. The last round of this failed with a bare
  // "TypeError: Failed to fetch" on the errors page and nothing to read: no
  // indication whether it was Amizone, Supabase, or the injection itself. A
  // message that does not say WHERE it broke costs another whole round trip.
  let stage = 'start';
  let tab = null;
  try {
    stage = 'opening an Amizone tab';
    tab = await amizoneTab();

    stage = 'fetching MyCourses in that tab';
    const [courses] = await fetchInTab(tab.tabId, ['/Academics/MyCourses']);
    if (courses.error) throw new Error(courses.error);
    if (looksLoggedOut(courses.body)) {
      const msg = `Amizone returned the login page in its own tab (HTTP ${courses.status}, ${courses.body.length} bytes) — open s.amizone.net in this browser and sign in`;
      await report(cfg, { ok: false, configured: true, reason: msg });
      return { ok: false, reason: msg };
    }

    stage = 'listing attendance registers';
    const ids = [...new Set([...courses.body.matchAll(/FnAttendance\(\s*['"]?(\d+)/g)].map(m => m[1]))];

    const from = new Date(); from.setDate(from.getDate() - 60);
    const to = new Date(); to.setDate(to.getDate() + 21);

    // The diary window in DIARY_CHUNK_DAYS slices — see the cliff note above.
    const chunks = [];
    for (let cur = new Date(from); cur <= to;) {
      const hi = new Date(cur); hi.setDate(hi.getDate() + DIARY_CHUNK_DAYS);
      const end = hi > to ? to : hi;
      chunks.push({ start: ymd(cur), end: ymd(end) });
      cur = new Date(end); cur.setDate(cur.getDate() + 1);
    }

    // One injection for everything else. Twenty separate executeScript calls
    // would each pay the round trip and each risk the tab moving underneath.
    stage = 'fetching registers, diary and placements in that tab';
    const paths = [
      ...ids.map(id => `/Academics/MyCourses/_Attendance?id=${id}`),
      ...chunks.map(c => `/Calendar/home/GetDiaryEvents?start=${c.start}&end=${c.end}`),
      '/Placement/PlacementDetails',
      '/Placement/CorporatEvent',
    ];
    const res = await fetchInTab(tab.tabId, paths);
    const at = p => res.find(r => r.path === p) || { status: 0, body: '' };

    const registers = ids.map((id, i) => ({ id, status: res[i].status, body: res[i].body }));
    const diary = chunks.map((c, i) => {
      const r = res[ids.length + i];
      return { start: c.start, end: c.end, status: r.status, body: r.body };
    });
    const placement = at('/Placement/PlacementDetails');
    const corporate = at('/Placement/CorporatEvent');

    stage = 'writing to Supabase';
    await memPut(cfg, 'amizone_raw', {
      fetched_at: new Date().toISOString(),
      source: 'chrome-extension',
      reason,
      window: { start: ymd(from), end: ymd(to) },
      courses: courses.body,
      registers,
      diary,
      placement: placement.body || '',
      corporate: corporate.body || '',
    });

    await report(cfg, {
      ok: true, configured: true,
      reason: `raw pages captured in ${tab.ours ? 'a background' : 'your open'} Amizone tab (${registers.length} registers, ${diary.length} diary chunks, placement ${placement.status || 'failed'})`,
    });
    return {
      ok: true, registers: registers.length, diary: diary.length,
      placement: placement.status || 0, via: tab.ours ? 'background tab' : 'your open tab',
    };
  } catch (e) {
    const msg = `failed while ${stage}: ${String(e && e.message || e)}`;
    await report(cfg, { ok: false, configured: true, reason: msg });
    return { ok: false, reason: msg };
  } finally {
    // Only ever close a tab this run opened. Closing Neel's own Amizone tab
    // out from under him would be its own bug report.
    if (tab?.ours) { try { await chrome.tabs.remove(tab.tabId); } catch { /* already gone */ } }
  }
}

// ---------------------------------- scheduling

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
  // run() reports its own failures now, with the stage named. This catch is for
  // the case it cannot: a throw before the try block, i.e. reading settings.
  try {
    const r = await run('alarm');
    if (!r.ok) console.warn('[amizone]', r.reason);
    // Remember it, so the popup shows the last ALARM outcome too and not only
    // the last time the button was pressed.
    await chrome.storage.local.set({ lastRun: { ok: r.ok, text: r.ok ? 'Scheduled run captured the pages.' : `Scheduled run: ${r.reason}`, at: Date.now() } });
  } catch (e) { console.error('[amizone]', e); }
});

// The options page calls this for its "Run now" button.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'run-now') return false;
  run('manual').then(sendResponse).catch(e => sendResponse({ ok: false, reason: String(e.message || e) }));
  return true;                                   // keep the channel open for the async reply
});
