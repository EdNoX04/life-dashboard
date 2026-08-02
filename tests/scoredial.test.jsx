// Tests for ScoreDial — the segmented arc gauge on the Health tab.
//
// Run: bun tests/scoredial.test.jsx
//
// A gauge is a component you check by looking at it, which is exactly why it
// needs a test: looking at it tells you it drew SOMETHING, and every failure
// mode here draws something. The three that matter, in order of how badly they
// mislead:
//
//   1. NO DATA MUST NOT DRAW AS ZERO. A day the watch spent on the charger has
//      no recovery score. An empty arc with "0 · DRAINED" under it is a claim
//      about Neel's body manufactured out of an absence of evidence, and it is
//      indistinguishable at a glance from a real terrible morning. The dial has
//      to say it does not know.
//
//   2. THE LIT COUNT MUST TRACK THE VALUE. The number in the middle and the arc
//      around it are two renderings of one fact, and if they drift apart the
//      arc is the one people trust, because it is the bigger shape. A dial whose
//      arc says half and whose text says 90 is worse than either alone.
//
//   3. THE INVERT MARKER MUST APPEAR ON STRESS AND NOWHERE ELSE. Colour cannot
//      carry it: red-is-bad on recovery and red-is-bad on stress happen to agree,
//      but a *green* stress arc and a *green* recovery arc mean opposite things
//      about what you should do next, and roughly one man in twelve cannot tell
//      those two arcs apart by colour at all.
//
// Rendering is server-side static markup, so `useEffect` never runs — which is
// fine, because this component deliberately has none.

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ScoreDial from '../src/components/ScoreDial.jsx';
import { SCORES, bandFor } from '../src/lib/healthscores.js';

let pass = 0, fail = 0;
function ok(what, cond, got) {
  if (cond) { pass++; }
  else { fail++; console.log(`FAIL: ${what}${got !== undefined ? `  (got ${got})` : ''}`); }
}

const html = (props) => renderToStaticMarkup(React.createElement(ScoreDial, props));

// The lit blocks are the paths whose fill is not the dark track colour. Counting
// them by what they are NOT means a change to the lit colour cannot silently
// make this counter return zero and pass everything.
const litCount = (s) => (s.match(/<path /g) || [])
  .filter(() => true).length && (s.split('<path ').slice(1)
    .filter(p => !p.includes('fill="var(--panel-2)"')).length);

const pathCount = (s) => (s.match(/<path /g) || []).length;

// ------------------------------------------------------- 1. absent vs zero
{
  const none = html({ scoreKey: 'recovery_score', value: null });
  const zero = html({ scoreKey: 'recovery_score', value: 0 });

  ok('a missing score says NO DATA', none.includes('NO DATA'), none.slice(0, 0));
  ok('a missing score does not print a number in the middle', none.includes('––') && !/>0</.test(none));
  ok('a missing score lights no blocks', litCount(none) === 0, litCount(none));

  // The pair is the point. Both draw an empty arc; only one of them is entitled
  // to say anything about the person.
  ok('a real zero says DRAINED, not NO DATA', zero.includes('DRAINED') && !zero.includes('NO DATA'));
  ok('a real zero also lights no blocks — so the ARC alone cannot distinguish them',
    litCount(zero) === 0, litCount(zero));
  ok('…which is precisely why the two differ in TEXT', none !== zero);

  // An undefined value and a non-numeric one are the same case as null. This is
  // not padding: `dayVal()` returns null, a missing key returns undefined, and a
  // Supabase row that stored '' would coerce to 0 under a lazier check.
  ok('undefined is treated as absent', html({ scoreKey: 'recovery_score', value: undefined }).includes('NO DATA'));
  ok('an empty string is treated as absent, not as zero',
    html({ scoreKey: 'recovery_score', value: '' }).includes('NO DATA'));
  ok('NaN is treated as absent', html({ scoreKey: 'recovery_score', value: NaN }).includes('NO DATA'));
}

// ------------------------------------------------------ 2. arc tracks value
{
  // Twenty blocks, so each is five points. Hand-computed rather than derived
  // from SEGMENTS, so changing the segment count fails here loudly instead of
  // quietly re-deriving the expected answer to match.
  const cases = [
    [100, 20], [95, 19], [50, 10], [25, 5], [5, 1], [2, 0],
  ];
  for (const [v, expect] of cases) {
    ok(`${v} lights ${expect} of 20 blocks`, litCount(html({ scoreKey: 'sleep_score', value: v })) === expect,
      litCount(html({ scoreKey: 'sleep_score', value: v })));
  }

  ok('the track is always drawn in full — 20 blocks regardless of the reading',
    pathCount(html({ scoreKey: 'sleep_score', value: 30 })) === 20,
    pathCount(html({ scoreKey: 'sleep_score', value: 30 })));

  // Over-range. The arc has nowhere further to go, but the measurement is real
  // and hiding it would make a genuinely exceptional day look like an ordinary
  // maximum. Strain can exceed 100 on a long ride.
  const over = html({ scoreKey: 'strain', value: 118 });
  ok('a reading above the maximum still prints the reading', over.includes('>118<'), over.includes('>118<'));
  ok('a reading above the maximum clamps the arc rather than overflowing it',
    litCount(over) === 20, litCount(over));

  // Negative should not produce negative geometry. Nothing writes one today,
  // which is the reason to pin it: the day something does, the failure would be
  // an arc drawn backwards round the dial rather than an error.
  const neg = html({ scoreKey: 'strain', value: -30 });
  ok('a negative reading lights nothing rather than drawing backwards', litCount(neg) === 0, litCount(neg));
  ok('and still draws the full track', pathCount(neg) === 20, pathCount(neg));
}

// ---------------------------------------------------------- 3. the invert
{
  const stress = html({ scoreKey: 'stress_avg', value: 20 });
  ok('stress carries the lower-is-better marker', stress.includes('better'));

  for (const s of SCORES.filter(x => !x.invert)) {
    ok(`${s.key} does not carry it`, !html({ scoreKey: s.key, value: 50 }).includes('better'));
  }

  // Exactly one score is inverted today. If a second one is added the marker
  // logic still holds, but this assertion is here so that adding one is a
  // deliberate act with a visible consequence rather than a silent change.
  ok('exactly one score is inverted', SCORES.filter(s => s.invert).length === 1,
    SCORES.filter(s => s.invert).length);

  // The scale is NOT reversed for the inverted score — the arc fills clockwise
  // from the same origin. A dial that filled backwards for one tile in a row of
  // five would be misread every time, and the meaning is carried by the band
  // colour and the marker instead.
  ok('an inverted score fills the same direction as the others',
    litCount(html({ scoreKey: 'stress_avg', value: 25 })) === litCount(html({ scoreKey: 'sleep_score', value: 25 })));
}

// ------------------------------------------------------- band colour wiring
{
  // The dial must use the band's colour, not the score's own accent — those
  // differ for every score and the accent is the one that is constant, so a
  // wiring mistake here yields a dial that never changes colour no matter how
  // bad the reading, which looks completely normal until you need the warning.
  const prime = html({ scoreKey: 'recovery_score', value: 90 });
  const drained = html({ scoreKey: 'recovery_score', value: 10 });
  ok('a prime recovery draws in the PRIME band colour', prime.includes(bandFor('recovery_score', 90).color));
  ok('a drained recovery draws in the DRAINED band colour', drained.includes(bandFor('recovery_score', 10).color));
  ok('the two are not the same colour', bandFor('recovery_score', 90).color !== bandFor('recovery_score', 10).color);
  ok('the band word is printed too, not left to colour alone',
    prime.includes('PRIME') && drained.includes('DRAINED'));
}

// ------------------------------------------------------------ housekeeping
{
  ok('an unknown score key renders nothing rather than throwing',
    html({ scoreKey: 'not_a_score', value: 50 }) === '');
  ok('every score in SCORES renders', SCORES.every(s => html({ scoreKey: s.key, value: 60 }).length > 0));
  ok('the label is drawn for each', SCORES.every(s => html({ scoreKey: s.key, value: 60 }).includes(s.label)));

  // Geometry sanity: no NaN can reach the path data. A single NaN in a `d`
  // attribute makes the whole path vanish silently in every browser.
  for (const v of [null, 0, 37.5, 100, 1e9]) {
    ok(`no NaN in the geometry at value ${v}`, !html({ scoreKey: 'sleep_score', value: v }).includes('NaN'));
  }

  const sized = html({ scoreKey: 'sleep_score', value: 50, size: 200 });
  ok('the size prop drives the svg box', sized.includes('width="200"') && sized.includes('viewBox="0 0 200 200"'));

  const sub = html({ scoreKey: 'sleep_score', value: 50, sub: 'Sleep' });
  ok('the sub caption renders when given', sub.includes('Sleep'));
  ok('and is absent when not', !html({ scoreKey: 'sleep_score', value: 50 }).includes('dial-sub'));
}

console.log(`\n${pass}/${pass + fail} passing`);
if (fail) process.exit(1);
