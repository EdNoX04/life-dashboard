// Putting something INTO the vault.
//
// The reverse pipeline was finished weeks ago and has never carried anything.
// `brain.js` retrieves from the vault, the `brain` repo's index.yml builds the
// index, and its inbox.yml drains `vault_inbox` into real files every fifteen
// minutes. Measured 2026-09-08: four files in the vault, two indexed notes, and
// **zero rows ever written to vault_inbox**.
//
// The reason is simple and was never a bug. Nothing in PLAYER ONE could write to
// it. A second brain you can only read from is a second brain nobody fills.
//
// WHERE THE REAL SECURITY CHECK LIVES — AND IT IS NOT HERE
//
// `brain/scripts/lib/inbox-path.mjs` is the source of truth. That runner has a
// git checkout and a push token, so it re-validates every row before writing a
// file, and its rules are what actually stop a queued row from becoming
// `.github/workflows/evil.yml`.
//
// This file is a PRE-FLIGHT COPY, and it exists for a different reason: so a
// note that the runner would reject is refused at the moment Neel confirms it,
// rather than queued, silently rejected fifteen minutes later, and never seen
// again. The two must agree, so the tests pin the same cases the runner's own
// tests pin. If they ever drift, the runner wins — it is the one holding the
// token.
//
// The stronger protection is above both: the model NEVER WRITES A PATH. It picks
// a folder from a fixed list and gives a title, and the path is built here. A
// whole class of traversal and dotfile tricks is not defended against so much as
// made unreachable.

/** The vault's content folders — mirrors ALLOWED_ROOTS in the runner. */
export const FOLDERS = ['inbox', 'daily', 'decisions', 'college', 'projects', 'people', 'reference'];

export const DEFAULT_FOLDER = 'inbox';

// Not the runner's 400 KB. A chat reply is not a lecture transcript, and a model
// that can queue a 400 KB note can quietly fill a git repo.
export const MAX_BODY = 8000;
export const MAX_TITLE = 90;

/**
 * A title becomes a filename.
 *
 * The runner insists on `^[A-Za-z0-9][A-Za-z0-9 ._-]*\.md$`, so anything outside
 * that is removed here rather than sent to be rejected. Spaces survive — Obsidian
 * note names have spaces in them, and turning "Why I picked Supabase" into
 * "why-i-picked-supabase" makes a vault that reads like a URL bar.
 */
export function slug(title) {
  const cleaned = String(title || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')  // é → e, so it survives the filter below
    .replace(/[^A-Za-z0-9 ._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[^A-Za-z0-9]+/, '')                       // must START alphanumeric
    .slice(0, MAX_TITLE)
    .trim()
    .replace(/[. _-]+$/, '');                            // a name ending in a dot is not a name
  return cleaned;
}

/**
 * Where the note goes. Returns { ok, path } or { ok: false, reason }.
 *
 * Built, never accepted. The model chooses a folder from FOLDERS and supplies a
 * title; it does not get to say "path".
 */
export function notePath(title, folder = DEFAULT_FOLDER) {
  const f = String(folder || DEFAULT_FOLDER).trim().toLowerCase();
  if (!FOLDERS.includes(f)) {
    return { ok: false, reason: `"${folder}" is not a vault folder (${FOLDERS.join(', ')})` };
  }
  const name = slug(title);
  if (!name) return { ok: false, reason: 'the title has no usable characters for a filename' };
  return { ok: true, path: `${f}/${name}.md` };
}

/** The body has to be text, present, and not enormous. */
export function checkBody(body) {
  if (typeof body !== 'string' || !body.trim()) return { ok: false, reason: 'the note is empty' };
  if (body.length > MAX_BODY) return { ok: false, reason: `the note is too long (${body.length} characters, limit ${MAX_BODY})` };
  return { ok: true };
}

/**
 * The row to queue.
 *
 * `source` is not decoration. When a bad note turns up in the vault six months
 * from now, "which feature produced this" is the first question, and the runner
 * writes it into the note's own front matter.
 */
export function inboxRow({ title, body, folder = DEFAULT_FOLDER, source = 'player-two' }) {
  const p = notePath(title, folder);
  if (!p.ok) return p;
  const b = checkBody(body);
  if (!b.ok) return b;
  return { ok: true, row: { path: p.path, title: String(title).trim().slice(0, 200), body, source, status: 'pending' } };
}

/**
 * How long until it actually exists.
 *
 * inbox.yml runs every fifteen minutes between 06:30 and 23:30 IST. Saying "done"
 * when the file does not exist yet is the small lie that makes someone check the
 * vault, find nothing, and stop trusting the feature.
 */
export const WRITE_DELAY_NOTE = 'It will appear in the vault within about 15 minutes, when the next sync runs.';

/**
 * Rows that were queued and never became files.
 *
 * A rejection is written back to the row with a reason, and nothing reads it —
 * which would make a note that vanished between the app and the vault completely
 * silent. Same failure shape as every other one in this codebase.
 */
export function vaultTrouble(rows, now = new Date(), stalePendingMin = 45) {
  const list = Array.isArray(rows) ? rows : [];
  const rejected = list.filter(r => r?.status === 'rejected');
  const stuck = list.filter(r => {
    if (r?.status !== 'pending') return false;
    const t = Date.parse(r.created_at || '');
    return Number.isFinite(t) && (now.getTime() - t) / 60000 > stalePendingMin;
  });
  return { rejected, stuck };
}
