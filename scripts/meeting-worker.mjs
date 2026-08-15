// Meetings + calendar + mail worker — runs on GitHub Actions (full network),
// no Mac, no Cowork chat.
//
// Flow (the webapp drives it, this closes the loop):
//   1. In the app you add a meeting → NextMeeting.jsx saves it to memory.meetings
//      (status "pending") AND drops a row into `requests` (kind = "meeting_add").
//   2. This worker polls that queue, creates the real Google Calendar event with a
//      Google Meet link, writes the link + event id back into memory.meetings, and
//      marks the request done. The dashboard card then shows a live, joinable link.
//   3. On every run it also pulls the next 90 days of events from every connected
//      account, and the unread inbox, into `memory` for the dashboard to draw.
//
// MULTIPLE ACCOUNTS
// Personal Gmail and the Google Workspace account are the same OAuth client with
// two different refresh tokens — one Google Cloud project issues both, so there is
// no second app to register and no second secret pair to manage. Each account is
// pulled independently and its events are tagged with the account they came from,
// which is what lets the calendar colour work meetings differently from personal
// ones instead of dumping everything into one undifferentiated list.
//
// Adding a third account later is three lines in ACCOUNTS plus one more secret.
//
// Apple Calendar: there is no clean server API to push a Meet link into iCloud.
// The right way is to add your Google account to iPhone Settings → Calendar once —
// then every event this worker creates shows up in Apple Calendar automatically,
// Meet link included. (See MEETINGS-SETUP.md.)
//
// Env (GitHub Secrets):
//   SUPABASE_URL, SUPABASE_SERVICE_KEY
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET      — shared by every account
//   GOOGLE_REFRESH_TOKEN                        — personal account
//   GOOGLE_CALENDAR_ID          (optional, defaults to "primary")
//   GOOGLE_WORK_REFRESH_TOKEN   (optional)      — Workspace / college account
//   GOOGLE_WORK_CALENDAR_ID     (optional, defaults to "primary")
//   GOOGLE_THIRD_REFRESH_TOKEN  (optional)      — a third account
//   GOOGLE_THIRD_CALENDAR_ID    (optional, defaults to "primary")
//   GOOGLE_THIRD_LABEL          (optional, defaults to "Third")

import { parseFrom, foldDuplicates, splitEventId } from './lib/calendar-fold.mjs';

// Read through a helper rather than destructuring with defaults, and the reason
// is worth the paragraph. GitHub Actions expands `FOO: ${{ secrets.FOO }}` to the
// EMPTY STRING when the secret does not exist — not to undefined. A destructuring
// default only fires on undefined. So `GOOGLE_WORK_CALENDAR_ID = 'primary'` was
// dead code in the only environment this script ever runs in: the value arrived
// as '', the request URL became `calendars//events`, and Google answered
// 404 Not Found. Which is indistinguishable, from the outside, from an account
// that genuinely has no calendar — and was misread as exactly that.
const env = (k, fallback = '') => (process.env[k] || '').trim() || fallback;

const SUPABASE_URL         = env('SUPABASE_URL');
const SUPABASE_SERVICE_KEY = env('SUPABASE_SERVICE_KEY');
const GOOGLE_CLIENT_ID     = env('GOOGLE_CLIENT_ID');
const GOOGLE_CLIENT_SECRET = env('GOOGLE_CLIENT_SECRET');

const GOOGLE_REFRESH_TOKEN       = env('GOOGLE_REFRESH_TOKEN');
const GOOGLE_CALENDAR_ID         = env('GOOGLE_CALENDAR_ID', 'primary');
const GOOGLE_WORK_REFRESH_TOKEN  = env('GOOGLE_WORK_REFRESH_TOKEN');
const GOOGLE_WORK_CALENDAR_ID    = env('GOOGLE_WORK_CALENDAR_ID', 'primary');
const GOOGLE_THIRD_REFRESH_TOKEN = env('GOOGLE_THIRD_REFRESH_TOKEN');
const GOOGLE_THIRD_CALENDAR_ID   = env('GOOGLE_THIRD_CALENDAR_ID', 'primary');
const GOOGLE_THIRD_LABEL         = env('GOOGLE_THIRD_LABEL', 'Third');

// A missing secret is a *configuration* state, not a crash. This job runs every
// five minutes, eighteen hours a day; exiting non-zero on "you have not connected
// Google yet" turns one unfinished setup step into roughly two hundred red
// failure emails a day, and once those are arriving every five minutes they stop
// being read — which means the day something genuinely breaks, that email looks
// exactly like the two hundred before it and gets ignored too. So: an unconfigured
// worker reports itself into `memory.sync_status`, where the dashboard can show it
// as an amber "not connected" line the user actually sees, and exits 0. Only a
// real error — a rejected token, a 500 from Google, a request that failed to
// process — is allowed to fail the run.
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  // No Supabase means there is nowhere to even record the problem. Nothing to do.
  console.error('Missing Supabase env (SUPABASE_URL / SUPABASE_SERVICE_KEY) — nothing to sync against.');
  process.exit(0);
}

const DEFAULT_TZ = 'Asia/Kolkata';

// The order matters in exactly one place: when the same meeting appears on both
// accounts (you are invited on work, it lands on personal too), the earlier entry
// wins and the later one is folded into `alsoOn`. Personal first keeps the
// dashboard's existing event ids stable for anything already stored against them.
const ACCOUNTS = [
  { id: 'personal', label: 'Personal', color: 'var(--cyan)',
    refresh: GOOGLE_REFRESH_TOKEN, calendarId: GOOGLE_CALENDAR_ID },
  { id: 'work', label: 'Work', color: 'var(--orange)',
    refresh: GOOGLE_WORK_REFRESH_TOKEN, calendarId: GOOGLE_WORK_CALENDAR_ID },
  // A third account, last so it never displaces an id the dashboard already
  // stores events against. Its label is configurable because "Third" describes
  // its position in this list and nothing about what the account is for.
  { id: 'third', label: GOOGLE_THIRD_LABEL, color: 'var(--purple)',
    refresh: GOOGLE_THIRD_REFRESH_TOKEN, calendarId: GOOGLE_THIRD_CALENDAR_ID },
].filter(a => a.refresh);

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

async function memPut(key, value) {
  await sbJson('memory?on_conflict=key', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify([{ key, value, updated_at: new Date().toISOString() }]),
  });
}

// ---- Google OAuth: refresh token -> access token ----
async function accessToken(acct) {
  const body = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET,
    refresh_token: acct.refresh, grant_type: 'refresh_token',
  });
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
  });
  if (!r.ok) throw new Error(`Google token: ${r.status} ${await r.text()}`);
  const j = await r.json();
  // The granted scopes come back on every refresh. Recording them is what lets the
  // Gmail pull below say "this token was minted before mail was added, re-run the
  // token script" instead of reporting an opaque 403.
  return { token: j.access_token, scopes: (j.scope || '').split(' ').filter(Boolean) };
}

const gcal = (acct, path, init = {}) => fetch(
  `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(acct.calendarId)}/${path}`,
  { ...init, headers: { Authorization: `Bearer ${acct.token}`, 'Content-Type': 'application/json', ...(init.headers || {}) } },
);

// Which account a queued request is destined for. An unrecognised (or absent)
// name falls back to the first connected account rather than failing the request:
// a meeting created before the work account existed still has to go somewhere.
function acctFor(name) {
  return ACCOUNTS.find(a => a.id === name) || ACCOUNTS[0];
}

// ---- Create a Google Calendar event (+ Meet link if wanted) ----
async function createEvent(acct, m) {
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
  const r = await gcal(acct, `events?${qs}`, { method: 'POST', body: JSON.stringify(ev) });
  if (!r.ok) throw new Error(`Calendar insert: ${r.status} ${await r.text()}`);
  const j = await r.json();
  const meet = j.hangoutLink || j.conferenceData?.entryPoints?.find(e => e.entryPointType === 'video')?.uri || '';
  return { gcal_id: j.id, htmlLink: j.htmlLink, meet, account: acct.id };
}

// ---- write the created link back into memory.meetings ----
async function patchMemoryMeeting(id, patch) {
  const rows = await sbJson('memory?key=eq.meetings&select=value');
  const value = rows?.[0]?.value || { list: [] };
  const list = Array.isArray(value.list) ? value.list : [];
  const idx = list.findIndex(x => x.id === id);
  if (idx === -1) { list.unshift({ id, ...patch }); } else { list[idx] = { ...list[idx], ...patch }; }
  await memPut('meetings', { ...value, list, updated: new Date().toISOString() });
}

async function resolveRequest(id, status, response) {
  await rest(`requests?id=eq.${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status, response: response?.slice(0, 500) || null, resolved_at: new Date().toISOString() }),
  });
}

// ---- plain calendar event (no Meet link) for the Calendar tab's "Add event" ----
async function createCalendarEvent(acct, p) {
  const tz = p.timeZone || p.tz || DEFAULT_TZ;
  const ev = {
    summary: p.summary || 'Event',
    location: p.location || undefined,
    description: (p.description || '') + '\n\nAdded from PLAYER ONE dashboard.',
    start: { dateTime: p.start, timeZone: tz },
    end: { dateTime: p.end || p.start, timeZone: tz },
  };
  const r = await gcal(acct, 'events', { method: 'POST', body: JSON.stringify(ev) });
  if (!r.ok) throw new Error(`Calendar insert: ${r.status} ${await r.text()}`);
  return await r.json();
}

async function deleteCalendarEvent(acct, eventId) {
  const r = await gcal(acct, `events/${encodeURIComponent(eventId)}`, { method: 'DELETE' });
  if (!r.ok && r.status !== 410 && r.status !== 404) throw new Error(`Calendar delete: ${r.status} ${await r.text()}`);
}

// ---- pull upcoming events from every account into memory.calendar_events ----
// Per-account, and deliberately so. The first version of this threw on the first
// non-ok response, which meant one account without a calendar took down the pull
// for the other two *and* aborted the run before the mail pull and before the
// status report ever ran — the dashboard could not even say what was wrong,
// because the code that says so came after the throw.
async function pullEvents() {
  const timeMin = new Date(Date.now() - 2 * 864e5).toISOString();
  const timeMax = new Date(Date.now() + 90 * 864e5).toISOString();
  const all = [];
  const perAccount = {};
  const byAccount = {};
  let anyOk = false;

  for (const acct of ACCOUNTS) {
    const qs = new URLSearchParams({ timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '250' });
    try {
      const r = await gcal(acct, `events?${qs}`);
      if (!r.ok) {
        const body = (await r.text()).slice(0, 300);
        // A 404 on the calendar itself is a *configuration* state, not a fault.
        // The token refreshed fine, so the account and the grant are both good —
        // Google is saying there is no calendar behind this address. A Workspace
        // tenant with the Calendar service switched off answers exactly this way.
        // That is a thing for the account owner to change, not something a retry
        // will fix, so it must not paint the run red every twenty minutes: see
        // the note at the top of this file about what red stops meaning when it
        // arrives two hundred times a day.
        const configuration = r.status === 404;
        const hasCal = acct.scopes?.some(s => s.includes('calendar'));
        const reason = !configuration
          ? `${r.status} ${body}`
          : hasCal
            ? `Google has no calendar "${acct.calendarId}" for this account. The token is valid and carries calendar access, so the calendar id is the thing to check first — an id that is blank or misspelled 404s identically to one that does not exist.`
            : `this token was issued without calendar access — re-run scripts/get-google-token.mjs for this account and tick the calendar box`;
        byAccount[acct.id] = { ok: false, configuration, reason, events: 0 };
        console.error(`  ✗ ${acct.label} calendar: ${reason}`);
        // Scopes are cheap to print and settle the question above outright.
        console.error(`    scopes on this token: ${(acct.scopes || []).map(s => s.split('/').pop()).join(', ') || '(none reported)'}`);
        if (!configuration) process.exitCode = 1;
        continue;
      }
      const j = await r.json();
      const events = (j.items || []).map(e => ({
        // Prefixed because two accounts can hand back the same event id for the
        // same invitation, and an unprefixed id would silently collapse them into
        // one row keyed by whichever account happened to be pulled last.
        id: `${acct.id}:${e.id}`,
        gcalId: e.id,
        account: acct.id,
        accountLabel: acct.label,
        color: acct.color,
        summary: e.summary || '(no title)',
        start: e.start?.dateTime || e.start?.date || null,
        end: e.end?.dateTime || e.end?.date || null,
        location: e.location || '',
        allDay: !!e.start?.date,
        htmlLink: e.htmlLink || '',
        meet: e.hangoutLink || e.conferenceData?.entryPoints?.find(x => x.entryPointType === 'video')?.uri || '',
        organizer: e.organizer?.email || '',
        attendees: (e.attendees || []).length,
        // "accepted" / "declined" / "tentative" / "needsAction" for you specifically.
        response: (e.attendees || []).find(a => a.self)?.responseStatus || '',
      })).filter(e => e.start);
      perAccount[acct.id] = events.length;
      byAccount[acct.id] = { ok: true, configuration: false, reason: '', events: events.length };
      anyOk = true;
      all.push(...events);
    } catch (e) {
      byAccount[acct.id] = { ok: false, configuration: false, reason: e.message, events: 0 };
      console.error(`  ✗ ${acct.label} calendar: ${e.message}`);
      process.exitCode = 1;
    }
  }

  // Every account failed. Writing an empty list here would blank the calendar on
  // the dashboard, which is a far louder lie than a few hours of stale events —
  // a Google outage would read to the user as "you have nothing on this week".
  // Leave the previous blob alone and let the status line carry the news.
  if (!anyOk) {
    console.error('  no account returned a calendar — leaving the last good pull in place rather than blanking the tab.');
    return byAccount;
  }

  // Fold cross-account duplicates (see lib/calendar-fold.mjs for why this is the
  // one piece of this worker that gets its own tests).
  const events = foldDuplicates(all);

  await memPut('calendar_events', {
    events,
    accounts: ACCOUNTS.map(a => ({ id: a.id, label: a.label, color: a.color })),
    byAccount,
    updated: new Date().toISOString(),
  });
  const dropped = all.length - events.length;
  console.log(`  pulled ${events.length} calendar event(s) → dashboard`
    + ` (${Object.entries(perAccount).map(([k, v]) => `${k} ${v}`).join(', ')}`
    + `${dropped ? `, ${dropped} cross-account duplicate(s) folded` : ''})`);
  return byAccount;
}

// ---- pull the unread inbox into memory.mail_inbox ----
// Read-only, and deliberately so: this worker has no send path, so a bug here can
// annoy but cannot embarrass. Metadata format only — headers and the snippet
// Google already generates, never the message body — which keeps the blob small
// and means the full text of work mail is not sitting in a database row.
async function pullMail() {
  const out = {};
  for (const acct of ACCOUNTS) {
    if (!acct.scopes?.some(s => s.includes('gmail'))) {
      out[acct.id] = { ok: false, reason: 'This account\'s token was issued without Gmail access — re-run scripts/get-google-token.mjs to add it.', messages: [], unread: 0 };
      continue;
    }
    try {
      const gm = (p) => fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${p}`, { headers: { Authorization: `Bearer ${acct.token}` } });
      const listR = await gm('messages?q=' + encodeURIComponent('is:unread in:inbox') + '&maxResults=25');
      if (!listR.ok) throw new Error(`${listR.status} ${(await listR.text()).slice(0, 200)}`);
      const list = await listR.json();
      const ids = (list.messages || []).map(m => m.id);

      const messages = [];
      for (const id of ids) {
        const r = await gm(`messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
        if (!r.ok) continue;
        const m = await r.json();
        const hdr = n => (m.payload?.headers || []).find(h => h.name.toLowerCase() === n)?.value || '';
        // "Neel Mukherjee <neel@co.com>" → name and address split out, because
        // the raw header is unreadable at dashboard width.
        const { name: fromName, email: fromEmail } = parseFrom(hdr('From'));
        messages.push({
          id: m.id,
          threadId: m.threadId,
          fromName,
          fromEmail,
          subject: hdr('Subject') || '(no subject)',
          snippet: (m.snippet || '').slice(0, 180),
          date: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : null,
          important: (m.labelIds || []).includes('IMPORTANT'),
          starred: (m.labelIds || []).includes('STARRED'),
          link: `https://mail.google.com/mail/u/0/#inbox/${m.threadId}`,
        });
      }
      messages.sort((a, b) => String(b.date).localeCompare(String(a.date)));
      // resultSizeEstimate is Google's own count and is not capped at maxResults,
      // so "31 unread" stays honest even though only 25 are listed.
      out[acct.id] = { ok: true, reason: '', unread: list.resultSizeEstimate ?? messages.length, messages };
      console.log(`  ${acct.label} inbox: ${messages.length} unread shown`);
    } catch (e) {
      out[acct.id] = { ok: false, reason: e.message, messages: [], unread: 0 };
      console.error(`  ✗ ${acct.label} inbox: ${e.message}`);
    }
  }
  await memPut('mail_inbox', {
    accounts: ACCOUNTS.map(a => ({ id: a.id, label: a.label, color: a.color })),
    byAccount: out,
    updated: new Date().toISOString(),
  });
}

async function processMeetings() {
  const pending = await sbJson('requests?kind=eq.meeting_add&status=eq.pending&select=id,payload&order=created_at.asc');
  for (const req of (pending || [])) {
    const m = req.payload || {};
    if (!m.id || !m.start) { await resolveRequest(req.id, 'failed', 'missing id/start'); continue; }
    await rest(`requests?id=eq.${req.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'working' }) });
    try {
      const acct = acctFor(m.account);
      const { gcal_id, meet, htmlLink, account } = await createEvent(acct, m);
      await patchMemoryMeeting(m.id, { gcal_id, meet, htmlLink, account, status: 'confirmed' });
      await resolveRequest(req.id, 'done', meet || htmlLink);
      console.log(`  ✓ meeting [${acct.label}]: ${m.title} → ${meet || '(no meet link)'}`);
    } catch (e) {
      await resolveRequest(req.id, 'failed', e.message);
      await patchMemoryMeeting(m.id, { status: 'error' }).catch(() => {});
      console.error(`  ✗ meeting ${m.title}: ${e.message}`); process.exitCode = 1;
    }
  }
}

async function processCalendarAdds() {
  const pending = await sbJson('requests?kind=eq.calendar_add&status=eq.pending&select=id,payload&order=created_at.asc');
  for (const req of (pending || [])) {
    const p = req.payload || {};
    if (!p.start) { await resolveRequest(req.id, 'failed', 'missing start'); continue; }
    await rest(`requests?id=eq.${req.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'working' }) });
    try {
      const ev = await createCalendarEvent(acctFor(p.account), p);
      await resolveRequest(req.id, 'done', ev.htmlLink || ev.id);
      console.log(`  ✓ event: ${p.summary}`);
    } catch (e) { await resolveRequest(req.id, 'failed', e.message); console.error(`  ✗ event ${p.summary}: ${e.message}`); process.exitCode = 1; }
  }
}

async function processCalendarDeletes() {
  const pending = await sbJson('requests?kind=eq.calendar_delete&status=eq.pending&select=id,payload&order=created_at.asc');
  for (const req of (pending || [])) {
    const p = req.payload || {};
    if (!p.eventId) { await resolveRequest(req.id, 'failed', 'missing eventId'); continue; }
    await rest(`requests?id=eq.${req.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'working' }) });
    try {
      // Ids arriving from the dashboard are account-prefixed ("work:abc123"); the
      // Google API wants the bare id back.
      const { account, id } = splitEventId(p.eventId, ACCOUNTS.map(a => a.id));
      await deleteCalendarEvent(acctFor(account || p.account), id);
      await resolveRequest(req.id, 'done', 'deleted');
      console.log(`  ✓ deleted: ${p.title || id}`);
    }
    catch (e) { await resolveRequest(req.id, 'failed', e.message); console.error(`  ✗ delete ${p.eventId}: ${e.message}`); process.exitCode = 1; }
  }
}

// One entry per connected account, carrying whether its calendar actually
// pulled. The chips on the dashboard used to be plain labels, which meant the
// account that was silently not syncing rendered identically to the two that
// were — the precise failure this file's status reporting exists to prevent.
function acctReport(calendars = {}) {
  return ACCOUNTS.map(a => ({
    id: a.id,
    label: a.label,
    calendar: calendars?.[a.id]?.ok === false ? 'stuck' : 'ok',
  }));
}

// ---- report this worker's health into memory.sync_status ----
// Read-modify-write of a single shared blob keyed by worker name, so prices-sync
// and amizone-sync can land their own entries here without a schema change.
async function reportStatus(patch) {
  try {
    const rows = await sbJson('memory?key=eq.sync_status&select=value');
    const value = rows?.[0]?.value || {};
    await memPut('sync_status', { ...value, meetings: { ...patch, at: new Date().toISOString() } });
  } catch (e) {
    // Reporting failure must never be the thing that fails the run.
    console.error('  (could not record sync status:', e.message + ')');
  }
}

// How much work is sitting in the queue right now. Worth surfacing: "not
// connected" with an empty queue is a shrug, "not connected" with four meetings
// waiting is something to act on today.
async function queueDepth() {
  try {
    const rows = await sbJson('requests?kind=in.(meeting_add,calendar_add,calendar_delete)&status=eq.pending&select=id');
    return Array.isArray(rows) ? rows.length : 0;
  } catch { return 0; }
}

async function run() {
  const missing = [
    !GOOGLE_CLIENT_ID && 'GOOGLE_CLIENT_ID',
    !GOOGLE_CLIENT_SECRET && 'GOOGLE_CLIENT_SECRET',
    !ACCOUNTS.length && 'GOOGLE_REFRESH_TOKEN',
  ].filter(Boolean);

  if (missing.length) {
    const waiting = await queueDepth();
    const reason = `Google is not connected yet — missing ${missing.join(', ')} in repo secrets.`;
    await reportStatus({ ok: false, configured: false, reason, waiting, accounts: [] });
    console.log(reason);
    console.log(waiting
      ? `  ${waiting} queued item(s) are waiting — they will go through untouched once the secrets are added.`
      : '  Queue is empty, so nothing is being lost.');
    return;  // exit 0 on purpose. See the note at the top of this file.
  }

  // Authenticate every account up front. One bad token should not stop the others:
  // if the work refresh token expires, personal meetings must keep flowing.
  const failed = [];
  for (const acct of ACCOUNTS) {
    try {
      const { token, scopes } = await accessToken(acct);
      acct.token = token; acct.scopes = scopes;
    } catch (e) {
      failed.push(`${acct.label}: ${e.message.slice(0, 120)}`);
      console.error(`  ✗ auth ${acct.label}: ${e.message}`);
    }
  }
  const live = ACCOUNTS.filter(a => a.token);
  ACCOUNTS.length = 0; ACCOUNTS.push(...live);

  if (!ACCOUNTS.length) {
    // Everything was rejected. Unlike "never configured", a credential that used
    // to work and now does not is a real regression — most often a refresh token
    // revoked by a password change, or six months of disuse expiring it.
    await reportStatus({ ok: false, configured: true, reason: `Google rejected every account — ${failed.join('; ')}`, waiting: await queueDepth() });
    console.error('Auth failed for every account.');
    process.exit(1);
  }
  if (failed.length) process.exitCode = 1;

  await processCalendarDeletes();  // deletes first
  await processMeetings();         // meeting_add → event + Meet link
  await processCalendarAdds();     // calendar_add → plain event
  const calendars = await pullEvents();  // sync Google → dashboard (always, so events show up)
  await pullMail();                // unread inbox → dashboard

  // An account whose calendar is a configuration problem does not make the run
  // fail, but it must not report as healthy either — otherwise the one account
  // that is silently not syncing looks exactly like the two that are.
  const stuck = Object.entries(calendars || {})
    .filter(([, v]) => !v.ok)
    .map(([id, v]) => `${id}: ${v.reason}`);

  await reportStatus(process.exitCode
    ? { ok: false, configured: true, reason: [...failed, ...stuck].join('; ') || 'One or more queued items failed — see the workflow log.', waiting: await queueDepth(), accounts: acctReport(calendars), calendars }
    : { ok: !stuck.length, configured: true, reason: stuck.join('; '), waiting: 0, accounts: acctReport(calendars), calendars });
}

run().catch(e => { console.error(e); process.exit(1); });
