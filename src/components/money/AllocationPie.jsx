import React, { useMemo, useState } from 'react';

// A donut drawn as a ring of stepped arc segments — no chart library, and no
// smooth gradients either. Each slice is a stroked arc on a circle with a square
// linecap and a neon glow, which reads as a chunky arcade dial rather than a
// business-report pie.
//
// Slices below `minPct` are folded into "Other" so the ring never turns into a
// fringe of unreadable slivers.

const PALETTE = [
  'var(--green)', 'var(--cyan)', 'var(--pink)', 'var(--orange)',
  'var(--purple)', 'var(--yellow)', 'var(--red)',
];

const resolve = c => {
  if (!c.startsWith('var(')) return c;
  if (typeof window === 'undefined') return '#6ee7ff';
  const v = getComputedStyle(document.documentElement).getPropertyValue(c.slice(4, -1).trim()).trim();
  return v || '#6ee7ff';
};

export default function AllocationPie({
  slices = [], size = 168, thickness = 22, minPct = 2.5, label = 'ALLOC', showLegend = true,
}) {
  const [hover, setHover] = useState(null);

  const data = useMemo(() => {
    const total = slices.reduce((s, x) => s + Math.max(0, Number(x.value) || 0), 0);
    if (!total) return { total: 0, arr: [] };
    const big = [], small = [];
    for (const s of slices) {
      const v = Math.max(0, Number(s.value) || 0);
      if (!v) continue;
      ((v / total) * 100 >= minPct ? big : small).push({ ...s, value: v });
    }
    const arr = big.sort((a, b) => b.value - a.value);
    const rest = small.reduce((s, x) => s + x.value, 0);
    if (rest > 0) arr.push({ label: 'Other', value: rest });
    return {
      total,
      arr: arr.map((s, i) => ({
        ...s,
        pct: (s.value / total) * 100,
        color: resolve(s.color || PALETTE[i % PALETTE.length]),
      })),
    };
  }, [slices, minPct]);

  if (!data.total) {
    return <div className="muted small" style={{ padding: 14, textAlign: 'center' }}>Nothing to allocate yet.</div>;
  }

  const R = (size - thickness) / 2;
  const C = size / 2;
  const circ = 2 * Math.PI * R;
  const GAP = 2; // px of dark between slices, so the ring reads as segments

  let acc = 0;
  const segs = data.arr.map((s, i) => {
    const len = Math.max(0, (s.pct / 100) * circ - GAP);
    const seg = { ...s, i, dash: `${len} ${circ - len}`, offset: -acc };
    acc += (s.pct / 100) * circ;
    return seg;
  });

  const focus = hover != null ? data.arr[hover] : null;

  return (
    <div className="flex" style={{ gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}
        style={{ imageRendering: 'pixelated', flex: '0 0 auto' }}>
        <circle cx={C} cy={C} r={R} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={thickness} />
        <g transform={`rotate(-90 ${C} ${C})`}>
          {segs.map(s => (
            <circle key={s.i} cx={C} cy={C} r={R} fill="none"
              stroke={s.color}
              strokeWidth={hover === s.i ? thickness + 4 : thickness}
              strokeDasharray={s.dash} strokeDashoffset={s.offset}
              style={{ filter: `drop-shadow(0 0 ${hover === s.i ? 6 : 3}px ${s.color})`, cursor: 'default' }}
              onMouseEnter={() => setHover(s.i)} onMouseLeave={() => setHover(null)} />
          ))}
        </g>
        <text x={C} y={C - 4} textAnchor="middle" fontSize="10" fill="rgba(255,255,255,0.45)" letterSpacing="1">
          {focus ? focus.label.toUpperCase().slice(0, 14) : label}
        </text>
        <text x={C} y={C + 14} textAnchor="middle" fontSize="16"
          fill={focus ? focus.color : '#fff'}
          style={focus ? { filter: `drop-shadow(0 0 4px ${focus.color})` } : undefined}>
          {focus ? `${focus.pct.toFixed(1)}%` : data.arr.length}
        </text>
        {!focus && <text x={C} y={C + 26} textAnchor="middle" fontSize="8" fill="rgba(255,255,255,0.35)">SLICES</text>}
      </svg>

      {showLegend && (
        <div style={{ flex: 1, minWidth: 170 }}>
          {data.arr.map((s, i) => (
            <div key={i} className="flex" style={{ gap: 8, alignItems: 'center', padding: '2px 0', opacity: hover == null || hover === i ? 1 : 0.45 }}
              onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <span style={{ width: 10, height: 10, background: s.color, display: 'inline-block', flex: '0 0 10px' }} />
              <span className="small" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label}</span>
              <span className="small" style={{ color: s.color }}>{s.pct.toFixed(1)}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
