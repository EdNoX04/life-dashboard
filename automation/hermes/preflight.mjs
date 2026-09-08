#!/usr/bin/env node
// Hermes preflight — run this BEFORE the agent reads anything.
//
// Neel's constraint, in his words: "make sure nothing secret goes on these cloud
// LLMs." Hermes runs third-party inference through an aggregator, which is a
// different trust boundary from Anthropic's API, and the thing it reads is a git
// repo that people and machines both write to. A key that lands in the vault by
// accident on Tuesday reaches a third party on Wednesday, and nothing would
// have said so.
//
// WHY THIS IS AN ALLOWLIST AND NOT A DENYLIST
//
// A list of what the agent may NOT see has to be complete to work, and it is
// never complete — the next secret is the one nobody thought to add. A list of
// what it MAY see is complete by construction: one directory, one file
// extension, and everything else is refused by default including things that do
// not exist yet.
//
// So: Hermes reads the vault, and only ever `.md` files inside it. Not the
// life-dashboard repo, not `.env`, not `amizone.config.json`, not `~/.ssh`, not
// the vault's own `.git/config` — which holds a push URL that can carry a token.
//
// Exit 0 = safe to start. Exit 1 = do not start, and the reason is printed.
//
//   node automation/hermes/preflight.mjs ~/brain

import fs from 'node:fs';
import path from 'node:path';

// The only thing the agent may read. Everything else is refused by default.
export const ALLOWED_EXT = ['.md'];

// Directories never walked, never read, never mentioned to the model.
export const NEVER = ['.git', '.obsidian', 'node_modules', '.venv', '__pycache__', 'scripts', '.github'];

/**
 * Things that must never be inside the readable set.
 *
 * These are a SECOND net, not the boundary. The boundary is the allowlist above.
 * This exists for the case the allowlist cannot catch: a real, correctly-named
 * `.md` note with a key pasted into it, which is exactly how a secret gets into
 * a vault — someone saves a snippet.
 */
export const SECRET_PATTERNS = [
  [/\bsb_secret_[A-Za-z0-9_-]{8,}/, 'a Supabase secret key'],
  [/\bservice_role\b[\s\S]{0,40}?ey[A-Za-z0-9_-]{20,}/, 'a Supabase service_role JWT'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, 'a JWT'],
  [/\bghp_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}/, 'a GitHub token'],
  [/\bsk-[A-Za-z0-9]{20,}/, 'an API key'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'an AWS access key'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a private key'],
  [/\.ASPXAUTH\s*[=:]\s*\S{20,}/, 'an Amizone session cookie'],
  [/\b(?:password|passwd|secret|api[_-]?key|refresh_token)\s*[=:]\s*["']?[^\s"'<>{}]{8,}/i, 'a credential assignment'],
];

/** Every file the agent is allowed to open, given a vault root. */
export function readable(root, fsImpl = fs) {
  const out = [];
  const walk = dir => {
    let entries;
    try { entries = fsImpl.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') && !ALLOWED_EXT.some(x => e.name.endsWith(x))) continue;
      if (NEVER.includes(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (ALLOWED_EXT.some(x => e.name.toLowerCase().endsWith(x))) out.push(full);
    }
  };
  walk(root);
  return out.sort();
}

/** What is wrong with the text of one file, if anything. */
export function scan(text) {
  const hits = [];
  for (const [re, what] of SECRET_PATTERNS) {
    const m = re.exec(String(text || ''));
    // The MATCH IS NEVER RETURNED. A preflight that prints the secret it found,
    // into a terminal and a CI log, has moved it somewhere new rather than
    // stopped it.
    if (m) hits.push({ what, line: String(text).slice(0, m.index).split('\n').length });
  }
  return hits;
}

export function preflight(root, fsImpl = fs) {
  if (!root) return { ok: false, problems: [{ file: '', what: 'no vault path given' }], files: [] };
  let stat;
  try { stat = fsImpl.statSync(root); } catch { stat = null; }
  if (!stat?.isDirectory?.()) return { ok: false, problems: [{ file: root, what: 'not a directory' }], files: [] };

  const files = readable(root, fsImpl);
  const problems = [];
  for (const f of files) {
    let text = '';
    try { text = fsImpl.readFileSync(f, 'utf8'); } catch { continue; }
    for (const h of scan(text)) problems.push({ file: path.relative(root, f), ...h });
  }
  return { ok: problems.length === 0, problems, files };
}

// Only when run directly, so the tests can import without executing.
if (process.argv[1] && process.argv[1].endsWith('preflight.mjs')) {
  const root = process.argv[2];
  const r = preflight(root);
  console.log(`hermes preflight — ${r.files.length} readable file${r.files.length === 1 ? '' : 's'} under ${root}`);
  if (r.ok) {
    console.log('OK — nothing that looks like a credential is reachable.');
    process.exit(0);
  }
  console.error('REFUSING TO START. Something that looks like a credential is inside the readable set:');
  for (const p of r.problems) console.error(`  ${p.file}${p.line ? `:${p.line}` : ''} — ${p.what}`);
  console.error('\nRemove it from the vault (and rotate it — it is in git history) before running Hermes.');
  process.exit(1);
}
