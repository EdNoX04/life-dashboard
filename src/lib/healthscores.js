// The reading half of the PlayerOneSync contract.
//
// The iOS app (PlayerOneSync) reads ~59 Apple Health metrics on the phone,
// computes a set of derived scores there, and writes both into `health_metrics`
// as ordinary rows — `{ date, metric, value, unit, source: 'healthkit' }`. So
// from this side a score is not special: `recovery_score` arrives through the
// same pipe as `steps`. What the dashboard has to add is meaning. A bare 63 is
// not a reading; 63 with the band it falls in, the direction it moved, and a
// sentence saying what the number is actually measuring is.
//
// Everything here is pure and takes its inputs as arguments, so the bands can
// be tested against fixtures without a database or a render. That matters more
// than usual here: a band boundary that is off by five silently mislabels every
// day in that range, and nothing about the rendered page would look wrong.
//
// NOT MEDICAL. These are estimates derived from consumer wrist sensors, and the
// app that produces them says so itself. Bands are descriptive labels for your
// own trend, not diagnoses, thresholds for action, or a substitute for anyone
// qualified. Nothing here should be read as clinical advice.

// Strict numeric coercion. `Number(null)` is 0 and `Number('')` is 0, which is
// the single most dangerous coercion in this file: it turns "the phone did not
// sync" into a real reading of zero, and zero is a legitimate value for most of
// these. A missing recovery score read as DRAINED, a missing cardio-load ratio
// read as DETRAINING, and a missing biological age read as MUCH YOUNGER —
// each of them a confident, coloured, completely fabricated statement about a
// day with no data behind it. Absence has to survive as absence all the way to
// the caller, which is what every `=== null` return below depends on.
const num = v => {
  if (v === null || v === undefined) return NaN;
  if (typeof v === 'string' && v.trim() === '') return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};

// ---------------------------------------------------------------------------
// Scores the phone computes. `key` matches MetricCatalog.scoreKeys in the app.
// ---------------------------------------------------------------------------

/**
 * Bands are listed high-to-low and read with `>=`, so the first match wins and
 * the last entry must be open-ended at the bottom. Keeping them as data rather
 * than an if-chain is what lets a test walk every boundary automatically.
 */
export const SCORES = [
  {
    key: 'recovery_score',
    label: 'RECOVERY',
    short: 'Recovery',
    unit: '%',
    max: 100,
    color: 'var(--green)',
    // Settled from overnight HRV, resting HR, respiratory rate, SpO2 and wrist
    // temperature against your own rolling baseline — so it is a comparison
    // with your normal, not with anyone else's.
    blurb: 'How ready your body looks this morning versus your own baseline.',
    bands: [
      [85, 'PRIME', 'var(--green)'],
      [70, 'READY', 'var(--cyan)'],
      [50, 'MODERATE', 'var(--yellow)'],
      [34, 'LOW', 'var(--orange)'],
      [0, 'DRAINED', 'var(--red)'],
    ],
  },
  {
    key: 'strain',
    label: 'STRAIN',
    short: 'Strain',
    unit: '',
    max: 100,
    color: 'var(--orange)',
    blurb: 'Cardiovascular load accumulated today, from time spent in each heart-rate zone.',
    bands: [
      [80, 'ALL OUT', 'var(--red)'],
      [60, 'HARD', 'var(--orange)'],
      [35, 'MODERATE', 'var(--yellow)'],
      [15, 'LIGHT', 'var(--cyan)'],
      [0, 'REST', 'var(--ink-3)'],
    ],
  },
  {
    key: 'sleep_score',
    label: 'SLEEP',
    short: 'Sleep',
    unit: '%',
    max: 100,
    color: 'var(--purple)',
    blurb: 'Duration, deep and REM share, overnight heart-rate dip, efficiency and continuity.',
    bands: [
      [85, 'EXCELLENT', 'var(--green)'],
      [70, 'GOOD', 'var(--cyan)'],
      [55, 'FAIR', 'var(--yellow)'],
      [40, 'POOR', 'var(--orange)'],
      [0, 'VERY POOR', 'var(--red)'],
    ],
  },
  {
    key: 'stress_avg',
    label: 'STRESS',
    short: 'Stress',
    unit: '',
    max: 100,
    color: 'var(--red)',
    // Higher is worse here, which is why this one carries `invert` — the arc
    // fills the same way but the good end of the scale is the low end.
    invert: true,
    blurb: 'Heart rate above your resting baseline, scaled by HRV, with movement and workouts excluded.',
    bands: [
      [70, 'HIGH', 'var(--red)'],
      [50, 'ELEVATED', 'var(--orange)'],
      [30, 'MODERATE', 'var(--yellow)'],
      [15, 'CALM', 'var(--cyan)'],
      [0, 'VERY CALM', 'var(--green)'],
    ],
  },
  {
    key: 'body_energy',
    label: 'ENERGY',
    short: 'Body energy',
    unit: '%',
    max: 100,
    color: 'var(--yellow)',
    blurb: 'What is left in the tank right now — starts from recovery and drains with strain and stress.',
    bands: [
      [75, 'FULL', 'var(--green)'],
      [50, 'GOOD', 'var(--cyan)'],
      [30, 'LOW', 'var(--yellow)'],
      [15, 'RUNNING OUT', 'var(--orange)'],
      [0, 'EMPTY', 'var(--red)'],
    ],
  },
];

export const SCORE_BY_KEY = new Map(SCORES.map(s => [s.key, s]));

/**
 * The band a score falls in. Returns null for a null/non-finite value rather
 * than a "no data" band, so callers must decide how absence is drawn — a score
 * that silently rendered as its worst band on a day the phone did not sync
 * would be worse than an obvious gap.
 */
export function bandFor(key, value) {
  const spec = SCORE_BY_KEY.get(key);
  if (!spec) return null;
  const n = num(value);
  if (!Number.isFinite(n)) return null;
  for (const [floor, label, color] of spec.bands) {
    if (n >= floor) return { label, color, floor };
  }
  // Unreachable while the last band floors at 0 and values are non-negative,
  // but a negative reading should degrade to the bottom band rather than null.
  const last = spec.bands[spec.bands.length - 1];
  return { label: last[1], color: last[2], floor: last[0] };
}

// ---------------------------------------------------------------------------
// Cardio load. The app writes acute (7-day) and chronic (28-day) load plus
// their ratio. The ratio is the interesting number and it is the one that is
// easiest to misread, because both extremes are unwanted: far above 1 means
// you have ramped up faster than you have adapted, and far below 1 means the
// base you built is decaying. A single "higher is better" bar would say the
// opposite of the truth at one end.
// ---------------------------------------------------------------------------

export const LOAD_BANDS = [
  { min: 1.5, label: 'SPIKE', color: 'var(--red)', note: 'Ramped up much faster than the last four weeks.' },
  { min: 1.3, label: 'PUSHING', color: 'var(--orange)', note: 'Above the range your recent base supports.' },
  { min: 0.8, label: 'OPTIMAL', color: 'var(--green)', note: 'This week matches what the last four weeks built.' },
  { min: 0.5, label: 'EASING', color: 'var(--cyan)', note: 'Lighter than usual — fine as a taper.' },
  { min: -Infinity, label: 'DETRAINING', color: 'var(--yellow)', note: 'Well under your base; fitness drifts down here.' },
];

export function loadBand(ratio) {
  const n = num(ratio);
  if (!Number.isFinite(n)) return null;
  return LOAD_BANDS.find(b => n >= b.min) || LOAD_BANDS[LOAD_BANDS.length - 1];
}

// ---------------------------------------------------------------------------
// Sleep bank and sleep need.
// ---------------------------------------------------------------------------

/**
 * The bank is a signed hour count: negative is debt, positive is surplus. The
 * sign carries the whole meaning, so it is stated in words rather than left to
 * a minus sign the eye skips.
 */
export function sleepBank(hours) {
  const n = num(hours);
  if (!Number.isFinite(n)) return null;
  const mag = Math.abs(n);
  const txt = `${mag.toFixed(1)}h`;
  if (n <= -4) return { label: 'DEEP DEBT', color: 'var(--red)', text: `${txt} down`, sign: -1 };
  if (n <= -1.5) return { label: 'IN DEBT', color: 'var(--orange)', text: `${txt} down`, sign: -1 };
  if (n < 1.5) return { label: 'LEVEL', color: 'var(--cyan)', text: mag < 0.1 ? 'even' : `${txt} ${n < 0 ? 'down' : 'up'}`, sign: 0 };
  return { label: 'SURPLUS', color: 'var(--green)', text: `${txt} up`, sign: 1 };
}

/** Hours slept against hours needed, as a percentage, clamped for display. */
export function sleepDebtPct(slept, needed) {
  const s = num(slept), n = num(needed);
  if (!Number.isFinite(s) || !Number.isFinite(n) || n <= 0) return null;
  return Math.max(0, Math.min(150, Math.round((s / n) * 100)));
}

// ---------------------------------------------------------------------------
// Biological age. The app computes a fitness age from VO2 max, resting HRV,
// resting HR and body fat, capped at +/-15 years of actual age.
// ---------------------------------------------------------------------------

export function bioAgeDelta(bioAge, actualAge) {
  const b = num(bioAge), a = num(actualAge);
  if (!Number.isFinite(b) || !Number.isFinite(a)) return null;
  const d = b - a;
  // A year either way is inside the noise of the inputs, so it is reported as
  // "on par" rather than as a win or a loss you could chase week to week.
  if (d <= -5) return { delta: d, label: 'MUCH YOUNGER', color: 'var(--green)' };
  if (d <= -1) return { delta: d, label: 'YOUNGER', color: 'var(--cyan)' };
  if (d < 1) return { delta: d, label: 'ON PAR', color: 'var(--ink-2)' };
  if (d < 5) return { delta: d, label: 'OLDER', color: 'var(--orange)' };
  return { delta: d, label: 'MUCH OLDER', color: 'var(--red)' };
}

// ---------------------------------------------------------------------------
// The raw metric tiles, grouped.
//
// There are close to fifty of these once the phone has been syncing for a
// while, and as one flat row they were unreadable — weight sat between flights
// climbed and water. The grouping mirrors MetricCatalog.swift's own sections so
// that adding a metric on the phone has an obvious home here.
//
// Tuple shape: [key, label, unitSuffix, cssColorVar, sparkHex]
// ---------------------------------------------------------------------------

export const METRIC_GROUPS = [
  {
    id: 'heart',
    label: 'HEART',
    color: 'var(--pink)',
    metrics: [
      ['resting_hr', 'Resting HR', ' bpm', 'var(--pink)', '#e84191'],
      ['hrv', 'HRV', ' ms', 'var(--cyan)', '#1f9ecf'],
      ['heart_rate', 'Heart rate', ' bpm', 'var(--red)', '#e84191'],
      ['heart_rate_min', 'HR min', ' bpm', 'var(--cyan)', '#1f9ecf'],
      ['heart_rate_max', 'HR max', ' bpm', 'var(--red)', '#e84191'],
      ['walking_hr', 'Walking HR', ' bpm', 'var(--pink)', '#e84191'],
      ['hr_recovery', 'HR recovery', ' bpm', 'var(--green)', '#2fa848'],
      ['spo2', 'SpO₂', '%', 'var(--cyan)', '#1f9ecf'],
      ['resp_rate', 'Respiration', ' br/min', 'var(--purple)', '#9a63e8'],
      ['bp_systolic', 'BP systolic', ' mmHg', 'var(--red)', '#e84191'],
      ['bp_diastolic', 'BP diastolic', ' mmHg', 'var(--red)', '#e84191'],
      ['atrial_fib', 'AFib burden', '%', 'var(--red)', '#e84191'],
    ],
  },
  {
    id: 'sleep',
    label: 'SLEEP',
    color: 'var(--purple)',
    metrics: [
      ['sleep_hours', 'Asleep', ' h', 'var(--purple)', '#9a63e8'],
      ['sleep_deep', 'Deep', ' h', 'var(--purple)', '#9a63e8'],
      ['sleep_rem', 'REM', ' h', 'var(--cyan)', '#1f9ecf'],
      ['sleep_core', 'Core', ' h', 'var(--purple)', '#9a63e8'],
      ['sleep_awake', 'Awake', ' h', 'var(--orange)', '#d96a1f'],
      ['sleep_in_bed', 'In bed', ' h', 'var(--ink-2)', '#9a63e8'],
      ['sleep_needed', 'Needed', ' h', 'var(--yellow)', '#b3860a'],
      ['sleep_bank', 'Sleep bank', ' h', 'var(--green)', '#2fa848'],
      ['wrist_temp', 'Wrist temp', '°C', 'var(--orange)', '#d96a1f'],
    ],
  },
  {
    id: 'move',
    label: 'MOVEMENT',
    color: 'var(--green)',
    metrics: [
      ['steps', 'Steps', '', 'var(--green)', '#2fa848'],
      ['distance_km', 'Distance', ' km', 'var(--green)', '#2fa848'],
      ['cycling_km', 'Cycling', ' km', 'var(--green)', '#2fa848'],
      ['swim_km', 'Swimming', ' km', 'var(--cyan)', '#1f9ecf'],
      ['flights', 'Flights', '', 'var(--yellow)', '#b3860a'],
      ['exercise_min', 'Exercise', ' min', 'var(--yellow)', '#b3860a'],
      ['stand_hours', 'Stand', ' h', 'var(--cyan)', '#1f9ecf'],
      ['active_energy', 'Active kcal', '', 'var(--orange)', '#d96a1f'],
      ['basal_energy', 'Resting kcal', '', 'var(--orange)', '#d96a1f'],
      ['mindful_min', 'Mindful', ' min', 'var(--purple)', '#9a63e8'],
    ],
  },
  {
    id: 'body',
    label: 'BODY',
    color: 'var(--pink)',
    metrics: [
      ['weight', 'Weight', ' kg', 'var(--pink)', '#e84191'],
      ['body_fat', 'Body fat', '%', 'var(--pink)', '#e84191'],
      ['lean_mass', 'Lean mass', ' kg', 'var(--cyan)', '#1f9ecf'],
      ['bmi', 'BMI', '', 'var(--purple)', '#9a63e8'],
      ['waist', 'Waist', ' cm', 'var(--orange)', '#d96a1f'],
      ['height', 'Height', ' cm', 'var(--ink-2)', '#9a63e8'],
      ['vo2max', 'VO₂ max', '', 'var(--orange)', '#d96a1f'],
      ['biological_age', 'Fitness age', ' yr', 'var(--yellow)', '#b3860a'],
      ['body_temp', 'Body temp', '°C', 'var(--orange)', '#d96a1f'],
      ['blood_glucose', 'Glucose', ' mg/dL', 'var(--red)', '#e84191'],
    ],
  },
  {
    id: 'gait',
    label: 'GAIT',
    color: 'var(--cyan)',
    metrics: [
      ['walking_speed', 'Walk speed', ' km/h', 'var(--green)', '#2fa848'],
      ['step_length', 'Step length', ' cm', 'var(--green)', '#2fa848'],
      ['walking_asymmetry', 'Asymmetry', '%', 'var(--orange)', '#d96a1f'],
      ['walking_double_support', 'Double support', '%', 'var(--cyan)', '#1f9ecf'],
      ['walking_steadiness', 'Steadiness', '%', 'var(--cyan)', '#1f9ecf'],
      ['six_min_walk', 'Six-min walk', ' m', 'var(--green)', '#2fa848'],
      ['stair_speed_up', 'Stairs up', ' m/s', 'var(--yellow)', '#b3860a'],
      ['stair_speed_down', 'Stairs down', ' m/s', 'var(--yellow)', '#b3860a'],
    ],
  },
  {
    id: 'intake',
    label: 'INTAKE',
    color: 'var(--orange)',
    metrics: [
      ['dietary_energy', 'Calories in', '', 'var(--orange)', '#d96a1f'],
      ['protein_g', 'Protein', ' g', 'var(--pink)', '#e84191'],
      ['carbs_g', 'Carbs', ' g', 'var(--yellow)', '#b3860a'],
      ['fat_g', 'Fat', ' g', 'var(--orange)', '#d96a1f'],
      ['fiber_g', 'Fiber', ' g', 'var(--green)', '#2fa848'],
      ['sugar_g', 'Sugar', ' g', 'var(--red)', '#e84191'],
      ['sodium_mg', 'Sodium', ' mg', 'var(--cyan)', '#1f9ecf'],
      ['caffeine_mg', 'Caffeine', ' mg', 'var(--purple)', '#9a63e8'],
      ['water_ml', 'Water', ' ml', 'var(--cyan)', '#1f9ecf'],
    ],
  },
  {
    id: 'env',
    label: 'ENVIRONMENT',
    color: 'var(--yellow)',
    metrics: [
      ['time_in_daylight', 'Daylight', ' min', 'var(--yellow)', '#b3860a'],
      ['uv_index', 'UV', '', 'var(--orange)', '#d96a1f'],
      ['env_audio', 'Ambient sound', ' dB', 'var(--cyan)', '#1f9ecf'],
      ['headphone_audio', 'Headphone sound', ' dB', 'var(--purple)', '#9a63e8'],
    ],
  },
];

/** Every metric key the tiles can draw, for coverage checks against the app. */
export const TILE_KEYS = METRIC_GROUPS.flatMap(g => g.metrics.map(m => m[0]));

// ---------------------------------------------------------------------------
// Fallback readiness, for days the phone did not compute one.
//
// The phone's recovery score is strictly better than this — it uses five
// overnight markers against a rolling baseline, and it is measured during sleep
// rather than inferred from daily averages. This exists only so that history
// from before the app was installed still shows something, and the caller is
// expected to label it as an estimate. Preferring this when a real score
// exists would be a downgrade dressed as a feature.
// ---------------------------------------------------------------------------

const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

export function estimateRecovery({ hrv, hrvBaseline, restingHr, restingHrBaseline, sleepHours }) {
  let score = 68;
  const notes = [];
  if (Number.isFinite(hrv) && Number.isFinite(hrvBaseline) && hrvBaseline > 0) {
    const d = (hrv - hrvBaseline) / hrvBaseline;
    score += Math.max(-14, Math.min(16, d * 60));
    notes.push(d >= 0 ? 'HRV above baseline' : 'HRV below baseline');
  }
  if (Number.isFinite(restingHr) && Number.isFinite(restingHrBaseline) && restingHrBaseline > 0) {
    const d = (restingHrBaseline - restingHr) / restingHrBaseline;
    score += Math.max(-12, Math.min(12, d * 60));
    notes.push(restingHr <= restingHrBaseline ? 'Resting HR steady or low' : 'Resting HR elevated');
  }
  if (Number.isFinite(sleepHours)) {
    score += sleepHours >= 7 ? 8 : sleepHours >= 6 ? 0 : -12;
    notes.push(sleepHours >= 7 ? 'Slept well' : sleepHours >= 6 ? 'Slept enough' : 'Short sleep');
  }
  return { score: Math.max(1, Math.min(99, Math.round(score))), notes };
}

/**
 * Pick the recovery figure to show for a day, and say where it came from.
 * `estimated` is not cosmetic — the two numbers are computed from different
 * inputs and a chart that mixes them without saying so would show a step at the
 * install date that looks like a physiological change and is not one.
 */
export function recoveryFor(dayMetrics, historyFor) {
  const real = num(dayMetrics?.recovery_score);
  if (Number.isFinite(real)) {
    return { score: Math.round(real), estimated: false, notes: [] };
  }
  const hv = historyFor('hrv'), rv = historyFor('resting_hr');
  const est = estimateRecovery({
    hrv: num(dayMetrics?.hrv),
    hrvBaseline: mean(hv.slice(0, -1)),
    restingHr: num(dayMetrics?.resting_hr),
    restingHrBaseline: mean(rv.slice(0, -1)),
    sleepHours: num(dayMetrics?.sleep_hours),
  });
  return { ...est, estimated: true };
}
