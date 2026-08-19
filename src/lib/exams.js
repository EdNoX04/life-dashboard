// Exams, the revision plan, and the Spanish FBL module deadlines.
//
// Everything here is pure: dates in, plain objects out, no clock read except
// through an argument. That is deliberate — a countdown that silently uses
// `new Date()` inside the function is a countdown you cannot test, and this
// one has to be right on the morning of the first paper.
//
// One honest limitation, stated in the data rather than hidden: the university
// gave three dates (1, 2, 3 September) but not which subject sits on which day.
// So `SUBJECTS[].date` starts null and the user assigns it. Until they do, the
// planner treats the three days as one block and says so, rather than inventing
// an order and building a schedule on top of a guess.

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
export function fblStatus(today) {
  const t = parse(today);
  if (!t) return { state: 'unknown' };
  const open = FBL_MODULES.find(m => today >= m.from && today <= m.to);
  const next = FBL_MODULES.find(m => m.from > today);

  if (!open) {
    if (next) {
      return {
        state: 'between', current: null, next,
        daysToNext: daysBetween(today, next.from),
        urgency: 'later',
        text: `${next.label} opens ${fmtDay(next.from)}`,
      };
    }
    return { state: 'done', current: null, next: null, urgency: 'later', text: 'all FBL modules have closed' };
  }

  const left = daysBetween(today, open.to);
  return {
    state: 'open',
    current: open,
    next: next || null,
    daysLeft: left,
    urgency: left <= 2 ? 'now' : left <= 5 ? 'soon' : 'later',
    text: left === 0
      ? `${open.label} closes TODAY`
      : `${open.label} closes ${fmtDay(open.to)} — ${left} day${left === 1 ? '' : 's'} left`,
  };
}

// ---------------------------------------------------------------- planner

/** Subject → its assigned exam date, from saved config. Unassigned stays null. */
export function withDates(assignment = {}) {
  return SUBJECTS.map(s => ({ ...s, date: EXAM_DATES.includes(assignment[s.slug]) ? assignment[s.slug] : null }));
}

export const allAssigned = (assignment = {}) =>
  SUBJECTS.every(s => EXAM_DATES.includes(assignment[s.slug])) &&
  new Set(SUBJECTS.map(s => assignment[s.slug])).size === SUBJECTS.length;

/**
 * A day-by-day plan from `today` to the last paper.
 *
 * Two rules, and they are the whole design:
 *  1. The evening before a paper belongs to that paper. Nothing else is
 *     scheduled then — cramming a different subject the night before is how
 *     people walk into the wrong exam half-prepared.
 *  2. Everything else is a round-robin across subjects rather than three days
 *     of one subject then three of the next. Interleaving is worse for how
 *     fluent the material feels and better for what you can actually retrieve
 *     under pressure, which is the thing being marked.
 *
 * If the subject/date assignment is unknown, rule 1 cannot be applied, so the
 * plan reserves the last two days as "all three, final pass" and says so.
 */
export function revisionPlan(today, assignment = {}) {
  const start = parse(today);
  const last = parse(EXAM_WINDOW.to);
  if (!start || !last || start > last) return { days: [], note: 'The exam block has passed.' };

  const subjects = withDates(assignment);
  const assigned = allAssigned(assignment);
  const byDate = {};
  subjects.forEach(s => { if (s.date) byDate[s.date] = s; });

  // Every (subject, module) pair, interleaved so consecutive slots differ.
  const queue = [];
  const maxLen = Math.max(...subjects.map(s => s.modules.length));
  for (let i = 0; i < maxLen; i++) {
    subjects.forEach(s => {
      if (s.modules[i]) queue.push({ slug: s.slug, subject: s.short, color: s.color, module: s.modules[i], n: i + 1 });
    });
  }

  // Which days are study days, and which are reserved.
  const days = [];
  for (let d = iso(start); d && d <= EXAM_WINDOW.to; d = addDays(d, 1)) {
    const examToday = byDate[d];
    const isExamDay = EXAM_DATES.includes(d);
    const tomorrow = addDays(d, 1);
    const examTomorrow = byDate[tomorrow];

    if (isExamDay) {
      days.push({
        date: d, label: fmtDay(d), kind: 'exam',
        title: examToday ? `${examToday.short} paper` : 'Paper (subject not set)',
        color: examToday?.color || 'var(--yellow)',
        items: examToday
          ? [`Morning: skim the EXAM TRAP and REMEMBER IT boxes for ${examToday.short} only.`]
          : ['Set which paper is on which day in the Study tab and this will be specific.'],
      });
      continue;
    }
    if (examTomorrow) {
      days.push({
        date: d, label: fmtDay(d), kind: 'eve',
        title: `${examTomorrow.short} — final pass`,
        color: examTomorrow.color,
        items: [
          `Whole ${examTomorrow.short} guide, skimming: read only the bold lead-ins.`,
          'Then the "Most likely questions" section end to end, answering out loud before revealing.',
          'Sleep. A fourth hour tonight costs more in recall tomorrow than it adds.',
        ],
      });
      continue;
    }
    days.push({ date: d, label: fmtDay(d), kind: 'study', items: [], color: null });
  }

  // Spread the queue over the study days, front-loaded: earlier days get more,
  // because later days will also be carrying revision of the earlier ones.
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
        ? `${[...new Set(slice.map(s => s.subject))].join(' + ')}`
        : 'Free pass — self-test only';
      if (!slice.length) day.items = ['No new material. Run the "Most likely questions" for whichever subject feels weakest.'];
    });
  }

  // The last two study days, when no assignment exists, become a general final pass.
  if (!assigned) {
    days.slice(-3).forEach(day => {
      if (day.kind === 'study') {
        day.title = 'All three — final pass';
        day.items = ['Subject order is not set yet, so revise all three. Set the order in the Study tab to get a night-before plan.'];
      }
    });
  }

  return {
    days,
    assigned,
    note: assigned
      ? 'The evening before each paper is reserved for that paper. Everything before it interleaves the three subjects on purpose — it feels harder and it recalls better.'
      : 'Set which paper falls on which date and the plan will reserve each evening for the right subject.',
  };
}

/** What today looks like, for the Study tab header and the HQ card. */
export function todayPlan(today, assignment = {}) {
  const p = revisionPlan(today, assignment);
  return p.days.find(d => d.date === today) || null;
}

// ---------------------------------------------------------------- reminders

/**
 * Rows for the HQ Reminders card. Same shape the tab already builds inline,
 * so it can concatenate without a translation layer.
 */
export function studyReminders(today) {
  const out = [];
  const fbl = fblStatus(today);
  if (fbl.state === 'open') {
    out.push({
      icon: 'ES',
      text: `Spanish FBL ${fbl.current.label}`,
      chip: fbl.daysLeft === 0 ? 'today' : `${fbl.daysLeft}d left`,
      c: fbl.urgency === 'now' ? 'var(--red)' : fbl.urgency === 'soon' ? 'var(--yellow)' : 'var(--cyan)',
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
