// /api/health — the only door the phone gets.
//
// Apple Health used to write straight to PostgREST with the publishable key.
// Since row-level security that key writes nothing, and the obvious replacement
// — putting the service key into an iOS Shortcut — hands a phone a credential
// that can read and delete every table in the project: money, journal, all of it.
// Shortcuts sync through iCloud. That is a lot of authority to carry around for
// the sake of a step count.
//
// So the service key stays on the server and the phone gets a token that buys
// exactly one capability: appending health rows. It cannot name a table, choose a
// column, or reach anything else, because none of those are parameters.
//
// Env on Vercel:
//   SUPABASE_URL, SUPABASE_SERVICE_KEY, HEALTH_TOKEN
//
// The rules live in src/lib/healthintake.js and are tested there without a
// network. This file is plumbing.

import { validateRows, datesIn, tokenMatches, METRICS, MAX_ROWS } from '../src/lib/healthintake.js';

const json = (res, code, body) => {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  const token = process.env.HEALTH_TOKEN;

  // Checked before anything is parsed. An endpoint that authenticates after
  // doing work is an endpoint that does work for strangers.
  const given = req.headers['x-health-token'] || '';
  if (!tokenMatches(given, token)) return json(res, 401, { error: 'bad or missing x-health-token' });

  if (!url || !key) return json(res, 503, { error: 'server is not configured' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }

  const { ok, error, rows, rejected } = validateRows(body);
  if (!ok) return json(res, 400, { error });

  // Nothing valid in the batch is not a server error and not a success. Say so,
  // and hand back WHY each row was refused — a Shortcut silently dropping nine
  // rows in ten looks exactly like one that is working, and the person holding
  // the phone has no other way to find out.
  if (!rows.length) {
    return json(res, 422, {
      written: 0,
      rejected: rejected.slice(0, 20).map(r => r.why),
      hint: `metrics must be one of: ${METRICS.join(', ')}`,
    });
  }

  const H = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };
  const rest = (p, init = {}) =>
    fetch(`${url.replace(/\/$/, '')}/rest/v1/${p}`, { ...init, headers: { ...H, ...(init.headers || {}) } });

  try {
    // Clear only the days being rewritten. Deleting by date rather than wiping
    // the table is the whole difference between a resync and a data loss: the
    // half-hourly job sends today, and it must not be able to remove last year
    // on its way in. `in.()` rather than a range, so the set deleted is exactly
    // the set about to be inserted and cannot be widened by a bad date.
    const days = datesIn(rows);
    const del = await rest(`health_metrics?date=in.(${days.join(',')})`, { method: 'DELETE' });
    if (!del.ok && del.status !== 404) {
      return json(res, 502, { error: `clear failed: ${del.status} ${(await del.text()).slice(0, 200)}` });
    }

    const ins = await rest('health_metrics', { method: 'POST', body: JSON.stringify(rows) });
    if (!ins.ok) {
      return json(res, 502, { error: `insert failed: ${ins.status} ${(await ins.text()).slice(0, 200)}` });
    }

    // A heartbeat the dashboard can render, so a Shortcut that quietly stops
    // running shows up as a stale line rather than as a flat chart nobody
    // questions. Best effort: failing to record success must not report failure.
    await rest('memory', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify([{
        key: 'health_last_sync',
        value: { at: new Date().toISOString(), rows: rows.length, days: days.length, rejected: rejected.length },
        updated_at: new Date().toISOString(),
      }]),
    }).catch(() => {});

    return json(res, 200, {
      written: rows.length,
      days: days.length,
      rejected: rejected.length,
      // Truncated on purpose: a year of backfill can refuse hundreds of rows and
      // the Shortcut only needs to know it happened and roughly why.
      why: rejected.slice(0, 10).map(r => r.why),
    });
  } catch (e) {
    return json(res, 502, { error: String(e.message || e).slice(0, 200) });
  }
}

export const config = { api: { bodyParser: { sizeLimit: '4mb' } } };
export { MAX_ROWS };
