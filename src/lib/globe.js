// The world, drawn on a sphere.
//
// Two layers, on purpose:
//
//   CANVAS  the map itself — sea, 177 filled countries, borders, coastline.
//           Canvas because this is the expensive part and it is not
//           interactive. Measured: as SVG it cost 16ms and ~90KB of path
//           string per frame, which React then had to reconcile; on canvas,
//           with per-country fills, it is 4.7ms and produces no DOM at all.
//           (Per-country fill is FASTER than one combined land path — each
//           path is smaller, and the fill rasteriser likes small paths.)
//
//   SVG     aircraft, route arc, airports, labels. Small, changes often,
//           needs hit-testing and hover. Exactly what SVG is good at.
//
// The two layers must agree to the pixel or the aeroplanes float off the
// coast. `syncedProjection` is the single source of truth for that, and
// tests/globe.test.js asserts d3's projection and our own project() land on
// the same pixel across a sweep of rotations, tilts and zooms.

import { geoOrthographic, geoPath, geoGraticule10 } from 'd3-geo';
import { feature, mesh } from 'topojson-client';
import { WORLD, OBJECT_KEY } from '../data/worldmap.js';

// Built once, lazily — a module-level constant would do this work even in a
// session that never opens the Flights tab.
let _land = null, _borders = null, _grat = null;
export const countries = () => (_land ||= feature(WORLD, WORLD.objects[OBJECT_KEY]).features);
export const borders = () => (_borders ||= mesh(WORLD, WORLD.objects[OBJECT_KEY], (a, b) => a !== b));
export const graticule = () => (_grat ||= geoGraticule10());

/**
 * A d3 orthographic projection matching our own `project()` exactly.
 *
 * The mapping is the fiddly bit. Our project() adds `rotation` to the
 * longitude and tilts by `tilt`, so the point at the centre of the disc is
 * (lon = -rotation, lat = tilt). d3's rotate() takes the NEGATED centre, so it
 * needs [rotation, -tilt] — not [rotation, tilt], and not [-rotation, tilt].
 * Getting this wrong puts the map and the aircraft on different globes, which
 * looks almost right and is completely wrong.
 */
export function syncedProjection({ rotation = 0, tilt = 0, r = 100, cx = 0, cy = 0 }) {
  return geoOrthographic()
    .rotate([rotation, -tilt])
    .scale(r)
    .translate([cx, cy])
    .clipAngle(90);
}

// A fixed palette of country tints. Countries are coloured by index rather
// than by any property of the country itself: this is decoration that makes
// borders legible, not a choropleth, and colouring by (say) population would
// imply a meaning the map does not carry.
const TINTS = [
  'rgba(0,229,255,0.10)',
  'rgba(49,214,122,0.11)',
  'rgba(124,77,255,0.13)',
  'rgba(255,61,127,0.08)',
  'rgba(255,210,63,0.08)',
];

/**
 * Paint the base map. Everything here is pure drawing — no state, no React.
 *
 * `dpr` handles retina: the canvas backing store is scaled up and the context
 * scaled down, or the whole map renders at half resolution on a MacBook and
 * looks soft next to the crisp SVG above it.
 */
export function drawGlobe(ctx, opts) {
  const { r, cx, cy, clip, dpr = 1, showGraticule = true, zoom = 1 } = opts;
  const proj = syncedProjection(opts);
  const path = geoPath(proj, ctx);

  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, (clip * 2 + cx) / dpr + 1000, (clip * 2 + cy) / dpr + 1000);

  // The porthole. Everything is drawn inside it, so a zoomed globe spills no
  // land outside the circle.
  ctx.beginPath();
  ctx.arc(cx, cy, clip, 0, Math.PI * 2);
  ctx.clip();

  // sea
  const sea = ctx.createRadialGradient(cx - clip * 0.3, cy - clip * 0.35, clip * 0.1, cx, cy, clip);
  sea.addColorStop(0, 'rgba(0,110,150,0.34)');
  sea.addColorStop(0.65, 'rgba(10,40,90,0.22)');
  sea.addColorStop(1, 'rgba(4,10,26,0.32)');
  ctx.fillStyle = sea;
  ctx.beginPath();
  ctx.arc(cx, cy, clip, 0, Math.PI * 2);
  ctx.fill();

  if (showGraticule) {
    ctx.beginPath();
    path(graticule());
    ctx.strokeStyle = 'rgba(0,229,255,0.10)';
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }

  // countries, each filled separately so the borders read
  const list = countries();
  for (let i = 0; i < list.length; i++) {
    ctx.beginPath();
    path(list[i]);
    ctx.fillStyle = TINTS[i % TINTS.length];
    ctx.fill();
  }

  // internal borders, quieter than the coast
  ctx.beginPath();
  path(borders());
  ctx.strokeStyle = 'rgba(124,77,255,0.55)';
  ctx.lineWidth = zoom >= 6 ? 0.7 : 0.5;
  ctx.stroke();

  // the coastline, brightest line on the map — it is the silhouette that makes
  // the shape of the world readable at a glance
  ctx.beginPath();
  for (const f of list) path(f);
  ctx.strokeStyle = 'rgba(49,214,122,0.85)';
  ctx.lineWidth = zoom >= 6 ? 1.0 : 0.75;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // scanlines, so the map belongs to the same CRT as everything else
  ctx.globalAlpha = 0.30;
  ctx.fillStyle = '#000';
  for (let y = cy - clip; y < cy + clip; y += 3) ctx.fillRect(cx - clip, y, clip * 2, 1);
  ctx.globalAlpha = 1;

  ctx.restore();
}

/** Is a lat/lon on the visible hemisphere? Used to cull SVG overlay items. */
export function isVisible(lat, lon, { rotation = 0, tilt = 0 }) {
  const rad = Math.PI / 180;
  const p = lat * rad, l = (lon + rotation) * rad, t = tilt * rad;
  return Math.sin(t) * Math.sin(p) + Math.cos(t) * Math.cos(p) * Math.cos(l) >= 0;
}
