// Symptom episodes: how long, how bad, what was taken, and what else was going on.
//
// The Body tab already records an episode with a start and an end. Three things
// it could not do, and Neel asked for all three: track how bad it was day by
// day, show which medicines fall inside the window, and line the episode up
// against sleep, steps and heart rate.
//
// THE THIRD ONE IS WHY MOST OF THIS FILE IS RESTRAINT.
//
// One person, a handful of episodes, and a dozen metrics is a machine for
// producing coincidences that look like findings. "You slept 5.8h on fever days
// and 7.1h otherwise" is a sentence anyone would read as a cause, from a sample
// that cannot support the word — and a body that is fighting something sleeps
// badly, so the arrow probably points the other way anyway.
//
// So the guard is in the CODE, not in a disclaimer underneath the number:
//
//   * Below ENOUGH, nothing is compared at all. `compare()` returns
//     `{ enough: false, why }` and the UI has no number to render, rather than
//     a number with a warning next to it that nobody reads.
//   * Above it, the verdict word is "differed". Never "caused", never "because",
//     never "linked to". A test walks the output for those words.
//   * `n` rides along with every figure, always, so a difference built on three
//     days cannot be quoted without its three days.
//
// None of this is diagnosis. It is a diary with arithmetic on it.

const str = v => String(v ?? '').trim();
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const pad = n => String(n).padStart(2, '0');
const validDate = d => /^\d{4}-\d{2}-\d{2}$/.test(str(d)) && !Number.isNaN(Date.parse(str(d)));

export const SEVERITY_MAX = 10;
export const SEVERITY_WORDS = [
  [0, 'gone'], [1, 'barely there'], [3, 'mild'], [5, 'noticeable'],
  [7, 'bad'], [9, 'severe'],
];
export const severityWord = v => {
  const n = num(v);
  if (n == null) return '';
  return [...SEVERITY_WORDS].reverse().find(([t]) => n >= t)?.[1] || '';
};

export function normaliseEpisode(e = {}) {
  const sev = {};
  for (const [k, v] of Object.entries(e?.severity || {})) {
    const n = num(v);
    if (validDate(k) && n != null) sev[k] = Math.max(0, Math.min(SEVERITY_MAX, Math.round(n)));
  }
  return {
    id: str(e.id) || `e${Date.now()}`,
    name: str(e.name).slice(0, 140),
    from: validDate(e.from) ? str(e.from) : null,
    // An open episode is ONGOING, not one that ended today. The difference is
    // the whole point of the field, and defaulting it to today would quietly
    // close every episode the moment it was written.
    to: validDate(e.to) ? str(e.to) : null,
    note: str(e.note).slice(0, 600),
    severity: sev,
  };
}

export const isOngoing = (ep, today) => !!ep?.from && (!ep.to || ep.to >= today);

/** Inclusive day count, or null when the start is unknown. */
export function spanDays(ep, today) {
  if (!ep?.from) return null;
  const end = ep.to && ep.to <= today ? ep.to : today;
  if (end < ep.from) return null;
  return Math.round((Date.parse(`${end}T00:00:00`) - Date.parse(`${ep.from}T00:00:00`)) / 86400000) + 1;
}

export function datesOf(ep, today) {
  const n = spanDays(ep, today);
  if (!n) return [];
  const out = [];
  const d = new Date(`${ep.from}T00:00:00`);
  for (let i = 0; i < n; i++) {
    out.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
    d.setDate(d.getDate() + 1);
  }
  return out;
}

/**
 * Severity across the episode, one entry per day.
 *
 * A day with no score is `null`, NOT zero. Zero means "it was gone that day",
 * which is a real and different thing from not having written it down — and a
 * chart that draws them the same shows a recovery that never happened.
 */
export function severitySeries(ep, today) {
  return datesOf(ep, today).map(date => ({ date, value: ep?.severity?.[date] ?? null }));
}

export const MIN_TREND_POINTS = 3;

/**
 * Getting better, worse, or neither.
 *
 * Needs three scored days, and a whole point of movement between the first half
 * and the second, before it will say anything. Two points is a line through any
 * two numbers, and half a point on a ten-point scale someone typed in while ill
 * is noise.
 */
export function trend(ep, today) {
  const pts = severitySeries(ep, today).filter(p => p.value != null);
  if (pts.length < MIN_TREND_POINTS) return { known: false, why: `${pts.length} scored day(s) — at least ${MIN_TREND_POINTS} before a direction means anything` };
  const half = Math.floor(pts.length / 2);
  const first = pts.slice(0, half);
  const last = pts.slice(pts.length - half);
  const avg = a => a.reduce((t, p) => t + p.value, 0) / a.length;
  const d = avg(last) - avg(first);
  if (Math.abs(d) < 1) return { known: true, dir: 'flat', delta: d, points: pts.length };
  return { known: true, dir: d < 0 ? 'better' : 'worse', delta: d, points: pts.length };
}

/**
 * Which medicines were logged inside the window.
 *
 * Descriptive and nothing more: these are the things taken while this was going
 * on. The file does not claim any of them did anything, and the wording it
 * hands the UI does not either.
 */
export function medsDuring(ep, medLog, today) {
  const days = new Set(datesOf(ep, today));
  const by = new Map();
  for (const [date, rows] of Object.entries(medLog || {})) {
    if (!days.has(date) || !Array.isArray(rows)) continue;
    for (const r of rows) {
      const name = str(r?.name);
      if (!name) continue;
      const e = by.get(name) || { name, dates: [], count: 0 };
      if (!e.dates.includes(date)) e.dates.push(date);
      e.count++;
      by.set(name, e);
    }
  }
  return [...by.values()]
    .map(m => ({ ...m, dates: m.dates.sort(), days: m.dates.length }))
    .sort((a, b) => b.count - a.count);
}

// ------------------------------------------------------------- the comparison
//
// The thresholds below are the honest part of this feature. They are deliberately
// higher than "some data exists".

export const ENOUGH = {
  insideDays: 3,     // fewer, and one bad night IS the average
  outsideDays: 14,   // a baseline shorter than a fortnight is a mood, not a baseline
};

const mean = a => (a.length ? a.reduce((t, v) => t + v, 0) / a.length : null);

/**
 * One metric inside the episode against the same metric outside it.
 *
 * Returns `{ enough: false, why }` rather than a number when there is not
 * enough of either side. That is not a formatting choice — a figure on screen
 * gets quoted, remembered and acted on regardless of the caveat printed under
 * it, so the only safe thing to do with an unsupportable comparison is to not
 * produce one.
 */
export function compare(ep, rows, metric, today) {
  const days = new Set(datesOf(ep, today));
  const inside = [], outside = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    if (str(r?.metric) !== metric) continue;
    const v = num(r?.value);
    const d = str(r?.date);
    if (v == null || !validDate(d)) continue;
    (days.has(d) ? inside : outside).push(v);
  }
  if (inside.length < ENOUGH.insideDays) {
    return { enough: false, metric, why: `${inside.length} day(s) of ${metric} inside this episode — at least ${ENOUGH.insideDays} before a comparison says anything` };
  }
  if (outside.length < ENOUGH.outsideDays) {
    return { enough: false, metric, why: `${outside.length} day(s) of ${metric} outside it — a baseline needs at least ${ENOUGH.outsideDays}` };
  }
  const a = mean(inside), b = mean(outside);
  return {
    enough: true, metric,
    inside: a, outside: b, delta: a - b,
    pct: b ? ((a - b) / b) * 100 : null,
    n: { inside: inside.length, outside: outside.length },
    // The word, chosen once, here, so no caller has to choose it under pressure.
    // "Differed" is all the data can support: this is one person, and something
    // that makes you ill also makes you sleep badly, so the arrow does not point
    // anywhere on its own.
    verdict: `${metric} differed during this episode`,
  };
}

/** Every metric worth lining up against an episode, compared where possible. */
export const COMPARABLE = ['sleep_hours', 'steps', 'resting_hr', 'active_energy'];

export function compareAll(ep, rows, today, metrics = COMPARABLE) {
  const done = metrics.map(m => compare(ep, rows, m, today));
  return {
    shown: done.filter(d => d.enough),
    // The ones that could not be compared are RETURNED, not dropped. A panel
    // that silently shows only what passed looks like the whole picture.
    withheld: done.filter(d => !d.enough),
  };
}

/**
 * Whether this person has enough episode history for any cross-episode reading.
 *
 * Kept separate and named, because the temptation later will be to add "your
 * fevers usually last 4 days" off the back of two fevers.
 */
export const MIN_EPISODES = 4;
export function enoughHistory(episodes, name) {
  const n = (Array.isArray(episodes) ? episodes : [])
    .filter(e => !name || str(e?.name).toLowerCase() === str(name).toLowerCase()).length;
  return n >= MIN_EPISODES
    ? { enough: true, n }
    : { enough: false, n, why: `${n} recorded episode(s) — ${MIN_EPISODES} before anything about "usually" is worth saying` };
}

/** A plain-language line for one episode. Length, severity, and nothing implied. */
export function describe(ep, today) {
  const e = normaliseEpisode(ep || {});
  const days = spanDays(e, today);
  if (!days) return `${e.name || 'Episode'} — no start date recorded`;
  const t = trend(e, today);
  const peak = Math.max(-1, ...Object.values(e.severity));
  const bits = [`${days} day${days === 1 ? '' : 's'}`];
  if (isOngoing(e, today)) bits.push('ongoing');
  if (peak >= 0) bits.push(`worst ${peak}/10 (${severityWord(peak)})`);
  if (t.known && t.dir !== 'flat') bits.push(`getting ${t.dir}`);
  return `${e.name || 'Episode'} — ${bits.join(' · ')}`;
}
