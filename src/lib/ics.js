// Build a downloadable .ics calendar from the app's data so your timetable,
// college events and due tasks show up in Apple / Google / Outlook calendars.
// Classes become weekly-recurring events; re-export whenever the timetable changes.
const DOW_ICS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const DOW_NAME = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 };
const pad = n => String(n).padStart(2, '0');
const stampUTC = d => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
const floatDT = (date, hm) => { const [h, m] = (hm || '00:00').split(':'); return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(+h)}${pad(+m)}00`; };
const dateOnly = d => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
const esc = s => String(s || '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
let seq = 0;
const uid = tag => `ldx-${tag}-${(seq++).toString(36)}-${Date.now().toString(36)}@playerone`;

export function buildICS({ timetable = [], events = [], todos = [] }) {
  const now = new Date();
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//PLAYER ONE//Life Dashboard//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:PLAYER ONE', 'X-WR-TIMEZONE:Asia/Kolkata'];

  // weekly recurring classes — first occurrence is the next matching weekday
  timetable.forEach((t, i) => {
    const wd = DOW_NAME[t.day];
    if (wd == null || !t.start_time) return;
    const d = new Date(now); d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + ((wd - d.getDay() + 7) % 7));
    L.push('BEGIN:VEVENT', `UID:${uid('c' + i)}`, `DTSTAMP:${stampUTC(now)}`,
      `DTSTART:${floatDT(d, t.start_time)}`, `DTEND:${floatDT(d, t.end_time || t.start_time)}`,
      `RRULE:FREQ=WEEKLY;BYDAY=${DOW_ICS[wd]}`, `SUMMARY:${esc(t.subject)}`);
    if (t.room) L.push(`LOCATION:${esc(t.room)}`);
    if (t.faculty) L.push(`DESCRIPTION:${esc(t.faculty)}`);
    L.push('END:VEVENT');
  });

  // dated calendar events
  events.forEach((e, i) => {
    if (!e.start) return;
    const s = new Date(e.start);
    const en = e.end ? new Date(e.end) : new Date(s.getTime() + 3600000);
    L.push('BEGIN:VEVENT', `UID:${uid('g' + i)}`, `DTSTAMP:${stampUTC(now)}`);
    if (e.allDay) L.push(`DTSTART;VALUE=DATE:${dateOnly(s)}`);
    else L.push(`DTSTART:${stampUTC(s)}`, `DTEND:${stampUTC(en)}`);
    L.push(`SUMMARY:${esc(e.summary || '(event)')}`);
    if (e.location) L.push(`LOCATION:${esc(e.location)}`);
    L.push('END:VEVENT');
  });

  // open todos with due dates → all-day reminders
  todos.filter(t => t.due_date && !t.completed).forEach((t, i) => {
    L.push('BEGIN:VEVENT', `UID:${uid('t' + i)}`, `DTSTAMP:${stampUTC(now)}`,
      `DTSTART;VALUE=DATE:${t.due_date.replace(/-/g, '')}`, `SUMMARY:${esc('☑ ' + (t.title || 'task'))}`, 'END:VEVENT');
  });

  L.push('END:VCALENDAR');
  return L.join('\r\n');
}

export function downloadICS(ics, name = 'player-one.ics') {
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
}
