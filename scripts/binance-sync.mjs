// Binance sync — pulls balances, P2P orders, deposits and withdrawals into
// Supabase so the Money tab can show crypto next to everything else.
//
// ---------------------------------------------------------------------------
// READ-ONLY. THIS IS A HARD PROPERTY, NOT A PREFERENCE.
//
// Every request this file makes is a GET against a history or balance endpoint.
// There is no order placement, no withdrawal, no transfer, no convert — not
// commented out, not behind a flag, not present. The API key it expects must be
// created with "Enable Reading" ONLY, with Spot Trading and Withdrawals left
// off, which makes the constraint true at Binance's end as well as this one.
// Belt and braces, because the failure mode here is not a wrong number on a
// dashboard, it is money leaving an account.
//
// If you ever find yourself adding a POST to this file, stop. The dashboard is
// deliberately incapable of executing anything, for the same reason the stock
// side is: acting on someone's behalf in a market is a different kind of
// software with a different kind of licence behind it.
// ---------------------------------------------------------------------------
//
// Env (GitHub Secrets):
//   SUPABASE_URL, SUPABASE_SERVICE_KEY
//   BINANCE_API_KEY, BINANCE_API_SECRET     — read-only key pair
//   BINANCE_LOOKBACK_DAYS  (optional, default 120)
//
// A note on IP allow-listing: Binance offers it and it is normally the right
// call, but GitHub Actions runners do not have stable egress addresses, so an
// IP-restricted key will fail here intermittently and confusingly. The mitigation
// is the one above — a key that can only read is not worth much to anyone who
// steals it. If you would rather have the IP restriction, this worker has to run
// somewhere with a fixed address instead.
//
// Windows: the C2C endpoint accepts a 30-day range at most, and capital history
// 90 days. So the lookback is walked in chunks and every run re-fetches the
// whole window rather than asking for "since last time". Re-fetching is
// deliberate: a "since last run" cursor loses everything that happened during a
// failed run, and failed runs are precisely when nobody is watching. Overlap
// plus dedupeLedger() is the cheap way to be crash-safe.

import crypto from 'node:crypto';
import {
  normalizeP2P, normalizeFlow, dedupeLedger, positions,
} from './lib/binance-ledger.mjs';

const {
  SUPABASE_URL, SUPABASE_SERVICE_KEY,
  BINANCE_API_KEY, BINANCE_API_SECRET,
  BINANCE_LOOKBACK_DAYS = '120',
} = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing Supabase env — nowhere to write, and nowhere to record that fact.');
  process.exit(0);
}

const H = {
  apikey: SUPABASE_SERVICE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
  'Content-Type': 'application/json',
};
const sb = (p, init = {}) => fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${p}`,
  { ...init, headers: { ...H, ...(init.headers || {}) } });

async function memGet(key) {
  const r = await sb(`memory?key=eq.${encodeURIComponent(key)}&select=value`);
  if (!r.ok) return null;
  const j = await r.json();
  return j?.[0]?.value ?? null;
}

async function memPut(key, value) {
  const r = await sb('memory?on_conflict=key', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify([{ key, value, updated_at: new Date().toISOString() }]),
  });
  if (!r.ok) throw new Error(`memory ${key}: ${r.status} ${await r.text()}`);
}

// Same contract as the other workers: an unconfigured job is a task waiting for
// you, not an incident. It reports itself into memory.sync_status where the
// dashboard draws it as an amber line, and exits 0. Only a rejected credential
// or a genuinely failed request is allowed to go red.
async function reportStatus(patch) {
  try {
    const cur = (await memGet('sync_status')) || {};
    cur.binance = { ...patch, at: new Date().toISOString() };
    await memPut('sync_status', cur);
  } catch (e) {
    console.error('  (could not record status:', e.message, ')');
  }
}

// ---------------------------------------------------------------- signing

// Binance signs the query string with HMAC-SHA256 over the secret. `recvWindow`
// caps how long a signed request stays valid; 10s is generous for a runner and
// short enough that a captured request is not replayable in practice.
function signed(path, params = {}) {
  const qs = new URLSearchParams({ ...params, recvWindow: '10000', timestamp: String(Date.now()) }).toString();
  const sig = crypto.createHmac('sha256', BINANCE_API_SECRET).update(qs).digest('hex');
  return `https://api.binance.com${path}?${qs}&signature=${sig}`;
}

let calls = 0;
async function get(path, params) {
  // Binance rate-limits by request weight, not count, and the endpoints used
  // here are cheap — but a lookback of several months means dozens of windowed
  // calls in a row, which is exactly the shape that trips the limiter. A flat
  // pause costs a few seconds in a job nobody is waiting on.
  if (calls++) await new Promise(r => setTimeout(r, 350));
  const r = await fetch(signed(path, params), { headers: { 'X-MBX-APIKEY': BINANCE_API_KEY } });
  const text = await r.text();
  if (!r.ok) {
    // -2015 is the one that actually happens: key invalid, or IP-restricted and
    // the runner's address is not on the list. Saying so beats a bare 401.
    let hint = '';
    if (text.includes('-2015')) hint = ' — key rejected: check it is enabled, and that IP restriction is OFF (Actions runners have no fixed IP).';
    else if (text.includes('-1021')) hint = ' — timestamp outside recvWindow; the runner clock is skewed.';
    else if (text.includes('-2014')) hint = ' — malformed API key.';
    throw new Error(`${path} ${r.status}: ${text.slice(0, 200)}${hint}`);
  }
  return JSON.parse(text);
}

const DAY = 86400e3;

/** Walk a time range backwards in chunks the endpoint will actually accept. */
function windows(days, chunkDays) {
  const out = [];
  const now = Date.now();
  for (let end = now; end > now - days * DAY; end -= chunkDays * DAY) {
    out.push({ startTime: Math.max(Math.floor(end - chunkDays * DAY), 0), endTime: Math.floor(end) });
  }
  return out;
}

// ------------------------------------------------------------------ pulls

async function pullBalances() {
  // getUserAsset is a POST in Binance's docs but is signed identically; it is
  // the only endpoint here that is not a GET, and it still only reads.
  const url = signed('/sapi/v1/asset/getUserAsset', { needBtcValuation: 'true' });
  const r = await fetch(url, { method: 'POST', headers: { 'X-MBX-APIKEY': BINANCE_API_KEY } });
  if (!r.ok) throw new Error(`balances ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  return (Array.isArray(j) ? j : [])
    .map(b => ({
      asset: String(b.asset || '').toUpperCase(),
      free: Number(b.free) || 0,
      locked: Number(b.locked) || 0,
      // Earn/staked balances live outside `free` and `locked`. Omitting them
      // makes a staked position look like it was sold.
      staked: (Number(b.freeze) || 0) + (Number(b.withdrawing) || 0),
      btcValue: Number(b.btcValuation) || 0,
    }))
    .map(b => ({ ...b, total: b.free + b.locked + b.staked }))
    .filter(b => b.total > 0)
    .sort((a, b) => b.btcValue - a.btcValue);
}

async function pullP2P(days) {
  const rows = [];
  for (const w of windows(days, 30)) {
    for (const tradeType of ['BUY', 'SELL']) {
      const j = await get('/sapi/v1/c2c/orderMatch/listUserOrderHistory', { ...w, tradeType, rows: '100' });
      for (const o of (j?.data || [])) {
        const n = normalizeP2P(o);
        if (n) rows.push(n);
      }
    }
  }
  return rows;
}

async function pullCapital(days) {
  const rows = [];
  for (const w of windows(Math.min(days, 90), 90)) {
    for (const [path, kind] of [
      ['/sapi/v1/capital/deposit/hisrec', 'in'],
      ['/sapi/v1/capital/withdraw/history', 'out'],
    ]) {
      const j = await get(path, w);
      for (const r of (Array.isArray(j) ? j : [])) {
        const n = normalizeFlow(r, kind);
        if (n) rows.push(n);
      }
    }
  }
  return rows;
}

// ------------------------------------------------------------------- run

async function run() {
  if (!BINANCE_API_KEY || !BINANCE_API_SECRET) {
    const missing = [!BINANCE_API_KEY && 'BINANCE_API_KEY', !BINANCE_API_SECRET && 'BINANCE_API_SECRET'].filter(Boolean);
    const reason = `Binance is not connected yet — missing ${missing.join(', ')} in repo secrets. Create a READ-ONLY key (Enable Reading only; Spot Trading and Withdrawals off).`;
    await reportStatus({ ok: false, configured: false, reason });
    console.log(reason);
    return;  // exit 0 on purpose.
  }

  const days = Math.max(1, Math.min(Number(BINANCE_LOOKBACK_DAYS) || 120, 365));
  const problems = [];

  let balances = [];
  try { balances = await pullBalances(); }
  catch (e) { problems.push(`balances: ${e.message}`); console.error('  ✗', e.message); }

  // Each pull is isolated. P2P being unavailable — it is region-gated and can
  // 403 on some accounts — must not cost you the balances, which are the part
  // you look at daily.
  let fresh = [];
  for (const [label, fn] of [['p2p', () => pullP2P(days)], ['capital', () => pullCapital(days)]]) {
    try { fresh.push(...await fn()); }
    catch (e) { problems.push(`${label}: ${e.message}`); console.error('  ✗', e.message); }
  }

  // Merge with what is already stored. The stored ledger is the long memory:
  // the lookback window only reaches back so far, and rows that fall out of it
  // must not fall out of the ledger — a buy from last year ageing out of the
  // window would silently reset the cost basis of everything bought since.
  const prev = (await memGet('binance_ledger')) || {};
  const merged = dedupeLedger([...(Array.isArray(prev.rows) ? prev.rows : []), ...fresh]);
  const pos = positions(merged);

  await memPut('binance_ledger', {
    rows: merged,
    positions: pos,
    balances,
    lookbackDays: days,
    updated: new Date().toISOString(),
  });

  console.log(`${balances.length} asset(s) held · ${merged.length} ledger row(s) (${fresh.length} fetched this run) · ${pos.length} position(s)`);
  for (const p of pos.slice(0, 8)) {
    console.log(`  ${p.asset.padEnd(6)} qty ${p.qty} · avg ${p.avgCost ? p.avgCost.toFixed(2) : '—'} · realised ${p.realised.toFixed(2)}`);
  }

  if (problems.length) {
    await reportStatus({ ok: false, configured: true, reason: problems.join('; ').slice(0, 400) });
    process.exit(1);
  }
  await reportStatus({ ok: true, configured: true, reason: '', accounts: ['Binance'] });
}

run().catch(async (e) => {
  console.error(e);
  await reportStatus({ ok: false, configured: true, reason: e.message.slice(0, 400) });
  process.exit(1);
});
