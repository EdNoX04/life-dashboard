// "I have an idea, build it" → a spec that survives the conversation.
//
// From the build plan: PLAYER TWO recognises a build request, and the
// confirmation is NOT a yes/no — it is the spec, broken into steps, for Neel to
// confirm or correct. The spec then lands in the vault as `projects/<slug>.md`,
// which is the whole trick: intake, plan, progress and retrospective are ONE
// FILE, editable in Obsidian, versioned in git, and readable by every part of
// the system that already reads the vault. Not a new table, not a new schema.
// Hermes later works through the same file and ticks the boxes.
//
// WHY THERE ARE NO HOURS IN HERE
//
// The plan is explicit and it is the right call: "An LLM asked 'how long will
// this take' produces a confident number with nothing behind it, and a confident
// wrong number is worse than none: it becomes the thing Neel plans around."
//
// So a step carries a SIZE — S, M or L — and the summary is a count, never a
// duration. The honest version of an estimate arrives later, calibrated against
// the started/finished timestamps of builds that actually happened. That
// ordering also means the first few builds pay for the estimates of every build
// after them.

// hermes.js imports nothing, so this direction is safe and there is no cycle.
// Reading the claim here rather than in the tab keeps one parser for the file.
import { readClaim } from './hermes.js';

export const SIZES = ['S', 'M', 'L'];

export const SIZE_LABEL = { S: 'small', M: 'medium', L: 'large' };

/** A step line in the note. Checkbox so Hermes — or Neel — can tick it. */
const stepLine = s => `- [${s.done ? 'x' : ' '}] **${s.size}** — ${s.text}`;

// `- [x] **M** — do the thing`, tolerant of the ways markdown gets typed by hand.
const STEP_RE = /^\s*[-*]\s*\[( |x|X)\]\s*(?:\*\*)?\s*([SMLsml])\s*(?:\*\*)?\s*[—\-–:]\s*(.+?)\s*$/;

export function normalizeSize(v) {
  const s = String(v || '').trim().toUpperCase();
  return SIZES.includes(s) ? s : null;
}

/**
 * A step from whatever the model produced.
 *
 * It will hand back `"S: wire the endpoint"`, `{size:'s', text:'...'}`, or a bare
 * sentence with no size at all. A bare sentence gets M rather than being
 * dropped: a step with an unknown size is still a step, and losing it silently
 * would make the plan look shorter than the work.
 */
export function toStep(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const text = String(raw.text ?? raw.step ?? raw.title ?? '').trim();
    if (!text) return null;
    return { size: normalizeSize(raw.size) || 'M', text: text.slice(0, 200), done: Boolean(raw.done) };
  }
  const line = String(raw || '').trim();
  if (!line) return null;
  const m = /^([SMLsml])\s*[:\-—–]\s*(.+)$/.exec(line);
  if (m) return { size: normalizeSize(m[1]), text: m[2].trim().slice(0, 200), done: false };
  return { size: 'M', text: line.slice(0, 200), done: false };
}

export function toSteps(list, max = 20) {
  const arr = Array.isArray(list) ? list : String(list || '').split('\n');
  return arr.map(toStep).filter(Boolean).slice(0, max);
}

/**
 * The count, by size. Never a duration.
 *
 * Reads "6 steps — 3 S, 2 M, 1 L" rather than "about 9 hours", because the
 * second one is a number Neel would plan around and there is nothing behind it.
 */
export function sizeSummary(steps = []) {
  if (!steps.length) return 'no steps yet';
  const by = { S: 0, M: 0, L: 0 };
  for (const s of steps) by[s.size] = (by[s.size] || 0) + 1;
  const bits = SIZES.filter(k => by[k]).map(k => `${by[k]} ${k}`);
  return `${steps.length} step${steps.length === 1 ? '' : 's'} — ${bits.join(', ')}`;
}

export function progressOf(steps = []) {
  const done = steps.filter(s => s.done).length;
  return { done, total: steps.length, pct: steps.length ? Math.round((done / steps.length) * 100) : 0 };
}

export const STATUSES = ['queued', 'building', 'blocked', 'done'];

/**
 * The note body. Front matter is added by lib/vault.js, which owns that shape.
 *
 * The headings are fixed because Hermes reads this file back and writes progress
 * into it. A section it cannot find is a section it will append a second copy of.
 */
export function specNote({ title, why = '', steps = [], status = 'queued' }) {
  const list = toSteps(steps);
  return [
    `**Status** ${STATUSES.includes(status) ? status : 'queued'}`,
    `**Plan** ${sizeSummary(list)}`,
    '',
    '## Why',
    String(why || '').trim() || '_Not written down yet — say what this is for before building it._',
    '',
    '## Steps',
    list.length ? list.map(stepLine).join('\n') : '_No steps yet._',
    '',
    '## Progress',
    '_Hermes writes here. Each line: what changed, and what it learned._',
    '',
    '## Retrospective',
    '_Filled in when it ships: what took longer than its size said, and why._',
  ].join('\n');
}

const section = (body, name) => {
  const re = new RegExp(`^##\\s+${name}\\s*$([\\s\\S]*?)(?=^##\\s|\\Z)`, 'im');
  const m = re.exec(String(body || ''));
  return m ? m[1].trim() : '';
};

/**
 * A vault note → a build.
 *
 * Reads the note's own text rather than a database row, so a spec Neel edited in
 * Obsidian on the train is the same object the Builds tab renders. That is the
 * point of putting it in the vault.
 */
export function parseSpec(note) {
  const body = typeof note === 'string'
    ? note
    : (note?.chunks || []).map(c => (c.heading ? `## ${c.heading}\n${c.text}` : c.text)).join('\n\n');

  const steps = [];
  for (const line of String(body || '').split('\n')) {
    const m = STEP_RE.exec(line);
    if (m) steps.push({ size: normalizeSize(m[2]), text: m[3].trim(), done: m[1].toLowerCase() === 'x' });
  }

  const statusM = /\*\*Status\*\*\s*([a-z]+)/i.exec(body || '');
  const status = STATUSES.includes(String(statusM?.[1] || '').toLowerCase())
    ? String(statusM[1]).toLowerCase() : 'queued';

  return {
    path: typeof note === 'string' ? '' : (note?.path || ''),
    title: typeof note === 'string' ? '' : (note?.title || ''),
    updated: typeof note === 'string' ? null : (note?.updated || null),
    status,
    // Who is holding it, if anyone. Without this a spec left `building` by an
    // agent that stopped is invisible: not queued so nothing picks it up, not
    // done so nothing complains.
    claim: readClaim(body),
    why: section(body, 'Why').replace(/^_.*_$/m, '').trim(),
    steps,
    progress: progressOf(steps),
    summary: sizeSummary(steps),
    notes: section(body, 'Progress').replace(/^_.*_$/m, '').trim(),
  };
}

/**
 * Every build spec in the vault, most recently touched first.
 *
 * `byType` is passed in rather than imported so this file stays pure and the
 * caller decides which index it is reading.
 */
export function buildsFrom(notes = []) {
  return (Array.isArray(notes) ? notes : [])
    .map(parseSpec)
    .sort((a, b) => String(b.updated || '').localeCompare(String(a.updated || '')));
}
