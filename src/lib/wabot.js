// The WhatsApp bot — everything that decides, none of what talks.
//
// ARCHITECTURE, BECAUSE THE OBVIOUS PLAN HAS THE ARROW BACKWARDS
//
// Meta delivers each message as an inbound HTTPS POST and wants a fast answer.
// A Cowork session is something that STARTS — on a schedule, or when you open
// it — and makes outbound calls; nothing can POST into one. So Cowork cannot be
// the ear, and MCP is the wrong direction for this half.
//
//   ear + mouth   api/whatsapp.js on Vercel. Always up, no laptop involved.
//   fast lane     answered inline by the brain the dock already uses.
//   slow lane     queued as a spec/request, picked up by Cowork or Hermes,
//                 and the answer arrives as a later message.
//
// MCP is how Cowork reaches INTO the dashboard (see mcpguard.js). It is the
// outbound half. This file is the inbound one.
//
// THE CONTROL THAT MATTERS MOST
//
// A phone number is not a secret. It gets scraped, guessed, and typed by
// accident. So the allowlist is the security boundary, and an unknown sender
// gets NOTHING — not an error, not "unauthorised", not a read receipt. Silence,
// because any reply confirms the number is live and tells whoever is probing
// that something is listening. This is the one rule in this file that is worth
// more than every feature in it.
//
// AND META RETRIES. A webhook that is slow, or that 500s after doing the work,
// is delivered again — so an un-deduped "add a task" becomes three tasks. Every
// message carries an id and it is checked before anything happens.

const str = v => String(v ?? '').trim();

// ------------------------------------------------------------- the handshake

/**
 * Meta's GET verification, once, when the webhook is first saved.
 *
 * The token comparison is exact and the challenge is echoed ONLY on a match —
 * echoing it on a mismatch would hand anyone who guesses the URL a working
 * handshake.
 */
export function verifyChallenge(query = {}, verifyToken = '') {
  const mode = str(query['hub.mode'] ?? query.mode);
  const token = str(query['hub.verify_token'] ?? query.verify_token);
  const challenge = str(query['hub.challenge'] ?? query.challenge);
  if (!verifyToken) return { ok: false, reason: 'no verify token configured' };
  if (mode !== 'subscribe') return { ok: false, reason: 'not a subscribe request' };
  if (token !== verifyToken) return { ok: false, reason: 'verify token mismatch' };
  return { ok: true, challenge };
}

// ------------------------------------------------------------- the signature

/**
 * Constant-time string compare.
 *
 * A plain `===` on a signature leaks how many leading bytes were right through
 * how long the comparison took. It is a small leak and an old one, and it costs
 * four lines not to have it.
 */
export function safeEqual(a, b) {
  const x = str(a), y = str(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

/**
 * Is this really from Meta?
 *
 * `hmacHex` is INJECTED rather than imported, so this file stays free of
 * node:crypto and can be tested — and imported — anywhere. The caller passes
 * the one-line implementation.
 *
 * Verified against the RAW body. Re-serialising the parsed JSON changes key
 * order and whitespace, and the signature then never matches — which presents
 * as "Meta is sending bad signatures" and wastes a day.
 */
export function verifySignature(rawBody, header, appSecret, hmacHex) {
  if (!appSecret) return { ok: false, reason: 'no app secret configured' };
  const h = str(header);
  if (!h.startsWith('sha256=')) return { ok: false, reason: 'missing or malformed signature header' };
  if (typeof hmacHex !== 'function') return { ok: false, reason: 'no hmac implementation supplied' };
  let mine = '';
  try { mine = str(hmacHex(appSecret, rawBody)); } catch { return { ok: false, reason: 'could not compute a signature' }; }
  return safeEqual(h.slice(7), mine)
    ? { ok: true }
    : { ok: false, reason: 'signature mismatch' };
}

// -------------------------------------------------------------- the message

export const TEXT_TYPES = ['text', 'button', 'interactive'];

/**
 * Meta's nested payload, flattened to the messages a person actually sent.
 *
 * Delivery receipts and read receipts arrive on the SAME webhook under
 * `statuses`. They are not messages and must not be treated as text — a bot
 * that answers its own delivery receipt talks to itself forever.
 */
export function inboundMessages(payload) {
  const out = [];
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  for (const e of entries) {
    for (const ch of (Array.isArray(e?.changes) ? e.changes : [])) {
      const v = ch?.value || {};
      // Contacts carry the sender's profile name; keyed by wa_id.
      const names = new Map((Array.isArray(v.contacts) ? v.contacts : [])
        .map(c => [str(c?.wa_id), str(c?.profile?.name)]));
      for (const m of (Array.isArray(v.messages) ? v.messages : [])) {
        const id = str(m?.id);
        if (!id) continue;
        const from = str(m?.from);
        const type = str(m?.type);
        const text = type === 'text' ? str(m?.text?.body)
          : type === 'button' ? str(m?.button?.text)
            : type === 'interactive' ? str(m?.interactive?.list_reply?.title || m?.interactive?.button_reply?.title)
              : '';
        out.push({
          id, from, type, text,
          name: names.get(from) || '',
          at: Number(m?.timestamp) ? Number(m.timestamp) * 1000 : null,
          // Anything that is not text — an image, a voice note, a location.
          // Carried rather than dropped so the caller can say "I can't read
          // that yet" instead of silently ignoring him.
          unsupported: !TEXT_TYPES.includes(type),
        });
      }
    }
  }
  return out;
}

/** True when the payload is only delivery/read receipts. */
export const isStatusOnly = payload =>
  inboundMessages(payload).length === 0
  && (Array.isArray(payload?.entry) ? payload.entry : [])
    .some(e => (Array.isArray(e?.changes) ? e.changes : []).some(c => Array.isArray(c?.value?.statuses) && c.value.statuses.length));

// -------------------------------------------------------------- who may talk

/** Digits only, so +91 98765 43210 and 919876543210 are the same number. */
export const normNumber = n => str(n).replace(/\D/g, '');

/**
 * The security boundary.
 *
 * `reply: false` on a refusal is the point: an unknown sender gets SILENCE. Any
 * reply — even a refusal — confirms the number is live and that something is
 * listening, which is exactly what someone probing wants to learn.
 */
export function allowed(from, allowlist) {
  const list = (Array.isArray(allowlist) ? allowlist : str(allowlist).split(','))
    .map(normNumber).filter(Boolean);
  if (!list.length) {
    // An empty allowlist is a CLOSED door, not an open one. A misconfigured
    // env var must never turn the bot into a public assistant wired to his life.
    return { ok: false, reply: false, reason: 'no allowlist configured — refusing everyone' };
  }
  const who = normNumber(from);
  if (!who || !list.includes(who)) return { ok: false, reply: false, reason: 'sender not on the allowlist' };
  return { ok: true };
}

// ------------------------------------------------------------- idempotency

export const SEEN_MAX = 200;

/**
 * Meta retries. Twice-delivered "add a task" must not be two tasks.
 *
 * Keyed on the message id, which Meta guarantees is stable across retries of
 * the same message. The list is capped because it lives in a memory blob and
 * an unbounded one grows forever.
 */
export function seenBefore(id, seen) {
  const list = Array.isArray(seen) ? seen.map(str) : [];
  return list.includes(str(id));
}
export function remember(id, seen) {
  const list = Array.isArray(seen) ? seen.map(str) : [];
  const key = str(id);
  if (!key || list.includes(key)) return list.slice(-SEEN_MAX);
  return [...list, key].slice(-SEEN_MAX);
}

// ------------------------------------------------------------------ routing

/**
 * Which lane a message goes down.
 *
 * The distinction is how long the answer takes, not how clever it is. A chat
 * reply has seconds; anything that needs a build, a research pass or a worker
 * is queued and answered later. Pretending otherwise produces a bot that goes
 * quiet for ten minutes, which reads as broken.
 */
export const BUILD_WORDS = /\b(build|make me|create an app|write a script|set up a|implement)\b/i;
export const HELP_WORDS = /^\s*(help|\?|commands|what can you do)\s*$/i;

export function route(text) {
  const t = str(text);
  if (!t) return { lane: 'ignore', why: 'empty message' };
  if (HELP_WORDS.test(t)) return { lane: 'help' };
  if (BUILD_WORDS.test(t)) return { lane: 'queued', kind: 'build', text: t };
  return { lane: 'fast', text: t };
}

/**
 * What the bot says it is.
 *
 * Meta's 15 Jan 2026 policy bans general-purpose AI assistants on the platform;
 * a task-specific bot is fine. This wording is task-specific on purpose and is
 * the text the help command returns — it is a description of a personal
 * dashboard's remote control, not an assistant that will do anything you ask.
 */
export const HELP_TEXT = [
  'PLAYER ONE — your dashboard, over WhatsApp.',
  '',
  '· add a task, move one, mark one done',
  '· ask about today: classes, meetings, what is next',
  '· log a habit',
  '· save a note to your vault',
  '· "build …" queues a spec and comes back when it is done',
  '',
  'It only answers you, and only about your own dashboard.',
].join('\n');

// ------------------------------------------------------------------ outbound

// WhatsApp rejects a body over 4096 characters outright.
export const MAX_BODY = 4096;

/**
 * Split a long answer at paragraph and line boundaries where it can.
 *
 * Cutting mid-word produces two messages that each look like a bug. This is not
 * a formatting nicety — an answer split badly is read as an answer that went
 * wrong.
 */
export function chunk(text, max = MAX_BODY) {
  const t = str(text);
  if (!t) return [];
  if (t.length <= max) return [t];
  const out = [];
  let rest = t;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    const cut = Math.max(window.lastIndexOf('\n\n'), window.lastIndexOf('\n'), window.lastIndexOf(' '));
    const at = cut > max * 0.5 ? cut : max;   // a cut near the start is worse than a hard one
    out.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) out.push(rest);
  return out;
}

export const outboundPayload = (to, body) => ({
  messaging_product: 'whatsapp',
  recipient_type: 'individual',
  to: normNumber(to),
  type: 'text',
  text: { preview_url: false, body: str(body).slice(0, MAX_BODY) },
});

// --------------------------------------------------------- the 24-hour window

export const WINDOW_H = 24;

/**
 * Whether the bot may message him unprompted.
 *
 * Meta only allows free-form messages within 24 hours of the user's last
 * message; outside that it has to be an approved template. This matters for the
 * proactive half — the nudges, and the "your build finished" reply that comes
 * back an hour later. A queued job that takes three hours may find the window
 * shut, and the honest thing is to know that in advance rather than to discover
 * it as a failed send.
 */
export function windowOpen(lastInboundAt, now = Date.now()) {
  const t = Number(lastInboundAt);
  if (!Number.isFinite(t) || t <= 0) return { open: false, why: 'he has never messaged the bot, so there is no window at all' };
  const hours = (now - t) / 3600000;
  if (hours >= WINDOW_H) {
    return { open: false, hours, why: `his last message was ${Math.round(hours)}h ago — outside Meta's ${WINDOW_H}h window, a free-form message is refused and only an approved template gets through` };
  }
  return { open: true, hours, leftH: WINDOW_H - hours };
}

// --------------------------------------------------------------- confirming
//
// There is no confirmation CARD on WhatsApp. The dock can render a proposal and
// wait for a click; a chat thread cannot, and pretending otherwise produces
// either a bot that asks "are you sure?" about everything — which trains you to
// type yes without reading — or one that quietly does whatever it thought you
// meant.
//
// So the line is drawn by consequence, exactly as it is in the dock:
//
//   reversible  (add a task, log a habit, save a note) — DONE IMMEDIATELY and
//               reported. Asking permission to add a todo is friction with no
//               safety in it; undoing one costs a tap.
//   destructive (delete a task, cancel an event) — held, and it needs a plain
//               "yes" as the NEXT message. Cancelling an event removes it from
//               other people's calendars, and that is not recoverable by
//               tapping undo.
//
// The hold expires. A "yes" typed forty minutes later, to a question he has
// forgotten, is not consent.

export const CONFIRM_TTL_MIN = 5;
const YES = /^\s*(y|ye|yes|yeah|yep|ok|okay|do it|confirm|go ahead)\s*[.!]?\s*$/i;
const NO = /^\s*(n|no|nope|cancel|stop|don'?t|nevermind|never mind)\s*[.!]?\s*$/i;

export const isYes = t => YES.test(str(t));
export const isNo = t => NO.test(str(t));

/**
 * Resolve a held action against what he just said.
 *
 * Anything that is NOT a clear yes or no is treated as a new message and the
 * hold is dropped — because "actually, add milk to the list" after a delete
 * prompt means he has moved on, and answering it as consent would be the worst
 * possible reading.
 */
export function resolveConfirm(pending, text, now = Date.now()) {
  if (!pending?.action) return { state: 'none' };
  const age = (now - Number(pending.at || 0)) / 60000;
  if (!Number.isFinite(age) || age > CONFIRM_TTL_MIN) {
    return { state: 'expired', text: `That was a while ago, so I have not done it. Ask again if you still want to.` };
  }
  if (isYes(text)) return { state: 'confirmed', action: pending.action };
  if (isNo(text)) return { state: 'declined', text: 'Left it alone.' };
  return { state: 'moved-on', text: null };
}

/** The question a held action asks. States the consequence, not just the verb. */
export function confirmPrompt(action) {
  const verb = str(action?.do);
  if (verb === 'cancel_event') {
    return `Cancel “${str(action.title)}”? That removes it from the calendar for everyone on it. Reply yes if you mean it.`;
  }
  if (verb === 'delete_todo') {
    return `Delete “${str(action.title)}”? That destroys the task rather than completing it. Reply yes if you mean it.`;
  }
  return `Do “${verb}”? Reply yes to confirm.`;
}

// ------------------------------------------------------------------ the gate

/**
 * Everything that has to be true before a message is acted on, in one call and
 * in the right order.
 *
 * Order matters: signature before parsing (never parse what is not ours),
 * allowlist before dedupe (an unknown sender should not even occupy a slot in
 * the seen list), dedupe before work.
 */
export function gate({ message, allowlist, seen }) {
  const who = allowed(message?.from, allowlist);
  if (!who.ok) return { act: false, reply: false, reason: who.reason };
  if (seenBefore(message?.id, seen)) return { act: false, reply: false, reason: 'already handled — Meta retried' };
  if (message?.unsupported) {
    return {
      act: false, reply: true,
      // He IS allowed, so he gets an answer. Silence here would read as the bot
      // being broken rather than as a limit.
      text: "I can only read text for now — send that as a message and I'll act on it.",
      reason: `unsupported type: ${str(message?.type) || 'unknown'}`,
    };
  }
  return { act: true, reply: true, route: route(message?.text) };
}
