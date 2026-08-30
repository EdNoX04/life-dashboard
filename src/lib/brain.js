// Retrieval from the Obsidian vault.
//
// The index is built by the `brain` repo on every push and lands in
// memory.brain_index. This file decides which few pieces of it are worth
// spending PLAYER TWO's context on for a given question.
//
// The whole design pressure is that context is NOT free. Everything the dock
// already knows — clock, timetable, attendance, habits, today's study plan —
// costs about 250 tokens and ships on every single turn. A vault dumped in
// wholesale would drown that, make every reply slower, and make the answers
// worse, which is the opposite of remembering things.
//
// So: score chunks, take a handful, cap the total hard. Keyword scoring rather
// than embeddings, deliberately — embeddings mean an API call per note, a vector
// column, and a re-index pipeline, and none of that is worth building before
// there is evidence that plain matching is the thing failing. When it does fail,
// the upgrade is this file plus the indexer, and nothing else.
//
// Pure, so every scoring rule below is testable without a browser.

const STOP = new Set(('a an and are as at be but by do does for from had has have how i if in into is it its me my '
  + 'of on or should so than that the their then there these they this to was were what when where which who why '
  + 'will with you your about can could would did done get got just like me now '
  // Conversational filler. Without these, "thanks" is a search term and a
  // pleasantry retrieves whichever note happens to say "thanks" in it.
  + 'thanks thank hey hello okay yeah yep nope sure please tell say know need want').split(' '));

/** Question → the words worth matching on. */
export function terms(q) {
  return [...new Set(String(q || '').toLowerCase().match(/[a-z0-9][a-z0-9'-]*/g) || [])]
    .filter(t => t.length > 2 && !STOP.has(t));
}

// A term in every note tells you nothing; a term in one note tells you which
// one. Without this, "the" — or worse, "player", which is in half the vault —
// would score as loudly as "turnstile".
function idf(index, term) {
  const notes = index?.notes || [];
  if (!notes.length) return 1;
  let seen = 0;
  for (const n of notes) if (noteText(n).includes(term)) seen++;
  return Math.log(1 + notes.length / (1 + seen));
}

const noteTextCache = new WeakMap();
function noteText(n) {
  let t = noteTextCache.get(n);
  if (t === undefined) {
    t = `${n.title} ${(n.tags || []).join(' ')} ${(n.chunks || []).map(c => `${c.heading} ${c.text}`).join(' ')}`.toLowerCase();
    noteTextCache.set(n, t);
  }
  return t;
}

const countOf = (hay, needle) => {
  let n = 0, i = 0;
  for (;;) { const j = hay.indexOf(needle, i); if (j === -1) break; n++; i = j + needle.length; }
  return n;
};

/**
 * Weights, and why they are ordered this way:
 *   title   — the one line the author already compressed by hand
 *   tags    — chosen deliberately, and few, so a hit is a strong signal
 *   heading — the author's own summary of this section
 *   body    — the most common and the least discriminating
 * Body hits are capped at 3 per term so a long chunk cannot win on repetition
 * alone; without the cap, the longest note in the vault answers every question.
 */
const W = { title: 4, tags: 3, heading: 2, body: 1 };
const BODY_CAP = 3;

export function scoreChunk(note, chunk, ts, index) {
  const title = String(note.title || '').toLowerCase();
  const tags = (note.tags || []).join(' ').toLowerCase();
  const heading = String(chunk.heading || '').toLowerCase();
  const body = String(chunk.text || '').toLowerCase();

  let score = 0;
  for (const t of ts) {
    const weight = idf(index, t);
    if (title.includes(t)) score += W.title * weight;
    if (tags.includes(t)) score += W.tags * weight;
    if (heading.includes(t)) score += W.heading * weight;
    score += Math.min(countOf(body, t), BODY_CAP) * W.body * weight;
  }
  // An exact phrase is worth more than the sum of its words: someone asking
  // "spanish fbl" means the pair, not two independent tokens.
  const phrase = ts.join(' ');
  if (ts.length > 1 && (body.includes(phrase) || title.includes(phrase))) score *= 1.5;
  return score;
}

const MAX_CHUNKS = 3;
const MAX_CHARS = 1200;

// A weak match is worse than no match. "What is my attendance" glancingly hits
// any note that happens to contain the word, and injecting that chunk spends
// the budget to make the answer worse — the dock already answers attendance
// from live data. Two filters, because neither works alone:
//   MIN_SCORE  — an absolute floor, so a single incidental word never qualifies.
//   RELATIVE   — drops the long tail behind a strong hit, so one good chunk is
//                not padded out with two mediocre ones to fill the quota.
const MIN_SCORE = 1.0;
const RELATIVE = 0.35;

/**
 * The chunks worth including, best first.
 *
 * Returns [] for a question with no usable terms — "hi", "thanks", "what time is
 * it". Retrieving on a greeting would spend the budget to answer a question the
 * dock already answers from its own context, and would make the vault look like
 * noise the first time it was used.
 */
export function search(question, index, { maxChunks = MAX_CHUNKS, maxChars = MAX_CHARS } = {}) {
  const ts = terms(question);
  const notes = index?.notes || [];
  if (!ts.length || !notes.length) return [];

  const scored = [];
  for (const n of notes) {
    for (const c of (n.chunks || [])) {
      const score = scoreChunk(n, c, ts, index);
      if (score > 0) scored.push({ score, note: n, chunk: c });
    }
  }
  scored.sort((a, b) =>
    b.score - a.score
    // Ties go to the note edited most recently: when two notes say equally
    // relevant things, the newer one is the one that is still true.
    || String(b.note.updated || '').localeCompare(String(a.note.updated || ''))
    || String(a.note.path).localeCompare(String(b.note.path)));

  const top = scored.length ? scored[0].score : 0;
  const floor = Math.max(MIN_SCORE, top * RELATIVE);

  const out = [];
  let used = 0;
  for (const s of scored) {
    if (out.length >= maxChunks) break;
    if (s.score < floor) break;   // sorted, so the rest are weaker still
    const len = s.chunk.text.length;
    // A single chunk larger than the whole budget is skipped rather than
    // truncated: half a paragraph read as a complete thought is how an
    // assistant ends up confidently quoting something nobody wrote.
    if (len > maxChars) continue;
    if (used + len > maxChars) continue;
    out.push(s);
    used += len;
  }
  return out;
}

/** The block appended to PLAYER TWO's context. Empty string when nothing hits. */
export function brainContext(question, index, opts) {
  const hits = search(question, index, opts);
  if (!hits.length) return '';
  const body = hits.map(h => {
    const where = h.chunk.heading ? `${h.note.title} › ${h.chunk.heading}` : h.note.title;
    return `--- ${where} (${h.note.path})\n${h.chunk.text}`;
  }).join('\n\n');
  return 'FROM NEEL’S NOTES (his own vault; quote it as his, not as fact you looked up):\n' + body;
}
