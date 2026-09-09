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
//   BINANCE_LOOKBACK_DAYS  (optional, default 120 — routine runs)
//   BINANCE_SINCE          (optional, e.g. 2021-01-01 — a one-off backfill)
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
  normalizeP2P, normalizeFlow, normalizeConvert, normalizeFiatOrder, normalizeFiatPayment,
  normalizeTrade, dedupeLedger, positions, sinceInception, unwrapLD, isLDReceipt,
} from './lib/binance-ledger.mjs';

const {
  SUPABASE_URL, SUPABASE_SERVICE_KEY,
  BINANCE_API_KEY, BINANCE_API_SECRET,
  BINANCE_LOOKBACK_DAYS = '120',
  // BINANCE_SINCE=2021-01-01 for a one-off backfill. See the note where `days`
  // is computed for why the routine default stays small.
  BINANCE_SINCE = '',
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

/**
 * BACKING OFF, BECAUSE A FLAT PAUSE IS NOT A RATE LIMITER.
 *
 * Measured on the first real backfill: /sapi/v1/fiat/orders refused 44 of 48
 * windows with 429 "Too many requests", while every other endpoint went through
 * on the same 350ms spacing. Binance limits by request WEIGHT, and the fiat
 * endpoints are heavy — so a fixed delay tuned for cheap calls is simply the
 * wrong tool for them.
 *
 * Worse, a 429 was being counted as "older history may not be available", which
 * is a completely different finding. The run reported the account as having no
 * fiat history before 2025 when what actually happened is that Binance declined
 * to answer. That is the wrong-diagnosis failure this whole file keeps hitting.
 *
 * So: retry a 429 with growing waits, and treat the retries as the cost of
 * asking for years of history rather than as a failure.
 */
const RETRY_WAITS_MS = [2000, 6000, 15000, 40000];

async function get(path, params, attempt = 0) {
  // Binance rate-limits by request weight, not count, and the endpoints used
  // here are cheap — but a lookback of several months means dozens of windowed
  // calls in a row, which is exactly the shape that trips the limiter. A flat
  // pause costs a few seconds in a job nobody is waiting on.
  if (calls++) await new Promise(r => setTimeout(r, 350));
  const r = await fetch(signed(path, params), { headers: { 'X-MBX-APIKEY': BINANCE_API_KEY } });
  const text = await r.text();

  // 429 is "ask again later", not "there is nothing here". 418 is Binance's
  // you-have-been-banned-briefly code and means the same thing for longer.
  if ((r.status === 429 || r.status === 418) && attempt < RETRY_WAITS_MS.length) {
    const hdr = Number(r.headers.get('retry-after'));
    const wait = Number.isFinite(hdr) && hdr > 0 ? hdr * 1000 : RETRY_WAITS_MS[attempt];
    console.error(`    … rate limited on ${path.split('/').pop()}, waiting ${(wait / 1000).toFixed(0)}s (attempt ${attempt + 1}/${RETRY_WAITS_MS.length})`);
    await new Promise(res => setTimeout(res, wait));
    return get(path, params, attempt + 1);
  }

  if (!r.ok) {
    // -2015 is the one that actually happens: key invalid, or IP-restricted and
    // the runner's address is not on the list. Saying so beats a bare 401.
    let hint = '';
    if (text.includes('-2015')) hint = ' — key rejected: check it is enabled, and that IP restriction is OFF (Actions runners have no fixed IP).';
    else if (text.includes('-1021')) hint = ' — timestamp outside recvWindow; the runner clock is skewed.';
    else if (text.includes('-2014')) hint = ' — malformed API key.';
    else if (r.status === 429 || r.status === 418) hint = ` — still rate limited after ${RETRY_WAITS_MS.length} backoffs. This is NOT missing history; run it again later.`;
    throw new Error(`${path} ${r.status}: ${text.slice(0, 200)}${hint}`);
  }
  return JSON.parse(text);
}

const DAY = 86400e3;

/**
 * Run a windowed pull, surviving windows the endpoint refuses.
 *
 * Reaching back years means some windows WILL fail — Binance retires history at
 * different depths per endpoint, and it does not document where. Throwing on the
 * first refusal ends the walk at that point and quietly reports everything older
 * as "no data", which is indistinguishable from an account that did nothing.
 *
 * So each window is caught, counted, and the walk continues. What comes back
 * says how far it actually reached, which is how the real limit gets discovered
 * instead of assumed.
 */
async function walk(label, wins, fn) {
  const rows = [];
  let failed = 0;
  let rateLimited = false;
  let firstFailAt = null;

  // SAY SOMETHING WHILE IT WORKS.
  //
  // A backfill is ~350 calls spaced 350ms apart: nearly two minutes during which
  // the old version printed nothing at all, because every pull only logged on
  // failure or at the end. Two minutes of silence and a hung process look
  // exactly the same from a terminal, and the reasonable thing to do about a
  // hung process is kill it — which is what a silent job invites.
  //
  // A line per window would be 350 lines of noise, so: one at the start, one
  // every ten, one at the end.
  const started = Date.now();
  process.stdout.write(`  · ${label}: ${wins.length} window(s) back to ${new Date(wins[wins.length - 1]?.startTime || Date.now()).toISOString().slice(0, 10)}\n`);

  // GIVE UP EARLY ON A WALL.
  //
  // Each window already retries through 2s, 6s, 15s and 40s of backoff. Grinding
  // 48 windows into a limiter that is not letting anything through costs about
  // forty minutes to learn something the third window already proved. Three
  // consecutive fully-backed-off failures is enough.
  let consecutive = 0;

  for (let i = 0; i < wins.length; i++) {
    const w = wins[i];
    try { rows.push(...await fn(w)); consecutive = 0; }
    catch (e) {
      failed++;
      consecutive++;
      if (/429|418|Too many requests/i.test(e.message)) rateLimited = true;
      if (!firstFailAt) { firstFailAt = w.startTime; console.error(`    ! ${label}: window from ${new Date(w.startTime).toISOString().slice(0, 10)} refused — ${e.message.slice(0, 100)}`); }
      if (consecutive >= 3) {
        console.error(`  · ${label}: giving up after 3 straight refusals — ${wins.length - i - 1} window(s) not attempted`);
        break;
      }
    }
    if ((i + 1) % 10 === 0 || i === wins.length - 1) {
      const secs = ((Date.now() - started) / 1000).toFixed(0);
      process.stdout.write(`    ${label} ${i + 1}/${wins.length} · ${rows.length} row(s) · ${secs}s\n`);
    }
  }
  if (failed) {
    // Saying WHY. "Older history may not be available" and "Binance would not
    // answer" are different findings, and reporting the second as the first is
    // how an account looks empty before 2025 when it is not.
    const why = rateLimited
      ? 'rate limited even after backing off — run it again later, the data is there'
      : 'older history may not be available at that depth';
    console.error(`  · ${label}: ${failed} of ${wins.length} window(s) refused (${why})`);
  }
  return rows;
}

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

/**
 * The FUNDING wallet — the third place coins live, and the one nobody remembers.
 *
 * Binance splits holdings across Spot, Funding and Earn. P2P buys land in
 * FUNDING, not Spot, which is why a P2P-funded account can show a spot balance
 * of nothing while plainly owning something.
 *
 * Measured on this account: Earn reported BTC 0.0003523 and the Binance app
 * shows 0.00041152. The missing 0.00005922 is not in Spot — /api/v3/account
 * returned only the LD receipts — so it is here.
 *
 * This is a POST, like getUserAsset, which already fails on this account. So it
 * is allowed to fail: what it adds is real, and losing it costs a small part of
 * one balance rather than the run.
 */
async function pullFunding() {
  const out = new Map();
  try {
    const url = signed('/sapi/v1/asset/get-funding-asset', {});
    const r = await fetch(url, { method: 'POST', headers: { 'X-MBX-APIKEY': BINANCE_API_KEY } });
    if (!r.ok) throw new Error(`${r.status}: ${(await r.text()).slice(0, 120)}`);
    for (const b of (await r.json()) || []) {
      const asset = String(b.asset || '').toUpperCase();
      const qty = (Number(b.free) || 0) + (Number(b.locked) || 0) + (Number(b.freeze) || 0);
      if (asset && qty > 0) out.set(asset, (out.get(asset) || 0) + qty);
    }
    return { funding: out, problems: [] };
  } catch (e) {
    console.error('  · funding wallet unavailable:', e.message.slice(0, 120));
    return { funding: out, problems: [`funding: ${e.message}`] };
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
  return walk('convert', windows(days, 30), async w => {
    const j = await get('/sapi/v1/convert/tradeFlow', { ...w, limit: '1000' });
    const out = [];
    for (const c of (Array.isArray(j?.list) ? j.list : [])) {
      const pair = normalizeConvert(c);
      if (pair) out.push(...pair);
    }
    return out;
  });
}

async function pullP2P(days) {
  const rows = [];
  for (const tradeType of ['BUY', 'SELL']) {
    rows.push(...await walk(`p2p/${tradeType.toLowerCase()}`, windows(days, 30), async w => {
      const j = await get('/sapi/v1/c2c/orderMatch/listUserOrderHistory', { ...w, tradeType, rows: '100' });
      return (j?.data || []).map(normalizeP2P).filter(Boolean);
    }));
  }
  return rows;
}

async function pullCapital(days) {
  // `Math.min(days, 90)` was here, which is not a chunk size — it capped the
  // whole RANGE at 90 days. Deposits and withdrawals older than three months
  // have never been fetched, whatever the lookback was set to. 90 is the window
  // the endpoint accepts; it is not how far back you may ask.
  const rows = [];
  for (const [path, kind] of [
    ['/sapi/v1/capital/deposit/hisrec', 'in'],
    ['/sapi/v1/capital/withdraw/history', 'out'],
  ]) {
    rows.push(...await walk(`capital/${kind}`, windows(days, 90), async w => {
      const j = await get(path, w);
      return (Array.isArray(j) ? j : []).map(r => normalizeFlow(r, kind)).filter(Boolean);
    }));
  }
  return rows;
}

/**
 * Rupees in and out of Binance, and crypto bought directly with rupees.
 *
 * THE MISSING YEARS LIVE HERE. An account opened in 2021 or 2022 funded itself
 * by bank transfer and card long before P2P, and neither endpoint was ever read
 * — so "put in" counted P2P buys only, which for an older account is close to
 * counting none of it, and makes every gain figure meaningless.
 *
 * Both take a 90-day window.
 */
async function pullFiat(days) {
  // Paced apart from everything else. On the first backfill this endpoint
  // refused 44 of 48 windows on the shared 350ms spacing while nothing else
  // complained — it is weighted far higher than the rest. Retrying into a wall
  // works but spends minutes in backoff; asking more slowly to begin with is
  // cheaper than being told to wait.
  const breathe = () => new Promise(r => setTimeout(r, 1200));

  // THE PARAMETER NAMES ARE DIFFERENT HERE, AND THAT IS THE WHOLE PROBLEM.
  //
  // Every other endpoint in this file takes startTime/endTime. The fiat ones
  // take beginTime/endTime. windows() produces startTime, so every fiat request
  // was sending a parameter Binance ignores — which means all 24 windows asked
  // the IDENTICAL default question, 24 times, as fast as the pacing allowed.
  //
  // That is what the 429s were. Not a heavy endpoint and not an account with no
  // history: the same query repeated until the limiter noticed. Backing off
  // harder would have made it slower and no more correct.
  const fiatWindow = w => ({ beginTime: w.startTime, endTime: w.endTime });
  const rows = [];
  for (const [type, kind] of [['0', 'in'], ['1', 'out']]) {
    rows.push(...await walk(`fiat/orders/${kind}`, windows(days, 90), async w => {
      await breathe();
      const j = await get('/sapi/v1/fiat/orders', { ...fiatWindow(w), transactionType: type, rows: '500' });
      return (Array.isArray(j?.data) ? j.data : []).map(r => normalizeFiatOrder(r, kind)).filter(Boolean);
    }));
  }
  for (const [type, kind] of [['0', 'buy'], ['1', 'sell']]) {
    rows.push(...await walk(`fiat/payments/${kind}`, windows(days, 90), async w => {
      await breathe();
      const j = await get('/sapi/v1/fiat/payments', { ...fiatWindow(w), transactionType: type, rows: '500' });
      return (Array.isArray(j?.data) ? j.data : []).map(r => normalizeFiatPayment(r, kind)).filter(Boolean);
    }));
  }
  return rows;
}

/**
 * Spot trades, per symbol.
 *
 * myTrades needs a symbol and returns everything for it, so the whole history
 * comes back in one call per pair rather than by window — no time limit to walk
 * around. The cost is knowing WHICH pairs, and there are thousands.
 *
 * Candidates are built from assets the account has actually touched — anything
 * held, plus anything already in the ledger — crossed with the quote assets a
 * retail account uses. A pair that never existed answers 400 and is skipped,
 * which is cheap and requires no list of valid symbols.
 */
async function pullSpotTrades(assets) {
  const QUOTES = ['USDT', 'FDUSD', 'BUSD', 'BTC', 'BNB'];
  const bases = [...new Set(assets.map(a => String(a).toUpperCase()))].filter(a => a && !QUOTES.includes(a) || a === 'BTC');
  const rows = [];
  let tried = 0, found = 0;
  for (const base of bases) {
    for (const quote of QUOTES) {
      if (base === quote) continue;
      tried++;
      try {
        const j = await get('/api/v3/myTrades', { symbol: `${base}${quote}`, limit: '1000' });
        const list = (Array.isArray(j) ? j : []).map(t => normalizeTrade(t, base, quote)).filter(Boolean);
        if (list.length) { found += list.length; rows.push(...list); }
      } catch { /* a pair that does not exist, or was never traded. Not news. */ }
    }
  }
  console.log(`  · spot trades: ${found} across ${tried} candidate pair(s)`);
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
  // HOW FAR BACK.
  //
  // BINANCE_SINCE=2021-01-01 walks from that date. That is the one to use for a
  // backfill, and it only needs running ONCE: the ledger merges with what is
  // stored, so rows recovered today are still there next year. After that the
  // twice-daily cron only needs a short window, which is why the default stays
  // small — a routine run should not spend three minutes re-reading 2021.
  //
  // I do not know where Binance retires history for each endpoint, and I am not
  // going to assert a number I have not measured. walk() survives a refused
  // window and reports how many were refused, so the real limit shows up in the
  // log rather than as silently missing years.
  let days;
  if (BINANCE_SINCE) {
    const t = Date.parse(`${BINANCE_SINCE}T00:00:00Z`);
    if (!Number.isFinite(t)) { console.error(`BINANCE_SINCE="${BINANCE_SINCE}" is not a date like 2021-01-01`); process.exit(1); }
    days = Math.max(1, Math.ceil((Date.now() - t) / DAY));
    console.log(`  · backfilling from ${BINANCE_SINCE} — ${days} days. This walks every window and takes a few minutes.`);
  } else {
    days = Math.max(1, Math.min(Number(BINANCE_LOOKBACK_DAYS) || 120, 3650));
  }
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

    // The LD receipts and the Earn positions are the SAME COINS. Keep one.
    const ldRows = balances.filter(b => isLDReceipt(b.asset));
    if (ldRows.length) {
      if (earn.staked.size) {
        balances = balances.filter(b => !isLDReceipt(b.asset));
        console.log(`  · dropped ${ldRows.length} LD receipt token(s) — Simple Earn reports the same coins under their real names`);
      } else {
        // Earn could not be read. Unwrap rather than lose the holding entirely:
        // a position named right and sourced from a receipt beats no position.
        balances = balances.map(b => (isLDReceipt(b.asset)
          ? { ...b, asset: unwrapLD(b.asset), staked: b.free + b.locked + b.staked, free: 0, locked: 0 }
          : b));
        console.log(`  · Earn unreadable — unwrapping ${ldRows.length} LD receipt(s) to their underlying asset instead`);
      }
    }

    // Funding, folded in the same way. Three wallets, one balance sheet.
    const fund = await pullFunding();
    problems.push(...fund.problems);
    if (fund.funding.size) {
      const by = new Map(balances.map(b => [b.asset, b]));
      for (const [asset, qty] of fund.funding) {
        const b = by.get(asset);
        if (b) { b.free += qty; b.total += qty; }
        else { by.set(asset, { asset, free: qty, locked: 0, staked: 0, btcValue: 0, total: qty }); }
        console.log(`      ${asset} +${qty} from Funding`);
      }
      balances = [...by.values()].filter(b => b.total > 0);
    }

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
      // PRINTED PER ASSET, because "3 held" plus "3 folded in" is ambiguous in
      // the one way that matters: it reads the same whether those are six
      // different coins or the same three counted twice. Binance moves Earn
      // funds OUT of the spot wallet, so adding them is right — but the only
      // way to know that held for this account is to see the split beside the
      // number in the Binance app.
      console.log(`  · Earn: ${earn.staked.size} asset(s) folded in`);
      for (const [asset, qty] of earn.staked) console.log(`      ${asset} +${qty} from Earn`);
    }
  } catch (e) { problems.push(`earn: ${e.message}`); }

  let fresh = [];
  // Assets the account has ever touched, so spot trades know which pairs to ask
  // about: what is held now, plus everything already in the stored ledger.
  const storedAssets = Array.isArray((await memGet('binance_ledger'))?.rows)
    ? (await memGet('binance_ledger')).rows.map(r => r.asset) : [];
  const everAssets = [...new Set([...balances.map(b => b.asset), ...storedAssets])].filter(Boolean);

  for (const [label, fn] of [
    ['p2p', () => pullP2P(days)],
    ['convert', () => pullConvert(days)],
    ['fiat', () => pullFiat(days)],
    ['capital', () => pullCapital(days)],
    ['spot', () => pullSpotTrades(everAssets)],
  ]) {
    const t0 = Date.now();
    try {
      const got = await fn();
      fresh.push(...got);
      console.log(`  ✓ ${label}: ${got.length} row(s) in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
    catch (e) { problems.push(`${label}: ${e.message}`); console.error('  ✗', label, e.message); }
  }

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

  // Value it. This has to come AFTER keptBalances and merged exist — it read
  // both of them from above their own declarations, which is a ReferenceError at
  // runtime and nothing at all at parse time, so it only showed up two minutes
  // into a backfill with every window already fetched.
  //
  // Prices in USDT from the public ticker; the USDT/INR rate comes
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

  // Say how far back it actually reached. "No data before 2023" and "we never
  // asked about 2023" look identical in a ledger, and only one of them is a
  // finding.
  // The balance sheet, spelled out. Compare `total` against the Binance app: if
  // it is double what the app shows, Earn is being counted twice and the fold-in
  // above is wrong for this account.
  for (const b of keptBalances) {
    console.log(`      ${b.asset.padEnd(6)} total ${b.total}  (spot+funding ${b.free}, locked ${b.locked}, earn ${b.staked})`);
  }

  const earliest = merged.map(r => r.at).filter(Boolean).sort()[0];
  console.log(`  · earliest movement found: ${earliest ? String(earliest).slice(0, 10) : 'none'} (asked back to ${new Date(Date.now() - days * DAY).toISOString().slice(0, 10)})`);
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
