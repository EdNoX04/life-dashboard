// Autonomous morning brief + news — runs on GitHub Actions (no device, no Cowork
// provenance gate). Reads the dashboard's own Supabase data with the service key,
// pulls fresh market/tech headlines (Finnhub if FINNHUB_KEY is set, else keyless
// Google News RSS), composes a templated brief, and writes `briefs` + `news`.
//
// Env (GitHub Secrets): SUPABASE_URL, SUPABASE_SERVICE_KEY, [FINNHUB_KEY optional]

const { SUPABASE_URL, SUPABASE_SERVICE_KEY, FINNHUB_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { console.error('Missing Supabase env'); process.exit(1); }

const H = { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' };
const rest = (p, init = {}) => fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${p}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
const getJSON = async p => { try { const r = await rest(p); return r.ok ? await r.json() : []; } catch { return []; } };

// ---- IST "today" ----
const ist = new Date(Date.now() + 5.5 * 3600 * 1000);
const z = n => String(n).padStart(2, '0');
const todayISO = `${ist.getUTCFullYear()}-${z(ist.getUTCMonth() + 1)}-${z(ist.getUTCDate())}`;
const weekday = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][ist.getUTCDay()];
const istDateOf = iso => { try { const d = new Date(new Date(iso).getTime() + 5.5 * 3600 * 1000); return `${d.getUTCFullYear()}-${z(d.getUTCMonth() + 1)}-${z(d.getUTCDate())}`; } catch { return ''; } };
const money = n => '$' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });

const ETF = new Set(['QQQ', 'QQQM', 'SCHD', 'SPMO', 'VOO', 'SPY', 'VTI', 'GLD']);

// CURRENCY. This script summed `qty × last_price` across the whole book with no
// conversion at all, which meant a GOLDBEES position worth about fifteen dollars
// entered the brief as one thousand four hundred and seventy-nine — and the brief
// then sorted by that same number and announced GOLDBEES as the second largest
// holding. The portfolio line read $7,716 against the app's own $6,237, and both
// looked equally plausible because a rupee and a dollar are the same digits once
// the symbol is gone.
//
// The app already knows which holdings are rupee-priced; this is that list, kept
// here because a cron script cannot import a browser module. It matches
// KNOWN_INR_TICKERS in src/lib/indiabook.js — if one gains an entry, so must the
// other, which is why they are named after each other.
const INR_TICKERS = new Set([
  'GOLDBEES', 'NIFTYBEES', 'JUNIORBEES', 'BANKBEES', 'LIQUIDBEES', 'SILVERBEES',
  'SETFGOLD', 'HDFCGOLD', 'GOLDSHARE', 'MON100', 'MAFANG',
]);
const isInr = h => String(h?.currency || '').toUpperCase() === 'INR'
  || INR_TICKERS.has(String(h?.ticker || '').toUpperCase());

// A rupee holding with no rate is EXCLUDED and counted, never converted at 1.0.
// A total that has quietly absorbed one looks exactly like a correct total —
// which is precisely how this went unnoticed.
async function usdInr() {
  try {
    const r = await fetch('https://api.frankfurter.app/latest?from=USD&to=INR');
    const j = await r.json();
    const v = Number(j?.rates?.INR);
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch { return null; }
}

import {
  parseRss, dedupe, balance, cleanSummary, countByCategory,
} from './lib/newsfeed.mjs';

async function fetchNews(tickers = []) {
  const items = [];
  // Preferred: Finnhub COMPANY news for the stocks you actually own (most relevant)
  if (FINNHUB_KEY) {
    const from = `${new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10)}`;
    const to = new Date().toISOString().slice(0, 10);
    for (const t of tickers.filter(x => !ETF.has(x)).slice(0, 10)) {
      try {
        const r = await fetch(`https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(t.replace('-', '.'))}&from=${from}&to=${to}&token=${FINNHUB_KEY}`);
        if (!r.ok) continue;
        const arr = await r.json();
        for (const n of (Array.isArray(arr) ? arr : []).slice(0, 2)) {
          // The [TICKER] prefix stays in the stored title - splitTicker parses
          // it back out in the UI - so that "which stock is this about" is
          // answerable without adding a column to the news table.
          if (n.headline && n.url) items.push({ title: `[${t}] ${n.headline}`, url: n.url, source: n.source || 'Finnhub', category: 'stocks', summary: cleanSummary(n.summary, n.headline, 220), published_at: new Date((n.datetime || 0) * 1000 || Date.now()).toISOString() });
        }
      } catch (e) { console.error('company-news', t, e.message); }
    }
    // a little general market context too
    try {
      const r = await fetch(`https://finnhub.io/api/v1/news?category=general&token=${FINNHUB_KEY}`);
      const arr = await r.json();
      for (const n of (Array.isArray(arr) ? arr : []).slice(0, 3)) {
        // Filed as finance, not stocks. This is general market news about
        // nobody's particular holding - miscategorising it as 'stocks' is what
        // left the Finance tab with literally nothing in it.
        items.push({ title: n.headline, url: n.url, source: n.source || 'Finnhub', category: 'finance', summary: cleanSummary(n.summary, n.headline, 240), published_at: new Date((n.datetime || 0) * 1000 || Date.now()).toISOString() });
      }
    } catch (e) { console.error('finnhub general', e.message); }
  }
  // Keyless fallback / supplement: Google News RSS (works from Actions, no key)
  const rss = async (q, category) => {
    try {
      const r = await fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`);
      // parseRss reads the <description> the old inline parser ignored, which
      // is why every RSS-sourced headline used to arrive with summary: ''.
      items.push(...parseRss(await r.text(), category, Date.now()).slice(0, 8));
    } catch (e) { console.error('rss', q, e.message); }
  };

  // Both of these run unconditionally now. The finance search used to be
  // gated behind `if (items.length < 4)`, so on any day Finnhub returned
  // results - which is every day the key works - it never ran at all.
  await rss('stock market finance economy', 'finance');
  await rss('technology AI', 'tech');
  // A thin stocks list is topped up rather than left short.
  if (items.filter(n => n.category === 'stocks').length < 3) {
    await rss('stock market movers earnings', 'stocks');
  }

  const out = balance(dedupe(items), 8);
  console.log('news by category:', JSON.stringify(countByCategory(out)));
  return out;
}

async function run() {
  // ---- reads ----
  const [todos, timetable, subjects, investments, calMem] = await Promise.all([
    getJSON('todos?select=title,due_date,completed&completed=eq.false'),
    getJSON(`timetable?select=subject,room,start_time,end_time,day&day=eq.${weekday}&order=start_time.asc`),
    getJSON('subjects?select=name,attendance_pct'),
    getJSON('investments?select=ticker,qty,avg_cost,last_price&qty=gt.0'),
    getJSON('memory?key=eq.calendar_events'),
  ]);
  const calEvents = calMem?.[0]?.value?.events || [];
  const heldTickers = investments.filter(h => Number(h.qty) > 0).map(h => h.ticker);
  const news = await fetchNews(heldTickers);

  // ---- compose sections ----
  const sections = [];

  const due = todos.filter(t => t.due_date && t.due_date <= todayISO).slice(0, 6);
  sections.push({ title: 'Priorities', body: due.length ? due.map(t => `• ${t.title}${t.due_date < todayISO ? ' (overdue)' : ''}`).join('\n') : 'Nothing due today — clear runway.' });

  const todayEvents = calEvents.filter(e => e.start && istDateOf(e.start) === todayISO)
    .map(e => ({ t: e.allDay ? 'All day' : new Date(new Date(e.start).getTime() + 5.5 * 3600 * 1000).toISOString().slice(11, 16), title: e.summary || '(event)', loc: e.location || '' }));
  const classLines = timetable.map(c => `• ${c.start_time}–${c.end_time}  ${c.subject}${c.room ? ` · ${c.room}` : ''}`);
  const evLines = todayEvents.map(e => `• ${e.t}  ${e.title}${e.loc ? ` · ${e.loc}` : ''}`);
  const sched = [...classLines, ...evLines];
  sections.push({ title: `Schedule — ${weekday}`, body: sched.length ? sched.join('\n') : 'No classes or events today.' });

  const held = investments.filter(h => Number(h.qty) > 0);
  const fx = await usdInr();
  const dropped = [];
  // Every figure below is in DOLLARS, converted once, per holding, using the
  // holding's own currency — not the book's, because the book has two.
  const priced = [];
  for (const h of held) {
    const rate = isInr(h) ? fx : 1;
    if (!rate) { dropped.push(h.ticker); continue; }
    const px = Number(h.last_price || h.avg_cost || 0);
    priced.push({
      ticker: h.ticker,
      value: (Number(h.qty) * px) / rate,
      cost: (Number(h.qty) * Number(h.avg_cost || 0)) / rate,
    });
  }
  const value = priced.reduce((s, h) => s + h.value, 0);
  const cost = priced.reduce((s, h) => s + h.cost, 0);
  const pnl = value - cost, pnlPct = cost ? (pnl / cost) * 100 : 0;
  // Sorted on the CONVERTED value. Sorting on the raw one is what put a
  // fifteen-dollar gold position second on this list.
  const top = [...priced].sort((a, b) => b.value - a.value).slice(0, 3);
  const pLines = [`Value ${money(value)} · P&L ${pnl >= 0 ? '+' : ''}${money(pnl)} (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%)`];
  if (top.length) pLines.push('Top: ' + top.map(h => h.ticker).join(', '));
  if (dropped.length) pLines.push(`Left out for want of an exchange rate: ${dropped.join(', ')}`);
  sections.push({ title: 'Portfolio', body: pLines.join('\n') });

  if (news.length) sections.push({ title: 'News', body: news.slice(0, 5).map(n => `• ${n.title} — ${n.source}`).join('\n') });

  const low = subjects.filter(s => { const p = Number(s.attendance_pct) || 0; const pct = p > 0 && p <= 1 ? p * 100 : p; return pct > 0 && pct < 75; });
  if (low.length) sections.push({ title: 'Heads-up', body: low.map(s => `⚠ ${s.name}: attendance below 75%`).join('\n') });

  // ---- writes ----
  // brief: one row per day
  await rest(`briefs?date=eq.${todayISO}`, { method: 'DELETE' });
  const br = await rest('briefs', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify([{ date: todayISO, sections }]) });
  console.log('brief write', br.status);

  // news: clear today's auto batch + prune >3 days old, then insert fresh
  if (news.length) {
    const cutoff = new Date(Date.now() - 3 * 864e5).toISOString();
    await rest(`news?published_at=gte.${todayISO}`, { method: 'DELETE' });
    await rest(`news?published_at=lt.${cutoff}`, { method: 'DELETE' });
    const nw = await rest('news', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(news) });
    console.log('news write', nw.status, news.length, 'items');
  }

  // heartbeat
  await rest('memory', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify([{ key: 'brief_last_sync', value: { at: new Date().toISOString(), date: todayISO, news: news.length, via: 'github-action' }, updated_at: new Date().toISOString() }]) });
  console.log(`Brief for ${todayISO} written · ${sections.length} sections · ${news.length} news`);
}

run().catch(e => { console.error(e); process.exit(1); });
