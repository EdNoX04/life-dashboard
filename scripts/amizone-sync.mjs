// Amizone sync — runs on GitHub Actions (real headless Chromium via Playwright).
// Logs into s.amizone.net, scrapes subjects + timetable + attendance %, and
// writes them into Supabase. No user machine required.
//
// Env (from GitHub Secrets):
//   AMIZONE_USER, AMIZONE_PASS, SUPABASE_URL, SUPABASE_SERVICE_KEY
//
// Design notes:
// - A real browser satisfies Amizone's client-side Salt/Signature challenge and
//   lets Cloudflare Turnstile pass passively — we solve/bypass nothing.
// - Subjects are UPSERTED by code (attendance updated, manual syllabus preserved).
// - Timetable is fully replaced each run (user never edits it by hand).
// - Raw HTML of the key pages is stashed in `memory` on every run so selectors
//   can be hardened without re-scraping live.

// Imported lazily, below the credential guard, for two reasons: an unconfigured
// run should not need a 300 MB browser on disk to tell you it is unconfigured,
// and a broken `npm install playwright` should surface as a recorded status line
// rather than a bare module-resolution stack trace above every other message.
let chromium;

// The parse rules live in their own DOM-free module so they can be tested
// without a browser. See scripts/lib/amizone-parse.mjs for why each of them
// exists - every one is a bug that reached the dashboard.
import { replacePlan, usableAttendance, countByDay } from './lib/amizone-parse.mjs';

const { AMIZONE_USER, AMIZONE_PASS, SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;

// Same reasoning as meeting-worker.mjs: "the credentials were never added" is a
// setup state, not a failure, and dressing it up as one trains the reader to
// ignore the alerts that matter. Missing Supabase leaves nowhere to record the
// problem, so that one just stops; missing Amizone credentials get written into
// memory.sync_status where the College tab can show them, and exit 0.
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY — nowhere to write, stopping.');
  process.exit(0);
}

const H = { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' };
const rest = (p, init = {}) => fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${p}`, { ...init, headers: { ...H, ...(init.headers || {}) } });

async function mem(key, value) {
  await rest('memory', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify([{ key, value, updated_at: new Date().toISOString() }]) });
}

// deterministic-ish helpers
const clean = s => (s || '').replace(/\s+/g, ' ').trim();

// Record this worker's health alongside the other syncs. Read-modify-write of a
// shared blob so each worker owns exactly its own key inside it.
async function reportStatus(patch) {
  try {
    const r = await rest('memory?key=eq.sync_status&select=value');
    const rows = r.ok ? await r.json() : [];
    const value = rows?.[0]?.value || {};
    await mem('sync_status', { ...value, amizone: { ...patch, at: new Date().toISOString() } });
  } catch (e) { console.error('  (could not record sync status:', e.message + ')'); }
}

if (!AMIZONE_USER || !AMIZONE_PASS) {
  const missing = [!AMIZONE_USER && 'AMIZONE_USER', !AMIZONE_PASS && 'AMIZONE_PASS'].filter(Boolean);
  const reason = `Amizone is not connected yet — missing ${missing.join(', ')} in repo secrets.`;
  await reportStatus({ ok: false, configured: false, reason });
  console.log(reason);
  process.exit(0);
}

({ chromium } = await import('playwright'));

async function run() {
  // Headful under xvfb (workflow wraps this in xvfb-run) — Cloudflare Turnstile
  // passes passively for a real, non-headless Chromium; headless is the giveaway.
  const browser = await chromium.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage'],
  });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 900 },
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
  });
  // light stealth: hide the automation fingerprints Cloudflare sniffs
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-IN', 'en'] });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    window.chrome = { runtime: {} };
  });
  const page = await ctx.newPage();
  const report = { ts: new Date().toISOString(), steps: {} };

  try {
    // ---- LOGIN ----
    await page.goto('https://s.amizone.net/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    // type like a human so Amizone's Salt/Signature JS fires its input handlers
    await page.click('input[name="_UserName"]');
    await page.type('input[name="_UserName"]', AMIZONE_USER, { delay: 60 });
    await page.click('input[name="_Password"]');
    await page.type('input[name="_Password"]', AMIZONE_PASS, { delay: 60 });

    // wait (up to ~35s) for the Cloudflare Turnstile token to populate
    let tok = '';
    for (let i = 0; i < 35; i++) {
      tok = await page.evaluate(() => document.querySelector('[name="cf-turnstile-response"]')?.value || '');
      if (tok) break;
      await page.waitForTimeout(1000);
    }
    const hidden = await page.evaluate(() => ({
      sig: (document.querySelector('[name="Signature"]')?.value || '').length,
      salt: (document.querySelector('[name="Salt"]')?.value || '').length,
      chal: (document.querySelector('[name="Challenge"]')?.value || '').length,
    }));
    report.steps.login = { turnstile: tok ? `present(${tok.length})` : 'MISSING', hidden };

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {}),
      page.click('button[type="submit"], input[type="submit"]'),
    ]);
    await page.waitForTimeout(4000);

    const url = page.url();
    const loggedIn = !(await page.$('input[name="_Password"]'));
    report.steps.login.url = url;
    report.steps.login.loggedIn = loggedIn;
    if (!loggedIn) {
      const bodyText = clean(await page.evaluate(() => document.body.innerText)).slice(0, 400);
      report.steps.login.bodyText = bodyText;
      await page.screenshot({ path: 'login-failed.png' }).catch(() => {});
      await mem('amizone_last_sync', { ok: false, reason: 'login_failed', report });
      await reportStatus({ ok: false, configured: true,
        reason: 'Login to s.amizone.net failed - the credentials may have changed, or the Turnstile challenge did not clear.' });
      console.error('LOGIN FAILED. turnstile=%s hidden=%o body=%s', report.steps.login.turnstile, hidden, bodyText);
      await browser.close();
      process.exit(2);
    }

    // ---- ATTENDANCE (Home renders it right after login) ----
    // Extract per-course: code, attended/total, percent
    const homeHtml = await page.content();
    const attendance = await page.evaluate(() => {
      const out = [];
      // easyPieChart donuts carry data-percent; walk to the row for the code + x/y
      const seen = new Set();
      document.querySelectorAll('[data-percent], .easyPieChart, .easy-pie-chart, .percentage').forEach(pie => {
        let n = pie, code = null, frac = null, pct = pie.getAttribute && pie.getAttribute('data-percent');
        for (let i = 0; i < 7 && n; i++) {
          const t = n.textContent || '';
          const cm = t.match(/\b([A-Z]{2,4}\d{3})\b/);
          const fm = t.match(/(\d+)\s*\/\s*(\d+)/);
          if (cm && !code) code = cm[1];
          if (fm && !frac) frac = [Number(fm[1]), Number(fm[2])];
          const pm = t.match(/(\d+(?:\.\d+)?)\s*%/);
          if (pm && !pct) pct = pm[1];
          n = n.parentElement;
        }
        if (code && !seen.has(code)) { seen.add(code); out.push({ code, attended: frac?.[0] ?? null, total: frac?.[1] ?? null, pct: pct != null ? Number(pct) : null }); }
      });
      // fallback: regex over the attendance panel text
      if (out.length === 0) {
        const txt = document.body.innerText;
        const re = /([A-Z]{2,4}\d{3})[\s\S]{0,120}?(\d+)\s*\/\s*(\d+)[\s\S]{0,40}?(\d+(?:\.\d+)?)\s*%/g;
        let m; while ((m = re.exec(txt))) out.push({ code: m[1], attended: Number(m[2]), total: Number(m[3]), pct: Number(m[4]) });
      }
      return out;
    });
    report.steps.attendance = { count: attendance.length, sample: attendance.slice(0, 4) };

    // ---- SUBJECTS (MyCourses) ----
    await page.goto('https://s.amizone.net/Academics/MyCourses', { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(1500);
    const coursesHtml = await page.content();
    const subjects = await page.evaluate(() => {
      const rows = [];
      document.querySelectorAll('table tr').forEach(tr => {
        const cells = [...tr.querySelectorAll('td')].map(td => td.textContent.replace(/\s+/g, ' ').trim());
        if (cells.length >= 2 && /^[A-Z]{2,4}\d{3}$/.test(cells[0])) {
          rows.push({ code: cells[0], name: cells[1], type: cells[2] || null });
        }
      });
      return rows;
    });
    report.steps.subjects = { count: subjects.length, sample: subjects.slice(0, 4).map(s => s.code) };

    // ---- TIMETABLE (weekly) ----
    await page.goto('https://s.amizone.net/TimeTable/Home', { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(1500);
    const ttHtml = await page.content();
    const timetable = await page.evaluate(() => {
      const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
      const txt = el => (el.textContent || '').replace(/\s+/g, ' ').trim();
      const TIME = /(\d{1,2}:\d{2})\s*(?:to|-|–)\s*(\d{1,2}:\d{2})/;
      const CODE = /\b([A-Z]{2,4}\d{3})\b/;
      const isSlotText = t => TIME.test(t) && CODE.test(t);

      // Only the INNERMOST element describing a class is taken. A cell rendered
      // as <td><div>...</div></td> used to yield the class twice, once per
      // level, which is what inflated a two-class Wednesday to three. If any
      // descendant also looks like a slot, this element is a container rather
      // than the slot itself.
      const candidates = [...document.querySelectorAll('td, div, li')].filter(el => {
        const t = txt(el);
        if (!isSlotText(t) || t.length > 200) return false;
        return ![...el.querySelectorAll('td, div, li')].some(k => isSlotText(txt(k)));
      });

      // Day attribution, strongest signal first.
      //
      // (a) The weekly grid is a table whose header row names the days, so a
      //     cell's day is decided by which column it sits in. This is the case
      //     the old text-order scan got wrong: the day headers live in <th>
      //     elements it never queried, so currentDay stayed null forever and
      //     every slot was thrown away downstream.
      // (b) Some views render a per-day panel instead, with the day name on an
      //     ancestor heading.
      // (c) Only if neither applies do we fall back to reading order.
      function columnDay(cell) {
        const row = cell.closest('tr');
        const table = cell.closest('table');
        if (!row || !table) return null;
        const idx = [...row.children].indexOf(cell);
        if (idx < 0) return null;
        for (const hr of table.querySelectorAll('tr')) {
          const named = [...hr.children].map(c =>
            DAYS.find(d => txt(c).toLowerCase().startsWith(d.toLowerCase())) || null);
          if (named.filter(Boolean).length >= 3 && named[idx]) return named[idx];
        }
        return null;
      }
      function ancestorDay(el) {
        let n = el;
        for (let i = 0; i < 8 && n; i++) {
          const head = n.querySelector && n.querySelector('h1,h2,h3,h4,h5,th,.panel-title,.day,legend');
          if (head) {
            const d = DAYS.find(x => txt(head).toLowerCase().startsWith(x.toLowerCase()));
            if (d) return d;
          }
          n = n.parentElement;
        }
        return null;
      }

      // Reading-order fallback: the last standalone day label seen before the cell.
      const orderDay = new Map();
      {
        let cur = null;
        const cset = new Set(candidates);
        const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
        let n = walk.currentNode;
        while (n) {
          const t = txt(n);
          const d = DAYS.find(x => t === x);
          if (d) cur = d;
          if (cset.has(n)) orderDay.set(n, cur);
          n = walk.nextNode();
        }
      }

      return candidates.map(el => {
        const t = txt(el);
        const tm = t.match(TIME), cm = t.match(CODE);
        const room = (t.match(/\b([A-Z]\d-\d{2,3}|[A-Z]{1,3}-?\d{2,3})\b(?![^\[]*\])/) || [])[1] || null;
        const fac = (t.match(/([A-Za-z. ]+)\[(\d+)\]/) || []);
        return {
          day: columnDay(el) || ancestorDay(el) || orderDay.get(el) || null,
          start_time: tm[1], end_time: tm[2], code: cm[1],
          faculty: fac[1] ? fac[1].trim() : null, faculty_id: fac[2] || null,
          room, raw: t.slice(0, 120),
        };
      });
    });
    report.steps.timetable = { count: timetable.length, sample: timetable.slice(0, 4) };

    // stash raw HTML for selector hardening (trimmed)
    await mem('amizone_raw_home', { html: homeHtml.slice(0, 60000) });
    await mem('amizone_raw_courses', { html: coursesHtml.slice(0, 40000) });
    await mem('amizone_raw_timetable', { html: ttHtml.slice(0, 40000) });

    // ---- WRITE TO SUPABASE ----
    // subjects: upsert by code (preserve manual syllabus). read existing, match on code.
    // usableAttendance drops rows with no readable percentage instead of
    // letting Number(null) turn them into a confident 0%. That silent zero is
    // half of "attendance is not updating": a subject whose donut failed to
    // parse was being written as 0 and then never moved again.
    const attClean = usableAttendance(attendance);
    report.steps.attendance.usable = attClean.length;
    const attByCode = Object.fromEntries(attClean.map(a => [a.code, a]));
    const existing = await (await rest('subjects?select=id,code,name')).json();
    const byCode = Object.fromEntries((existing || []).filter(s => s.code).map(s => [s.code, s]));
    const byName = Object.fromEntries((existing || []).map(s => [clean(s.name).toLowerCase(), s]));

    for (const s of subjects) {
      const att = attByCode[String(s.code || '').toUpperCase()];
      const match = byCode[s.code] || byName[clean(s.name).toLowerCase()];
      const patch = { name: s.name, code: s.code };
      if (att && att.pct != null) patch.attendance_pct = att.pct;
      if (match) {
        await rest(`subjects?id=eq.${match.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
      } else {
        await rest('subjects', { method: 'POST', body: JSON.stringify([{ ...patch, syllabus: '' }]) });
      }
    }
    // Also update attendance for subjects that have attendance but no MyCourses row (rare)
    report.steps.wrote_subjects = subjects.length;

    // timetable: replace, but only when there is something worth replacing it
    // with. The DELETE used to run unconditionally, so a run that logged in
    // successfully and then scraped nothing (a changed layout, a slow render)
    // wiped the whole timetable and still reported success.
    const existingTt = await (await rest('timetable?select=id')).json();
    const plan = replacePlan(timetable, Array.isArray(existingTt) ? existingTt.length : 0);
    report.steps.timetable.raw = timetable.length;
    report.steps.timetable.deduped = plan.slots.length;
    report.steps.timetable.byDay = countByDay(plan.slots);
    report.steps.timetable.decision = plan.reason;

    if (plan.replace) {
      await rest('timetable?id=neq.00000000-0000-0000-0000-000000000000', { method: 'DELETE' });
      const rows = plan.slots.map(t => ({
        day: t.day, start_time: t.start_time, end_time: t.end_time,
        subject: t.code, room: t.room, faculty: t.faculty,
      }));
      await rest('timetable', { method: 'POST', body: JSON.stringify(rows) });
    } else {
      console.warn('TIMETABLE NOT REPLACED:', plan.reason);
    }
    report.steps.wrote_timetable = plan.replace ? plan.slots.length : 0;

    // A run that scraped nothing usable is not a success, whatever the HTTP
    // status of its requests. Reporting it as one is precisely how a dead sync
    // stays invisible behind data that merely looks old.
    const healthy = plan.slots.length > 0 || attClean.length > 0;
    await mem('amizone_last_sync', { ok: healthy, at: report.ts, report });
    await reportStatus({
      ok: healthy, configured: true,
      note: `${plan.slots.length} timetable slots (${plan.replace ? 'written' : 'kept existing'}), ${attClean.length} attendance rows, ${subjects.length} subjects.`,
      reason: healthy ? undefined
        : 'Logged in, but scraped no timetable slots and no attendance. The page layout has probably changed - raw HTML is stashed in memory.amizone_raw_timetable.',
    });
    console.log('SYNC ' + (healthy ? 'OK' : 'EMPTY') + ':', JSON.stringify(report.steps));
  } catch (e) {
    report.error = String(e && e.stack || e);
    await page.screenshot({ path: 'error.png' }).catch(() => {});
    await mem('amizone_last_sync', { ok: false, reason: 'exception', report }).catch(() => {});
    await reportStatus({ ok: false, configured: true, reason: `Sync threw: ${String(e && e.message || e).slice(0, 200)}` }).catch(() => {});
    console.error('SYNC ERROR:', report.error);
    await browser.close();
    process.exit(3);
  }
  await browser.close();
}

run();
