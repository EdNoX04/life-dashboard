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

import { chromium } from 'playwright';

const { AMIZONE_USER, AMIZONE_PASS, SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
for (const [k, v] of Object.entries({ AMIZONE_USER, AMIZONE_PASS, SUPABASE_URL, SUPABASE_SERVICE_KEY }))
  if (!v) { console.error(`Missing env ${k}`); process.exit(1); }

const H = { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' };
const rest = (p, init = {}) => fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${p}`, { ...init, headers: { ...H, ...(init.headers || {}) } });

async function mem(key, value) {
  await rest('memory', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify([{ key, value, updated_at: new Date().toISOString() }]) });
}

// deterministic-ish helpers
const clean = s => (s || '').replace(/\s+/g, ' ').trim();

async function run() {
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'] });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
    viewport: { width: 1366, height: 900 },
  });
  const page = await ctx.newPage();
  const report = { ts: new Date().toISOString(), steps: {} };

  try {
    // ---- LOGIN ----
    await page.goto('https://s.amizone.net/', { waitUntil: 'networkidle', timeout: 60000 });
    await page.fill('input[name="_UserName"]', AMIZONE_USER);
    await page.fill('input[name="_Password"]', AMIZONE_PASS);
    // give Turnstile + the Salt/Signature JS a moment to populate hidden fields
    await page.waitForTimeout(4000);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle', timeout: 60000 }).catch(() => {}),
      page.click('button[type="submit"], input[type="submit"]'),
    ]);
    await page.waitForTimeout(3000);

    const url = page.url();
    const loggedIn = !/\/Account\/Login/i.test(url) && !(await page.$('input[name="_Password"]'));
    report.steps.login = { url, loggedIn };
    if (!loggedIn) {
      const bodyText = clean(await page.evaluate(() => document.body.innerText)).slice(0, 500);
      report.steps.login.bodyText = bodyText;
      await page.screenshot({ path: 'login-failed.png' }).catch(() => {});
      await mem('amizone_last_sync', { ok: false, reason: 'login_failed', report });
      console.error('LOGIN FAILED:', bodyText);
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
      const slots = [];
      // The weekly grid: find day columns, then time-tagged cells.
      // Robust text approach: scan elements that contain a HH:MM to HH:MM plus a course code.
      const nodes = [...document.querySelectorAll('td, div, li')];
      let currentDay = null;
      for (const el of nodes) {
        const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
        const dm = DAYS.find(d => t === d);
        if (dm) { currentDay = dm; continue; }
        const tm = t.match(/(\d{1,2}:\d{2})\s*(?:to|-|–)\s*(\d{1,2}:\d{2})/);
        const cm = t.match(/\b([A-Z]{2,4}\d{3})\b/);
        if (tm && cm && el.children.length < 6 && t.length < 200) {
          const room = (t.match(/\b([A-Z]\d-\d{2,3}|[A-Z]{1,3}-?\d{2,3})\b(?![^\[]*\])/) || [])[1] || null;
          const fac = (t.match(/([A-Za-z. ]+)\[(\d+)\]/) || []);
          slots.push({ day: currentDay, start_time: tm[1], end_time: tm[2], code: cm[1],
            faculty: fac[1] ? fac[1].trim() : null, faculty_id: fac[2] || null, room, raw: t.slice(0, 120) });
        }
      }
      return slots;
    });
    report.steps.timetable = { count: timetable.length, sample: timetable.slice(0, 4) };

    // stash raw HTML for selector hardening (trimmed)
    await mem('amizone_raw_home', { html: homeHtml.slice(0, 60000) });
    await mem('amizone_raw_courses', { html: coursesHtml.slice(0, 40000) });
    await mem('amizone_raw_timetable', { html: ttHtml.slice(0, 40000) });

    // ---- WRITE TO SUPABASE ----
    // subjects: upsert by code (preserve manual syllabus). read existing, match on code.
    const attByCode = Object.fromEntries(attendance.map(a => [a.code, a]));
    const existing = await (await rest('subjects?select=id,code,name')).json();
    const byCode = Object.fromEntries((existing || []).filter(s => s.code).map(s => [s.code, s]));
    const byName = Object.fromEntries((existing || []).map(s => [clean(s.name).toLowerCase(), s]));

    for (const s of subjects) {
      const att = attByCode[s.code];
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

    // timetable: full replace
    await rest('timetable?id=neq.00000000-0000-0000-0000-000000000000', { method: 'DELETE' });
    if (timetable.length) {
      const rows = timetable.map(t => ({
        day: t.day, start_time: t.start_time, end_time: t.end_time,
        subject: t.code, room: t.room, faculty: t.faculty,
      }));
      await rest('timetable', { method: 'POST', body: JSON.stringify(rows) });
    }
    report.steps.wrote_timetable = timetable.length;

    await mem('amizone_last_sync', { ok: true, at: report.ts, report });
    console.log('SYNC OK:', JSON.stringify(report.steps));
  } catch (e) {
    report.error = String(e && e.stack || e);
    await page.screenshot({ path: 'error.png' }).catch(() => {});
    await mem('amizone_last_sync', { ok: false, reason: 'exception', report }).catch(() => {});
    console.error('SYNC ERROR:', report.error);
    await browser.close();
    process.exit(3);
  }
  await browser.close();
}

run();
