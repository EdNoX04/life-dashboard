// ---- AI client ----
// Every call now goes to /api/chat on this same origin. Nothing here holds a key
// and nothing here chooses a provider, because both of those decisions have to be
// unforgeable and neither can be if they live in a browser.
//
// What changed and why:
//
// The old version read the key out of Settings and called Anthropic, OpenAI or
// Gemini directly. That put a key with prepaid credit into every device that ever
// opened the dashboard and, through config sync, into a database row that was
// world-readable until migration 003. It also could not reach NVIDIA at all:
// integrate.api.nvidia.com sends no CORS headers, so GLM-5.2 is unreachable from
// a page no matter what key you hold.
//
// Routing lives in api/chat.js and is by SENSITIVITY: money, health and journal
// go to Anthropic; everything else goes to NVIDIA's free tier, whose terms say
// inputs are logged and used for training. The client may REQUEST a model but
// cannot pick a provider — a browser that could choose would be a browser that
// could send the portfolio to the training endpoint.
import { upsertMemory, list } from './db.js';
import { accessToken } from './auth.js';

// USD per 1M tokens [input, output], plus USD per web search. Used only to PRICE
// the meter — the server decides what actually runs.
//
// The meter used to accumulate a computed cost, which meant the moment a price
// changed every past month silently became wrong and there was no way to tell.
// It now stores raw token counts per model and multiplies at display time, so a
// price correction here retroactively fixes the history instead of corrupting it.
const PRICES = {
  'claude-sonnet-5':  { in: 2.00, out: 10.00, search: 0.01, label: 'Sonnet 5' },
  'claude-haiku-4-5': { in: 1.00, out: 5.00,  search: 0.01, label: 'Haiku 4.5' },
  'claude-opus-5':    { in: 5.00, out: 25.00, search: 0.01, label: 'Opus 5' },
  // NVIDIA's hosted tier is free. Zero here is a real price, not a missing one.
  'z-ai/glm-5.2':                     { in: 0, out: 0, label: 'GLM-5.2' },
  'nvidia/nemotron-3-ultra-550b-a55b':{ in: 0, out: 0, label: 'Nemotron 3 Ultra' },
  'deepseek-ai/deepseek-v4-pro':      { in: 0, out: 0, label: 'DeepSeek V4 Pro' },
};

export const FREE_MODELS = ['z-ai/glm-5.2', 'nvidia/nemotron-3-ultra-550b-a55b', 'deepseek-ai/deepseek-v4-pro'];
export const PAID_MODELS = ['claude-sonnet-5', 'claude-haiku-4-5', 'claude-opus-5'];
export function modelLabel(m) { return PRICES[m]?.label || m; }
export function priceOf(m) { return PRICES[m] || { in: 0, out: 0, search: 0 }; }

// Cost recomputed from stored counters, never read back from a stored total.
// $10 per 1,000 searches is a cent each, and a cent is not nothing when the
// alternative half of this app is free.
export function costOf(byModel = {}) {
  let total = 0;
  const rows = [];
  for (const [model, c] of Object.entries(byModel)) {
    const p = priceOf(model);
    const cost = (c.in || 0) / 1e6 * p.in + (c.out || 0) / 1e6 * p.out + (c.searches || 0) * (p.search || 0);
    rows.push({ model, label: modelLabel(model), ...c, cost });
    total += cost;
  }
  rows.sort((a, b) => b.cost - a.cost || b.calls - a.calls);
  return { total, rows };
}

// Which agents are personal. Kept in step with the server list, but the server's
// copy is the one that decides — this one only drives what the UI can offer.
export const SENSITIVE_AGENTS = ['money', 'ledger', 'finboy', 'journal', 'brief'];

// messages: [{ role:'user'|'assistant', content:'…' }]
// agent:    which screen is asking. Omitted means "treat as personal".
// effort: only meaningful on the Anthropic path. The server caps it — a caller
// may ask to spend LESS than the configured level, never more.
// web: how many searches Claude may run for this answer (0 = none). Only honoured
// on the Anthropic path — see api/chat.js for why the free tier gets no budget.
export async function aiChat(messages, { system, agent = '', model = '', maxTokens = 1024, effort = '', web = 0 } = {}) {
  const token = await accessToken();
  if (!token) throw new Error('Sign in to use the assistant.');

  const r = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ agent, model, system, messages, maxTokens, effort, web }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || `Assistant unavailable (${r.status})`);

  logUsage(j.model, j.usage || { in: 0, out: 0 }).catch(() => {});
  return { text: j.text || '', provider: j.provider, model: j.model, citations: j.citations || [] };
}

// Kept because callers still ask. There is always a provider now — the server
// has the keys — so the honest answer is whether the session can reach it.
export function pickProvider() { return 'proxy'; }
export function providerLabel() { return 'PLAYER ONE'; }

async function logUsage(model, usage) {
  const month = new Date().toISOString().slice(0, 7);
  let v = {};
  try { const rows = await list('memory', { filter: 'key=eq.ai_usage', order: 'key' }); v = rows?.[0]?.value || {}; } catch {}
  if (v.month !== month) v = { month, byModel: {} };
  v.byModel = v.byModel || {};
  const c = v.byModel[model] || { calls: 0, in: 0, out: 0, searches: 0 };
  c.calls += 1;
  c.in += usage.in || 0;
  c.out += usage.out || 0;
  c.searches += usage.searches || 0;
  v.byModel[model] = c;
  // Totals kept for the old card's sake, but derived — never the source of truth.
  v.calls = Object.values(v.byModel).reduce((s2, x) => s2 + x.calls, 0);
  v.tokens = Object.values(v.byModel).reduce((s2, x) => s2 + x.in + x.out, 0);
  v.updated = new Date().toISOString();
  await upsertMemory('ai_usage', v);
}
