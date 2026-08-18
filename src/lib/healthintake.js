// What the health endpoint will accept.
//
// The phone used to write straight to PostgREST with the publishable key. Since
// RLS that key writes nothing, and the obvious replacement — putting the service
// key in the Shortcut — hands a phone a credential that can read and delete every
// table in the project: money, journal, everything. A health sync needs to write
// health.
//
// So the rules live here, pure and testable, and /api/health enforces them. The
// token on the phone buys exactly one capability: appending health rows. It
// cannot name a table, cannot choose a column, and cannot reach anything else.

// The metric names the dashboard already reads. An allowlist rather than a free
// string, because a typo'd metric is worse than a rejected one: it inserts
// cleanly, never appears on any screen, and looks like Apple Health simply had no
// data that day.
export const METRICS = [
  'sleep_hours', 'steps', 'resting_hr', 'hrv', 'heart_rate', 'active_energy',
  'exercise_min', 'spo2', 'resp_rate', 'distance_km', 'vo2max', 'weight',
];

// A year of backfill across twelve metrics is ~4,400 rows. The cap is generous
// enough for that and small enough that a runaway Shortcut loop cannot fill the
// database in one request.
export const MAX_ROWS = 6000;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Ranges wide enough to admit any real human reading and narrow enough to reject
// a unit mix-up. Weight in grams, or a heart rate that is really a step count,
// arrives as a number that is technically valid and quietly ruins every average
// it lands in.
const RANGE = {
  sleep_hours: [0, 24],
  steps: [0, 200000],
  resting_hr: [20, 200],
  heart_rate: [20, 250],
  hrv: [1, 400],
  active_energy: [0, 20000],
  exercise_min: [0, 1440],
  spo2: [50, 100],
  resp_rate: [3, 60],
  distance_km: [0, 500],
  vo2max: [10, 90],
  weight: [20, 400],
};

/**
 * Clean an incoming batch.
 *
 * Returns the rows worth writing AND the ones refused, with a reason each. Both
 * halves matter: a Shortcut that silently drops nine rows in ten looks exactly
 * like a Shortcut that is working, and the person holding the phone has no way
 * to tell.
 */
export function validateRows(input, { today = new Date() } = {}) {
  const rows = Array.isArray(input) ? input : Array.isArray(input?.rows) ? input.rows : null;
  if (!rows) return { ok: false, error: 'body must be an array of rows, or { rows: [...] }', rows: [], rejected: [] };
  if (rows.length > MAX_ROWS) {
    return { ok: false, error: `too many rows (${rows.length} > ${MAX_ROWS})`, rows: [], rejected: [] };
  }

  const out = [];
  const rejected = [];
  const seen = new Set();
  const todayStr = today.toISOString().slice(0, 10);

  for (const r of rows) {
    const date = String(r?.date || '').trim();
    const metric = String(r?.metric || '').trim();
    const value = Number(r?.value);

    if (!ISO_DATE.test(date)) { rejected.push({ r, why: 'date is not YYYY-MM-DD' }); continue; }
    // A date in the future is a timezone bug on the phone, not a reading. Letting
    // it through puts a point on the right-hand edge of every chart that never
    // moves and never explains itself.
    if (date > todayStr) { rejected.push({ r, why: 'date is in the future' }); continue; }
    if (!METRICS.includes(metric)) { rejected.push({ r, why: `unknown metric "${metric}"` }); continue; }
    if (!Number.isFinite(value)) { rejected.push({ r, why: 'value is not a number' }); continue; }

    const [lo, hi] = RANGE[metric];
    if (value < lo || value > hi) { rejected.push({ r, why: `${metric} ${value} outside ${lo}–${hi}` }); continue; }

    // One reading per metric per day. The Shortcut runs every 30 minutes and
    // re-sends today, so duplicates are the normal case rather than the error.
    const key = `${date}|${metric}`;
    if (seen.has(key)) { rejected.push({ r, why: 'duplicate for that day' }); continue; }
    seen.add(key);

    out.push({ date, metric, value });
  }

  return { ok: true, error: null, rows: out, rejected };
}

/**
 * Which dates this batch covers — the rows to clear before inserting.
 *
 * Deleting by DATE rather than wiping the table is the whole difference between
 * a resync and a data loss. The half-hourly Shortcut sends today; it must not be
 * able to remove last year on its way in.
 */
export function datesIn(rows = []) {
  return [...new Set(rows.map(r => r.date))].sort();
}

// Timing-safe string compare for the shared token. Doing it with === leaks the
// length and the common prefix through response timing — a small leak, but the
// fix is four lines and the alternative is explaining why it did not matter.
export function tokenMatches(given, expected) {
  const a = String(given || '');
  const b = String(expected || '');
  if (!b) return false;                 // no token configured means nothing is authorised
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
