// Portions, and what the numbers in the Body tab are numbers OF.
//
// Two gaps this closes, both of which made the food half of the tab look more
// informative than it was.
//
// 1. A FOOD ROW HAD NO PORTION. Open Food Facts hands back a row per serving or
//    per 100g, and the tab logged it as-is — so 100g of peanut butter and the
//    tablespoon you actually ate were the same entry. `scale()` is the missing
//    multiplication, and it keeps the basis attached so a row can always say
//    what it was scaled FROM.
//
// 2. THE TILES HAD NO DENOMINATOR. "2,100 kcal" and "84g protein" sat on screen
//    with nothing to read them against, while the micronutrient panel below had
//    targets for all thirteen of its entries. A number with no reference is not
//    a measurement, it is a decoration.
//
// WHAT THIS DELIBERATELY DOES NOT DO, and a future session must not add:
//
//   * No weight goal, no deficit, no "eat X to lose Y". `targets()` takes no
//     goal parameter and produces MAINTENANCE only — the energy the stated body
//     would use in a day. There is nowhere in this file to put a deficit.
//   * No judgement words. Nothing here returns "over", "bad", "cheat", "burn
//     off", or a streak to protect. Food is the one place in this app where a
//     scoring system does real harm, so the module hands back numbers and their
//     references and leaves the reading to a person.
//   * Nothing is invented when the body data is missing. No height, no age, no
//     target — `null`, named, the same rule the night summary runs on. A
//     reference computed from a guessed weight is worse than no reference,
//     because it looks equally authoritative.
//
// The formulas are standard and named so they can be checked, not trusted:
// Mifflin-St Jeor for resting energy, and a fibre reference of 14g per 1000
// kcal, which is where the flat "30g" in healthdata.js came from.

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const pos = v => { const n = num(v); return n != null && n > 0 ? n : null; };
const r1 = n => Math.round(n * 10) / 10;

// ------------------------------------------------------------------ portions

export const BASIS = { SERVING: 'serving', HUNDRED: '100g' };

/**
 * A food row, multiplied.
 *
 * `amount` is servings when the row is per-serving, and GRAMS when it is per
 * 100g — because "1.5" means something different in each case and asking for
 * "1.5 of a 100g row" is how a 150g plate becomes a 1.5g one. The unit the
 * caller should show is `unitFor()`.
 */
export const unitFor = per => (per === BASIS.HUNDRED ? 'g' : 'serving(s)');
export const factorFor = (per, amount) => {
  const a = pos(amount);
  if (a == null) return null;
  return per === BASIS.HUNDRED ? a / 100 : a;
};

export function scale(item, amount) {
  const f = factorFor(item?.per, amount);
  if (!item || f == null) return null;
  const m = v => (num(v) == null ? 0 : r1(num(v) * f));
  const micros = {};
  for (const [k, v] of Object.entries(item.micros || {})) micros[k] = m(v);
  return {
    ...item,
    kcal: Math.round((num(item.kcal) || 0) * f),
    protein: m(item.protein), carbs: m(item.carbs), fat: m(item.fat),
    micros,
    amount: pos(amount), unit: unitFor(item.per),
    // Kept so a logged row can always say what it was scaled from. A portion
    // with no stated basis is exactly the ambiguity this file exists to end.
    scaledFrom: { per: item.per, serving: item.serving || '' },
  };
}

// ------------------------------------------------------------------- targets

export const ACTIVITY = [
  { key: 'sedentary', label: 'Mostly sitting', factor: 1.2 },
  { key: 'light', label: 'Light — a walk most days', factor: 1.375 },
  { key: 'moderate', label: 'Moderate — training 3-5×', factor: 1.55 },
  { key: 'high', label: 'Hard training most days', factor: 1.725 },
];
export const activityBy = k => ACTIVITY.find(a => a.key === k) || ACTIVITY[1];

/** Mifflin-St Jeor. Returns null rather than a guess when anything is missing. */
export function restingEnergy({ weightKg, heightCm, age, sex } = {}) {
  const w = pos(weightKg), h = pos(heightCm), a = pos(age);
  if (w == null || h == null || a == null) return null;
  // The constant is the only place sex enters the calculation, and it is stated
  // rather than hidden in a table: +5 / −161 is the published equation.
  const s = sex === 'female' ? -161 : 5;
  return Math.round(10 * w + 6.25 * h - 5 * a + s);
}

export const PROTEIN_G_PER_KG = 1.6;   // a general training reference, not a prescription
export const FAT_PCT_KCAL = 0.27;
export const FIBER_G_PER_1000 = 14;

/**
 * Reference intake for a day. MAINTENANCE ONLY — see the note at the top.
 *
 * Returns `{ known: false, missing: [...] }` when the profile is incomplete,
 * naming exactly which fields would make it work. A UI showing "—" next to
 * "add your height" is honest; one showing a target derived from a default
 * 70kg body is not, and nothing on screen would distinguish them.
 */
export function targets(profile = {}) {
  const missing = [];
  if (pos(profile.weightKg) == null) missing.push('weight');
  if (pos(profile.heightCm) == null) missing.push('height');
  if (pos(profile.age) == null) missing.push('age');
  const rest = restingEnergy(profile);
  if (rest == null) return { known: false, missing, kind: 'maintenance' };

  const act = activityBy(profile.activity);
  const kcal = Math.round(rest * act.factor);
  const protein = Math.round(pos(profile.weightKg) * PROTEIN_G_PER_KG);
  const fat = Math.round((kcal * FAT_PCT_KCAL) / 9);
  // Carbs are the remainder rather than a percentage of their own, so the three
  // macros always add back up to the energy figure. A set of targets that does
  // not reconcile with its own calorie number is the fastest way to lose a
  // reader's trust in all of them.
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
  return {
    known: true, kind: 'maintenance', missing: [],
    restingEnergy: rest, activity: act,
    kcal, protein, carbs, fat,
    fiber: Math.round((kcal / 1000) * FIBER_G_PER_1000),
    // Said in the object so every caller carries it, rather than each screen
    // remembering to print a caveat of its own.
    basis: `Mifflin-St Jeor at ${act.factor}× for "${act.label.toLowerCase()}" — the energy this body uses in a day, not a plan.`,
  };
}

// -------------------------------------------------------------------- the day

export function dayTotals(meals = [], supps = []) {
  const t = { kcal: 0, protein: 0, carbs: 0, fat: 0, micros: {} };
  for (const row of [...(meals || []), ...(supps || [])]) {
    if (!row) continue;
    t.kcal += num(row.kcal) || 0;
    t.protein += num(row.protein) || 0;
    t.carbs += num(row.carbs) || 0;
    t.fat += num(row.fat) || 0;
    for (const [k, v] of Object.entries(row.micros || {})) t.micros[k] = (t.micros[k] || 0) + (num(v) || 0);
  }
  return { ...t, protein: r1(t.protein), carbs: r1(t.carbs), fat: r1(t.fat), kcal: Math.round(t.kcal), logged: (meals?.length || 0) + (supps?.length || 0) };
}

/**
 * Today against the references.
 *
 * `share` is what fraction of the reference has been logged, and it is NOT a
 * score. Nothing here decides whether a number is good: at 11am a third of the
 * day's energy is exactly right and at 11pm it is worth noticing, and this
 * module knows nothing about the time. It reports; the screen can say when.
 */
export function against(totals, tgt) {
  if (!tgt?.known) return { known: false, missing: tgt?.missing || [], rows: [] };
  const row = (key, label, unit, have, want, limit = false) => ({
    key, label, unit, have: r1(have || 0), want,
    share: want > 0 ? (have || 0) / want : null,
    // Limits (the things a reference says to stay under) are the only place a
    // direction is stated at all, because "you are over the sodium reference"
    // is a fact about sodium rather than a verdict on the person eating it.
    limit, over: limit ? (have || 0) > want : false,
  });
  return {
    known: true,
    rows: [
      row('kcal', 'Energy', 'kcal', totals?.kcal, tgt.kcal),
      row('protein', 'Protein', 'g', totals?.protein, tgt.protein),
      row('carbs', 'Carbs', 'g', totals?.carbs, tgt.carbs),
      row('fat', 'Fat', 'g', totals?.fat, tgt.fat),
      row('fiber', 'Fiber', 'g', totals?.micros?.fiber, tgt.fiber),
    ],
  };
}

// ------------------------------------------------------------------- the week
//
// A week is the unit that actually means something for food — one day tells you
// nothing and everyone knows it — so this exists mostly to stop a single heavy
// or light day being read as a trend.

/**
 * Too few logged days for an average to mean anything.
 *
 * Exported as a rule rather than inlined, because TWO screens show a food
 * average — the week roll-up and the History card — and a threshold that
 * disagrees between them is the kind of difference nobody notices and nobody
 * can explain afterwards.
 */
export const THIN_RATIO = 0.5;
export const isThin = (logged, asked) => logged > 0 && asked > 0 && logged < Math.ceil(asked * THIN_RATIO);

export function weekTotals(mealLog = {}, suppLog = {}, dates = []) {
  const days = dates.map(d => ({ date: d, ...dayTotals(mealLog?.[d], suppLog?.[d]) }));
  // Days with NOTHING logged are excluded from the average rather than counted
  // as zero-calorie days. A week with three days of logging does not mean he
  // ate 900 kcal a day, and an average that says so would be the single most
  // misleading number this tab could show.
  const logged = days.filter(d => d.logged > 0);
  const avg = k => (logged.length ? Math.round(logged.reduce((t, d) => t + (d[k] || 0), 0) / logged.length) : null);
  return {
    days,
    daysLogged: logged.length,
    daysAsked: days.length,
    kcal: avg('kcal'), protein: avg('protein'), carbs: avg('carbs'), fat: avg('fat'),
    // Said out loud, because an average over two days of seven is a number that
    // should come with its own warning attached.
    thin: isThin(logged.length, days.length),
  };
}
