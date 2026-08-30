// Decisions, read out of the Obsidian vault.
//
// The Decision tab used to keep its own list in memory.decisions_log — a form
// with four inputs, saved nowhere else. Its own comment called it a scaffold,
// and it had the flaw every decision log has: writing "chose X" in a box is not
// writing down WHY, so six months later the record cannot answer the only
// question you ever actually ask, which is "did I already think about this?"
//
// Now the vault holds them. A decision is a note in `decisions/`, written in the
// format CONVENTIONS.md sets out — including the rejected options, which is the
// half that earns its keep. This file turns those notes back into structure.
//
// Parsing prose is a choice, not a limitation. The alternative is a form that
// writes the frontmatter, and a form cannot be filled in from a phone at
// midnight or from the WhatsApp bot later; Markdown can be written by anything.
// So the tab reads what a person wrote, and tolerates them not following the
// template exactly.

const OBSIDIAN_VAULT = 'brain';

// `**Decided** 2026-08-30`, or a `decided:`/`created:` frontmatter date the
// indexer already lifted out.
const DECIDED = /\*\*Decided\*\*\s*:?\s*(\d{4}-\d{2}-\d{2})/i;

// The inline bold labels the template uses. Each runs to the next label, a
// heading, or the end — so a multi-line "Rejected:" block survives intact
// rather than being cut at the first newline.
function labelled(text, label) {
  const re = new RegExp(`\\*\\*${label}\\s*:?\\*\\*\\s*:?\\s*([\\s\\S]*?)(?=\\n\\s*\\*\\*[A-Z]|\\n##\\s|$)`, 'i');
  const m = re.exec(text);
  return m ? m[1].trim() : '';
}

const sectionOf = (note, name) => {
  const c = (note.chunks || []).find(x => String(x.heading || '').toLowerCase() === name.toLowerCase());
  return c ? c.text.trim() : '';
};

const allText = note => (note.chunks || []).map(c => c.text).join('\n\n');

/**
 * One indexed note → what the tab renders.
 *
 * Everything is optional. A decision note with nothing but a title and a
 * sentence still shows up, because a tab that hides notes for failing a format
 * check teaches you that writing decisions down does not work.
 */
export function parseDecision(note) {
  const text = allText(note);
  const outcome = sectionOf(note, 'Outcome');
  return {
    path: note.path,
    title: note.title,
    tags: note.tags || [],
    decided: (DECIDED.exec(text) || [])[1] || note.updated || note.created || null,
    // The first paragraph that is not a label — the reasoning.
    why: firstProse(text),
    rejected: labelled(text, 'Rejected'),
    cost: labelled(text, 'Cost'),
    outcome,
    // `## Outcome` present and saying something is what "resolved" means. There
    // is no separate status field to fall out of step with the note.
    resolved: Boolean(outcome),
    verdict: verdictOf(outcome),
    obsidian: `obsidian://open?vault=${encodeURIComponent(OBSIDIAN_VAULT)}&file=${encodeURIComponent(note.path.replace(/\.md$/i, ''))}`,
  };
}

function firstProse(text) {
  for (const para of text.split(/\n\s*\n/)) {
    const p = para.trim();
    if (!p) continue;
    if (/^\*\*(Decided|Rejected|Cost|Outcome)/i.test(p)) continue;
    if (/^#{1,6}\s/.test(p)) continue;
    return p.replace(/\s+/g, ' ');
  }
  return '';
}

// Read from the words, not from a dropdown. Someone writing up how a decision
// turned out says "worked" or "mistake"; making them also pick from a menu is
// how the menu ends up saying something the paragraph contradicts.
function verdictOf(outcome) {
  if (!outcome) return null;
  const t = outcome.toLowerCase();
  if (/\b(worked|right call|good call|correct|paid off|glad)\b/.test(t)) return 'worked';
  if (/\b(mistake|wrong|regret|didn'?t work|failed|bad call|backfired)\b/.test(t)) return 'didn’t';
  return 'mixed';
}

/** Every decision note in the index, newest first. */
export function decisionsFrom(index) {
  return (index?.notes || [])
    .filter(n => String(n.type || '').toLowerCase() === 'decisions' || String(n.path || '').startsWith('decisions/'))
    .map(parseDecision)
    .sort((a, b) => String(b.decided || '').localeCompare(String(a.decided || ''))
      || String(a.title).localeCompare(String(b.title)));
}

/** The template, for the "new decision" button. Kept next to the parser so the
 *  thing offered and the thing understood cannot drift apart. */
export function decisionTemplate(title = 'What you decided') {
  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return `---
type: decision
tags: []
created: ${iso}
---

# ${title}

**Decided** ${iso}

Why, in a sentence or two.

**Rejected:** what you did not do, and what was wrong with it.

**Cost:** what this choice costs you, accepted knowingly.
`;
}
