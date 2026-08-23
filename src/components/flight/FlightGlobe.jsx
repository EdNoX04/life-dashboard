import React, { useEffect, useMemo, useRef, useState } from 'react';
import { project, greatCircle, splitAtHorizon, positioned, AIRPORTS, compass, fmtAlt } from '../../lib/flights.js';
import { drawGlobe } from '../../lib/globe.js';

// A CRT globe with 177 real countries on it.
//
// Canvas underneath for the map, SVG on top for everything interactive. The
// map is the expensive part and never needs a click target; the aircraft are
// cheap and need hover, selection and crisp text. Drawing the map as SVG cost
// 16ms and ~90KB of path string per frame for React to reconcile; on canvas it
// is 4.7ms and produces no DOM.
//
// Both layers share one projection (lib/globe.js syncedProjection), and a test
// asserts they agree to a hundredth of a pixel — otherwise the aeroplanes
// drift off the coastline.

const ZOOM_MIN = 1;
const ZOOM_MAX = 24;
const SPIN_MS = 110;

export default function FlightGlobe({
  aircraft = [], selected = null, route = null, trail = null, onPick, size = 360, spin = true,
}) {
  const [rot, setRot] = useState(-55);
  const [tilt, setTilt] = useState(18);
  const [zoom, setZoom] = useState(1);
  const [drag, setDrag] = useState(false);
  const [hover, setHover] = useState(null);
  const grab = useRef(null);
  const cv = useRef(null);

  const C = size / 2;
  const RCLIP = size / 2 - 12;
  const R = RCLIP * zoom;
  const opts = useMemo(() => ({ rotation: rot, tilt, r: R, cx: C, cy: C }), [rot, tilt, R, C]);

  // ---- the map, painted on canvas -----------------------------------------
  useEffect(() => {
    const el = cv.current;
    if (!el) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (el.width !== size * dpr) { el.width = size * dpr; el.height = size * dpr; }
    const ctx = el.getContext('2d');
    drawGlobe(ctx, { rotation: rot, tilt, r: R, cx: C, cy: C, clip: RCLIP, dpr, zoom });
  }, [rot, tilt, R, C, RCLIP, size, zoom]);

  useEffect(() => {
    if (!spin || drag || selected) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return;
    let id;
    const tick = () => {
      if (!document.hidden) setRot(r => (r + 0.28) % 360);
      id = setTimeout(tick, SPIN_MS);
    };
    id = setTimeout(tick, SPIN_MS);
    return () => clearTimeout(id);
  }, [spin, drag, selected]);

  // Swing round to the selected aircraft and zoom enough to actually see it.
  useEffect(() => {
    if (selected?.lon == null) return;
    setRot(-selected.lon);
    setTilt(Math.max(-60, Math.min(60, selected.lat ?? 0)));
    setZoom(z => (z < 3 ? 5 : z));
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
    // Sensitivity falls with zoom so a pixel of travel is always about a pixel
    // of surface — otherwise a 24x view flies off the map from a twitch.
    setRot((grab.current.rot + dx * (0.42 / zoom) + 360) % 360);
    setTilt(Math.max(-80, Math.min(80, grab.current.tilt + dy * (0.32 / zoom))));
  }
  function up(e) {
    grab.current = null;
    setDrag(false);
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  }
  function wheel(e) {
    e.preventDefault();
    setZoom(z => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z * (e.deltaY < 0 ? 1.2 : 1 / 1.2))));
  }

  const path = seg => seg.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');

  const routeSegs = useMemo(() => {
    if (!route?.from || !route?.to) return [];
    return splitAtHorizon(greatCircle(route.from, route.to, 180), opts);
  }, [route, opts]);

  // The flown portion, drawn solid against the dashed plan — the difference
  // between where it has been and where it is going is the thing you actually
  // want to see on a route line.
  const trailSegs = useMemo(() => {
    if (!route?.from || !selected || selected.lat == null) return [];
    return splitAtHorizon(greatCircle(route.from, { lat: selected.lat, lon: selected.lon }, 120), opts);
  }, [route, selected, opts]);

  const ports = useMemo(() => {
    const keep = route ? [route.from, route.to].filter(Boolean) : Object.values(AIRPORTS);
    return keep.map(a => ({ ...a, p: project(a.lat, a.lon, opts) })).filter(a => a.p.front);
  }, [route, opts]);

  const marks = useMemo(() => positioned(aircraft)
    .map(a => ({ a, p: project(a.lat, a.lon, opts) }))
    .filter(m => m.p.front), [aircraft, opts]);

  // Greedy de-confliction: keep a label only if nothing already kept is within
  // GAP pixels. Labelling everything was unreadable mush over Dubai.
  const labelled = useMemo(() => {
    if (zoom < 3.5) return new Set(selected ? [selected.hex] : []);
    const GAP = 48;
    const kept = [];
    const order = [...marks].sort((m, n) => {
      if (selected && m.a.hex === selected.hex) return -1;
      if (selected && n.a.hex === selected.hex) return 1;
      return (n.a.altFt ?? -1) - (m.a.altFt ?? -1);
    });
    for (const m of order) {
      if (kept.length >= 14) break;
      if (kept.some(k => Math.hypot(k.p.x - m.p.x, k.p.y - m.p.y) < GAP)) continue;
      kept.push(m);
    }
    return new Set(kept.map(k => k.a.hex));
  }, [marks, zoom, selected]);

  return (
    <div className="fg-wrap" style={{ width: size }}>
      <div className="fg-stack" style={{ width: size, height: size }}>
        <canvas ref={cv} className="fg-canvas" style={{ width: size, height: size }} />
        <svg
          className={`fg-globe${drag ? ' fg-drag' : ''}`}
          width={size} height={size} viewBox={`0 0 ${size} ${size}`}
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
          onWheel={wheel}
          role="img"
          aria-label={`Globe showing ${marks.length} aircraft. Drag to rotate, scroll to zoom. The same aircraft are listed beside it.`}
        >
          <defs>
            <clipPath id="fg-clip"><circle cx={C} cy={C} r={RCLIP} /></clipPath>
            <filter id="fg-glow" x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="2.2" result="b" />
              <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>

          <g clipPath="url(#fg-clip)">
            {routeSegs.map((seg, i) => (
              <path key={`r${i}`} d={path(seg)} fill="none" stroke="var(--pink)"
                strokeWidth="1.4" strokeDasharray="5 5" opacity="0.55" />
            ))}
            {trailSegs.map((seg, i) => (
              <path key={`t${i}`} d={path(seg)} fill="none" stroke="var(--pink)"
                strokeWidth="2" opacity="0.95" filter="url(#fg-glow)" strokeLinecap="round" />
            ))}

            {ports.map(a => (
              <g key={a.name} opacity={route ? 1 : 0.65}>
                <circle cx={a.p.x} cy={a.p.y} r={route ? 3.4 : 1.7} fill="var(--yellow)" />
                {(route || zoom >= 3) && (
                  <text x={a.p.x + 6} y={a.p.y + 3} fontSize="8.5" fill="var(--yellow)"
                    stroke="var(--bg)" strokeWidth="2.6"
                    style={{ letterSpacing: '.08em', paintOrder: 'stroke' }}>{a.city}</text>
                )}
              </g>
            ))}

            {marks.map(({ a, p }) => {
              const isSel = selected && a.hex === selected.hex;
              const c = a.emergency ? 'var(--red)' : a.military ? 'var(--purple)'
                : isSel ? 'var(--pink)' : a.onGround ? 'var(--ink-3)' : 'var(--cyan)';
              const op = a.onGround ? 0.5 : 0.62 + 0.38 * Math.max(0, p.z);
              const gl = isSel ? 1.6 : zoom >= 6 ? 1.3 : 1;
              return (
                <g key={a.hex} opacity={op}
                  onPointerEnter={() => setHover(a)}
                  onPointerLeave={() => setHover(h => (h?.hex === a.hex ? null : h))}
                  onClick={() => onPick?.(a)}
                  style={{ cursor: onPick ? 'pointer' : 'default' }}>
                  {isSel && <circle cx={p.x} cy={p.y} r="11" fill="none" stroke="var(--pink)"
                    strokeWidth="1" opacity="0.9" className="fg-ping" />}
                  <path
                    d="M0,-5 L3.4,4.5 L0,2.4 L-3.4,4.5 Z"
                    transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)}) rotate(${(a.trackDeg ?? 0).toFixed(0)}) scale(${gl})`}
                    fill={c} stroke="rgba(4,10,26,0.9)" strokeWidth="0.7"
                    filter={isSel || a.emergency ? 'url(#fg-glow)' : undefined}
                  />
                  {labelled.has(a.hex) && (
                    <text x={p.x + 8 * gl} y={p.y + 3} fontSize={8.5} fill={c}
                      stroke="var(--bg)" strokeWidth="2.6"
                      style={{ letterSpacing: '.05em', pointerEvents: 'none', paintOrder: 'stroke' }}>
                      {a.flightNo || a.callsign || a.hex}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
          <circle cx={C} cy={C} r={RCLIP} fill="none" stroke="var(--border-bright)" strokeWidth="1" />
        </svg>
      </div>

      <div className="fg-ctl">
        <button className="btn btn-sm" onClick={() => setZoom(z => Math.max(ZOOM_MIN, z / 1.7))}
          disabled={zoom <= ZOOM_MIN} title="zoom out">−</button>
        <input type="range" min="0" max="100"
          value={Math.round((Math.log(zoom) / Math.log(ZOOM_MAX)) * 100)}
          onChange={e => setZoom(Math.pow(ZOOM_MAX, e.target.value / 100))}
          aria-label="zoom" />
        <button className="btn btn-sm" onClick={() => setZoom(z => Math.min(ZOOM_MAX, z * 1.7))}
          disabled={zoom >= ZOOM_MAX} title="zoom in">+</button>
        <button className="btn btn-sm" onClick={() => { setZoom(1); setTilt(18); }} title="reset view">⌂</button>
      </div>
      <div className="fg-cap">
        {hover
          ? `${hover.flightNo || hover.callsign || hover.hex} · ${fmtAlt(hover.altFt)} · ${compass(hover.trackDeg)}`
          : `${marks.length} shown · ${zoom < 1.05 ? 'drag to spin · scroll to zoom' : `${zoom.toFixed(1)}×`}`}
      </div>
    </div>
  );
}
