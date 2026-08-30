// Pins retrieval from the Obsidian vault.
//
// The design pressure here is that context is not free: PLAYER TWO's live
// context is ~250 tokens and ships on every turn. So these assertions are mostly
// about what retrieval REFUSES to return. A vault that answers every question
// with something vaguely related is worse than no vault — it spends the budget
// and lowers the quality of the answers the dock was already good at.

import { terms, search, brainContext } from '../src/lib/brain.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log('FAIL ' + n); } };
const is = (a, b, n) => ok(Object.is(a, b), `${n} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const index = {
  notes: [
    {
      path: 'decisions/vault-in-git.md', title: 'Store the vault in a private git repo, not iCloud',
      type: 'decisions', tags: ['obsidian', 'infrastructure'], updated: '2026-08-30',
      chunks: [{ i: 0, heading: '', text: 'GitHub Actions cannot reach iCloud at all, so the vault lives in git.' }],
    },
    {
      path: 'college/spanish.md', title: 'Spanish FBL modules', type: 'college',
      tags: ['college', 'spanish'], updated: '2026-08-20',
      chunks: [
        { i: 0, heading: 'The rule', text: 'A missed FBL module cannot be attempted later.' },
        { i: 1, heading: 'Timing', text: 'Module 2 runs across the exam block.' },
      ],
    },
    {
      path: 'reference/misc.md', title: 'Odds and ends', type: 'reference', tags: [], updated: '2026-08-01',
      chunks: [{ i: 0, heading: '', text: 'Some notes mention attendance once, in passing, like this.' }],
    },
  ],
};

// ---------------------------------------------------------------- terms
is(terms('hi thanks okay').length, 0, 'a greeting has no search terms');
is(terms('').length, 0, 'an empty question has none either');
ok(terms('Why not iCloud?').includes('icloud'), 'a real word survives, lowercased');
ok(!terms('what is the vault').includes('the'), 'stopwords are dropped');
ok(!terms('a an it').length, 'short words are dropped');
is(terms('vault vault vault').length, 1, 'terms are de-duplicated');

// ---------------------------------------------------------------- finding
const icloud = search('why not icloud', index);
ok(icloud.length >= 1, 'a specific question finds its note');
is(icloud[0].note.path, 'decisions/vault-in-git.md', 'and finds the right one');

const fbl = search('can I do a missed FBL module later', index);
is(fbl[0].note.path, 'college/spanish.md', 'a question about the rule finds the rule');
is(fbl[0].chunk.heading, 'The rule', 'and the right section of it, not the whole note');

// ---------------------------------------------------------------- refusing
is(search('hi', index).length, 0, 'a greeting retrieves nothing');
is(search('what is my attendance', index).length, 0,
  'a passing mention does not qualify — the dock answers attendance from live data');
is(search('anything', { notes: [] }).length, 0, 'an empty index is not a crash');
is(search('anything', null).length, 0, 'a missing index is not a crash');
is(search('anything', {}).length, 0, 'a malformed index is not a crash');

// ---------------------------------------------------------------- budget
is(search('spanish fbl module', index, { maxChunks: 1 }).length, 1, 'the chunk count is capped');
const big = {
  notes: [{
    path: 'x.md', title: 'Vault', type: 'reference', tags: [], updated: '2026-08-30',
    chunks: [{ i: 0, heading: '', text: 'vault ' + 'x'.repeat(5000) }],
  }],
};
is(search('vault', big).length, 0,
  'a chunk bigger than the whole budget is skipped, never truncated — half a paragraph read as a whole thought is how an assistant misquotes someone');

// ---------------------------------------------------------------- ordering
// Two notes, equally relevant; the one edited more recently is the one still true.
const tie = {
  notes: [
    { path: 'old.md', title: 'Sync plan', type: 'reference', tags: [], updated: '2026-01-01',
      chunks: [{ i: 0, heading: '', text: 'sync plan details' }] },
    { path: 'new.md', title: 'Sync plan', type: 'reference', tags: [], updated: '2026-08-30',
      chunks: [{ i: 0, heading: '', text: 'sync plan details' }] },
  ],
};
is(search('sync plan', tie)[0].note.path, 'new.md', 'ties go to the more recently updated note');

// ---------------------------------------------------------------- the block
const block = brainContext('why not icloud', index);
ok(/FROM NEEL/.test(block), 'the block says whose notes these are');
ok(/quote it as his/.test(block), 'and that they are his claims, not facts to assert');
ok(block.includes('decisions/vault-in-git.md'), 'the source path is included so it can be cited');
is(brainContext('hi', index), '', 'nothing found means nothing added — not an empty header');
is(brainContext('anything', null), '', 'and a missing index adds nothing');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
