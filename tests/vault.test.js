// Writing into the Obsidian vault.
//
// The reverse pipeline — Supabase `vault_inbox` → the `brain` repo's inbox.yml →
// real files, every fifteen minutes — has been live for weeks and has carried
// nothing. Four files in the vault, two indexed notes, zero rows ever queued.
// Nothing in PLAYER ONE could write to it.
//
// These tests are mostly about the two ways this goes wrong quietly:
//
//   1. The app queues a row the RUNNER will reject. From Neel's side that is a
//      note he confirmed, that vanished, with the reason recorded on a database
//      row nobody reads. So the rules below are pinned against
//      brain/scripts/lib/inbox-path.mjs, which is the source of truth.
//
//   2. A title that produces a filename the runner refuses. It insists on
//      ^[A-Za-z0-9][A-Za-z0-9 ._-]*\.md$, and Neel's note titles will contain
//      colons, slashes, question marks and emoji, because titles do.

import {
  FOLDERS, DEFAULT_FOLDER, MAX_BODY, slug, notePath, checkBody, inboxRow, vaultTrouble,
  TYPES, typeOfFolder, composeNote,
} from '../src/lib/vault.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log('FAIL ' + n); } };
const eq = (a, b, n) => ok(Object.is(a, b), `${n} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

// The runner's own filename rule, copied here verbatim so the two cannot drift
// silently. Every generated path is checked against it below.
const RUNNER_FILE = /^[A-Za-z0-9][A-Za-z0-9 ._-]*\.md$/;
const RUNNER_ROOTS = ['inbox', 'daily', 'decisions', 'college', 'projects', 'people', 'reference'];

// ---------------------------------------------------------------- the folders agree
eq(FOLDERS.length, RUNNER_ROOTS.length, 'the app knows exactly the folders the runner allows');
for (const f of RUNNER_ROOTS) ok(FOLDERS.includes(f), `${f} is offered`);
ok(!FOLDERS.includes('scripts') && !FOLDERS.includes('.github'),
   'and neither scripts nor .github is — a queued row must never be able to become CI');
ok(FOLDERS.includes(DEFAULT_FOLDER), 'the default is one of them');

// ---------------------------------------------------------------- titles become filenames
{
  eq(slug('Why I picked Supabase'), 'Why I picked Supabase',
     'spaces survive — an Obsidian vault of hyphenated slugs reads like a URL bar');
  eq(slug('Turnstile: the only blocker'), 'Turnstile the only blocker', 'a colon is dropped, not encoded');
  eq(slug('IoT / ECE441 notes'), 'IoT ECE441 notes', 'a slash cannot survive — it would be a folder');
  eq(slug('Café résumé'), 'Cafe resume', 'accents fold rather than being stripped to nothing');
  eq(slug('  ...leading junk'), 'leading junk', 'a filename has to start alphanumeric');
  eq(slug('trailing dots...'), 'trailing dots', 'and must not end in a dot');
  eq(slug('🔥 hot take 🔥'), 'hot take', 'emoji go');
  eq(slug('../../etc/passwd'), 'etc passwd', 'and a traversal attempt is just a bad title');
  eq(slug('   '), '', 'nothing usable is empty, not a guess');
  eq(slug(null), '', 'and null is empty');
  ok(slug('x'.repeat(300)).length <= 90, 'absurd titles are cut');

  // The assertion that actually protects the pipeline: whatever slug() emits
  // must satisfy the runner's regex, or the row is queued and then rejected.
  for (const t of ['Why I picked Supabase', 'Turnstile: the only blocker', 'IoT / ECE441 notes',
                   'Café résumé', '  ...leading junk', 'trailing dots...', '🔥 hot take 🔥',
                   '../../etc/passwd', '2026-09-08 daily', 'a_b-c.d', 'x'.repeat(300)]) {
    const name = slug(t);
    if (!name) continue;
    ok(RUNNER_FILE.test(`${name}.md`), `“${t}” produces a filename the runner accepts`);
  }
}

// ---------------------------------------------------------------- the path is BUILT
{
  const p = notePath('Why I picked Supabase', 'decisions');
  ok(p.ok, 'a decision gets a path');
  eq(p.path, 'decisions/Why I picked Supabase.md', 'folder + title, and nothing the model wrote');

  eq(notePath('A note').path, 'inbox/A note.md', 'no folder means inbox');
  eq(notePath('A note', 'DECISIONS').path, 'decisions/A note.md', 'folder matching is case-insensitive');

  // The model never supplies a path, so these are refusals of a FOLDER, which
  // is the only thing it can choose. That is the whole point of building the
  // path here rather than accepting one.
  // An EMPTY folder means "he didn't say", not "reject": it falls back to inbox,
  // the same as omitting it. Refusing there would lose a note over a blank field.
  eq(notePath('A note', '').path, 'inbox/A note.md', 'an empty folder means inbox, not a refusal');
  for (const bad of ['scripts', '.github', '..', '/', 'evil', '.obsidian']) {
    ok(!notePath('A note', bad).ok, `“${bad}” is not a vault folder`);
  }
  ok(/not a vault folder/.test(notePath('A note', 'scripts').reason), 'and the refusal names the real list');
  ok(!notePath('///', 'inbox').ok, 'a title with nothing usable in it refuses rather than making a nameless file');

  // Belt and braces against the worst case in the runner's own comment.
  ok(!notePath('workflows/x.yml', '.github').ok, 'a row can never become CI that runs with the repo secrets');
}

// ---------------------------------------------------------------- the body
{
  ok(checkBody('Some note').ok, 'a real note passes');
  ok(!checkBody('').ok, 'empty refuses');
  ok(!checkBody('   \n  ').ok, 'whitespace-only refuses');
  ok(!checkBody(null).ok, 'null refuses');
  ok(!checkBody('x'.repeat(MAX_BODY + 1)).ok, 'and something enormous refuses');
  ok(/too long/.test(checkBody('x'.repeat(MAX_BODY + 1)).reason), 'saying why');
  ok(MAX_BODY < 400_000, "the app's ceiling is well under the runner's — a model must not be able to fill a git repo");
}

// ---------------------------------------------------------------- the queued row
{
  const r = inboxRow({ title: 'Turnstile: the only blocker', body: '# Notes\n\nTwo paragraphs.\n\nSecond.', folder: 'decisions' });
  ok(r.ok, 'a good note becomes a row');
  eq(r.row.path, 'decisions/Turnstile the only blocker.md', 'with a safe path');
  eq(r.row.status, 'pending', 'queued, not done');
  eq(r.row.source, 'player-two', 'and stamped with who asked — the first question when a bad note turns up later');
  ok(r.row.body.includes('\n\n'), 'paragraphs survive: a note is not a title');

  ok(!inboxRow({ title: 'X', body: '', folder: 'inbox' }).ok, 'an empty body never queues');
  ok(!inboxRow({ title: '', body: 'text' }).ok, 'nor an empty title');
  ok(!inboxRow({ title: 'X', body: 'text', folder: 'scripts' }).ok, 'nor a folder outside the vault');
}

// ---------------------------------------------------------------- what got stuck
//
// A rejection is written back to the row and nothing reads it, which would make
// a note that vanished between the app and the vault completely silent — the
// same failure shape as every other one in this codebase.
{
  const now = new Date('2026-09-08T12:00:00Z');
  const ago = m => new Date(now.getTime() - m * 60000).toISOString();
  const rows = [
    { status: 'committed', created_at: ago(300) },
    { status: 'rejected', reason: 'odd characters in the filename', created_at: ago(120) },
    { status: 'pending', created_at: ago(5) },
    { status: 'pending', created_at: ago(200) },
  ];
  const t = vaultTrouble(rows, now);
  eq(t.rejected.length, 1, 'a rejected row is surfaced');
  eq(t.stuck.length, 1, 'and a pending row far past the 15-minute cycle');
  ok(t.stuck[0].created_at === ago(200), 'the old one, not the fresh one');
  eq(vaultTrouble([], now).rejected.length, 0, 'nothing queued is nothing wrong');
  eq(vaultTrouble(null, now).stuck.length, 0, 'and no rows at all does not throw');
  eq(vaultTrouble([{ status: 'pending', created_at: 'nonsense' }], now).stuck.length, 0,
     'an unparseable timestamp is not evidence of being stuck');
}


// ---------------------------------------------------------------- the note has a SHAPE
//
// CONVENTIONS.md says frontmatter is never required and a bare note still
// indexes. That is exactly right for something Neel types at midnight and wrong
// for something a machine produces: with no `type` the note can only ever be
// found by keyword, so "show me my decisions" cannot see it; with no `created`
// it cannot be ordered. Written by hand that is a fair trade for not breaking
// flow. Written by a model there is no flow to break.
{
  const now = new Date(2026, 8, 8, 12, 0);
  const n = composeNote({ title: 'Why Turnstile blocks it', body: 'Because datacenters never pass.', folder: 'decisions', tags: ['Amizone', '#college'], now });

  ok(n.startsWith('---\n'), 'frontmatter leads');
  ok(/type: decision/.test(n), 'the type comes from the folder, which is why the folders are named after types');
  ok(/created: 2026-09-08/.test(n), 'dated, so it can be ordered');
  ok(/updated: 2026-09-08/.test(n), 'and updated, which is what breaks ties in retrieval');
  ok(/tags: \[amizone, college\]/.test(n), 'tags are lowercased and the # stripped, as the conventions ask');
  ok(/source: player-two/.test(n), 'and it records that a machine wrote it — a real question six months from now');
  ok(/^# Why Turnstile blocks it$/m.test(n), 'a title heading is added, because retrieval weights it heavily');
  ok(n.indexOf('# Why') > n.indexOf('---'), 'after the frontmatter, not before it');

  eq(typeOfFolder('decisions'), 'decision', 'folder → type is singular, matching the conventions');
  eq(typeOfFolder('people'), 'person', 'including the irregular one');
  eq(typeOfFolder('inbox'), 'note', 'inbox is just a note');
  eq(typeOfFolder('nonsense'), 'note', 'and anything unknown is a note rather than a crash');
  for (const f of FOLDERS) ok(TYPES.includes(typeOfFolder(f)), `${f} maps to a real type`);

  // A model that wrote its own frontmatter must not get a second block — two
  // `---` openings and the whole thing parses as body text.
  const own = composeNote({ title: 'X', body: '---\ntype: decision\ntags: [a]\n---\n\n# X\n\nBody.', folder: 'inbox', now });
  eq(own.split('---').length - 1, 2, 'its own frontmatter is left alone rather than nested');
  ok(!/source: player-two/.test(own), 'and nothing is injected into it');

  // A body that already opens with its own heading keeps it.
  ok(composeNote({ title: 'Ignored', body: '# Real heading\n\nText.', folder: 'inbox', now })
     .split('# ').length === 2, 'a body with its own heading does not get a second one');

  eq(composeNote({ title: 'X', body: 'y', folder: 'inbox', tags: ['ok', 'has/slash', '  ', 'fine'], now })
     .match(/tags: \[(.*)\]/)[1], 'ok, fine', 'a tag that would not survive the vault is dropped, not mangled');
  ok(!/tags:/.test(composeNote({ title: 'X', body: 'y', folder: 'inbox', now })),
     'and with no tags the line is absent rather than empty');

  // The composed note is what gets queued.
  const r = inboxRow({ title: 'A decision', body: 'Because.', folder: 'decisions', tags: ['money'], now });
  ok(/type: decision/.test(r.row.body), 'inboxRow queues the composed note, not the raw body');
  ok(!inboxRow({ title: 'X', body: '   ', folder: 'inbox', now }).ok,
     'and an empty body still refuses — the frontmatter must never be what makes an empty note look full');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
