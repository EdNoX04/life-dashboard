// Integration test for `amizone-cookie-sync.mjs --from-raw`.
//
// Lives here rather than in tests/ because it needs linkedom (the DOM parser the
// workflow installs) and it spawns a fake Supabase, so the plain
// `node tests/*.test.js` runner would fail on the missing dependency rather than
// tell you something useful.
//
//   npm install --no-save linkedom@0.18.5
//   node automation/amizone/test-from-raw.mjs
//
// WHY IT EXISTS. The --from-raw path runs unattended, eight times a day, and it
// is the only thing standing between the browser's captures and the attendance
// number Neel actually reads. Two of its three exits are refusals, and a refusal
// that silently does not fire is how a dashboard ends up confidently showing
// last week's figures. So all three are exercised.

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const now = new Date();
const ymd = d => d.toISOString().slice(0, 10);

// Shaped like the real MyCourses table — including the duplicate elective row
// with no attendance cell, which the parser is specifically built to MERGE. If
// that merge ever regresses, this is what catches it.
const coursesHtml = `<table>
  <tr><td>CSE475</td><td>Blockchain Technology</td><td>18/20 (90.00)</td>
      <td><a onclick="FnAttendance(1001)">View</a></td></tr>
  <tr><td>ECE441</td><td>Internet of Things and System Design</td><td>27/29 (93.10)</td>
      <td><a onclick="FnAttendance(1002)">View</a></td></tr>
  <tr><td>CSE475</td><td>Blockchain</td><td>NA</td><td>Group Name</td></tr>
</table>`;

const registerHtml = `<table>
  <tr><td>01/09/2026</td><td>10:00-11:00</td><td>1</td><td>0</td></tr>
  <tr><td>02/09/2026</td><td>10:00-11:00</td><td>0</td><td>1</td></tr>
</table>`;

const raw = {
  fetched_at: new Date(Date.now() - 5 * 60000).toISOString(),
  source: 'chrome-extension',
  window: { start: ymd(now), end: ymd(now) },
  courses: coursesHtml,
  registers: [{ id: '1001', status: 200, body: registerHtml }, { id: '1002', status: 200, body: registerHtml }],
  diary: [{
    start: ymd(now), end: ymd(now), status: 200,
    body: JSON.stringify([
      { id: 1, title: 'Blockchain', start: `${ymd(now)}T10:00:00`, end: `${ymd(now)}T11:00:00`,
        CourseCode: 'CSE475', FacultyName: 'Dr X', RoomNo: 'LT-3', sType: 'C' },
      { id: 2, title: 'Holiday', start: `${ymd(now)}T00:00:00`, sType: 'H', allDay: true },
      // The chunks the extension fetches overlap at their boundaries, so the same
      // event genuinely arrives twice. It must be counted once.
      { id: 1, title: 'Blockchain', start: `${ymd(now)}T10:00:00`, sType: 'C' },
    ]),
  }],
};

const writes = [];
const run = (override, label) => new Promise(resolve => {
  const srv = createServer((req, res) => {
    if (req.method === 'GET' && (req.url || '').includes('amizone_raw')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(override === 'none' ? [] : [{ value: override ?? raw }]));
    }
    if (req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('[]'); }
    let body = ''; req.on('data', c => { body += c; });
    req.on('end', () => { writes.push(body); res.writeHead(201); res.end('{}'); });
  });
  srv.listen(0, () => {
    const out = `/tmp/amizone-raw-test-${label}.json`;
    try { fs.unlinkSync(out); } catch { /* first run */ }
    const p = spawn('node', [path.join(HERE, 'amizone-cookie-sync.mjs'), '--from-raw', '--out', out], {
      env: {
        ...process.env,
        SUPABASE_URL: `http://127.0.0.1:${srv.address().port}`,
        // Shape-valid but fake: the script refuses anything that is not a secret
        // key, and rightly — a publishable key cannot write.
        SUPABASE_SERVICE_KEY: 'sb_secret_faketestkeyforlocalharness',
      },
    });
    let so = '', se = '';
    p.stdout.on('data', d => { so += d; });
    p.stderr.on('data', d => { se += d; });
    p.on('close', code => {
      srv.close();
      let payload = null;
      try { payload = JSON.parse(fs.readFileSync(out, 'utf8')); } catch { /* refusals write nothing */ }
      resolve({ code, so, se, payload });
    });
  });
});

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log('FAIL ' + n); } };

// ---------------------------------------------------------- a fresh capture
{
  const r = await run(undefined, 'good');
  ok(r.code === 0, 'exits 0 on a fresh capture');
  const c = r.payload?.courses || [];
  ok(c.length === 2, `two courses, not three — the duplicate elective row is merged (got ${c.length})`);
  ok(c.find(x => x.code === 'CSE475')?.pct === 90, 'attendance percentage survives');
  ok(c.find(x => x.code === 'ECE441')?.pct === 93, 'for every course');
  ok(c.length === 2 && c.every(x => x.records.length === 2), 'registers are matched to courses by id and parsed');
  ok((r.payload?.events || []).length === 2, `overlapping diary chunks de-duplicate (got ${r.payload?.events?.length})`);
  ok(r.payload?.session?.source === 'chrome-extension', 'the payload records where the bytes came from');
  ok(/parsed pages captured by the browser/.test(writes.join()), 'and reports healthy into sync_status');
}

// ---------------------------------------------------------- a stale capture
// The failure this prevents is not an error anyone would see: it is a dashboard
// serving last week's attendance as today's, which has happened twice.
{
  writes.length = 0;
  const r = await run({ ...raw, fetched_at: new Date(Date.now() - 30 * 3600e3).toISOString() }, 'stale');
  ok(r.code === 8, `a 30-hour-old capture is refused (exit ${r.code})`);
  ok(/30\.0h old/.test(r.se), 'and the age is stated');
  ok(/Refusing to publish stale attendance/.test(r.se), 'in words that say why it matters');
  ok(/captured pages are/.test(writes.join()), 'and the reason reaches the dashboard, not just the log');
  ok(!r.payload, 'nothing is written when it refuses');
}

// ---------------------------------------------------------- never captured
{
  writes.length = 0;
  const r = await run('none', 'empty');
  ok(r.code === 7, `exits 7 when the browser extension has never run (exit ${r.code})`);
  ok(/extension/i.test(r.se + writes.join()), 'and says to install the extension rather than blaming the cookie');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
