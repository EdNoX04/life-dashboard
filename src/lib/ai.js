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

// USD per 1M tokens [input, output]. Used only to price the usage meter; the
// server decides what actually runs. Prices move — the meter is the number to
// trust, not this table.
const PRICES = {
  'claude-sonnet-5':  { in: 2.00, out: 10.00, label: 'Sonnet 5' },
  'claude-haiku-4-5': { in: 1.00, out: 5.00,  label: 'Haiku 4.5' },
  'claude-opus-5':    { in: 5.00, out: 25.00, label: 'Opus 5' },
  // NVIDIA's hosted tier is free. Zero here is a real price, not a missing one.
  'z-ai/glm-5.2':                     { in: 0, out: 0, label: 'GLM-5.2' },
  'nvidia/nemotron-3-ultra-550b-a55b':{ in: 0, out: 0, label: 'Nemotron 3 Ultra' },
  'deepseek-ai/deepseek-v4-pro':      { in: 0, out: 0, label: 'DeepSeek V4 Pro' },
};

export const FREE_MODELS = ['z-ai/glm-5.2', 'nvidia/nemotron-3-ultra-550b-a55b', 'deepseek-ai/deepseek-v4-pro'];
export const PAID_MODELS = ['claude-sonnet-5', 'claude-haiku-4-5', 'claude-opus-5'];
export function modelLabel(m) { return PRICES[m]?.label || m; }

// Which agents are personal. Kept in step with the server list, but the server's
// copy is the one that decides — this one only drives what the UI can offer.
export const SENSITIVE_AGENTS = ['money', 'finboy', 'health', 'journal', 'brief'];

// messages: [{ role:'user'|'assistant', content:'…' }]
// agent:    which screen is asking. Omitted means "treat as personal".
export async function aiChat(messages, { system, agent = '', model = '', maxTokens = 1024 } = {}) {
  const token = await accessToken();
  if (!token) throw new Error('Sign in to use the assistant.');

  const r = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ agent, model, system, messages, maxTokens }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || `Assistant unavailable (${r.status})`);

  logUsage(j.model, j.usage || { in: 0, out: 0 }).catch(() => {});
  return { text: j.text || '', provider: j.provider, model: j.model };
}

// Kept because callers still ask. There is always a provider now — the server
// has the keys — so the honest answer is whether the session can reach it.
export function pickProvider() { return 'proxy'; }
export function providerLabel() { return 'PLAYER ONE'; }

async function logUsage(model, usage) {
  const month = new Date().toISOString().slice(0, 7);
  let v = {};
  try { const rows = await list('memory', { filter: 'key=eq.ai_usage', order: 'key' }); v = rows?.[0]?.value || {}; } catch {}
  if (v.month !== month) v = { month, calls: 0, tokens: 0, cost: 0, byProvider: {} };
  const p = PRICES[model] || { in: 0, out: 0 };
  const cost = (usage.in / 1e6) * p.in + (usage.out / 1e6) * p.out;
  v.calls = (v.calls || 0) + 1;
  v.tokens = (v.tokens || 0) + usage.in + usage.out;
  v.cost = (v.cost || 0) + cost;
  v.byProvider = v.byProvider || {};
  v.byProvider[model] = (v.byProvider[model] || 0) + 1;
  v.updated = new Date().toISOString();
  await upsertMemory('ai_usage', v);
}
