// Drawing the world on a rotating sphere, fast enough to do it ten times a second.
//
// The naive version — call project() on every one of the ~8,000 coastline and
// border points on every frame — costs four trig calls per point per frame,
// which is 320,000 sin/cos per second while the globe idles. That is a
// noticeable amount of a laptop battery for a background ornament.
//
// So the trig is done ONCE, at load, and never again. For a point at latitude
// φ and longitude λ₀ we store three numbers:
//
//     A₀ = cosφ·sinλ₀     B₀ = cosφ·cosλ₀     S = sinφ
//
// and then rotating the globe by r is pure arithmetic, because
//
//     cosφ·sin(λ₀+r) = A₀·cos r + B₀·sin r
//     cosφ·cos(λ₀+r) = B₀·cos r − A₀·sin r
//
// cos r and sin r are computed once per frame, not once per point. What was
// 320,000 transcendental calls a second becomes about 50,000 multiplications,
// which is nothing.

import { COAST, BORDERS } from '../data/worldmap.js';

/**
 * Turn a flat [lon,lat,lon,lat,…] array into the precomputed triples above.
 * Returns a Float64Array of [A₀,B₀,S, A₀,B₀,S, …].
 */
export function precompute(flat) {
  const n = flat.length / 2;
  const out = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const lon = (flat[i * 2] * Math.PI) / 180;
    const lat = (flat[i * 2 + 1] * Math.PI) / 180;
    const cosLat = Math.cos(lat);
    out[i * 3] = cosLat * Math.sin(lon);      // A₀
    out[i * 3 + 1] = cosLat * Math.cos(lon);  // B₀
    out[i * 3 + 2] = Math.sin(lat);           // S
  }
  return out;
}

// Built lazily and cached — a module-level constant would run this work even
// in a session that never opens the Flights tab.
let _coast = null, _borders = null;
export const coastLines = () => (_coast ||= COAST.map(precompute));
export const borderLines = () => (_borders ||= BORDERS.map(precompute));

/**
 * Project one precomputed line and cut it into drawable SVG path segments.
 *
 * Two separate reasons a run of points ends:
 *   - it goes behind the globe (z < 0), which is back-face culling; and
 *   - it leaves the porthole, which matters enormously when zoomed, because at
 *     24× nearly every point is off-screen and emitting them all would build
 *     megabyte path strings for a few visible pixels.
 */
export function projectLine(pre, { cosR, sinR, cosT, sinT, r, cx, cy, clip }) {
  const n = pre.length / 3;
  const segs = [];
  let cur = null;
  const lim = clip ? clip * 1.6 : Infinity;

  for (let i = 0; i < n; i++) {
    const A = pre[i * 3], B = pre[i * 3 + 1], S = pre[i * 3 + 2];
    const sinL = A * cosR + B * sinR;         // cosφ·sin(λ+r)
    const cosL = B * cosR - A * sinR;         // cosφ·cos(λ+r)
    const z = sinT * S + cosT * cosL;
    if (z < 0) { if (cur && cur.length > 3) segs.push(cur); cur = null; continue; }

    const x = cx + r * sinL;
    const y = cy - r * (cosT * S - sinT * cosL);
    if (Math.abs(x - cx) > lim || Math.abs(y - cy) > lim) {
      if (cur && cur.length > 3) segs.push(cur);
      cur = null;
      continue;
    }
    (cur ||= []).push(x, y);
  }
  if (cur && cur.length > 3) segs.push(cur);
  return segs;
}

/** The per-frame constants, computed once for the whole map rather than per line. */
export function frame({ rotation = 0, tilt = 0, r = 100, cx = 0, cy = 0, clip = null }) {
  const rr = (rotation * Math.PI) / 180;
  const tt = (tilt * Math.PI) / 180;
  return {
    cosR: Math.cos(rr), sinR: Math.sin(rr),
    cosT: Math.cos(tt), sinT: Math.sin(tt),
    r, cx, cy, clip,
  };
}

/** Flat coordinate runs -> an SVG path string. */
export function toPath(segs) {
  let d = '';
  for (const s of segs) {
    d += `M${s[0].toFixed(1)} ${s[1].toFixed(1)}`;
    for (let i = 2; i < s.length; i += 2) d += `L${s[i].toFixed(1)} ${s[i + 1].toFixed(1)}`;
  }
  return d;
}

/**
 * The whole map as two path strings.
 *
 * Two strings rather than 284 <path> elements: the browser does far less work
 * reconciling two nodes than three hundred, and nothing here needs to be
 * addressable individually — it is a backdrop, not a set of targets.
 */
export function mapPaths(opts) {
  const f = frame(opts);
  const coast = [];
  const borders = [];
  for (const line of coastLines()) { const s = projectLine(line, f); if (s.length) coast.push(...s); }
  for (const line of borderLines()) { const s = projectLine(line, f); if (s.length) borders.push(...s); }
  return { coast: toPath(coast), borders: toPath(borders) };
}
