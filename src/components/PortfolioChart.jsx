import React, { useMemo, useState } from 'react';
import { money } from './ui.jsx';

// Pixel-retro portfolio chart.
// Main series = cumulative net invested over time (real, from order history).
// `snapshots` (optional) = [{date, total_value}] adds an actual-value line as it accrues.
// variant: 'mini' (sparkline for HQ) | 'full' (Money page, axes + markers).
export default function PortfolioChart({ orders = [], snapshots = [], currentValue = null, visible = true, variant = 'full' }) {
  const invested = useMemo(() => {
    const rows = [...orders].filter(o => o.date && o.qty && o.price).sort((a, b) => a.date.localeCompare(b.date));
    let cum = 0; const pts = [];
    for (const o of rows) {
      cum += (o.side === 'S' ? -1 : 1) * Number(o.qty) * Number(o.price);
      pts.push({ t: o.date, v: Math.max(0, cum) });
    }
    return pts;
  }, [orders]);

  const valueSeries = useMemo(() => {
    const s = [...snapshots].filter(x => x.date && x.total_value != null).sort((a, b) => a.date.localeCompare(b.date))
      .map(x => ({ t: x.date, v: Number(x.total_value) }));
    if (currentValue != null) {
      const today = invested.length ? invested[invested.length - 1].t : (s[s.length - 1]?.t);
      if (today && (!s.length || s[s.length - 1].t !== today)) s.push({ t: today, v: currentValue });
    }
    return s;
  }, [snapshots, currentValue, invested]);

  if (invested.length < 2) return <div className="muted small" style={{ padding: 12 }}>Chart builds as your history syncs…</div>;

  const W = variant === 'mini' ? 260 : 640;
  const H = variant === 'mini' ? 64 : 240;
  const padL = variant === 'mini' ? 0 : 46, padR = variant === 'mini' ? 0 : 10, padT = 10, padB = variant === 'mini' ? 4 : 26;
  const t0 = new Date(invested[0].t).getTime();
  const t1 = new Date(invested[invested.length - 1].t).getTime();
  const allV = [...invested.map(p => p.v), ...valueSeries.map(p => p.v)];
  const maxV = Math.max(...allV) * 1.08;
  const x = t => padL + ((new Date(t).getTime() - t0) / Math.max(1, t1 - t0)) * (W - padL - padR);
  const y = v => padT + (1 - v / maxV) * (H - padT - padB);

  // pixel step path
  const stepPath = pts => {
    if (!pts.length) return '';
    let d = `M ${x(pts[0].t).toFixed(1)} ${y(pts[0].v).toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) {
      d += ` L ${x(pts[i].t).toFixed(1)} ${y(pts[i - 1].v).toFixed(1)} L ${x(pts[i].t).toFixed(1)} ${y(pts[i].v).toFixed(1)}`;
    }
    return d;
  };
  const areaPath = pts => stepPath(pts) + ` L ${x(pts[pts.length - 1].t).toFixed(1)} ${(H - padB).toFixed(1)} L ${x(pts[0].t).toFixed(1)} ${(H - padB).toFixed(1)} Z`;

  const [hover, setHover] = useState(null);
  const gridY = variant === 'full' ? [0, 0.5, 1].map(f => ({ v: maxV * f, y: y(maxV * f) })) : [];

  return (
    <div style={{ width: '100%', overflow: 'hidden' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ imageRendering: 'pixelated', display: 'block' }}
        onMouseLeave={() => setHover(null)}
        onMouseMove={variant === 'full' ? e => {
          const rect = e.currentTarget.getBoundingClientRect();
          const px = (e.clientX - rect.left) / rect.width * W;
          let best = invested[0], bd = Infinity;
          for (const p of invested) { const d = Math.abs(x(p.t) - px); if (d < bd) { bd = d; best = p; } }
          setHover(best);
        } : undefined}>
        <defs>
          <linearGradient id="pcArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#9a63e8" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#9a63e8" stopOpacity="0.03" />
          </linearGradient>
        </defs>
        {/* pixel grid */}
        {variant === 'full' && gridY.map((g, i) => (
          <g key={i}>
            <line x1={padL} y1={g.y} x2={W - padR} y2={g.y} stroke="#4a3468" strokeWidth="1" strokeDasharray="3 4" />
            <text x={padL - 6} y={g.y + 4} textAnchor="end" fontSize="11" fill="#8474a0" fontFamily="VT323, monospace">
              {visible ? '$' + Math.round(g.v).toLocaleString() : '•••'}
            </text>
          </g>
        ))}
        {/* invested area + line */}
        <path d={areaPath(invested)} fill="url(#pcArea)" />
        <path d={stepPath(invested)} fill="none" stroke="#9a63e8" strokeWidth={variant === 'mini' ? 2 : 2.5} strokeLinejoin="miter" style={{ filter: 'drop-shadow(0 0 4px rgba(154,99,232,.6))' }} />
        {/* actual value line (pink) if we have >1 point */}
        {valueSeries.length > 1 && (
          <path d={stepPath(valueSeries)} fill="none" stroke="#e84191" strokeWidth={variant === 'mini' ? 2 : 2.5} strokeLinejoin="miter" style={{ filter: 'drop-shadow(0 0 4px rgba(232,65,145,.6))' }} />
        )}
        {/* current value marker */}
        {currentValue != null && (
          <g>
            <rect x={x(invested[invested.length - 1].t) - 4} y={y(currentValue) - 4} width="8" height="8" fill="#e84191" style={{ filter: 'drop-shadow(0 0 5px #e84191)' }} />
          </g>
        )}
        {/* hover */}
        {hover && variant === 'full' && (
          <g>
            <line x1={x(hover.t)} y1={padT} x2={x(hover.t)} y2={H - padB} stroke="#7a55b0" strokeWidth="1" />
            <rect x={x(hover.t) - 3} y={y(hover.v) - 3} width="6" height="6" fill="#9a63e8" />
          </g>
        )}
      </svg>
      {variant === 'full' && (
        <div className="spread small" style={{ marginTop: 6 }}>
          <span className="flex" style={{ gap: 12 }}>
            <span style={{ color: '#9a63e8' }}>▬ Invested</span>
            {valueSeries.length > 1 && <span style={{ color: '#e84191' }}>▬ Value</span>}
          </span>
          <span className="muted">
            {hover ? `${hover.t}: ${money(hover.v, visible)} invested` : `${invested[0].t} → ${invested[invested.length - 1].t}`}
          </span>
        </div>
      )}
    </div>
  );
}
