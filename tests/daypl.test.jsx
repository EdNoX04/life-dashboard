// Tests for the TODAY'S P&L scrolling line.
//
// This exists because the defect it guards against is invisible in every way a
// person normally checks work. The bug it was written after — a per-repeat
// offset added where it should have been subtracted — produced a path that
// bundled, rendered, passed the render sweep, and drew a green line at a jaunty
// angle inside the P&L strip. It was simply a zigzag with a 14-unit cliff at
// every seam, which at a 4x horizontal stretch looks like a chart with some
// volatility in it. The animation then slid that cliff across the box once every
// 38 units, and the report you get from a user is "the line looks inconsistent",
// which is exactly the complaint the whole rewrite was for.
//
// The other half is the CSS. The scroll distance lives in arcade.css and the
// path geometry lives in Money.jsx, and nothing links them but a comment. Get
// the sign wrong and the animation still runs, still loops, still looks smooth
// for most of its cycle, and jumps once per period. So the keyframes are read
// off disk and checked against the geometry rather than restated here.
//
// Run: bun tests/daypl.test.jsx
import { readFileSync } from 'fs';
import { dayLinePath, TILE_W, TILE_RISE } from '../src/tabs/Money.jsx';

let pass = 0, fail = 0;
function ok(what, cond, got) {
  if (cond) { pass++; }
  else { fail++; console.log(`FAIL: ${what}${got !== undefined ? `  (got ${got})` : ''}`); }
}

/** "M0 9 L6 13 L12 10" -> [[0,9],[6,13],[12,10]] */
function points(d) {
  return d.replace(/^M/, '').split(' L').map(seg => seg.trim().split(/\s+/).map(Number));
}

const VIEW_W = 152, VIEW_H = 56;   // the viewBox in DayFx

for (const up of [true, false]) {
  const name = up ? 'up' : 'down';
  const d = dayLinePath(up);
  const pts = points(d);

  // ------------------------------------------------------- shape of the path
  // One continuous polyline is not a stylistic preference, it is the fix. A
  // second M would be a pen-up, and a pen-up is a gap — the thing the dash
  // animation was replaced for.
  ok(`${name}: the path is one continuous polyline with a single move-to`,
    (d.match(/M/g) || []).length === 1, (d.match(/M/g) || []).length);
  ok(`${name}: every command after the first is a line-to`,
    /^M[\d.\- ]+( L[\d.\- ]+)+$/.test(d));
  ok(`${name}: no coordinate is NaN`, pts.every(p => p.length === 2 && p.every(Number.isFinite)));

  // ------------------------------------------------------------- the seam
  // The property that makes the loop invisible, stated directly: the path must
  // be its own translate. If P(i+1) - P(i) is not constant across every pair,
  // no single CSS translate can land a repeat on its neighbour's position.
  const per = pts.length >= 14 ? 6 : 0;   // points contributed by one repeat
  ok(`${name}: each repeat contributes ${per} points after the shared seam point`,
    (pts.length - 1) % 6 === 0, pts.length);

  const deltas = [];
  for (let i = 0; i + per < pts.length; i++) {
    deltas.push([pts[i + per][0] - pts[i][0], +(pts[i + per][1] - pts[i][1]).toFixed(3)]);
  }
  ok(`${name}: the horizontal step between repeats is exactly TILE_W everywhere`,
    deltas.every(v => v[0] === TILE_W), JSON.stringify(deltas.find(v => v[0] !== TILE_W)));
  const rise = deltas[0][1];
  ok(`${name}: the vertical step between repeats is the same at every seam`,
    deltas.every(v => v[1] === rise), JSON.stringify(deltas.map(v => v[1])));
  ok(`${name}: and that step is TILE_RISE in magnitude`,
    Math.abs(rise) === TILE_RISE, rise);

  // The slope is easy to get backwards and impossible to spot in the numbers.
  // It is not a free choice: the scroll translates by +one repeat, so the drawn
  // slope IS the direction of travel, and an up series that slopes down would
  // scroll downhill while calling itself a gain.
  ok(`${name}: the drawn path slopes ${up ? 'up' : 'down'} to the right`,
    up ? rise < 0 : rise > 0, rise);

  // No duplicated point at the joins: emitting the shared point twice puts a
  // zero-length segment there, which miter-joins render as a visible pip.
  ok(`${name}: no two consecutive points are identical`,
    pts.every((p, i) => i === 0 || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1]));
  ok(`${name}: x is strictly increasing, so the line never doubles back`,
    pts.every((p, i) => i === 0 || p[0] > pts[i - 1][0]));

  // ------------------------------------------------------------ the framing
  // A seamless drift walks off the canvas if it starts in the wrong place, and
  // the symptom is a line that fades out halfway through the box rather than an
  // error. Only the span the scroll actually reveals has to fit: x from 0 to
  // one tile past the viewBox.
  const visible = pts.filter(p => p[0] >= -1 && p[0] <= VIEW_W + TILE_W + 1);
  ok(`${name}: the scroll reveals at least four repeats' worth of points`,
    visible.length >= 25, visible.length);
  ok(`${name}: every revealed point sits inside the viewBox vertically`,
    visible.every(p => p[1] >= 0 && p[1] <= VIEW_H),
    JSON.stringify(visible.filter(p => p[1] < 0 || p[1] > VIEW_H)));
  // Hand-typed anchors, so the checks above cannot all be satisfied by a path
  // that is self-consistent and in the wrong half of the box.
  const ys = visible.map(p => p[1]);
  ok(`${name}: the revealed span uses most of the box height`,
    Math.max(...ys) - Math.min(...ys) > 30, Math.max(...ys) - Math.min(...ys));
  ok(`${name}: the path starts ${up ? 'low' : 'high'} in the box`,
    up ? pts[0][1] > VIEW_H / 2 : pts[0][1] < VIEW_H / 2, pts[0][1]);
}

// The two variants must be reflections, not two independently tuned drawings.
{
  const u = points(dayLinePath(true)), dn = points(dayLinePath(false));
  ok('up and down have the same number of points', u.length === dn.length);
  ok('up and down share every x coordinate', u.every((p, i) => p[0] === dn[i][0]));
  ok('and their y coordinates mirror about the middle of the viewBox',
    u.every((p, i) => Math.abs(p[1] + dn[i][1] - VIEW_H) < 0.05),
    JSON.stringify(u.map((p, i) => +(p[1] + dn[i][1]).toFixed(1)).filter(v => Math.abs(v - VIEW_H) >= 0.05)));
}

// ------------------------------------------------ the CSS has to agree
// Read rather than restated: a copy of the numbers here would pass forever
// while arcade.css said something else.
{
  const css = readFileSync(new URL('../src/arcade.css', import.meta.url), 'utf8');
  const kf = name => {
    const m = css.match(new RegExp(`@keyframes\\s+${name}\\s*\\{[^}]*translate\\(\\s*(-?[\\d.]+)px\\s*,\\s*(-?[\\d.]+)px`));
    return m ? [Number(m[1]), Number(m[2])] : null;
  };
  const up = kf('dayScrollUp'), down = kf('dayScrollDown');
  ok('arcade.css defines dayScrollUp with a two-axis translate', !!up);
  ok('arcade.css defines dayScrollDown with a two-axis translate', !!down);

  if (up && down) {
    // The scroll must advance by exactly one repeat, so it IS the path's own
    // per-repeat step. Minus that step is equally seamless and equally wrong
    // here - it is the right-to-left version this replaced - so the check is
    // equality with the step, not with its magnitude.
    for (const [name, kfv, isUp] of [['dayScrollUp', up, true], ['dayScrollDown', down, false]]) {
      const p = points(dayLinePath(isUp));
      const step = [p[6][0] - p[0][0], +(p[6][1] - p[0][1]).toFixed(3)];
      ok(`${name} advances horizontally by exactly one repeat`, kfv[0] === step[0], kfv[0]);
      ok(`${name} advances vertically by exactly the path's own drift`,
        kfv[1] === step[1], `${kfv[1]} vs ${step[1]}`);
    }
    // Asked for directly: the line travels left to right. Stated on its own
    // rather than left implicit in the step equality, because it is a product
    // decision and the step equality would hold just as happily for the mirror.
    ok('both variants travel LEFT TO RIGHT', up[0] > 0 && down[0] > 0, `${up[0]} / ${down[0]}`);
    ok('the two keyframes scroll the same direction horizontally', up[0] === down[0]);
    ok('and opposite directions vertically', up[1] === -down[1], `${up[1]} / ${down[1]}`);
    ok('dayScrollUp lifts the line, which is what makes it read as rising',
      up[1] < 0, up[1]);
  }

  // The pause is the other half of what was asked for: motion gated on the
  // market, not on the sign of the number.
  ok('a closed market pauses the scroll rather than removing it',
    /\.daypl-fx\.closed[^{]*\.daypl-scroll[^{]*\{[^}]*animation-play-state:\s*paused/.test(css));
  ok('reduced-motion still gets a static line',
    /@media[^{]*prefers-reduced-motion[^{]*\{[\s\S]{0,300}?\.daypl-scroll[^{]*\{[^}]*animation:\s*none/.test(css));
  ok('nothing references the dash machinery this replaced',
    !/dayDraw|daypl-tip|pathLength/.test(css));
}

console.log(`\n${pass}/${pass + fail} passing`);
if (fail) process.exit(1);
