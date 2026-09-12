// Routines — and the line this file must not cross.
//
// Two things are being checked here. The first is that borrowing the meds
// engine actually worked: pending-vs-missed, the hour of grace, no figure for
// an as-needed routine. Those are meds.js's rules and the point of reusing it
// is that they stay one implementation — so these tests exist to prove the
// wiring, not to re-test the maths.
//
// The second is the boundary. Grooming is where an app most easily slides from
// "here is your routine" into "here is how you are doing as a face", and the
// vocabulary is where that slide starts. So it is asserted.

import {
  AREAS, areaOf, normaliseRoutine, dueRoutines, routineDay, kept,
  runsOut, shoppingList, byArea, summary, RUNNING_LOW_DAYS, DOSE_STATE,
} from '../src/lib/grooming.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log('FAIL ' + n); } };
const eq = (a, b, n) => ok(Object.is(a, b), `${n} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const TODAY = '2026-09-13';
const AM_PM = { id: 'sun', name: 'Sunscreen', area: 'skin', product: 'La Shield SPF 40',
                schedule: { kind: 'times', times: ['08:00', '14:00'] }, from: '2026-09-01' };
const log = (date, n, name = 'Sunscreen') => ({ [date]: Array.from({ length: n }, (_, i) => ({ id: i, name })) });

// ------------------------------------------------------- it really is a course
{
  const r = normaliseRoutine(AM_PM);
  eq(r.to, null, 'a routine has NO end date — a course of antibiotics finishes, moisturiser does not');
  eq(r.area, 'skin', 'it keeps its area');
  eq(r.product, 'La Shield SPF 40', 'and its product');
  eq(normaliseRoutine({ area: 'aura' }).area, 'other', 'an unknown area falls back');
  eq(areaOf('nope').key, 'other', 'as does an unknown lookup');
  ok(AREAS.every(a => /^[a-z]+$/.test(a.key)), 'the areas are plain nouns — skin, hair, teeth');
  ok(!AREAS.some(a => /glow|better|improve|perfect/i.test(a.label)),
     'and none of them is aspirational — a category called "glow-up" sets the tone for everything under it');
}

// ------------------------------------------ the borrowed engine still behaves
{
  const morning = routineDay(AM_PM, log(TODAY, 1), TODAY, 9 * 60);   // 09:00
  eq(morning.taken, 1, 'the 08:00 step is done');
  eq(morning.pending, 1, 'and the 14:00 one is PENDING at nine in the morning, not missed');
  eq(morning.doses[1].state, DOSE_STATE.PENDING, 'by name');
  eq(routineDay(AM_PM, log(TODAY, 1), TODAY, 23 * 60).missed, 1, 'by eleven at night it is missed');
  eq(routineDay(AM_PM, log(TODAY, 4), TODAY, 23 * 60).extra, 2,
     'and doing it four times is two extra, never four-for-two credit');

  const k = kept(AM_PM, log(TODAY, 2), { from: TODAY, to: TODAY, today: TODAY, nowMin: 23 * 60 });
  eq(k.kept, 100, 'both steps kept reads 100');
  const prn = kept({ ...AM_PM, schedule: { kind: 'prn' } }, {}, { from: '2026-09-01', to: TODAY, today: TODAY });
  eq(prn.kept, null,
     'an as-needed routine has NO figure — not 0%, which would read as failure for something that expected nothing');

  eq(dueRoutines([AM_PM], log(TODAY, 1), TODAY, 9 * 60).length, 2, "today's steps are listed");
  eq(dueRoutines([{ ...AM_PM, from: '2026-12-01' }], {}, TODAY, 600).length, 0, 'one that has not started is not');
  eq(dueRoutines(null, null, TODAY, 600).length, 0, 'and rubbish in is an empty list');
}

// =========================================================================
// THE PRODUCT — the one thing meds.js does not do
// =========================================================================
{
  const r = { ...AM_PM, openedAt: '2026-08-01', lastsDays: 60 };
  const out = runsOut(r, TODAY);
  eq(out.on, '2026-09-30', 'a bottle opened in August with 60 days in it runs out on the 30th');
  eq(out.daysLeft, 17, 'with the days counted');
  eq(out.low, false, 'seventeen days is not low');
  eq(runsOut({ ...r, openedAt: '2026-07-20' }, TODAY).low, true, `but ${RUNNING_LOW_DAYS} days or fewer is`);
  eq(runsOut({ ...r, openedAt: '2026-06-01' }, TODAY).out, true, 'and past the date it is out');

  eq(runsOut({ ...AM_PM, openedAt: '2026-08-01' }, TODAY), null,
     'with no shelf life entered NOTHING is claimed — an invented one puts a date on something nobody decided, and he would plan around it');
  eq(runsOut(AM_PM, TODAY), null, 'same with no opening date');

  const list = shoppingList([r, { ...r, id: 'x', name: 'Cleanser', openedAt: '2026-06-01' }], TODAY);
  eq(list.length, 1, 'only what actually needs replacing is on the list');
  eq(list[0].routine.name, 'Cleanser', 'the one that ran out');
}

// ------------------------------------------------------------------ grouping
{
  const g = byArea([AM_PM, { ...AM_PM, id: 'b', name: 'Shampoo', area: 'hair' }], TODAY);
  eq(g.length, 2, 'routines group by area');
  eq(g[0].key, 'skin', 'in the order the areas are declared, so the page does not reshuffle');
  eq(byArea([{ ...AM_PM, stopped: '2026-09-01' }], TODAY).length, 0, 'a stopped routine is not on the page');
  eq(byArea([]).length, 0, 'and an area with nothing in it is dropped rather than rendered empty');
}

// =========================================================================
// THE LINE
// =========================================================================
{
  const s = summary([AM_PM], log(TODAY, 1), TODAY, 9 * 60);
  eq(s.text, '1 of 2 done, 1 still to come', 'the summary is COUNTS');
  ok(!/%/.test(s.text), 'not a percentage — a percentage invites a target, and a target invites a streak');
  eq(summary([], {}, TODAY, 600).text, 'Nothing scheduled today.', 'an empty day says so plainly');

  // Everything this module can put on a screen, swept for the vocabulary that
  // turns upkeep into a verdict about a person.
  const surface = JSON.stringify([
    AREAS, s, byArea([AM_PM], TODAY), kept(AM_PM, log(TODAY, 2), { from: TODAY, to: TODAY, today: TODAY }),
    runsOut({ ...AM_PM, openedAt: '2026-06-01', lastsDays: 30 }, TODAY),
    shoppingList([{ ...AM_PM, openedAt: '2026-06-01', lastsDays: 30 }], TODAY),
  ]).toLowerCase();
  for (const word of ['glow', 'flawless', 'better skin', 'improve', 'score', 'streak',
                      'ugly', 'clear skin', 'before and after', 'progress photo', 'rating']) {
    ok(!surface.includes(word), `nothing anywhere says "${word}" — this is about routine, never about appearance as a verdict`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
