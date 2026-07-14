// Autonomous US-stock price updater — runs on GitHub Actions (full network),
// no Mac needed. Reads the held tickers from Supabase, fetches live prices from
// Yahoo Finance's public chart API, writes last_price back. Holdings themselves
// come from the INDmoney browser snapshot; this only refreshes prices.
//
// Env (GitHub Secrets): SUPABASE_URL, SUPABASE_SERVICE_KEY

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { console.error('Missing Supabase env'); process.exit(1); }

const H = { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' };
const rest = (p, init = {}) => fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${p}`, { ...init, headers: { ...H, ...(init.headers || {}) } });

// INDmoney/Amizone ticker -> Yahoo symbol quirks
const yahooSymbol = t => t.replace('.', '-'); // BRK.B -> BRK-B

async function price(ticker) {
  const sym = yahooSymbol(ticker);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=1d`;
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error(`${ticker}: ${r.status}`);
  const j = await r.json();
  const p = j?.chart?.result?.[0]?.meta?.regularMarketPrice;
  if (typeof p !== 'number') throw new Error(`${ticker}: no price`);
  return p;
}

async function run() {
  const holdings = await (await rest('investments?select=id,ticker&qty=gt.0')).json();
  if (!Array.isArray(holdings) || !holdings.length) { console.log('No holdings.'); return; }
  const uniq = [...new Set(holdings.map(h => h.ticker))];
  const prices = {};
  for (const t of uniq) {
    try { prices[t] = await price(t); console.log(`${t} = ${prices[t]}`); }
    catch (e) { console.error('skip', e.message); }
    await new Promise(r => setTimeout(r, 400)); // be gentle
  }
  let updated = 0;
  for (const h of holdings) {
    if (prices[h.ticker] == null) continue;
    const r = await rest(`investments?id=eq.${h.id}`, { method: 'PATCH', body: JSON.stringify({ last_price: prices[h.ticker], updated_at: new Date().toISOString() }) });
    if (r.ok) updated++;
  }
  // stamp a heartbeat
  await rest('memory', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify([{ key: 'prices_last_sync', value: { at: new Date().toISOString(), updated, tickers: uniq.length }, updated_at: new Date().toISOString() }]) });
  console.log(`Updated ${updated} rows across ${uniq.length} tickers.`);
}

run().catch(e => { console.error(e); process.exit(1); });
