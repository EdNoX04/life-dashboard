// Run: bun tests/healthscores.test.js
//
// The health scoring bands. Everything in healthscores.js is pure and every
// failure it can have is silent: a band boundary that is off by one mislabels
// every day in that range and the rendered page looks completely normal. You
// would read "MODERATE" on a morning that was actually "LOW" for months without
// anything ever looking broken. So the boundaries are walked from both sides.
//
// Four decisions here are load-bearing and are each pinned deliberately:
//
//   1. `bandFor()` returns null for a missing value, NOT the bottom band. A day
//      the phone did not sync must draw as a gap. If absence collapsed into
//      "DRAINED"/"VERY POOR" the dashboard would invent a bad health day out of
//      a dead Bluetooth connection, which is the worst failure this file has.
//   2. Bands are read high-to-low with `>=`, so the boundary value itself
//      belongs to the HIGHER band. 85 is PRIME, 84.999 is READY.
//   3. `loadBand()` is not monotonic in "good". Both ends of the cardio-load
//      ratio are unwanted — 1.6 is a SPIKE and 0.3 is DETRAINING, and OPTIMAL
//      sits in the middle. A test that only checked "higher ratio, worse band"
//      would pass on a version that had inverted the bottom half.
//   4. `recoveryFor()` prefers the phone's real score and flags the fallback.
//      The estimate and the real score are computed from different inputs, so
//      mixing them silently would put a step in the chart at the app's install
//      date that looks physiological and is not.
//
// The tile catalogue is checked against the iOS app's own MetricCatalog.swift
// key list, copied in below. That is the point of the check: when a metric is
// added on the phone, this suite fails and names it, instead of the metric
// arriving in the database and never being drawn.

import {
  SCORES, SCORE_BY_KEY, bandFor,
  LOAD_BANDS, loadBand,
  sleepBank, sleepDebtPct, bioAgeDelta,
  METRIC_GROUPS, TILE_KEYS,
  estimateRecovery, recoveryFor,
} from '../src/lib/healthscores.js';

let pass = 0, fail = 0;
const bad = [];
const ok = (name, cond, got) => {
  if (cond) pass++;
  else { fail++; bad.push(name); console.log('FAIL', name, got === undefined ? '' : `— ${got}`); }
};

// ---------------------------------------------------------------------------
// Band table shape. These are structural invariants the boundary walk below
// depends on, so they are asserted before it rather than assumed by it.
// ---------------------------------------------------------------------------
{
  ok('there are five scores', SCORES.length === 5, String(SCORES.length));
  ok('every score is reachable by key',
    SCORES.every(s => SCORE_BY_KEY.get(s.key) === s));
  ok('keys are unique', new Set(SCORES.map(s => s.key)).size === SCORES.length);

  for (const s of SCORES) {
    ok(`${s.key}: bands descend`,
      s.bands.every((b, i) => !i || b[0] < s.bands[i - 1][0]),
      JSON.stringify(s.bands.map(b => b[0])));
    ok(`${s.key}: the last band is open at the bottom`,
      s.bands[s.bands.length - 1][0] === 0, String(s.bands[s.bands.length - 1][0]));
    ok(`${s.key}: every band has a label and a colour`,
      s.bands.every(b => typeof b[1] === 'string' && b[1].length && /^var\(--|^#/.test(b[2])));
    ok(`${s.key}: has a blurb saying what it measures`,
      typeof s.blurb === 'string' && s.blurb.length > 20);
    ok(`${s.key}: labels are unique within the score`,
      new Set(s.bands.map(b => b[1])).size === s.bands.length);
  }

  // Only stress is inverted, and it must be, because 70 stress is bad while 70
  // of everything else is good. If this flag were dropped the dial would fill
  // green on the worst readings.
  ok('stress_avg is the one inverted score',
    SCORES.filter(s => s.invert).map(s => s.key).join() === 'stress_avg',
    SCORES.filter(s => s.invert).map(s => s.key).join());
  ok('and its worst band is at the top of the range',
    SCORE_BY_KEY.get('stress_avg').bands[0][1] === 'HIGH');
  ok('while recovery\'s best band is at the top',
    SCORE_BY_KEY.get('recovery_score').bands[0][1] === 'PRIME');
}

// ---------------------------------------------------------------------------
// Every boundary, from both sides. Generated from the table so a band added
// later is walked without anyone remembering to add a case.
// ---------------------------------------------------------------------------
{
  for (const s of SCORES) {
    for (let i = 0; i < s.bands.length; i++) {
      const [floor, label] = s.bands[i];
      ok(`${s.key} @ ${floor} is ${label} (the boundary belongs to the higher band)`,
        bandFor(s.key, floor)?.label === label, bandFor(s.key, floor)?.label);
      if (i > 0) {
        // Just below the floor must fall to the band underneath, never skip one.
        const below = s.bands[i - 1];
        ok(`${s.key} @ ${below[0] - 0.01} drops to ${label}`,
          bandFor(s.key, below[0] - 0.01)?.label === label,
          bandFor(s.key, below[0] - 0.01)?.label);
      }
    }
    ok(`${s.key}: the top of the scale is the top band`,
      bandFor(s.key, s.max)?.label === s.bands[0][1]);
    ok(`${s.key}: a negative reading degrades to the bottom band, not null`,
      bandFor(s.key, -5)?.label === s.bands[s.bands.length - 1][1],
      String(bandFor(s.key, -5)?.label));
  }
}

// ---------------------------------------------------------------------------
// The same boundaries again, as literals.
//
// The walk above is generated from SCORES, which makes it thorough and makes it
// blind in one specific way: move a floor in the table and the assertion moves
// with it, so the walk passes and the app silently relabels every day in that
// range. (Confirmed — mutating PRIME's floor from 85 to 86 was not caught until
// this block existed.) These are typed out by hand so a changed threshold has
// to be argued for rather than absorbed.
// ---------------------------------------------------------------------------
{
  const B = (k, v) => bandFor(k, v)?.label;
  ok('recovery: 85 is PRIME, 84 is not', B('recovery_score', 85) === 'PRIME' && B('recovery_score', 84) === 'READY',
    `${B('recovery_score', 85)} / ${B('recovery_score', 84)}`);
  ok('recovery: 70 READY, 69 MODERATE', B('recovery_score', 70) === 'READY' && B('recovery_score', 69) === 'MODERATE');
  ok('recovery: 50 MODERATE, 49 LOW', B('recovery_score', 50) === 'MODERATE' && B('recovery_score', 49) === 'LOW');
  ok('recovery: 34 LOW, 33 DRAINED', B('recovery_score', 34) === 'LOW' && B('recovery_score', 33) === 'DRAINED');

  ok('strain: 80 ALL OUT, 79 HARD', B('strain', 80) === 'ALL OUT' && B('strain', 79) === 'HARD');
  ok('strain: 60 HARD, 59 MODERATE', B('strain', 60) === 'HARD' && B('strain', 59) === 'MODERATE');
  ok('strain: 35 MODERATE, 34 LIGHT', B('strain', 35) === 'MODERATE' && B('strain', 34) === 'LIGHT');
  ok('strain: 15 LIGHT, 14 REST', B('strain', 15) === 'LIGHT' && B('strain', 14) === 'REST');

  ok('sleep: 85 EXCELLENT, 84 GOOD', B('sleep_score', 85) === 'EXCELLENT' && B('sleep_score', 84) === 'GOOD');
  ok('sleep: 70 GOOD, 69 FAIR', B('sleep_score', 70) === 'GOOD' && B('sleep_score', 69) === 'FAIR');
  ok('sleep: 55 FAIR, 54 POOR', B('sleep_score', 55) === 'FAIR' && B('sleep_score', 54) === 'POOR');
  ok('sleep: 40 POOR, 39 VERY POOR', B('sleep_score', 40) === 'POOR' && B('sleep_score', 39) === 'VERY POOR');

  ok('stress: 70 HIGH, 69 ELEVATED', B('stress_avg', 70) === 'HIGH' && B('stress_avg', 69) === 'ELEVATED');
  ok('stress: 50 ELEVATED, 49 MODERATE', B('stress_avg', 50) === 'ELEVATED' && B('stress_avg', 49) === 'MODERATE');
  ok('stress: 30 MODERATE, 29 CALM', B('stress_avg', 30) === 'MODERATE' && B('stress_avg', 29) === 'CALM');
  ok('stress: 15 CALM, 14 VERY CALM', B('stress_avg', 15) === 'CALM' && B('stress_avg', 14) === 'VERY CALM');

  ok('energy: 75 FULL, 74 GOOD', B('body_energy', 75) === 'FULL' && B('body_energy', 74) === 'GOOD');
  ok('energy: 50 GOOD, 49 LOW', B('body_energy', 50) === 'GOOD' && B('body_energy', 49) === 'LOW');
  ok('energy: 30 LOW, 29 RUNNING OUT', B('body_energy', 30) === 'LOW' && B('body_energy', 29) === 'RUNNING OUT');
  ok('energy: 15 RUNNING OUT, 14 EMPTY', B('body_energy', 15) === 'RUNNING OUT' && B('body_energy', 14) === 'EMPTY');
}

// ---------------------------------------------------------------------------
// Absence. The single most consequential behaviour in the file.
// ---------------------------------------------------------------------------
{
  for (const v of [null, undefined, '', NaN, Infinity, -Infinity, 'n/a', {}]) {
    ok(`a missing value (${JSON.stringify(v) ?? String(v)}) is null, not a band`,
      bandFor('recovery_score', v) === null, JSON.stringify(bandFor('recovery_score', v)));
  }
  ok('an unknown score key is null rather than a crash',
    bandFor('not_a_score', 50) === null);
  // Zero is a real reading, not an absent one, and must not be swept up by a
  // falsy check. Strain genuinely reads 0 on a rest day.
  ok('zero is a real reading and lands in the bottom band',
    bandFor('strain', 0)?.label === 'REST', String(bandFor('strain', 0)?.label));
  ok('and the string "0" is too, since the database returns text',
    bandFor('strain', '0')?.label === 'REST');
  ok('a numeric string reads as its number', bandFor('recovery_score', '86')?.label === 'PRIME');
}

// ---------------------------------------------------------------------------
// Cardio load. Non-monotonic on purpose.
// ---------------------------------------------------------------------------
{
  ok('five load bands', LOAD_BANDS.length === 5, String(LOAD_BANDS.length));
  ok('load band minimums descend',
    LOAD_BANDS.every((b, i) => !i || b.min < LOAD_BANDS[i - 1].min));
  ok('the last is open at the bottom', LOAD_BANDS[LOAD_BANDS.length - 1].min === -Infinity);
  ok('every load band explains itself',
    LOAD_BANDS.every(b => typeof b.note === 'string' && b.note.length > 15));

  const L = r => loadBand(r)?.label;
  ok('1.5 is SPIKE', L(1.5) === 'SPIKE', L(1.5));
  ok('1.49 is PUSHING', L(1.49) === 'PUSHING', L(1.49));
  ok('1.3 is PUSHING', L(1.3) === 'PUSHING', L(1.3));
  ok('1.29 is OPTIMAL', L(1.29) === 'OPTIMAL', L(1.29));
  ok('1.0 is OPTIMAL', L(1) === 'OPTIMAL', L(1));
  ok('0.8 is OPTIMAL', L(0.8) === 'OPTIMAL', L(0.8));
  ok('0.79 is EASING', L(0.79) === 'EASING', L(0.79));
  ok('0.5 is EASING', L(0.5) === 'EASING', L(0.5));
  ok('0.49 is DETRAINING', L(0.49) === 'DETRAINING', L(0.49));
  ok('0 is DETRAINING', L(0) === 'DETRAINING', L(0));

  // The shape that matters: green sits in the middle, and both extremes are
  // coloured as problems. A ratio of 2 and a ratio of 0.2 are both wrong.
  ok('OPTIMAL is green and is in the middle of the range',
    loadBand(1).color === 'var(--green)' && L(2) !== 'OPTIMAL' && L(0.2) !== 'OPTIMAL');
  ok('a huge ratio is a spike, not the best band', L(9) === 'SPIKE', L(9));
  ok('a tiny ratio is detraining, not the best band', L(0.01) === 'DETRAINING', L(0.01));
  ok('missing load is null', loadBand(null) === null && loadBand(undefined) === null && loadBand('x') === null);
}

// ---------------------------------------------------------------------------
// Sleep bank. The sign carries the meaning.
// ---------------------------------------------------------------------------
{
  const B = h => sleepBank(h);
  ok('-6h is DEEP DEBT', B(-6).label === 'DEEP DEBT', B(-6).label);
  ok('-4h is DEEP DEBT (boundary)', B(-4).label === 'DEEP DEBT', B(-4).label);
  ok('-3.99h is only IN DEBT', B(-3.99).label === 'IN DEBT', B(-3.99).label);
  ok('-1.5h is IN DEBT (boundary)', B(-1.5).label === 'IN DEBT', B(-1.5).label);
  ok('-1.49h is LEVEL', B(-1.49).label === 'LEVEL', B(-1.49).label);
  ok('0 is LEVEL', B(0).label === 'LEVEL', B(0).label);
  ok('1.49h is LEVEL', B(1.49).label === 'LEVEL', B(1.49).label);
  ok('1.5h is SURPLUS (boundary)', B(1.5).label === 'SURPLUS', B(1.5).label);

  // The words, not the minus sign. "2.0h down" is readable at a glance in a way
  // that "-2.0h" beside a coloured chip is not.
  ok('debt reads as "down"', B(-2).text === '2.0h down', B(-2).text);
  ok('surplus reads as "up"', B(3).text === '3.0h up', B(3).text);
  ok('and the magnitude is never printed with its sign',
    !B(-6).text.includes('-'), B(-6).text);
  ok('exactly level reads as "even"', B(0).text === 'even', B(0).text);
  ok('a hair off level still reads as even', B(0.05).text === 'even', B(0.05).text);
  ok('but a tenth of an hour does not', B(0.2).text === '0.2h up', B(0.2).text);

  ok('sign is -1 for debt', B(-2).sign === -1);
  ok('sign is 0 for level', B(0).sign === 0);
  ok('sign is +1 for surplus', B(3).sign === 1);
  ok('missing sleep bank is null', sleepBank(null) === null && sleepBank('x') === null);
  ok('zero is not treated as missing', sleepBank(0) !== null);
}

// ---------------------------------------------------------------------------
// Sleep debt percentage, clamped.
// ---------------------------------------------------------------------------
{
  ok('7 of 8 hours is 88%', sleepDebtPct(7, 8) === 88, String(sleepDebtPct(7, 8)));
  ok('meeting the need is 100%', sleepDebtPct(8, 8) === 100);
  ok('a huge overshoot clamps at 150 rather than blowing out the bar',
    sleepDebtPct(40, 8) === 150, String(sleepDebtPct(40, 8)));
  ok('a negative reading floors at 0', sleepDebtPct(-3, 8) === 0, String(sleepDebtPct(-3, 8)));
  ok('sleeping nothing is 0, not null', sleepDebtPct(0, 8) === 0);
  // Dividing by a zero need is the one case that would produce Infinity and
  // render as a bar off the end of the card.
  ok('a zero need is null, not Infinity', sleepDebtPct(7, 0) === null);
  ok('a negative need is null', sleepDebtPct(7, -8) === null);
  ok('missing inputs are null', sleepDebtPct(null, 8) === null && sleepDebtPct(7, null) === null);
}

// ---------------------------------------------------------------------------
// Biological age. The dead band around zero is the point.
// ---------------------------------------------------------------------------
{
  const D = (b, a) => bioAgeDelta(b, a);
  ok('five years younger is MUCH YOUNGER', D(15, 20).label === 'MUCH YOUNGER', D(15, 20).label);
  ok('4.9 younger is only YOUNGER', D(15.1, 20).label === 'YOUNGER', D(15.1, 20).label);
  ok('one year younger is YOUNGER (boundary)', D(19, 20).label === 'YOUNGER', D(19, 20).label);
  // The dead band: a year either way is inside the noise of VO2max and body fat
  // estimates, so it must not read as a win you could chase week to week.
  ok('0.9 younger is ON PAR', D(19.1, 20).label === 'ON PAR', D(19.1, 20).label);
  ok('exactly equal is ON PAR', D(20, 20).label === 'ON PAR', D(20, 20).label);
  ok('0.9 older is ON PAR', D(20.9, 20).label === 'ON PAR', D(20.9, 20).label);
  ok('one year older is OLDER (boundary)', D(21, 20).label === 'OLDER', D(21, 20).label);
  ok('five years older is MUCH OLDER', D(25, 20).label === 'MUCH OLDER', D(25, 20).label);
  ok('4.9 older is only OLDER', D(24.9, 20).label === 'OLDER', D(24.9, 20).label);

  ok('the delta is signed bio minus actual', D(25, 20).delta === 5 && D(15, 20).delta === -5);
  ok('younger is green or cyan, older is orange or red',
    D(15, 20).color === 'var(--green)' && D(25, 20).color === 'var(--red)');
  ok('missing inputs are null', D(null, 20) === null && D(25, null) === null && D('x', 20) === null);
}

// ---------------------------------------------------------------------------
// Tile catalogue against the phone.
//
// This is the list from PlayerOneSync/Health/MetricCatalog.swift. It is copied
// rather than imported because the Swift file is not on this machine at test
// time; copying it means the check is a genuine tripwire — when a metric is
// added on the phone and this list is updated, the missing tile is named.
// ---------------------------------------------------------------------------
{
  const CATALOG_QUANTITIES = [
    'steps', 'distance_km', 'cycling_km', 'swim_km', 'flights', 'active_energy',
    'basal_energy', 'exercise_min', 'heart_rate', 'heart_rate_min', 'heart_rate_max',
    'resting_hr', 'walking_hr', 'hrv', 'hr_recovery', 'atrial_fib', 'spo2',
    'resp_rate', 'weight', 'body_fat', 'lean_mass', 'bmi', 'height', 'waist',
    'vo2max', 'wrist_temp', 'body_temp', 'blood_glucose', 'bp_systolic',
    'bp_diastolic', 'walking_speed', 'step_length', 'walking_asymmetry',
    'walking_double_support', 'walking_steadiness', 'six_min_walk',
    'stair_speed_up', 'stair_speed_down', 'water_ml', 'dietary_energy',
    'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'sugar_g', 'sodium_mg',
    'caffeine_mg', 'env_audio', 'headphone_audio', 'time_in_daylight', 'uv_index',
  ];
  const CATALOG_DERIVED = [
    'sleep_hours', 'sleep_deep', 'sleep_rem', 'sleep_core', 'sleep_awake',
    'sleep_in_bed', 'stand_hours', 'mindful_min',
  ];
  const CATALOG_SCORES = [
    'recovery_score', 'strain', 'sleep_score', 'stress_avg', 'body_energy',
    'sleep_bank', 'sleep_needed', 'biological_age', 'cardio_load_acute',
    'cardio_load_chronic', 'cardio_load_ratio',
  ];

  ok('the catalog copy still has 51 quantities', CATALOG_QUANTITIES.length === 51,
    String(CATALOG_QUANTITIES.length));
  ok('8 derived keys', CATALOG_DERIVED.length === 8);
  ok('11 score keys', CATALOG_SCORES.length === 11);

  const tiles = new Set(TILE_KEYS);
  ok('no metric is tiled twice', tiles.size === TILE_KEYS.length,
    `${tiles.size} unique of ${TILE_KEYS.length}`);

  // Every raw and derived metric the phone can send must have somewhere to land.
  // A metric with no tile arrives in the database and is never drawn, and there
  // is nothing on screen that would tell you it is happening.
  const raw = [...CATALOG_QUANTITIES, ...CATALOG_DERIVED];
  const untiled = raw.filter(k => !tiles.has(k));
  ok('every raw and derived metric the phone sends has a tile',
    untiled.length === 0, untiled.join(', '));

  // The reverse: a tile for a key the phone never sends is a permanently empty
  // slot. The three allowed exceptions are scores that read naturally as tiles.
  const ALLOWED_SCORE_TILES = ['sleep_needed', 'sleep_bank', 'biological_age'];
  const known = new Set([...raw, ...ALLOWED_SCORE_TILES]);
  const orphans = TILE_KEYS.filter(k => !known.has(k));
  ok('no tile draws a key the phone never sends', orphans.length === 0, orphans.join(', '));

  // The five dial scores must NOT also be tiles — they get their own gauges at
  // the top of the tab, and showing them twice makes the page look padded.
  const dialed = SCORES.map(s => s.key).filter(k => tiles.has(k));
  ok('dial scores are not repeated as tiles', dialed.length === 0, dialed.join(', '));

  ok('seven groups', METRIC_GROUPS.length === 7, String(METRIC_GROUPS.length));
  ok('every group has an id, label and colour',
    METRIC_GROUPS.every(g => g.id && g.label && /^var\(--/.test(g.color)));
  ok('group ids are unique', new Set(METRIC_GROUPS.map(g => g.id)).size === METRIC_GROUPS.length);
  ok('no group is empty', METRIC_GROUPS.every(g => g.metrics.length > 0));
  ok('every tile tuple is [key, label, unit, cssVar, hex]',
    METRIC_GROUPS.every(g => g.metrics.every(m =>
      m.length === 5 && typeof m[0] === 'string' && typeof m[1] === 'string'
      && typeof m[2] === 'string' && /^var\(--/.test(m[3]) && /^#[0-9a-f]{6}$/i.test(m[4]))));
}

// ---------------------------------------------------------------------------
// The fallback estimate, and the rule that it is a fallback.
// ---------------------------------------------------------------------------
{
  const base = { hrv: 60, hrvBaseline: 60, restingHr: 55, restingHrBaseline: 55, sleepHours: 7.5 };
  const e = estimateRecovery(base);
  ok('a neutral day scores near the 68 anchor plus the sleep bonus',
    e.score === 76, String(e.score));
  ok('and says why', e.notes.length === 3, JSON.stringify(e.notes));

  ok('HRV above baseline raises the score',
    estimateRecovery({ ...base, hrv: 80 }).score > e.score);
  ok('HRV below baseline lowers it',
    estimateRecovery({ ...base, hrv: 40 }).score < e.score);
  ok('an elevated resting HR lowers it',
    estimateRecovery({ ...base, restingHr: 70 }).score < e.score);
  ok('short sleep lowers it',
    estimateRecovery({ ...base, sleepHours: 4 }).score < e.score);

  // Clamps. A single wild HRV reading — and wrist sensors do produce them —
  // must not push the dial past the end of its own scale.
  ok('an absurd HRV cannot push past 99',
    estimateRecovery({ ...base, hrv: 100000 }).score <= 99,
    String(estimateRecovery({ ...base, hrv: 100000 }).score));
  ok('and a collapsed one cannot go below 1',
    estimateRecovery({ ...base, hrv: 0.0001, restingHr: 400, sleepHours: 0 }).score >= 1,
    String(estimateRecovery({ ...base, hrv: 0.0001, restingHr: 400, sleepHours: 0 }).score));
  ok('the score is always an integer',
    Number.isInteger(estimateRecovery({ ...base, hrv: 63.7 }).score));

  // The outer clamp has to actually bite, and the earlier case did not reach it:
  // a wild HRV alone maxes the HRV term at +16 and lands on 92, well inside 99.
  // All three terms have to be maxed together before the clamp is load-bearing,
  // which is why removing it went unnoticed until this case existed.
  const ceiling = estimateRecovery({ hrv: 1e6, hrvBaseline: 60, restingHr: 1, restingHrBaseline: 55, sleepHours: 8 });
  ok('every term maxed together would exceed 100, and is clamped to 99',
    ceiling.score === 99, String(ceiling.score));
  // The floor is a different story and it is worth being honest about: the
  // inner clamps bound the worst case at 68 - 14 - 12 - 12 = 30, so Math.max(1,
  // ...) can never fire. It is a guard against a future change to the term
  // weights rather than against any input. Asserting 30 pins the real floor;
  // asserting the clamp would be asserting dead code.
  const floor = estimateRecovery({ hrv: 0.001, hrvBaseline: 60, restingHr: 1e6, restingHrBaseline: 55, sleepHours: 0 });
  ok('the worst possible day is 30, not 1 — the lower clamp is unreachable',
    floor.score === 30, String(floor.score));

  // With nothing to go on it must still return the anchor rather than NaN, and
  // must say nothing rather than inventing a reason.
  // The term weights themselves. Every case above either saturates the +/-16
  // HRV clamp (so widening it changes nothing) or sits far inside it, which
  // left the weight free to drift. This one sits exactly on the clamp: an HRV
  // of 100 against a baseline of 50 is d = 1.0, sixty times which is 60, so the
  // clamp is what decides the answer and the clamp's value is visible in it.
  ok('the HRV term is capped at +16, and the cap is what 92 is made of',
    estimateRecovery({ hrv: 100, hrvBaseline: 50, sleepHours: 7.5 }).score === 92,
    String(estimateRecovery({ hrv: 100, hrvBaseline: 50, sleepHours: 7.5 }).score));

  // Same argument for the resting-HR cap, which is +/-12 rather than +/-16 —
  // resting HR is the steadier signal and is deliberately given less pull. A
  // resting HR of 25 against a baseline of 50 is d = 0.5, sixty times which is
  // 30, so again the cap is the whole answer.
  ok('the resting-HR term is capped at +12',
    estimateRecovery({ restingHr: 25, restingHrBaseline: 50, sleepHours: 7.5 }).score === 88,
    String(estimateRecovery({ restingHr: 25, restingHrBaseline: 50, sleepHours: 7.5 }).score));

  const blind = estimateRecovery({});
  ok('no inputs gives the bare anchor', blind.score === 68, String(blind.score));
  ok('and offers no explanation it cannot support', blind.notes.length === 0);
  ok('a zero baseline does not divide by zero',
    Number.isFinite(estimateRecovery({ ...base, hrvBaseline: 0, restingHrBaseline: 0 }).score));
}

{
  const hist = k => (k === 'hrv' ? [55, 58, 60, 62] : [56, 55, 54, 55]);

  // The rule: a real score wins, always. The estimate uses daily averages and
  // the phone's uses five overnight markers against a rolling baseline, so
  // preferring the estimate would be a downgrade dressed as a feature.
  const real = recoveryFor({ recovery_score: 81, hrv: 20, resting_hr: 90, sleep_hours: 3 }, hist);
  ok('a real score is used even when the raw inputs look terrible',
    real.score === 81, String(real.score));
  ok('and is not flagged as an estimate', real.estimated === false);

  const est = recoveryFor({ hrv: 62, resting_hr: 54, sleep_hours: 7.5 }, hist);
  ok('with no real score it falls back', Number.isFinite(est.score));
  ok('and says so, because the two are not the same measurement',
    est.estimated === true);
  ok('the fallback carries its notes', est.notes.length > 0);

  ok('a real score of 0 is still a real score, not a missing one',
    recoveryFor({ recovery_score: 0 }, hist).estimated === false,
    String(recoveryFor({ recovery_score: 0 }, hist).estimated));
  ok('a non-numeric real score falls back rather than rendering NaN',
    recoveryFor({ recovery_score: 'n/a', hrv: 62 }, hist).estimated === true);
  ok('a real score is rounded to an integer',
    recoveryFor({ recovery_score: 72.6 }, hist).score === 73,
    String(recoveryFor({ recovery_score: 72.6 }, hist).score));
  ok('an empty day does not crash',
    Number.isFinite(recoveryFor({}, () => []).score));
  ok('a null day does not crash',
    Number.isFinite(recoveryFor(null, () => []).score));

  const spike = recoveryFor({ hrv: 200, resting_hr: 54, sleep_hours: 7.5 }, hist);
  const flat = recoveryFor({ hrv: 62, resting_hr: 54, sleep_hours: 7.5 }, hist);
  ok('a large HRV deviation still moves the fallback score',
    spike.score > flat.score, `${spike.score} vs ${flat.score}`);

  // The baseline must exclude today. Comparing today's HRV against a window
  // that contains today drags the baseline toward the reading and flattens the
  // deviation the score exists to detect — and it does so quietly, since both
  // versions return a plausible number.
  //
  // A big deviation cannot show this, because either baseline saturates the
  // +/-16 clamp and both give the same answer; that is exactly why the original
  // version of this check passed on a mutated file. So the fixture is a small
  // deviation, sized so the two baselines land on different scores: history
  // [50, 50, 50, 56] means 50 excluding today and 51.5 including it, and with
  // today's HRV at 56 that is 83 versus 81.
  const tight = k => (k === 'hrv' ? [50, 50, 50, 56] : []);
  const excl = recoveryFor({ hrv: 56, sleep_hours: 7.5 }, tight);
  ok('the HRV baseline excludes today, so the deviation survives',
    excl.score === 83, `${excl.score} (81 means today is in its own baseline)`);

  // And the same for resting HR, which is a separate slice() call and so a
  // separate chance to get it wrong. History [50, 50, 50, 44] with today at 44
  // gives 83 excluding today and 82 including it.
  const rhrHist = k => (k === 'resting_hr' ? [50, 50, 50, 44] : []);
  const rhrExcl = recoveryFor({ resting_hr: 44, sleep_hours: 7.5 }, rhrHist);
  ok('the resting-HR baseline excludes today too',
    rhrExcl.score === 83, `${rhrExcl.score} (82 means today is in its own baseline)`);

  // And the whole point of the score: it lands in a band.
  ok('the fallback lands in a real band',
    bandFor('recovery_score', est.score) !== null);
}

console.log(`\n${pass}/${pass + fail} passing`);
if (fail) { console.log('\nfailing:\n  ' + bad.join('\n  ')); process.exit(1); }
