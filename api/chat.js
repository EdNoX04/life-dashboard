// /api/chat — the only place an AI key exists.
//
// Three problems solved by one function.
//
// 1. NVIDIA cannot be called from a browser at all. integrate.api.nvidia.com
//    sends no CORS headers and NVIDIA has declined to add them, on the grounds
//    that those endpoints are not meant for production. So a server hop is not a
//    design preference here, it is the only way GLM-5.2 works.
//
// 2. Keys in the browser. Until now ai.js read the key out of Settings and called
//    Anthropic directly, which put a key with prepaid credit attached into every
//    device that ever loaded the dashboard, and — until migration 003 — into a
//    database row the whole internet could read. Here the keys are environment
//    variables on Vercel. No browser ever holds one, so no browser can leak one,
//    and rotating means editing one value in one place.
//
// 3. An open proxy is a free LLM for whoever finds the URL, billed to Neel. So
//    every request must carry a Supabase session token, verified against
//    Supabase itself. Note this is checked BEFORE anything is forwarded: a
//    request that fails auth costs nothing but this function's own runtime.
//
// Routing is by SENSITIVITY, not by task. NVIDIA's free hosted endpoints log
// inputs and outputs and use them to improve their models — their own terms say
// not to send confidential or personal data. Money, health and journal therefore
// go to Anthropic; everything else goes to NVIDIA. The allowlist is the mechanism
// and it fails CLOSED: an agent name this file does not recognise is treated as
// sensitive. Getting that default backwards would mean a new tab added six months
// from now quietly starts posting personal data to a training endpoint, and
// nothing would look wrong.

const SENSITIVE = new Set(['money', 'finboy', 'health', 'journal', 'brief']);

const NVIDIA_DEFAULT = 'z-ai/glm-5.2';
const ANTHROPIC_DEFAULT = 'claude-sonnet-5';

// Only models this file names may be requested. The `model` field arrives from a
// browser, and a proxy that forwards an arbitrary model string lets anyone with a
// session bill you for the most expensive thing the provider sells.
const ALLOWED = {
  nvidia: new Set(['z-ai/glm-5.2', 'nvidia/nemotron-3-ultra-550b-a55b', 'deepseek-ai/deepseek-v4-pro']),
  anthropic: new Set(['claude-sonnet-5', 'claude-haiku-4-5', 'claude-opus-5']),
};

const json = (res, code, body) => {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
};

async function verifySession(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;

  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) return null;

  // Asking Supabase who this token belongs to, rather than verifying the
  // signature here with the JWT secret. One extra round trip, and in exchange
  // this function never needs to hold the signing secret and a revoked session
  // stops working immediately rather than at token expiry.
  const r = await fetch(`${url.replace(/\/$/, '')}/auth/v1/user`, {
    headers: { apikey: anon, Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return null;
  const u = await r.json().catch(() => null);
  return u?.id ? u : null;
}

async function callAnthropic({ model, system, messages, maxTokens }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw Object.assign(new Error('Anthropic key is not configured on the server.'), { code: 503 });

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      ...(system ? { system } : {}),
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j?.error?.message || `Anthropic ${r.status}`), { code: r.status });
  return {
    text: (j.content || []).map(b => b.text || '').join(''),
    usage: { in: j.usage?.input_tokens || 0, out: j.usage?.output_tokens || 0 },
  };
}

async function callNvidia({ model, system, messages, maxTokens }) {
  const key = process.env.NVIDIA_API_KEY;
  if (!key) throw Object.assign(new Error('NVIDIA key is not configured on the server.'), { code: 503 });

  const r = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature: 1,
      top_p: 1,
      messages: system ? [{ role: 'system', content: system }, ...messages] : messages,
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j?.error?.message || j?.detail || `NVIDIA ${r.status}`), { code: r.status });
  return {
    text: j.choices?.[0]?.message?.content || '',
    usage: { in: j.usage?.prompt_tokens || 0, out: j.usage?.completion_tokens || 0 },
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });

  const user = await verifySession(req);
  if (!user) return json(res, 401, { error: 'Sign in first.' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  if (!body || !Array.isArray(body.messages) || !body.messages.length) {
    return json(res, 400, { error: 'messages[] required' });
  }

  const agent = String(body.agent || '').toLowerCase();
  // Unknown agent → sensitive. See the note at the top: this default is the
  // whole safety property, and the expensive direction is the safe one.
  const provider = SENSITIVE.has(agent) || !agent ? 'anthropic' : 'nvidia';

  const requested = String(body.model || '');
  const model = ALLOWED[provider].has(requested)
    ? requested
    : (provider === 'anthropic' ? ANTHROPIC_DEFAULT : NVIDIA_DEFAULT);

  // Capped here rather than trusted from the client, because output tokens are
  // the expensive half and max_tokens is the only lever on them.
  const maxTokens = Math.min(Number(body.maxTokens) || 1024, 4096);

  try {
    const call = provider === 'anthropic' ? callAnthropic : callNvidia;
    const out = await call({ model, system: body.system, messages: body.messages, maxTokens });
    return json(res, 200, { ...out, provider, model });
  } catch (e) {
    // The provider's own message, minus anything that could carry a key. Errors
    // from these APIs echo request context back, and a 401 body is the one place
    // a key most plausibly appears in a response.
    const msg = String(e.message || 'Upstream error').replace(/(nvapi|sk-ant)-[A-Za-z0-9_\-]+/g, '$1-***');
    return json(res, e.code && e.code >= 400 && e.code < 600 ? e.code : 502, { error: msg, provider, model });
  }
}
