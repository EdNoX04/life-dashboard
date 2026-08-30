// Turning a lecture into a note.
//
// The transcript and the kept slides go to Claude; what comes back is filed in
// the vault, which puts it in Study and in PLAYER TWO's retrieval without any
// further wiring.
//
// TWO NOTES, NOT ONE — this is the "lossless" part, and it is a real decision.
// The write-up is lossy by definition; a summary that dropped the one thing that
// mattered would otherwise be unrecoverable without re-attending the lecture. So
// the raw transcript is filed as its own note beside it. Keeping both in ONE
// note would be worse than either: nine thousand words of transcript in the same
// file would dominate retrieval, and every question about the subject would pull
// back raw speech instead of the notes written from it.
//
// The slide IMAGES are not filed. Twenty-five JPEGs a lecture is megabytes a week
// into a git repo that exists to hold text, and the part worth keeping — what was
// on them — is in the notes. Their timestamps are recorded so the recording can
// be matched up if it ever matters.

const pad = n => String(n).padStart(2, '0');
export const todayISO = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const SYSTEM = [
  'You are writing lecture notes for Neel, a CSE student at Amity, from a transcript of a class and images of the slides shown.',
  'Write the notes a diligent classmate would take: the actual content, in the order it was taught.',
  'Markdown. Start with a single # heading naming the topic. Use ## for each section of the lecture.',
  'Prefer the lecturer\'s own definitions, formulas and examples over paraphrase — this is study material, not a summary.',
  'Formulas and code go in fenced blocks or backticks, exactly as given.',
  'Where a slide shows something the speech does not explain, write what the slide says.',
  'If the lecturer flags something as important, examinable, or likely to appear in a paper, put it under a ## Worth remembering section at the end, quoting what they said.',
  'The transcript is machine-made and will contain mishearings. Where a technical term is clearly garbled, write the term you are confident was meant. Where you are NOT confident, keep the transcript wording and mark it [unclear] — inventing a plausible term is how a wrong definition ends up being revised from.',
  'Do not invent content that is in neither the transcript nor the slides. A short set of notes from a thin lecture is correct; a padded one is not.',
  'No preamble, no "in this lecture we". Start at the first heading.',
].join(' ');

/**
 * The messages for the write-up call.
 *
 * Slides are sent as images with their timestamp, so the model can line a slide
 * up with what was being said at the time rather than guessing an order.
 */
export function buildMessages({ transcript, slides = [], subject }) {
  const content = [];
  content.push({
    type: 'text',
    text: `Subject: ${subject || 'unspecified'}\n\nTRANSCRIPT (machine-made, may contain errors):\n\n${transcript}`,
  });
  for (const s of slides) {
    const m = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(s.dataUrl || '');
    if (!m) continue;
    content.push({ type: 'text', text: `Slide shown at ${s.label || s.at || ''}:` });
    content.push({ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } });
  }
  return [{ role: 'user', content }];
}

/** Strip a fenced wrapper the model sometimes adds around whole documents. */
export function unfence(text) {
  const t = String(text || '').trim();
  const m = /^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/.exec(t);
  return (m ? m[1] : t).trim();
}

/** The title, taken from the note's own first heading — not from the filename. */
export function titleOf(md, fallback) {
  const m = /^#\s+(.+)$/m.exec(String(md || ''));
  return (m ? m[1] : '').trim() || fallback || 'Lecture';
}

const frontmatter = ({ type, tags, date }) =>
  `---\ntype: ${type}\ntags: [${tags.join(', ')}]\ncreated: ${date}\n---\n\n`;

const slug = s => String(s || 'lecture').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'lecture';

/**
 * The two rows to queue. `vault_inbox` validates the path again on the way out —
 * this only has to produce something it will accept.
 */
export function inboxRows({ notes, transcript, slides = [], subject, date = todayISO(), minutes = 0 }) {
  const clean = unfence(notes);
  if (!clean) throw new Error('The write-up came back empty.');
  const day = String(date).slice(0, 10);
  const base = `${day}-${slug(subject)}`;
  const title = titleOf(clean, subject);
  const tags = ['lecture', slug(subject)].filter(Boolean);

  const noteBody =
    frontmatter({ type: 'note', tags, date: day })
    + clean.trimEnd()
    + `\n\n---\n\n*From a ${Math.round(minutes)}-minute recording on ${day}`
    + (slides.length ? `, with ${slides.length} slide${slides.length === 1 ? '' : 's'}` : '')
    + `. Raw transcript: [[${base}-transcript]].*\n`;

  const rows = [{
    path: `college/lectures/${base}.md`,
    title,
    body: noteBody,
    source: 'lecture-recorder',
  }];

  if (transcript && transcript.trim()) {
    rows.push({
      path: `college/lectures/${base}-transcript.md`,
      title: `${title} — transcript`,
      // Marked plainly as machine-made. A transcript read later as though it
      // were something the lecturer wrote is a quiet way to learn a mishearing.
      body: frontmatter({ type: 'reference', tags: [...tags, 'transcript'], date: day })
        + `# ${title} — transcript\n\n`
        + `*Machine transcription of the ${day} recording. Unedited, and it contains mistakes — `
        + `kept so the notes can be rewritten without sitting through the lecture again.*\n\n`
        + (slides.length ? `Slides changed at: ${slides.map(s => s.label || s.at).join(', ')}.\n\n` : '')
        + transcript.trim() + '\n',
      source: 'lecture-recorder',
    });
  }
  return rows;
}
