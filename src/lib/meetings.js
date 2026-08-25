// Meetings: accounts, invite text, and history.
//
// Pure. The Google call lives in api/meet.js.
//
// WHY THIS EXISTS AT ALL — the latency problem.
//
// Meetings used to be created by queueing a `meeting_add` request that
// scripts/meeting-worker.mjs drained on a GitHub Actions cron ('*/5 2-20 * * *').
// The Meet room itself provisions in about five seconds; the wait was entirely
// the queue — up to five minutes for the next slot, plus GitHub's own cron
// delay, plus runner spin-up. And outside 02:00-20:00 UTC (01:30-07:30 IST) the
// worker did not run at all, so a meeting made at 3am waited until morning.
//
// So creation moved to a Vercel function that calls Google directly. The worker
// stays as the safety net: it still syncs calendars and still heals any meeting
// whose room was not ready before the request had to return.

export const ACCOUNTS = [
  { id: 'personal', label: 'Personal', color: 'var(--cyan)' },
  { id: 'work', label: 'Work', color: 'var(--orange)' },
  { id: 'third', label: 'Third', color: 'var(--purple)' },
];

export const accountById = id =>
  ACCOUNTS.find(a => a.id === id) || ACCOUNTS[0];

/**
 * Which accounts are actually usable.
 *
 * The server reports which refresh tokens it holds. An account with no token
 * cannot create anything, and offering it in the picker would produce a
 * meeting that silently lands on the wrong calendar — which is precisely the
 * bug this feature exists to fix.
 */
export function availableAccounts(connected) {
  const ids = Array.isArray(connected) ? connected : null;
  if (!ids) return ACCOUNTS;                      // unknown: show all, let the server refuse
  return ACCOUNTS.filter(a => ids.includes(a.id));
}

// ---------------------------------------------------------------- guests

/**
 * Split a pasted guest list.
 *
 * Accepts comma, semicolon, whitespace or newline separated, because people
 * paste all four. Requires an @: a malformed address makes Google reject the
 * WHOLE insert with a 400, which loses the meeting rather than the bad guest.
 */
export function parseGuests(raw) {
  return String(raw || '')
    .split(/[\s,;]+/)
    .map(x => x.trim().replace(/^[<(]|[>)]$/g, ''))
    .filter(x => /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(x))
    .filter((x, i, a) => a.indexOf(x) === i);
}

/** Addresses that were typed but thrown away, so the UI can say so. */
export function rejectedGuests(raw) {
  const kept = new Set(parseGuests(raw));
  return String(raw || '')
    .split(/[\s,;]+/)
    .map(x => x.trim())
    .filter(Boolean)
    .filter(x => !kept.has(x.replace(/^[<(]|[>)]$/g, '')));
}

// ---------------------------------------------------------------- time

const pad = n => String(n).padStart(2, '0');

/** Local wall-clock ISO, no timezone suffix — what Google wants with a tz field. */
export const localIso = d =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;

export function endFrom(startIso, minutes) {
  const t = new Date(startIso);
  if (Number.isNaN(t.getTime())) return null;
  const n = Number(minutes);
  if (!Number.isFinite(n) || n <= 0) return null;
  return localIso(new Date(t.getTime() + n * 60000));
}

export const DURATIONS = [15, 30, 45, 60, 90, 120];

export function fmtRange(startIso, endIso) {
  const a = new Date(startIso), b = new Date(endIso);
  if (Number.isNaN(a.getTime())) return '';
  const day = a.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  const t = d => d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
  return Number.isNaN(b.getTime()) ? `${day}, ${t(a)}` : `${day}, ${t(a)}–${t(b)}`;
}

export function tzName() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata'; }
  catch { return 'Asia/Kolkata'; }
}

// ---------------------------------------------------------------- invite

/**
 * The block you paste to whoever is joining.
 *
 * Title, when, what will be discussed, then the link. Notes come BEFORE the
 * link on purpose: the agenda is the part a person reads and decides on, and
 * burying it under a URL is how meetings get accepted without anyone knowing
 * what they are for.
 *
 * Bulleted notes stay bulleted; prose stays prose. Sections are dropped
 * entirely when empty rather than left as an empty heading, because a paste
 * with "What we'll cover:" and nothing under it reads as an oversight.
 */
export function buildInvite(m = {}) {
  const lines = [];
  const title = String(m.title || '').trim();
  if (title) lines.push(title);

  const when = fmtRange(m.start, m.end);
  if (when) lines.push(`${when}${m.tz ? ` (${m.tz})` : ''}`);

  const notes = String(m.notes || '').trim();
  if (notes) {
    lines.push('', "What we'll cover:");
    for (const raw of notes.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      // Respect a bullet the user typed; add one where they wrote a bare line.
      lines.push(/^[-*•\d]/.test(line) ? line.replace(/^[-*]\s*/, '• ') : `• ${line}`);
    }
  }

  if (m.meet) lines.push('', `Join: ${m.meet}`);
  else if (m.wantMeet !== false) lines.push('', 'Meet link: still being created.');

  const guests = Array.isArray(m.attendees) ? m.attendees : [];
  if (guests.length) lines.push('', `Invited: ${guests.join(', ')}`);

  return lines.join('\n');
}

// ---------------------------------------------------------------- status

/**
 * What state a meeting is in.
 *
 * `pending` and `nolink` are different and the UI shows them differently: one
 * is still being created, the other was created but its room never arrived and
 * needs the backfill. Collapsing them into "no link" hides a real failure.
 */
export function meetingStatus(m, now = Date.now()) {
  if (!m) return { key: 'unknown', label: 'Unknown', c: 'var(--ink-3)' };
  const start = new Date(m.start).getTime();
  const end = new Date(m.end || m.start).getTime();
  if (Number.isFinite(end) && end < now) return { key: 'past', label: 'Done', c: 'var(--ink-3)' };
  if (Number.isFinite(start) && start <= now) return { key: 'live', label: 'Live now', c: 'var(--green)' };
  if (m.status === 'pending' && !m.gcal_id) return { key: 'pending', label: 'Creating…', c: 'var(--yellow)' };
  if (m.wantMeet !== false && !m.meet) return { key: 'nolink', label: 'No link yet', c: 'var(--yellow)' };
  return { key: 'ready', label: 'Ready', c: 'var(--cyan)' };
}

export const minutesUntil = (m, now = Date.now()) => {
  const t = new Date(m?.start).getTime();
  return Number.isFinite(t) ? Math.round((t - now) / 60000) : null;
};

export function fmtCountdown(mins) {
  if (mins == null) return '';
  if (mins < 0) return 'live now';
  if (mins < 60) return `in ${mins}m`;
  const h = Math.floor(mins / 60), m = mins % 60;
  if (h < 24) return `in ${h}h${m ? ` ${m}m` : ''}`;
  return `in ${Math.round(h / 24)}d`;
}

// ---------------------------------------------------------------- history

export const sortMeetings = (list, dir = 'desc') =>
  [...(list || [])].sort((a, b) => {
    const c = String(a.start || '').localeCompare(String(b.start || ''));
    return dir === 'asc' ? c : -c;
  });

export function splitByTime(list, now = Date.now()) {
  const up = [], past = [];
  for (const m of list || []) {
    const end = new Date(m.end || m.start).getTime();
    // A meeting that ended half an hour ago is still the one you are in the
    // aftermath of, so it stays in "upcoming" rather than dropping into history
    // the instant it is over.
    (Number.isFinite(end) && end < now - 30 * 60000 ? past : up).push(m);
  }
  return { upcoming: sortMeetings(up, 'asc'), past: sortMeetings(past, 'desc') };
}

/** Search title, notes and guests — the three places you would look. */
export function searchMeetings(list, q) {
  const s = String(q || '').trim().toLowerCase();
  if (!s) return list || [];
  return (list || []).filter(m =>
    String(m.title || '').toLowerCase().includes(s) ||
    String(m.notes || '').toLowerCase().includes(s) ||
    (m.attendees || []).some(a => String(a).toLowerCase().includes(s)));
}

export function groupByMonth(list) {
  const out = [];
  for (const m of list || []) {
    const d = new Date(m.start);
    const key = Number.isNaN(d.getTime()) ? 'Undated'
      : d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    const last = out[out.length - 1];
    if (last && last.key === key) last.items.push(m);
    else out.push({ key, items: [m] });
  }
  return out;
}

// ---------------------------------------------------------------- validation

export function validateMeeting(form) {
  const title = String(form?.title || '').trim();
  if (!title) return { ok: false, why: 'Give the meeting a title.' };
  if (title.length > 200) return { ok: false, why: 'Title is too long.' };
  const start = `${form.date}T${form.time}:00`;
  if (Number.isNaN(new Date(start).getTime())) return { ok: false, why: 'That date and time do not parse.' };
  const end = endFrom(start, form.dur);
  if (!end) return { ok: false, why: 'Pick a duration.' };
  return { ok: true, start, end, title };
}

// ---------------------------------------------------------------- creating

/**
 * Create a meeting, fast, with a fallback that never loses it.
 *
 * Dependencies are injected so this is testable without a network: both the
 * HQ widget and the Meetings tab call it, and both need the same behaviour on
 * every failure path.
 *
 * The contract that matters is what happens when /api/meet fails. It does NOT
 * throw the meeting away — it falls back to the old `meeting_add` queue that
 * the GitHub Actions worker drains. Slower, but the meeting still happens, and
 * the caller is told which path it took so the UI can say "a few minutes"
 * rather than implying it is already done.
 */
export async function createMeeting(input, deps) {
  const { post, queue, now = () => new Date().toISOString(), id } = deps || {};
  const v = validateMeeting(input);
  if (!v.ok) return { ok: false, why: v.why };

  const attendees = parseGuests(input.guests);
  const tz = input.tz || tzName();
  const meeting = {
    id: id || `m-${Date.now()}`,
    title: v.title,
    notes: String(input.notes || '').trim(),
    start: v.start,
    end: v.end,
    tz,
    account: input.account || 'personal',
    wantMeet: input.meet !== false,
    attendees,
    meet: '',
    gcal_id: '',
    status: 'pending',
    created: now(),
  };

  const payload = {
    account: meeting.account, title: meeting.title, notes: meeting.notes,
    start: meeting.start, end: meeting.end, tz, attendees, meet: meeting.wantMeet,
  };

  try {
    const r = await post(payload);
    if (r && r.ok) {
      return {
        ok: true,
        via: 'direct',
        meeting: {
          ...meeting,
          meet: r.meet || '',
          gcal_id: r.gcal_id || '',
          htmlLink: r.htmlLink || '',
          account: r.account || meeting.account,
          status: r.linkPending ? 'linkpending' : 'ready',
        },
        // Distinguished from success-with-link, because a missing room is a
        // real thing the user needs to know about rather than a blank field.
        linkPending: Boolean(r.linkPending),
      };
    }
    await queue?.(meeting);
    return { ok: true, via: 'queue', meeting: { ...meeting, status: 'queued' }, why: r?.error || 'the direct path failed' };
  } catch (e) {
    await queue?.(meeting);
    return { ok: true, via: 'queue', meeting: { ...meeting, status: 'queued' }, why: String(e?.message || e) };
  }
}
