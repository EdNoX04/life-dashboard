// Portions, references, and the things this module must never grow.
//
// Food is the one part of this app where a scoring system does real harm, so
// roughly half of these tests assert an ABSENCE: no deficit, no goal weight, no
// judgement words, no invented target from a guessed body. Those are the tests
// most likely to be quietly broken by a future "improvement", which is exactly
// why they are written down as rules rather than left as good intentions.

import {
  scale, factorFor, unitFor, BASIS, targets, restingEnergy, against,
  dayTotals, weekTotals, ACTIVITY, activityBy, PROTEIN_G_PER_KG,
} from '../src/lib/intake.js';
import { toItem, basisOf } from '../src/lib/foodapi.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log('FAIL ' + n); } };
const eq = (a, b, n) => ok(Object.is(a, b), `${n} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
const near = (a, b, n, tol = 0.51) => ok(Math.abs(a - b) <= tol, `${n} (got ${a}, want ~${b})`);

const PER100 = { name: 'Peanut butter', per: '100g', kcal: 588, protein: 25, carbs: 20, fat: 50, micros: { fiber: 6, sodium: 17 } };
const PERSERV = { name: 'Protein bar', per: 'serving', serving: '60g', kcal: 220, protein: 20, carbs: 22, fat: 7, micros: { fiber: 3 } };

// ============================================================ the OFF basis bug
//
// This was live: `per` was decided by the energy field while every other
// nutrient independently preferred per-serving and fell back to per-100g. A
// product with energy per serving and protein only per 100g produced a mixed
// row labelled "serving", with the protein several times too high.
{
  const mixed = { product_name: 'Biscuit', nutriments: {
    'energy-kcal_serving': 150, 'energy-kcal_100g': 500,
    'proteins_100g': 7, 'carbohydrates_100g': 60, 'fat_100g': 20 } };
  const i = toItem(mixed, '1');
  eq(i.per, '100g', 'a product missing macros per serving falls back to 100g for EVERYTHING');
  eq(i.kcal, 500, 'so the energy is the 100g figure too — never the serving one beside 100g protein');
  eq(i.protein, 7, 'and the protein is the same basis as the calories beside it');

  const clean = { product_name: 'Bar', nutriments: {
    'energy-kcal_serving': 220, 'proteins_serving': 20, 'carbohydrates_serving': 22, 'fat_serving': 7,
    'energy-kcal_100g': 366, 'proteins_100g': 33 } };
  eq(basisOf(clean.nutriments), 'serving', 'a fully-populated per-serving product uses per-serving');
  eq(toItem(clean, '2').protein, 20, 'and takes every field from that column');

  const none = toItem({ product_name: 'Sparse', nutriments: {} }, '3');
  eq(none.per, '100g', 'a product with nothing at all defaults to 100g rather than claiming a serving');
  eq(none.kcal, 0, 'with zeroes, not NaN');
}

// ----------------------------------------------------------------- portions
{
  eq(unitFor('100g'), 'g', 'a per-100g row is portioned in GRAMS');
  eq(unitFor('serving'), 'serving(s)', 'a per-serving row in servings');
  eq(factorFor('100g', 150), 1.5, '150g of a 100g row is 1.5×');
  eq(factorFor('serving', 1.5), 1.5, 'and 1.5 servings is 1.5× — the same number meaning two different things is the whole point of the unit');

  const s = scale(PER100, 32);           // a tablespoon
  eq(s.kcal, 188, 'a 32g spoonful of peanut butter is 188 kcal, not 588');
  eq(s.protein, 8, 'with the protein scaled the same way');
  eq(s.micros.fiber, 1.9, 'and the micros too — they feed the panel below');
  eq(s.amount, 32, 'the portion is kept on the row');
  eq(s.scaledFrom.per, '100g', 'along with what it was scaled FROM, so the row can always say');

  eq(scale(PERSERV, 2).kcal, 440, 'two bars is two bars');
  eq(scale(PER100, 0), null, 'a portion of zero is not a portion');
  eq(scale(PER100, 'some'), null, 'nor is one that is not a number');
  eq(scale(null, 100), null, 'and no item gives null rather than a throw');
}

// =========================================================================
// TARGETS — and everything they must never be
// =========================================================================
const NEEL = { weightKg: 70, heightCm: 178, age: 21, sex: 'male', activity: 'moderate' };

{
  near(restingEnergy(NEEL), 1713, 'Mifflin-St Jeor for a 70kg, 178cm, 21-year-old man');
  eq(restingEnergy({ ...NEEL, weightKg: null }), null, 'and NOTHING without a weight — not a default body');
  eq(restingEnergy({}), null, 'nor with nothing at all');

  const t = targets(NEEL);
  eq(t.known, true, 'a complete profile produces references');
  eq(t.kind, 'maintenance', 'and they are MAINTENANCE — the energy this body uses in a day');
  near(t.kcal, 2655, 'resting energy times the activity factor');
  eq(t.protein, Math.round(70 * PROTEIN_G_PER_KG), 'protein from bodyweight');
  // The three macros must reconcile with the energy figure or none of them
  // will be believed.
  near(t.protein * 4 + t.carbs * 4 + t.fat * 9, t.kcal, 'the macros add back up to the calories', 5);
  ok(/not a plan/.test(t.basis), 'and the object itself carries the caveat, so no screen has to remember it');
}

// ------------------------------------------- an incomplete profile invents nothing
{
  const t = targets({ weightKg: 70 });
  eq(t.known, false, 'a profile missing height and age produces NO targets');
  ok(t.missing.includes('height') && t.missing.includes('age'), 'naming exactly what would make it work');
  ok(!('kcal' in t), 'and no number at all — a reference from a guessed body looks just as authoritative as a real one');

  const a = against(dayTotals([{ kcal: 500 }]), t);
  eq(a.known, false, 'so the comparison has nothing to show either');
  eq(a.rows.length, 0, 'rather than a percentage of a made-up denominator');
}

// ------------------------------------------- no deficit, no goal, no judgement
{
  const t = targets({ ...NEEL, goal: 'lose', targetWeightKg: 60, deficit: 500 });
  near(t.kcal, 2655, 'a goal weight and a deficit passed in are IGNORED — this module has nowhere to put them');
  ok(!('deficit' in t) && !('goal' in t), 'and neither appears in the result');

  const src = JSON.stringify(Object.values(against(dayTotals([{ kcal: 3200, protein: 90 }]), targets(NEEL))));
  ok(!/(over budget|exceeded|bad|cheat|burn|guilt|should|too much)/i.test(src),
     'a day well above the reference produces no judgement word anywhere');

  const a = against(dayTotals([{ kcal: 3200, protein: 90, micros: { fiber: 40 } }]), targets(NEEL));
  const energy = a.rows.find(r => r.key === 'kcal');
  eq(energy.limit, false, 'energy is a REFERENCE, never a limit — nothing is being stayed under');
  eq(energy.over, false, 'so nothing is flagged as over it');
  near(energy.share, 3200 / 2655, 'the share is reported as a fraction and left to be read');
}

// ------------------------------------------------------------------ the day
{
  const t = dayTotals(
    [{ kcal: 500, protein: 30, micros: { fiber: 4, sodium: 300 } }, { kcal: 620, protein: 18, micros: { fiber: 2 } }],
    [{ kcal: 120, protein: 24, micros: { calcium: 120 } }],
  );
  eq(t.kcal, 1240, 'meals and supplements both count towards the day');
  eq(t.protein, 72, 'macros summed');
  eq(t.micros.fiber, 6, 'micros summed across rows');
  eq(t.micros.calcium, 120, 'including ones only a supplement carries');
  eq(t.logged, 3, 'and how many rows it came from');
  eq(dayTotals().kcal, 0, 'an empty day is zero, not a throw');
}

// ------------------------------------------------------------------ the week
{
  const dates = ['2026-09-06', '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12'];
  const meals = {
    '2026-09-10': [{ kcal: 2000, protein: 100 }],
    '2026-09-11': [{ kcal: 2400, protein: 120 }],
  };
  const w = weekTotals(meals, {}, dates);
  eq(w.daysLogged, 2, 'only days with something logged count as logged');
  eq(w.daysAsked, 7, 'out of the week asked about');
  eq(w.kcal, 2200, 'THE AVERAGE IS OVER LOGGED DAYS — five blank days do not mean he ate nothing on them');
  ok(w.kcal !== Math.round(4400 / 7), 'which is the difference between 2200 and a wildly wrong 629');
  eq(w.thin, true, 'and two days out of seven is flagged as too thin to read as a trend');

  const full = weekTotals(Object.fromEntries(dates.map(d => [d, [{ kcal: 2100 }]])), {}, dates);
  eq(full.thin, false, 'a fully logged week is not');
  eq(weekTotals({}, {}, dates).kcal, null, 'and a week with nothing logged has NO average, rather than zero');
}

// ---------------------------------------------------------------- activity
{
  eq(activityBy('moderate').factor, 1.55, 'activity factors are looked up');
  eq(activityBy('nonsense').key, 'light', 'and an unknown one falls back rather than multiplying by undefined');
  ok(ACTIVITY.every(a => a.factor >= 1.2 && a.factor <= 1.9), 'every factor is in the published range');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
