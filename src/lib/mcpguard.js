// The permission model for exposing PLAYER ONE over MCP — written before a
// single tool does anything, which is the whole point.
//
// "Connect my webapp to Cowork via MCP so that it can build projects
// autonomously" is the largest surface anything in this project has ever been
// given. Hermes already settled the shape of the answer for the VAULT: an
// allowlist, because a denylist has to be complete to work and never is — the
// next secret is always the one nobody thought to add. This file is that same
// argument applied to the dashboard's own data, where the stakes are higher
// because the dashboard holds money, health and therapy summaries.
//
// THREE RULES, AND THEY ARE NOT TECHNICAL
//
//   1. MONEY AND HEALTH ARE NOT REACHABLE. Not read, not written, not
//      summarised, not counted. Not because an agent would misuse them, but
//      because the blast radius of being wrong about that is a category of
//      thing this project has spent its whole life refusing — and Money has
//      been read-only since the first commit.
//   2. AUTONOMOUS MEANS UNSUPERVISED STEPS, NOT UNAGREED GOALS. The build
//      intake already has the right answer: Neel confirms a SPEC, then work
//      happens against that spec without him watching each step. A tool that
//      widens the goal mid-run is not autonomy, it is scope creep with a
//      keyboard.
//   3. EVERY TOOL IS DECLARED, WITH ITS SCOPE, ITS SIDE EFFECTS AND WHETHER IT
//      NEEDS A CLICK. A tool that is not in this file does not exist — an
//      unlisted name resolves to a refusal, never to a default.

const str = v => String(v ?? '').trim();

/**
 * Scopes, and what is deliberately missing from the list.
 *
 * There is no `money` scope and no `health` scope. Their absence is the
 * feature: a future tool cannot ask for one, because asking for a scope that
 * does not exist is a refusal rather than a request.
 */
export const SCOPES = [
  { key: 'vault.read', label: 'Read vault notes', note: 'markdown inside the vault only, the same allowlist Hermes runs under' },
  { key: 'vault.write', label: 'Write vault notes', note: 'through the inbox, path built by us, never taken from the caller' },
  { key: 'builds.read', label: 'Read build specs', note: 'projects/*.md and their progress' },
  { key: 'builds.write', label: 'Update build progress', note: 'progress and status on a spec Neel already confirmed' },
  { key: 'tasks.read', label: 'Read todos', note: 'titles, dates and completion only' },
  { key: 'tasks.write', label: 'Add or change todos', note: 'never delete' },
  { key: 'college.read', label: 'Read timetable and attendance', note: 'read-only, always' },
];
export const SCOPE_KEYS = SCOPES.map(s => s.key);

/**
 * Named so they cannot be added by accident. A scope string that looks like
 * one of these is refused loudly rather than treated as unknown, because
 * "unknown scope" is the message you skim past and "this is forbidden by
 * design" is the one you stop at.
 */
export const FORBIDDEN_SCOPES = [
  'money.read', 'money.write', 'health.read', 'health.write',
  'therapy.read', 'therapy.write', 'secrets.read', 'admin',
];

export const isForbidden = scope => FORBIDDEN_SCOPES.includes(str(scope))
  || /^(money|health|therapy|secret|credential|token|key)[.:]/i.test(str(scope));

/**
 * Every tool the server may expose.
 *
 * `confirm: true` means a human click before it happens, no matter who asked or
 * how confidently. `destructive` is not listed at all — nothing here deletes,
 * and adding a deleting tool should require editing this comment as well as
 * this list.
 */
export const TOOLS = [
  { name: 'vault_search', scope: 'vault.read', writes: false, confirm: false, note: 'search notes by text' },
  { name: 'vault_read', scope: 'vault.read', writes: false, confirm: false, note: 'read one note by path' },
  { name: 'vault_append', scope: 'vault.write', writes: true, confirm: false, note: 'append to a note through the inbox' },
  { name: 'build_list', scope: 'builds.read', writes: false, confirm: false, note: 'queued and in-progress specs' },
  { name: 'build_progress', scope: 'builds.write', writes: true, confirm: false, note: 'append progress to a confirmed spec' },
  { name: 'build_status', scope: 'builds.write', writes: true, confirm: true, note: 'mark a spec done or blocked' },
  { name: 'todo_list', scope: 'tasks.read', writes: false, confirm: false, note: 'open tasks' },
  { name: 'todo_add', scope: 'tasks.write', writes: true, confirm: true, note: 'add a task' },
  { name: 'timetable_today', scope: 'college.read', writes: false, confirm: false, note: "today's classes" },
];
export const toolOf = n => TOOLS.find(t => t.name === str(n)) || null;

/**
 * May this call happen?
 *
 * Fails CLOSED at every branch. An unknown tool, an unknown scope, a scope the
 * grant does not carry, a forbidden scope — all refusals, and each says which
 * so a misconfiguration is fixable rather than mysterious.
 */
export function allow(toolName, grant = {}) {
  const tool = toolOf(toolName);
  if (!tool) return { ok: false, reason: 'unknown-tool', text: `No tool called "${str(toolName).slice(0, 40)}". A tool that is not declared does not exist.` };
  if (isForbidden(tool.scope)) return { ok: false, reason: 'forbidden', text: `${tool.name} asks for ${tool.scope}, which is forbidden by design and cannot be granted.` };
  if (!SCOPE_KEYS.includes(tool.scope)) return { ok: false, reason: 'unknown-scope', text: `${tool.name} asks for a scope that does not exist.` };

  // A default parameter does NOT apply when null is passed explicitly, and a
  // null grant threw here rather than refusing — which is the exact opposite of
  // failing closed, in the function whose whole job is to fail closed.
  const g = grant && typeof grant === 'object' ? grant : {};
  const held = Array.isArray(g.scopes) ? g.scopes.map(str) : [];
  if (held.some(isForbidden)) {
    // A grant carrying a forbidden scope is not partially honoured — the whole
    // grant is suspect, because something produced it that should not have.
    return { ok: false, reason: 'tainted-grant', text: 'This grant claims a scope that cannot exist. Nothing from it is honoured.' };
  }
  if (!held.includes(tool.scope)) return { ok: false, reason: 'not-granted', text: `${tool.name} needs ${tool.scope}, which this connection was not given.` };
  if (tool.writes && g.readOnly) return { ok: false, reason: 'read-only', text: `${tool.name} writes, and this connection is read-only.` };
  return { ok: true, tool, confirm: tool.confirm };
}

/**
 * The scopes a grant should actually ask for, given what it says it needs.
 *
 * Filtered rather than validated: a request naming a forbidden scope is
 * narrowed to the allowed ones and the refusal is reported alongside, so a
 * connection asking for too much still works for the part it legitimately
 * needed. Refusing the whole grant would push people toward asking for
 * everything at once and hoping.
 */
export function narrow(requested) {
  const asked = (Array.isArray(requested) ? requested : []).map(str).filter(Boolean);
  const granted = asked.filter(s => SCOPE_KEYS.includes(s) && !isForbidden(s));
  const refused = asked.filter(s => !granted.includes(s));
  return { granted, refused, complete: refused.length === 0 };
}

// ---------------------------------------------------------------- the goal

/**
 * Autonomy, bounded by a spec Neel confirmed.
 *
 * The check is not "is this allowed" — `allow()` does that — it is "is this
 * still the job we agreed on". A run that starts against one spec and ends up
 * touching another has not gone rogue; it has quietly redefined what it was
 * asked to do, which is the failure mode nobody notices until the diff.
 */
export function withinSpec(run, spec) {
  const r = run && typeof run === 'object' ? run : {};
  const sp = spec && typeof spec === 'object' ? spec : {};
  const specId = str(sp.id);
  if (!specId) return { ok: false, reason: 'no-spec', text: 'Autonomous work needs a confirmed spec. Without one there is nothing to be within.' };
  if (str(r.specId) !== specId) return { ok: false, reason: 'wrong-spec', text: 'This run is acting on a different spec from the one that was confirmed.' };
  if (str(sp.status) === 'done' || str(sp.status) === 'blocked') {
    return { ok: false, reason: 'closed', text: `That spec is ${sp.status}. Reopening it is a decision, not a step.` };
  }
  return { ok: true };
}

/** What to show Neel when a connection is set up. Plain, and complete. */
export function describeGrant(grant) {
  const g = grant && typeof grant === 'object' ? grant : {};
  const held = Array.isArray(g.scopes) ? g.scopes.map(str) : [];
  const tools = TOOLS.filter(t => held.includes(t.scope));
  return {
    reads: tools.filter(t => !t.writes).map(t => t.name),
    writes: tools.filter(t => t.writes).map(t => t.name),
    needsClick: tools.filter(t => t.confirm).map(t => t.name),
    // Stated positively as well as negatively. "It cannot see your money" is
    // the sentence someone actually wants, and it should not have to be
    // inferred from an absence.
    cannot: ['your money', 'your health and body data', 'therapy sessions', 'any key or credential'],
  };
}
