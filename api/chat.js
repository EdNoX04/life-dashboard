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
// 'finboy' stays alongside 'ledger'. The name changed; a client still running
// yesterday's bundle has not heard, and the one direction this set must never
// fail is a money question quietly reaching the free tier.
// 'lecture' belongs here, and the reason is other people rather than Neel. A
// lecture transcript is a recording of a professor and a room full of
// classmates who did not agree to anything; sending that to a free tier whose
// terms say inputs improve their models is not a decision Neel gets to make on
// their behalf. It also happens to be the tier that cannot read the slides.
const SENSITIVE = new Set(['money', 'ledger', 'finboy', 'journal', 'brief', 'lecture']);

// z-ai/glm-5.2 reached end of life on 2026-08-21 and NVIDIA now refuses it
// outright. It was the default here, so from that morning every question routed
// to the free tier — which is most of the app — returned an error, and nothing
// anywhere said so. Found nine days later by asking PLAYER TWO a question.
//
// The lightning model is the default now because latency is what this tier is
// for: the dock answers "when is my next class" and the wait is the product.
// The free tier is a CHAIN, not a model. One id was a single point of failure:
// glm-5.2 retired on 2026-08-21 and every non-sensitive question in the app
// failed for nine days with nobody told.
//
// Ordered by what this tier is actually for — latency. The dock answers "when is
// my next class", and the wait is the product; a 550B model that is three times
// slower is not a better answer to that question, it is a worse one. So the
// biggest model is LAST: it is the parachute, not the aspiration.
//
// All four are free endpoints on build.nvidia.com.
const NVIDIA_CHAIN = [
  'nvidia/nemotron-3.5-lightning-30b-a3b',   // fastest 30B A3B MoE
  'moonshotai/kimi-k3',                      // ~2.8T hybrid MoE
  'deepseek-ai/deepseek-v4-pro-0813',        // 1M context
  'nvidia/nemotron-3-ultra-550b-a55b',       // the parachute
];
const NVIDIA_DEFAULT = NVIDIA_CHAIN[0];
const ANTHROPIC_DEFAULT = 'claude-sonnet-5';

// When the whole free chain is gone, the paid path catches it. Haiku, not
// Sonnet: this is the cheap tier having a bad day, not a promotion.
const FALLBACK_MODEL = 'claude-haiku-4-5';

/**
 * The order to try, starting from whichever model was asked for. Exported so
 * the ordering can be pinned by a test rather than trusted.
 */
export function nvidiaChainFrom(model) {
  const first = NVIDIA_CHAIN.includes(model) ? model : NVIDIA_DEFAULT;
  return [first, ...NVIDIA_CHAIN.filter(m => m !== first)];
}

// Only models this file names may be requested. The `model` field arrives from a
// browser, and a proxy that forwards an arbitrary model string lets anyone with a
// session bill you for the most expensive thing the provider sells.
const ALLOWED = {
  // glm-5.2 is deliberately absent rather than merely un-defaulted: leaving a
  // retired id in the allowlist means a stale client can still ask for it and
  // get the same dead end.
  // Exactly the chain. A model that is allowed but not in the chain can be
  // requested and then never fallen back FROM, which is the hole this whole
  // change exists to close.
  nvidia: new Set(NVIDIA_CHAIN),
  anthropic: new Set(['claude-sonnet-5', 'claude-haiku-4-5', 'claude-opus-5']),
};

// A provider saying "this model is gone" is not the same as a provider being
// down, and it is the failure that actually happened. Matching on the message is
// crude, but the alternative — trusting a status code — would have missed this
// one: NVIDIA returned it as an ordinary error body, not a 404.
const MODEL_GONE = /end of life|no longer available|does not exist|unknown model|not found|deprecated|decommissioned/i;
const modelIsGone = e => MODEL_GONE.test(String(e && e.message || '')) || e?.code === 404;

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
      // 0.6 rather than 1. A dashboard assistant reading a context block and
      // answering "when is my next class" has one correct answer, and sampling
      // wide costs both accuracy and tokens — and tokens are seconds here.
      temperature: 0.6,
      top_p: 0.95,
      // NVIDIA's GLM expects clients to OPT IN to reasoning, so this is belt and
      // braces rather than a fix — but an explicit false cannot be turned on by a
      // default changing under us, and a reasoning pass on "what is due today"
      // is minutes of latency bought for nothing.
      chat_template_kwargs: { enable_thinking: false },
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

// ---------------------------------------------------------------- streaming
//
// Why this exists: the endpoint returned one JSON blob, so the user waited for
// the LAST token before seeing the FIRST. On a three-sentence answer that is a
// couple of seconds of staring at a spinner, and the wait is entirely artificial
// — the tokens were already arriving, we were just holding them.
//
// Both providers speak SSE and neither speaks the same dialect, so each is
// translated into one small shape the browser understands:
//
//     data: {"t":"…"}                        a piece of text
//     data: {"done":true,"usage":{…},…}      the tail: usage, model, citations
//     data: {"error":"…"}                    an upstream failure MID-stream
//
// That last one matters. Once headers are sent the status code is spent, so a
// provider that dies halfway cannot be reported as a 502 — without an explicit
// error event the stream just stops and the client shows a half-sentence as if
// it were the whole answer.
function openStream(res) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  // Proxies that buffer would undo the entire point of this.
  res.setHeader('X-Accel-Buffering', 'no');
}
const sendEvent = (res, obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

/** Read an upstream SSE body and hand each `data:` payload to `onLine`. */
export async function pumpSSE(body, onLine) {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try { onLine(JSON.parse(payload)); } catch { /* torn or non-JSON keepalive */ }
    }
  }
}

async function streamAnthropic({ model, system, messages, maxTokens, effort }, res) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw Object.assign(new Error('Anthropic key is not configured on the server.'), { code: 503 });
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model, max_tokens: maxTokens, stream: true,
      output_config: { effort: effortFor(effort) },
      ...(system ? { system } : {}),
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    }),
  });
  // Errors before the stream opens still arrive as ordinary JSON, so this is the
  // last moment a real status code can be returned.
  if (!r.ok || !r.body) {
    const j = await r.json().catch(() => ({}));
    throw Object.assign(new Error(j?.error?.message || `Anthropic ${r.status}`), { code: r.status });
  }
  openStream(res);
  const usage = { in: 0, out: 0 };
  await pumpSSE(r.body, ev => {
    const step = anthropicStep(ev);
    if (step.text) sendEvent(res, { t: step.text });
    if (step.error) sendEvent(res, { error: step.error });
    if (step.inTokens != null) usage.in = step.inTokens;
    if (step.outTokens != null) usage.out = step.outTokens;
  });
  return usage;
}

// The two providers' event shapes, isolated and exported so they can be pinned
// by tests. This is where a silent failure would live: mistake the field and the
// stream still "works", it just never emits a single character.
export function anthropicStep(ev) {
  if (!ev || typeof ev !== 'object') return {};
  if (ev.type === 'content_block_delta') return { text: ev.delta?.text || '' };
  if (ev.type === 'message_start') return { inTokens: ev.message?.usage?.input_tokens || 0 };
  if (ev.type === 'message_delta') return { outTokens: ev.usage?.output_tokens ?? null };
  if (ev.type === 'error') return { error: ev.error?.message || 'stream error' };
  return {};
}

export function nvidiaStep(ev) {
  if (!ev || typeof ev !== 'object') return {};
  const out = {};
  const t = ev.choices?.[0]?.delta?.content;
  if (typeof t === 'string' && t) out.text = t;
  if (ev.usage) {
    out.inTokens = ev.usage.prompt_tokens || 0;
    out.outTokens = ev.usage.completion_tokens || 0;
  }
  return out;
}

async function streamNvidia({ model, system, messages, maxTokens }, res) {
  const key = process.env.NVIDIA_API_KEY;
  if (!key) throw Object.assign(new Error('NVIDIA key is not configured on the server.'), { code: 503 });
  const r = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model, max_tokens: maxTokens, temperature: 0.6, top_p: 0.95,
      chat_template_kwargs: { enable_thinking: false },
      stream: true,
      // OpenAI-compatible streams omit usage unless asked, and usage is what
      // the client's spend log is built from.
      stream_options: { include_usage: true },
      messages: system ? [{ role: 'system', content: system }, ...messages] : messages,
    }),
  });
  if (!r.ok || !r.body) {
    const j = await r.json().catch(() => ({}));
    throw Object.assign(new Error(j?.error?.message || j?.detail || `NVIDIA ${r.status}`), { code: r.status });
  }
  openStream(res);
  const usage = { in: 0, out: 0 };
  await pumpSSE(r.body, ev => {
    const step = nvidiaStep(ev);
    if (step.text) sendEvent(res, { t: step.text });
    if (step.inTokens != null) usage.in = step.inTokens;
    if (step.outTokens != null) usage.out = step.outTokens;
  });
  return usage;
}

/**
 * Try the models in order until one answers.
 *
 * Only a "this model is gone" error advances the chain. A 500 or a rate limit
 * is the provider having a bad minute, and quietly walking down four models —
 * then onto the paid tier — because of a blip would turn a transient failure
 * into a bill. Those propagate.
 *
 * `fellBack` carries what happened so the client can show it. The dashboard has
 * been silently wrong about a dead assistant for nine days once already; the
 * point of this is that the next retirement announces itself.
 */
export async function runChain(provider, model, _args, { canRetry, nvidia, anthropic }) {
  const tried = [];
  if (provider === 'nvidia') {
    for (const m of nvidiaChainFrom(model)) {
      try {
        const result = await nvidia(m);
        return {
          result, provider: 'nvidia', model: m,
          ...(tried.length ? { fellBack: { from: tried[0].model, to: m, reason: tried[0].reason, tried: tried.length } } : {}),
        };
      } catch (e) {
        if (!modelIsGone(e) || !canRetry()) throw e;
        tried.push({ model: m, reason: String(e.message || '').slice(0, 160) });
      }
    }
    // Every free model refused. Cross to the paid path rather than fail: an
    // assistant that costs a fraction of a cent beats one that is down.
    const result = await anthropic(FALLBACK_MODEL);
    return {
      result, provider: 'anthropic', model: FALLBACK_MODEL,
      fellBack: { from: tried[0]?.model || model, to: FALLBACK_MODEL, reason: tried[0]?.reason || 'free tier unavailable', tried: tried.length },
    };
  }
  return { result: await anthropic(model), provider: 'anthropic', model };
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

  // Streaming is opt-in per request. Web search is not offered on the streaming
  // path: citations arrive as their own block type and a half-cited answer is
  // worse than a slower complete one, so a search request takes the buffered
  // route regardless of what the client asked for.
  const wantStream = body.stream === true && !(provider === 'anthropic' && body.web);
  if (wantStream) {
    try {
      const args = { system: body.system, messages: body.messages, maxTokens, effort: body.effort };
      const out = await runChain(provider, model, args, {
        // Once a byte has been written the status line is spent and the model
        // cannot be swapped underneath the reader, so the chain only advances
        // while nothing has been sent yet.
        canRetry: () => !res.headersSent,
        nvidia: (m) => streamNvidia({ ...args, model: m }, res),
        anthropic: (m) => streamAnthropic({ ...args, model: m }, res),
      });
      sendEvent(res, { done: true, usage: out.result, provider: out.provider, model: out.model, ...(out.fellBack ? { fellBack: out.fellBack } : {}) });
      return res.end();
    } catch (e) {
      const msg = String(e.message || 'Upstream error').replace(/(nvapi|sk-ant)-[A-Za-z0-9_\-]+/g, '$1-***');
      // headersSent tells us which half of the request failed. Before the stream
      // opens this is an ordinary HTTP error; after, the only channel left is an
      // error EVENT — and staying silent would render a truncated answer as if
      // it were complete.
      if (res.headersSent) { sendEvent(res, { error: msg }); return res.end(); }
      return json(res, e.code && e.code >= 400 && e.code < 600 ? e.code : 502, { error: msg, provider, model });
    }
  }

  try {
    // Web search is only offered on the Anthropic path. NVIDIA's free tier is
    // where the non-personal questions go, and giving it a search budget would
    // be spending money on the half of the app that exists not to.
    const args = {
      system: body.system, messages: body.messages, maxTokens,
      effort: body.effort, web: provider === 'anthropic' ? body.web : 0,
    };
    const out = await runChain(provider, model, args, {
      canRetry: () => true,
      nvidia: (m) => callNvidia({ ...args, model: m }),
      anthropic: (m) => callAnthropic({ ...args, model: m, web: 0 }),
    });
    return json(res, 200, {
      ...out.result, provider: out.provider, model: out.model,
      ...(out.fellBack ? { fellBack: out.fellBack } : {}),
      effort: out.provider === 'anthropic' ? effortFor(body.effort) : undefined,
    });
  } catch (e) {
    // The provider's own message, minus anything that could carry a key. Errors
    // from these APIs echo request context back, and a 401 body is the one place
    // a key most plausibly appears in a response.
    const msg = String(e.message || 'Upstream error').replace(/(nvapi|sk-ant)-[A-Za-z0-9_\-]+/g, '$1-***');
    return json(res, e.code && e.code >= 400 && e.code < 600 ? e.code : 502, { error: msg, provider, model });
  }
}
