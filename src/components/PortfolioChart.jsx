import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { money } from './ui.jsx';

// Pixel-retro portfolio chart.
// Money (full) passes reconstructed `invested`/`value` daily series (from orders
// × historical prices) + an `intraday` series for 1D. HQ (mini) passes `orders`
// + `currentValue` and just shows the invested area.
//
// Two things were wrong with the earlier version and both are worth naming,
// because the fixes below only make sense against them.
//
// LAG. Everything from the range buttons downward was plain function-body code,
// so it all re-ran on every render — and `hover` is state, so every mousemove
// event was a render. A single mouse sweep across a year of daily points meant
// re-parsing every ISO date with `new Date()` several thousand times per frame
// (once in each `clip` filter, once per point in `stepPath`, and once per point
// again in the mousemove's own `forEach`), then rebuilding two multi-thousand-
// segment path strings. Below, every date is parsed exactly once, all geometry
// lives in a `useMemo` that does not list `hover` as a dependency, and the
// series is decimated to the pixel grid before any path is built. Moving the
// mouse now only moves the crosshair.
//
// ACCURACY. The window was measured backwards from the last point *in the
// series* rather than from today, and each series computed its own cutoff from
// its own last point. For `invested` — which only gets a point when an order is
// placed — the last point is the date of the most recent trade, so "1M" on an
// account that has not traded since March meant "the month ending in March",
// silently. And because value and invested ended on different dates, the two
// lines were clipped to different windows and started at different x positions.
// Both now share one cutoff anchored to today, and "1M" means a calendar month
// rather than 30 days.
const VIEWS = ['1W', '1M', '3M', '6M', '1Y', 'ALL'];
const INV_C = '#9a63e8';   // invested — purple
const VAL_C = '#ff5fa2';   // value — bright pink (clearly distinct from purple)
const DAY = 86400000;

// setMonth overflows: 31 March minus one month is 31 February, which the Date
// object rolls forward into 3 March. Clamping to the last day of the target
// month is what a person means by "a month ago".
export function addMonths(d, n) {
  const x = new Date(d.getTime());
  const day = x.getDate();
  x.setDate(1);
  x.setMonth(x.getMonth() + n);
  x.setDate(Math.min(day, new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate()));
  return x;
}
export function cutoffFor(view, anchorMs) {
  const a = new Date(anchorMs);
  switch (view) {
    case '1W': return anchorMs - 7 * DAY;
    case '1M': return addMonths(a, -1).getTime();
    case '3M': return addMonths(a, -3).getTime();
    case '6M': return addMonths(a, -6).getTime();
    case '1Y': return addMonths(a, -12).getTime();
    default: return -Infinity;
  }
}

// Decimation to the pixel grid. A naive "keep every k-th point" flattens the
// vertical steps that are the whole point of a cost-basis chart, so this keeps
// the extremes of each pixel column instead: the drawn shape is identical to
// the full-resolution one at this width, using a fraction of the segments.
export function decimate(pts, cols) {
  if (pts.length <= cols * 2 || cols < 2) return pts;
  const first = pts[0], last = pts[pts.length - 1];
  const span = Math.max(1, last.ms - first.ms);
  const out = [];
  let bucket = -1, lo = null, hi = null;
  const flush = () => {
    if (!lo) return;
    if (lo === hi) out.push(lo);
    else if (lo.ms <= hi.ms) out.push(lo, hi);
    else out.push(hi, lo);
  };
  for (const p of pts) {
    const b = Math.floor(((p.ms - first.ms) / span) * (cols - 1));
    if (b !== bucket) { flush(); bucket = b; lo = hi = p; }
    else { if (p.v < lo.v) lo = p; if (p.v > hi.v) hi = p; }
  }
  flush();
  if (out[0] !== first) out.unshift(first);
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

export default function PortfolioChart({ orders = [], invested: investedProp, value: valueProp, intraday = [], currentValue = null, visible = true, variant = 'full' }) {
  const wrapRef = useRef(null);
  const [cw, setCw] = useState(0);
  const [hover, setHover] = useState(null);
  const [range, setRange] = useState('ALL');
  const mini = variant === 'mini';

  useEffect(() => {
    const el = wrapRef.current; if (!el || typeof ResizeObserver === 'undefined') return;
    // Width changes fire in bursts while a window is dragged. Rounding to 8px
    // buckets means a resize produces a handful of re-memos rather than one per
    // animation frame, and 8px is far below anything visible on a 640px chart.
    const ro = new ResizeObserver(es => {
      const w = es[0]?.contentRect?.width;
      if (w) setCw(c => (Math.abs(c - w) < 8 ? c : Math.round(w)));
    });
    ro.observe(el); return () => ro.disconnect();
  }, []);

  // Parse every date exactly once, here, and never again. Everything downstream
  // works in milliseconds.
  const invested = useMemo(() => {
    const src = (investedProp && investedProp.length) ? investedProp : null;
    if (src) return src.map(p => ({ t: p.t, v: p.v, ms: new Date(p.t).getTime() })).filter(p => isFinite(p.ms));
    const rows = [...orders].filter(o => o.date && o.qty && o.price).sort((a, b) => a.date.localeCompare(b.date));
    let cum = 0; const pts = [];
    for (const o of rows) {
      cum += (o.side === 'S' ? -1 : 1) * Number(o.qty) * Number(o.price);
      const t = o.date.slice(0, 10);
      pts.push({ t, v: Math.max(0, cum), ms: new Date(t).getTime() });
    }
    return pts;
  }, [investedProp, orders]);

  const valueSeries = useMemo(() => {
    if (valueProp && valueProp.length) return valueProp.map(p => ({ t: p.t, v: p.v, ms: new Date(p.t).getTime() })).filter(p => isFinite(p.ms));
    if (currentValue != null && invested.length) { const l = invested[invested.length - 1]; return [{ t: l.t, v: currentValue, ms: l.ms }]; }
    return [];
  }, [valueProp, currentValue, invested]);

  const intra = useMemo(
    () => (intraday || []).map(p => ({ t: p.t, v: p.v, ms: new Date(p.t).getTime() })).filter(p => isFinite(p.ms)),
    [intraday]);

  const has1D = !mini && intra.length > 1;
  const is1D = range === '1D' && has1D;
  const W = cw || (mini ? 600 : 640);
  const H = mini ? 76 : 240;

  // ---- All geometry. Deliberately does NOT depend on `hover`: that is the
  // whole lag fix. Crosshair movement re-renders the <g>, not the chart. ----
  const geo = useMemo(() => {
    if (invested.length < 2) return null;
    const padL = mini ? 4 : 52, padR = mini ? 8 : 12, padT = 12, padB = mini ? 10 : 28;
    const cols = Math.max(24, Math.round(W - padL - padR));
    const investedNow = invested[invested.length - 1].v;

    let dInv, dVal, t0, t1, minV, maxV, xs, vFull = null;

    if (is1D) {
      dVal = decimate(intra, cols); dInv = [];
      const vals = dVal.map(p => p.v).concat([investedNow]);
      minV = Math.min(...vals); maxV = Math.max(...vals);
      const span = Math.max(1, maxV - minV);
      minV -= span * 0.08; maxV += span * 0.08;
      t0 = dVal[0].ms; t1 = dVal[dVal.length - 1].ms;
      xs = dVal.map((_, i) => padL + (i / Math.max(1, dVal.length - 1)) * (W - padL - padR));
    } else {
      // One anchor, one cutoff, both series. Anchored to the start of today so
      // the window means what the button says even when the feed is stale.
      const now = new Date(); now.setHours(0, 0, 0, 0);
      const anchor = Math.max(now.getTime(), invested[invested.length - 1].ms,
        valueSeries.length ? valueSeries[valueSeries.length - 1].ms : 0);
      const cut = mini ? -Infinity : cutoffFor(range, anchor);

      // Clip, and splice in a synthetic point at the cutoff carrying the last
      // known value forward, so a window that opens before the first datapoint
      // still starts at the left edge instead of floating in from the middle.
      const clip = (s, carryToAnchor) => {
        if (!s.length) return s;
        if (!isFinite(cut)) return s;
        const i = s.findIndex(p => p.ms >= cut);
        if (i === -1) return carryToAnchor ? [{ ...s[s.length - 1], ms: cut }, { ...s[s.length - 1], ms: anchor }] : [];
        const head = i > 0 ? [{ ...s[i - 1], ms: cut }] : [];
        const body = s.slice(i);
        // Cost basis does not drift between orders, so carrying it forward to
        // today is a fact, not an extrapolation. Prices do drift, so the value
        // series is never extended — if it ends early, it visibly ends early.
        const tail = (carryToAnchor && body[body.length - 1].ms < anchor) ? [{ ...body[body.length - 1], ms: anchor }] : [];
        return [...head, ...body, ...tail];
      };

      const invFull = clip(invested, true);
      // The full-resolution clipped value series is kept for the hover readout.
      // Looking it up in the *decimated* one would silently drop most days:
      // decimation keeps two points per pixel column, so on a 1Y range four out
      // of five dates have no surviving entry and "val" would read blank on
      // them — an exact-match lookup against a lossy array.
      vFull = clip(valueSeries, false);
      dInv = decimate(invFull, cols);
      dVal = decimate(vFull, cols);
      if (dInv.length < 2) dInv = invested.slice(-2);

      t0 = dInv[0].ms;
      t1 = Math.max(dInv[dInv.length - 1].ms, dVal.length ? dVal[dVal.length - 1].ms : 0);

      // The y-axis used to be pinned at zero on every range, which made a 1W
      // view of a steady portfolio a flat line across the top of the panel —
      // the range buttons changed the x-axis and nothing else. Scaling to what
      // is actually in the window is what makes a short range readable. The
      // floor stays at zero so the area fill never hangs off the bottom.
      const all = dInv.map(p => p.v).concat(dVal.map(p => p.v));
      const lo = Math.min(...all), hi = Math.max(...all, 1);
      const pad = Math.max(1, (hi - lo) * 0.12);
      minV = Math.max(0, lo - pad);
      maxV = hi + pad;
      if (maxV - minV < 1) maxV = minV + 1;

      const sx = (W - padL - padR) / Math.max(1, t1 - t0);
      xs = dInv.map(p => padL + (p.ms - t0) * sx);
    }

    const y = v => padT + (1 - (v - minV) / Math.max(1, maxV - minV)) * (H - padT - padB);
    const sx = (W - padL - padR) / Math.max(1, t1 - t0);
    const xOf = (p, i) => (is1D ? padL + (i / Math.max(1, dVal.length - 1)) * (W - padL - padR) : padL + (p.ms - t0) * sx);

    const stepPath = pts => {
      if (!pts.length) return '';
      let d = `M ${xOf(pts[0], 0).toFixed(1)} ${y(pts[0].v).toFixed(1)}`;
      for (let i = 1; i < pts.length; i++) { const px = xOf(pts[i], i).toFixed(1); d += ` L ${px} ${y(pts[i - 1].v).toFixed(1)} L ${px} ${y(pts[i].v).toFixed(1)}`; }
      return d;
    };
    const linePath = pts => {
      if (!pts.length) return '';
      let d = `M ${xOf(pts[0], 0).toFixed(1)} ${y(pts[0].v).toFixed(1)}`;
      for (let i = 1; i < pts.length; i++) d += ` L ${xOf(pts[i], i).toFixed(1)} ${y(pts[i].v).toFixed(1)}`;
      return d;
    };
    const areaOf = pts => {
      if (!pts.length) return '';
      const base = is1D ? linePath(pts) : stepPath(pts);
      return base + ` L ${xOf(pts[pts.length - 1], pts.length - 1).toFixed(1)} ${(H - padB).toFixed(1)} L ${xOf(pts[0], 0).toFixed(1)} ${(H - padB).toFixed(1)} Z`;
    };

    const track = is1D ? dVal : dInv;
    return {
      padL, padR, padT, padB, minV, maxV, y, xOf, dInv, dVal, track, xs, vFull, investedNow,
      dArea: areaOf(track),
      dInvLine: is1D ? '' : stepPath(dInv),
      dValLine: is1D ? linePath(dVal) : (dVal.length > 1 ? stepPath(dVal) : ''),
      gridY: mini ? [] : [0, 0.5, 1].map(f => { const v = minV + (maxV - minV) * f; return { v, y: y(v) }; }),
    };
  }, [invested, valueSeries, intra, range, is1D, W, H, mini]);

  // Nearest-point lookup over the precomputed x array. Binary search on a
  // sorted list of numbers, so a mousemove costs a handful of comparisons
  // instead of a full pass with a Date constructor on every point.
  const onMove = useCallback(e => {
    if (!geo || mini) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width * W;
    const xs = geo.xs;
    let lo = 0, hi = xs.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (xs[m] < px) lo = m + 1; else hi = m; }
    if (lo > 0 && Math.abs(xs[lo - 1] - px) < Math.abs(xs[lo] - px)) lo--;
    const p = geo.track[lo];
    if (!p) return;
    // Nearest value point by time, not by exact key: the two series are sampled
    // independently and a market holiday in one is not a gap in the other.
    let val = null;
    const vf = geo.vFull;
    if (vf && vf.length) {
      let a = 0, b = vf.length - 1;
      while (a < b) { const m = (a + b) >> 1; if (vf[m].ms < p.ms) a = m + 1; else b = m; }
      if (a > 0 && Math.abs(vf[a - 1].ms - p.ms) < Math.abs(vf[a].ms - p.ms)) a--;
      if (Math.abs(vf[a].ms - p.ms) <= 4 * DAY) val = vf[a].v;
    }
    setHover({ t: p.t, v: p.v, ms: p.ms, i: lo, x: xs[lo], val });
  }, [geo, mini, W]);

  if (!geo) return <div ref={wrapRef} className="muted small" style={{ padding: 12 }}>Chart builds as your history syncs…</div>;

  const rangeKeys = has1D ? ['1D', ...VIEWS] : VIEWS;
  const { padL, padR, padT, padB, y, dInv, dVal, investedNow, gridY } = geo;
  const valColor = VAL_C; // value line is always pink — consistent across every timeframe incl. 1D

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
        onMouseMove={!mini ? onMove : undefined}>
        <defs>
          <linearGradient id={`pcA${variant}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={is1D ? valColor : INV_C} stopOpacity="0.4" />
            <stop offset="100%" stopColor={is1D ? valColor : INV_C} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {gridY.map((g, i) => (
          <g key={i}>
            <line x1={padL} y1={g.y} x2={W - padR} y2={g.y} stroke="#4a3468" strokeWidth="1" strokeDasharray="3 5" />
            <text x={padL - 8} y={g.y + 4} textAnchor="end" fontSize="11" fill="#8474a0" fontFamily="VT323, monospace">{visible ? '$' + Math.round(g.v).toLocaleString() : '•••'}</text>
          </g>
        ))}
        <path d={geo.dArea} fill={`url(#pcA${variant})`} />
        {is1D ? (
          <>
            {investedNow != null && (
              <line x1={padL} y1={y(investedNow)} x2={W - padR} y2={y(investedNow)}
                stroke={INV_C} strokeWidth="2" strokeDasharray="6 5" vectorEffect="non-scaling-stroke"
                style={{ filter: 'drop-shadow(0 0 3px rgba(154,99,232,.6))' }} />
            )}
            <path d={geo.dValLine} fill="none" stroke={valColor} strokeWidth="2.5" vectorEffect="non-scaling-stroke" style={{ filter: `drop-shadow(0 0 4px ${valColor}99)` }} />
          </>
        ) : (
          <>
            <path d={geo.dInvLine} fill="none" stroke={INV_C} strokeWidth={mini ? 2 : 2.5} vectorEffect="non-scaling-stroke" style={{ filter: 'drop-shadow(0 0 4px rgba(154,99,232,.6))' }} />
            {geo.dValLine && <path d={geo.dValLine} fill="none" stroke={VAL_C} strokeWidth={mini ? 2 : 3} vectorEffect="non-scaling-stroke" style={{ filter: 'drop-shadow(0 0 5px rgba(255,95,162,.75))' }} />}
          </>
        )}
        {hover && !mini && (
          <g className="pc-hover" style={{ transform: `translateX(${hover.x.toFixed(1)}px)`, transition: 'transform 90ms linear' }}>
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
                ? `${new Date(hover.ms).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}: ${money(hover.v, visible)}${investedNow != null ? ` · inv ${money(investedNow, visible)}` : ''}`
                : <>{new Date(hover.ms).toISOString().slice(0, 10)} · <span style={{ color: INV_C }}>inv {money(hover.v, visible)}</span>{hover.val != null && <> · <span style={{ color: VAL_C }}>val {money(hover.val, visible)}</span></>}</>)
              : (is1D ? 'Today · intraday' : `${new Date(dInv[0].ms).toISOString().slice(0, 10)} → ${new Date(dInv[dInv.length - 1].ms).toISOString().slice(0, 10)}`)}
          </span>
        </div>
      )}
    </div>
  );
}
