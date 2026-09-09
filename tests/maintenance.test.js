// Weekly maintenance — what counts as "needs a person".
//
// This job is silent when healthy and emails Neel when it is not, so its whole
// value is in that judgement being right. Two ways it could be useless:
//
//   - too quiet: a worker stops, the report says nothing, and the dashboard
//     serves month-old numbers. That is what has actually been happening.
//   - too loud: a note every week, and he deletes the email unread — taking the
//     one that mattered with it.
//
// So every rule below is a test, rather than something discovered in production
// five weeks later.

import { assess } from '../scripts/maintenance.mjs';
import { QUIET_AFTER_H } from '../src/lib/notify.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log('FAIL ' + n); } };
const eq = (a, b, n) => ok(Object.is(a, b), `${n} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const NOW = new Date('2026-09-09T21:30:00Z');
const ago = h => new Date(NOW.getTime() - h * 3600000).toISOString();
const has = (notes, re) => notes.some(n => re.test(n));

// A dashboard with nothing wrong with it.
const healthy = () => ({
  now: NOW,
  counts: { investments: 20, subjects: 6, timetable: 17, portfolio_snapshots: 40 },
  latestBrief: ago(6),
  syncStatus: { prices: { ok: true, at: ago(11) }, meetings: { ok: true, at: ago(2) } },
  pricesLast: { failed: [] },
  vaultInbox: [],
  brainIndex: { built: ago(20) },
});

// ---------------------------------------------------------------- silence is the default
{
  eq(assess(healthy()).notes.length, 0, 'a healthy week says NOTHING — a weekly email trains you to delete it unread');
  eq(assess({ now: NOW, syncStatus: {} }).notes.length > 0, true,
     'but a completely empty read is not silently treated as healthy');
}

// ---------------------------------------------------------------- empty is worse than stale
//
// An empty table renders as a clean empty state, which looks deliberate. Stale
// data at least looks like data.
{
  for (const t of ['investments', 'subjects', 'timetable']) {
    const s = healthy(); s.counts[t] = 0;
    ok(has(assess(s).notes, new RegExp(`${t} is EMPTY`)), `an empty ${t} is reported`);
    ok(has(assess(s).notes, /clean empty state/), 'and says why that is the dangerous kind of wrong');
  }
  const fine = healthy(); fine.counts.portfolio_snapshots = 0;
  eq(assess(fine).notes.length, 0, 'but an empty snapshot table is not itself an alarm — it fills over time');
}

// ---------------------------------------------------------------- the brief
{
  const none = healthy(); none.latestBrief = null;
  ok(has(assess(none).notes, /has ever been written/), 'no brief at all is reported');
  const old = healthy(); old.latestBrief = ago(24 * 5);
  ok(has(assess(old).notes, /5 days old/), 'a five-day-old brief means daily-brief.yml stopped');
  const y = healthy(); y.latestBrief = ago(30);
  eq(assess(y).notes.length, 0, 'a brief from yesterday is normal — the job runs once a day');
}

// ---------------------------------------------------------------- the two sync failures
{
  const bad = healthy();
  bad.syncStatus = { amizone: { ok: false, at: ago(1), reason: 'no captured pages' } };
  ok(has(assess(bad).notes, /amizone sync is failing/), 'a worker reporting failure is named');
  ok(has(assess(bad).notes, /no captured pages/), 'with its reason');

  // The one that hides. `ai` sat at ok:true and 212 hours for nine days.
  const quiet = healthy();
  quiet.syncStatus = { meetings: { ok: true, at: ago(30) } };
  ok(has(assess(quiet).notes, /meetings sync has gone quiet/),
     'a worker reporting HEALTHY but silent past its cadence is the failure that hides');
  ok(has(assess(quiet).notes, /normally every 6h/), 'and the report says what normal is, so the gap means something');

  // The weekend trap: this job runs Tuesday night, and prices is weekdays-only.
  const weekend = healthy();
  weekend.syncStatus = { prices: { ok: true, at: ago(36) } };
  eq(assess(weekend).notes.length, 0, "a weekday-only worker's normal gap is not a fault");

  // An unlisted worker has no known cadence, so silence proves nothing about it.
  const unknown = healthy();
  unknown.syncStatus = { something: { ok: true, at: ago(500) } };
  eq(assess(unknown).notes.length, 0, 'a worker with no known cadence is never called quiet');
  ok(!Object.prototype.hasOwnProperty.call(QUIET_AFTER_H, 'ai'),
     'and the cadences come from notify.js, not a second copy that could disagree');

  const off = healthy();
  off.syncStatus = { binance: { ok: false, configured: false } };
  eq(assess(off).notes.length, 0, 'something deliberately not set up is not broken');

  const missing = healthy(); missing.syncStatus = null;
  ok(has(assess(missing).notes, /no worker is reporting at all/), 'and a missing sync_status is itself the alarm');
}

// ---------------------------------------------------------------- the frozen price
{
  const s = healthy(); s.pricesLast = { failed: ['GOLDBEES'] };
  ok(has(assess(s).notes, /cannot price GOLDBEES/), 'a ticker nothing can price is named');
  ok(has(assess(s).notes, /last_price is frozen/), 'and what that means for the number on screen');
}

// ---------------------------------------------------------------- the vault round trip
{
  const rej = healthy();
  rej.vaultInbox = [{ status: 'rejected', reason: 'odd characters in the filename', created_at: ago(30) }];
  ok(has(assess(rej).notes, /never reached the vault/), 'a rejected note is reported');
  ok(has(assess(rej).notes, /odd characters/), 'with the reason the runner gave');

  const stuck = healthy();
  stuck.vaultInbox = [{ status: 'pending', created_at: ago(5) }];
  ok(has(assess(stuck).notes, /inbox runner may have stopped/), 'a note queued for hours means the runner stopped');

  const fresh = healthy();
  fresh.vaultInbox = [{ status: 'pending', created_at: ago(0.2) }];
  eq(assess(fresh).notes.length, 0, 'but one queued twelve minutes ago is simply waiting — it runs every 15');

  const done = healthy();
  done.vaultInbox = [{ status: 'committed', created_at: ago(50) }];
  eq(assess(done).notes.length, 0, 'and a note that landed is not news');
}

// ---------------------------------------------------------------- the vault index
{
  const old = healthy(); old.brainIndex = { built: ago(24 * 30) };
  ok(has(assess(old).notes, /index was last built 30 days ago/), 'a month-old index is worth saying');
  const ok3w = healthy(); ok3w.brainIndex = { built: ago(24 * 10) };
  eq(assess(ok3w).notes.length, 0, 'ten days is not — the vault only reindexes when something is written');
  const never = healthy(); never.brainIndex = null;
  eq(assess(never).notes.length, 0, 'and no index at all is not reported here — that is a different problem');
}

// ---------------------------------------------------------------- garbage in
{
  eq(assess().notes.length > 0, true, 'called with nothing, it reports rather than passing silently');
  eq(assess({ now: NOW, syncStatus: { x: null }, counts: {}, latestBrief: ago(1) }).notes.length, 0,
     'a malformed worker entry is skipped, not crashed on');
  const bad = healthy(); bad.syncStatus = { meetings: { ok: true, at: 'not a date' } };
  eq(assess(bad).notes.length, 0, 'and an unparseable timestamp says nothing rather than everything');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
