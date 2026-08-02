import React, { useEffect, useMemo, useRef, useState } from 'react';

// Two lines on one grid. It used to plot only rebased-to-100 growth curves, and
// that was the thing that made this screen hard to read: "you 118.4 / index
// 112.9" is a true statement that answers a question nobody asks. What you
// actually want to know is what your money is worth and what the same money
// would have been worth in the index - two amounts, side by side, on one axis.
// So this now draws whatever currency series it is handed and the caller
// supplies the formatter.
//
// The rebased mode did have one genuine virtue: it was currency-free. That is
// preserved by the *caller* converting both series with the same fx factor
// before handing them over, which is safe here precisely because the
// "equivalent" line is denominated in the portfolio's own currency - it is
// (money you put in) x (index growth), not an index level.
//
// Hand-drawn SVG in the arcade idiom: pixelated rendering, mitered joins, a neon
// drop-shadow on each stroke, square end markers. No chart library anywhere.

const GRID_C = 'rgba(255,255,255,0.06)';
const VGRID_C = 'rgba(255,255,255,0.05)';

const fmtDate = d => {
  const dt = new Date(d);
  const n = dt.getDate();
  const suf = n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th';
  return `${n}${suf} ${dt.toLocaleString('en', { month: 'short' })}'${String(dt.getFullYear()).slice(2)}`;
};

// Resolve a CSS custom property to a real colour. drop-shadow() inside a filter
// string will not take a var(), so every colour that reaches a filter has to be
// concrete before it gets there.
function useHex(color, fallback) {
  return useMemo(() => {
    if (!color || !String(color).startsWith('var(')) return color || fallback;
    if (typeof window === 'undefined') return fallback;
    const name = String(color).slice(4, -1).trim();
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }, [color, fallback]);
}

export default function VersusChart({
  a = [], b = [],
  aLabel = 'You', aColor = '#ff5fa2',
  bLabel = 'Index', bColor = 'var(--cyan)',
  fmt = v => v.toFixed(1),
  height = 220,
  baseline = null,      // dashed reference rule at this value (rebased mode)
  showLegend = false,
  emptyNote = 'Not enough history yet — this draws itself once a few days of portfolio value have been recorded.',
}) {
  const wrapRef = useRef(null);
  const [cw, setCw] = useState(0);
  const [hover, setHover] = useState(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(es => {
      const w = es[0]?.contentRect?.width;
      if (w) setCw(Math.round(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const aHex = useHex(aColor, '#ff5fa2');
  const bHex = useHex(bColor, '#6ee7ff');

  const W = cw || 640;
  const H = height;
  const PAD = { l: 4, r: 4, t: 10, b: 20 };

  const geom = useMemo(() => {
    if (a.length < 2) return null;
    const all = [...a.map(p => p.v), ...b.map(p => p.v)].filter(Number.isFinite);
    if (!all.length) return null;
    let min = Math.min(...all), max = Math.max(...all);
    if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
    // Two value lines that track each other closely - which is exactly what a
    // portfolio and its benchmark do - would flatten into a single stripe
    // against a zero-based axis, so the axis is framed on the data.
    const pad = (max - min) * 0.10 || Math.abs(max) * 0.05 || 1;
    min -= pad; max += pad;
    const n = a.length;
    const x = i => PAD.l + (n === 1 ? 0 : (i / (n - 1)) * (W - PAD.l - PAD.r));
    const y = v => PAD.t + (1 - (v - min) / (max - min || 1)) * (H - PAD.t - PAD.b);
    const line = pts => pts.map((p, i) => `${i ? 'L' : 'M'} ${x(i).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ');
    return { x, y, min, max, n, line };
  }, [a, b, W, H]);

  if (!geom) {
    return (
      <div ref={wrapRef} className="muted small" style={{ padding: 16, textAlign: 'center' }}>
        {emptyNote}
      </div>
    );
  }

  const { x, y, n, line } = geom;
  const aPath = line(a);
  const bPath = b.length >= 2 ? line(b) : null;

  const aLast = a[a.length - 1]?.v ?? 0;
  const bLast = b.length ? b[b.length - 1]?.v ?? null : null;
  const ahead = bLast != null && aLast >= bLast;
  const baseY = baseline == null ? null : y(baseline);

  const onMove = e => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.max(0, Math.min(n - 1, Math.round(((px - PAD.l) / (W - PAD.l - PAD.r)) * (n - 1))));
    setHover(i);
  };

  const ha = hover != null ? a[hover] : null;
  const hb = hover != null ? b[hover] : null;

  const vRules = [0.25, 0.5, 0.75];

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      {showLegend && (
        <div className="flex small" style={{ gap: 14, marginBottom: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="flex" style={{ gap: 5, alignItems: 'center' }}>
            <span style={{ width: 10, height: 10, background: aHex, display: 'inline-block' }} />
            <span style={{ color: aHex }}>{aLabel.toUpperCase()}</span>
            <b>{fmt(aLast)}</b>
          </span>
          {bLast != null && (
            <span className="flex" style={{ gap: 5, alignItems: 'center' }}>
              <span style={{ width: 10, height: 10, background: bHex, display: 'inline-block' }} />
              <span style={{ color: bHex }}>{bLabel.toUpperCase()}</span>
              <b>{fmt(bLast)}</b>
            </span>
          )}
        </div>
      )}

      <svg
        viewBox={`0 0 ${W} ${H}`} width="100%" height={H}
        shapeRendering="crispEdges"
        style={{ imageRendering: 'pixelated', display: 'block', touchAction: 'pan-y' }}
        onMouseMove={onMove} onMouseLeave={() => setHover(null)}
        onTouchMove={e => { const t = e.touches[0]; if (t) onMove({ clientX: t.clientX, currentTarget: e.currentTarget }); }}
        onTouchEnd={() => setHover(null)}
      >
        {[0, 0.25, 0.5, 0.75, 1].map(f => {
          const gy = PAD.t + f * (H - PAD.t - PAD.b);
          return <line key={f} x1={PAD.l} x2={W - PAD.r} y1={gy} y2={gy} stroke={GRID_C} strokeWidth="1" />;
        })}
        {vRules.map(f => {
          const gx = PAD.l + f * (W - PAD.l - PAD.r);
          return <line key={`v${f}`} x1={gx} x2={gx} y1={PAD.t} y2={H - PAD.b}
            stroke={VGRID_C} strokeWidth="1" strokeDasharray="3 4" />;
        })}

        {baseY != null && baseY > PAD.t && baseY < H - PAD.b && (
          <>
            <line x1={PAD.l} x2={W - PAD.r} y1={baseY} y2={baseY}
              stroke="rgba(255,255,255,0.22)" strokeWidth="1" strokeDasharray="3 3" />
            <text x={PAD.l + 2} y={baseY - 3} fontSize="9" fill="rgba(255,255,255,0.35)">{fmt(baseline)}</text>
          </>
        )}

        {bPath && (
          <>
            <path d={`${bPath} L ${x(n - 1).toFixed(1)} ${H - PAD.b} L ${x(0).toFixed(1)} ${H - PAD.b} Z`}
              fill={bHex} opacity="0.10" />
            <path d={bPath} fill="none" stroke={bHex} strokeWidth="2" strokeLinejoin="miter"
              style={{ filter: `drop-shadow(0 0 3px ${bHex})` }} />
          </>
        )}

        <path d={`${aPath} L ${x(n - 1).toFixed(1)} ${H - PAD.b} L ${x(0).toFixed(1)} ${H - PAD.b} Z`}
          fill={aHex} opacity="0.13" />
        <path d={aPath} fill="none" stroke={aHex} strokeWidth="2" strokeLinejoin="miter"
          style={{ filter: `drop-shadow(0 0 4px ${aHex})` }} />

        {bLast != null && <rect x={x(n - 1) - 3} y={y(bLast) - 3} width="6" height="6" fill={bHex} />}
        <rect x={x(n - 1) - 3} y={y(aLast) - 3} width="6" height="6" fill={aHex} />

        {hover != null && ha && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b}
              stroke="rgba(255,255,255,0.30)" strokeWidth="1" />
            <rect x={x(hover) - 3} y={y(ha.v) - 3} width="6" height="6" fill="#fff" />
            {hb && <rect x={x(hover) - 3} y={y(hb.v) - 3} width="6" height="6" fill="#fff" />}
          </>
        )}

        <text x={PAD.l} y={H - 6} fontSize="9" fill="rgba(255,255,255,0.4)">{fmtDate(a[0].d)}</text>
        {n > 8 && (
          <text x={W / 2} y={H - 6} fontSize="9" fill="rgba(255,255,255,0.4)" textAnchor="middle">
            {fmtDate(a[Math.floor((n - 1) / 2)].d)}
          </text>
        )}
        <text x={W - PAD.r} y={H - 6} fontSize="9" fill="rgba(255,255,255,0.4)" textAnchor="end">
          {fmtDate(a[n - 1].d)}
        </text>
      </svg>

      {hover != null && ha && (
        <div className="small" style={{
          position: 'absolute', top: 0, right: 0, background: 'rgba(0,0,0,0.86)',
          border: '1px solid rgba(255,255,255,0.14)', padding: '5px 8px', pointerEvents: 'none',
        }}>
          <div className="muted" style={{ fontSize: 10 }}>{fmtDate(ha.d)}</div>
          <div style={{ color: aHex }}>{aLabel} {fmt(ha.v)}</div>
          {hb && <div style={{ color: bHex }}>{bLabel} {fmt(hb.v)}</div>}
        </div>
      )}
    </div>
  );
}
