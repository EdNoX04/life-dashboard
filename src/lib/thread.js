// PLAYER TWO's conversation, made to survive a reload.
//
// `msgs` was component state and nothing else, so every refresh, every crash and
// every phone-locks-and-Safari-discards-the-tab threw the thread away. An
// assistant you have to re-explain yourself to is a search box with extra steps.
//
// It persists to Supabase rather than localStorage on purpose: the same thread
// then continues on the phone, which is where half of these questions get asked.
// This is also the seam the Obsidian memory work plugs into later — one place
// that already knows how to load and save a conversation.
//
// Pure on purpose: the React and network half lives in the component, so these
// rules can be tested under plain node.

export const THREAD_KEY = 'p2_thread';

// How much is KEPT, and how much is SENT. Two different numbers for two
// different costs. Keeping is cheap — one JSON blob. Sending is not: the whole
// array goes to the model on every single turn, so an un-capped thread quietly
// makes each reply slower and dearer than the last, forever. Before this file
// the array was capped only by how long the tab stayed open, which was a real
// limit; persisting it removes that limit, so the cap has to be explicit.
export const KEEP = 40;
export const SEND = 16;

const okRole = r => r === 'user' || r === 'assistant';

/**
 * Whatever came back from the database, turned into something safe to render.
 * This blob is read back from storage, so it must be treated as untrusted shape
 * rather than assumed: a half-written value, an older schema, or a hand-edited
 * row should cost the thread, not the tab.
 */
export function sanitizeThread(raw) {
  const arr = Array.isArray(raw) ? raw : Array.isArray(raw?.msgs) ? raw.msgs : [];
  const out = [];
  for (const m of arr) {
    if (!m || typeof m !== 'object') continue;
    if (!okRole(m.role)) continue;
    const content = typeof m.content === 'string' ? m.content : '';
    if (!content.trim()) continue;
    out.push({ role: m.role, content });
  }
  return out.slice(-KEEP);
}

/** What gets stored: the tail, capped. */
export const trimForStore = msgs => sanitizeThread(msgs);

/**
 * What gets sent to the model. Trimmed harder than storage, and never starting
 * on an assistant turn — a window that opens mid-answer reads as the model
 * having said something unprompted, and some providers reject it outright.
 */
export function trimForSend(msgs) {
  const clean = sanitizeThread(msgs);
  let tail = clean.slice(-SEND);
  while (tail.length && tail[0].role !== 'user') tail = tail.slice(1);
  // A single trailing user message is always valid, so this can only empty out
  // if there were no user turns at all — in which case there is nothing to ask.
  return tail;
}

/** True when the stored thread differs from what is in hand — skips no-op writes. */
export function threadChanged(a, b) {
  const x = sanitizeThread(a), y = sanitizeThread(b);
  if (x.length !== y.length) return true;
  return x.some((m, i) => m.role !== y[i].role || m.content !== y[i].content);
}
