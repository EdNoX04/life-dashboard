// The spatial bus.
//
// Almost everything in audiobus.js is Web Audio plumbing that only a browser can
// exercise. Two things are not, and both are the kind of thing that is wrong
// silently rather than loudly: the polar-to-Cartesian conversion, and the
// bearing labels the UI shows. A sign error in the first puts "behind you"
// in front of you and nobody notices until they are wearing headphones; a wrong
// label in the second is a lie on screen. So those are pinned here.
//
// The Web Audio API does not exist in node, so the module is imported with the
// globals absent — which also proves it does not touch them at import time.

const bus = await import('../src/lib/audiobus.js');

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log('FAIL ' + n); } };
const eq = (a, b, n) => ok(Object.is(a, b), `${n} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
const near = (a, b, n, tol = 1e-9) => ok(Math.abs(a - b) < tol, `${n} (got ${a}, want ≈${b})`);

// ---------------------------------------------------- the coordinate system
// The listener faces −Z with +X to the right, so:
//   ahead  = (0, 0, −d)
//   right  = (+d, 0, 0)
//   behind = (0, 0, +d)
//   left   = (−d, 0, 0)
{
  const p = bus.polarToXYZ(0, 1);
  near(p.x, 0, 'ahead has no left/right component');
  near(p.z, -1, 'ahead is NEGATIVE z — the listener faces −Z');
  near(p.y, 0, 'and no height');
}
{
  const p = bus.polarToXYZ(90, 1);
  near(p.x, 1, '90° is to the right, +x');
  near(p.z, 0, 'and not ahead or behind', 1e-9);
}
{
  const p = bus.polarToXYZ(180, 1);
  near(p.z, 1, '180° is behind, +z');
  near(p.x, 0, 'and centred', 1e-9);
}
{
  const p = bus.polarToXYZ(270, 1);
  near(p.x, -1, '270° is to the left, −x');
}

// Distance scales the vector.
{
  const p = bus.polarToXYZ(90, 4);
  near(p.x, 4, 'distance scales the position');
}
// A source is never allowed to sit exactly on the listener's head, because an
// inverse distance model divides by that number.
{
  const p = bus.polarToXYZ(90, 0);
  ok(Math.abs(p.x) >= 0.1, 'zero distance is clamped away from the listener');
  const q = bus.polarToXYZ(90, -5);
  ok(Math.abs(q.x) >= 0.1, 'and so is a negative one');
}

// Elevation lifts, and shortens the horizontal component — it is a rotation, not
// an offset, so the source stays on a sphere of the given radius.
{
  const p = bus.polarToXYZ(0, 1, 90);
  near(p.y, 1, '90° elevation is directly overhead');
  near(p.z, 0, 'with no horizontal component left', 1e-9);
  const q = bus.polarToXYZ(90, 1, 30);
  near(Math.hypot(q.x, q.y, q.z), 1, 'an elevated source keeps its distance');
  near(q.y, 0.5, 'sin 30° = 0.5 of the way up');
}

// Garbage in must not produce NaN out — these values reach an AudioParam, and a
// NaN there silences the whole graph with no error anywhere.
{
  for (const bad of [undefined, null, NaN, 'x', {}]) {
    const p = bus.polarToXYZ(bad, bad, bad);
    ok(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z),
       `non-numeric input (${String(bad)}) still yields finite coordinates`);
  }
}

// ---------------------------------------------------- bearings
eq(bus.bearing(0), 'ahead', '0° reads as ahead');
eq(bus.bearing(359), 'ahead', 'and so does just short of a full turn');
eq(bus.bearing(90), 'right', '90° is right');
eq(bus.bearing(180), 'behind', '180° is behind');
eq(bus.bearing(270), 'left', '270° is left');
eq(bus.bearing(45), 'front right', '45° is front right');
eq(bus.bearing(135), 'behind right', '135° is behind right');
eq(bus.bearing(225), 'behind left', '225° is behind left');
eq(bus.bearing(315), 'front left', '315° is front left');
eq(bus.bearing(-90), 'left', 'a negative angle wraps');
eq(bus.bearing(450), 'right', 'and so does one over 360');
eq(bus.bearing('nonsense'), 'ahead', 'and junk does not crash the label');

// ---------------------------------------------------- spread
eq(bus.spread(0, 1), 0, 'a single source sits straight ahead');
{
  const four = [0, 1, 2, 3].map(i => bus.spread(i, 4));
  eq(new Set(four).size, 4, 'four sources get four distinct angles');
  ok(four.every(a => a >= 0 && a < 360), 'all within one turn');
  eq(four[1] - four[0], 90, 'evenly spaced around the head');
}

// ---------------------------------------------------- safety with no browser
ok(bus.context() === null, 'with no AudioContext available, context() returns null rather than throwing');
ok(bus.makePanner(90) === null, 'and makePanner degrades to null');
ok(typeof bus.orbit(null) === 'function', 'orbit on a null panner still returns a stop function');
bus.orbit(null)();   // must not throw
bus.place(null, 90); // must not throw
ok(true, 'place() on a null panner is a no-op rather than a crash');

// Master volume is clamped and readable before any context exists.
bus.setMasterVolume(2);
eq(bus.masterVolume(), 1, 'master volume clamps at 1');
bus.setMasterVolume(-1);
eq(bus.masterVolume(), 0, 'and at 0');
bus.setMasterVolume(0.6);
near(bus.masterVolume(), 0.6, 'and round-trips a normal value');

// Spatial is on by default and toggles.
ok(bus.spatialOn() === true, 'spatial is on by default');
bus.setSpatial(false);
eq(bus.spatialOn(), false, 'and can be turned off');
bus.setSpatial(true);
eq(bus.spatialOn(), true, 'and back on');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
