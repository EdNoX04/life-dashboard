// Meetings worker — runs on GitHub Actions (full network), no Mac / no Cowork chat.
//
// Flow (the webapp drives it, this closes the loop):
//   1. In the app you add a meeting → NextMeeting.jsx saves it to memory.meetings
//      (status "pending") AND drops a row into `requests` (kind = "meeting_add").
//   2. This worker polls that queue, creates the real Google Calendar event with a
//      Google Meet link, writes the link + event id back into memory.meetings, and
//      marks the request done. The dashboard card then shows a live, joinable link.
//
// Apple Calendar: there is no clean server API to push a Meet link into iCloud.
// The right way is to add your Google account to iPhone Settings → Calendar once —
// then every event this worker creates shows up in Apple Calendar automatically,
// Meet link included. (See MEETINGS-SETUP.md.)
//
// Env (GitHub Secrets):
//   SUPABASE_URL, SUPABASE_SERVICE_KEY
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
//   GOOGLE_CALENDAR_ID   (optional, defaults to "primary")

const {
  SUPABASE_URL, SUPABASE_SERVICE_KEY,
  GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN,
  GOOGLE_CALENDAR_ID = 'primary',
} = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { console.error('Missing Supabase env'); process.exit(1); }
if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
  console.error('Missing Google OAuth env (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN).');
  process.exit(1);
}

const DEFAULT_TZ = 'Asia/Kolkata';

// ---- Supabase REST ----
const SB = SUPABASE_URL.replace(/\/$/, '');
const H = { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' };
const rest = (p, init = {}) => fetch(`${SB}/rest/v1/${p}`, { ...init, headers: { ...H, ...(init.headers || {}) } });

async function sbJson(p, init) {
  const r = await rest(p, init);
  if (!r.ok) throw new Error(`Supabase ${init?.method || 'GET'} ${p}: ${r.status} ${await r.text()}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

// ---- Google OAuth: refresh token -> access token ----
async function accessToken() {
  const body = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET,
    refresh_token: GOOGLE_REFRESH_TOKEN, grant_type: 'refresh_token',
  });
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
  });
  if (!r.ok) throw new Error(`Google token: ${r.status} ${await r.text()}`);
  return (await r.json()).access_token;
}

// ---- Create a Google Calendar event (+ Meet link if wanted) ----
async function createEvent(token, m) {
  const tz = m.tz || DEFAULT_TZ;
  const wantMeet = m.meet === undefined ? true : !!m.meet;
  const ev = {
    summary: m.title || 'Meeting',
    description: (m.description || '') + '\n\nAdded from PLAYER ONE dashboard.',
    start: { dateTime: m.start, timeZone: tz },
    end: { dateTime: m.end || m.start, timeZone: tz },
  };
  if (Array.isArray(m.attendees) && m.attendees.length) ev.attendees = m.attendees.map(e => ({ email: e }));
  if (wantMeet) {
    ev.conferenceData = { createRequest: { requestId: `po-${m.id}`, conferenceSolutionKey: { type: 'hangoutsMeet' } } };
  }
  const qs = new URLSearchParams({ conferenceDataVersion: '1', sendUpdates: ev.attendees ? 'all' : 'none' });
  const r = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(GOOGLE_CALENDAR_ID)}/events?${qs}`,
    { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(ev) },
  );
  if (!r.ok) throw new Error(`Calendar insert: ${r.status} ${await r.text()}`);
  const j = await r.json();
  const meet = j.hangoutLink || j.conferenceData?.entryPoints?.find(e => e.entryPointType === 'video')?.uri || '';
  return { gcal_id: j.id, htmlLink: j.htmlLink, meet };
}

// ---- write the created link back into memory.meetings ----
async function patchMemoryMeeting(id, patch) {
  const rows = await sbJson('memory?key=eq.meetings&select=value');
  const value = rows?.[0]?.value || { list: [] };
  const list = Array.isArray(value.list) ? value.list : [];
  const idx = list.findIndex(x => x.id === id);
  if (idx === -1) { list.unshift({ id, ...patch }); } else { list[idx] = { ...list[idx], ...patch }; }
  const next = { ...value, list, updated: new Date().toISOString() };
  await sbJson('memory?on_conflict=key', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify([{ key: 'meetings', value: next, updated_at: new Date().toISOString() }]),
  });
}

async function resolveRequest(id, status, response) {
  await rest(`requests?id=eq.${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status, response: response?.slice(0, 500) || null, resolved_at: new Date().toISOString() }),
  });
}

// ---- plain calendar event (no Meet link) for the Calendar tab's "Add event" ----
async function createCalendarEvent(token, p) {
  const tz = p.timeZone || p.tz || DEFAULT_TZ;
  const ev = {
    summary: p.summary || 'Event',
    location: p.location || undefined,
    description: (p.description || '') + '\n\nAdded from PLAYER ONE dashboard.',
  };
  if (p.allDay) {
    const day = String(p.start).slice(0, 10);
    const nx = new Date(day + 'T00:00:00Z'); nx.setUTCDate(nx.getUTCDate() + 1);
    ev.start = { date: day };
    ev.end = { date: nx.toISOString().slice(0, 10) };
  } else {
    ev.start = { dateTime: p.start, timeZone: tz };
    ev.end = { dateTime: p.end || p.start, timeZone: tz };
  }
  const r = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(GOOGLE_CALENDAR_ID)}/events`,
    { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(ev) },
  );
  if (!r.ok) throw new Error(`Calendar insert: ${r.status} ${await r.text()}`);
  return await r.json();
}

async function deleteCalendarEvent(token, eventId) {
  const r = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(GOOGLE_CALENDAR_ID)}/events/${encodeURIComponent(eventId)}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
  );
  if (!r.ok && r.status !== 410 && r.status !== 404) throw new Error(`Calendar delete: ${r.status} ${await r.text()}`);
}

// ---- pull upcoming events from Google Calendar into memory.calendar_events ----
async function pullEvents(token) {
  const timeMin = new Date(Date.now() - 2 * 864e5).toISOString();
  const timeMax = new Date(Date.now() + 90 * 864e5).toISOString();
  const qs = new URLSearchParams({ timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '250' });
  const r = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(GOOGLE_CALENDAR_ID)}/events?${qs}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!r.ok) throw new Error(`Calendar list: ${r.status} ${await r.text()}`);
  const j = await r.json();
  const events = (j.items || []).map(e => ({
    id: e.id,
    summary: e.summary || '(no title)',
    start: e.start?.dateTime || e.start?.date || null,
    end: e.end?.dateTime || e.end?.date || null,
    location: e.location || '',
    allDay: !!e.start?.date,
    htmlLink: e.htmlLink || '',
  })).filter(e => e.start);
  await sbJson('memory?on_conflict=key', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify([{ key: 'calendar_events', value: { events, updated: new Date().toISOString() }, updated_at: new Date().toISOString() }]),
  });
  console.log(`  pulled ${events.length} calendar event(s) → dashboard`);
}

async function processMeetings(token) {
  const pending = await sbJson('requests?kind=eq.meeting_add&status=eq.pending&select=id,payload&order=created_at.asc');
  for (const req of (pending || [])) {
    const m = req.payload || {};
    if (!m.id || !m.start) { await resolveRequest(req.id, 'failed', 'missing id/start'); continue; }
    await rest(`requests?id=eq.${req.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'working' }) });
    try {
      const { gcal_id, meet, htmlLink } = await createEvent(token, m);
      await patchMemoryMeeting(m.id, { gcal_id, meet, htmlLink, status: 'confirmed' });
      await resolveRequest(req.id, 'done', meet || htmlLink);
      console.log(`  ✓ meeting: ${m.title} → ${meet || '(no meet link)'}`);
    } catch (e) {
      await resolveRequest(req.id, 'failed', e.message);
      await patchMemoryMeeting(m.id, { status: 'error' }).catch(() => {});
      console.error(`  ✗ meeting ${m.title}: ${e.message}`); process.exitCode = 1;
    }
  }
}

async function processCalendarAdds(token) {
  const pending = await sbJson('requests?kind=eq.calendar_add&status=eq.pending&select=id,payload&order=created_at.asc');
  for (const req of (pending || [])) {
    const p = req.payload || {};
    if (!p.start) { await resolveRequest(req.id, 'failed', 'missing start'); continue; }
    await rest(`requests?id=eq.${req.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'working' }) });
    try {
      const ev = await createCalendarEvent(token, p);
      await resolveRequest(req.id, 'done', ev.htmlLink || ev.id);
      console.log(`  ✓ event: ${p.summary}`);
    } catch (e) { await resolveRequest(req.id, 'failed', e.message); console.error(`  ✗ event ${p.summary}: ${e.message}`); process.exitCode = 1; }
  }
}

async function processCalendarDeletes(token) {
  const pending = await sbJson('requests?kind=eq.calendar_delete&status=eq.pending&select=id,payload&order=created_at.asc');
  for (const req of (pending || [])) {
    const p = req.payload || {};
    if (!p.eventId) { await resolveRequest(req.id, 'failed', 'missing eventId'); continue; }
    await rest(`requests?id=eq.${req.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'working' }) });
    try { await deleteCalendarEvent(token, p.eventId); await resolveRequest(req.id, 'done', 'deleted'); console.log(`  ✓ deleted: ${p.title || p.eventId}`); }
    catch (e) { await resolveRequest(req.id, 'failed', e.message); console.error(`  ✗ delete ${p.eventId}: ${e.message}`); process.exitCode = 1; }
  }
}

async function run() {
  let token;
  try { token = await accessToken(); }
  catch (e) { console.error('Auth failed:', e.message); process.exit(1); }

  await processCalendarDeletes(token);  // deletes first
  await processMeetings(token);         // meeting_add → event + Meet link
  await processCalendarAdds(token);     // calendar_add → plain event
  await pullEvents(token);              // sync Google → dashboard (always, so events show up)
}

run().catch(e => { console.error(e); process.exit(1); });
