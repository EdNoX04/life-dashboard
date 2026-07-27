import React, { useEffect, useMemo, useRef, useState } from 'react';

// Two rebased lines on one grid — you vs the index. Rebasing to 100 at the left
// edge is what makes the comparison honest and currency-free: a rupee index and
// a dollar portfolio are plotted as growth of the same starting stake.
//
// Hand-drawn SVG in the arcade idiom: pixelated rendering, mitered joins, a neon
// drop-shadow on each stroke, square end-caps. No chart library anywhere.

const PORT_C = '#ff5fa2';  // you — bright pink
const GRID_C = 'rgba(255,255,255,0.06)';

const fmtDate = d => {
  const dt = new Date(d);
  return `${dt.getDate()} ${dt.toLocaleString('en', { month: 'short' })} ${String(dt.getFullYear()).slice(2)}`;
};

export default function VersusChart({
  portfolio = [], benchmark = [], benchLabel = 'Index', benchColor = 'var(--cyan)',
  height = 220, showLegend = true,
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

  // benchColor arrives as a CSS var; SVG filters need a real colour, so resolve it
  const benchHex = useMemo(() => {
    if (!benchColor.startsWith('var(')) return benchColor;
    if (typeof window === 'undefined') return '#6ee7ff';
    const name = benchColor.slice(4, -1).trim();
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || '#6ee7ff';
  }, [benchColor]);

  const W = cw || 640;
  const H = height;
  const PAD = { l: 4, r: 4, t: 10, b: 18 };

  const geom = useMemo(() => {
    if (portfolio.length < 2) return null;
    const all = [...portfolio.map(p => p.v), ...benchmark.map(p => p.v)];
    let min = Math.min(...all), max = Math.max(...all);
    if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
    const pad = (max - min) * 0.08 || 1;
    min -= pad; max += pad;
    const n = portfolio.length;
    const x = i => PAD.l + (i / (n - 1)) * (W - PAD.l - PAD.r);
    const y = v => PAD.t + (1 - (v - min) / (max - min || 1)) * (H - PAD.t - PAD.b);
    const line = pts => pts.map((p, i) => `${i ? 'L' : 'M'} ${x(i).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ');
    return { x, y, min, max, n, line };
  }, [portfolio, benchmark, W, H]);

  if (!geom) {
    return (
      <div ref={wrapRef} className="muted small" style={{ padding: 16, textAlign: 'center' }}>
        Not enough history yet — the comparison draws itself once a few days of
        portfolio value have been recorded.
      </div>
    );
  }

  const { x, y, n, line } = geom;
  const pPath = line(portfolio);
  const bPath = benchmark.length >= 2 ? line(benchmark) : null;
  const baseY = y(100);

  const pLast = portfolio[portfolio.length - 1]?.v ?? 100;
  const bLast = benchmark[benchmark.length - 1]?.v ?? null;
  const ahead = bLast != null && pLast >= bLast;

  const onMove = e => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.max(0, Math.min(n - 1, Math.round(((px - PAD.l) / (W - PAD.l - PAD.r)) * (n - 1))));
    setHover(i);
  };

  const hp = hover != null ? portfolio[hover] : null;
  const hb = hover != null ? benchmark[hover] : null;

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      {showLegend && (
        <div className="flex small" style={{ gap: 14, marginBottom: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="flex" style={{ gap: 5, alignItems: 'center' }}>
            <span style={{ width: 10, height: 10, background: PORT_C, display: 'inline-block' }} />
            <span style={{ color: PORT_C }}>YOU</span>
            <b>{pLast.toFixed(1)}</b>
          </span>
          {bLast != null && (
            <span className="flex" style={{ gap: 5, alignItems: 'center' }}>
              <span style={{ width: 10, height: 10, background: benchHex, display: 'inline-block' }} />
              <span style={{ color: benchHex }}>{benchLabel.toUpperCase()}</span>
              <b>{bLast.toFixed(1)}</b>
            </span>
          )}
          {bLast != null && (
            <span className={`chip ${ahead ? 'c-green' : 'c-red'}`}>
              {ahead ? '▲' : '▼'} {Math.abs(pLast - bLast).toFixed(1)} pts {ahead ? 'ahead' : 'behind'}
            </span>
          )}
        </div>
      )}

      <svg
        viewBox={`0 0 ${W} ${H}`} width="100%" height={H}
        style={{ imageRendering: 'pixelated', display: 'block', touchAction: 'pan-y' }}
        onMouseMove={onMove} onMouseLeave={() => setHover(null)}
        onTouchMove={e => { const t = e.touches[0]; if (t) onMove({ clientX: t.clientX, currentTarget: e.currentTarget }); }}
        onTouchEnd={() => setHover(null)}
      >
        {/* horizontal grid — quiet, just enough to read level off */}
        {[0, 0.25, 0.5, 0.75, 1].map(f => {
          const gy = PAD.t + f * (H - PAD.t - PAD.b);
          return <line key={f} x1={PAD.l} x2={W - PAD.r} y1={gy} y2={gy} stroke={GRID_C} strokeWidth="1" />;
        })}

        {/* the 100 line: everything above it is profit on the starting stake */}
        {baseY > PAD.t && baseY < H - PAD.b && (
          <>
            <line x1={PAD.l} x2={W - PAD.r} y1={baseY} y2={baseY}
              stroke="rgba(255,255,255,0.22)" strokeWidth="1" strokeDasharray="3 3" />
            <text x={PAD.l + 2} y={baseY - 3} fontSize="9" fill="rgba(255,255,255,0.35)">100</text>
          </>
        )}

        {bPath && (
          <>
            <path d={`${bPath} L ${x(n - 1).toFixed(1)} ${H - PAD.b} L ${x(0).toFixed(1)} ${H - PAD.b} Z`}
              fill={benchHex} opacity="0.07" />
            <path d={bPath} fill="none" stroke={benchHex} strokeWidth="2" strokeLinejoin="miter"
              style={{ filter: `drop-shadow(0 0 3px ${benchHex})` }} />
          </>
        )}

        <path d={`${pPath} L ${x(n - 1).toFixed(1)} ${H - PAD.b} L ${x(0).toFixed(1)} ${H - PAD.b} Z`}
          fill={PORT_C} opacity="0.10" />
        <path d={pPath} fill="none" stroke={PORT_C} strokeWidth="2" strokeLinejoin="miter"
          style={{ filter: `drop-shadow(0 0 4px ${PORT_C})` }} />

        {/* square end markers, arcade style */}
        {bLast != null && <rect x={x(n - 1) - 3} y={y(bLast) - 3} width="6" height="6" fill={benchHex} />}
        <rect x={x(n - 1) - 3} y={y(pLast) - 3} width="6" height="6" fill={PORT_C} />

        {hover != null && hp && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b}
              stroke="rgba(255,255,255,0.30)" strokeWidth="1" />
            <rect x={x(hover) - 3} y={y(hp.v) - 3} width="6" height="6" fill="#fff" />
            {hb && <rect x={x(hover) - 3} y={y(hb.v) - 3} width="6" height="6" fill="#fff" />}
          </>
        )}

        <text x={PAD.l} y={H - 5} fontSize="9" fill="rgba(255,255,255,0.4)">{fmtDate(portfolio[0].d)}</text>
        <text x={W - PAD.r} y={H - 5} fontSize="9" fill="rgba(255,255,255,0.4)" textAnchor="end">
          {fmtDate(portfolio[portfolio.length - 1].d)}
        </text>
      </svg>

      {hover != null && hp && (
        <div className="small" style={{
          position: 'absolute', top: 0, right: 0, background: 'rgba(0,0,0,0.86)',
          border: '1px solid rgba(255,255,255,0.14)', padding: '5px 8px', pointerEvents: 'none',
        }}>
          <div className="muted" style={{ fontSize: 10 }}>{fmtDate(hp.d)}</div>
          <div style={{ color: PORT_C }}>YOU {hp.v.toFixed(1)}</div>
          {hb && <div style={{ color: benchHex }}>{benchLabel.toUpperCase()} {hb.v.toFixed(1)}</div>}
        </div>
      )}
    </div>
  );
}
