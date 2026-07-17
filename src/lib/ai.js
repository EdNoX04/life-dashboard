// ---- Universal AI client ----
// Works with whichever key you set in Config (Claude / OpenAI / Gemini). Calls
// happen straight from the browser and every call logs its token usage + an
// estimated cost into Supabase `memory.ai_usage` so the Config tab can show a
// live running total.
import { getConfig, upsertMemory, list } from './db.js';

// USD per 1M tokens [input, output]. Cheap default models per provider.
const PRICES = {
  claude: { in: 0.80, out: 4.00, model: 'claude-3-5-haiku-latest', label: 'Claude' },
  openai: { in: 0.15, out: 0.60, model: 'gpt-4o-mini', label: 'ChatGPT' },
  gemini: { in: 0.075, out: 0.30, model: 'gemini-1.5-flash', label: 'Gemini' },
};

export function pickProvider(cfg = getConfig()) {
  if (cfg.claudeKey) return 'claude';
  if (cfg.geminiKey) return 'gemini';
  if (cfg.openaiKey) return 'openai';
  return null;
}
export function providerLabel(p) { return PRICES[p]?.label || null; }

// messages: [{ role:'user'|'assistant', content:'…' }]
export async function aiChat(messages, { system } = {}) {
  const cfg = getConfig();
  const provider = pickProvider(cfg);
  if (!provider) throw new Error('No AI key set yet — add one in Config → AI providers.');

  let text = '', usage = { in: 0, out: 0 };

  if (provider === 'claude') {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': cfg.claudeKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: cfg.claudeModel || PRICES.claude.model,
        max_tokens: 1024,
        ...(system ? { system } : {}),
        messages: messages.map(m => ({ role: m.role, content: m.content })),
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.error?.message || `Claude API ${r.status}`);
    text = (j.content || []).map(b => b.text || '').join('');
    usage = { in: j.usage?.input_tokens || 0, out: j.usage?.output_tokens || 0 };

  } else if (provider === 'gemini') {
    const model = cfg.geminiModel || PRICES.gemini.model;
    const contents = messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(cfg.geminiKey)}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contents, ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}) }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.error?.message || `Gemini API ${r.status}`);
    text = (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
    usage = { in: j.usageMetadata?.promptTokenCount || 0, out: j.usageMetadata?.candidatesTokenCount || 0 };

  } else if (provider === 'openai') {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${cfg.openaiKey}` },
      body: JSON.stringify({ model: cfg.openaiModel || PRICES.openai.model, messages: system ? [{ role: 'system', content: system }, ...messages] : messages }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.error?.message || `OpenAI API ${r.status}`);
    text = j.choices?.[0]?.message?.content || '';
    usage = { in: j.usage?.prompt_tokens || 0, out: j.usage?.completion_tokens || 0 };
  }

  logUsage(provider, usage).catch(() => {});
  return { text, provider };
}

async function logUsage(provider, usage) {
  const month = new Date().toISOString().slice(0, 7);
  let v = {};
  try { const rows = await list('memory', { filter: 'key=eq.ai_usage', order: 'key' }); v = rows?.[0]?.value || {}; } catch {}
  if (v.month !== month) v = { month, calls: 0, tokens: 0, cost: 0, byProvider: {} };
  const p = PRICES[provider] || { in: 0, out: 0 };
  const cost = (usage.in / 1e6) * p.in + (usage.out / 1e6) * p.out;
  v.calls = (v.calls || 0) + 1;
  v.tokens = (v.tokens || 0) + usage.in + usage.out;
  v.cost = (v.cost || 0) + cost;
  v.byProvider = v.byProvider || {};
  v.byProvider[provider] = (v.byProvider[provider] || 0) + 1;
  v.updated = new Date().toISOString();
  await upsertMemory('ai_usage', v);
}
