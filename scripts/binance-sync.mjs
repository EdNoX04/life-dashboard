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
  normalizeP2P, normalizeFlow, normalizeConvert, dedupeLedger, positions, sinceInception,
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

const shape = b => ({ ...b, total: b.free + b.locked + b.staked });
const usable = list => list.filter(b => b.total > 0).sort((a, b) => b.btcValue - a.btcValue);

/**
 * Balances, with a fallback — because the good endpoint does not always answer.
 *
 * `/sapi/v1/asset/getUserAsset` is the one worth having: it reports Earn and
 * staked balances alongside free and locked, and omitting those makes a staked
 * position look like it was sold. Binance documents it as a POST.
 *
 * Measured 2026-09-09, from an eligible IP with a valid read-only key:
 *
 *   balances 404: {"code":-1000,"msg":"Request method 'POST' is not supported"}
 *
 * The router refused the method outright. Whatever the cause — a regional
 * backend, a change on their side — it is not something this end can argue with,
 * and every other call in this file succeeded on that same run.
 *
 * So: try it, and fall back to `GET /api/v3/account`, which is the oldest and
 * most universally supported signed read Binance has. The fallback is NOT
 * equivalent, and the difference is recorded rather than smoothed over — it
 * returns free and locked only, so anything in Earn is invisible to it. A
 * balance list that quietly under-reports is worse than one that says which
 * parts it could not see.
 */
async function pullBalances() {
  const problems = [];

  try {
    const url = signed('/sapi/v1/asset/getUserAsset', { needBtcValuation: 'true' });
    const r = await fetch(url, { method: 'POST', headers: { 'X-MBX-APIKEY': BINANCE_API_KEY } });
    if (!r.ok) throw new Error(`${r.status}: ${(await r.text()).slice(0, 160)}`);
    const j = await r.json();
    const rows = usable((Array.isArray(j) ? j : []).map(b => shape({
      asset: String(b.asset || '').toUpperCase(),
      free: Number(b.free) || 0,
      locked: Number(b.locked) || 0,
      staked: (Number(b.freeze) || 0) + (Number(b.withdrawing) || 0),
      btcValue: Number(b.btcValuation) || 0,
    })));
    return { rows, source: 'getUserAsset', complete: true, problems };
  } catch (e) {
    problems.push(`getUserAsset ${e.message}`);
    console.error('  · getUserAsset unavailable, falling back to spot account:', e.message);
  }

  const url = signed('/api/v3/account', { omitZeroBalances: 'true' });
  const r = await fetch(url, { headers: { 'X-MBX-APIKEY': BINANCE_API_KEY } });
  if (!r.ok) throw new Error(`balances ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  const rows = usable((Array.isArray(j?.balances) ? j.balances : []).map(b => shape({
    asset: String(b.asset || '').toUpperCase(),
    free: Number(b.free) || 0,
    locked: Number(b.locked) || 0,
    staked: 0,          // this endpoint cannot see Earn. Said, not assumed to be zero.
    btcValue: 0,
  })));
  return { rows, source: 'spot-account', complete: false, problems };
}

/**
 * Simple Earn — flexible and locked.
 *
 * The spot fallback cannot see these, and a coin in Earn is still a coin you
 * own; leaving it out makes a staked position look like it was sold. Both of
 * these are plain signed GETs, unlike getUserAsset, so they work where it does
 * not.
 *
 * Failures here are collected and returned rather than thrown: Earn is an extra,
 * and an account that has never used it answers with an empty list on a good day
 * and a 404 on a bad one. Neither is a reason to lose the spot balances.
 */
/**
 * Public prices, so the account can be valued.
 *
 * Unsigned and unauthenticated — this is the one call here that needs no key,
 * which also means it cannot be the thing that fails for a permissions reason.
 *
 * Everything is priced in USDT because that is what Binance quotes. The rupee
 * conversion happens one layer up, against a rate that was actually paid, rather
 * than a rate invented here.
 */
async function pullPrices(assets) {
  const want = new Set(assets.map(a => String(a).toUpperCase()));
  if (!want.size) return {};
  try {
    const r = await fetch('https://api.binance.com/api/v3/ticker/price');
    if (!r.ok) throw new Error(String(r.status));
    const all = await r.json();
    const out = {};
    for (const t of (Array.isArray(all) ? all : [])) {
      const sym = String(t.symbol || '');
      if (!sym.endsWith('USDT')) continue;
      const base = sym.slice(0, -4);
      if (want.has(base)) out[base] = Number(t.price) || 0;
    }
    // A stablecoin has no XUSDT pair with itself.
    for (const st of ['USDT', 'FDUSD', 'USDC']) if (want.has(st)) out[st] = out[st] ?? 1;
    return out;
  } catch (e) {
    console.error('  · prices unavailable:', e.message);
    return {};
  }
}

async function pullEarn() {
  const out = new Map();
  const problems = [];
  for (const [label, path] of [
    ['flexible', '/sapi/v1/simple-earn/flexible/position'],
    ['locked', '/sapi/v1/simple-earn/locked/position'],
  ]) {
    try {
      const j = await get(path, { size: '100' });
      for (const r of (Array.isArray(j?.rows) ? j.rows : [])) {
        const asset = String(r.asset || '').toUpperCase();
        const qty = Number(r.totalAmount ?? r.amount ?? r.principal) || 0;
        if (!asset || qty <= 0) continue;
        out.set(asset, (out.get(asset) || 0) + qty);
      }
    } catch (e) {
      problems.push(`earn/${label}: ${e.message}`);
      console.error(`  · earn ${label} unavailable:`, e.message.slice(0, 120));
    }
  }
  return { staked: out, problems };
}

/**
 * Binance Convert — the "swap USDT for BTC" flow.
 *
 * NOT spot trades, and that distinction is the reason three assets have been
 * showing a held quantity with no cost behind them: this account acquired
 * everything it holds through converts, and nothing was reading them.
 *
 * The endpoint takes a 30-day window at most.
 */
async function pullConvert(days) {
  const rows = [];
  for (const w of windows(days, 30)) {
    const j = await get('/sapi/v1/convert/tradeFlow', { ...w, limit: '1000' });
    for (const c of (Array.isArray(j?.list) ? j.list : [])) {
      const pair = normalizeConvert(c);
      if (pair) rows.push(...pair);
    }
  }
  return rows;
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
    // NOT "repo secrets". That instruction outlived the workflow it belonged to:
    // the GitHub job was deleted because Binance answers 451 to American IPs, so
    // a key added there is a key nothing will ever read.
    const reason = `Binance is not connected yet — missing ${missing.join(', ')}. Put a READ-ONLY key (Enable Reading only; Spot Trading and Withdrawals off) in scripts/.binance.env and run scripts/binance-local.sh from your own machine — Binance refuses American IPs, so Actions and Vercel cannot do this.`;
    await reportStatus({ ok: false, configured: false, reason });
    console.log(reason);
    return;  // exit 0 on purpose.
  }

  // SINCE INCEPTION, by default.
  //
  // It was 120 days, which is fine for "what changed lately" and wrong for the
  // only question actually asked of this data: how much have I put in and how
  // much is it worth. A window that starts after the first buy reports a cost
  // basis for coins it never saw bought.
  //
  // The endpoints cap out around three years of history, so 'all' means that.
  // The cost is one 350ms-spaced call per window: roughly 90 calls, half a
  // minute, in a job nobody is waiting on.
  const days = String(BINANCE_LOOKBACK_DAYS).toLowerCase() === 'all'
    ? 1095
    : Math.max(1, Math.min(Number(BINANCE_LOOKBACK_DAYS) || 1095, 1095));
  const problems = [];

  let balances = [];
  let balanceSource = null;
  let balancesComplete = true;
  try {
    const b = await pullBalances();
    balances = b.rows;
    balanceSource = b.source;
    balancesComplete = b.complete;
    if (!b.complete) {
      // Not a failure — a partial answer, and the difference matters enough to
      // reach the dashboard rather than only this log.
      problems.push('balances are spot-only — Earn and staked holdings are not included (getUserAsset refused)');
    }
  } catch (e) { problems.push(`balances: ${e.message}`); console.error('  ✗', e.message); }

  // Each pull is isolated. P2P being unavailable — it is region-gated and can
  // 403 on some accounts — must not cost you the balances, which are the part
  // you look at daily.
  // Earn, folded into the balances as `staked`. Done after the balance pull so
  // it can repair exactly what the spot fallback cannot see.
  try {
    const earn = await pullEarn();
    problems.push(...earn.problems);
    if (earn.staked.size) {
      const by = new Map(balances.map(b => [b.asset, b]));
      for (const [asset, qty] of earn.staked) {
        const b = by.get(asset);
        if (b) { b.staked += qty; b.total += qty; }
        else { by.set(asset, { asset, free: 0, locked: 0, staked: qty, btcValue: 0, total: qty }); }
      }
      balances = [...by.values()].filter(b => b.total > 0).sort((a, b) => b.total - a.total);
      // Earn was read, so the spot-only caveat no longer applies.
      balancesComplete = true;
      const idx = problems.findIndex(p => p.startsWith('balances are spot-only'));
      if (idx >= 0) problems.splice(idx, 1);
      console.log(`  · Earn: ${earn.staked.size} asset(s) folded in`);
    }
  } catch (e) { problems.push(`earn: ${e.message}`); }

  let fresh = [];
  for (const [label, fn] of [['p2p', () => pullP2P(days)], ['convert', () => pullConvert(days)], ['capital', () => pullCapital(days)]]) {
    try { fresh.push(...await fn()); }
    catch (e) { problems.push(`${label}: ${e.message}`); console.error('  ✗', e.message); }
  }

  // Value it. Prices in USDT from the public ticker; the USDT/INR rate comes
  // from HIS OWN most recent P2P buy rather than a market rate looked up
  // somewhere, because that is the rate he actually got and it is already in the
  // ledger. Labelled as such downstream, so nobody reads it as a live FX quote.
  const prices = await pullPrices(keptBalances.map(b => b.asset));
  const valueUsdt = keptBalances.reduce((t, b) => t + b.total * (prices[b.asset] || 0), 0);
  const lastP2PBuy = [...merged]
    .filter(r => r.source === 'p2p' && r.kind === 'buy' && r.price > 0)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))[0];
  const inrPerUsdt = lastP2PBuy?.price || null;
  if (inrPerUsdt) console.log(`  · valuing at ₹${inrPerUsdt.toFixed(2)}/USDT (your last P2P rate, ${String(lastP2PBuy.at).slice(0, 10)})`);

  // Merge with what is already stored. The stored ledger is the long memory:
  // the lookback window only reaches back so far, and rows that fall out of it
  // must not fall out of the ledger — a buy from last year ageing out of the
  // window would silently reset the cost basis of everything bought since.
  const prev = (await memGet('binance_ledger')) || {};
  const merged = dedupeLedger([...(Array.isArray(prev.rows) ? prev.rows : []), ...fresh]);
  const pos = positions(merged);

  // BALANCES ARE KEPT WHEN THE FETCH FAILED.
  //
  // They were written unconditionally, so a run that could not reach Binance
  // stored `balances: []` over a good list — and the Crypto tab then rendered
  // "the account is empty, or the key cannot read it", which is a statement
  // about what Neel owns, made out of a network error. That is exactly what
  // happened on 2026-08-08 and it read as fact for a month.
  //
  // Rows already survive this way (the merge above), for the same reason. This
  // makes balances match.
  const balancesFailed = problems.some(p => p.startsWith('balances:'));
  const keptBalances = balancesFailed && Array.isArray(prev.balances) && prev.balances.length
    ? prev.balances
    : balances;
  if (balancesFailed && keptBalances !== balances) {
    console.error(`  · keeping ${keptBalances.length} previously-known balance(s) rather than storing an empty list`);
  }

  await memPut('binance_ledger', {
    rows: merged,
    positions: pos,
    balances: keptBalances,
    balanceSource,
    balancesComplete,
    // The one question answerable across a whole account: rupees in, rupees out.
    // Not valued here — pricing is the app's job, and this file has no INR rate
    // it did not make up.
    prices,
    inrPerUsdt,
    valueUsdt,
    summary: sinceInception(merged, { valueNow: inrPerUsdt && valueUsdt ? valueUsdt * inrPerUsdt : null }),
    // Said out loud in the blob, so a reader can tell "these numbers are from an
    // earlier run" from "these numbers are current".
    balancesStale: balancesFailed,
    lookbackDays: days,
    updated: new Date().toISOString(),
  });

  console.log(`${balances.length} asset(s) held via ${balanceSource || 'nothing'}${balancesComplete ? '' : ' (spot only — no Earn)'} · ${merged.length} ledger row(s) (${fresh.length} fetched this run) · ${pos.length} position(s)`);
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
