import React from 'react';

// Tiny pixel sparkline for a numeric series.
export default function Sparkline({ data = [], color = '#9a63e8', w = 120, h = 30 }) {
  const pts = data.filter(v => Number.isFinite(v));
  if (pts.length < 2) return <div style={{ height: h }} className="muted small">—</div>;
  const min = Math.min(...pts), max = Math.max(...pts);
  const rng = max - min || 1;
  const x = i => (i / (pts.length - 1)) * (w - 2) + 1;
  const y = v => h - 2 - ((v - min) / rng) * (h - 4);
  let d = `M ${x(0).toFixed(1)} ${y(pts[0]).toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) d += ` L ${x(i).toFixed(1)} ${y(pts[i]).toFixed(1)}`;
  const area = d + ` L ${x(pts.length - 1).toFixed(1)} ${h} L ${x(0).toFixed(1)} ${h} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} style={{ imageRendering: 'pixelated', display: 'block' }}>
      <path d={area} fill={color} opacity="0.14" />
      <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="miter" style={{ filter: `drop-shadow(0 0 3px ${color})` }} />
      <rect x={x(pts.length - 1) - 2} y={y(pts[pts.length - 1]) - 2} width="4" height="4" fill={color} />
    </svg>
  );
}
