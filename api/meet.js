// /api/meet — create a Google Calendar event with a Meet link, right now.
//
// THE LATENCY THIS EXISTS TO FIX
// Meetings used to be queued into a `requests` row and created by
// scripts/meeting-worker.mjs on a GitHub Actions cron ('*/5 2-20 * * *'). The
// Meet room itself takes about five seconds to provision; everything else was
// queue: up to five minutes for the next slot, GitHub's own cron delay on top
// (frequently another five to fifteen), and runner spin-up. Between 02:00 and
// 20:00 UTC only — a meeting created at 3am IST waited until 07:30.
//
// Calling Google from here instead makes it a single request: token refresh,
// insert, then a short poll for the room. A few seconds, at any hour.
//
// The worker is NOT retired. It still syncs the calendars, and it still heals
// meetings whose room was not ready before this function had to return — which
// is why this returns the event even when the link is missing rather than
// failing. A created meeting with a late link is a much better outcome than a
// failed request.
//
// WHICH ACCOUNT
// Every account is the same OAuth client with a different refresh token, so
// picking an account is picking a token. The account is chosen by the caller
// and validated here against the tokens actually configured — an unknown or
// unconfigured account is refused rather than quietly falling back to
// personal, because "the meeting went out from the wrong address" is the
// specific complaint this endpoint was built to answer.
//
// Env (Vercel):
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
//   GOOGLE_REFRESH_TOKEN               personal
//   GOOGLE_WORK_REFRESH_TOKEN          work      (optional)
//   GOOGLE_THIRD_REFRESH_TOKEN         third     (optional)
//   GOOGLE_CALENDAR_ID / GOOGLE_WORK_CALENDAR_ID / GOOGLE_THIRD_CALENDAR_ID

const json = (res, code, body) => {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
};

// An absent secret is an EMPTY STRING in some deploy environments, not
// undefined, so `??` and destructuring defaults both silently accept it. This
// is the same trap that made the meetings worker POST to `calendars//events`
// for weeks.
const env = k => {
  const v = process.env[k];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
};

function accounts() {
  return [
    { id: 'personal', label: 'Personal', refresh: env('GOOGLE_REFRESH_TOKEN'), calendarId: env('GOOGLE_CALENDAR_ID') || 'primary' },
    { id: 'work', label: 'Work', refresh: env('GOOGLE_WORK_REFRESH_TOKEN'), calendarId: env('GOOGLE_WORK_CALENDAR_ID') || 'primary' },
    { id: 'third', label: env('GOOGLE_THIRD_LABEL') || 'Third', refresh: env('GOOGLE_THIRD_REFRESH_TOKEN'), calendarId: env('GOOGLE_THIRD_CALENDAR_ID') || 'primary' },
  ].filter(a => a.refresh);
}

/** Who is asking. Same gate as /api/chat: this creates real calendar events. */
async function verifySession(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;
  const url = env('SUPABASE_URL'), anon = env('SUPABASE_ANON_KEY');
  if (!url || !anon) return null;
  const r = await fetch(`${url.replace(/\/$/, '')}/auth/v1/user`, {
    headers: { apikey: anon, Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return null;
  const u = await r.json();
  return u?.id ? u : null;
}

async function accessToken(acct) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env('GOOGLE_CLIENT_ID'),
      client_secret: env('GOOGLE_CLIENT_SECRET'),
      refresh_token: acct.refresh,
      grant_type: 'refresh_token',
    }),
  });
  if (!r.ok) {
    const t = await r.text();
    // invalid_grant means the refresh token is dead — revoked, expired under a
    // Testing-mode OAuth app, or the password changed. Saying which account is
    // the difference between a fixable message and a mystery.
    throw new Error(`${acct.label} sign-in failed (${r.status}): ${t.slice(0, 140)}`);
  }
  return (await r.json()).access_token;
}

const meetLinkOf = e =>
  e?.hangoutLink ||
  e?.conferenceData?.entryPoints?.find(x => x.entryPointType === 'video')?.uri ||
  '';

export default async function handler(req, res) {
  // GET tells the client which accounts are actually usable, so the picker can
  // only offer accounts that will work.
  if (req.method === 'GET') {
    return json(res, 200, { accounts: accounts().map(a => ({ id: a.id, label: a.label })) });
  }
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });

  const user = await verifySession(req);
  if (!user) return json(res, 401, { error: 'sign in first' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  if (!body) return json(res, 400, { error: 'bad body' });

  const list = accounts();
  if (!list.length) return json(res, 501, { error: 'no Google account configured on the server', needsConfig: true });

  const acct = list.find(a => a.id === body.account);
  if (!acct) {
    return json(res, 400, {
      error: `account "${body.account}" is not connected`,
      available: list.map(a => a.id),
    });
  }

  const title = String(body.title || '').trim();
  if (!title) return json(res, 400, { error: 'title is required' });
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(String(body.start || ''))) {
    return json(res, 400, { error: 'start must be local ISO, YYYY-MM-DDTHH:MM:SS' });
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(String(body.end || ''))) {
    return json(res, 400, { error: 'end must be local ISO, YYYY-MM-DDTHH:MM:SS' });
  }

  const tz = String(body.tz || 'Asia/Kolkata');
  const wantMeet = body.meet !== false;
  const attendees = (Array.isArray(body.attendees) ? body.attendees : [])
    .filter(a => typeof a === 'string' && /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(a))
    .slice(0, 50);
  const notes = String(body.notes || '').slice(0, 4000);

  try {
    const tok = await accessToken(acct);
    const gcal = (p, init = {}) => fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(acct.calendarId)}/${p}`,
      { ...init, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json', ...(init.headers || {}) } },
    );

    const ev = {
      summary: title,
      // The agenda goes into the calendar description too, not only into the
      // text you paste — so it is there for anyone who opens the event.
      description: notes || undefined,
      start: { dateTime: body.start, timeZone: tz },
      end: { dateTime: body.end, timeZone: tz },
    };
    if (attendees.length) ev.attendees = attendees.map(email => ({ email }));
    if (wantMeet) {
      ev.conferenceData = {
        createRequest: {
          requestId: `po-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      };
    }

    const qs = new URLSearchParams({
      conferenceDataVersion: '1',
      sendUpdates: attendees.length ? 'all' : 'none',
    });
    const r = await gcal(`events?${qs}`, { method: 'POST', body: JSON.stringify(ev) });
    if (!r.ok) {
      const t = await r.text();
      return json(res, 502, { error: `${acct.label} calendar refused it (${r.status}): ${t.slice(0, 200)}` });
    }
    const created = await r.json();

    // Google provisions the room asynchronously: the insert comes back with
    // statusCode "pending" and no link. Poll briefly — but bounded, because
    // this is a request someone is waiting on. If it is not ready in time we
    // return the event anyway and the worker's backfill heals the link.
    let meet = meetLinkOf(created);
    if (!meet && wantMeet && created.id) {
      const deadline = Date.now() + 6500;
      for (const waitMs of [700, 1100, 1600, 2200]) {
        if (Date.now() + waitMs > deadline) break;
        await new Promise(s => setTimeout(s, waitMs));
        const g = await gcal(`events/${encodeURIComponent(created.id)}?conferenceDataVersion=1`);
        if (!g.ok) break;
        const fresh = await g.json();
        meet = meetLinkOf(fresh);
        if (meet) break;
        // A request that has actually failed will never succeed by waiting.
        if (fresh.conferenceData?.createRequest?.status?.statusCode === 'failure') break;
      }
    }

    return json(res, 200, {
      ok: true,
      gcal_id: created.id,
      htmlLink: created.htmlLink,
      meet,
      account: acct.id,
      accountLabel: acct.label,
      // Said plainly rather than left for the user to infer from a blank field.
      linkPending: wantMeet && !meet,
    });
  } catch (e) {
    return json(res, 502, { error: String(e.message || e).slice(0, 240) });
  }
}

// The poll above can take ~7s; the default 10s ceiling leaves no room for the
// token refresh and the insert on a cold start.
export const config = { maxDuration: 20 };
