import React, { useEffect, useMemo, useRef, useState } from 'react';
import { project, greatCircle, splitAtHorizon, positioned, AIRPORTS, compass, fmtAlt } from '../../lib/flights.js';
import { mapPaths } from '../../lib/globe.js';

// A CRT radar globe with real geography on it.
//
// Coastlines and country borders are Natural Earth 110m data (public domain,
// via world-atlas), drawn as glowing vector strokes rather than filled
// landmasses. That is a deliberate choice on two grounds. It is what a 1980s
// vector display actually looked like, which is the whole visual language of
// this app; and it is six times cheaper — I measured d3-geo's filled-polygon
// path at 13.3ms and a 112KB path string per frame against 2.2ms and 61KB for
// this, which for something that idles at ten frames a second is the
// difference between free and noticeable.
//
// Three things make it read as a sphere: back-face culling, the meridians
// bunching toward the limb out of the projection itself, and aircraft dimming
// with their z-depth.

const ZOOM_MIN = 1;
const ZOOM_MAX = 24;

export default function FlightGlobe({
  aircraft = [], selected = null, route = null, onPick, size = 340, spin = true,
}) {
  const [rot, setRot] = useState(-55);
  const [tilt, setTilt] = useState(18);
  const [zoom, setZoom] = useState(1);
  const [drag, setDrag] = useState(false);
  const [hover, setHover] = useState(null);
  const grab = useRef(null);

  const C = size / 2;
  const RCLIP = size / 2 - 14;              // the porthole never changes size
  // Zoom magnifies the SPHERE, not the viewport: the drawing radius grows while
  // the clip circle stays put, so you look at a smaller cap of the globe
  // through the same window. Without it, every aircraft over one city is a
  // three-pixel clump.
  const R = RCLIP * zoom;
  const opts = useMemo(() => ({ rotation: rot, tilt, r: R, cx: C, cy: C }), [rot, tilt, R, C]);

  useEffect(() => {
    if (!spin || drag || selected) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return;
    let id;
    const tick = () => {
      if (!document.hidden) setRot(r => (r + 0.25) % 360);
      id = setTimeout(tick, 100);
    };
    id = setTimeout(tick, 100);
    return () => clearTimeout(id);
  }, [spin, drag, selected]);

  useEffect(() => {
    if (selected?.lon == null) return;
    setRot(-selected.lon);
    setTilt(Math.max(-60, Math.min(60, selected.lat ?? 0)));
    setZoom(z => (z < 4 ? 6 : z));
  }, [selected?.hex, selected?.lon, selected?.lat]);

  function down(e) {
    grab.current = { x: e.clientX, y: e.clientY, rot, tilt };
    setDrag(true);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function move(e) {
    if (!grab.current) return;
    const dx = e.clientX - grab.current.x;
    const dy = e.clientY - grab.current.y;
    // Sensitivity falls with zoom so one pixel of travel is always about one
    // pixel of surface — otherwise a 20× view flies off the map from a twitch.
    setRot((grab.current.rot + dx * (0.4 / zoom) + 360) % 360);
    setTilt(Math.max(-80, Math.min(80, grab.current.tilt + dy * (0.3 / zoom))));
  }
  function wheel(e) {
    e.preventDefault();
    setZoom(z => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z * (e.deltaY < 0 ? 1.18 : 1 / 1.18))));
  }
  function up(e) {
    grab.current = null;
    setDrag(false);
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  }

  // ---- the world ----
  const world = useMemo(
    () => mapPaths({ rotation: rot, tilt, r: R, cx: C, cy: C, clip: RCLIP }),
    [rot, tilt, R, C, RCLIP],
  );

  // A light graticule behind the land — enough to read rotation and scale,
  // not so much that it competes with the coastlines for attention.
  const grid = useMemo(() => {
    const step = zoom >= 12 ? 5 : zoom >= 6 ? 10 : zoom >= 2.5 ? 15 : 30;
    const fine = Math.max(1, step / 4);
    const lines = [];
    for (let lat = -60; lat <= 60; lat += step) {
      const pts = [];
      for (let lon = -180; lon <= 180; lon += fine) pts.push({ lat, lon });
      splitAtHorizon(pts, opts).forEach(seg => lines.push(seg));
    }
    for (let lon = -180; lon < 180; lon += step) {
      const pts = [];
      for (let lat = -85; lat <= 85; lat += fine) pts.push({ lat, lon });
      splitAtHorizon(pts, opts).forEach(seg => lines.push(seg));
    }
    return lines;
  }, [opts, zoom]);

  const routeSegs = useMemo(() => {
    if (!route?.from || !route?.to) return [];
    return splitAtHorizon(greatCircle(route.from, route.to, 160), opts);
  }, [route, opts]);

  const ports = useMemo(() => {
    const keep = route ? [route.from, route.to].filter(Boolean) : Object.values(AIRPORTS);
    return keep.map(a => ({ ...a, p: project(a.lat, a.lon, opts) })).filter(a => a.p.front);
  }, [route, opts]);

  const marks = useMemo(() => positioned(aircraft)
    .map(a => ({ a, p: project(a.lat, a.lon, opts) }))
    .filter(m => m.p.front), [aircraft, opts]);

  // Labelling everything turned into unreadable mush over Dubai, where twenty
  // aircraft sit inside a few hundred pixels. A greedy pass keeps a mark only
  // if nothing already kept is within LABEL_GAP of it, so the survivors are
  // spread out rather than being the first twelve in the list.
  const labelled = useMemo(() => {
    if (zoom < 4) return new Set(selected ? [selected.hex] : []);
    const GAP = 46;
    const kept = [];
    const order = [...marks].sort((m, n) => {
      if (selected && m.a.hex === selected.hex) return -1;
      if (selected && n.a.hex === selected.hex) return 1;
      return (n.a.altFt ?? -1) - (m.a.altFt ?? -1);
    });
    for (const m of order) {
      if (kept.length >= 12) break;
      if (kept.some(k => Math.hypot(k.p.x - m.p.x, k.p.y - m.p.y) < GAP)) continue;
      kept.push(m);
    }
    return new Set(kept.map(k => k.a.hex));
  }, [marks, zoom, selected]);

  const path = seg => seg.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');

  return (
    <div className="fg-wrap">
      <svg
        className={`fg-globe${drag ? ' fg-drag' : ''}`}
        width={size} height={size} viewBox={`0 0 ${size} ${size}`}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        onWheel={wheel}
        role="img"
        aria-label={`Globe showing ${marks.length} aircraft. Drag to rotate, scroll to zoom. The same aircraft are listed beside it.`}
      >
        <defs>
          <radialGradient id="fg-sea" cx="36%" cy="30%">
            <stop offset="0%" stopColor="rgba(0,110,150,0.30)" />
            <stop offset="62%" stopColor="rgba(10,40,90,0.20)" />
            <stop offset="100%" stopColor="rgba(4,10,26,0.28)" />
          </radialGradient>
          <pattern id="fg-scan" width="3" height="3" patternUnits="userSpaceOnUse">
            <rect width="3" height="1" fill="rgba(0,0,0,0.34)" />
          </pattern>
          <clipPath id="fg-clip"><circle cx={C} cy={C} r={RCLIP} /></clipPath>
          <filter id="fg-glow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="2.2" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        <circle cx={C} cy={C} r={RCLIP} fill="url(#fg-sea)" />

        <g clipPath="url(#fg-clip)">
          {/* graticule, quietest layer */}
          {grid.map((seg, i) => (
            <path key={i} d={path(seg)} fill="none"
              stroke="rgba(0,229,255,0.13)" strokeWidth="0.5" />
          ))}

          {/* Landmass. Two passes over the same coastline: a wide, soft, very
              low-alpha stroke that reads as the bulk of the land, then a crisp
              bright one for the actual edge. Cheaper than filling polygons —
              which on a sphere needs horizon clipping — and it glows, which
              filled land does not. */}
          <path d={world.coast} fill="none" stroke="rgba(49,214,122,0.16)"
            strokeWidth={Math.min(9, 3.5 * Math.sqrt(zoom))} strokeLinejoin="round" strokeLinecap="round" />
          <path d={world.borders} fill="none" stroke="rgba(124,77,255,0.42)"
            strokeWidth="0.6" strokeLinejoin="round" />
          <path d={world.coast} fill="none" stroke="rgba(49,214,122,0.85)"
            strokeWidth={zoom >= 6 ? 1.1 : 0.8} strokeLinejoin="round" strokeLinecap="round" />

          {routeSegs.map((seg, i) => (
            <path key={`r${i}`} d={path(seg)} fill="none" stroke="var(--pink)"
              strokeWidth="1.6" strokeDasharray="5 4" opacity="0.9" filter="url(#fg-glow)" />
          ))}

          {ports.map(a => (
            <g key={a.name} opacity={route ? 1 : 0.6}>
              <circle cx={a.p.x} cy={a.p.y} r={route ? 3 : 1.6} fill="var(--yellow)" />
              {(route || zoom >= 3) && (
                <text x={a.p.x + 6} y={a.p.y + 3} fontSize="8" fill="var(--yellow)"
                  stroke="var(--bg)" strokeWidth="2.4"
                  style={{ letterSpacing: '.08em', paintOrder: 'stroke' }}>{a.city}</text>
              )}
            </g>
          ))}

          {marks.map(({ a, p }) => {
            const isSel = selected && a.hex === selected.hex;
            const c = a.emergency ? 'var(--red)' : a.military ? 'var(--purple)'
              : isSel ? 'var(--pink)' : a.onGround ? 'var(--ink-3)' : 'var(--cyan)';
            const op = a.onGround ? 0.5 : 0.6 + 0.4 * Math.max(0, p.z);
            const gl = zoom >= 6 ? 1.4 : 1;
            return (
              <g key={a.hex} opacity={op}
                onPointerEnter={() => setHover(a)}
                onPointerLeave={() => setHover(h => (h?.hex === a.hex ? null : h))}
                onClick={() => onPick?.(a)}
                style={{ cursor: onPick ? 'pointer' : 'default' }}>
                {isSel && <circle cx={p.x} cy={p.y} r="10" fill="none" stroke="var(--pink)"
                  strokeWidth="1" opacity="0.9" className="fg-ping" />}
                <path
                  d="M0,-5 L3.4,4.5 L0,2.4 L-3.4,4.5 Z"
                  transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)}) rotate(${(a.trackDeg ?? 0).toFixed(0)}) scale(${gl})`}
                  fill={c} stroke={isSel ? 'var(--pink)' : 'rgba(4,10,26,0.9)'} strokeWidth="0.7"
                  filter={isSel || a.emergency ? 'url(#fg-glow)' : undefined}
                />
                {labelled.has(a.hex) && (
                  <text x={p.x + 7 * gl} y={p.y + 3} fontSize={8} fill={c}
                    stroke="var(--bg)" strokeWidth="2.4"
                    style={{ letterSpacing: '.05em', pointerEvents: 'none', paintOrder: 'stroke' }}>
                    {a.flightNo || a.callsign || a.hex}
                  </text>
                )}
              </g>
            );
          })}
        </g>

        <rect x={C - RCLIP} y={C - RCLIP} width={RCLIP * 2} height={RCLIP * 2}
          fill="url(#fg-scan)" clipPath="url(#fg-clip)" pointerEvents="none" />
        <circle cx={C} cy={C} r={RCLIP} fill="none" stroke="var(--border-bright)" strokeWidth="1" />
      </svg>

      <div className="fg-ctl">
        <button className="btn btn-sm" onClick={() => setZoom(z => Math.max(ZOOM_MIN, z / 1.6))}
          disabled={zoom <= ZOOM_MIN} title="zoom out">−</button>
        <input type="range" min="0" max="100"
          value={Math.round((Math.log(zoom) / Math.log(ZOOM_MAX)) * 100)}
          onChange={e => setZoom(Math.pow(ZOOM_MAX, e.target.value / 100))}
          aria-label="zoom" />
        <button className="btn btn-sm" onClick={() => setZoom(z => Math.min(ZOOM_MAX, z * 1.6))}
          disabled={zoom >= ZOOM_MAX} title="zoom in">+</button>
        <button className="btn btn-sm" onClick={() => { setZoom(1); setTilt(18); }} title="reset view">⌂</button>
      </div>
      <div className="fg-cap">
        {hover
          ? `${hover.flightNo || hover.callsign || hover.hex} · ${fmtAlt(hover.altFt)} · ${compass(hover.trackDeg)}`
          : `${marks.length} shown · ${zoom < 1.05 ? 'drag to spin · scroll to zoom' : `${zoom.toFixed(1)}× · drag to pan`}`}
      </div>
    </div>
  );
}
