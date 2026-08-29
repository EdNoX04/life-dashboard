// Exams, the revision plan, and the Spanish FBL module deadlines.
//
// Everything here is pure: dates in, plain objects out, no clock read except
// through an argument. That is deliberate — a countdown that silently uses
// `new Date()` inside the function is a countdown you cannot test, and this
// one has to be right on the morning of the first paper.
//
// The schedule was published as three dates without a subject order, so this
// module used to leave the mapping null and ask the user. The university has
// since confirmed it, WITH times — and two papers fall on the same day — so the
// mapping is now a known constant (EXAM_SCHEDULE) and the planner is built
// around real per-paper date+time, not one-paper-per-day.

export const EXAM_WINDOW = { from: '2026-09-01', to: '2026-09-03', label: '1–3 September 2026' };

// The three papers. `slug` matches the study-guide filename in /study/.
export const SUBJECTS = [
  {
    slug: 'advanced-network-security',
    name: 'Advanced Network Security & IAM',
    short: 'Network Security',
    code: 'CSE337',
    color: 'var(--cyan)',
    modules: [
      'VPN & Wireless / IoT Security',
      'Zero Trust Architecture',
      'IAM & Authentication Fundamentals',
      'Secure Coding',
      'OT Security',
    ],
  },
  {
    slug: 'blockchain',
    name: 'Blockchain',
    short: 'Blockchain',
    code: 'CSE475',
    color: 'var(--purple)',
    modules: [
      'Intro to Blockchain & Platforms',
      'Ethereum',
      'Hyperledger Fabric',
      'Hyperledger Composer',
      'Blockchain Use Cases',
    ],
  },
  {
    slug: 'iot-system-design',
    name: 'IoT System Design',
    short: 'IoT',
    code: 'ECE441',
    color: 'var(--green)',
    modules: [
      'Embedded Systems & IoT',
      'Automation: Arduino & ESP8266',
      'Raspberry Pi 3',
      'Rpi3 Interfacing',
    ],
  },
];

// The confirmed timetable. Times are 24h, local (IST). This is the single
// source of truth the planner reads — note two papers on 3 Sept, and 1 Sept is
// free (so it is a study/eve day, not an exam day).
export const EXAM_SCHEDULE = [
  { slug: 'blockchain', date: '2026-09-02', start: '16:00', end: '17:00' },
  { slug: 'advanced-network-security', date: '2026-09-03', start: '10:00', end: '11:00' },
  { slug: 'iot-system-design', date: '2026-09-03', start: '16:00', end: '17:00' },
];

// The calendar days of the exam block (1–3 Sept). Kept for the countdown strip.
// Which of them actually hold a paper is derived from EXAM_SCHEDULE, not assumed.
export const EXAM_DATES = ['2026-09-01', '2026-09-02', '2026-09-03'];

// ---------------------------------------------------------------- dates

const DAY = 86400000;
export const iso = d => {
  const x = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(x.getTime())) return null;
  // Local calendar date, not UTC. Asia/Kolkata is UTC+5:30, so toISOString()
  // on any evening here reports tomorrow — which would make a countdown read
  // one day short every single evening.
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

const parse = s => {
  if (typeof s !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Whole days from `from` to `to`. Negative once `to` is in the past. */
export function daysBetween(from, to) {
  const a = parse(from), b = parse(to);
  if (!a || !b) return null;
  return Math.round((b - a) / DAY);
}

export const addDays = (isoDate, n) => {
  const d = parse(isoDate);
  if (!d) return null;
  d.setDate(d.getDate() + n);
  return iso(d);
};

const fmtDay = s => {
  const d = parse(s);
  if (!d) return '';
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
};
export { fmtDay };

/** "16:00" → "4:00 PM". Pure string math so it needs no Date and no locale. */
export function fmtTime(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return '';
  let h = +m[1];
  const ampm = h < 12 ? 'AM' : 'PM';
  h = h % 12 || 12;
  return `${h}:${m[2]} ${ampm}`;
}

// ---------------------------------------------------------------- countdown

/**
 * How the exam block sits relative to today. Distinguishes "not started",
 * "in progress" and "done" rather than letting a negative number leak into
 * the UI as "-4 days to go".
 */
export function examCountdown(today) {
  const toStart = daysBetween(today, EXAM_WINDOW.from);
  const toEnd = daysBetween(today, EXAM_WINDOW.to);
  if (toStart == null || toEnd == null) return { state: 'unknown', days: null, text: 'exam dates unavailable' };
  if (toStart > 0) {
    return {
      state: 'before',
      days: toStart,
      text: toStart === 1 ? 'first paper is tomorrow' : `${toStart} days to the first paper`,
    };
  }
  if (toEnd >= 0) return { state: 'during', days: toEnd, text: toEnd === 0 ? 'last paper is today' : `${toEnd} day${toEnd === 1 ? '' : 's'} of exams left` };
  return { state: 'after', days: -toEnd, text: 'exams finished' };
}

// ---------------------------------------------------------------- FBL (Spanish)

// Verbatim from the course notice. Each window is inclusive of both dates.
// The rule that matters, and the reason this is a reminder rather than a note:
// a missed module CANNOT be attempted later. You may move on to the next one,
// but the missed one is gone.
import { fblDoneKey } from './reminders.js';

export const FBL_MODULES = [
  { n: 1, label: 'Module 1', from: '2026-08-17', to: '2026-08-28' },
  { n: 2, label: 'Module 2', from: '2026-08-29', to: '2026-09-11' },
  { n: 3, label: 'Module 3', from: '2026-09-12', to: '2026-09-25' },
  { n: 4, label: 'Module 4', from: '2026-09-26', to: '2026-10-09' },
  { n: 5, label: 'Module 5', from: '2026-10-10', to: '2026-10-23' },
  { n: 6, label: 'Assignment 2', from: '2026-10-24', to: '2026-11-06' },
];

export const FBL_RULE =
  'A missed module cannot be attempted later. You may proceed to the next one, ' +
  'provided it is completed within its own deadline.';

/**
 * Which FBL window is open on `today`, how long is left, and what is next.
 * `urgency` drives the colour: 'now' (≤2 days left) reads red, because the
 * penalty for missing is permanent and there is no catch-up.
 */
export function fblStatus(today, doneMap = {}) {
  const t = parse(today);
  if (!t) return { state: 'unknown', modules: [] };

  // Every module, each carrying whether Neel has ticked it. Both this file's
  // callers (the HQ reminder and the Study card) need the same list with the
  // same flags, and deriving it twice is how they would end up disagreeing.
  const modules = FBL_MODULES.map(m => {
    const key = fblDoneKey(m);
    return {
      ...m,
      key,
      done: Boolean(doneMap && Object.prototype.hasOwnProperty.call(doneMap, key) && doneMap[key]),
      closed: today > m.to,   // the window has passed — not the same as finished
    };
  });

  const containing = modules.find(m => today >= m.from && today <= m.to) || null;
  // "Next" skips anything already finished. Ticking module 2 early should surface
  // module 3, not the next unfinished thing in date order that happens to be 2.
  const next = modules.find(m => m.from > today && !m.done) || null;

  // Finished the module whose window is currently open. This is a real state and
  // it did not exist before: previously the only way out of 'open' was for the
  // window to close, so the card nagged for the full fortnight regardless.
  if (containing && containing.done) {
    return {
      state: 'ahead',
      current: null,
      finished: containing,
      next,
      modules,
      daysToNext: next ? daysBetween(today, next.from) : null,
      urgency: 'later',
      text: next
        ? `${containing.label} done — ${next.label} opens ${fmtDay(next.from)}`
        : `${containing.label} done — nothing left`,
    };
  }

  if (!containing) {
    if (next) {
      return {
        state: 'between', current: null, next, modules,
        daysToNext: daysBetween(today, next.from),
        urgency: 'later',
        text: `${next.label} opens ${fmtDay(next.from)}`,
      };
    }
    return { state: 'done', current: null, next: null, modules, urgency: 'later', text: 'all FBL modules have closed' };
  }

  const left = daysBetween(today, containing.to);
  return {
    state: 'open',
    current: containing,
    next: next || null,
    modules,
    daysLeft: left,
    urgency: left <= 2 ? 'now' : left <= 5 ? 'soon' : 'later',
    text: left === 0
      ? `${containing.label} closes TODAY`
      : `${containing.label} closes ${fmtDay(containing.to)} — ${left} day${left === 1 ? '' : 's'} left`,
  };
}

// ---------------------------------------------------------------- schedule

const byId = slug => SUBJECTS.find(s => s.slug === slug);

/** Papers on a given date, in time order, each merged with its subject. */
export function papersOn(date) {
  return EXAM_SCHEDULE
    .filter(e => e.date === date)
    .map(e => ({ ...byId(e.slug), ...e }))
    .sort((a, b) => a.start.localeCompare(b.start));
}

/** Distinct dates that actually hold a paper, sorted. */
export const examDays = () => [...new Set(EXAM_SCHEDULE.map(e => e.date))].sort();

/** The whole timetable, subject-merged and in date/time order — for the UI strip. */
export function schedule() {
  return [...EXAM_SCHEDULE]
    .map(e => ({ ...byId(e.slug), ...e }))
    .sort((a, b) => (a.date === b.date ? a.start.localeCompare(b.start) : a.date.localeCompare(b.date)));
}

// ---------------------------------------------------------------- planner

/**
 * A day-by-day plan from `today` to the last paper, built from EXAM_SCHEDULE.
 *
 * The rules, and they are the whole design:
 *  1. A day may hold zero, one or TWO papers. The planner reads the real
 *     timetable rather than assuming one paper per day.
 *  2. The evening before a paper-day belongs to that day's FIRST paper — the
 *     one with no daytime runway. A later same-day paper is caught in the gap
 *     between papers, so it is noted, not crammed tonight.
 *  3. On a two-paper day, the window between the papers is scheduled: it is the
 *     single best time to do the afternoon paper's final pass.
 *  4. An exam evening that is itself the night before the next paper-day gets a
 *     trailing "after the paper, tonight becomes…" note, so back-to-back exam
 *     days (2 Sept → 3 Sept) are handled honestly.
 *  5. Everything else is a round-robin across subjects, not one subject blocked
 *     at a time — interleaving recalls better under pressure, which is the thing
 *     being marked.
 */
export function revisionPlan(today) {
  const start = parse(today);
  const last = parse(EXAM_WINDOW.to);
  if (!start || !last || start > last) return { days: [], note: 'The exam block has passed.' };

  // Every (subject, module) pair, interleaved so consecutive slots differ.
  const queue = [];
  const maxLen = Math.max(...SUBJECTS.map(s => s.modules.length));
  for (let i = 0; i < maxLen; i++) {
    SUBJECTS.forEach(s => {
      if (s.modules[i]) queue.push({ subject: s.short, module: s.modules[i], n: i + 1 });
    });
  }

  const days = [];
  for (let d = iso(start); d && d <= EXAM_WINDOW.to; d = addDays(d, 1)) {
    const papers = papersOn(d);
    const tomorrow = addDays(d, 1);
    const nextPapers = papersOn(tomorrow);

    if (papers.length) {
      // An exam day. Could be one or two papers.
      const names = papers.map(p => p.short).join(' + ');
      const items = [];
      papers.forEach((pp, i) => {
        if (i === 0) {
          items.push(`${fmtTime(pp.start)} — ${pp.short} paper. Before it: skim only the EXAM TRAP and “extra marks” boxes for ${pp.short}.`);
        } else {
          const prev = papers[i - 1];
          items.push(`${fmtTime(prev.end)}–${fmtTime(pp.start)} — the gap is your last ${pp.short} pass: traps + “most likely questions” only, then stop.`);
          items.push(`${fmtTime(pp.start)} — ${pp.short} paper.`);
        }
      });
      // If tomorrow also holds a paper, tonight (after the last paper) is its eve.
      if (nextPapers.length) {
        const first = nextPapers[0];
        items.push(`After ${papers[papers.length - 1].short} (${fmtTime(papers[papers.length - 1].end)}): tonight becomes the ${first.short} final pass — tomorrow is ${nextPapers.map(p => `${p.short} ${fmtTime(p.start)}`).join(' then ')}.`);
      }
      days.push({
        date: d, label: fmtDay(d), kind: 'exam',
        title: papers.length > 1 ? `${names} papers` : `${names} paper`,
        color: papers[0].color,
        papers: papers.map(p => ({ short: p.short, start: p.start, end: p.end, color: p.color })),
        items,
      });
      continue;
    }

    if (nextPapers.length) {
      // The night before a paper-day.
      const first = nextPapers[0];
      const items = [
        `Whole ${first.short} guide, skimming: read only the bold lead-ins and every definition box.`,
        `Then its “most likely questions” end to end — answer out loud before revealing.`,
      ];
      if (nextPapers.length > 1) {
        const later = nextPapers.slice(1).map(p => `${p.short} ${fmtTime(p.start)}`).join(', ');
        items.unshift(`Tomorrow is a DOUBLE: ${nextPapers.map(p => `${p.short} ${fmtTime(p.start)}`).join(' then ')}. Tonight is ${first.short} — you’ll get the between-papers gap for ${nextPapers[1].short}.`);
        items.push(`Leave ${later} for tomorrow’s gap; a shallow pass tonight on top of ${first.short} helps neither.`);
      }
      items.push('Sleep. A fourth hour tonight costs more in recall tomorrow than it adds.');
      days.push({
        date: d, label: fmtDay(d), kind: 'eve',
        title: `${first.short} — final pass`,
        color: first.color,
        items,
      });
      continue;
    }

    days.push({ date: d, label: fmtDay(d), kind: 'study', items: [], color: null });
  }

  // Spread the module queue over the study days, front-loaded: earlier days get
  // more, because later days also carry revision of the earlier material.
  const studyDays = days.filter(x => x.kind === 'study');
  if (studyDays.length) {
    const per = Math.ceil(queue.length / studyDays.length);
    let k = 0;
    studyDays.forEach((day, di) => {
      const take = di < studyDays.length - 1 ? per : queue.length - k;
      const slice = queue.slice(k, k + Math.max(0, take));
      k += slice.length;
      day.items = slice.map(q => `${q.subject} · M${q.n} ${q.module}`);
      day.title = slice.length
        ? [...new Set(slice.map(s => s.subject))].join(' + ')
        : 'Free pass — self-test only';
      if (!slice.length) day.items = ['No new material. Run the “most likely questions” for whichever subject feels weakest.'];
    });
  }

  return {
    days,
    note: 'Built from the real timetable: 2 Sept Blockchain (4 PM), then 3 Sept is a double — Network Security (10 AM) and IoT (4 PM). The evening before each paper-day is reserved for its first paper, and the gap between the two papers on the 3rd is set aside for IoT.',
  };
}

/** What today looks like, for the Study tab header and the HQ card. */
export function todayPlan(today) {
  const p = revisionPlan(today);
  return p.days.find(d => d.date === today) || null;
}

// ---------------------------------------------------------------- reminders

/**
 * Rows for the HQ Reminders card. Same shape the tab already builds inline,
 * so it can concatenate without a translation layer.
 */
export function studyReminders(today, doneMap = {}) {
  const out = [];
  const fbl = fblStatus(today, doneMap);
  if (fbl.state === 'open') {
    out.push({
      icon: 'ES',
      text: `Spanish FBL ${fbl.current.label}`,
      chip: fbl.daysLeft === 0 ? 'today' : `${fbl.daysLeft}d left`,
      c: fbl.urgency === 'now' ? 'var(--red)' : fbl.urgency === 'soon' ? 'var(--yellow)' : 'var(--cyan)',
      go: 'study',
      // The one row on this card that is a task rather than a state — you can
      // sit down and finish a module. Nothing recorded that, so it nagged for
      // the whole window even once it was done.
      done: { kind: 'memory', key: fblDoneKey(fbl.current) },
    });
  } else if (fbl.state === 'ahead' && fbl.next) {
    // The module in the open window is finished, so the useful thing to show is
    // what replaces it. No distance test here, unlike 'between' below: this row
    // exists precisely BECAUSE the slot it occupied just went quiet, and leaving
    // the card blank would read as "nothing to do" rather than "you are ahead".
    // No `done` descriptor — a module that has not opened cannot be completed.
    out.push({
      icon: 'ES',
      text: `Spanish FBL ${fbl.next.label} opens`,
      chip: fmtDay(fbl.next.from),
      c: 'var(--green)',
      go: 'study',
    });
  } else if (fbl.state === 'between' && fbl.daysToNext != null && fbl.daysToNext <= 3) {
    out.push({ icon: 'ES', text: `Spanish FBL ${fbl.next.label} opens`, chip: fmtDay(fbl.next.from), c: 'var(--cyan)', go: 'study' });
  }

  const cd = examCountdown(today);
  if (cd.state === 'before' && cd.days <= 21) {
    out.push({
      icon: '!',
      text: 'Minor exams — Network Security, Blockchain, IoT',
      chip: cd.days === 1 ? 'tomorrow' : `${cd.days}d`,
      c: cd.days <= 3 ? 'var(--red)' : cd.days <= 7 ? 'var(--yellow)' : 'var(--purple)',
      go: 'study',
    });
  } else if (cd.state === 'during') {
    out.push({ icon: '!', text: 'Exams in progress', chip: cd.text, c: 'var(--red)', go: 'study' });
  }
  return out;
}

/** Where the downloadable/embeddable guide for a subject lives. */
export const guideUrl = slug => `/study/${slug}.html`;
