// The Hermes preflight — the boundary between Neel's data and a third-party model.
//
// Hermes runs inference through an aggregator. That is a different trust
// boundary from Anthropic's API, and the thing it reads is a git repo that both
// people and machines write to. A key pasted into a note on Tuesday reaches a
// third party on Wednesday, and nothing else in the system would say so.
//
// These tests are about two properties, and the second one is the one people
// get wrong:
//
//   1. The allowlist holds — only .md inside the vault, nothing else, ever.
//   2. The guard never REPEATS what it found. A preflight that prints the
//      secret into a terminal and a CI log has moved it somewhere new rather
//      than stopped it.

import { readable, scan, preflight, ALLOWED_EXT, NEVER } from '../automation/hermes/preflight.mjs';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log('FAIL ' + n); } };
const eq = (a, b, n) => ok(Object.is(a, b), `${n} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

// A fake filesystem, so this runs anywhere and no real secret is ever involved.
function fakeFs(tree) {
  const dirOf = p => tree[p];
  return {
    statSync: p => { if (!(p in tree)) throw new Error('nope'); return { isDirectory: () => Array.isArray(tree[p]) }; },
    readdirSync: p => (dirOf(p) || []).map(n => ({
      name: n,
      isDirectory: () => Array.isArray(tree[`${p}/${n}`]),
    })),
    readFileSync: p => (typeof tree[p] === 'string' ? tree[p] : ''),
  };
}

// ---------------------------------------------------------------- the allowlist
{
  const tree = {
    '/v': ['decisions', 'projects', '.git', '.obsidian', 'scripts', '.env', 'README.md', 'notes.txt', 'photo.png'],
    '/v/decisions': ['a.md', 'b.MD'],
    '/v/projects': ['spec.md', 'draft.json'],
    '/v/.git': ['config'],
    '/v/.obsidian': ['workspace.json'],
    '/v/scripts': ['pull-inbox.mjs'],
    '/v/decisions/a.md': '# A', '/v/decisions/b.MD': '# B', '/v/projects/spec.md': '# S',
    '/v/README.md': '# R', '/v/.env': 'SUPABASE_SERVICE_KEY=xyz',
    '/v/.git/config': 'url = https://ghp_aaaaaaaaaaaaaaaaaaaaaa@github.com/x/y',
    '/v/scripts/pull-inbox.mjs': 'const KEY = process.env.SUPABASE_SERVICE_KEY',
    '/v/notes.txt': 'plain', '/v/projects/draft.json': '{}', '/v/photo.png': 'binary',
  };
  const files = readable('/v', fakeFs(tree));

  eq(files.length, 4, 'only the markdown notes are readable');
  ok(files.includes('/v/decisions/a.md'), 'a note is readable');
  ok(files.includes('/v/decisions/b.MD'), 'case-insensitively');
  ok(files.includes('/v/README.md'), 'including one at the root');

  // Each of these is a real way a credential leaves the machine.
  ok(!files.some(f => f.endsWith('.env')), '.env is never readable');
  ok(!files.some(f => f.includes('/.git/')), 'the git config is never readable — a push URL can carry a token');
  ok(!files.some(f => f.includes('/.obsidian/')), "Obsidian internals are not the agent's business");
  ok(!files.some(f => f.includes('/scripts/')), "the vault's own runner scripts are out of reach");
  ok(!files.some(f => f.endsWith('.json')), 'no json — that is where config lives');
  ok(!files.some(f => f.endsWith('.txt') || f.endsWith('.png')), 'and nothing else at all');

  // The property that makes this an allowlist rather than a denylist: something
  // NOBODY THOUGHT OF is refused by default. The next secret is always the one
  // that is not on anyone's list.
  const surprise = readable('/v', fakeFs({ ...tree, '/v': [...tree['/v'], 'creds.yaml', 'id_rsa'], '/v/creds.yaml': 'k: v', '/v/id_rsa': 'x' }));
  eq(surprise.length, 4, 'a file type nobody anticipated is refused without anyone adding a rule');

  eq(ALLOWED_EXT.length, 1, 'exactly one extension is allowed, and widening it is a deliberate act');
  for (const d of ['.git', '.obsidian', 'scripts', '.github']) ok(NEVER.includes(d), `${d} is never walked`);
}

// ---------------------------------------------------------------- the second net
//
// The allowlist cannot catch a correctly-named .md note with a key pasted into
// it — which is exactly how a secret gets into a vault. Someone saves a snippet.
{
  const cases = [
    ['sb_secret_abcdefghijklmnop', 'a Supabase secret key'],
    ['ghp_abcdefghijklmnopqrstuvwxyz', 'a GitHub token'],
    ['sk-abcdefghijklmnopqrstuvwxyz', 'an API key'],
    ['AKIAIOSFODNN7EXAMPLE', 'an AWS access key'],
    ['-----BEGIN RSA PRIVATE KEY-----', 'a private key'],
    ['.ASPXAUTH=AAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'an Amizone session cookie'],
    ['password: hunter2hunter2', 'a credential assignment'],
    ['eyJhbGciOiJIUzI1.eyJyb2xlIjoiYW5v.QzJhbGciOiJIUz', 'a JWT'],
  ];
  for (const [text, what] of cases) {
    const hits = scan(`# A note\n\nSome prose.\n\n${text}\n`);
    ok(hits.length > 0, `${what} is caught inside a normal-looking note`);
    ok(hits.some(h => h.what === what), `and named as ${what}`);
    ok(hits.every(h => typeof h.line === 'number' && h.line > 0), 'with a line number to find it by');
  }

  // THE ONE THAT MATTERS MOST. A guard that prints what it found has moved the
  // secret into a terminal and a CI log rather than stopping it.
  const hits = scan('# n\n\nghp_abcdefghijklmnopqrstuvwxyz');
  eq(JSON.stringify(hits).includes('ghp_abcdefghij'), false,
     'the matched text is NEVER returned — a guard that repeats the secret has moved it, not stopped it');

  ok(!scan('# A perfectly normal note about passwords in general.').length,
     'prose about credentials is not a credential');
  ok(!scan('').length, 'empty text is clean');
  ok(!scan(null).length, 'and null does not throw');
}

// ---------------------------------------------------------------- the whole check
{
  const clean = fakeFs({
    '/v': ['decisions'], '/v/decisions': ['a.md'], '/v/decisions/a.md': '# A decision\n\nNothing secret here.',
  });
  const r = preflight('/v', clean);
  ok(r.ok, 'a clean vault passes');
  eq(r.problems.length, 0, 'with nothing to report');
  eq(r.files.length, 1, 'having actually looked at the file');

  const dirty = fakeFs({
    '/v': ['decisions'], '/v/decisions': ['a.md', 'b.md'],
    '/v/decisions/a.md': '# Fine',
    '/v/decisions/b.md': '# Oops\n\nghp_abcdefghijklmnopqrstuvwxyz\n',
  });
  const d = preflight('/v', dirty);
  ok(!d.ok, 'one bad note fails the whole preflight');
  eq(d.problems[0].file, 'decisions/b.md', 'named by its path relative to the vault');
  ok(!JSON.stringify(d).includes('ghp_abcdefghij'), 'and still without repeating the secret anywhere in the result');

  ok(!preflight('', clean).ok, 'no path is a refusal');
  ok(!preflight('/nope', clean).ok, 'and a path that is not there is a refusal, never a silent pass');
  ok(/not a directory|no vault path/.test(preflight('/nope', clean).problems[0].what), 'saying which');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
