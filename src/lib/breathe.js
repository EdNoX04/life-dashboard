// Guided breathing.
//
// WHY THIS IS A MODULE AND NOT JUST A COMPONENT
//
// The whole thing is one piece of arithmetic — "given a pattern and how many
// seconds have passed, what should I be doing right now and how far through it
// am I" — and that arithmetic drives a ring that has to be smooth, a countdown
// that has to be right, and a cue tone that must fire once per phase and not
// twice. Getting it slightly wrong produces an exercise that pulls you out of
// the state it is supposed to put you in, which is worse than not having it.
//
// So it lives here, pure and taking time as an argument, where it can be tested
// against exact boundaries instead of by breathing along with it.
//
// ON THE PATTERNS THEMSELVES
//
// These are the four that survive contact with evidence, and the notes on them
// say what they are actually for rather than making claims. Slow breathing with
// a longer exhale reliably shifts you toward the parasympathetic side — that
// much is well supported. The specific counts are convention, not medicine, and
// the honest framing is that the count exists to occupy the part of your mind
// that would otherwise be doing something else.

/** Ordered longest-established first; the UI shows them in this order. */
export const PATTERNS = [
  {
    id: 'box',
    label: 'Box',
    rhythm: '4·4·4·4',
    note: 'Equal in, hold, out, hold. Steady rather than sedating — the one for before something you are nervous about.',
    phases: [
      { kind: 'in', secs: 4 }, { kind: 'hold', secs: 4 },
      { kind: 'out', secs: 4 }, { kind: 'holdOut', secs: 4 },
    ],
  },
  {
    id: '478',
    label: '4-7-8',
    rhythm: '4·7·8',
    note: 'The long exhale is the whole point. Best lying down — the hold is genuinely hard sitting up.',
    phases: [{ kind: 'in', secs: 4 }, { kind: 'hold', secs: 7 }, { kind: 'out', secs: 8 }],
  },
  {
    id: 'calm',
    label: 'Long exhale',
    rhythm: '4·6',
    note: 'No holds at all. The easiest to do imperfectly and still get something from.',
    phases: [{ kind: 'in', secs: 4 }, { kind: 'out', secs: 6 }],
  },
  {
    id: 'coherent',
    label: 'Coherent',
    rhythm: '5.5·5.5',
    note: 'Five and a half seconds each way — near the pace where heart-rate variability peaks for most people.',
    phases: [{ kind: 'in', secs: 5.5 }, { kind: 'out', secs: 5.5 }],
  },
];

export const LABEL = {
  in: 'Breathe in',
  hold: 'Hold',
  out: 'Breathe out',
  holdOut: 'Hold',
};

/** Minutes offered in the UI. */
export const DURATIONS = [1, 2, 3, 5, 10];
export const DEFAULT_MINUTES = 2;

/**
 * Drop phases that would last no time.
 *
 * A zero-second phase is not a fast phase, it is a phase that can never be
 * displayed — but it still occupies an index, so the cue fires for it and the
 * label flashes through a state nobody sees. Removing it here means the rest of
 * this file can assume every phase has real duration.
 */
export function normalize(pattern) {
  if (!pattern || !Array.isArray(pattern.phases)) return null;
  const phases = pattern.phases
    .filter(p => p && Number(p.secs) > 0)
    .map(p => ({ kind: p.kind, secs: Number(p.secs) }));
  return phases.length ? { ...pattern, phases } : null;
}

export function patternById(id) {
  return normalize(PATTERNS.find(p => p.id === id)) || normalize(PATTERNS[0]);
}

export function cycleSeconds(pattern) {
  const p = normalize(pattern);
  return p ? p.phases.reduce((s, x) => s + x.secs, 0) : 0;
}

/** How many full cycles fit in a chosen number of minutes — never fewer than one. */
export function cyclesFor(pattern, minutes) {
  const cyc = cycleSeconds(pattern);
  if (!cyc) return 0;
  const mins = Math.max(0, Number(minutes) || 0);
  return Math.max(1, Math.round((mins * 60) / cyc));
}

/** The real length of a session, which is cycles × cycle — not the minutes asked for. */
export function plannedSeconds(pattern, minutes) {
  return cyclesFor(pattern, minutes) * cycleSeconds(pattern);
}

/**
 * What is happening at second `t`.
 *
 * Returns the phase, how far into it, how much is left, and which cycle this is.
 * `t` is clamped at zero — a negative elapsed time means a clock went backwards,
 * and starting the exercise from the beginning is a better answer than showing
 * a phase from before it began.
 */
export function phaseAt(pattern, t) {
  const p = normalize(pattern);
  const cyc = cycleSeconds(p);
  if (!p || !cyc) return null;

  const at = Math.max(0, Number(t) || 0);
  const cycle = Math.floor(at / cyc);
  let into = at - cycle * cyc;

  for (let i = 0; i < p.phases.length; i++) {
    const ph = p.phases[i];
    // `<` and not `<=`: at exactly the boundary you are at the START of the next
    // phase, not the end of the last one. That is what makes the cue fire on the
    // beat rather than a frame late, and it is why the last phase needs the
    // fallthrough below rather than an inclusive test here.
    if (into < ph.secs) {
      return {
        kind: ph.kind, index: i, secs: ph.secs,
        into, left: ph.secs - into,
        progress: ph.secs > 0 ? into / ph.secs : 1,
        cycle,
      };
    }
    into -= ph.secs;
  }

  // Only reachable through floating-point drift on the very last boundary.
  const last = p.phases.length - 1;
  const ph = p.phases[last];
  return { kind: ph.kind, index: last, secs: ph.secs, into: ph.secs, left: 0, progress: 1, cycle };
}

/**
 * Identity of a phase occurrence, so a caller can tell "still the same breath"
 * from "a new one started". This is what stops the cue tone firing on every
 * animation frame.
 */
export function phaseKey(ph) {
  return ph ? `${ph.cycle}:${ph.index}` : '';
}

/**
 * How large the ring should be, 0 to 1.
 *
 * Cosine-eased rather than linear. A linear ramp reads as mechanical and — more
 * importantly — it changes speed abruptly at each end, which is exactly where
 * you are meant to be turning around. Easing means the ring is slowest at the
 * top and bottom of the breath, so the shape itself tells you when to switch.
 */
export function scaleAt(kind, progress) {
  const p = Math.min(1, Math.max(0, Number(progress) || 0));
  const eased = (1 - Math.cos(Math.PI * p)) / 2;
  if (kind === 'in') return eased;
  if (kind === 'out') return 1 - eased;
  if (kind === 'hold') return 1;          // held full
  return 0;                                // holdOut — held empty
}

/** Countdown as a person reads it: 4, 3, 2, 1 — never 0, never 5. */
export function countdown(ph) {
  if (!ph) return 0;
  return Math.min(Math.ceil(ph.secs), Math.max(1, Math.ceil(ph.left)));
}

export function fmtClock(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * The label a finished session is recorded under.
 *
 * Includes the rhythm, so a year from now the history says which exercise it
 * was rather than just "breathing".
 */
export function sessionLabel(pattern) {
  const p = normalize(pattern);
  return p ? `Breathing · ${p.label} ${p.rhythm}` : 'Breathing';
}

// ---------------------------------------------------------------- the cues
//
// A note at the start of every phase, pitched so you can follow the exercise
// with your eyes shut: the inhale is the highest, the exhale the lowest, and a
// hold sits between them and quieter. That ordering is the whole instruction —
// once you have heard one cycle you do not need to look at the ring again.

export const CUE = {
  in:      { hz: 587.33, peak: 0.30, len: 0.30 },   // D5 — up
  hold:    { hz: 466.16, peak: 0.16, len: 0.22 },   // A#4 — quiet, in between
  out:     { hz: 392.00, peak: 0.30, len: 0.45 },   // G4 — down, and longer
  holdOut: { hz: 466.16, peak: 0.16, len: 0.22 },
};

/**
 * Every cue for a whole session, as offsets in seconds from its start.
 *
 * Built up front rather than fired as each phase arrives, because the cues are
 * scheduled on the audio clock (see alarm.scheduleTones) — which is what keeps
 * them on the beat after the screen has gone off and the page's own timers have
 * been throttled to a crawl.
 */
export function cueSchedule(pattern, minutes) {
  const p = normalize(pattern);
  if (!p) return [];
  const cycles = cyclesFor(p, minutes);
  const out = [];
  let at = 0;
  for (let c = 0; c < cycles; c++) {
    for (const ph of p.phases) {
      const cue = CUE[ph.kind];
      if (cue) out.push({ hz: cue.hz, peak: cue.peak, len: Math.min(cue.len, ph.secs), at });
      at += ph.secs;
    }
  }
  return out;
}

/** The mode these rows carry. Deliberately NOT 'focus' — see below. */
export const MODE = 'breathe';

/**
 * Breathing sessions today and this week.
 *
 * They share the `focus_sessions` table but not the focus totals: `focus.js`
 * counts only `mode === 'focus'`, so two minutes of breathing can never inflate
 * "you studied for six hours". Winding down is worth recording and is not study
 * time, and a history that blurs the two is worth less than one that keeps them
 * apart.
 */
export function stats(rows, now = new Date()) {
  if (!Array.isArray(rows)) return { today: 0, week: 0, minutes: 0 };
  const day = d => {
    const t = new Date(d);
    return Number.isNaN(t.getTime())
      ? ''
      // Local calendar, not toISOString: in IST that reports tomorrow after 18:30.
      : `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  };
  const todayKey = day(now);
  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() - 6);
  weekStart.setHours(0, 0, 0, 0);

  let today = 0, week = 0, minutes = 0;
  for (const r of rows) {
    if (r?.mode !== MODE) continue;
    const t = new Date(r.ended_at).getTime();
    if (Number.isNaN(t)) continue;
    if (day(r.ended_at) === todayKey) today++;
    if (t >= weekStart.getTime()) { week++; minutes += Math.max(0, Number(r.minutes) || 0); }
  }
  return { today, week, minutes };
}
