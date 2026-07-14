import React, { useEffect, useMemo, useRef, useState } from 'react';
import { money } from './ui.jsx';

// Pixel-retro portfolio chart. Measures its container so it fills the width.
// variant: 'mini' (HQ) | 'full' (Money, with a timeframe selector).
const RANGES = { '1M': 30, '3M': 91, '6M': 182, '1Y': 365, 'ALL': Infinity };

export default function PortfolioChart({ orders = [], snapshots = [], currentValue = null, visible = true, variant = 'full' }) {
  const wrapRef = useRef(null);
  const [cw, setCw] = useState(0);
  const [hover, setHover] = useState(null);
  const [range, setRange] = useState('ALL');

  useEffect(() => {
    const el = wrapRef.current; if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(es => { const w = es[0]?.contentRect?.width; if (w) setCw(Math.round(w)); });
    ro.observe(el); return () => ro.disconnect();
  }, []);

  const invested = useMemo(() => {
    const rows = [...orders].filter(o => o.date && o.qty && o.price).sort((a, b) => a.date.localeCompare(b.date));
    let cum = 0; const pts = [];
    for (const o of rows) { cum += (o.side === 'S' ? -1 : 1) * Number(o.qty) * Number(o.price); pts.push({ t: o.date, v: Math.max(0, cum) }); }
    return pts;
  }, [orders]);

  const valueSeries = useMemo(() => {
    const s = [...snapshots].filter(x => x.date && x.total_value != null).sort((a, b) => a.date.localeCompare(b.date)).map(x => ({ t: x.date, v: Number(x.total_value) }));
    if (currentValue != null) {
      const today = invested.length ? invested[invested.length - 1].t : (s[s.length - 1]?.t);
      if (today && (!s.length || s[s.length - 1].t !== today)) s.push({ t: today, v: currentValue });
    }
    return s;
  }, [snapshots, currentValue, invested]);

  if (invested.length < 2) return <div ref={wrapRef} className="muted small" style={{ padding: 12 }}>Chart builds as your history syncs…</div>;

  const mini = variant === 'mini';
  const days = RANGES[range];

  // clip a series to the selected window, anchoring a start point at the cutoff
  const clip = series => {
    if (mini || !isFinite(days) || !series.length) return series;
    const lastT = new Date(series[series.length - 1].t).getTime();
    const cutoff = lastT - days * 86400000;
    const cutISO = new Date(cutoff).toISOString().slice(0, 10);
    const before = series.filter(p => new Date(p.t).getTime() < cutoff);
    const within = series.filter(p => new Date(p.t).getTime() >= cutoff);
    const startV = before.length ? before[before.length - 1].v : (within[0] ? within[0].v : 0);
    const out = [{ t: cutISO, v: startV }, ...within];
    if (out.length < 2) out.push({ t: series[series.length - 1].t, v: startV });
    return out;
  };
  const dInv = clip(invested);
  const dVal = clip(valueSeries);

  const W = cw || (mini ? 600 : 640);
  const H = mini ? 76 : 240;
  const padL = mini ? 4 : 52, padR = mini ? 8 : 12, padT = 12, padB = mini ? 10 : 28;
  const t0 = new Date(dInv[0].t).getTime();
  const t1 = Math.max(new Date(dInv[dInv.length - 1].t).getTime(), dVal.length ? new Date(dVal[dVal.length - 1].t).getTime() : 0);
  const maxV = Math.max(...dInv.map(p => p.v), ...dVal.map(p => p.v), 1) * 1.1;
  const x = t => padL + ((new Date(t).getTime() - t0) / Math.max(1, t1 - t0)) * (W - padL - padR);
  const y = v => padT + (1 - v / maxV) * (H - padT - padB);

  const stepPath = pts => {
    if (!pts.length) return '';
    let d = `M ${x(pts[0].t).toFixed(1)} ${y(pts[0].v).toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) d += ` L ${x(pts[i].t).toFixed(1)} ${y(pts[i - 1].v).toFixed(1)} L ${x(pts[i].t).toFixed(1)} ${y(pts[i].v).toFixed(1)}`;
    return d;
  };
  const areaPath = pts => stepPath(pts) + ` L ${x(pts[pts.length - 1].t).toFixed(1)} ${(H - padB).toFixed(1)} L ${x(pts[0].t).toFixed(1)} ${(H - padB).toFixed(1)} Z`;

  const gridY = mini ? [] : [0, 0.5, 1].map(f => ({ v: maxV * f, y: y(maxV * f) }));
  const lastInv = dInv[dInv.length - 1];

  return (
    <div ref={wrapRef} style={{ width: '100%' }}>
      {!mini && (
        <div className="tf-row" style={{ marginBottom: 8 }}>
          {Object.keys(RANGES).map(r => (
            <button key={r} className={`tf-btn${range === r ? ' on' : ''}`} onClick={() => { setRange(r); setHover(null); }}>{r}</button>
          ))}
        </div>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" style={{ display: 'block' }}
        onMouseLeave={() => setHover(null)}
        onMouseMove={!mini ? e => {
          const rect = e.currentTarget.getBoundingClientRect();
          const px = (e.clientX - rect.left) / rect.width * W;
          let best = dInv[0], bd = Infinity;
          for (const p of dInv) { const d = Math.abs(x(p.t) - px); if (d < bd) { bd = d; best = p; } }
          setHover(best);
        } : undefined}>
        <defs>
          <linearGradient id={`pcA${variant}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#9a63e8" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#9a63e8" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {gridY.map((g, i) => (
          <g key={i}>
            <line x1={padL} y1={g.y} x2={W - padR} y2={g.y} stroke="#4a3468" strokeWidth="1" strokeDasharray="3 5" />
            <text x={padL - 8} y={g.y + 4} textAnchor="end" fontSize="11" fill="#8474a0" fontFamily="VT323, monospace">{visible ? '$' + Math.round(g.v).toLocaleString() : '•••'}</text>
          </g>
        ))}
        <path d={areaPath(dInv)} fill={`url(#pcA${variant})`} />
        <path d={stepPath(dInv)} fill="none" stroke="#9a63e8" strokeWidth={mini ? 2 : 2.5} vectorEffect="non-scaling-stroke" style={{ filter: 'drop-shadow(0 0 4px rgba(154,99,232,.6))' }} />
        {dVal.length > 1 && <path d={stepPath(dVal)} fill="none" stroke="#e84191" strokeWidth={mini ? 2 : 2.5} vectorEffect="non-scaling-stroke" style={{ filter: 'drop-shadow(0 0 4px rgba(232,65,145,.6))' }} />}
        {currentValue != null && <rect x={x(lastInv.t) - 3} y={y(currentValue) - 3} width="6" height="6" fill="#e84191" vectorEffect="non-scaling-stroke" style={{ filter: 'drop-shadow(0 0 5px #e84191)' }} />}
        {hover && !mini && (<g><line x1={x(hover.t)} y1={padT} x2={x(hover.t)} y2={H - padB} stroke="#7a55b0" strokeWidth="1" vectorEffect="non-scaling-stroke" /><rect x={x(hover.t) - 3} y={y(hover.v) - 3} width="6" height="6" fill="#9a63e8" vectorEffect="non-scaling-stroke" /></g>)}
      </svg>
      {!mini && (
        <div className="spread small" style={{ marginTop: 6 }}>
          <span className="flex" style={{ gap: 12 }}><span style={{ color: '#9a63e8' }}>▬ Invested</span>{dVal.length > 1 && <span style={{ color: '#e84191' }}>▬ Value</span>}</span>
          <span className="muted">{hover ? `${hover.t}: ${money(hover.v, visible)} invested` : `${dInv[0].t} → ${dInv[dInv.length - 1].t}`}</span>
        </div>
      )}
    </div>
  );
}
