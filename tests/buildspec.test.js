// "I have an idea, build it" — the spec, and the promise it must not make.
//
// The plan is explicit about the one thing that would ruin this: "An LLM asked
// 'how long will this take' produces a confident number with nothing behind it,
// and a confident wrong number is worse than none: it becomes the thing Neel
// plans around."
//
// So the first assertions here are about what the spec REFUSES to say. The rest
// are about the round trip: a note written by the app, edited by hand in
// Obsidian, and read back by the Builds tab has to survive that journey — which
// is the whole reason the spec is a file and not a database row.

import {
  SIZES, toStep, toSteps, sizeSummary, progressOf, specNote, parseSpec, buildsFrom, normalizeSize, STATUSES,
} from '../src/lib/buildspec.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log('FAIL ' + n); } };
const eq = (a, b, n) => ok(Object.is(a, b), `${n} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

// ---------------------------------------------------------------- no hours. ever.
{
  const n = specNote({
    title: 'WhatsApp bot',
    why: 'Capture tasks from the phone.',
    steps: ['S: pick a number', 'L: the webhook', 'M: wire it to PLAYER TWO'],
  });
  ok(!/\bhours?\b/i.test(n), 'the spec never says hours');
  ok(!/\bdays?\b/i.test(n), 'nor days');
  ok(!/\bweeks?\b/i.test(n), 'nor weeks');
  ok(!/\bETA\b|estimat/i.test(n), 'and never calls anything an estimate');
  ok(/3 steps/.test(n), 'it says how MANY');
  ok(/1 S, 1 M, 1 L/.test(n), 'and how big each is');

  eq(sizeSummary([]), 'no steps yet', 'an empty plan says so rather than showing a confident zero');
  eq(sizeSummary([{ size: 'S' }, { size: 'S' }]), '2 steps — 2 S', 'sizes with none of them present are omitted');
  eq(sizeSummary([{ size: 'M' }]), '1 step — 1 M', 'and one step is singular');
}

// ---------------------------------------------------------------- what the model hands back
//
// It will produce all of these shapes, in the same reply, on different days.
{
  eq(toStep('S: pick a number').size, 'S', 'a prefixed string parses');
  eq(toStep('S: pick a number').text, 'pick a number', 'without keeping the prefix in the text');
  eq(toStep('l — the webhook').size, 'L', 'lowercase and an em dash both work');
  eq(toStep({ size: 'm', text: 'wire it' }).size, 'M', 'an object works');
  eq(toStep({ step: 'wire it' }).text, 'wire it', 'under any of the plausible key names');
  eq(toStep({ size: 'XL', text: 'huge' }).size, 'M', 'an invented size falls back rather than being kept');

  // The one that matters: a bare sentence is still a step. Dropping it would
  // make the plan look SHORTER than the work, which is the same lie as a bad
  // hour estimate wearing different clothes.
  eq(toStep('just do the thing').size, 'M', 'a step with no size given is medium, not discarded');
  eq(toStep('just do the thing').text, 'just do the thing', 'with its text intact');

  eq(toStep(''), null, 'an empty line is not a step');
  eq(toStep('   '), null, 'nor whitespace');
  eq(toStep(null), null, 'nor null');
  eq(toStep({ text: '' }), null, 'nor an object with no text');

  eq(toSteps(['S: a', '', 'M: b', null]).length, 2, 'the blanks are dropped from a list');
  eq(toSteps('S: a\nM: b').length, 2, 'a newline string works too, because a model produces both');
  ok(toSteps(Array(50).fill('S: x')).length <= 20, 'and the list is capped — a fifty-step plan is not a plan');
  eq(normalizeSize('s'), 'S', 'sizes normalise');
  eq(normalizeSize('xl'), null, 'and an unknown one is null rather than guessed');
}

// ---------------------------------------------------------------- the round trip
//
// Written by the app, edited by hand in Obsidian, read back by the tab. If this
// breaks, the reason for putting the spec in a file instead of a row is gone.
{
  const n = specNote({
    title: 'WhatsApp bot',
    why: 'Capture tasks from the phone without opening the app.',
    steps: ['S: pick a number', 'L: the webhook', 'M: wire it to PLAYER TWO'],
  });
  const b = parseSpec(n);

  eq(b.steps.length, 3, 'every step survives the round trip');
  eq(b.steps[0].size, 'S', 'with its size');
  eq(b.steps[1].text, 'the webhook', 'and its text');
  eq(b.status, 'queued', 'a new spec is queued');
  ok(/Capture tasks from the phone/.test(b.why), 'the reason survives');
  eq(b.progress.done, 0, 'nothing done yet');
  eq(b.progress.pct, 0, 'zero percent');

  // Ticked by Hermes, or by Neel in Obsidian at midnight.
  const worked = n.replace('- [ ] **S** — pick a number', '- [x] **S** — pick a number')
                  .replace('**Status** queued', '**Status** building');
  const p = parseSpec(worked);
  eq(p.progress.done, 1, 'a ticked box is read back as done');
  eq(p.progress.pct, 33, 'and the percentage moves');
  eq(p.status, 'building', 'as does the status');

  // Hand-typed markdown will not match what the app emitted. It still has to parse.
  const byHand = parseSpec('## Steps\n* [X] S - did this one\n-  [ ]  **l**  —  and this\n');
  eq(byHand.steps.length, 2, 'a hand-typed checklist still parses');
  eq(byHand.steps[0].done, true, 'a capital X counts as done');
  eq(byHand.steps[1].size, 'L', 'and a lowercase size in a different dash style still reads');

  // A placeholder must not be mistaken for content — an unwritten "Why" that
  // reads back as prose would look like a spec that had been thought about.
  eq(parseSpec(specNote({ title: 'X', steps: [] })).why, '', 'the unwritten Why comes back empty, not as its own placeholder');
  eq(parseSpec('nothing here').steps.length, 0, 'a note with no steps has none');
  eq(parseSpec('').status, 'queued', 'and an empty note defaults rather than throwing');
  eq(parseSpec(null).steps.length, 0, 'null is empty, not a crash');
}

// ---------------------------------------------------------------- fixed headings
//
// Hermes reads this file back and writes into it. A heading it cannot find is a
// heading it appends a second copy of, and then the file has two Progress
// sections and the tab shows the wrong one.
{
  const n = specNote({ title: 'X', why: 'y', steps: ['S: a'] });
  for (const h of ['## Why', '## Steps', '## Progress', '## Retrospective']) {
    ok(n.includes(h), `${h} is always present, even when empty`);
  }
  eq((n.match(/^## /gm) || []).length, 4, 'exactly four sections, always the same four');
  ok(/\*\*Status\*\*/.test(n) && /\*\*Plan\*\*/.test(n), 'with Status and Plan above them for a machine to find');
  for (const s of STATUSES) ok(typeof s === 'string', `${s} is a known status`);
  eq(parseSpec(specNote({ title: 'X', status: 'nonsense' })).status, 'queued',
     'an unknown status is not written into the file');
}

// ---------------------------------------------------------------- the list
{
  const notes = [
    { path: 'projects/a.md', title: 'A', updated: '2026-09-01', chunks: [{ heading: 'Steps', text: '- [x] **S** — one' }] },
    { path: 'projects/b.md', title: 'B', updated: '2026-09-07', chunks: [{ heading: 'Steps', text: '- [ ] **L** — two' }] },
    { path: 'projects/c.md', title: 'C', updated: null, chunks: [] },
  ];
  const list = buildsFrom(notes);
  eq(list.length, 3, 'every project note becomes a build');
  eq(list[0].title, 'B', 'most recently touched first');
  eq(list[2].title, 'C', 'and an undated one sorts last — missing is not new');
  eq(list[0].progress.pct, 0, 'B has done nothing');
  eq(list[1].progress.pct, 100, 'A is finished');
  eq(buildsFrom([]).length, 0, 'no notes is an empty list');
  eq(buildsFrom(null).length, 0, 'and null does not throw');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
