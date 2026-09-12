// The MCP permission model.
//
// This file is tested before anything is built on it because that is the only
// order in which the answer is honest. A permission model written after the
// tools exist is a description of what they already do.
//
// The property under test throughout is FAILING CLOSED: every unknown, every
// gap, every malformed grant is a refusal that says which. The expensive
// direction is the safe one.

import {
  SCOPES, SCOPE_KEYS, FORBIDDEN_SCOPES, TOOLS, toolOf,
  isForbidden, allow, narrow, withinSpec, describeGrant,
} from '../src/lib/mcpguard.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log('FAIL ' + n); } };
const eq = (a, b, n) => ok(Object.is(a, b), `${n} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const grant = (...scopes) => ({ scopes });

// =========================================================================
// WHAT IS NOT REACHABLE, AND CANNOT BECOME REACHABLE
// =========================================================================
{
  // The absence is the feature: a tool cannot ask for a scope that does not
  // exist, so there is nothing to grant by mistake.
  for (const gone of ['money.read', 'money.write', 'health.read', 'therapy.read']) {
    ok(!SCOPE_KEYS.includes(gone), `there is no ${gone} scope at all`);
    ok(isForbidden(gone), `and naming it is a refusal, not an unknown — "forbidden by design" is the message you stop at`);
  }
  ok(isForbidden('money.anything'), 'the whole money namespace is closed, not just the names someone listed');
  ok(isForbidden('secrets.read') && isForbidden('credential.list'), 'as are secrets and credentials');
  ok(!isForbidden('vault.read'), 'while the allowed ones are not');

  ok(!TOOLS.some(t => isForbidden(t.scope)),
     'and NO declared tool asks for a forbidden scope — the list cannot contradict itself');
  ok(TOOLS.every(t => SCOPE_KEYS.includes(t.scope)), 'every tool names a scope that exists');
  ok(!TOOLS.some(t => /delete|remove|drop|purge/i.test(t.name)),
     'nothing here deletes — adding a deleting tool should require editing the comment as well as the list');
}

// =========================================================================
// FAILING CLOSED
// =========================================================================
{
  eq(allow('vault_search', grant('vault.read')).ok, true, 'a granted tool is allowed');
  eq(allow('vault_search', grant()).ok, false, 'the same tool without the scope is not');
  eq(allow('vault_search', grant()).reason, 'not-granted', 'and says which scope is missing');

  const unknown = allow('drop_everything', grant('vault.read'));
  eq(unknown.ok, false, 'an undeclared tool does not exist');
  eq(unknown.reason, 'unknown-tool', 'by name');
  ok(/does not exist/.test(unknown.text), 'and resolves to a refusal rather than to a default');

  eq(allow('todo_add', { scopes: ['tasks.write'], readOnly: true }).ok, false, 'a read-only connection cannot write');
  eq(allow('todo_list', { scopes: ['tasks.read'], readOnly: true }).ok, true, 'but can still read');

  // A grant that claims something impossible is not partially honoured.
  const tainted = allow('vault_search', grant('vault.read', 'money.read'));
  eq(tainted.ok, false, 'a grant carrying a forbidden scope is refused ENTIRELY');
  eq(tainted.reason, 'tainted-grant', 'because something produced it that should not have');

  eq(allow(null, grant('vault.read')).ok, false, 'no tool name is a refusal');
  eq(allow('vault_search', null).ok, false, 'and no grant at all is a refusal, not an open door');
}

// ------------------------------------------------------- the click stays put
{
  eq(allow('todo_add', grant('tasks.write')).confirm, true, 'adding a task needs a human click');
  eq(allow('build_status', grant('builds.write')).confirm, true, 'so does calling a build done or blocked');
  eq(allow('build_progress', grant('builds.write')).confirm, false,
     'while writing progress to a spec he already confirmed does not — that is the unsupervised part of "autonomous"');
  eq(allow('vault_search', grant('vault.read')).confirm, false, 'and reading never does');
}

// --------------------------------------------------------------- narrowing
{
  const n = narrow(['vault.read', 'money.read', 'tasks.write', 'nonsense']);
  eq(n.granted.length, 2, 'a request is narrowed to what may be given');
  ok(n.granted.includes('vault.read') && n.granted.includes('tasks.write'), 'keeping the legitimate parts');
  eq(n.refused.length, 2, 'and reporting what was dropped');
  eq(n.complete, false, 'saying the request was not granted in full');
  ok(!n.granted.includes('money.read'), 'money is never in the result');
  eq(narrow(['vault.read']).complete, true, 'a clean request is complete');
  eq(narrow(null).granted.length, 0, 'and rubbish narrows to nothing rather than to everything');
}

// =========================================================================
// AUTONOMOUS MEANS UNSUPERVISED STEPS, NOT UNAGREED GOALS
// =========================================================================
{
  const spec = { id: 'sp1', status: 'building' };
  eq(withinSpec({ specId: 'sp1' }, spec).ok, true, 'work against the confirmed spec proceeds');

  const drift = withinSpec({ specId: 'sp2' }, spec);
  eq(drift.ok, false, 'work that has moved to ANOTHER spec is stopped');
  ok(/different spec/.test(drift.text),
     'a run that ends up touching a different job has not gone rogue — it has quietly redefined what it was asked to do, which nobody notices until the diff');

  eq(withinSpec({ specId: 'sp1' }, {}).ok, false, 'with no confirmed spec there is nothing to be within');
  eq(withinSpec({ specId: 'sp1' }, {}).reason, 'no-spec', 'and autonomy without an agreed goal is refused');
  eq(withinSpec({ specId: 'sp1' }, { id: 'sp1', status: 'done' }).ok, false, 'a finished spec is not reopened by a step');
  ok(/a decision, not a step/.test(withinSpec({ specId: 'sp1' }, { id: 'sp1', status: 'blocked' }).text),
     'and reopening a blocked one is called what it is');
}

// ------------------------------------------------------------ what he is told
{
  const d = describeGrant(grant('vault.read', 'tasks.write'));
  ok(d.reads.includes('vault_search'), 'the setup screen lists what it can read');
  ok(d.writes.includes('todo_add'), 'what it can write');
  ok(d.needsClick.includes('todo_add'), 'and what will still ask him first');
  ok(d.cannot.some(c => /money/.test(c)), 'and says outright that it cannot see his money');
  ok(d.cannot.some(c => /health/.test(c)) && d.cannot.some(c => /therapy/.test(c)),
     'nor his health or therapy — stated POSITIVELY, because that is the sentence someone actually wants and it should not have to be inferred from an absence');
  eq(describeGrant({}).writes.length, 0, 'an empty grant can do nothing');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
