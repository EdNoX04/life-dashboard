import React, { useEffect, useMemo, useRef, useState } from 'react';
import { money } from './ui.jsx';

// Pixel-retro portfolio chart.
// Money (full) passes reconstructed `invested`/`value` daily series (from orders
// × historical prices) + an `intraday` series for 1D. HQ (mini) passes `orders`
// + `currentValue` and just shows the invested area.
const RANGES = { '1W': 7, '1M': 30, '3M': 91, '6M': 182, '1Y': 365, 'ALL': Infinity };
const INV_C = '#9a63e8';   // invested — purple
const VAL_C = '#ff5fa2';   // value — bright pink (clearly distinct from purple)

export default function PortfolioChart({ orders = [], invested: investedProp, value: valueProp, intraday = [], currentValue = null, visible = true, variant = 'full' }) {
  const wrapRef = useRef(null);
  const [cw, setCw] = useState(0);
  const [hover, setHover] = useState(null);
  const [range, setRange] = useState('ALL');
  const mini = variant === 'mini';

  useEffect(() => {
    const el = wrapRef.current; if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(es => { const w = es[0]?.contentRect?.width; if (w) setCw(Math.round(w)); });
    ro.observe(el); return () => ro.disconnect();
  }, []);

  // invested (cost basis over time): use provided series, else derive from orders
  const investedFromOrders = useMemo(() => {
    const rows = [...orders].filter(o => o.date && o.qty && o.price).sort((a, b) => a.date.localeCompare(b.date));
    let cum = 0; const pts = [];
    for (const o of rows) { cum += (o.side === 'S' ? -1 : 1) * Number(o.qty) * Number(o.price); pts.push({ t: o.date.slice(0, 10), v: Math.max(0, cum) }); }
    return pts;
  }, [orders]);
  const invested = (investedProp && investedProp.length ? investedProp : investedFromOrders);

  const valueSeries = useMemo(() => {
    if (valueProp && valueProp.length) return valueProp;
    if (currentValue != null && invested.length) return [{ t: invested[invested.length - 1].t, v: currentValue }];
    return [];
  }, [valueProp, currentValue, invested]);

  if (invested.length < 2) return <div ref={wrapRef} className="muted small" style={{ padding: 12 }}>Chart builds as your history syncs…</div>;

  const has1D = !mini && intraday && intraday.length > 1;
  const rangeKeys = has1D ? ['1D', ...Object.keys(RANGES)] : Object.keys(RANGES);
  const is1D = range === '1D' && has1D;
  const days = RANGES[range];

  const clip = series => {
    if (mini || is1D || !isFinite(days) || !series.length) return series;
    const lastT = new Date(series[series.length - 1].t).getTime();
    const cutoff = lastT - days * 86400000;
    const within = series.filter(p => new Date(p.t).getTime() >= cutoff);
    const before = series.filter(p => new Date(p.t).getTime() < cutoff);
    if (!within.length) return series.slice(-2);
    const startV = before.length ? before[before.length - 1].v : within[0].v;
    const cutISO = new Date(cutoff).toISOString().slice(0, 10);
    return [{ t: cutISO, v: startV }, ...within];
  };

  // ---- 1D path: plot intraday value only, index-scaled ----
  const W = cw || (mini ? 600 : 640);
  const H = mini ? 76 : 240;
  const padL = mini ? 4 : 52, padR = mini ? 8 : 12, padT = 12, padB = mini ? 10 : 28;

  // invested (cost basis) right now — flat reference line in 1D view
  const investedNow = invested.length ? invested[invested.length - 1].v : null;

  let dInv, dVal, xOf, t0, t1, maxV, minV;
  if (is1D) {
    dVal = intraday; dInv = [];
    const n = dVal.length;
    const vals = dVal.map(p => p.v).concat(investedNow != null ? [investedNow] : []);
    minV = Math.min(...vals);
    maxV = Math.max(...vals);
    const span = Math.max(1, maxV - minV);
    minV -= span * 0.08; maxV += span * 0.08;
    xOf = (_, i) => padL + (i / Math.max(1, n - 1)) * (W - padL - padR);
  } else {
    dInv = clip(invested); dVal = clip(valueSeries);
    t0 = new Date(dInv[0].t).getTime();
    t1 = Math.max(new Date(dInv[dInv.length - 1].t).getTime(), dVal.length ? new Date(dVal[dVal.length - 1].t).getTime() : 0);
    minV = 0;
    maxV = Math.max(...dInv.map(p => p.v), ...dVal.map(p => p.v), 1) * 1.1;
    xOf = t => padL + ((new Date(t).getTime() - t0) / Math.max(1, t1 - t0)) * (W - padL - padR);
  }
  const y = v => padT + (1 - (v - minV) / Math.max(1, maxV - minV)) * (H - padT - padB);
  const x = (t, i) => is1D ? xOf(t, i) : xOf(t);

  const stepPath = pts => {
    if (!pts.length) return '';
    let d = `M ${x(pts[0].t, 0).toFixed(1)} ${y(pts[0].v).toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) d += ` L ${x(pts[i].t, i).toFixed(1)} ${y(pts[i - 1].v).toFixed(1)} L ${x(pts[i].t, i).toFixed(1)} ${y(pts[i].v).toFixed(1)}`;
    return d;
  };
  const linePath = pts => {
    if (!pts.length) return '';
    let d = `M ${x(pts[0].t, 0).toFixed(1)} ${y(pts[0].v).toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) d += ` L ${x(pts[i].t, i).toFixed(1)} ${y(pts[i].v).toFixed(1)}`;
    return d;
  };
  const areaPath = pts => (is1D ? linePath(pts) : stepPath(pts)) + ` L ${x(pts[pts.length - 1].t, pts.length - 1).toFixed(1)} ${(H - padB).toFixed(1)} L ${x(pts[0].t, 0).toFixed(1)} ${(H - padB).toFixed(1)} Z`;

  const gridY = mini ? [] : [0, 0.5, 1].map(f => ({ v: minV + (maxV - minV) * f, y: y(minV + (maxV - minV) * f) }));
  const dayUp = is1D && dVal.length > 1 ? dVal[dVal.length - 1].v >= dVal[0].v : true;
  const valColor = is1D ? (dayUp ? '#6ee76e' : '#e84141') : VAL_C;

  return (
    <div ref={wrapRef} style={{ width: '100%' }}>
      {!mini && (
        <div className="tf-row" style={{ marginBottom: 8 }}>
          {rangeKeys.map(r => (
            <button key={r} className={`tf-btn${range === r ? ' on' : ''}`} onClick={() => { setRange(r); setHover(null); }}>{r}</button>
          ))}
        </div>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" style={{ display: 'block' }}
        onMouseLeave={() => setHover(null)}
        onMouseMove={!mini ? e => {
          const rect = e.currentTarget.getBoundingClientRect();
          const px = (e.clientX - rect.left) / rect.width * W;
          const arr = is1D ? dVal : dInv;
          let best = arr[0], bi = 0, bd = Infinity;
          arr.forEach((p, i) => { const d = Math.abs(x(p.t, i) - px); if (d < bd) { bd = d; best = p; bi = i; } });
          setHover({ ...best, i: bi, val: (is1D ? null : dVal.find(v => v.t === best.t)?.v) });
        } : undefined}>
        <defs>
          <linearGradient id={`pcA${variant}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={is1D ? valColor : '#9a63e8'} stopOpacity="0.4" />
            <stop offset="100%" stopColor={is1D ? valColor : '#9a63e8'} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {gridY.map((g, i) => (
          <g key={i}>
            <line x1={padL} y1={g.y} x2={W - padR} y2={g.y} stroke="#4a3468" strokeWidth="1" strokeDasharray="3 5" />
            <text x={padL - 8} y={g.y + 4} textAnchor="end" fontSize="11" fill="#8474a0" fontFamily="VT323, monospace">{visible ? '$' + Math.round(g.v).toLocaleString() : '•••'}</text>
          </g>
        ))}
        {is1D ? (
          <>
            <path d={areaPath(dVal)} fill={`url(#pcA${variant})`} />
            {investedNow != null && (
              <line x1={padL} y1={y(investedNow)} x2={W - padR} y2={y(investedNow)}
                stroke={INV_C} strokeWidth="2" strokeDasharray="6 5" vectorEffect="non-scaling-stroke"
                style={{ filter: 'drop-shadow(0 0 3px rgba(154,99,232,.6))' }} />
            )}
            <path d={linePath(dVal)} fill="none" stroke={valColor} strokeWidth="2.5" vectorEffect="non-scaling-stroke" style={{ filter: `drop-shadow(0 0 4px ${valColor}99)` }} />
          </>
        ) : (
          <>
            <path d={areaPath(dInv)} fill={`url(#pcA${variant})`} />
            <path d={stepPath(dInv)} fill="none" stroke={INV_C} strokeWidth={mini ? 2 : 2.5} strokeDasharray={mini ? undefined : '1 0'} vectorEffect="non-scaling-stroke" style={{ filter: 'drop-shadow(0 0 4px rgba(154,99,232,.6))' }} />
            {dVal.length > 1 && <path d={stepPath(dVal)} fill="none" stroke={VAL_C} strokeWidth={mini ? 2 : 3} vectorEffect="non-scaling-stroke" style={{ filter: 'drop-shadow(0 0 5px rgba(255,95,162,.75))' }} />}
          </>
        )}
        {hover && !mini && (
          <g className="pc-hover" style={{ transform: `translateX(${x(hover.t, hover.i).toFixed(1)}px)`, transition: 'transform 90ms linear' }}>
            <line x1="0" y1={padT} x2="0" y2={H - padB} stroke="#7a55b0" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            <rect x="-3.5" y={y(hover.v) - 3.5} width="7" height="7" fill={is1D ? valColor : INV_C} vectorEffect="non-scaling-stroke" />
            {!is1D && hover.val != null && <rect x="-3.5" y={y(hover.val) - 3.5} width="7" height="7" fill={VAL_C} vectorEffect="non-scaling-stroke" />}
          </g>
        )}
      </svg>
      {!mini && (
        <div className="spread small" style={{ marginTop: 6 }}>
          <span className="flex" style={{ gap: 12 }}>
            {is1D ? <><span style={{ color: valColor }}>▬ Value (today)</span>{investedNow != null && <span style={{ color: INV_C }}>╌ Invested</span>}</>
              : <><span style={{ color: INV_C }}>▬ Invested</span>{dVal.length > 1 && <span style={{ color: VAL_C }}>▬ Value</span>}</>}
          </span>
          <span className="muted">
            {hover
              ? (is1D
                ? `${new Date(hover.t).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}: ${money(hover.v, visible)}${investedNow != null ? ` · inv ${money(investedNow, visible)}` : ''}`
                : <>{hover.t} · <span style={{ color: INV_C }}>inv {money(hover.v, visible)}</span>{hover.val != null && <> · <span style={{ color: VAL_C }}>val {money(hover.val, visible)}</span></>}</>)
              : (is1D ? 'Today · intraday' : `${dInv[0].t} → ${dInv[dInv.length - 1].t}`)}
          </span>
        </div>
      )}
    </div>
  );
}
