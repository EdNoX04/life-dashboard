import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  project, greatCircle, splitAtHorizon, positioned, AIRPORTS, compass, fmtAlt,
} from '../../lib/flights.js';

// A CRT radar globe.
//
// Deliberately a wireframe rather than a map. I do not have coastline data
// offline, and inventing landmasses from memory would put countries in the
// wrong place — a graticule is honest about being a coordinate grid, and it is
// also exactly the look of the vector radar displays this whole app is
// pastiching. Airports are plotted from real coordinates, so the reference
// points on the globe are true even though the land is not drawn.
//
// Three things make it read as a sphere rather than a circle: back-face
// culling (nothing on the far side is drawn), the meridians bunching toward
// the limb on their own out of the projection, and each aircraft dimming with
// its z-depth.

const DIM = { ground: 'var(--ink-3)', climb: 'var(--green)', descent: 'var(--yellow)', cruise: 'var(--cyan)', level: 'var(--cyan)', unknown: 'var(--ink-3)' };

export default function FlightGlobe({
  aircraft = [], selected = null, route = null, onPick, size = 340, spin = true,
}) {
  const [rot, setRot] = useState(-55);      // start looking at the Gulf / India
  const [tilt, setTilt] = useState(18);
  const [drag, setDrag] = useState(false);
  const [hover, setHover] = useState(null);
  const grab = useRef(null);

  const R = size / 2 - 14;
  const C = size / 2;
  const opts = useMemo(() => ({ rotation: rot, tilt, r: R, cx: C, cy: C }), [rot, tilt, R, C]);

  // Auto-rotate, but never while held, never in a hidden tab, and never when
  // the machine has been asked to stop things moving.
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

  // When a flight is selected, swing the globe round to it rather than making
  // the user hunt for a 3px triangle on a rotating sphere.
  useEffect(() => {
    if (selected?.lon == null) return;
    setRot(-selected.lon);
    setTilt(Math.max(-60, Math.min(60, selected.lat ?? 0)));
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
    setRot((grab.current.rot + dx * 0.4 + 360) % 360);
    // Tilt is clamped: past ±80° the poles come over the top and the graticule
    // turns inside out.
    setTilt(Math.max(-80, Math.min(80, grab.current.tilt + dy * 0.3)));
  }
  function up(e) {
    grab.current = null;
    setDrag(false);
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  }

  // ---- graticule ----
  const grid = useMemo(() => {
    const lines = [];
    for (let lat = -60; lat <= 60; lat += 30) {
      const pts = [];
      for (let lon = -180; lon <= 180; lon += 4) pts.push({ lat, lon });
      splitAtHorizon(pts, opts).forEach(seg => lines.push({ seg, major: lat === 0 }));
    }
    for (let lon = -180; lon < 180; lon += 30) {
      const pts = [];
      for (let lat = -90; lat <= 90; lat += 4) pts.push({ lat, lon });
      splitAtHorizon(pts, opts).forEach(seg => lines.push({ seg, major: lon === 0 }));
    }
    return lines;
  }, [opts]);

  const routeSegs = useMemo(() => {
    if (!route?.from || !route?.to) return [];
    return splitAtHorizon(greatCircle(route.from, route.to, 128), opts);
  }, [route, opts]);

  const ports = useMemo(() => {
    const keep = route ? [route.from, route.to].filter(Boolean) : Object.values(AIRPORTS);
    return keep.map(a => ({ ...a, p: project(a.lat, a.lon, opts) })).filter(a => a.p.front);
  }, [route, opts]);

  const marks = useMemo(() => positioned(aircraft).map(a => {
    const p = project(a.lat, a.lon, opts);
    return { a, p };
  }).filter(m => m.p.front), [aircraft, opts]);

  const path = seg => seg.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');

  return (
    <div className="fg-wrap">
      <svg
        className={`fg-globe${drag ? ' fg-drag' : ''}`}
        width={size} height={size} viewBox={`0 0 ${size} ${size}`}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        role="img"
        aria-label={`Globe showing ${marks.length} aircraft. Drag to rotate. The same aircraft are listed beside it.`}
      >
        <defs>
          <radialGradient id="fg-sphere" cx="36%" cy="30%">
            <stop offset="0%" stopColor="rgba(0,229,255,0.20)" />
            <stop offset="70%" stopColor="rgba(124,77,255,0.08)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0)" />
          </radialGradient>
          <pattern id="fg-scan" width="3" height="3" patternUnits="userSpaceOnUse">
            <rect width="3" height="1" fill="rgba(0,0,0,0.34)" />
          </pattern>
          <clipPath id="fg-clip"><circle cx={C} cy={C} r={R} /></clipPath>
          <filter id="fg-glow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="2.2" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        <circle cx={C} cy={C} r={R} fill="url(#fg-sphere)" />

        <g clipPath="url(#fg-clip)">
          {grid.map((l, i) => (
            <path key={i} d={path(l.seg)} fill="none"
              stroke={l.major ? 'var(--border-bright)' : 'var(--border)'}
              strokeWidth={l.major ? 0.9 : 0.45} opacity={l.major ? 0.75 : 0.45} />
          ))}

          {/* the route, drawn under everything else */}
          {routeSegs.map((seg, i) => (
            <path key={`r${i}`} d={path(seg)} fill="none" stroke="var(--pink)"
              strokeWidth="1.6" strokeDasharray="5 4" opacity="0.85" filter="url(#fg-glow)" />
          ))}

          {ports.map(a => (
            <g key={a.name} opacity={route ? 1 : 0.5}>
              <circle cx={a.p.x} cy={a.p.y} r={route ? 3 : 1.4} fill="var(--yellow)" />
              {route && (
                <text x={a.p.x + 6} y={a.p.y + 3} fontSize="8" fill="var(--yellow)"
                  style={{ letterSpacing: '.08em' }}>{a.city}</text>
              )}
            </g>
          ))}

          {marks.map(({ a, p }) => {
            const isSel = selected && a.hex === selected.hex;
            const c = a.emergency ? 'var(--red)' : a.military ? 'var(--purple)'
              : isSel ? 'var(--pink)' : DIM[a.onGround ? 'ground' : 'cruise'];
            // Depth fade: nearer the limb, dimmer. This is what stops the far
            // rim reading as a flat ring of dots.
            const op = a.onGround ? 0.45 : 0.55 + 0.45 * Math.max(0, p.z);
            const rot_ = (a.trackDeg ?? 0);
            return (
              <g key={a.hex} opacity={op}
                onPointerEnter={() => setHover(a)}
                onPointerLeave={() => setHover(h => (h?.hex === a.hex ? null : h))}
                onClick={() => onPick?.(a)}
                style={{ cursor: onPick ? 'pointer' : 'default' }}>
                {isSel && <circle cx={p.x} cy={p.y} r="10" fill="none" stroke="var(--pink)" strokeWidth="1" opacity="0.9" className="fg-ping" />}
                {/* A triangle pointed along the track. A dot would throw away
                    the one thing that makes a radar picture readable. */}
                <path
                  d="M0,-5 L3.4,4.5 L0,2.4 L-3.4,4.5 Z"
                  transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)}) rotate(${rot_.toFixed(0)})`}
                  fill={c} stroke={isSel ? 'var(--pink)' : 'none'} strokeWidth="0.8"
                  filter={isSel || a.emergency ? 'url(#fg-glow)' : undefined}
                />
              </g>
            );
          })}
        </g>

        <rect x={C - R} y={C - R} width={R * 2} height={R * 2}
          fill="url(#fg-scan)" clipPath="url(#fg-clip)" pointerEvents="none" />
        <circle cx={C} cy={C} r={R} fill="none" stroke="var(--border-bright)" strokeWidth="1" />
      </svg>

      <div className="fg-cap">
        {hover
          ? `${hover.flightNo || hover.callsign || hover.hex} · ${fmtAlt(hover.altFt)} · ${compass(hover.trackDeg)}`
          : `${marks.length} shown · drag to spin`}
      </div>
    </div>
  );
}
