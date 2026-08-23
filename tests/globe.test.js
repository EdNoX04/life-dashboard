import { test, expect } from 'bun:test';
import { syncedProjection, countries, borders, graticule, isVisible } from '../src/lib/globe.js';
import { project } from '../src/lib/flights.js';
import { WORLD, OBJECT_KEY } from '../src/data/worldmap.js';

// ---- the agreement that matters -------------------------------------------
// The map is drawn by d3 on canvas; aircraft are drawn by project() in SVG on
// top. If those two disagree by even a few pixels, aeroplanes float off the
// coastline. This is the single most important test in the file.

const PLACES = [
  ['Dubai', 25.2532, 55.3657], ['Mumbai', 19.0887, 72.8679],
  ['London', 51.47, -0.4543], ['New York', 40.6413, -73.7781],
  ['Sydney', -33.9399, 151.1753], ['Tokyo', 35.5494, 139.7798],
  ['Equator/Meridian', 0, 0], ['Cape Horn', -55.98, -67.27],
];

test('d3 and project() land on the same pixel', () => {
  for (const rotation of [0, -55, 90, 180, 270, 359]) {
    for (const tilt of [-60, -25, 0, 18, 45]) {
      for (const r of [156, 156 * 6]) {
        const opts = { rotation, tilt, r, cx: 170, cy: 170 };
        const d3p = syncedProjection(opts);
        for (const [, lat, lon] of PLACES) {
          const mine = project(lat, lon, opts);
          const theirs = d3p([lon, lat]);
          if (!mine.front) continue;              // d3 returns null when clipped
          expect(theirs).not.toBe(null);
          expect(Math.abs(theirs[0] - mine.x)).toBeLessThan(0.01);
          expect(Math.abs(theirs[1] - mine.y)).toBeLessThan(0.01);
        }
      }
    }
  }
});

test('the rotate() sign convention is the one that centres the right place', () => {
  // Centring on Dubai must put Dubai in the middle of the disc. Flipping
  // either sign in rotate([rotation, -tilt]) still produces a plausible-looking
  // globe, which is exactly why this needs asserting rather than eyeballing.
  const opts = { rotation: -55.3657, tilt: 25.2532, r: 156, cx: 170, cy: 170 };
  const [x, y] = syncedProjection(opts)([55.3657, 25.2532]);
  expect(Math.abs(x - 170)).toBeLessThan(0.01);
  expect(Math.abs(y - 170)).toBeLessThan(0.01);
});

test('d3 point projection does NOT clip — only geoPath does', () => {
  // A trap worth pinning down. Calling projection([lon,lat]) on an orthographic
  // with clipAngle(90) returns a coordinate for points on the FAR side of the
  // globe, mirrored onto the near side, rather than null. Only geoPath applies
  // the clip. So the SVG overlay must cull with our own isVisible/project():
  // trusting d3's point function would draw far-side aircraft on top of the
  // near-side map, which looks almost plausible and is completely wrong.
  const opts = { rotation: 0, tilt: 0, r: 156, cx: 170, cy: 170 };
  const d3p = syncedProjection(opts);
  const antipode = d3p([-180, 0]);
  expect(antipode).not.toBe(null);              // it hands back a point...
  expect(project(0, -180, opts).front).toBe(false);   // ...for a hidden place
  expect(isVisible(0, -180, opts)).toBe(false);
});

test('geoPath DOES clip the far side away', () => {
  const { geoPath } = require('d3-geo');
  const opts = { rotation: 0, tilt: 0, r: 156, cx: 170, cy: 170 };
  const path = geoPath(syncedProjection(opts), null);
  // a small polygon on the far side must produce no drawing at all
  const farSide = { type: 'Polygon', coordinates: [[[178, 1], [-178, 1], [-178, -1], [178, -1], [178, 1]]] };
  expect(path(farSide) || '').toBe('');
  // ...and one on the near side must produce some
  const nearSide = { type: 'Polygon', coordinates: [[[-2, 1], [2, 1], [2, -1], [-2, -1], [-2, 1]]] };
  expect((path(nearSide) || '').length).toBeGreaterThan(10);
});

test('isVisible agrees with project().front', () => {
  for (const opts of [{ rotation: 0, tilt: 0 }, { rotation: -55, tilt: 25 }, { rotation: 200, tilt: -40 }]) {
    for (const [, lat, lon] of PLACES) {
      expect(isVisible(lat, lon, opts)).toBe(project(lat, lon, { ...opts, r: 100, cx: 0, cy: 0 }).front);
    }
  }
});

// ---- the data --------------------------------------------------------------

test('every country survived simplification', () => {
  // Simplifying harder is tempting for speed, but it starts deleting small
  // island states. "Your country vanished" is a worse defect than a coarse
  // coastline, so the weight is tuned to keep all of them.
  expect(countries().length).toBe(177);
});

test('the topology is a real TopoJSON with shared arcs', () => {
  expect(WORLD.type).toBe('Topology');
  expect(WORLD.objects[OBJECT_KEY]).toBeTruthy();
  expect(Array.isArray(WORLD.arcs)).toBe(true);
  expect(WORLD.arcs.length).toBeGreaterThan(100);
});

test('every country is a valid polygon with real coordinates', () => {
  countries().forEach(f => {
    expect(['Polygon', 'MultiPolygon']).toContain(f.geometry.type);
    const rings = f.geometry.type === 'Polygon' ? f.geometry.coordinates : f.geometry.coordinates.flat();
    rings.forEach(ring => {
      expect(ring.length).toBeGreaterThanOrEqual(4);
      ring.forEach(([lon, lat]) => {
        expect(Number.isFinite(lon)).toBe(true);
        expect(Number.isFinite(lat)).toBe(true);
        expect(Math.abs(lon)).toBeLessThanOrEqual(180.5);
        expect(Math.abs(lat)).toBeLessThanOrEqual(90.5);
      });
    });
  });
});

test('borders and graticule build without throwing', () => {
  expect(borders().type).toBe('MultiLineString');
  expect(borders().coordinates.length).toBeGreaterThan(50);
  expect(graticule().type).toBe('MultiLineString');
});

test('recognisable geography is where it should be', () => {
  // A scrambled or wrongly-projected map would still pass every structural
  // check above. This checks the map actually depicts the world: find the
  // country whose polygon contains Dubai's coordinates.
  const { geoContains } = require('d3-geo');
  const hit = countries().filter(f => geoContains(f, [55.3657, 25.2532]));
  expect(hit.length).toBe(1);
  const india = countries().filter(f => geoContains(f, [77.1, 28.5562]));
  expect(india.length).toBe(1);
  // and they are different countries
  expect(hit[0].id).not.toBe(india[0].id);
});
