import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  PRESETS, clampRange, moveRange, rangeForPreset, presetForRange,
  indexForDate, dateAt, xToIndex, indexToX, rangeCaption,
} from '../../lib/range.js';

// SELECT DATE RANGE — the shared control.
//
// Full history as a sparkline, a draggable and resizable window over it, two
// date inputs bound both ways, and a preset strip. Three screens in the
// dividend batch use this, which is the whole reason it is a component rather
// than three copies.
//
// All the arithmetic lives in lib/range.js and is tested there. What is left
// here is pointer plumbing, and it makes three choices worth naming:
//
//   The window is dragged from a POINTER CAPTURE on the svg, not from listeners
//   on each handle. A handle is a few pixels wide; a drag that starts on it and
//   moves fast leaves it within one frame, and per-handle listeners drop the
//   gesture. Capturing on the parent means the drag survives leaving the
//   element, leaving the chart, and leaving the window.
//
//   The date inputs are UNCONTROLLED between commits. A controlled input that
//   reparses on every keystroke fights you while you type "2026-0" — the 0 is
//   not a month yet, so a controlled field would rewrite it. They commit on
//   blur and on Enter.
//
//   The sparkline is drawn from the FULL history always, never the selection.
//   Its job is to show you what you are choosing from; redrawing it to the
//   selection would remove the context that makes the selection meaningful.

const W = 1000;   // viewBox width; the svg scales to its container
const H = 54;

function sparkPath(series, valueOf) {
  const n = series.length;
  if (n < 2) return '';
  let lo = Infinity, hi = -Infinity;
  const vals = series.map(valueOf);
  for (const v of vals) {
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return '';
  const span = hi - lo || 1;
  const pad = 4;
  let d = '';
  for (let i = 0; i < n; i++) {
    const v = vals[i];
    if (!Number.isFinite(v)) continue;
    const x = (i / (n - 1)) * W;
    const y = H - pad - ((v - lo) / span) * (H - pad * 2);
    d += `${d ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return d;
}

export default function RangeBrush({
  series = [],
  valueOf = p => Number(p?.close ?? p?.v ?? p?.value ?? 0),
  range,
  onChange,
  presets = PRESETS,
  label = 'SELECT DATE RANGE',
  color = 'var(--cyan)',
}) {
  const svgRef = useRef(null);
  const dragRef = useRef(null);
  const fromRef = useRef(null);
  const toRef = useRef(null);
  const [hover, setHover] = useState(null);
  const n = series.length;

  const eff = useMemo(
    () => range || (n ? clampRange(series, 0, n - 1) : null),
    [range, series, n],
  );

  const path = useMemo(() => sparkPath(series, valueOf), [series, valueOf]);
  const cap = useMemo(() => rangeCaption(series, eff), [series, eff]);
  const activePreset = useMemo(
    () => presetForRange(series, eff, presets),
    [series, eff, presets],
  );
  const truncated = useMemo(() => {
    if (!activePreset) return false;
    return !!rangeForPreset(series, activePreset)?.truncated;
  }, [series, activePreset]);

  // Keep the uncontrolled inputs in step with drags and presets, without
  // touching them while they have focus and someone is mid-type.
  useEffect(() => {
    if (!eff) return;
    const a = dateAt(series, eff.from), b = dateAt(series, eff.to);
    if (fromRef.current && document.activeElement !== fromRef.current) fromRef.current.value = a || '';
    if (toRef.current && document.activeElement !== toRef.current) toRef.current.value = b || '';
  }, [eff, series]);

  const pxIndex = useCallback((clientX) => {
    const el = svgRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return xToIndex(clientX - r.left, r.width, n);
  }, [n]);

  function begin(e, mode) {
    if (!n || !eff) return;
    e.preventDefault();
    e.stopPropagation();
    const i = pxIndex(e.clientX);
    dragRef.current = { mode, origin: i, from: eff.from, to: eff.to };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* older browsers */ }
  }

  function move(e) {
    const d = dragRef.current;
    const i = pxIndex(e.clientX);
    if (!d) { setHover(i); return; }
    if (d.mode === 'left') onChange?.(clampRange(series, i, d.to));
    else if (d.mode === 'right') onChange?.(clampRange(series, d.from, i));
    else if (d.mode === 'move') {
      onChange?.(moveRange(series, { from: d.from, to: d.to, count: d.to - d.from + 1 }, i - d.origin));
    } else if (d.mode === 'new') {
      onChange?.(clampRange(series, d.origin, i));
    }
  }

  function end(e) {
    dragRef.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* fine */ }
  }

  function commitDate(which, value) {
    const i = indexForDate(series, value);
    if (i == null || !eff) return;
    onChange?.(which === 'from' ? clampRange(series, i, eff.to) : clampRange(series, eff.from, i));
  }

  if (!n) {
    return (
      <div className="rb">
        <div className="rb-head"><span className="rb-label">{label}</span></div>
        <p className="rb-empty">No history loaded yet, so there is nothing to select from.</p>
      </div>
    );
  }

  const x1 = indexToX(eff.from, W, n);
  const x2 = indexToX(eff.to, W, n);

  return (
    <div className="rb" style={{ '--rb-c': color }}>
      <div className="rb-head">
        <span className="rb-label">{label}</span>
        <span className="rb-presets">
          {presets.map(p => (
            <button
              key={p.key}
              className={`rb-preset${activePreset === p.key ? ' on' : ''}`}
              onClick={() => onChange?.(rangeForPreset(series, p.key))}
            >{p.label}</button>
          ))}
        </span>
      </div>

      <svg
        ref={svgRef} className="rb-svg" viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none" shapeRendering="crispEdges"
        onPointerDown={e => begin(e, 'new')}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onPointerLeave={() => !dragRef.current && setHover(null)}
      >
        {/* Full history, always. This is the context you are selecting FROM. */}
        <path d={path} className="rb-line" vectorEffect="non-scaling-stroke" />

        {/* The unselected sides are dimmed rather than the selection being
            highlighted: it keeps the selected data at its true brightness, so
            you read the shape you are choosing rather than a tinted version. */}
        <rect x="0" y="0" width={Math.max(0, x1)} height={H} className="rb-mask" />
        <rect x={x2} y="0" width={Math.max(0, W - x2)} height={H} className="rb-mask" />

        <rect
          x={x1} y="0" width={Math.max(1, x2 - x1)} height={H}
          className="rb-win" onPointerDown={e => begin(e, 'move')}
        />

        {/* Wide invisible hit areas over narrow visible bars — a 3px handle is
            unhittable on a touchscreen and fiddly with a mouse. */}
        {[['left', x1], ['right', x2]].map(([side, x]) => (
          <g key={side}>
            <rect x={x - 3} y="0" width="6" height={H} className="rb-handle" />
            <rect
              x={x - 14} y="0" width="28" height={H} className="rb-grab"
              onPointerDown={e => begin(e, side)}
            />
          </g>
        ))}

        {hover != null && !dragRef.current && (
          <line
            x1={indexToX(hover, W, n)} x2={indexToX(hover, W, n)}
            y1="0" y2={H} className="rb-hover"
          />
        )}
      </svg>

      <div className="rb-foot">
        <label className="rb-date">
          FROM
          <input
            ref={fromRef} type="date" defaultValue={dateAt(series, eff.from) || ''}
            min={dateAt(series, 0) || undefined} max={dateAt(series, n - 1) || undefined}
            onBlur={e => commitDate('from', e.target.value)}
            onKeyDown={e => e.key === 'Enter' && commitDate('from', e.currentTarget.value)}
          />
        </label>
        <label className="rb-date">
          TO
          <input
            ref={toRef} type="date" defaultValue={dateAt(series, eff.to) || ''}
            min={dateAt(series, 0) || undefined} max={dateAt(series, n - 1) || undefined}
            onBlur={e => commitDate('to', e.target.value)}
            onKeyDown={e => e.key === 'Enter' && commitDate('to', e.currentTarget.value)}
          />
        </label>
        <span className="rb-cap">
          {cap?.text}
          {/* Decision 3 in lib/range.js, surfaced. A 5Y button over eight months
              of history must not silently imply five years exist. */}
          {truncated && (
            <em className="rb-trunc"> — all the history there is, which is less than that</em>
          )}
        </span>
        {hover != null && (
          <span className="rb-hoverdate">{dateAt(series, hover)}</span>
        )}
      </div>
    </div>
  );
}
