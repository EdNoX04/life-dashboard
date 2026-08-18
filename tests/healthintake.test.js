// What the health endpoint accepts.
//
// The phone used to write straight to PostgREST. Since RLS it cannot, and the
// obvious fix — the service key in an iOS Shortcut — hands a phone a credential
// that reads and deletes every table in the project. So the endpoint takes a
// token that buys exactly one capability: appending health rows.
//
// These tests are mostly about what gets REFUSED, because every rejection here is
// a row that would otherwise insert cleanly and be wrong somewhere else.

import {
  METRICS, MAX_ROWS, validateRows, datesIn, tokenMatches,
} from '../src/lib/healthintake.js';

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; } else { fail++; console.log('FAIL ' + name); } };
const eq = (a, b, name) => ok(a === b, `${name} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const TODAY = new Date('2026-08-16T12:00:00Z');
const V = (rows) => validateRows(rows, { today: TODAY });

// ------------------------------------------------------------------ happy

const good = V([
  { date: '2026-08-16', metric: 'steps', value: 8421 },
  { date: '2026-08-15', metric: 'sleep_hours', value: 7.2 },
  { date: '2026-08-15', metric: 'weight', value: 71.4 },
]);
eq(good.ok, true, 'a clean batch is accepted');
eq(good.rows.length, 3, 'with every row kept');
eq(good.rejected.length, 0, 'and nothing refused');
eq(good.rows[0].value, 8421, 'values arrive as numbers');

// ------------------------------------------------------------- rejections

// A typo'd metric is worse than a rejected one: it inserts cleanly, never
// appears on any screen, and looks like Apple Health had no data that day.
const typo = V([{ date: '2026-08-16', metric: 'step', value: 900 }]);
eq(typo.rows.length, 0, 'an unknown metric is refused');
ok(/unknown metric/.test(typo.rejected[0].why), 'and says which one');
ok(METRICS.includes('steps') && !METRICS.includes('step'), 'the allowlist is the spelling that counts');

// A future date is a timezone bug on the phone, not a reading. Letting it through
// puts a point on the right edge of every chart that never moves.
const future = V([{ date: '2026-09-01', metric: 'steps', value: 100 }]);
eq(future.rows.length, 0, 'a future date is refused');
ok(/future/.test(future.rejected[0].why), 'and named as such');
eq(V([{ date: '2026-08-16', metric: 'steps', value: 1 }]).rows.length, 1, 'while today is fine');

eq(V([{ date: '16-08-2026', metric: 'steps', value: 1 }]).rows.length, 0, 'a non-ISO date is refused');
eq(V([{ date: '2026-08-16', metric: 'steps', value: 'lots' }]).rows.length, 0, 'a non-numeric value is refused');

// THE unit check. Weight in grams, or a heart rate that is really a step count,
// is a technically valid number that quietly ruins every average it lands in.
const grams = V([{ date: '2026-08-16', metric: 'weight', value: 71400 }]);
eq(grams.rows.length, 0, 'weight in grams is caught by the range');
ok(/outside/.test(grams.rejected[0].why), 'and the range is stated in the reason');
eq(V([{ date: '2026-08-16', metric: 'spo2', value: 98 }]).rows.length, 1, 'a real SpO2 passes');
eq(V([{ date: '2026-08-16', metric: 'spo2', value: 0 }]).rows.length, 0, 'and an impossible one does not');
eq(V([{ date: '2026-08-16', metric: 'sleep_hours', value: 26 }]).rows.length, 0, 'nobody sleeps 26 hours');

// The Shortcut runs every half hour and re-sends today, so duplicates are the
// normal case rather than an error.
const dup = V([
  { date: '2026-08-16', metric: 'steps', value: 8000 },
  { date: '2026-08-16', metric: 'steps', value: 8200 },
]);
eq(dup.rows.length, 1, 'one reading per metric per day');
ok(/duplicate/.test(dup.rejected[0].why), 'and the second is named as a duplicate');

// Both halves of the result matter: a Shortcut dropping nine rows in ten looks
// exactly like one that is working.
ok(Array.isArray(good.rejected), 'the caller always gets the refused list back');

// ---------------------------------------------------------------- shape

eq(V('nope').ok, false, 'a non-array body is a bad request, not an empty batch');
eq(V(null).ok, false, 'and so is nothing at all');
eq(V({ rows: [{ date: '2026-08-16', metric: 'steps', value: 5 }] }).rows.length, 1,
   'a wrapped { rows: [...] } body is accepted too — Shortcuts build both shapes');

const flood = V(Array.from({ length: MAX_ROWS + 1 }, () => ({ date: '2026-08-16', metric: 'steps', value: 1 })));
eq(flood.ok, false, 'a runaway loop cannot fill the database in one request');
ok(MAX_ROWS > 12 * 365, 'while a full year of backfill still fits');

// ---------------------------------------------------------------- dates

// Deleting by DATE rather than wiping the table is the difference between a
// resync and a data loss: the half-hourly job sends today and must not be able
// to remove last year on the way in.
eq(JSON.stringify(datesIn(good.rows)), '["2026-08-15","2026-08-16"]',
   'the dates to clear are exactly the dates being written, sorted');
eq(datesIn([]).length, 0, 'an empty batch clears nothing');

// ---------------------------------------------------------------- token

ok(tokenMatches('abc123', 'abc123'), 'the right token matches');
ok(!tokenMatches('abc124', 'abc123'), 'a wrong one does not');
ok(!tokenMatches('abc', 'abc123'), 'nor a prefix');
// No token configured must mean nothing is authorised. The opposite default —
// an unset variable meaning "allow" — is how an endpoint ships wide open.
ok(!tokenMatches('anything', ''), 'and an unconfigured server authorises nobody');
ok(!tokenMatches('', ''), 'including an empty request');

console.log(`${pass}/${pass + fail} passing`);
if (fail) process.exit(1);
