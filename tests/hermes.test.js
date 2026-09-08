// The contract Hermes works to.
//
// Hermes edits markdown files in a git repo on another machine; this side reads
// them back after a push. There is no shared process, no transaction, and no way
// to notice a disagreement at the time it happens — so these tests ARE the
// specification, and every one of them is a way the two ends could quietly stop
// agreeing:
//
//   - a second `## Progress` section, after which the tab renders the older half
//   - a second `**Status**` line, after which each reader picks a different one
//   - a step ticked by text instead of position, so a reworded step marks the
//     wrong work as finished
//   - a spec left `building` by an agent that stopped, which is not queued so
//     nothing picks it up and not done so nothing complains
//
// None of those throws. All of them are silent, which is why they are pinned.

import {
  AGENT, CLAIM_STALE_H, STATUSES,
  readStatus, setStatus, readClaim, claim, release,
  appendProgress, tickStep, hermesHealth, nextForAgent,
} from '../src/lib/hermes.js';
import { specNote, parseSpec } from '../src/lib/buildspec.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log('FAIL ' + n); } };
const eq = (a, b, n) => ok(Object.is(a, b), `${n} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const NOW = new Date('2026-09-08T12:00:00Z');
const ago = h => new Date(NOW.getTime() - h * 3600000);
const fresh = () => specNote({
  title: 'WhatsApp bot', why: 'Capture from the phone.',
  steps: ['S: pick a number', 'L: the webhook', 'M: wire it up'],
});

// ---------------------------------------------------------------- status
{
  eq(readStatus(fresh()), 'queued', 'a new spec reads as queued');
  eq(readStatus(''), 'queued', 'and so does nothing at all, rather than throwing');
  eq(readStatus('**Status** nonsense'), 'queued', 'an unknown word is not a status');

  const b = setStatus(fresh(), 'building');
  ok(b.ok && readStatus(b.body) === 'building', 'the status can be set');
  eq((b.body.match(/^\*\*Status\*\*/gm) || []).length, 1,
     'REPLACED in place — two Status lines and every reader picks a different one');

  ok(!setStatus(fresh(), 'exploded').ok, 'an invented status is refused');

  // blocked without a reason stops the build and tells nobody what to fix.
  ok(!setStatus(fresh(), 'blocked').ok, 'blocked with no reason is refused');
  ok(/same as silence/.test(setStatus(fresh(), 'blocked').reason), 'and says why that matters');
  const bl = setStatus(fresh(), 'blocked', 'needs a Meta API key');
  ok(bl.ok && /needs a Meta API key/.test(bl.body), 'with a reason it goes in, and the reason is IN the file');
  eq(readStatus(bl.body), 'blocked', 'and still parses back as the status alone');
}

// ---------------------------------------------------------------- claiming
{
  const c = claim(fresh(), { now: NOW });
  ok(c.ok, 'a queued spec can be claimed');
  eq(readStatus(c.body), 'building', 'claiming sets it building');
  eq(readClaim(c.body).agent, AGENT, 'and records who has it');
  ok(c.body.indexOf('**Claimed**') > c.body.indexOf('**Status**'),
     'directly under Status, so whoever opens the file sees who holds it first');

  // Someone else's live claim is respected.
  const other = claim(fresh(), { agent: 'other', now: ago(1) }).body;
  const denied = claim(other, { now: NOW });
  ok(!denied.ok, 'a spec held by another agent an hour ago is not taken');
  ok(/held by other/.test(denied.reason), 'and the refusal names who has it');

  // ...but a claim nobody came back for must not lock the spec forever. That is
  // worse than queued: nothing picks it up and nothing complains.
  const abandoned = claim(fresh(), { agent: 'other', now: ago(CLAIM_STALE_H + 1) }).body;
  ok(claim(abandoned, { now: NOW }).ok, 'a stale claim can be taken over');
  eq((claim(abandoned, { now: NOW }).body.match(/\*\*Claimed\*\*/g) || []).length, 1,
     'and the old claim line is replaced, not stacked');

  // Re-claiming your own is fine — the agent restarts, the laptop wakes.
  ok(claim(claim(fresh(), { now: ago(9) }).body, { now: NOW }).ok, 'an agent can re-claim its own work after a restart');

  ok(!claim(release(fresh()).body, { now: NOW }).ok, 'a finished spec is not claimed again');
  eq(readClaim(fresh()), null, 'an unclaimed spec has no claim');
  eq(readClaim('**Claimed** hermes not-a-date').at, null, 'and an unparseable claim time is null rather than now');

  const r = release(claim(fresh(), { now: NOW }).body, { status: 'done' });
  ok(r.ok, 'it can be released');
  eq(readClaim(r.body), null, 'which clears the claim');
  eq(readStatus(r.body), 'done', 'and marks it done');
  ok(!/\n\n\n/.test(r.body), 'without leaving a hole where the claim line was');
}

// ---------------------------------------------------------------- progress
{
  const one = appendProgress(fresh(), 'Picked a spare number.', ago(2));
  ok(one.ok, 'a line can be recorded');
  ok(/Picked a spare number/.test(one.body), 'and is in the file');
  ok(!/_Hermes writes here/.test(one.body), 'the placeholder is replaced by the first entry, not left above it');

  const two = appendProgress(one.body, 'Webhook verify handshake works.', NOW).body;
  ok(two.indexOf('Picked a spare') < two.indexOf('Webhook verify'), 'entries append in order, oldest first');
  eq((two.match(/^## Progress/gm) || []).length, 1,
     'and NEVER a second ## Progress — the failure that makes the tab render the older half');
  eq((two.match(/^## Retrospective/gm) || []).length, 1, 'the section after it survives intact');
  ok(/## Retrospective/.test(two), 'and is still there at all');

  // A note without the standard headings did not come from the intake. Quietly
  // repairing it would hide that.
  const bad = appendProgress('# Just a note\n\nsome text', 'x');
  ok(!bad.ok, 'a note with no Progress section is refused rather than repaired');
  ok(/did not come from the build intake/.test(bad.reason), 'and says what that means');
  ok(!appendProgress(fresh(), '   ').ok, 'an empty line records nothing');

  // The round trip: what buildspec reads back must survive what hermes writes.
  const spec = parseSpec(two);
  eq(spec.steps.length, 3, 'the steps still parse after progress was written');
  ok(/Webhook verify/.test(spec.notes), 'and the tab can read the progress notes');
}

// ---------------------------------------------------------------- steps
{
  const t = tickStep(fresh(), 1);
  ok(t.ok, 'a step can be ticked');
  eq(parseSpec(t.body).progress.done, 1, 'and reads back as done');
  eq(parseSpec(t.body).steps[1].done, true, 'the SECOND one — by position');
  eq(parseSpec(t.body).steps[0].done, false, 'not the first');

  // By position, not by text. Matching on text lets a reworded step tick the
  // wrong box, and a wrongly ticked box is work that silently never happens.
  const reworded = fresh().replace('the webhook', 'the webhook (Meta Cloud API)');
  eq(parseSpec(tickStep(reworded, 1).body).steps[1].done, true, 'rewording a step does not move which box gets ticked');

  ok(!tickStep(fresh(), 9).ok, 'a step that does not exist is refused');
  ok(/no step 10/.test(tickStep(fresh(), 9).reason), 'in human numbering, since a person reads this');
  eq(parseSpec(tickStep(tickStep(fresh(), 0).body, 0, false).body).progress.done, 0, 'and a tick can be undone');

  const all = [0, 1, 2].reduce((b, i) => tickStep(b, i).body, fresh());
  eq(parseSpec(all).progress.pct, 100, 'ticking every step is a finished build');
}

// ---------------------------------------------------------------- health
{
  const specs = [
    { title: 'Live', status: 'building', claim: { at: ago(1).toISOString() } },
    { title: 'Abandoned', status: 'building', claim: { at: ago(30).toISOString() } },
    { title: 'Never claimed', status: 'building', claim: null },
    { title: 'Stuck', status: 'blocked' },
    { title: 'Waiting', status: 'queued', updated: '2026-09-01' },
    { title: 'Also waiting', status: 'queued', updated: '2026-08-20' },
    { title: 'Shipped', status: 'done' },
  ];
  const h = hermesHealth(specs, NOW);

  eq(h.stale.length, 2, 'an abandoned claim and a claimless building spec are both stale');
  ok(h.stale.some(s => s.title === 'Abandoned'), 'the one nobody came back to');
  ok(h.stale.some(s => s.title === 'Never claimed'), 'and the one marked building by nothing at all');
  ok(!h.stale.some(s => s.title === 'Live'), 'a claim from an hour ago is not stale');
  eq(h.stale.find(s => s.title === 'Abandoned').hours, 30, 'with how long it has been');

  eq(h.blocked.length, 1, 'blocked specs are reported separately');
  ok(!h.blocked.some(s => s.status === 'building'), 'and never mixed with stale ones — they need different things');
  eq(hermesHealth([], NOW).stale.length, 0, 'nothing queued is nothing wrong');
  eq(hermesHealth(null, NOW).blocked.length, 0, 'and null does not throw');

  eq(nextForAgent(specs).title, 'Also waiting', 'the oldest queued spec is next — not the newest');
  eq(nextForAgent(specs.filter(s => s.status !== 'queued')), null, 'nothing queued means nothing to do');
  eq(nextForAgent([]), null, 'and an empty list is null, not undefined');
  for (const s of STATUSES) ok(typeof s === 'string', `${s} is a known status`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
