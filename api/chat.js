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

// Routing is by SENSITIVITY, and the line is drawn where Neel drew it after
// being shown what the free tier's terms actually say.
//
// journal is here and health is not, which is a real distinction rather than a
// compromise: a journal is what someone actually thought, in their own words,
// and there is no version of that which is safe to hand to a training pipeline.
// Health here is weight, sleep hours and workout counts — numbers that reveal
// little in isolation and nothing in someone else's training set.
//
// If that judgement ever changes, this is the only line to change. Adding a name
// here moves a whole screen to the paid path; the fail-closed default below means
// forgetting to add one is the safe direction.
const SENSITIVE = new Set(['money', 'finboy', 'journal', 'brief']);

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

// Effort governs how many tokens Sonnet spends before it answers — thinking,
// prose, tool arguments, all of it. The API default is "high", which is tuned for
// hard agentic coding and is simply the wrong shape for this app: FinBoy's job is
// to read fourteen retrieved facts and write a careful paragraph. The difficult
// parts — retrieval, refusing advice, checking every number back against the
// context — happen in our own code precisely so they do not depend on the model
// thinking harder. Paying for deep deliberation on top of that buys very little.
//
// "medium" is the documented cost step-down and is described as comparable to
// Sonnet 4.6 at high effort, which is a good deal. "low" is documented as
// suitable for chat and non-coding work and is worth trying for FinBoy later.
const EFFORTS = ['low', 'medium', 'high'];
const DEFAULT_EFFORT = EFFORTS.includes(process.env.ANTHROPIC_EFFORT || '')
  ? process.env.ANTHROPIC_EFFORT
  : 'medium';

// A client may ask to spend LESS than the server's setting, never more. Effort is
// a spending dial arriving from a browser, and the only safe direction for a
// browser to move a spending dial is down. xhigh and max are not reachable from
// here at all.
function effortFor(requested) {
  const want = EFFORTS.indexOf(String(requested || ''));
  const cap = EFFORTS.indexOf(DEFAULT_EFFORT);
  return want >= 0 && want < cap ? EFFORTS[want] : DEFAULT_EFFORT;
}

// Web search is a server-side tool: Claude runs the searches itself and the
// results never pass through this function. Two reasons it is capped and opt-in
// rather than always on.
//
// It is billed per search on top of tokens, and a chatty assistant that searches
// five times to answer "what is my gold allocation" turns a free-ish question
// into a metered one. MAX_SEARCHES is the ceiling; the caller asks for it, the
// server decides how far it may go.
//
// And it changes what the number audit means. FinBoy's audit flags any figure in
// an answer that is not in the retrieved context — the one check that does not
// depend on the model cooperating. A figure fetched from the web is legitimately
// absent from that context, so without care every web-sourced number would be
// flagged as fabricated and the warning would become noise. Citations are
// therefore returned separately, with their cited text, so FinBoy can widen the
// audit pool by exactly the material that was actually quoted — and show the
// source next to it. A number from the web is only as good as the page it came
// from, and the user should see the page.
const MAX_SEARCHES = 4;
const WEB_SEARCH_TOOL = 'web_search_20260318';

async function callAnthropic({ model, system, messages, maxTokens, effort, web }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw Object.assign(new Error('Anthropic key is not configured on the server.'), { code: 503 });

  const tools = web
    ? [{
        type: WEB_SEARCH_TOOL,
        name: 'web_search',
        max_uses: Math.min(Number(web) || 2, MAX_SEARCHES),
        user_location: { type: 'approximate', country: 'IN', timezone: 'Asia/Kolkata' },
      }]
    : undefined;

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      output_config: { effort: effortFor(effort) },
      ...(system ? { system } : {}),
      ...(tools ? { tools } : {}),
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j?.error?.message || `Anthropic ${r.status}`), { code: r.status });

  const blocks = j.content || [];
  const cites = [];
  for (const b of blocks) {
    for (const c of (b.citations || [])) {
      if (c.url) cites.push({ url: c.url, title: c.title || c.url, text: c.cited_text || '' });
    }
  }
  // Deduped by URL: one page cited in four sentences is one source, and a list
  // repeating it four times reads as four corroborations when it is not.
  const seen = new Set();
  const citations = cites.filter(c => (seen.has(c.url) ? false : (seen.add(c.url), true)));

  return {
    text: blocks.map(b => b.text || '').join(''),
    usage: {
      in: j.usage?.input_tokens || 0,
      out: j.usage?.output_tokens || 0,
      searches: j.usage?.server_tool_use?.web_search_requests || 0,
    },
    citations,
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
    // Web search is only offered on the Anthropic path. NVIDIA's free tier is
    // where the non-personal questions go, and giving it a search budget would
    // be spending money on the half of the app that exists not to.
    const out = await call({
      model, system: body.system, messages: body.messages, maxTokens,
      effort: body.effort, web: provider === 'anthropic' ? body.web : 0,
    });
    return json(res, 200, { ...out, provider, model, effort: provider === 'anthropic' ? effortFor(body.effort) : undefined });
  } catch (e) {
    // The provider's own message, minus anything that could carry a key. Errors
    // from these APIs echo request context back, and a 401 body is the one place
    // a key most plausibly appears in a response.
    const msg = String(e.message || 'Upstream error').replace(/(nvapi|sk-ant)-[A-Za-z0-9_\-]+/g, '$1-***');
    return json(res, e.code && e.code >= 400 && e.code < 600 ? e.code : 502, { error: msg, provider, model });
  }
}
