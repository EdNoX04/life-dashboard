// Autonomous price updater — runs on GitHub Actions (full network), no Mac
// needed. Reads the held tickers from Supabase, fetches live prices from Yahoo
// Finance's public chart API, writes last_price back. Holdings themselves come
// from the INDmoney snapshot; this only refreshes prices.
//
// WHAT WAS BROKEN, AND HOW LONG IT LOOKED FINE
//
// This asked Yahoo for `GOLDBEES`. The NSE symbol there is `GOLDBEES.NS`, so
// every run since the holding was added threw "no price", hit the catch, logged
// `skip`, and carried on to print "Updated 19 rows across 20 tickers" — a
// success line with a failure inside it. GOLDBEES' last_price sat at 124.58
// from 10 August while every US ticker updated nightly.
//
// A ticker that cannot be priced is now a FAILURE: it is named, recorded in
// memory.prices_last_sync and reported into sync_status, and the job exits
// non-zero. The whole point of the sync channel is that a stopped sync is
// invisible by nature.
//
// Env (GitHub Secrets): SUPABASE_URL, SUPABASE_SERVICE_KEY

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { console.error('Missing Supabase env'); process.exit(1); }

const H = { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' };
const rest = (p, init = {}) => fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${p}`, { ...init, headers: { ...H, ...(init.headers || {}) } });

// The one list of rupee tickers, shared with the app rather than copied. A
// second copy here is how the app and the sync would come to disagree about
// what GOLDBEES is, which is a worse bug than the one being fixed.
import { KNOWN_INR_TICKERS } from '../src/lib/indiabook.js';

// Yahoo symbol candidates, tried in order. Written as a LIST rather than one
// mapping because the exact suffix for an NSE listing is the thing that was
// wrong before: if .NS misses, .BO is tried, and if both miss the ticker is
// reported rather than quietly skipped.
function candidates(ticker) {
  const t = String(ticker).toUpperCase();
  if (KNOWN_INR_TICKERS.has(t)) return [`${t}.NS`, `${t}.BO`];
  return [ticker.replace('.', '-')]; // BRK.B -> BRK-B
}

async function quote(sym) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=1d`;
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) return null;
  const m = (await r.json())?.chart?.result?.[0]?.meta;
  return typeof m?.regularMarketPrice === 'number'
    ? { price: m.regularMarketPrice, currency: m.currency || null, symbol: m.symbol || sym }
    : null;
}

async function price(ticker) {
  const tried = [];
  for (const sym of candidates(ticker)) {
    tried.push(sym);
    const q = await quote(sym);
    if (q) return q;
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`${ticker}: no price from ${tried.join(' or ')}`);
}

/** USD->INR, so a rupee holding can enter a dollar total as dollars. */
async function usdInr() {
  const q = await quote('USDINR=X');
  return q?.price ?? null;
}

async function run() {
  const holdings = await (await rest('investments?select=id,ticker&qty=gt.0')).json();
  if (!Array.isArray(holdings) || !holdings.length) { console.log('No holdings.'); return; }
  const uniq = [...new Set(holdings.map(h => h.ticker))];
  const prices = {};
  const failed = [];
  for (const t of uniq) {
    try {
      const q = await price(t);
      prices[t] = q.price;
      console.log(`${t} = ${q.price} ${q.currency || ''} (${q.symbol})`);
    } catch (e) {
      failed.push(t);
      console.error('FAIL', e.message);
    }
    await new Promise(r => setTimeout(r, 400)); // be gentle
  }
  let updated = 0;
  for (const h of holdings) {
    if (prices[h.ticker] == null) continue;
    const r = await rest(`investments?id=eq.${h.id}`, { method: 'PATCH', body: JSON.stringify({ last_price: prices[h.ticker], updated_at: new Date().toISOString() }) });
    if (r.ok) updated++;
  }
  // Record a daily portfolio value snapshot (for the value-over-time chart).
  //
  // TWO BUGS LIVED IN THE OLD FILTER, `source=eq.indmoney`.
  //
  // First, no row has that source. They read `manual` and
  // `indmoney-mcp-2026-08-08`, so the query returned nothing and the snapshot
  // silently stopped being written on 2026-08-07 — the chart has been frozen
  // for a month while still rendering, which is the failure mode this codebase
  // keeps running into: stale that looks identical to current.
  //
  // Second, it summed qty x price across currencies. GOLDBEES is priced in
  // rupees, so once it was included ₹127 would have entered a dollar total as
  // $127 — the exact bug portfolioTotals() was written to fix on the app side.
  // The rate is fetched and the INR legs converted; if the rate is unavailable
  // the snapshot is SKIPPED rather than written wrong.
  try {
    const holds = await (await rest('investments?select=ticker,qty,avg_cost,last_price&qty=gt.0')).json();
    const needFx = (holds || []).some(h => KNOWN_INR_TICKERS.has(String(h.ticker).toUpperCase()));
    const fx = needFx ? await usdInr() : 1;
    if (needFx && !fx) throw new Error('no USD/INR rate — refusing to add rupees to dollars');
    const toUsd = h => (KNOWN_INR_TICKERS.has(String(h.ticker).toUpperCase()) ? 1 / fx : 1);
    if (Array.isArray(holds) && holds.length) {
      const val = holds.reduce((s, h) => s + Number(h.qty) * Number(h.last_price || h.avg_cost || 0) * toUsd(h), 0);
      const cost = holds.reduce((s, h) => s + Number(h.qty) * Number(h.avg_cost || 0) * toUsd(h), 0);
      const today = new Date().toISOString().slice(0, 10);
      // one row per day: delete today's then insert
      await rest(`portfolio_snapshots?date=eq.${today}`, { method: 'DELETE' });
      await rest('portfolio_snapshots', { method: 'POST', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify([{ date: today, total_value: Math.round(val * 100) / 100, total_cost: Math.round(cost * 100) / 100 }]) });
    }
  } catch (e) { console.error('snapshot skip', e.message); }

  // Stamp a heartbeat — including what FAILED. "19 of 20" with no name attached
  // is how one unpriceable ticker hid for a month.
  const health = { at: new Date().toISOString(), updated, tickers: uniq.length, failed };
  await rest('memory', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify([{ key: 'prices_last_sync', value: health, updated_at: new Date().toISOString() }]) });

  // And into sync_status, which the app's `sync` notification channel watches.
  try {
    const rows = await (await rest('memory?key=eq.sync_status&select=value')).json();
    await rest('memory', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify([{
        key: 'sync_status',
        value: {
          ...(rows?.[0]?.value || {}),
          prices: {
            ok: failed.length === 0, at: health.at,
            reason: failed.length ? `no price for ${failed.join(', ')}` : `${updated} of ${uniq.length} tickers priced`,
          },
        },
        updated_at: new Date().toISOString(),
      }]) });
  } catch (e) { console.error('status skip', e.message); }

  console.log(`Updated ${updated} rows across ${uniq.length} tickers.`);
  if (failed.length) {
    console.error(`FAILED to price: ${failed.join(', ')}`);
    process.exitCode = 1;
  }
}

run().catch(e => { console.error(e); process.exit(1); });
