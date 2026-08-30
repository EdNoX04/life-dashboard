// Pins reading decisions out of the vault.
//
// The tab used to keep its own list: a form with four boxes, saved to
// memory.decisions_log, with a status dropdown. The rebuild reads notes instead,
// and these assertions are mostly about tolerance — a tab that hides a note for
// failing a format check teaches you that writing decisions down does not work.

import { parseDecision, decisionsFrom, decisionTemplate } from '../src/lib/decisions.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log('FAIL ' + n); } };
const is = (a, b, n) => ok(Object.is(a, b), `${n} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const note = (over = {}) => ({
  path: 'decisions/a.md', title: 'Pick git', type: 'decisions', tags: ['infra'],
  updated: '2026-08-30', chunks: [{ i: 0, heading: '', text: '' }], ...over,
});

const full = note({
  chunks: [{
    i: 0, heading: '', text: `**Decided** 2026-08-30

Actions cannot reach iCloud, and everything automated runs on Actions.

**Rejected:** iCloud — invisible to CI.
Obsidian Sync — same problem plus $48/yr.

**Cost:** mobile editing is awkward.`,
  }],
});

// ---------------------------------------------------------------- the format
const d = parseDecision(full);
is(d.decided, '2026-08-30', 'the decided date is read from the bold label');
ok(/Actions cannot reach iCloud/.test(d.why), 'the reasoning is the first non-label paragraph');
ok(!/Decided/.test(d.why), 'and never the label itself');
ok(/\$48\/yr/.test(d.rejected), 'a multi-line Rejected block survives intact — cutting it at the first newline would lose half the argument');
is(d.cost, 'mobile editing is awkward.', 'Cost is read');
is(d.resolved, false, 'no Outcome section means unresolved');
is(d.verdict, null, 'and no verdict');

// ---------------------------------------------------------------- tolerance
const bare = parseDecision(note({ chunks: [{ i: 0, heading: '', text: 'Just did the thing.' }] }));
is(bare.why, 'Just did the thing.', 'a note with no labels still yields its prose');
is(bare.decided, '2026-08-30', 'and falls back to the note date rather than showing nothing');
is(bare.rejected, '', 'a missing section is empty, not undefined');
const empty = parseDecision(note({ chunks: [] }));
is(empty.why, '', 'a note with no chunks does not crash');

// ---------------------------------------------------------------- outcomes
const withOutcome = txt => parseDecision(note({
  chunks: [{ i: 0, heading: '', text: '**Decided** 2026-08-01\n\nwhy' }, { i: 1, heading: 'Outcome', text: txt }],
}));
is(withOutcome('It worked — no regrets.').resolved, true, 'an Outcome section resolves it');
is(withOutcome('It worked — no regrets.').verdict, 'worked', 'positive words read as worked');
is(withOutcome('A mistake; I regret it.').verdict, 'didn’t', 'negative words read as didn’t');
is(withOutcome('Too early to say.').verdict, 'mixed', 'and anything else is mixed rather than forced into a box');
// The verdict is read from the words, so it can never disagree with the note.
is(withOutcome('').resolved, false, 'an empty Outcome section is not a resolution');

// ---------------------------------------------------------------- selecting
const index = {
  notes: [
    note({ path: 'decisions/old.md', title: 'Old', chunks: [{ i: 0, heading: '', text: '**Decided** 2026-01-01\n\nx' }] }),
    note({ path: 'decisions/new.md', title: 'New', chunks: [{ i: 0, heading: '', text: '**Decided** 2026-08-30\n\ny' }] }),
    note({ path: 'college/spanish.md', title: 'Spanish', type: 'college' }),
    { path: 'decisions/untyped.md', title: 'Untyped', tags: [], chunks: [{ i: 0, heading: '', text: 'z' }] },
  ],
};
const list = decisionsFrom(index);
is(list.length, 3, 'only decisions — and one of them has no type, matched by its folder');
is(list[0].title, 'New', 'newest first');
ok(!list.some(x => x.title === 'Spanish'), 'a college note is not a decision');
is(decisionsFrom(null).length, 0, 'a missing index is not a crash');
is(decisionsFrom({}).length, 0, 'nor is a malformed one');

// ---------------------------------------------------------------- the link
ok(d.obsidian.startsWith('obsidian://open?vault=brain&file='), 'each decision links into Obsidian');
ok(!/\.md/.test(d.obsidian), 'and the URI drops the extension, which Obsidian does not want');

// ---------------------------------------------------------------- the template
const t = decisionTemplate('Use Postgres');
ok(t.includes('# Use Postgres'), 'the template carries the title through');
ok(/\*\*Rejected:\*\*/.test(t), 'and prompts for the rejected options');
ok(/type: decision/.test(t), 'and the frontmatter type');
// Round-trip: what the button offers must be what the parser understands.
const round = parseDecision(note({ chunks: [{ i: 0, heading: '', text: t.split('---')[2] }] }));
ok(round.rejected.length > 0, 'the template round-trips through the parser');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
