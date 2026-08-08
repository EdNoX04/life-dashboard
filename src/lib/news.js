// Holdings-relevant news, fetched live in the browser from Finnhub's
// company-news endpoint (CORS-friendly, uses the same finnhubKey as live prices).
// Inherently about the stocks you own — one call per top holding, lightly cached.
import { getConfig } from './db.js';

const z = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
const finnhubSymbol = t => String(t || '').toUpperCase().replace('-', '.');
let cache = { at: 0, key: '', data: [] };

// Two things the stored `news` table could not give the News tab, which is why
// it now reads from here instead of waiting for the nightly brief:
//
//   - WHICH STOCK a story is about. The brief encodes it as a "[NVDA] " prefix
//     on the title; Finnhub gives it as the symbol you asked for, which is
//     unambiguous and needs no parsing.
//   - THE GIST. Rows written before this week carry summary: '', and a row
//     already in the database does not fix itself. Fetching live means the
//     summary is there on first paint rather than after the next scheduled run.
//
// Finnhub's category feed is CORS-friendly and carries summaries, so Finance
// and Tech can be live too. Google News RSS cannot - it is CORS-blocked in a
// browser - which is why those categories used to depend on the worker.
export const FINNHUB_CATEGORY = { finance: 'general', tech: 'technology' };

let catCache = {};

export async function fetchCategoryNews(category) {
  const key = (getConfig().finnhubKey || '').trim();
  const fc = FINNHUB_CATEGORY[category];
  if (!key || !fc) return [];
  const c = catCache[category];
  if (c && Date.now() - c.at < 10 * 60000) return c.data;
  try {
    const r = await fetch(`https://finnhub.io/api/v1/news?category=${fc}&token=${key}`);
    if (!r.ok) return [];
    const arr = await r.json();
    const out = (Array.isArray(arr) ? arr : [])
      .filter(n => n.headline && n.url)
      .slice(0, 12)
      .map(n => ({
        id: `${category}-${n.id || n.url}`,
        ticker: null,
        title: n.headline,
        url: n.url,
        source: n.source || 'Finnhub',
        category,
        summary: (n.summary || '').trim(),
        datetime: n.datetime || 0,
        published_at: new Date((n.datetime || 0) * 1000 || Date.now()).toISOString(),
      }));
    catCache[category] = { at: Date.now(), data: out };
    return out;
  } catch { return []; }
}

export async function fetchHoldingsNews(tickers = []) {
  const key = (getConfig().finnhubKey || '').trim();
  const list = [...new Set(tickers.filter(Boolean).map(t => t.toUpperCase()))];
  if (!key || !list.length) return [];
  const ck = list.slice().sort().join(',');
  if (cache.data.length && cache.key === ck && Date.now() - cache.at < 10 * 60000) return cache.data;

  const to = new Date();
  const from = new Date(Date.now() - 7 * 864e5);
  const top = list.slice(0, 10); // cap API calls (free tier: 60/min)
  const all = [];
  await Promise.all(top.map(async t => {
    try {
      const r = await fetch(`https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(finnhubSymbol(t))}&from=${iso(from)}&to=${iso(to)}&token=${key}`);
      if (!r.ok) return;
      const arr = await r.json();
      (Array.isArray(arr) ? arr : []).slice(0, 4).forEach(n => {
        // `ticker` is a real field here, not a prefix baked into the title, so
        // the UI can render it as a chip and say what the story is about.
        if (n.headline && n.url) all.push({
          id: `${t}-${n.id || n.url}`, ticker: t, category: 'stocks',
          title: n.headline, url: n.url, source: n.source || 'Finnhub',
          summary: (n.summary || '').trim(), datetime: n.datetime || 0,
          published_at: new Date((n.datetime || 0) * 1000 || Date.now()).toISOString(),
        });
      });
    } catch { /* ignore per-ticker failures */ }
  }));

  const seen = new Set();
  const out = all
    .filter(n => n.title && !seen.has(n.title) && seen.add(n.title))
    .sort((a, b) => b.datetime - a.datetime)
    .slice(0, 24);
  cache = { at: Date.now(), key: ck, data: out };
  return out;
}
