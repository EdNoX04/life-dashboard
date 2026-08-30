// Pins turning a lecture into notes in the vault.
//
// Two decisions get most of the assertions: that the raw transcript is filed as
// its OWN note (a lossy write-up is unrecoverable otherwise, and nine thousand
// words of speech in the same file would dominate retrieval), and that the paths
// produced are ones vault_inbox will actually accept.

import { buildMessages, unfence, titleOf, inboxRows, todayISO, SYSTEM } from '../src/lib/lecturenote.js';

// The consumer of these rows lives in the OTHER repo, and checking that the
// paths we generate are ones it will accept is worth having — but a hard import
// across repos fails in CI, where only this checkout exists. So it is optional,
// and its absence is announced rather than silently passing.
let safeVaultPath = null;
try { ({ safeVaultPath } = await import('../../brain/scripts/lib/inbox-path.mjs')); } catch { /* brain not checked out */ }

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log('FAIL ' + n); } };
const is = (a, b, n) => ok(Object.is(a, b), `${n} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const base = {
  notes: '# MQTT and the broker model\n\n## Topics\nPublish and subscribe.\n\n## Worth remembering\n"This comes up every year."',
  transcript: 'so today we are looking at mqtt and the broker model',
  slides: [{ label: '2:10' }, { label: '8:40' }],
  subject: 'IoT System Design',
  date: '2026-08-30',
  minutes: 50,
};

// ---------------------------------------------------------------- two notes
const rows = inboxRows(base);
is(rows.length, 2, 'a lecture produces the notes AND the transcript, as separate notes');
is(rows[0].path, 'college/lectures/2026-08-30-iot-system-design.md', 'notes land where the indexer already reads');
is(rows[1].path, 'college/lectures/2026-08-30-iot-system-design-transcript.md', 'the transcript sits beside them');
ok(rows[0].body.length < rows[1].body.length + 500, 'and they are genuinely separate files, not one concatenated');
ok(!rows[0].body.includes('so today we are looking'),
  'the write-up does NOT contain the raw transcript — it would dominate every search of the subject');
ok(rows[1].body.includes('so today we are looking'), 'but the transcript note does');
ok(/\[\[2026-08-30-iot-system-design-transcript\]\]/.test(rows[0].body),
  'and the notes link to it, so the raw source is one click away');

// The transcript must announce what it is. Read later as though a lecturer wrote
// it, a mishearing becomes something you revise from.
ok(/machine transcription/i.test(rows[1].body), 'the transcript says it is machine-made');
ok(/contains mistakes/i.test(rows[1].body), 'and that it contains mistakes');
ok(/2:10, 8:40/.test(rows[1].body), 'slide timestamps are recorded so the moments can be found again');

// ---------------------------------------------------------------- what the vault accepts
if (safeVaultPath) {
  for (const r of rows) ok(safeVaultPath(r.path).ok, `vault_inbox accepts ${r.path}`);
  const messy = inboxRows({ ...base, subject: 'Prof. Sharma / ANS!! (Sec-B)' });
  for (const r of messy) ok(safeVaultPath(r.path).ok, 'even from a subject full of punctuation');
  const none = inboxRows({ ...base, subject: '' });
  ok(safeVaultPath(none[0].path).ok, 'and from no subject at all');
} else {
  console.log('  (skipped: the brain repo is not checked out beside this one, so the');
  console.log('   generated paths were not checked against vault_inbox\'s rules)');
}
// Checked here regardless, because these are the rules the paths must satisfy
// and they should not depend on a sibling checkout to be enforced at all.
for (const r of [...rows, ...inboxRows({ ...base, subject: 'Prof. Sharma / ANS!! (Sec-B)' })]) {
  ok(r.path.startsWith('college/lectures/'), `${r.path} is inside an allowed vault folder`);
  ok(/^[a-z0-9/-]+\.md$/.test(r.path), `${r.path} has no characters vault_inbox would reject`);
}

// ---------------------------------------------------------------- frontmatter and title
ok(rows[0].body.startsWith('---\ntype: note'), 'the note carries frontmatter the indexer reads');
ok(/tags: \[lecture, iot-system-design\]/.test(rows[0].body), 'tagged by subject, so retrieval can find it');
is(rows[0].title, 'MQTT and the broker model', 'the title comes from the note, not the filename');
is(titleOf('no heading here', 'Fallback'), 'Fallback', 'and falls back when there is no heading');
is(rows[1].title, 'MQTT and the broker model — transcript', 'the transcript is named after it');

// ---------------------------------------------------------------- fences
is(unfence('```markdown\n# Title\n\ntext\n```'), '# Title\n\ntext', 'a wrapping code fence is removed');
is(unfence('# Title\n\n```js\ncode()\n```'), '# Title\n\n```js\ncode()\n```', 'but a fence INSIDE the note is left alone');
is(unfence('  # Title  '), '# Title', 'and stray whitespace is trimmed');

// ---------------------------------------------------------------- refusing
let threw = false;
try { inboxRows({ ...base, notes: '' }); } catch { threw = true; }
ok(threw, 'an empty write-up throws rather than filing a blank note');
is(inboxRows({ ...base, transcript: '' }).length, 1, 'no transcript means one note, not an empty second one');

// ---------------------------------------------------------------- the prompt
const msgs = buildMessages({ transcript: 'hello', slides: [{ dataUrl: 'data:image/jpeg;base64,AAAA', label: '1:00' }], subject: 'IoT' });
is(msgs[0].content.filter(c => c.type === 'image').length, 1, 'slides are sent as images');
ok(msgs[0].content.some(c => c.type === 'text' && /1:00/.test(c.text)), 'each labelled with its timestamp, so it can be lined up with the speech');
is(buildMessages({ transcript: 'x', slides: [{ dataUrl: 'not-a-data-url' }] })[0].content.length, 1, 'a malformed image is skipped, not sent broken');

// The instruction that matters most: a confidently invented technical term is
// how a wrong definition ends up in study material.
ok(/\[unclear\]/.test(SYSTEM), 'the model is told to mark what it cannot make out');
ok(/Do not invent/i.test(SYSTEM), 'and not to pad a thin lecture');

is(todayISO(new Date('2026-08-30T23:30:00')), '2026-08-30', 'the date is local, not UTC — a late lecture is not filed as tomorrow');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
