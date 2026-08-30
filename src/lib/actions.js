// What PLAYER TWO is allowed to DO, and how it asks.
//
// Until now it could only describe. "Add that to my todos" got a sentence about
// how to add it yourself, which is the difference between an assistant and a
// search box that reads your database.
//
// WHY A TEXT CONVENTION AND NOT TOOL CALLING
// The /api/chat proxy passes `tools` to Anthropic only for web search, and the
// 'home' agent routes to the free tier, which may be a different provider
// entirely. A model-agnostic convention works on all of them and costs one
// fenced block; native tool calling would work on one path and silently do
// nothing on the other, which is the worse failure.
//
// THE SAFETY MODEL, stated plainly:
// the model's output is NOT a trusted instruction. It proposes; Neel confirms;
// only then does anything happen. So this file's job is to make sure a proposal
// can never be more than one of a fixed set of shapes:
//
//   - a closed allowlist of verbs, each with a fixed field list. No table name,
//     no column, no filter ever crosses this boundary from the model.
//   - nothing that deletes, and nothing that touches money.
//   - a hard cap on how many actions one reply may propose, so a confused model
//     cannot bury a real one under twenty confirmation cards.
//
// Everything here is pure so it can be tested without a browser or a network.

const MAX_ACTIONS = 2;
const MAX_TEXT = 200;

// The allowlist. Adding a verb here is a deliberate act; nothing is generic.
export const ACTIONS = {
  add_todo: {
    fields: { title: 'text', due: 'date?' },
    describe: a => `Add task “${a.title}”${a.due ? ` — due ${a.due}` : ''}`,
  },
  complete_todo: {
    // By title, not id: the model is given task titles in its context and never
    // sees a database id. Handing it an id field would invite it to invent one.
    fields: { title: 'text' },
    describe: a => `Mark “${a.title}” as done`,
  },
  log_habit: {
    fields: { name: 'text' },
    describe: a => `Log habit “${a.name}” for today`,
  },
  fbl_done: {
    fields: {},
    describe: () => 'Mark the open Spanish FBL module as done',
  },
};

export const ACTION_NAMES = Object.keys(ACTIONS);

// Taught to the model in the system prompt. Kept beside the allowlist so the
// two cannot drift — a prompt describing a verb this file rejects would produce
// an assistant that promises things that never happen.
export const ACTION_INSTRUCTIONS = [
  'You may propose actions. To do so, end your reply with a fenced block:',
  '```action',
  '{"do":"add_todo","title":"Email Krati mam","due":"2026-09-02"}',
  '```',
  `Allowed: ${ACTION_NAMES.join(', ')}.`,
  'add_todo takes title and optional due (YYYY-MM-DD). complete_todo takes title.',
  'log_habit takes name. fbl_done takes nothing.',
  'Propose an action only when asked to do something — never to answer a question.',
  'Never propose more than two. Keep your prose answer above the block, and do not mention the block itself.',
  'Nothing happens until Neel confirms, so do not claim you have done it — say what you are about to do.',
].join('\n');

const FENCE = /```action\s*([\s\S]*?)```/g;

const cleanText = v => (typeof v === 'string' ? v.trim().slice(0, MAX_TEXT) : '');
const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

/** Prose with the machinery removed. Neel should never see a JSON block. */
export function stripActions(text) {
  return String(text || '').replace(FENCE, '').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * The same, for text that is still arriving.
 *
 * While streaming, the closing fence has not been written yet, so `stripActions`
 * sees no complete block and happily renders ```action {"do":"add_todo"… as it
 * types itself out. The machinery would flash on screen for a second or two and
 * then vanish — which looks like a glitch, and worse, shows the user the raw
 * shape of something they were meant to meet as a button.
 */
export function stripActionsLive(text) {
  let out = String(text || '').split('```action')[0];
  // The fence itself arrives one character at a time, so the tail can be any
  // PREFIX of it — a lone backtick, then two, then "```a", "```ac"… Trimming
  // only the complete fence would let the opening tick-marks flicker on screen
  // for a few frames each. Every prefix begins with a backtick, so ordinary
  // prose (and a fence for some other language, "```js") is never touched.
  const START = '```action';
  for (let n = Math.min(START.length, out.length); n > 0; n--) {
    if (out.endsWith(START.slice(0, n))) { out = out.slice(0, -n); break; }
  }
  return out.replace(/\n{3,}/g, '\n\n').trimEnd();
}

/**
 * Pull proposals out of a reply.
 * Returns { prose, actions, rejected } — `rejected` carries a reason per bad
 * block, because an action silently dropped is indistinguishable from a model
 * that ignored the request.
 */
export function parseActions(text) {
  const raw = String(text || '');
  const actions = [];
  const rejected = [];

  for (const m of raw.matchAll(FENCE)) {
    if (actions.length >= MAX_ACTIONS) { rejected.push('too many actions proposed'); continue; }
    let obj;
    try { obj = JSON.parse(m[1].trim()); } catch { rejected.push('unreadable action block'); continue; }
    const list = Array.isArray(obj) ? obj : [obj];
    for (const item of list) {
      if (actions.length >= MAX_ACTIONS) { rejected.push('too many actions proposed'); break; }
      const built = build(item);
      if (built.ok) actions.push(built.action); else rejected.push(built.reason);
    }
  }
  return { prose: stripActions(raw), actions, rejected };
}

function build(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return { ok: false, reason: 'not an action object' };
  const verb = typeof item.do === 'string' ? item.do : '';
  const spec = Object.prototype.hasOwnProperty.call(ACTIONS, verb) ? ACTIONS[verb] : null;
  if (!spec) return { ok: false, reason: `unknown action "${String(verb).slice(0, 40)}"` };

  // Built field by field from the spec, never by copying the model's object.
  // Anything it invented — a table, an id, an extra column — is simply not read.
  const action = { do: verb };
  for (const [field, kind] of Object.entries(spec.fields)) {
    const optional = kind.endsWith('?');
    const type = optional ? kind.slice(0, -1) : kind;
    const value = item[field];
    if (value === undefined || value === null || value === '') {
      if (!optional) return { ok: false, reason: `${verb} needs ${field}` };
      continue;
    }
    if (type === 'text') {
      const t = cleanText(value);
      if (!t) return { ok: false, reason: `${verb} needs ${field}` };
      action[field] = t;
    } else if (type === 'date') {
      if (!isDate(value)) return { ok: false, reason: `${field} must look like 2026-09-02` };
      action[field] = value;
    }
  }
  return { ok: true, action };
}

export function describeAction(a) {
  const spec = a && ACTIONS[a.do];
  return spec ? spec.describe(a) : 'Unknown action';
}

// ---------------------------------------------------------------- resolving
// The model names things; these turn a name into a row, or refuse.
//
// Refusing matters more than matching. Completing the wrong task because two
// start with the same word is worse than asking, and it is silent.

const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

function resolveBy(name, rows, field) {
  const want = norm(name);
  if (!want) return { ok: false, reason: 'nothing to match' };
  const exact = rows.filter(r => norm(r[field]) === want);
  if (exact.length === 1) return { ok: true, row: exact[0] };
  if (exact.length > 1) return { ok: false, reason: `more than one is called “${name}”` };
  const partial = rows.filter(r => norm(r[field]).includes(want));
  if (partial.length === 1) return { ok: true, row: partial[0] };
  if (partial.length > 1) return { ok: false, reason: `“${name}” matches ${partial.length} of them — say which` };
  return { ok: false, reason: `nothing called “${name}”` };
}

/** Open todos only: "mark X done" must never re-complete something finished. */
export const resolveTodo = (title, todos = []) =>
  resolveBy(title, todos.filter(t => !t.completed), 'title');

/** Live habits only. */
export const resolveHabit = (name, habits = []) =>
  resolveBy(name, habits.filter(h => !h.archived), 'name');
