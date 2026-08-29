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

import { schedule, examCountdown, fblStatus, fmtTime, fmtDay } from './exams.js';

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
    agent: 'media',
  },
  // Everything below arrived later, and the shape is deliberate: each entry names
  // its tables one at a time. The alternative — "whatever this tab happens to have
  // loaded" — means a store added to a tab next year silently starts leaving the
  // browser, and nobody reviews a change that was never written down.
  college:   { label: 'College',   reads: ['timetable', 'subjects'],        blurb: 'your timetable and subjects', agent: 'college' },
  todo:      { label: 'Tasks',     reads: ['todos'],                        blurb: 'your task list', agent: 'todo' },
  habits:    { label: 'Habits',    reads: ['habits', 'habit_logs'],         blurb: 'your habits and their logs', agent: 'habits' },
  goals:     { label: 'Goals',     reads: ['goals'],                        blurb: 'your goals', agent: 'goals' },
  study:     { label: 'Study',     reads: ['subjects', 'memory.study'],     blurb: 'your subjects and study sessions', agent: 'study' },
  notes:     { label: 'Notes',     reads: ['memory.notes'],                 blurb: 'your notes', agent: 'notes' },
  books:     { label: 'Books',     reads: ['memory.books'],                 blurb: 'your reading list', agent: 'books' },
  dsa:       { label: 'DSA',       reads: ['memory.dsa_solves'],            blurb: 'your solved problems', agent: 'dsa' },
  placement: { label: 'Placement', reads: ['memory.placement'],             blurb: 'your placement prep and applications', agent: 'placement' },
  health:    { label: 'Health',    reads: ['health_metrics', 'workouts'],   blurb: 'your health metrics and workouts', agent: 'health' },
  calendar:  { label: 'Calendar',  reads: ['memory.calendar_events', 'timetable', 'todos'], blurb: 'your calendar, classes and tasks', agent: 'calendar' },

  // Journal and money are deliberately ABSENT, and their absence is the design.
  // A tab with no entry here gets no data at all, so forgetting one is the safe
  // direction. Money has its own assistant with its own refusals; the journal is
  // not something a general chat window should be able to quote back.
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
    `You can see ONLY ${scope.blurb} — nothing from any other part of the app. If asked about money, the journal, or anything on another tab, say plainly that you cannot see it and name the tab that can.`,
    'Never state a number, a date or a name that is not in the context below. If the answer is not there, say what is missing rather than filling the gap.',
    'A list marked "showing N of M" is a window, not the whole set. Do not conclude anything from what is absent from it.',
  );

  if (tab === 'media') {
    // Tuned for GLM-5.2 specifically, and these are the four failures that made
    // the media assistant useless in testing rather than merely imperfect.
    base.push(
      // 1. The one unforgivable error. Recommending a film someone has already
      //    seen tells them instantly that it is not reading their data at all.
      'Never recommend a title in the ALREADY WATCHED list. Check that list before every single suggestion, including follow-ups later in the conversation.',
      // 2. Generic synopses are what a model produces when it is not using the
      //    context. Forcing the reason to cite THEIR rating or THEIR words makes
      //    the difference visible in the output.
      'Every suggestion needs its runtime and one concrete reason tied to something they actually rated or wrote — quote the rating or the phrase. A plot summary is not a reason.',
      // 3. Availability changes weekly and its training data does not.
      'You do NOT know what is streaming or where. If asked, point at the Where to Watch panel on each title and say your own knowledge of availability would be out of date.',
      // 4. GLM-5.2 is a strong, verbose reasoner and will happily produce ten
      //    ranked options with headings. Three is what fits the card, and a
      //    person choosing what to watch tonight cannot use ten.
      'Suggest at most three titles at a time, in prose. No numbered lists, no headings, no tables.',
      'Do not invent a rating, a year, a runtime or a film. Every one of those must come from the context.',
    );
  }

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

// ---------------------------------------------------------------------------
// The home dock's context.
//
// The dock answered "what's my second class on Monday" with "I don't have access
// to your class schedule" — correctly, because it was sent no data at all. The
// SCOPES table above grants nothing to a tab it does not name, and the dock is
// not a tab. It was reasoning from an empty room and saying so, which is the
// right behaviour for a component that has nothing; it was simply never given
// anything.
//
// WHAT GOES IN, AND WHAT DELIBERATELY DOES NOT.
//
// This context goes to GLM-5.2 on NVIDIA's free tier, whose terms say inputs are
// logged and used to train their models. So the allowlist here is not a
// convenience, it is the boundary: timetable, tasks, upcoming events, habit and
// goal NAMES. No money, no health, no journal, no body metrics — those questions
// belong to screens that route to the paid provider, and the dock must not become
// the side door that carries them out.
//
// Habit and goal TITLES rather than their logs: "Gym" and "Read 20 pages" say
// what someone is trying to do; the streak and the misses are a record of how
// they are coping, which is a different and more personal thing.
// 'subjects' carries attendance percentages. It is added knowingly: the College
// tab's own assistant already reads the same table on the same free-tier route,
// so this widens what the HOME dock sees without widening what leaves the app.
export const HOME_READS = ['timetable', 'todos', 'calendar_events', 'habits', 'goals', 'subjects'];
export const HOME_WITHHELD = ['money', 'health', 'journal', 'body'];

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ---------------------------------------------------------------------------
// Time, and the things the dock could not answer without it.
//
// The dock shipped saying "I don't have access to your class schedule" when
// asked what the next period was. It had the timetable. What it did not have
// was a CLOCK: the context said "Today is Saturday 2026-08-29" and stopped, so
// "next" was unanswerable — the model knew the day and not the hour, and
// correctly refused rather than guessing. Three fixes below, in order of how
// wrong they were:
//
//   1. The date was built with toISOString(), which is UTC. In IST (+5:30) that
//      reports TOMORROW from 18:30 onward, while the weekday beside it came
//      from getDay() and stayed local — so every evening the context stated a
//      day and a date that disagreed. Now both come from local time.
//   2. There was no time of day at all. There is now, with the timezone named.
//   3. "Next class" is date arithmetic across a week boundary, which is exactly
//      what language models get quietly wrong. So it is COMPUTED here and handed
//      over as a finished sentence, rather than left as an inference.

const hhmm = d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const isoLocal = d =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const rowDay   = r => String(r.day || r.weekday || '');
const rowStart = r => String(r.start || r.start_time || '');
const rowEnd   = r => String(r.end || r.end_time || '');
const rowName  = r => r.subject || r.name || r.title || 'class';
const onDay    = (r, day) => rowDay(r).toLowerCase().startsWith(day.slice(0, 3).toLowerCase());
const describe = r =>
  `${rowName(r)}${rowStart(r) ? ` at ${rowStart(r)}` : ''}${rowEnd(r) ? `–${rowEnd(r)}` : ''}`
  + `${r.room ? ` in ${r.room}` : ''}`;

/**
 * The class happening right now, and the next one due — searched forward across
 * a whole week so a Saturday question still answers with Monday's first class.
 * Returns finished sentences, or null when there is no timetable to search.
 */
export function classNow(timetable, now = new Date()) {
  if (!timetable || !timetable.length) return null;
  const t = hhmm(now);

  const todayRows = timetable.filter(r => onDay(r, DAYS[now.getDay()]))
    .sort((a, b) => rowStart(a).localeCompare(rowStart(b)));

  // In progress: started at or before now, and either has no end or ends later.
  const current = todayRows.find(r => rowStart(r) && rowStart(r) <= t && (!rowEnd(r) || rowEnd(r) > t)) || null;

  // Next up: later today first, then forward day by day. Seven, not six, so a
  // timetable with classes only on today's weekday still resolves — to next week.
  let next = null, offset = 0;
  const later = todayRows.find(r => rowStart(r) > t);
  if (later) { next = later; offset = 0; }
  else {
    for (let i = 1; i <= 7 && !next; i++) {
      const rows = timetable.filter(r => onDay(r, DAYS[(now.getDay() + i) % 7]))
        .sort((a, b) => rowStart(a).localeCompare(rowStart(b)));
      if (rows.length) { next = rows[0]; offset = i; }
    }
  }

  const when = offset === 0 ? 'later today'
    : offset === 1 ? 'tomorrow'
    : `on ${DAYS[(now.getDay() + offset) % 7]}`;

  return {
    current: current ? `In progress right now: ${describe(current)}.` : 'No class is in progress right now.',
    next: next ? `Next class: ${describe(next)}, ${when}.` : 'No classes are scheduled anywhere in the timetable.',
  };
}

// Amizone stores attendance as a fraction (0.81) or a percent (81). Same
// normalisation the College tab uses — duplicated deliberately rather than
// imported from a tab, because a lib importing a tab is the wrong direction.
import { attPct } from './attendance.js';

export function homeContext({
  timetable = [], todos = [], events = [], habits = [], goals = [], subjects = [], now = new Date(),
} = {}) {
  // LOCAL date. toISOString() is UTC and reported tomorrow from 18:30 IST
  // onwards, while the weekday beside it came from getDay() and stayed local —
  // so the context contradicted itself every evening.
  const today = isoLocal(now);
  let tz = '';
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { /* older engines */ }
  const parts = [
    `Right now it is ${hhmm(now)} on ${DAYS[now.getDay()]} ${today}${tz ? ` (${tz})` : ''}.`,
    'Use this clock for any question about what is next, what is now, or how long is left.',
  ];

  // Computed, not inferred. "What is my next period" is date arithmetic across a
  // week boundary, and a model asked to do that from a raw list will answer
  // confidently and sometimes wrongly.
  const cn = classNow(timetable, now);
  if (cn) parts.push(cn.current, cn.next);

  // Grouped by day and kept IN ORDER, because "second class on Monday" is a
  // question about position in a sequence. A flat list sorted by anything else
  // cannot answer it, and a model handed an unordered list will confidently
  // pick one anyway.
  if (timetable.length) {
    for (const d of DAYS) {
      const rows = timetable
        .filter(r => String(r.day || r.weekday || '').toLowerCase().startsWith(d.slice(0, 3).toLowerCase()))
        .sort((a, b) => String(a.start || a.start_time || '').localeCompare(String(b.start || b.start_time || '')));
      if (!rows.length) continue;
      parts.push(`${d} classes, in order: ` + rows.map((r, i) =>
        `${i + 1}) ${r.subject || r.name || r.title || 'class'}`
        + `${r.start || r.start_time ? ` at ${r.start || r.start_time}` : ''}`
        + `${r.room ? ` in ${r.room}` : ''}`).join('; ') + '.');
    }
  } else {
    // Said out loud. An absent section reads to a model as "nothing scheduled",
    // and "you have no classes" is a wrong answer dressed as a helpful one.
    parts.push('No timetable rows are stored, so class questions cannot be answered from data.');
  }

  const open = todos.filter(t => !t.completed);
  if (open.length) {
    const dueSoon = open
      .filter(t => t.due_date)
      .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)))
      .slice(0, 12);
    parts.push(`${open.length} open task${open.length === 1 ? '' : 's'}.`);
    if (dueSoon.length) {
      parts.push('Next due: ' + dueSoon.map(t =>
        `${clip(t.title, 60)} on ${t.due_date}${t.due_time ? ` at ${t.due_time}` : ''}`).join('; ') + '.');
    }
  } else {
    parts.push('No open tasks.');
  }

  const upcoming = events
    .filter(e => e.start && String(e.start).slice(0, 10) >= today)
    .sort((a, b) => String(a.start).localeCompare(String(b.start)))
    .slice(0, 10);
  if (upcoming.length) {
    parts.push('Upcoming calendar events: ' + upcoming.map(e =>
      `${clip(e.summary, 60)} (${String(e.start).slice(0, 16).replace('T', ' ')}`
      + `${e.accountLabel ? `, ${e.accountLabel}` : ''})`).join('; ') + '.');
  }

  if (habits.length) parts.push(`Habits being tracked: ${habits.map(h => clip(h.name || h.title, 40)).filter(Boolean).join(', ')}.`);
  if (goals.length)  parts.push(`Current goals: ${goals.map(g => clip(g.title || g.name, 60)).filter(Boolean).join(', ')}.`);

  // Attendance. The single most-asked question about this app's college data,
  // and the dock could not answer it at all — subjects were never passed in.
  const rated = subjects.map(x => ({ name: x.name || x.code, pct: attPct(x.attendance_pct) }))
    .filter(x => x.name && x.pct != null);
  if (rated.length) {
    const avg = Math.round(rated.reduce((n, x) => n + x.pct, 0) / rated.length);
    parts.push('Attendance by subject: ' + rated.map(x => `${clip(x.name, 50)} ${x.pct}%`).join('; ')
      + `. Average ${avg}%.`);
    const low = rated.filter(x => x.pct < 75);
    parts.push(low.length
      ? `Below the 75% requirement: ${low.map(x => `${clip(x.name, 50)} (${x.pct}%)`).join(', ')}.`
      : 'Nothing is below the 75% attendance requirement.');
  } else if (subjects.length) {
    parts.push('Subjects are listed but no attendance percentages have synced yet.');
  }

  // Exams and the Spanish FBL deadline are fixed facts, imported rather than
  // passed, so no caller can forget them. Dropped once the block has passed —
  // stale exam dates in a prompt are worse than none.
  const cd = examCountdown(today);
  if (cd.state !== 'after') {
    parts.push('Minor exams — ' + schedule()
      .map(e => `${fmtDay(e.date)} ${e.short} ${fmtTime(e.start)}`).join('; ') + `. ${cd.text}.`);
  }
  const fbl = fblStatus(today);
  if (fbl.state === 'open') {
    parts.push(`Spanish FBL: ${fbl.text}. A missed module cannot be attempted later.`);
  }

  parts.push('You can see the above and nothing else. Money, health and journal data are '
    + 'not available to you — if asked, say so plainly and point at the Money or Health tab '
    + 'rather than guessing.');

  const out = parts.join('\n');
  return out.length > MAX_CONTEXT_CHARS ? out.slice(0, MAX_CONTEXT_CHARS - 1) + '…' : out;
}

// ---------------------------------------------------------------------------
// A context for every scoped tab.
//
// One function rather than eleven bespoke ones, because eleven would drift: the
// tenth would forget to state its empty case, and an empty section reads to a
// model as "there is nothing" rather than "I was not given this". That confusion
// is the single most common way an assistant says something false with total
// confidence, so it is handled once, here, for all of them.
//
// Everything is capped and the cap is announced. "Showing 20 of 143" tells the
// model it is looking at a window; a silently truncated list tells it those are
// all the tasks that exist, and it will happily reason from that.

const CAP = 20;

function section(title, rows, render) {
  if (!rows || !rows.length) return `${title}: none recorded.`;
  const shown = rows.slice(0, CAP);
  const head = rows.length > CAP ? `${title} (showing ${CAP} of ${rows.length})` : title;
  return `${head}: ` + shown.map(render).filter(Boolean).join('; ') + '.';
}

const d10 = v => String(v || '').slice(0, 10);

export function tabContext(tab, data = {}, now = new Date()) {
  const scope = SCOPES[tab];
  if (!scope) return null;              // no entry, no data — the safe direction

  const p = [`Today is ${now.toISOString().slice(0, 10)}.`];
  const {
    timetable = [], subjects = [], todos = [], habits = [], habitLogs = [], goals = [],
    notes = [], books = [], dsa = [], placement = [], health = [], workouts = [],
    events = [], study = [],
  } = data;

  switch (tab) {
    case 'college':
      p.push(section('Classes', timetable, r => `${r.day || ''} ${r.start || r.start_time || ''} ${r.subject || r.name || ''}${r.room ? ` (${r.room})` : ''}`.trim()));
      p.push(section('Subjects', subjects, s2 => `${s2.name || s2.code}${s2.attendance != null ? ` — attendance ${s2.attendance}%` : ''}`));
      break;
    case 'todo':
      p.push(section('Open tasks', todos.filter(t => !t.completed),
        t => `${t.title}${t.due_date ? ` due ${t.due_date}` : ''}${t.due_time ? ` ${t.due_time}` : ''}${t.duration_min ? ` (${t.duration_min}m)` : ''}`));
      p.push(`${todos.filter(t => t.completed).length} completed task(s) on record.`);
      break;
    case 'habits':
      p.push(section('Habits', habits, h => h.name || h.title));
      // Counts rather than the raw log: "17 check-ins in 30 days" is the shape of
      // the question people actually ask, and the individual dates are noise.
      p.push(`${habitLogs.length} check-in(s) logged in total.`);
      break;
    case 'goals':
      p.push(section('Goals', goals, g => `${g.title || g.name}${g.target ? ` → ${g.target}` : ''}${g.done ? ' (done)' : ''}`));
      break;
    case 'study':
      p.push(section('Subjects', subjects, s2 => s2.name || s2.code));
      p.push(section('Recent study sessions', study, x => `${d10(x.date || x.on)} ${x.subject || ''} ${x.minutes ? `${x.minutes}m` : ''}`.trim()));
      break;
    case 'notes':
      // Titles and a short excerpt, never whole notes. A note is closer to a
      // journal entry than to a row of data, and the whole text of one is rarely
      // needed to answer a question about which notes exist.
      p.push(section('Notes', notes, n => `${n.title || 'untitled'}${n.body ? ` — ${clip(n.body, 120)}` : ''}`));
      break;
    case 'books':
      p.push(section('Books', books, b => `${b.title}${b.author ? ` by ${b.author}` : ''}${b.status ? ` (${b.status})` : ''}${b.rating ? ` ${b.rating}/5` : ''}`));
      break;
    case 'dsa':
      p.push(section('Solved problems', dsa, x => `${x.title || x.name}${x.difficulty ? ` (${x.difficulty})` : ''}${x.on ? ` on ${d10(x.on)}` : ''}`));
      break;
    case 'placement':
      p.push(section('Applications and prep', placement, x => `${x.company || x.title || ''}${x.role ? ` — ${x.role}` : ''}${x.status ? ` (${x.status})` : ''}`.trim()));
      break;
    case 'health':
      p.push(section('Recent metrics', health, m => `${d10(m.date || m.on)} ${m.kind || m.metric || ''} ${m.value ?? ''}${m.unit || ''}`.trim()));
      p.push(section('Workouts', workouts, w => `${d10(w.date || w.on)} ${w.kind || w.type || 'workout'}${w.minutes ? ` ${w.minutes}m` : ''}`));
      break;
    case 'calendar':
      p.push(section('Upcoming events', events.filter(e => d10(e.start) >= now.toISOString().slice(0, 10)),
        e => `${e.summary} ${String(e.start).slice(0, 16).replace('T', ' ')}${e.accountLabel ? ` [${e.accountLabel}]` : ''}`));
      p.push(section('Classes', timetable, r => `${r.day || ''} ${r.start || r.start_time || ''} ${r.subject || r.name || ''}`.trim()));
      p.push(section('Tasks with a date', todos.filter(t => !t.completed && t.due_date),
        t => `${t.title} ${t.due_date}${t.due_time ? ` ${t.due_time}` : ''}`));
      break;
    default:
      return null;
  }

  p.push(`You can see ONLY ${scope.blurb}. Anything else — money, journal, or another tab — is not available to you; say so rather than guessing.`);
  const out = p.join('\n');
  return out.length > MAX_CONTEXT_CHARS ? out.slice(0, MAX_CONTEXT_CHARS - 1) + '…' : out;
}
