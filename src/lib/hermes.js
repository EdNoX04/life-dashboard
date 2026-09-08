// The contract Hermes works to.
//
// Hermes runs on the Omarchy box with the vault checked out. It reads a spec in
// `projects/`, claims it, works, ticks steps, writes what it learned, and pushes.
// Every one of those is an edit to a MARKDOWN FILE, and the edits are defined
// here — on the side that also reads them — rather than inside the agent.
//
// WHY THE PROTOCOL LIVES ON THIS SIDE
//
// If Hermes invents its own way to tick a box or record progress, then two
// programs are parsing and writing one format from opposite ends of a git
// repo, with no shared tests and a push in between. The failure would not be a
// crash: it would be a build that says "queued" forever while the agent works
// on it, or a Progress section that has been appended to twice and shows the
// older half. Every drift in this codebase so far has looked exactly like that.
//
// So these are pure functions over the note's text. Hermes calls them, or
// matches them exactly; the tests are the specification either way.
//
// WHAT HERMES IS NOT TRUSTED WITH
//
// It runs third-party inference over an aggregator, which is a different trust
// boundary from Anthropic's API. Neel's constraint, in his words: "make sure
// nothing secret goes on these cloud LLMs." So the vault is the ONLY thing it
// reads — no .env, no service key, no session tokens, no amizone.config.json —
// and `scripts/hermes-allowlist.mjs` enforces that as a check rather than a
// hope. This file deliberately contains no credential, no endpoint, and no way
// to reach Supabase: everything it produces is a change to a file in the vault,
// and the vault's own inbox runner is what carries it anywhere else.

export const AGENT = 'hermes';

/**
 * How long a claim stays believable.
 *
 * A spec marked `building` with nobody working on it is worse than one marked
 * queued, because nothing will ever pick it up again. Six hours is well past any
 * real build and well short of "I looked at it yesterday".
 */
export const CLAIM_STALE_H = 6;

export const STATUSES = ['queued', 'building', 'blocked', 'done'];

const iso = (d = new Date()) => d.toISOString().slice(0, 16).replace('T', ' ');
const asText = v => String(v ?? '');

// ---------------------------------------------------------------- status

const STATUS_RE = /^\*\*Status\*\*\s*(.*)$/im;

export function readStatus(body) {
  const m = STATUS_RE.exec(asText(body));
  const word = String(m?.[1] || '').trim().split(/\s+/)[0].toLowerCase();
  return STATUSES.includes(word) ? word : 'queued';
}

/**
 * Set the status line, and say why when it is bad news.
 *
 * `blocked` without a reason is the same as silence: it stops the build and
 * tells nobody what to fix, so the reason is required for that one and the
 * function refuses rather than writing a status nobody can act on.
 */
export function setStatus(body, status, reason = '') {
  const s = String(status || '').toLowerCase();
  if (!STATUSES.includes(s)) return { ok: false, reason: `unknown status "${status}"` };
  if (s === 'blocked' && !String(reason).trim()) {
    return { ok: false, reason: 'blocked needs a reason — a stopped build that says nothing is the same as silence' };
  }
  const line = `**Status** ${s}${reason ? ` — ${String(reason).trim().slice(0, 200)}` : ''}`;
  const text = asText(body);
  // Replaced in place, never appended. Two Status lines and every reader picks
  // a different one.
  const next = STATUS_RE.test(text) ? text.replace(STATUS_RE, line) : `${line}\n${text}`;
  return { ok: true, body: next };
}

// ---------------------------------------------------------------- claiming

const CLAIM_RE = /^\*\*Claimed\*\*\s*(\S+)\s+(.+)$/im;

export function readClaim(body) {
  const m = CLAIM_RE.exec(asText(body));
  if (!m) return null;
  const at = Date.parse(String(m[2]).trim().replace(' ', 'T') + 'Z');
  return { agent: m[1], at: Number.isFinite(at) ? new Date(at).toISOString() : null, raw: m[2].trim() };
}

/**
 * Take the job.
 *
 * Refuses a spec somebody else is already holding, unless that claim has gone
 * stale. This is the whole of the concurrency story and it is deliberately
 * this small: one agent, one laptop, a git repo in between. A lease in a file
 * is enough, and anything more would be machinery for a race that cannot
 * currently happen.
 */
export function claim(body, { agent = AGENT, now = new Date(), staleH = CLAIM_STALE_H } = {}) {
  const text = asText(body);
  const status = readStatus(text);
  if (status === 'done') return { ok: false, reason: 'already done' };

  const held = readClaim(text);
  if (held && held.agent !== agent) {
    const age = held.at ? (now.getTime() - Date.parse(held.at)) / 3600000 : Infinity;
    if (age < staleH) return { ok: false, reason: `held by ${held.agent} since ${held.raw}` };
  }

  const line = `**Claimed** ${agent} ${iso(now)}`;
  let next = CLAIM_RE.test(text) ? text.replace(CLAIM_RE, line) : text;
  if (!CLAIM_RE.test(text)) {
    // Directly under Status, so a human opening the file sees who has it before
    // reading anything else.
    next = STATUS_RE.test(text) ? text.replace(STATUS_RE, m => `${m}\n${line}`) : `${line}\n${text}`;
  }
  return setStatus(next, 'building');
}

/** Let it go — on finishing, or on giving up. */
export function release(body, { status = 'done', reason = '' } = {}) {
  const cleared = asText(body).replace(CLAIM_RE, '').replace(/\n{3,}/g, '\n\n');
  return setStatus(cleared, status, reason);
}

// ---------------------------------------------------------------- progress

const SECTION_RE = name => new RegExp(`^(##\\s+${name}\\s*\\n)([\\s\\S]*?)(?=^##\\s|$)`, 'im');

/**
 * Append one line under `## Progress`.
 *
 * NEVER creates a second `## Progress`. That is the specific failure the fixed
 * headings in buildspec.js exist to prevent: an agent that cannot find a section
 * appends its own, and from then on the file has two and the tab renders the
 * older one. If the section is missing this refuses rather than inventing it —
 * a spec without the standard headings did not come from the intake, and
 * silently repairing it would hide that.
 */
export function appendProgress(body, line, now = new Date()) {
  const text = asText(body);
  const entry = `- ${iso(now)} — ${String(line || '').trim()}`;
  if (!String(line || '').trim()) return { ok: false, reason: 'nothing to record' };

  const re = SECTION_RE('Progress');
  if (!re.test(text)) {
    return { ok: false, reason: 'no ## Progress section — this note did not come from the build intake' };
  }
  return {
    ok: true,
    body: text.replace(re, (_m, head, content) => {
      // The placeholder is replaced the first time, not written above.
      const kept = content.replace(/^_.*_\s*$/m, '').trim();
      return `${head}${kept ? `${kept}\n` : ''}${entry}\n\n`;
    }),
  };
}

// ---------------------------------------------------------------- steps

const stepAt = (text, i) => {
  const lines = asText(text).split('\n');
  let n = -1;
  for (let k = 0; k < lines.length; k++) {
    if (/^\s*[-*]\s*\[( |x|X)\]/.test(lines[k])) {
      n++;
      if (n === i) return { k, lines };
    }
  }
  return null;
};

/**
 * Tick step `i` (0-based, in the order they appear).
 *
 * By POSITION rather than by text, because the agent is working from the list it
 * read and matching on text would let a reworded step tick the wrong box — and a
 * wrongly ticked box is a piece of work that silently never happens.
 */
export function tickStep(body, i, done = true) {
  const hit = stepAt(body, i);
  if (!hit) return { ok: false, reason: `there is no step ${i + 1}` };
  const { k, lines } = hit;
  lines[k] = lines[k].replace(/\[( |x|X)\]/, done ? '[x]' : '[ ]');
  return { ok: true, body: lines.join('\n') };
}

// ---------------------------------------------------------------- health

/**
 * What is wrong right now, from this side of the git repo.
 *
 * Hermes runs on a laptop that sleeps. A spec left `building` by an agent that
 * stopped is invisible otherwise: it is not queued, so nothing picks it up, and
 * it is not done, so nothing complains. Same shape as the sync that went quiet
 * and the note that never reached the vault.
 */
export function hermesHealth(specs = [], now = new Date(), staleH = CLAIM_STALE_H) {
  const list = Array.isArray(specs) ? specs : [];
  const stale = [];
  const blocked = [];
  for (const s of list) {
    if (s?.status === 'blocked') { blocked.push(s); continue; }
    if (s?.status !== 'building') continue;
    const at = s.claim?.at ? Date.parse(s.claim.at) : NaN;
    const age = Number.isFinite(at) ? (now.getTime() - at) / 3600000 : Infinity;
    if (age >= staleH) stale.push({ ...s, hours: Number.isFinite(age) ? Math.round(age) : null });
  }
  return { stale, blocked };
}

/** The next spec an agent should pick up, or null. Oldest queued first. */
export function nextForAgent(specs = [], now = new Date()) {
  const q = (Array.isArray(specs) ? specs : []).filter(s => s?.status === 'queued');
  if (!q.length) return null;
  return q.slice().sort((a, b) => String(a.updated || '').localeCompare(String(b.updated || '')))[0];
}
