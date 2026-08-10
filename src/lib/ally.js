// The floating assistant's context rules.
//
// The brief was "it can access the info of the current tab you're in — make sure
// it only accesses the tab which is open and not other tabs". That is a real
// constraint, not a preference, and it has to be enforced somewhere a component
// cannot casually bypass. So the context is BUILT here, from an explicit
// per-tab allowlist, and the chat component is handed a finished string it had
// no part in assembling.
//
// Why it matters beyond tidiness: this app holds money, health and journal data.
// A helper that quietly slips your portfolio into a prompt about films is
// sending your net worth to a third-party API you did not think you were
// invoking for that. The allowlist is what makes "only this tab" checkable
// rather than merely intended.
//
// The second rule is about the answer rather than the data: the assistant is
// told what it may not do. It suggests films; it does not claim availability it
// cannot see, and it never recommends something already in the diary — the two
// failures that would make it useless within a week.

export const MAX_CONTEXT_CHARS = 6000;

// What each tab is allowed to put in a prompt. A tab that is not in this table
// gets NO data at all — the assistant still answers, from general knowledge,
// and says that it cannot see the screen.
export const SCOPES = {
  media: {
    label: 'Media',
    // Named individually rather than "everything the media tab loaded", so
    // adding a new store to that tab does not silently widen what leaves the
    // browser.
    reads: ['diary', 'shelf', 'lists'],
    blurb: 'your watch diary, shelf and lists',
  },
};

export const scopeFor = tab => SCOPES[tab] || null;

const clip = (s, n) => {
  const t = String(s ?? '');
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
};

/**
 * The media context, as compact text.
 *
 * Two decisions that shape what the model can do:
 *
 *   RATINGS AND REVIEWS ARE THE SIGNAL. "Watched 58 films" says nothing about
 *   taste. What you rated 5 and what you rated 1.5 says most of it, and your own
 *   words say the rest — so reviews go in, trimmed, ahead of raw counts.
 *
 *   EVERY TITLE SEEN GOES IN, EVEN UNDATED. The whole point of the exclusion
 *   rule is that it never suggests something you have watched, and 33 of these
 *   have no date. Sending only the diary would recommend a film you saw in 2023.
 */
export function mediaContext({ log = [], shelf = [], lists = [], now = new Date() } = {}) {
  const seen = log.filter(e => e.title);
  const rated = seen.filter(e => e.rating != null).sort((a, b) => b.rating - a.rating);
  const loved = rated.slice(0, 12);
  const disliked = rated.slice(-6).filter(e => e.rating <= 2.5);
  const reviews = seen.filter(e => e.review).slice(0, 8);

  const recent = seen
    .filter(e => e.on)
    .sort((a, b) => String(b.on).localeCompare(String(a.on)))
    .slice(0, 12);

  const watchlist = shelf.filter(r => r.status === 'watchlist');
  const watching = shelf.filter(r => r.status === 'watching');

  const parts = [];
  parts.push(`Today is ${now.toISOString().slice(0, 10)}.`);
  parts.push(`They have logged ${seen.length} viewings.`);

  if (loved.length) {
    parts.push(`Rated highest: ${loved.map(e => `${e.title}${e.year ? ` (${e.year})` : ''} ${e.rating}/5`).join(', ')}.`);
  }
  if (disliked.length) {
    // What someone dislikes constrains a recommendation more sharply than what
    // they like — it rules things out.
    parts.push(`Rated poorly: ${disliked.map(e => `${e.title} ${e.rating}/5`).join(', ')}.`);
  }
  if (reviews.length) {
    parts.push(`In their own words:\n${reviews.map(e => `- ${e.title}: ${clip(e.review, 220)}`).join('\n')}`);
  }
  if (recent.length) {
    parts.push(`Most recent: ${recent.map(e => `${e.title} (${e.on})`).join(', ')}.`);
  }
  if (watching.length) parts.push(`Currently watching: ${watching.map(r => r.title).join(', ')}.`);
  if (watchlist.length) parts.push(`On the watchlist: ${watchlist.slice(0, 25).map(r => r.title).join(', ')}.`);
  if (lists.length) {
    parts.push(`Lists: ${lists.map(l => `${l.name} (${l.items.length})`).join(', ')}.`);
  }

  // The exclusion list is the last thing in the prompt and the longest, because
  // it is the instruction most likely to be ignored when truncated. Titles only
  // — no dates, no ratings — so it costs the fewest tokens per title.
  const titles = [...new Set(seen.map(e => e.title))];
  parts.push(`ALREADY WATCHED, never recommend these: ${titles.join(' | ')}`);

  return clip(parts.join('\n\n'), MAX_CONTEXT_CHARS);
}

/**
 * Build the context for whichever tab is open.
 *
 * Returns null for a tab with no scope, and the caller shows that as "I cannot
 * see this screen" rather than silently answering as though it could.
 */
export function buildContext(tab, data = {}, opts = {}) {
  const scope = scopeFor(tab);
  if (!scope) return null;
  if (tab === 'media') return mediaContext({ ...data, ...opts });
  return null;
}

// The system prompt. Written as constraints rather than personality, because the
// personality is in the CSS and the constraints are what keep the answers worth
// reading.
export function systemPrompt(tab, contextText) {
  const scope = scopeFor(tab);
  const base = [
    'You are the in-app assistant for a personal dashboard styled as a 1980s arcade terminal.',
    'Answer in short paragraphs. No headings, no bullet lists unless asked. Two or three sentences is usually right.',
    'You are talking to one person about their own data. Be direct and specific; skip pleasantries.',
  ];

  if (!scope || !contextText) {
    base.push(
      'You CANNOT see any of their data on this screen. Say so plainly if asked about it, and answer from general knowledge instead. Do not guess at what they have watched, own, or logged.',
    );
    return base.join(' ');
  }

  base.push(
    `You can see ONLY ${scope.blurb} — nothing from any other part of the app. If asked about money, health, tasks or anything else, say you can only see the ${scope.label} tab.`,
    'Never recommend a title in the ALREADY WATCHED list. Check it before every suggestion.',
    'When suggesting something, give the runtime and one concrete reason tied to what they actually rated or wrote — not a generic synopsis.',
    'You do NOT know what is currently streaming or on which service. If asked where to watch something, say the app has a Where to Watch panel on each title and that your own knowledge of availability would be out of date.',
    'Never invent a rating, a date, or a film. If the answer is not in the context, say what is missing.',
  );
  return `${base.join(' ')}\n\nTHEIR DATA:\n${contextText}`;
}

// Openers that do something rather than saying hello. Each is a question the
// context can actually answer, which is also how a new user learns what the
// thing is for.
export const PROMPTS = [
  { label: 'I HAVE 90 MINUTES', text: 'I have about 90 minutes tonight. What should I watch, and why that one?' },
  { label: 'MY TASTE?', text: 'Based on my ratings and reviews, describe my taste in films. Be specific and tell me something I might not have noticed.' },
  { label: 'FROM MY WATCHLIST', text: 'Pick something off my watchlist for tonight and make the case for it.' },
  { label: 'BLIND SPOTS', text: 'What kinds of films am I clearly avoiding or missing out on, given what I have watched?' },
];
