import React, { useEffect, useRef, useState } from 'react';
import { globeDots } from '../../lib/globalmarkets.js';

// A globe you can spin, with the open markets lit.
//
// It is still decorative — the list beside it carries every fact better — but two
// things earn it more than ornament status. Dragging it is how you go and LOOK at
// Asia at 11am rather than waiting for it to come round. And a market that is
// trading right now is the one piece of information a map genuinely conveys
// better than a table: you can see the lit band of the world sweep west across
// the day.
//
// Open-ness comes from lib/markets.js sessionState, computed from the venue's own
// clock and DST rule. It is deliberately NOT derived from whether a quote
// arrived: a market can be open with a dead feed and closed holding a perfectly
// good last price, and painting "we could not reach this" as "this market is
// shut" is a lie the user has no way to catch.
//
// Cheap by construction: an SVG circle, twelve dots, four lines of trigonometry.
// No WebGL, no map library, no TopoJSON.

const R = 92;
const SIZE = R * 2 + 28;
const DIR = { 1: 'var(--green)', '-1': 'var(--red)', 0: 'var(--ink-3)' };

export default function MarketGlobe({ rows = [] }) {
  const [rotation, setRotation] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [hover, setHover] = useState(null);
  const drag = useRef(null);
  const svgRef = useRef(null);

  // Auto-spin, but never while you are holding it, never in a hidden tab, and
  // never if the machine has been asked to stop things moving.
  useEffect(() => {
    if (dragging) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return;
    let id;
    const tick = () => {
      if (!document.hidden) setRotation(r => (r + 0.3) % 360);
      id = setTimeout(tick, 90);   // ~11fps: it is a background ornament
    };
    id = setTimeout(tick, 90);
    return () => clearTimeout(id);
  }, [dragging]);

  // Pointer events rather than mouse events, so a finger on the iPad works
  // without a second code path. setPointerCapture is what keeps the drag alive
  // when the pointer leaves the circle mid-spin — without it the globe stops
  // dead the moment you overshoot, which feels broken rather than bounded.
  function down(e) {
    drag.current = { x: e.clientX, rot: rotation };
    setDragging(true);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function move(e) {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x;
    // 0.45°/px: a full turn is about 800px of travel, which is roughly a
    // comfortable arm's sweep on a trackpad and does not spin wildly on touch.
    setRotation((drag.current.rot + dx * 0.45 + 360) % 360);
  }
  function up(e) {
    drag.current = null;
    setDragging(false);
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  }

  const dots = globeDots(rows, { rotation, tilt: 12, r: R, cx: SIZE / 2, cy: SIZE / 2 });
  const front = dots.filter(d => d.front);
  const openCount = rows.filter(r => r?.session?.phase === 'open').length;

  return (
    <div className="gm-globe-box">
      <svg
        ref={svgRef}
        className={`gm-globe ${dragging ? 'gm-globe-drag' : ''}`}
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        role="img"
        aria-label={`Globe. ${openCount} of ${rows.length} markets trading now. Drag to rotate. The same figures are listed beside it.`}
      >
        <defs>
          <radialGradient id="gm-sphere" cx="34%" cy="30%">
            <stop offset="0%" stopColor="rgba(0,229,255,0.18)" />
            <stop offset="72%" stopColor="rgba(124,77,255,0.07)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0)" />
          </radialGradient>
          {/* Scanlines. The rest of this app is a CRT and a smooth vector sphere
              in the middle of it reads as a different application. */}
          <pattern id="gm-scan" width="3" height="3" patternUnits="userSpaceOnUse">
            <rect width="3" height="1" fill="rgba(0,0,0,0.30)" />
          </pattern>
          <clipPath id="gm-clip">
            <circle cx={SIZE / 2} cy={SIZE / 2} r={R} />
          </clipPath>
        </defs>

        <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="url(#gm-sphere)" />

        {/* Latitude rings — enough to read as a sphere, not so many that they
            compete with the dots. */}
        <g clipPath="url(#gm-clip)" opacity="0.5">
          {[-60, -30, 0, 30, 60].map(lat => {
            const ry = R * Math.cos((lat * Math.PI) / 180);
            return (
              <ellipse
                key={lat}
                cx={SIZE / 2}
                cy={SIZE / 2 - R * Math.sin((lat * Math.PI) / 180) * 0.98}
                rx={ry}
                ry={ry * 0.2}
                fill="none"
                stroke={lat === 0 ? 'var(--border-bright)' : 'var(--border)'}
                strokeWidth={lat === 0 ? 0.8 : 0.5}
              />
            );
          })}
        </g>

        <rect
          x={SIZE / 2 - R} y={SIZE / 2 - R} width={R * 2} height={R * 2}
          fill="url(#gm-scan)" clipPath="url(#gm-clip)" pointerEvents="none"
        />
        <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="var(--border-bright)" strokeWidth="1" />

        {front.map(d => {
          const c = DIR[d.dir];
          return (
            <g
              key={d.iso2}
              opacity={d.opacity}
              onPointerEnter={() => setHover(d)}
              onPointerLeave={() => setHover(h => (h?.iso2 === d.iso2 ? null : h))}
              style={{ cursor: 'default' }}
            >
              {/* An open market gets a halo AND a ring, not just a brighter
                  colour — colour is already carrying up-versus-down, and asking
                  one channel to carry two facts means neither is legible. */}
              {d.open && <circle cx={d.cx} cy={d.cy} r="11" fill={c} opacity="0.13" />}
              {d.open && (
                <circle
                  cx={d.cx} cy={d.cy} r="7"
                  fill="none" stroke={c} strokeWidth="1.1" opacity="0.85"
                  className="gm-pulse"
                />
              )}
              <circle cx={d.cx} cy={d.cy} r={d.open ? 3.2 : 2.2} fill={c} />
              {/* A closed market is hollow. Readable in a screenshot, in
                  greyscale, and by someone who cannot separate the two hues. */}
              {!d.open && <circle cx={d.cx} cy={d.cy} r="2.2" fill="var(--bg)" />}
            </g>
          );
        })}
      </svg>

      <div className="gm-globe-cap">
        {hover
          ? `${hover.name} — ${hover.open ? 'trading now' : 'closed'}`
          : `${openCount} of ${rows.length} trading · drag to spin`}
      </div>
    </div>
  );
}
