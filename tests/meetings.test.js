import { test, expect } from 'bun:test';
import {
  ACCOUNTS, accountById, availableAccounts,
  parseGuests, rejectedGuests,
  localIso, endFrom, DURATIONS, fmtRange, tzName,
  buildInvite, meetingStatus, minutesUntil, fmtCountdown,
  sortMeetings, splitByTime, searchMeetings, groupByMonth, validateMeeting,
} from '../src/lib/meetings.js';

// ---------------------------------------------------------------- accounts

test('accounts have distinct ids, labels and colours', () => {
  expect(new Set(ACCOUNTS.map(a => a.id)).size).toBe(ACCOUNTS.length);
  ACCOUNTS.forEach(a => expect(a.color).toMatch(/^var\(--/));
});

test('an unknown account falls back to the first rather than to undefined', () => {
  // The old worker did this too: a meeting created before the work account
  // existed still has to go somewhere.
  expect(accountById('nope').id).toBe('personal');
  expect(accountById(null).id).toBe('personal');
  expect(accountById('work').label).toBe('Work');
});

test('only accounts the server actually holds a token for are offered', () => {
  // Offering an unconnected account would silently create the meeting on the
  // wrong calendar — the exact bug this feature exists to fix.
  expect(availableAccounts(['personal']).map(a => a.id)).toEqual(['personal']);
  expect(availableAccounts(['personal', 'work']).length).toBe(2);
  expect(availableAccounts([]).length).toBe(0);
  // unknown (server did not say) shows all and lets the server refuse
  expect(availableAccounts(null).length).toBe(ACCOUNTS.length);
});

// ---------------------------------------------------------------- guests

test('a pasted guest list splits on every separator people actually use', () => {
  const want = ['a@b.com', 'c@d.org'];
  expect(parseGuests('a@b.com, c@d.org')).toEqual(want);
  expect(parseGuests('a@b.com c@d.org')).toEqual(want);
  expect(parseGuests('a@b.com;c@d.org')).toEqual(want);
  expect(parseGuests('a@b.com\nc@d.org')).toEqual(want);
  expect(parseGuests('<a@b.com> <c@d.org>')).toEqual(want);
});

test('malformed addresses are dropped, because one 400s the whole insert', () => {
  expect(parseGuests('good@x.com, notanemail, also bad@')).toEqual(['good@x.com']);
  expect(parseGuests('a@b')).toEqual([]);          // no TLD
  expect(parseGuests('@b.com')).toEqual([]);
  expect(parseGuests('')).toEqual([]);
  expect(parseGuests(null)).toEqual([]);
});

test('duplicates collapse', () => {
  expect(parseGuests('a@b.com, a@b.com, A@b.com')).toEqual(['a@b.com', 'A@b.com']);
});

test('what was thrown away is reportable, not silently swallowed', () => {
  expect(rejectedGuests('good@x.com, junk, bad@')).toEqual(['junk', 'bad@']);
  expect(rejectedGuests('good@x.com')).toEqual([]);
});

// ---------------------------------------------------------------- time

test('localIso is wall-clock with no timezone suffix', () => {
  expect(localIso(new Date(2026, 7, 27, 15, 5))).toBe('2026-08-27T15:05:00');
  expect(localIso(new Date(2026, 0, 1, 9, 0))).toBe('2026-01-01T09:00:00');
});

test('endFrom adds the duration and crosses midnight', () => {
  expect(endFrom('2026-08-27T15:00:00', 30)).toBe('2026-08-27T15:30:00');
  expect(endFrom('2026-08-27T23:45:00', 30)).toBe('2026-08-28T00:15:00');
});

test('endFrom refuses nonsense rather than producing a bad range', () => {
  expect(endFrom('nope', 30)).toBe(null);
  expect(endFrom('2026-08-27T15:00:00', 0)).toBe(null);
  expect(endFrom('2026-08-27T15:00:00', -30)).toBe(null);
  expect(endFrom('2026-08-27T15:00:00', 'abc')).toBe(null);
});

test('every offered duration produces a valid end', () => {
  DURATIONS.forEach(d => expect(endFrom('2026-08-27T10:00:00', d)).toBeTruthy());
});

// ---------------------------------------------------------------- invite

const M = {
  title: 'Q3 planning sync',
  start: '2026-08-27T15:00:00',
  end: '2026-08-27T15:30:00',
  tz: 'Asia/Kolkata',
  notes: 'Budget review\nLaunch timeline\nOpen questions',
  meet: 'https://meet.google.com/abc-defg-hij',
  attendees: ['a@b.com'],
};

test('the invite carries the title, the time, the agenda and the link', () => {
  const t = buildInvite(M);
  expect(t).toContain('Q3 planning sync');
  expect(t).toContain('Asia/Kolkata');
  expect(t).toContain("What we'll cover:");
  expect(t).toContain('• Budget review');
  expect(t).toContain('• Launch timeline');
  expect(t).toContain('Join: https://meet.google.com/abc-defg-hij');
  expect(t).toContain('Invited: a@b.com');
});

test('the agenda comes BEFORE the link', () => {
  // The agenda is the part a person reads and decides on. Under the URL it
  // gets skipped, and meetings get accepted without anyone knowing why.
  const t = buildInvite(M);
  expect(t.indexOf("What we'll cover:")).toBeLessThan(t.indexOf('Join:'));
});

test('a bullet the user typed is respected, a bare line gets one', () => {
  const t = buildInvite({ ...M, notes: '- already bulleted\nbare line\n• dot bullet' });
  expect(t).toContain('• already bulleted');
  expect(t).toContain('• bare line');
  expect(t).toContain('• dot bullet');
});

test('empty sections are omitted, not left as bare headings', () => {
  const t = buildInvite({ ...M, notes: '', attendees: [] });
  expect(t).not.toContain("What we'll cover:");
  expect(t).not.toContain('Invited:');
  expect(t).toContain('Q3 planning sync');
});

test('blank lines inside notes do not become empty bullets', () => {
  const t = buildInvite({ ...M, notes: 'one\n\n\ntwo' });
  expect(t).not.toMatch(/•\s*$/m);
  expect(t.match(/•/g).length).toBe(2);
});

test('a missing link says so instead of pretending there is one', () => {
  const t = buildInvite({ ...M, meet: '' });
  expect(t).toContain('still being created');
  expect(t).not.toContain('Join: ');
});

test('a deliberately link-free meeting says nothing about links', () => {
  const t = buildInvite({ ...M, meet: '', wantMeet: false });
  expect(t).not.toContain('still being created');
  expect(t).not.toContain('Join:');
});

test('buildInvite never throws on junk', () => {
  expect(typeof buildInvite({})).toBe('string');
  expect(typeof buildInvite()).toBe('string');
  expect(typeof buildInvite({ title: 'x', start: 'bad', end: 'bad' })).toBe('string');
});

// ---------------------------------------------------------------- status

const NOW = new Date('2026-08-27T14:00:00').getTime();

test('status separates creating, no-link, ready, live and done', () => {
  const base = { start: '2026-08-27T15:00:00', end: '2026-08-27T15:30:00' };
  expect(meetingStatus({ ...base, status: 'pending', gcal_id: '' }, NOW).key).toBe('pending');
  expect(meetingStatus({ ...base, gcal_id: 'x', meet: '' }, NOW).key).toBe('nolink');
  expect(meetingStatus({ ...base, gcal_id: 'x', meet: 'u' }, NOW).key).toBe('ready');
  expect(meetingStatus({ start: '2026-08-27T13:50:00', end: '2026-08-27T14:20:00', meet: 'u' }, NOW).key).toBe('live');
  expect(meetingStatus({ start: '2026-08-26T10:00:00', end: '2026-08-26T10:30:00' }, NOW).key).toBe('past');
});

test('"creating" and "created but no room" are different states', () => {
  // One is in flight; the other is a real failure the backfill must heal.
  // Collapsing them into "no link" hides the failure.
  const a = meetingStatus({ start: '2026-08-27T15:00:00', status: 'pending', gcal_id: '' }, NOW);
  const b = meetingStatus({ start: '2026-08-27T15:00:00', gcal_id: 'x', meet: '' }, NOW);
  expect(a.key).not.toBe(b.key);
});

test('a meeting with no link wanted is ready without one', () => {
  expect(meetingStatus({ start: '2026-08-27T15:00:00', gcal_id: 'x', wantMeet: false }, NOW).key).toBe('ready');
});

test('countdown reads naturally at every scale', () => {
  expect(fmtCountdown(-5)).toBe('live now');
  expect(fmtCountdown(30)).toBe('in 30m');
  expect(fmtCountdown(90)).toBe('in 1h 30m');
  expect(fmtCountdown(120)).toBe('in 2h');
  expect(fmtCountdown(3000)).toBe('in 2d');
  expect(fmtCountdown(null)).toBe('');
});

test('minutesUntil is null for an unparseable start, not NaN', () => {
  expect(minutesUntil({ start: '2026-08-27T15:00:00' }, NOW)).toBe(60);
  expect(minutesUntil({ start: 'rubbish' }, NOW)).toBe(null);
  expect(minutesUntil({}, NOW)).toBe(null);
});

// ---------------------------------------------------------------- history

const LIST = [
  { id: '1', title: 'Standup', start: '2026-08-27T15:00:00', end: '2026-08-27T15:15:00' },
  { id: '2', title: 'Retro', start: '2026-08-20T11:00:00', end: '2026-08-20T12:00:00', notes: 'sprint review' },
  { id: '3', title: 'Client call', start: '2026-08-27T09:00:00', end: '2026-08-27T09:30:00', attendees: ['x@client.com'] },
  { id: '4', title: 'Planning', start: '2026-07-15T10:00:00', end: '2026-07-15T11:00:00' },
];

test('upcoming sorts soonest-first and past sorts newest-first', () => {
  const { upcoming, past } = splitByTime(LIST, NOW);
  expect(upcoming.map(m => m.id)).toEqual(['1']);
  expect(past.map(m => m.id)).toEqual(['3', '2', '4']);
});

test('a meeting that just ended stays in upcoming for half an hour', () => {
  // It is still the one you are in the aftermath of; dropping it into history
  // the instant it ends makes the link vanish exactly when you want it.
  const justEnded = [{ id: 'j', start: '2026-08-27T13:20:00', end: '2026-08-27T13:50:00' }];
  expect(splitByTime(justEnded, NOW).upcoming.length).toBe(1);
  const longOver = [{ id: 'k', start: '2026-08-27T12:00:00', end: '2026-08-27T12:30:00' }];
  expect(splitByTime(longOver, NOW).past.length).toBe(1);
});

test('search covers title, notes and guests', () => {
  expect(searchMeetings(LIST, 'retro').map(m => m.id)).toEqual(['2']);
  expect(searchMeetings(LIST, 'sprint').map(m => m.id)).toEqual(['2']);
  expect(searchMeetings(LIST, 'client.com').map(m => m.id)).toEqual(['3']);
  expect(searchMeetings(LIST, '').length).toBe(4);
  expect(searchMeetings(LIST, 'zzz').length).toBe(0);
});

test('sortMeetings does not mutate its input', () => {
  const before = LIST.map(m => m.id).join();
  sortMeetings(LIST, 'asc');
  expect(LIST.map(m => m.id).join()).toBe(before);
});

test('history groups into months in order', () => {
  const g = groupByMonth(sortMeetings(LIST, 'desc'));
  expect(g[0].key).toContain('August');
  expect(g[g.length - 1].key).toContain('July');
  expect(g.reduce((n, x) => n + x.items.length, 0)).toBe(4);
});

test('history helpers survive empty and malformed input', () => {
  expect(splitByTime(null, NOW)).toEqual({ upcoming: [], past: [] });
  expect(groupByMonth(null)).toEqual([]);
  expect(searchMeetings(null, 'x')).toEqual([]);
  expect(groupByMonth([{ start: 'rubbish' }])[0].key).toBe('Undated');
});

// ---------------------------------------------------------------- validation

test('validation catches every way the form can be wrong', () => {
  expect(validateMeeting({ title: '', date: '2026-08-27', time: '15:00', dur: 30 }).ok).toBe(false);
  expect(validateMeeting({ title: 'x', date: 'nope', time: '15:00', dur: 30 }).ok).toBe(false);
  expect(validateMeeting({ title: 'x', date: '2026-08-27', time: '15:00', dur: 0 }).ok).toBe(false);
  const good = validateMeeting({ title: '  Sync  ', date: '2026-08-27', time: '15:00', dur: 30 });
  expect(good.ok).toBe(true);
  expect(good.title).toBe('Sync');            // trimmed
  expect(good.end).toBe('2026-08-27T15:30:00');
});

test('tzName always returns something usable', () => {
  expect(typeof tzName()).toBe('string');
  expect(tzName().length).toBeGreaterThan(2);
});

test('fmtRange handles a missing end without printing Invalid Date', () => {
  expect(fmtRange('2026-08-27T15:00:00', '2026-08-27T15:30:00')).toContain('15:00');
  expect(fmtRange('2026-08-27T15:00:00', null)).not.toContain('Invalid');
  expect(fmtRange('rubbish', 'rubbish')).toBe('');
});

// ---------------------------------------------------------------- creating

import { createMeeting } from '../src/lib/meetings.js';

const FORM = {
  account: 'work', title: 'Sync', notes: 'agenda line',
  date: '2026-08-27', time: '15:00', dur: 30, meet: true,
  guests: 'a@b.com, junk',
};

test('the direct path returns a ready meeting with its link', async () => {
  const r = await createMeeting(FORM, {
    post: async () => ({ ok: true, meet: 'https://meet.google.com/x', gcal_id: 'g1', account: 'work' }),
    queue: async () => { throw new Error('queue must not be used when direct works'); },
    id: 'fixed',
  });
  expect(r.ok).toBe(true);
  expect(r.via).toBe('direct');
  expect(r.meeting.meet).toBe('https://meet.google.com/x');
  expect(r.meeting.status).toBe('ready');
  expect(r.meeting.account).toBe('work');
  expect(r.meeting.attendees).toEqual(['a@b.com']);   // junk dropped
});

test('a created event whose room is not ready is flagged, not silently blank', async () => {
  const r = await createMeeting(FORM, {
    post: async () => ({ ok: true, gcal_id: 'g1', meet: '', linkPending: true }),
    queue: async () => {},
  });
  expect(r.linkPending).toBe(true);
  expect(r.meeting.status).toBe('linkpending');
  expect(r.meeting.gcal_id).toBe('g1');
});

test('when the direct path fails the meeting is QUEUED, never lost', async () => {
  // This is the contract that matters. Losing what someone typed because a
  // serverless function had a bad minute is not an acceptable failure.
  const queued = [];
  const r = await createMeeting(FORM, {
    post: async () => ({ ok: false, error: 'boom' }),
    queue: async m => { queued.push(m); },
  });
  expect(r.ok).toBe(true);
  expect(r.via).toBe('queue');
  expect(r.meeting.status).toBe('queued');
  expect(r.why).toContain('boom');
  expect(queued.length).toBe(1);
  expect(queued[0].title).toBe('Sync');
});

test('a thrown network error also queues rather than propagating', async () => {
  const queued = [];
  const r = await createMeeting(FORM, {
    post: async () => { throw new Error('offline'); },
    queue: async m => { queued.push(m); },
  });
  expect(r.via).toBe('queue');
  expect(queued.length).toBe(1);
  expect(r.why).toContain('offline');
});

test('an invalid form is refused before anything is sent', async () => {
  let called = false;
  const r = await createMeeting({ ...FORM, title: '' }, {
    post: async () => { called = true; return { ok: true }; },
    queue: async () => { called = true; },
  });
  expect(r.ok).toBe(false);
  expect(r.why).toBeTruthy();
  expect(called).toBe(false);
});

test('the payload sent to the server carries the account and the notes', async () => {
  let sent = null;
  await createMeeting(FORM, { post: async p => { sent = p; return { ok: true }; }, queue: async () => {} });
  expect(sent.account).toBe('work');
  expect(sent.notes).toBe('agenda line');
  expect(sent.start).toBe('2026-08-27T15:00:00');
  expect(sent.end).toBe('2026-08-27T15:30:00');
  expect(sent.attendees).toEqual(['a@b.com']);
  expect(sent.tz).toBeTruthy();
});
