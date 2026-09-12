// The night summary — what the day actually contained.
//
// The evening mirror of the morning brief, and it is held to a harder standard
// than the brief is, because of what it is for. A brief that overstates the day
// ahead is corrected by the day itself within hours. A summary that overstates
// the day behind is never corrected at all: it becomes the record.
//
// THE ONE RULE EVERYTHING HERE OBEYS
//
//   Zero is a fact. Unmeasured is not.
//
// "0 minutes of focus" is a rebuke, and on a night when the timer was never
// running it is also a lie. "3 habits logged" out of a habit list nobody has
// created yet is a number about nothing. So every source arrives in one of two
// distinguishable states and the difference is preserved all the way to the
// screen:
//
//   null       — NOT MEASURED. Never rendered as zero. Named in `notMeasured`
//                with the reason, so the gap is a thing to fix rather than a
//                silence to misread.
//   [] / {}    — measured, and the answer was nothing. That is real, sayable,
//                and sometimes the most useful line in the summary.
//
// Callers must therefore be deliberate: passing `[]` for a table you could not
// read turns "I don't know" into "you did nothing", which is the exact failure
// this file exists to prevent.
//
// Nothing generative. Every line below is arithmetic over rows, for the same
// reason the morning brief is templated: a model asked to summarise a day will
// produce a confident sentence on a night when the data says almost nothing,
// and a confident sentence is indistinguishable from a measured one once it is
// on the screen.

const arr = v => (Array.isArray(v) ? v : null);
const n0 = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const pad = n => String(n).padStart(2, '0');

/** Local calendar date of an instant. Not toISOString() — that is UTC, and it
 *  files an 11pm entry under tomorrow for everyone east of Greenwich. */
export function localDay(v) {
  const d = new Date(v);
  if (!Number.isFinite(d.getTime())) return null;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const fmtMin = m => {
  const x = Math.round(n0(m));
  if (x < 60) return `${x}m`;
  const h = Math.floor(x / 60), r = x % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
};

// ------------------------------------------------------------------ sections
//
// Each builder returns a section, or null to leave it out, or a `gap` naming
// what could not be measured. A section is never invented to fill space: a
// summary padded with rows that say nothing trains you to stop reading it, and
// then the night something real happened goes past unread.

function doneSection(todos, date) {
  if (!arr(todos)) return { gap: { what: 'tasks', why: 'the todo list could not be read' } };
  const done = todos.filter(t => t?.completed && localDay(t.completed_at) === date);
  const open = todos.filter(t => !t?.completed && t?.due_date && t.due_date <= date);
  const lines = done.slice(0, 6).map(t => `✓ ${t.title}`);
  if (done.length > 6) lines.push(`…and ${done.length - 6} more`);
  // Carried-over work is said plainly and without comment. It is a fact about
  // tomorrow, not a verdict on today.
  if (open.length) lines.push(`${open.length} still open${open.some(t => t.due_date < date) ? ' (some overdue)' : ''}`);
  return {
    key: 'done', title: 'Done',
    body: done.length ? lines.join('\n') : (open.length ? lines.join('\n') : 'Nothing was ticked off today.'),
    count: done.length,
  };
}

function habitSection(habits, logs, date) {
  if (!arr(habits) || !arr(logs)) return { gap: { what: 'habits', why: 'habits or their logs could not be read' } };
  if (!habits.length) return null;   // no habits is not a failure to report on
  const today = new Set(logs.filter(l => (l?.date || localDay(l?.created_at)) === date).map(l => l?.habit_id));
  const hit = habits.filter(h => today.has(h?.id));
  return {
    key: 'habits', title: 'Habits',
    body: `${hit.length} of ${habits.length} logged`
      + (hit.length ? `\n${hit.map(h => `✓ ${h.name || h.title || 'habit'}`).join('\n')}` : ''),
    count: hit.length, of: habits.length,
  };
}

function focusSection(sessions, date) {
  // focus_sessions is the table migration 009 creates. Until that migration is
  // run there is no table, the read fails, and the honest report is that the
  // time was not measured — NOT that no time was spent.
  if (!arr(sessions)) {
    return { gap: { what: 'focus time', why: 'focus_sessions could not be read — migration 009 may not have been run' } };
  }
  const mine = sessions.filter(s => localDay(s?.ended_at) === date && s?.mode !== 'short' && s?.mode !== 'long');
  const total = mine.reduce((t, s) => t + n0(s.minutes), 0);
  if (!mine.length) return { key: 'focus', title: 'Focus', body: 'No focus blocks today.', minutes: 0 };
  const by = new Map();
  for (const s of mine) by.set(s.label || 'Focus', (by.get(s.label || 'Focus') || 0) + n0(s.minutes));
  const top = [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  return {
    key: 'focus', title: 'Focus',
    body: `${fmtMin(total)} across ${mine.length} block${mine.length === 1 ? '' : 's'}\n`
      + top.map(([l, m]) => `• ${l} — ${fmtMin(m)}`).join('\n'),
    minutes: total, blocks: mine.length,
  };
}

/**
 * Money. READ-ONLY and without a view, in this file as everywhere else.
 *
 * It reports the close against the previous snapshot and stops. No verdict, no
 * suggestion, nothing that could be read as one — a test walks the wording for
 * the same list of words notify.test.js bans, because a summary that starts
 * editorialising at 10pm is the most persuasive form this system could take.
 */
function moneySection(snapshots, date) {
  if (!arr(snapshots)) return { gap: { what: 'portfolio', why: 'no snapshot table could be read' } };
  const sorted = [...snapshots].filter(s => s?.date || s?.created_at)
    .sort((a, b) => String(a.date || a.created_at).localeCompare(String(b.date || b.created_at)));
  const today = sorted.filter(s => (s.date || localDay(s.created_at)) <= date).pop();
  if (!today) return null;
  const prev = sorted.filter(s => (s.date || localDay(s.created_at)) < (today.date || localDay(today.created_at))).pop();
  const v = n0(today.total_value ?? today.value);
  if (!v) return null;
  // A market that was closed today is not a flat day, and saying "unchanged"
  // about a Sunday is the kind of small wrongness that makes the whole summary
  // feel machine-written.
  const stale = (today.date || localDay(today.created_at)) !== date;
  const lines = [`Closed at ${v.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`];
  if (prev) {
    const p = n0(prev.total_value ?? prev.value);
    if (p) {
      const d = v - p, pct = (d / p) * 100;
      lines.push(`${d >= 0 ? '+' : '−'}${Math.abs(d).toLocaleString('en-IN', { maximumFractionDigits: 0 })} (${d >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(2)}%) since ${prev.date || localDay(prev.created_at)}`);
    }
  }
  if (stale) lines.push(`Last snapshot is from ${today.date || localDay(today.created_at)} — markets were shut today.`);
  return { key: 'money', title: 'Portfolio', body: lines.join('\n'), value: v };
}

function collegeSection(dayView) {
  // What was ON. Deliberately not "what you attended" — nothing in this system
  // knows whether he walked into the room, and a summary that implies it does
  // is worse than one that stays quiet.
  if (!dayView || !Array.isArray(dayView.rows)) return null;
  if (!dayView.known) {
    return { key: 'college', title: 'College',
      body: `${dayView.rows.length} class${dayView.rows.length === 1 ? '' : 'es'} on the usual timetable — the diary had nothing for today, so this is the pattern, not the day.` };
  }
  if (!dayView.rows.length && !(dayView.dropped || []).length) return null;
  const lines = [`${dayView.rows.length} class${dayView.rows.length === 1 ? '' : 'es'} scheduled`];
  const extra = dayView.rows.filter(r => r.change === 'extra');
  const moved = dayView.rows.filter(r => r.change === 'room');
  if (extra.length) lines.push(`${extra.length} extra: ${extra.map(r => r.subject).join(', ')}`);
  if (moved.length) lines.push(`${moved.length} moved room`);
  if ((dayView.dropped || []).length) lines.push(`${dayView.dropped.length} usual slot(s) had nothing in the diary`);
  return { key: 'college', title: 'College', body: lines.join('\n') };
}

function buildsSection(builds, date) {
  if (!arr(builds)) return null;
  const moved = builds.filter(b => localDay(b?.updated_at) === date);
  const live = builds.filter(b => b?.status === 'in_progress');
  if (!moved.length && !live.length) return null;
  const lines = [];
  for (const b of moved.slice(0, 4)) lines.push(`• ${b.name} — ${b.status}`);
  if (live.length && !moved.length) lines.push(`${live.length} still in progress`);
  return { key: 'builds', title: 'Builds', body: lines.join('\n') };
}

function mediaSection(viewings, date) {
  if (!arr(viewings)) return null;
  const today = viewings.filter(v => (v?.date || localDay(v?.watched_at)) === date);
  if (!today.length) return null;
  const mins = today.reduce((t, v) => t + n0(v.runtime), 0);
  return {
    key: 'media', title: 'Watched',
    body: today.slice(0, 4).map(v => `• ${v.title}`).join('\n')
      + (mins ? `\n${fmtMin(mins)} of runtime` : ''),
  };
}

function tomorrowSection(next) {
  // `next` is an agenda (agenda.js `agendaFor`) for tomorrow, or null.
  if (!next || !Array.isArray(next.items)) return null;
  const timed = next.items.filter(i => !i.allDay);
  if (!timed.length && !next.items.length) {
    return { key: 'tomorrow', title: 'Tomorrow', body: 'Nothing on the calendar.' };
  }
  const first = timed[0];
  const lines = [];
  if (first) {
    const t = new Date(first.at);
    lines.push(`First up ${pad(t.getHours())}:${pad(t.getMinutes())} — ${first.title}${first.where ? ` (${first.where})` : ''}`);
  }
  lines.push(`${next.items.length} thing${next.items.length === 1 ? '' : 's'} on the day`);
  if (next.conflicts?.length) {
    lines.push(`⚠ ${next.conflicts[0][0].title} × ${next.conflicts[0][1].title} are at the same time`);
  }
  return { key: 'tomorrow', title: 'Tomorrow', body: lines.join('\n') };
}

// ------------------------------------------------------------------ assemble

/**
 * The night summary for one date.
 *
 * Every source is optional and `null` means NOT MEASURED — see the rule at the
 * top of this file. The result carries the sections that had something to say
 * and, separately, everything that could not be measured and why.
 */
export function nightly({
  date, todos = null, habits = null, habitLogs = null, focusSessions = null,
  snapshots = null, builds = null, viewings = null, dayView = null, tomorrow = null,
  listening = null,
} = {}) {
  const day = String(date || '');
  const built = [
    doneSection(todos, day),
    habitSection(habits, habitLogs, day),
    focusSection(focusSessions, day),
    collegeSection(dayView),
    moneySection(snapshots, day),
    mediaSection(viewings, day),
    buildsSection(builds, day),
    tomorrowSection(tomorrow),
  ];

  const sections = [], notMeasured = [];
  for (const s of built) {
    if (!s) continue;
    if (s.gap) { notMeasured.push(s.gap); continue; }
    sections.push(s);
  }
  // Listening time is in the plan and has never had a source: the music tab is
  // scaffolding. It is named here rather than silently absent, because a
  // summary that simply omits what it cannot see reads as complete.
  if (listening == null) notMeasured.push({ what: 'listening time', why: 'the music tab is not connected to a provider' });

  return { date: day, sections, notMeasured, empty: sections.length === 0 };
}

/** One line for a notification or a card header. Says the day, not a verdict. */
export function headline(summary) {
  const s = summary?.sections || [];
  const by = k => s.find(x => x.key === k);
  const bits = [];
  const d = by('done'); if (d?.count) bits.push(`${d.count} task${d.count === 1 ? '' : 's'} done`);
  const h = by('habits'); if (h) bits.push(`habits ${h.count}/${h.of}`);
  const f = by('focus'); if (f?.minutes) bits.push(`${fmtMin(f.minutes)} focused`);
  return bits.length ? bits.join(' · ') : 'A quiet day by the numbers.';
}
