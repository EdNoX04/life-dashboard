/*
 * scrape-in-page.js — the READ half of the Amizone sync.
 *
 * This is not run by node. It is evaluated inside a real, already-logged-in
 * Amizone tab on Neel's Mac (the Claude browser pane), by
 * Claude_Browser__javascript_tool. That is the whole trick: every previous
 * approach tried to get a session cookie OUT of a browser and into an
 * automated one, and Amizone's session cookie has no expiry, so Chrome never
 * writes it to disk and it dies with the window. Nothing leaves the browser
 * here except the parsed JSON.
 *
 * Same-origin fetches with credentials: include — so the requests are
 * indistinguishable from the page's own, no Turnstile involved (Turnstile
 * guards the LOGIN, not the session).
 *
 * The body is copied from scrapeInPage() in amizone-auto.mjs so both halves
 * parse identically; keep them in step if either changes.
 *
 * Returns: { needLogin, courses: [{code,name,pct,attId,records[]}], events[], window }
 * Feed that JSON to amizone-push.mjs --payload.
 */
(async () => {
  const pad = n => String(n).padStart(2, '0');
  const d = new Date();
  const fmt = x => `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
  const from = new Date(d); from.setDate(from.getDate() - 60);
  const to = new Date(d); to.setDate(to.getDate() + 14);
  const startDate = fmt(from), endDate = fmt(to);

  const txt = async (u) => (await fetch(u, { credentials: 'include' })).text();

  const html = await txt('/Academics/MyCourses');
  if (/name=['"]?_?UserName/i.test(html) || /login/i.test(html.slice(0, 400))) {
    return JSON.stringify({ needLogin: true });
  }
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

  for (const c of courses) {
    c.records = [];
    if (!c.attId) continue;
    try {
      const dhtml = await txt(`/Academics/MyCourses/_Attendance?id=${c.attId}`);
      const dd = new DOMParser().parseFromString(dhtml, 'text/html');
      for (const tr of dd.querySelectorAll('tr')) {
        const td = [...tr.querySelectorAll('td')].map(x => x.textContent.replace(/\s+/g, ' ').trim());
        if (td.length < 4) continue;
        const dateCell = td.find(x => /\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(x));
        if (!dateCell) continue;
        const nums = td.filter(x => /^\d+$/.test(x)).map(Number);
        const present = nums.length >= 2 ? nums[nums.length - 2] : (nums[0] ?? 0);
        const absent = nums.length >= 2 ? nums[nums.length - 1] : (nums[1] ?? 0);
        const timings = (td.find(x => /\d{1,2}:\d{2}/.test(x)) || '').trim();
        c.records.push({ dateRaw: dateCell, timings, present, absent });
      }
    } catch (e) { c.recErr = String(e); }
  }

  let events = [];
  try {
    const j = await (await fetch(`/Calendar/home/GetDiaryEvents?start=${startDate}&end=${endDate}`, { credentials: 'include' })).json();
    events = (Array.isArray(j) ? j : []).map(e => ({
      title: e.title, start: e.start, end: e.end, code: e.CourseCode,
      faculty: e.FacultyName, room: e.RoomNo, sType: e.sType, allDay: e.allDay,
    }));
  } catch (e) { events = []; }

  return JSON.stringify({ needLogin: false, window: { start: startDate, end: endDate }, courses, events });
})()
