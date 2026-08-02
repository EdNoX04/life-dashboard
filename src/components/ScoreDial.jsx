import React from 'react';
import { SCORE_BY_KEY, bandFor } from '../lib/healthscores.js';

// ScoreDial — a segmented arc gauge for the five headline health scores.
//
// Segmented rather than a smooth stroke, and that is not only a style choice.
// A continuous arc invites you to read a difference of two points as a real
// change, and at this precision it is not: recovery is computed from overnight
// averages that move a couple of points on measurement noise alone. Twenty
// discrete blocks quantise the reading to five points a block, which is roughly
// the resolution the underlying number actually has. The retro look and the
// honest look happen to be the same look here.
//
// Mirrors PlayerOneSync/Theme/Gauges.swift so the phone and the dashboard do not
// disagree about what a given score looks like.
//
// Two behaviours are worth stating because both are easy to get wrong:
//
//   INVERT — stress scores high when it is bad. The arc still fills clockwise
//   from the same origin, because a gauge that filled backwards for one tile
//   would be read wrong every time; what changes is only which colour the band
//   lookup returns. The scale is the same, the meaning of "full" is not, and the
//   caption says so rather than relying on the colour alone.
//
//   NO DATA — a missing score draws an empty track and the word "no data". It
//   does NOT draw a zero. A zero arc for a day the watch was on the charger
//   reads as "you were completely drained", which is a claim about your body
//   made from an absence of evidence.

const SEGMENTS = 20;
const START = 135;   // degrees, clockwise from 3 o'clock
const SWEEP = 270;   // leaves the bottom open so the caption sits in the gap

function polar(cx, cy, r, deg) {
  const rad = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

/** One trapezoid block of the arc, as a path. Straight edges keep it pixel-ish. */
function segPath(cx, cy, rIn, rOut, a0, a1) {
  const [x1, y1] = polar(cx, cy, rOut, a0);
  const [x2, y2] = polar(cx, cy, rOut, a1);
  const [x3, y3] = polar(cx, cy, rIn, a1);
  const [x4, y4] = polar(cx, cy, rIn, a0);
  const f = (n) => n.toFixed(2);
  return `M${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}L${f(x3)} ${f(y3)}L${f(x4)} ${f(y4)}Z`;
}

export default function ScoreDial({ scoreKey, value, size = 132, sub = null }) {
  const spec = SCORE_BY_KEY.get(scoreKey);
  if (!spec) return null;

  // `Number(null)` and `Number('')` are both 0, so a bare Number.isFinite check
  // turns "the watch was on the charger" into "you scored zero" — the exact
  // failure this component is built to avoid, arriving through a type coercion
  // rather than through the drawing code. Absence is rejected before coercion.
  const has = value !== null && value !== undefined && value !== ''
    && Number.isFinite(Number(value));
  const n = has ? Number(value) : NaN;
  const band = has ? bandFor(scoreKey, n) : null;
  const max = spec.max || 100;
  // Clamp for drawing only. The number printed in the middle stays the number
  // that was measured — a reading over 100 is worth seeing, not hiding.
  const pct = has ? Math.max(0, Math.min(1, n / max)) : 0;
  const lit = Math.round(pct * SEGMENTS);

  const cx = size / 2;
  const cy = size / 2;
  const rOut = size / 2 - 3;
  const rIn = rOut - Math.max(7, size * 0.09);
  const gap = 2.2;                       // degrees of dark between blocks
  const step = SWEEP / SEGMENTS;
  const color = band?.color || 'var(--ink-3)';

  const blocks = [];
  for (let i = 0; i < SEGMENTS; i++) {
    const a0 = START + i * step + gap / 2;
    const a1 = START + (i + 1) * step - gap / 2;
    const on = i < lit;
    blocks.push(
      <path
        key={i}
        d={segPath(cx, cy, rIn, rOut, a0, a1)}
        fill={on ? color : 'var(--panel-2)'}
        stroke={on ? color : 'var(--border)'}
        strokeWidth="0.5"
        shapeRendering="crispEdges"
        // The glow is on the lit blocks only. Glowing the whole track washes the
        // arc into a ring and you lose the reading at a glance, which is the one
        // thing this component exists to give you.
        style={on ? { filter: `drop-shadow(0 0 4px ${color})` } : undefined}
      />,
    );
  }

  return (
    <div className="score-dial" style={{ width: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ imageRendering: 'pixelated' }} role="img"
        aria-label={`${spec.label} ${has ? Math.round(n) : 'no data'}`}>
        {blocks}
        <text x={cx} y={cy - 2} textAnchor="middle" className="dial-value" fill={color}>
          {has ? Math.round(n) : '––'}
        </text>
        <text x={cx} y={cy + 15} textAnchor="middle" className="dial-band" fill={has ? color : 'var(--ink-3)'}>
          {band ? band.label : 'NO DATA'}
        </text>
      </svg>
      <div className="dial-label" style={{ color: spec.color }}>
        {spec.label}
        {/* Said in words next to the number, not left to the colour. A red arc
            on stress and a red arc on recovery mean opposite things, and colour
            alone is also the first thing to go for anyone colour-blind. */}
        {spec.invert && <span className="dial-invert" title="Lower is better on this one">↓ better</span>}
      </div>
      {sub && <div className="dial-sub">{sub}</div>}
    </div>
  );
}
