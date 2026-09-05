// Placement drives.
//
// Neel: "under placement they show new companies which we have to apply till the
// deadline ... if that is visible it would be good."
//
// The bar for this one is different from the rest of the app. A stale attendance
// number costs a bad guess about skipping a lecture. A registration window that
// closes unannounced costs the drive. So the tests below are mostly about the
// two ways this could fail QUIETLY:
//
//   1. dd/mm read as mm/dd — 03/09 becoming March, and a deadline warning firing
//      six months late, with nothing on screen looking wrong in the meantime.
//   2. an OPEN drive rendered with markup this parser has never seen, falling
//      through to nothing. On the day it was written every drive was applied,
//      closed or ineligible, so the open-state markup is genuinely unobserved —
//      the module has to be loud about not knowing rather than silent.

import {
  parseIndDate, parseWindow, parsePlacements, parseCorporateEvents,
  placementView, placementSummary, deadlineSoon, hoursLeft, driveId, STATUS_LABEL,
} from '../src/lib/placements.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log('FAIL ' + n); } };
const eq = (a, b, n) => ok(Object.is(a, b), `${n} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

// ---------------------------------------------------------------- dd/mm/yyyy
{
  const d = parseIndDate('03/09/2026');
  eq(d.getDate(), 3, 'the day comes first');
  eq(d.getMonth(), 8, 'and 09 is September, not March — the whole feature turns on this');
  eq(d.getFullYear(), 2026, 'year');
  eq(d.getHours(), 0, 'a bare date starts at midnight');

  const e = parseIndDate('04/09/2026', true);
  eq(e.getHours(), 23, 'as an END it means the end of that day');
  eq(e.getMinutes(), 59, 'not midnight, which would close the window a day early');

  eq(parseIndDate('03/09/2026 08:00 PM').getHours(), 20, '8 PM is 20:00');
  eq(parseIndDate('03/09/2026 09:00 AM').getHours(), 9, '9 AM is 09:00');
  eq(parseIndDate('26/08/2026 12:30 AM').getHours(), 0, 'and midnight is 00:30, not 12:30');
  eq(parseIndDate('26/08/2026 12:30 PM').getHours(), 12, 'while noon stays 12:30');
  eq(parseIndDate('nonsense'), null, 'unparseable is null rather than an Invalid Date that formats as blank');
}

// ---------------------------------------------------------------- the window line
{
  const w = parseWindow('Reg. 02/09/2026 – 03/09/2026 08:00 PM');
  eq(w.start.getDate(), 2, 'start day');
  eq(w.end.getDate(), 3, 'end day');
  eq(w.end.getHours(), 20, 'with the stated closing time');

  eq(parseWindow('Reg. 02/09/2026 - 04/09/2026 06:00 PM').end.getHours(), 18,
     'a plain hyphen separates as well as an en dash — the separator is cosmetic and has moved before');
  eq(parseWindow('02/09/2026 to 04/09/2026').end.getDate(), 4, 'and so does the word "to"');
  eq(parseWindow('').end, null, 'an empty line yields no end rather than an exception');
}

// ---------------------------------------------------------------- real markup
//
// Copied from the live page on 2026-09-05, trimmed to the parts that matter.
const card = (co, dates, status, extra = '') => `
<div class="pd-card ">
  <input type="hidden" name="Report[0].iPlacementid" value="123" />
  <div class="pd-card-top"><div class="pd-card-left">
    <div class="pd-avatar pd-avatar-locked">SH</div>
    <div><p class="pd-card-company">${co}</p>
    <p class="pd-card-dates">Reg. ${dates}</p></div>
  </div>
  <span class="pd-card-status pd-status-${status}">${status}</span>
  ${extra}
  <div><a class="pd-card-details-link" href="https://img.amizone.net/AzureFileHandler.ashx?FileName=amizonefiles/PlacementPdf/Placement_eba6f4.pdf">View drive details (PDF)</a></div>
</div></div>`;

const HTML = [
  card('SHIBAURA MACHINE CO., LTD, Japan [2027 Batch]', '02/09/2026 – 03/09/2026 08:00 PM', 'applied'),
  card('Infinite Computer Solutions.', '02/09/2026 – 04/09/2026 06:00 PM', 'closed'),
  card('PRECISELY S&amp;D LIMITED', '12/08/2026 – 16/08/2026 05:00 PM', 'ineligible',
       '<p class="pd-card-sub">Check your 12th and B.Tech marks in the My Profile section.</p>'),
  card('MathCo® ( TheMathCompany )', '01/09/2026 – 02/09/2026 05:00 PM', 'applied'),
].join('\n');

{
  const rows = parsePlacements(HTML);
  eq(rows.length, 4, 'every card is a row');
  eq(rows[0].company, 'SHIBAURA MACHINE CO., LTD, Japan [2027 Batch]', 'company text survives punctuation');
  eq(rows[2].company, 'PRECISELY S&D LIMITED', 'and HTML entities are decoded rather than shown raw');
  eq(rows[0].status, 'applied', 'applied');
  eq(rows[1].status, 'closed', 'closed');
  eq(rows[2].status, 'ineligible', 'ineligible');
  eq(rows[2].note, 'Check your 12th and B.Tech marks in the My Profile section.',
     'and the reason comes with it — "ineligible" with no reason is a dead end');
  ok(rows[0].pdf.endsWith('.pdf'), 'the drive PDF is kept, because that is where the actual criteria are');
  ok(new Date(rows[1].end).getDate() === 4, 'the close time is a real date');

  // pd-card-company and pd-card-dates both start with "pd-card". Splitting on
  // that prefix would cut every card into four fragments and report each as a
  // drive with no company.
  ok(!rows.some(r => !r.company), 'the class-prefix trap does not produce empty rows');
}

// ---------------------------------------------------------------- the unobserved state
//
// The one that matters most. No open drive existed to look at, so if Amizone
// renders one with a status this parser does not know, it must still appear.
{
  const rows = parsePlacements(card('SOME NEW CO', '05/09/2026 – 30/09/2026 05:00 PM', 'registernow'));
  eq(rows.length, 1, 'an unrecognised status still yields a row');
  eq(rows[0].status, 'unknown', 'flagged as unknown rather than guessed at');
  eq(STATUS_LABEL.unknown, 'CHECK AMIZONE', 'and the label sends him to the source');

  const now = new Date(2026, 8, 5, 12, 0);
  const v = placementView(rows, now);
  eq(v.actionable.length, 1, 'and it lands in ACTIONABLE — silence would be the worse failure');
  ok(/could not read/.test(deadlineSoon(parsePlacements(
    card('SOME NEW CO', '05/09/2026 – 05/09/2026 05:00 PM', 'registernow')), now)[0].body),
     'the notification says plainly that it could not read the status');
}

// ---------------------------------------------------------------- sorting the day
{
  const now = new Date(2026, 8, 5, 12, 0);   // Sat 5 Sep 2026, noon
  const rows = parsePlacements([
    card('Applied Co', '02/09/2026 – 03/09/2026 08:00 PM', 'applied'),
    card('Missed Co', '02/09/2026 – 04/09/2026 06:00 PM', 'closed'),
    card('Blocked Co', '12/08/2026 – 16/08/2026 05:00 PM', 'ineligible'),
    card('Open Later Co', '01/09/2026 – 20/09/2026 05:00 PM', 'notstarted'),
    card('Open Soon Co', '01/09/2026 – 05/09/2026 06:00 PM', 'notstarted'),
  ].join('\n'));
  const v = placementView(rows, now);

  eq(v.actionable.length, 2, 'two are still open');
  eq(v.actionable[0].company, 'Open Soon Co', 'soonest deadline first — the order is the priority');
  eq(v.actionable[1].company, 'Open Later Co', 'then the rest');
  eq(v.applied.length, 1, 'applied is its own bucket');
  eq(v.ineligible.length, 1, 'so is ineligible');
  ok(v.closed.some(r => r.company === 'Missed Co'), 'and closed');
  ok(!v.actionable.some(r => r.company === 'Blocked Co'),
     'ineligible is NEVER actionable — telling him to apply to something he cannot is worse than saying nothing');

  eq(v.recentlyGone.length, 1, 'a drive that closed yesterday without a registration is worth knowing about');
  eq(v.recentlyGone[0].company, 'Missed Co', 'by name');
  ok(!v.recentlyGone.some(r => r.company === 'Blocked Co'),
     'but an ineligible one is not a miss and must not be listed as one');

  // The window closed 18:00 on the 4th; at noon on the 5th it is gone even
  // though the status class still said notstarted on some other row.
  const stale = parsePlacements(card('Expired Co', '01/09/2026 – 04/09/2026 06:00 PM', 'notstarted'));
  eq(placementView(stale, now).actionable.length, 0,
     'the clock closes a window even when the markup has not caught up');
}

// ---------------------------------------------------------------- the summary line
{
  const now = new Date(2026, 8, 5, 12, 0);
  const soon = parsePlacements(card('Open Soon Co', '01/09/2026 – 05/09/2026 06:00 PM', 'notstarted'));
  ok(/closes in 6h/.test(placementSummary(soon, now)), 'hours while it is hours');

  const far = parsePlacements(card('Open Later Co', '01/09/2026 – 20/09/2026 05:00 PM', 'notstarted'));
  ok(/closes in 15d/.test(placementSummary(far, now)), 'days once it is days');

  const both = parsePlacements([
    card('Open Soon Co', '01/09/2026 – 05/09/2026 06:00 PM', 'notstarted'),
    card('Open Later Co', '01/09/2026 – 20/09/2026 05:00 PM', 'notstarted'),
  ].join('\n'));
  ok(/\+1 more open/.test(placementSummary(both, now)), 'and it says how many others are waiting');

  eq(placementSummary(parsePlacements(card('Applied Co', '01/09/2026 – 20/09/2026 05:00 PM', 'applied')), now), '',
     'nothing open means no line at all rather than a cheerful empty one');
  eq(placementSummary([], now), '', 'and no data means no line');
}

// ---------------------------------------------------------------- the interruption
{
  const rows = parsePlacements(card('Deadline Co', '01/09/2026 – 06/09/2026 06:00 PM', 'notstarted'));

  eq(deadlineSoon(rows, new Date(2026, 8, 4, 12, 0)).length, 0, 'two days out, nothing is said');

  const dayBefore = deadlineSoon(rows, new Date(2026, 8, 5, 18, 30));
  eq(dayBefore.length, 1, 'a day out, it interrupts');
  ok(/closes tomorrow/.test(dayBefore[0].title), 'saying when');
  ok(/Deadline Co/.test(dayBefore[0].title), 'and which');
  ok(/not registered/i.test(dayBefore[0].body), 'and that he has not registered');

  const lastCall = deadlineSoon(rows, new Date(2026, 8, 6, 17, 0));
  ok(/under 2 hours/.test(lastCall[0].title), 'and again at the last honest moment');
  ok(dayBefore[0].thing !== lastCall[0].thing,
     'with different ledger keys, so the second one is not swallowed as already-said');

  eq(deadlineSoon(rows, new Date(2026, 8, 6, 19, 0)).length, 0, 'once it has closed there is nothing to say');
  eq(deadlineSoon(parsePlacements(card('Applied Co', '01/09/2026 – 06/09/2026 06:00 PM', 'applied')),
                  new Date(2026, 8, 5, 18, 30)).length, 0,
     'and a drive already applied to never interrupts — that is the fastest way to teach him to ignore these');
  eq(deadlineSoon([], new Date()).length, 0, 'no data, no noise');

  // Two drives closing in the same window should both be announced, but the
  // list is capped so a bulk import cannot fire fifteen notifications at once.
  const many = parsePlacements(Array.from({ length: 5 }, (_, i) =>
    card(`Co ${i}`, '01/09/2026 – 06/09/2026 06:00 PM', 'notstarted')).join('\n'));
  ok(deadlineSoon(many, new Date(2026, 8, 5, 18, 30)).length <= 2, 'at most two at a time');
}

// ---------------------------------------------------------------- ledger keys
{
  const a = parsePlacements(card('Deadline Co', '01/09/2026 – 06/09/2026 06:00 PM', 'notstarted'))[0];
  const b = parsePlacements(card('deadline co', '01/09/2026 – 06/09/2026 06:00 PM', 'notstarted'))[0];
  eq(driveId(a), driveId(b), 'the id ignores case, so a re-render does not re-announce');
  const c = parsePlacements(card('Deadline Co', '01/09/2026 – 07/09/2026 06:00 PM', 'notstarted'))[0];
  ok(driveId(a) !== driveId(c), 'but a MOVED deadline is a different thing and gets said again');
}

// ---------------------------------------------------------------- corporate events
{
  const table = `<table><tbody>
    <tr><td>1</td><td>GOOGLE (28-03-2024)</td><td>28/03/2024</td><td>31/03/2024</td><td>Registration Closed</td></tr>
    <tr><td>2</td><td>CISCO</td><td>14/05/2024</td><td>15/05/2024</td><td>Registration Closed</td></tr>
    <tr><td>3</td><td>NVIDIA</td><td>01/09/2026</td><td>20/09/2026</td><td><button>Register</button></td></tr>
  </tbody></table>`;
  const rows = parseCorporateEvents(table);
  eq(rows.length, 3, 'every row parses');
  eq(rows[0].company, 'GOOGLE (28-03-2024)', 'organisation name');
  eq(rows[0].status, 'closed', 'a closed action reads as closed');
  eq(rows[2].status, 'unknown', 'and an action this parser has not seen is unknown, not assumed shut');
  eq(rows[0].kind, 'event', 'tagged so the app can tell a drive from an event');

  const v = placementView(rows, new Date(2026, 8, 5, 12, 0));
  eq(v.actionable.length, 1, 'the live one is actionable');
  eq(v.actionable[0].company, 'NVIDIA', 'by name');

  ok(parseCorporateEvents('<table><tbody><tr><th>Sr</th><th>Org</th></tr></tbody></table>').length === 0,
     'a header row is not an opportunity');
  eq(parseCorporateEvents('').length, 0, 'and empty input is empty output');
}

// ---------------------------------------------------------------- garbage in
{
  eq(parsePlacements('').length, 0, 'empty page');
  eq(parsePlacements(null).length, 0, 'null page');
  eq(parsePlacements('<html><body>Please sign in</body></html>').length, 0,
     'a logged-out page parses to nothing rather than to fake drives');
  eq(hoursLeft({ end: null }, new Date()), null, 'a drive with no end has no countdown to state');
  const v = placementView(null, new Date());
  eq(v.total, 0, 'and no rows at all is a well-formed empty view');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
