// ---- Money-tab intelligence: Wall Street data + AI advisory ----
// - fetchRecommendations: Finnhub analyst recommendation trends (real Street data)
// - aiPortfolioAdvice:    whole-portfolio score + per-holding buy/hold/sell
// - aiNextBuy:            budget+risk aware next-buy suggestions
// - aiStockNote:          quick per-stock analysis + verdict
// - aiNewsSummary:        digest of the holdings headlines
// All AI calls go through lib/ai.js (whichever provider key is set) and results
// are cached in Supabase memory so reopening the tab doesn't re-spend tokens.
import { getConfig, list, upsertMemory } from './db.js';
import { aiChat } from './ai.js';

// tolerant JSON extractor — models sometimes wrap JSON in prose/fences
export function pickJSON(text) {
  if (!text) return null;
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

export async function memGet(key) {
  try { const rows = await list('memory', { filter: `key=eq.${key}`, order: 'key' }); return rows?.[0]?.value || null; }
  catch { return null; }
}
export const memSet = (key, value) => upsertMemory(key, value).catch(() => {});

// ---- Wall Street: Finnhub recommendation trends (free tier, CORS-ok) ----
export async function fetchRecommendations(ticker) {
  const key = (getConfig().finnhubKey || '').trim();
  if (!key) return null;
  try {
    const r = await fetch(`https://finnhub.io/api/v1/stock/recommendation?symbol=${encodeURIComponent(ticker)}&token=${key}`);
    const j = await r.json();
    const row = Array.isArray(j) ? j[0] : null; // latest month
    if (!row) return null;
    const buy = (row.strongBuy || 0) + (row.buy || 0);
    const hold = row.hold || 0;
    const sell = (row.sell || 0) + (row.strongSell || 0);
    const total = buy + hold + sell;
    if (!total) return null;
    return { buy, hold, sell, total, period: row.period };
  } catch { return null; }
}

const compactHoldings = (held, priceOf, quotes) => held.map(h => {
  const px = priceOf(h), v = Number(h.qty) * px, c = Number(h.qty) * Number(h.avg_cost || 0);
  return {
    ticker: h.ticker, name: h.name || '', qty: +Number(h.qty).toFixed(4),
    avg_cost: +Number(h.avg_cost || 0).toFixed(2), price: +px.toFixed(2),
    value: +v.toFixed(2), pnl_pct: c ? +(((v - c) / c) * 100).toFixed(1) : 0,
    day_pct: quotes?.[h.ticker]?.changePct != null ? +quotes[h.ticker].changePct.toFixed(2) : null,
  };
});

const DISCLAIMER = 'AI-generated, not licensed financial advice — sanity-check before acting.';

// ---- whole-portfolio advice ----
export async function aiPortfolioAdvice(held, priceOf, quotes) {
  const data = compactHoldings(held, priceOf, quotes);
  const sys = 'You are a sharp, plain-spoken equity analyst reviewing a young Indian student\'s US stock portfolio (long-term horizon, small size). Be definitive, concrete and honest. Reply with ONLY valid JSON, no markdown.';
  const prompt = `My portfolio (live): ${JSON.stringify(data)}.
Considering current market conditions you know of, reply as JSON:
{"score": <0-100 portfolio quality score>, "grade": "<one word e.g. SOLID / RISKY / TOP-HEAVY>",
"summary": "<3-4 sentence definitive read: diversification, concentration, quality, what to fix first>",
"holdings": [{"ticker": "...", "action": "BUY"|"HOLD"|"SELL", "reason": "<one tight sentence>"}]}`;
  const { text } = await aiChat([{ role: 'user', content: prompt }], { system: sys });
  const j = pickJSON(text);
  if (!j || !j.holdings) throw new Error('AI reply was not parseable — try again.');
  const out = { ...j, at: new Date().toISOString(), disclaimer: DISCLAIMER };
  memSet('ai_portfolio_advice', out);
  return out;
}

// ---- next-buy suggester ----
export async function aiNextBuy(held, priceOf, quotes, { budget, risk, aiRisk }) {
  const data = compactHoldings(held, priceOf, quotes);
  const riskLine = aiRisk
    ? 'Choose the appropriate risk level yourself based on my portfolio and current market conditions.'
    : `Target risk level: ${risk}/5 (1=very conservative, 3=balanced, 5=aggressive). Respect it strictly.`;
  const sys = 'You are a rigorous investment strategist for a young long-horizon retail investor buying US-listed stocks/ETFs via INDmoney. Do real risk thinking: concentration, sector overlap, valuation, macro. Reply with ONLY valid JSON, no markdown.';
  const prompt = `Current holdings: ${JSON.stringify(data)}.
Cash available in my US wallet: $${budget}.
${riskLine}
Suggest what to buy NEXT (1-3 tickers max, can include adding to existing positions). Reply as JSON:
{"risk_meter": <1-5 the actual risk level of your suggestion set>,
"market_read": "<2 sentences on current conditions driving this>",
"suggestions": [{"ticker":"...","name":"...","allocate_usd": <number>, "why": "<2-3 sentences: thesis + risk calc + why it fits this portfolio>", "risk": <1-5>}],
"avoid": "<one sentence: what NOT to buy right now and why>"}
Allocations must sum to <= ${budget}.`;
  const { text } = await aiChat([{ role: 'user', content: prompt }], { system: sys });
  const j = pickJSON(text);
  if (!j || !j.suggestions) throw new Error('AI reply was not parseable — try again.');
  const out = { ...j, budget, riskAsked: aiRisk ? 'ai' : risk, at: new Date().toISOString(), disclaimer: DISCLAIMER };
  memSet('ai_next_buy', out);
  return out;
}

// ---- per-stock quick analysis + verdict (cached per ticker, 24h) ----
export async function aiStockNote(h, px, dayPct, { force = false } = {}) {
  const cacheAll = (await memGet('ai_stock_notes')) || {};
  const hit = cacheAll[h.ticker];
  if (!force && hit?.at && Date.now() - new Date(hit.at).getTime() < 24 * 3600e3) return hit;
  const sys = 'You are a concise equity analyst. Small but genuinely informative. Reply with ONLY valid JSON, no markdown.';
  const prompt = `Stock: ${h.ticker} (${h.name || ''}). My position: ${h.qty} shares @ avg $${h.avg_cost}, price now $${px}${dayPct != null ? `, ${dayPct.toFixed(2)}% today` : ''}.
Reply as JSON: {"verdict":"BUY"|"HOLD"|"SELL","confidence":<0-100>,
"analysis":"<3 tight sentences: what the company does + how the stock/business is ACTUALLY doing now + valuation/momentum read>",
"risk":"<one sentence: the main risk>"}`;
  const { text } = await aiChat([{ role: 'user', content: prompt }], { system: sys });
  const j = pickJSON(text);
  if (!j || !j.verdict) throw new Error('AI reply was not parseable — try again.');
  const note = { ...j, at: new Date().toISOString() };
  cacheAll[h.ticker] = note;
  memSet('ai_stock_notes', cacheAll);
  return note;
}

// ---- holdings-news digest ----
export async function aiNewsSummary(newsItems, tickers) {
  const heads = newsItems.slice(0, 12).map(n => `[${n.ticker || n.category || ''}] ${n.title}${n.summary ? ' — ' + String(n.summary).slice(0, 140) : ''}`);
  const sys = 'You are a markets editor writing for one specific investor. Plain sentences, no lists, no hype.';
  const prompt = `I own: ${tickers.join(', ')}. Today's headlines about my holdings:\n${heads.join('\n')}\n\nIn 3-5 sentences: what actually matters for MY positions today, connecting the dots across stories. End with the single most important takeaway.`;
  const { text } = await aiChat([{ role: 'user', content: prompt }], { system: sys });
  const out = { text: text.trim(), at: new Date().toISOString() };
  memSet('ai_news_summary', out);
  return out;
}

// ---- crypto prices (CoinGecko, free + CORS-ok, no key) ----
const CG_IDS = {
  BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', DOGE: 'dogecoin', XRP: 'ripple',
  ADA: 'cardano', BNB: 'binancecoin', DOT: 'polkadot', LTC: 'litecoin', LINK: 'chainlink',
  AVAX: 'avalanche-2', MATIC: 'matic-network', SHIB: 'shiba-inu', TRX: 'tron',
  USDT: 'tether', USDC: 'usd-coin', PEPE: 'pepe', NEAR: 'near', SUI: 'sui', TON: 'the-open-network',
};
export const cgId = sym => CG_IDS[String(sym).toUpperCase()] || String(sym).toLowerCase();

export async function fetchCryptoPrices(symbols) {
  if (!symbols.length) return {};
  const ids = [...new Set(symbols.map(cgId))].join(',');
  try {
    const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=usd&include_24hr_change=true`);
    const j = await r.json();
    const out = {};
    for (const s of symbols) {
      const row = j[cgId(s)];
      if (row?.usd != null) out[s.toUpperCase()] = { price: row.usd, changePct: row.usd_24h_change ?? null };
    }
    return out;
  } catch { return {}; }
}
