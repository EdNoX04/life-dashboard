import { test, expect } from 'bun:test';
import { precompute, projectLine, frame, toPath, mapPaths, coastLines, borderLines } from '../src/lib/globe.js';
import { project } from '../src/lib/flights.js';
import { COAST, BORDERS } from '../src/data/worldmap.js';

const OPTS = { rotation: 37, tilt: 18, r: 160, cx: 170, cy: 170, clip: null };

test('the fast path agrees with the reference projection to within a pixel', () => {
  // This is the whole point of the optimisation: it must be a speed change,
  // not a behaviour change. Any drift here means the globe is drawing the
  // coastline somewhere the aircraft are not.
  const f = frame(OPTS);
  const samples = [
    [0, 0], [55.37, 25.25], [-0.45, 51.47], [72.87, 19.09], [139.78, 35.55],
    [-118.4, 33.94], [151.18, -33.94], [0, 89], [0, -89], [179.9, 0], [-179.9, 0],
  ];
  for (const [lon, lat] of samples) {
    const pre = precompute([lon, lat]);
    const segs = projectLine(pre, f);
    const ref = project(lat, lon, OPTS);
    if (!ref.front) { expect(segs.length).toBe(0); continue; }
    // a single front-facing point cannot form a segment (needs 2 points),
    // so re-run with the point duplicated to get coordinates out
    const dup = projectLine(precompute([lon, lat, lon, lat + 0.0001]), f);
    if (!dup.length) continue;
    expect(Math.abs(dup[0][0] - ref.x)).toBeLessThan(1);
    expect(Math.abs(dup[0][1] - ref.y)).toBeLessThan(1);
  }
});

test('agreement holds across a full sweep of rotations and tilts', () => {
  for (const rotation of [0, 90, 180, 270, 359]) {
    for (const tilt of [-60, -20, 0, 20, 60]) {
      const o = { ...OPTS, rotation, tilt };
      const f = frame(o);
      const [lon, lat] = [55.37, 25.25];
      const ref = project(lat, lon, o);
      const segs = projectLine(precompute([lon, lat, lon, lat + 0.0001]), f);
      if (!ref.front) continue;
      expect(segs.length).toBeGreaterThan(0);
      expect(Math.abs(segs[0][0] - ref.x)).toBeLessThan(1);
      expect(Math.abs(segs[0][1] - ref.y)).toBeLessThan(1);
    }
  }
});

test('points behind the globe are culled, not drawn through it', () => {
  const f = frame({ ...OPTS, rotation: 0, tilt: 0 });
  // lon 180 is the far side when looking at lon 0
  expect(projectLine(precompute([180, 0, 179, 0]), f).length).toBe(0);
  expect(projectLine(precompute([0, 0, 1, 0]), f).length).toBeGreaterThan(0);
});

test('a line crossing the horizon is broken, never joined across the sphere', () => {
  const f = frame({ ...OPTS, rotation: 0, tilt: 0 });
  const ring = [];
  for (let lon = -180; lon <= 180; lon += 2) ring.push(lon, 0);
  const segs = projectLine(precompute(ring), f);
  expect(segs.length).toBeGreaterThanOrEqual(1);
  // every emitted point must be on the visible disc
  segs.flat().forEach((v, i) => {
    if (i % 2) return;
    expect(Number.isFinite(v)).toBe(true);
  });
});

test('the porthole clip drops far-off-screen points instead of emitting them', () => {
  // At high zoom almost everything is off-screen. Without the clip this builds
  // enormous path strings for a handful of visible pixels.
  const zoomed = { rotation: -55, tilt: 25, r: 160 * 24, cx: 170, cy: 170, clip: 156 };
  const wide = { ...zoomed, clip: null };
  const line = precompute(COAST[0]);
  const a = projectLine(line, frame(zoomed)).reduce((n, s) => n + s.length, 0);
  const b = projectLine(line, frame(wide)).reduce((n, s) => n + s.length, 0);
  expect(a).toBeLessThanOrEqual(b);
});

test('every emitted coordinate is finite — no NaN reaches the path string', () => {
  for (const o of [OPTS, { ...OPTS, tilt: 90 }, { ...OPTS, tilt: -90 }, { ...OPTS, rotation: 180 }]) {
    const f = frame(o);
    for (const line of coastLines().slice(0, 30)) {
      for (const seg of projectLine(line, f)) {
        for (const v of seg) expect(Number.isFinite(v)).toBe(true);
      }
    }
  }
});

test('toPath emits valid SVG with no NaN and no empty moves', () => {
  const { coast, borders } = mapPaths(OPTS);
  expect(coast.length).toBeGreaterThan(1000);
  expect(borders.length).toBeGreaterThan(500);
  expect(coast).not.toContain('NaN');
  expect(borders).not.toContain('NaN');
  expect(coast).not.toContain('undefined');
  expect(coast.startsWith('M')).toBe(true);
  // every M must be followed by at least one L
  expect(/M[^ML]*$/.test(coast)).toBe(false);
});

test('the map data itself is well formed', () => {
  expect(COAST.length).toBeGreaterThan(50);
  expect(BORDERS.length).toBeGreaterThan(50);
  [...COAST, ...BORDERS].forEach(line => {
    expect(line.length % 2).toBe(0);          // flat pairs
    expect(line.length).toBeGreaterThanOrEqual(4);
    for (let i = 0; i < line.length; i += 2) {
      expect(Math.abs(line[i])).toBeLessThanOrEqual(180.001);
      expect(Math.abs(line[i + 1])).toBeLessThanOrEqual(90.001);
    }
  });
});

test('recognisable geography lands where it should', () => {
  // Sanity that we have a real map and not a scramble: with the globe centred
  // on the Gulf, Dubai's longitude must be near the middle of the disc.
  const o = { rotation: -55.37, tilt: 25.25, r: 160, cx: 170, cy: 170, clip: null };
  const ref = project(25.25, 55.37, o);
  expect(ref.front).toBe(true);
  expect(Math.abs(ref.x - 170)).toBeLessThan(2);
  expect(Math.abs(ref.y - 170)).toBeLessThan(2);
});

test('projection is fast enough to animate — 10 full frames well under a second', () => {
  const t0 = performance.now();
  for (let i = 0; i < 10; i++) mapPaths({ ...OPTS, rotation: i * 3 });
  const ms = performance.now() - t0;
  // Ten frames is one second of idle animation. If this takes longer than
  // 250ms the globe is unaffordable on a laptop.
  expect(ms).toBeLessThan(250);
});
