// Tasks with a time, a length, and somewhere to land on a calendar.
//
// The tab already had the TickTick shape — smart lists, folders, priorities,
// list and kanban and timeline. What it had no concept of was WHEN, so every
// task was a thing due some day, and a day is not a plan.
//
// SEVEN DECISIONS, each of which is a way a planner quietly lies to you
//
// 1. A DURATION IS NOT A TIME. "Two hours" and "two hours starting at nine" are
//    different facts, and only the second one belongs on a calendar. A task
//    with a length but no start is ESTIMATED, not SCHEDULED, and it is never
//    drawn at a time it does not have — defaulting it to midnight would put
//    your whole backlog at the top of the day and make it look like a schedule
//    you chose.
//
// 2. OVERLAPS ARE REPORTED, NOT STACKED. Two tasks at the same hour is a fact
//    about your day worth seeing before the day starts. A calendar that quietly
//    lays them side by side has turned a double-booking into a rendering
//    detail.
//
// 3. FINISHING A REPEAT NEVER EDITS THE ORIGINAL. Completing Monday's run
//    creates Tuesday's; it does not move Monday's forward. Rolling the same row
//    over would leave you with a habit you cannot prove you kept — the history
//    is the point of ticking it off.
//
// 4. AN ESTIMATE WITH NO ACTUAL IS NOT A ZERO. Estimates only get better if the
//    comparison is honest, so a task you never timed is excluded from the
//    accuracy figure rather than counted as having taken no time.
//
// 5. TIMES ARE WALL-CLOCK. Nine in the morning is nine in the morning; nothing
//    here converts to UTC and back. Every function that needs "now" takes it as
//    an argument, so a test in one timezone and a phone in another agree.
//
// 6. OVERDUE IS A COMPARISON, NOT A FLAG. It is computed against a date passed
//    in, never against a clock read inside. A stored `overdue` boolean is wrong
//    by definition the moment midnight passes.
//
// 7. A PARENT IS NOT DONE BECAUSE ITS SUBTASKS ARE. Ticking every subtask is
//    evidence, not a decision — some checklists are guidance and the task is
//    finished when you say so. Progress is reported and the parent is left
//    alone.

const num = v => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const int = v => { const n = num(v); return n == null ? null : Math.round(n); };
const z = n => String(n).padStart(2, '0');

export const PRIORITIES = [
  { key: 3, label: 'High', color: 'var(--red)' },
  { key: 2, label: 'Medium', color: 'var(--orange)' },
  { key: 1, label: 'Low', color: 'var(--cyan)' },
  { key: 0, label: 'None', color: 'var(--ink-3)' },
];
export const priorityOf = p => PRIORITIES.find(x => x.key === int(p)) || PRIORITIES[3];

// ------------------------------------------------------------------- time

/** 'HH:MM' -> minutes past midnight. Null for anything that is not a time. */
export function minutesOf(hhmm) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || '').trim());
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

/** Minutes past midnight -> 'HH:MM'. Past midnight wraps rather than throwing. */
export const hhmmOf = mins => {
  const n = int(mins);
  if (n == null) return null;
  const m = ((n % 1440) + 1440) % 1440;
  return `${z(Math.floor(m / 60))}:${z(m % 60)}`;
};

/** '09:05' -> '9:05 am'. Display only; nothing downstream parses this back. */
export function fmtTime(hhmm) {
  const mins = minutesOf(hhmm);
  if (mins == null) return '';
  const h = Math.floor(mins / 60), m = mins % 60;
  const ap = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${z(m)} ${ap}`;
}

/** '1h 30m' from 90. Null in, empty out — never '0m', which reads as instant. */
export function fmtDuration(mins) {
  const n = int(mins);
  if (n == null || n <= 0) return '';
  const h = Math.floor(n / 60), m = n % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export const todayISO = (d = new Date()) => `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
export const addDays = (iso, n) => {
  const [y, m, d] = String(iso).split('-').map(Number);
  const x = new Date(y, m - 1, d);
  x.setDate(x.getDate() + n);
  return todayISO(x);
};
export const dowOf = iso => {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, m - 1, d).getDay();      // 0 Sun … 6 Sat
};

// ------------------------------------------------------------------ tasks

export const REPEATS = [
  { key: 'daily', label: 'Every day' },
  { key: 'weekdays', label: 'Weekdays' },
  { key: 'weekly', label: 'Every week' },
  { key: 'monthly', label: 'Every month' },
];
export const isEveryN = r => /^every:(\d+)$/.test(String(r || ''));
export const everyN = r => (isEveryN(r) ? Number(/^every:(\d+)$/.exec(r)[1]) : null);
export const validRepeat = r => !r || REPEATS.some(x => x.key === r) || (isEveryN(r) && everyN(r) > 0);

export function normaliseTask(t = {}) {
  const subtasks = Array.isArray(t.subtasks) ? t.subtasks : [];
  return {
    id: t.id ?? null,
    title: String(t.title || '').slice(0, 200),
    notes: String(t.notes || ''),
    list: String(t.list || 'Inbox'),
    priority: [0, 1, 2, 3].includes(int(t.priority)) ? int(t.priority) : 0,
    // `completed` is the column; `done` is what three older call sites sent.
    completed: !!(t.completed ?? t.done),
    completed_at: t.completed_at || null,
    due_date: /^\d{4}-\d{2}-\d{2}$/.test(String(t.due_date || '')) ? String(t.due_date).slice(0, 10) : null,
    // Null and stays null. See decision 1.
    due_time: minutesOf(t.due_time) == null ? null : hhmmOf(minutesOf(t.due_time)),
    duration_min: int(t.duration_min) > 0 ? int(t.duration_min) : null,
    actual_min: int(t.actual_min) > 0 ? int(t.actual_min) : null,
    subtasks: subtasks
      .filter(s => s && String(s.title || '').trim())
      .map((s, i) => ({ id: s.id || `s${i}`, title: String(s.title).slice(0, 200), done: !!s.done })),
    repeat_rule: validRepeat(t.repeat_rule) ? (t.repeat_rule || null) : null,
    repeat_until: /^\d{4}-\d{2}-\d{2}$/.test(String(t.repeat_until || '')) ? String(t.repeat_until).slice(0, 10) : null,
    repeat_from: t.repeat_from || null,
    sort_order: int(t.sort_order),
  };
}

/** Scheduled means it has a date AND a time. A date alone is a deadline. */
export const isScheduled = t => !!(t?.due_date && t?.due_time);
/** Estimated means it has a length but nowhere to put it — decision 1. */
export const isEstimated = t => !!(t?.duration_min && !t?.due_time);

export const startMin = t => (t?.due_time ? minutesOf(t.due_time) : null);
export function endMin(t) {
  const s = startMin(t);
  if (s == null) return null;
  // A scheduled task with no length still occupies a moment. Thirty minutes is
  // this app's stated default for drawing it, and it is stated on screen rather
  // than silently assumed — a zero-height block cannot be seen or clicked.
  return s + (int(t.duration_min) || DEFAULT_BLOCK_MIN);
}
export const DEFAULT_BLOCK_MIN = 30;

export const isOverdue = (t, today) =>
  !!(t && !t.completed && t.due_date && today && t.due_date < today);

// -------------------------------------------------------------- subtasks

export function subtaskProgress(t) {
  const list = Array.isArray(t?.subtasks) ? t.subtasks : [];
  const total = list.length;
  const done = list.filter(s => s.done).length;
  return { done, total, pct: total ? (done / total) * 100 : null, all: total > 0 && done === total };
}

export const addSubtask = (t, title) => {
  const clean = String(title || '').trim();
  if (!clean) return t;
  const id = `s${Date.now()}${Math.round(Math.random() * 1e4)}`;
  return { ...t, subtasks: [...(t.subtasks || []), { id, title: clean.slice(0, 200), done: false }] };
};
export const toggleSubtask = (t, id) => ({
  ...t,
  subtasks: (t.subtasks || []).map(s => (s.id === id ? { ...s, done: !s.done } : s)),
});
export const removeSubtask = (t, id) => ({ ...t, subtasks: (t.subtasks || []).filter(s => s.id !== id) });

// --------------------------------------------------------------- repeats

/**
 * The next date a repeating task falls on, strictly after `fromISO`.
 *
 * Returns null past `repeat_until`, and null for a task that does not repeat —
 * so a caller cannot accidentally generate an endless series from a one-off.
 */
export function nextDue(t, fromISO) {
  const rule = t?.repeat_rule;
  if (!rule || !fromISO) return null;
  let next = null;
  if (rule === 'daily') next = addDays(fromISO, 1);
  else if (rule === 'weekly') next = addDays(fromISO, 7);
  else if (rule === 'weekdays') {
    next = addDays(fromISO, 1);
    while (dowOf(next) === 0 || dowOf(next) === 6) next = addDays(next, 1);
  } else if (rule === 'monthly') {
    const [y, m, d] = fromISO.split('-').map(Number);
    const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
    // The 31st of a 30-day month lands on the 30th rather than skipping into
    // the month after, which is what a naive Date roll does and is never what
    // "every month" meant.
    const last = new Date(ny, nm, 0).getDate();
    next = `${ny}-${z(nm)}-${z(Math.min(d, last))}`;
  } else if (isEveryN(rule)) next = addDays(fromISO, everyN(rule));
  if (!next) return null;
  if (t.repeat_until && next > t.repeat_until) return null;
  return next;
}

/**
 * Tick a task off.
 *
 * Returns the completed row AND, for a repeat, the next occurrence as a new
 * task. Decision 3: the original is never moved forward. Monday's run stays
 * completed on Monday and Tuesday's is a new row that points back at it.
 */
export function completeTask(t, { at = new Date(), actualMin = null } = {}) {
  const done = {
    ...t,
    completed: true,
    completed_at: at.toISOString(),
    actual_min: int(actualMin) > 0 ? int(actualMin) : (t.actual_min ?? null),
  };
  const nd = t.due_date ? nextDue(t, t.due_date) : null;
  if (!nd) return { updated: done, next: null };
  const { id, completed_at, actual_min, ...rest } = done;
  return {
    updated: done,
    next: normaliseTask({
      ...rest,
      completed: false,
      due_date: nd,
      actual_min: null,
      // Subtasks come back unticked — a checklist you completed on Monday is
      // not a checklist you have completed for Tuesday.
      subtasks: (t.subtasks || []).map(s => ({ ...s, done: false })),
      repeat_from: t.repeat_from || t.id || null,
    }),
  };
}

// ------------------------------------------------------------ smart views

export const SMART = [
  { key: 'today', label: 'Today' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'next7', label: 'Next 7 days' },
  { key: 'unscheduled', label: 'No date' },
  { key: 'all', label: 'All' },
  { key: 'done', label: 'Completed' },
];

export function smartView(tasks = [], key = 'today', { today = todayISO() } = {}) {
  const open = tasks.filter(t => !t.completed);
  if (key === 'done') return tasks.filter(t => t.completed);
  if (key === 'all') return open;
  if (key === 'overdue') return open.filter(t => isOverdue(t, today));
  if (key === 'unscheduled') return open.filter(t => !t.due_date);
  if (key === 'next7') {
    const end = addDays(today, 7);
    return open.filter(t => t.due_date && t.due_date >= today && t.due_date <= end);
  }
  // Today includes what is overdue, because a task that was due yesterday is a
  // thing you have to do today. Hiding it under its own tab is how it stays
  // undone — the tab exists to count them, not to store them.
  return open.filter(t => t.due_date && t.due_date <= today);
}

/** Timed first in clock order, then by priority, then by manual order. */
export function sortTasks(tasks = []) {
  return [...tasks].sort((a, b) => {
    const as = startMin(a), bs = startMin(b);
    if (as != null && bs != null && as !== bs) return as - bs;
    if (as != null && bs == null) return -1;
    if (as == null && bs != null) return 1;
    if ((b.priority || 0) !== (a.priority || 0)) return (b.priority || 0) - (a.priority || 0);
    const ao = a.sort_order ?? Infinity, bo = b.sort_order ?? Infinity;
    if (ao !== bo) return ao - bo;
    return String(a.title).localeCompare(String(b.title));
  });
}

// ---------------------------------------------------------- the calendar

export const overlaps = (a, b) => {
  const as = startMin(a), ae = endMin(a), bs = startMin(b), be = endMin(b);
  if (as == null || bs == null) return false;
  return as < be && bs < ae;
};

/**
 * One day, laid out.
 *
 * Every scheduled task becomes a block with a column index so overlapping ones
 * can be drawn side by side — and `clashes` names the pairs, because decision 2
 * says a double-booking is a fact about the day and not a rendering detail.
 *
 * Unscheduled tasks due that day come back separately, in `unscheduled`. They
 * are real work with a real deadline and no time, and dropping them because
 * they will not fit on a grid is how a calendar becomes reassuring.
 */
export function layoutDay(tasks = [], dateISO, { defaultMin = DEFAULT_BLOCK_MIN } = {}) {
  const forDay = tasks.filter(t => !t.completed && t.due_date === dateISO);
  const timed = sortTasks(forDay.filter(isScheduled));
  const rest = forDay.filter(t => !isScheduled(t));

  // Group into runs of mutually overlapping blocks; each run is laid out
  // independently so one clash at 9am does not narrow the whole day.
  const blocks = [];
  let group = [], groupEnd = -1;
  const flush = () => {
    group.forEach((t, i) => blocks.push({
      task: t,
      start: startMin(t),
      end: endMin(t),
      minutes: (int(t.duration_min) || defaultMin),
      column: i,
      columns: group.length,
    }));
    group = []; groupEnd = -1;
  };
  for (const t of timed) {
    if (group.length && startMin(t) >= groupEnd) flush();
    group.push(t);
    groupEnd = Math.max(groupEnd, endMin(t));
  }
  if (group.length) flush();

  const clashes = [];
  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length; j++) {
      if (overlaps(timed[i], timed[j])) clashes.push({ a: timed[i], b: timed[j] });
    }
  }

  const planned = blocks.reduce((s, b) => s + b.minutes, 0);
  const unplanned = rest.reduce((s, t) => s + (int(t.duration_min) || 0), 0);

  return {
    date: dateISO,
    blocks,
    unscheduled: sortTasks(rest),
    clashes,
    // Minutes with a time on them, minutes estimated but unplaced, and the two
    // kept apart — one is a commitment and the other is a wish.
    plannedMin: planned,
    unplacedMin: unplanned,
    firstStart: blocks.length ? Math.min(...blocks.map(b => b.start)) : null,
    lastEnd: blocks.length ? Math.max(...blocks.map(b => b.end)) : null,
  };
}

/** Move a task to a time. Pure — the caller decides whether to persist it. */
export function scheduleAt(t, { date, time, duration = null }) {
  const mins = minutesOf(time);
  return normaliseTask({
    ...t,
    due_date: date || t.due_date,
    due_time: mins == null ? null : hhmmOf(mins),
    duration_min: duration != null ? duration : t.duration_min,
  });
}

// ------------------------------------------------- estimated vs actual

/**
 * How good the estimates are.
 *
 * Only tasks with BOTH an estimate and a logged actual count — decision 4. A
 * task you never timed is not a task that took no time, and letting it in would
 * make you look faster the less you measured.
 */
export function estimateStats(tasks = []) {
  const pairs = tasks.filter(t => int(t.duration_min) > 0 && int(t.actual_min) > 0);
  if (!pairs.length) {
    return { n: 0, ratio: null, medianRatio: null, estimated: 0, actual: 0, note: 'Nothing has been both estimated and timed yet.' };
  }
  const estimated = pairs.reduce((s, t) => s + t.duration_min, 0);
  const actual = pairs.reduce((s, t) => s + t.actual_min, 0);
  const ratios = pairs.map(t => t.actual_min / t.duration_min).sort((a, b) => a - b);
  const mid = Math.floor(ratios.length / 2);
  return {
    n: pairs.length,
    estimated,
    actual,
    // Money-weighted equivalent: the ratio of the totals, so a long task counts
    // more than a five-minute one. The median is beside it because one runaway
    // afternoon otherwise sets the number.
    ratio: estimated ? actual / estimated : null,
    medianRatio: ratios.length % 2 ? ratios[mid] : (ratios[mid - 1] + ratios[mid]) / 2,
    note: null,
  };
}

/** Planned minutes for a day against a stated capacity, as a share. */
export function dayLoad(tasks = [], dateISO, { capacityMin = 480 } = {}) {
  const day = layoutDay(tasks, dateISO);
  const total = day.plannedMin + day.unplacedMin;
  return {
    plannedMin: day.plannedMin,
    unplacedMin: day.unplacedMin,
    totalMin: total,
    capacityMin,
    pct: capacityMin > 0 ? (total / capacityMin) * 100 : null,
    over: total > capacityMin,
    clashes: day.clashes.length,
  };
}
