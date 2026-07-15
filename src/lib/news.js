// Holdings-relevant news, fetched live in the browser from Finnhub's
// company-news endpoint (CORS-friendly, uses the same finnhubKey as live prices).
// Inherently about the stocks you own — one call per top holding, lightly cached.
import { getConfig } from './db.js';

const z = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
const finnhubSymbol = t => String(t || '').toUpperCase().replace('-', '.');
let cache = { at: 0, key: '', data: [] };

export async function fetchHoldingsNews(tickers = []) {
  const key = (getConfig().finnhubKey || '').trim();
  const list = [...new Set(tickers.filter(Boolean).map(t => t.toUpperCase()))];
  if (!key || !list.length) return [];
  const ck = list.slice().sort().join(',');
  if (cache.data.length && cache.key === ck && Date.now() - cache.at < 10 * 60000) return cache.data;

  const to = new Date();
  const from = new Date(Date.now() - 7 * 864e5);
  const top = list.slice(0, 8); // cap API calls (free tier: 60/min)
  const all = [];
  await Promise.all(top.map(async t => {
    try {
      const r = await fetch(`https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(finnhubSymbol(t))}&from=${iso(from)}&to=${iso(to)}&token=${key}`);
      if (!r.ok) return;
      const arr = await r.json();
      (Array.isArray(arr) ? arr : []).slice(0, 3).forEach(n => {
        if (n.headline && n.url) all.push({ id: `${t}-${n.id}`, ticker: t, title: n.headline, url: n.url, source: n.source || '', summary: (n.summary || '').slice(0, 180), datetime: n.datetime || 0 });
      });
    } catch { /* ignore per-ticker failures */ }
  }));

  const seen = new Set();
  const out = all
    .filter(n => n.title && !seen.has(n.title) && seen.add(n.title))
    .sort((a, b) => b.datetime - a.datetime)
    .slice(0, 8);
  cache = { at: Date.now(), key: ck, data: out };
  return out;
}
