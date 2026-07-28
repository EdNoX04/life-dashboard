import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Card, Empty, StatTile } from '../ui.jsx';
import {
  closes, sma, rsi, macd, bollinger, levels, readings, overlayPath,
} from '../../lib/technicals.js';
import { fetchCandles } from '../../lib/marketdata.js';

// The chart-reading half of a stock page.
//
// It is deliberately unexciting about what it produces. Every panel states what
// it measured and how much history it had to measure it with; anything it could
// not compute says so in words rather than drawing a flat line at zero; and the
// summary at the bottom counts how many readings lean each way instead of
// distilling them into one confident verdict.
//
// It never says buy or sell. Those are advice, this is arithmetic on past
// prices, and the gap between the two is the whole point.

const tone = l => (l === 'up' ? 'var(--green)' : l === 'down' ? 'var(--red)' : 'var(--ink-2)');

// ---- price with its overlays, all on one scale ---------------------------

export function PricePanel({ candles = [], height = 210 }) {
  const wrapRef = useRef(null);
  const [cw, setCw] = useState(0);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(es => { const w = es[0]?.contentRect?.width; if (w) setCw(Math.round(w)); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const geo = useMemo(() => {
    const c = closes(candles);
    if (c.length < 2) return null;
    const b = bollinger(c, 20);
    const s50 = sma(c, 50), s200 = sma(c, 200);
    const pool = [...c, ...b.upper, ...b.lower, ...s50, ...s200].filter(v => v != null && Number.isFinite(v));
    let lo = Math.min(...pool), hi = Math.max(...pool);
    if (hi === lo) { lo -= 1; hi += 1; }
    const W = cw || 660, H = height;
    const path = series => overlayPath(series, lo, hi, W, H);
    return {
      W, H, lo, hi,
      price: path(c), s50: path(s50), s200: path(s200),
      up: path(b.upper), down: path(b.lower),
      // A line that never got enough history is absent, not flat at zero. The
      // legend below is generated from what actually drew.
      has: { s50: s50.some(v => v != null), s200: s200.some(v => v != null), bb: b.upper.some(v => v != null) },
    };
  }, [candles, cw, height]);

  if (!geo || !geo.price) {
    return <Empty icon="◔" text="Not enough price history on this feed to draw anything honest." />;
  }

  return (
    <div ref={wrapRef} className="chart-wrap">
      <svg width="100%" height={geo.H} viewBox={`0 0 ${geo.W} ${geo.H}`} shapeRendering="crispEdges"
        style={{ imageRendering: 'pixelated', display: 'block' }}>
        {geo.up && <path d={geo.up} fill="none" stroke="var(--purple)" strokeWidth="1" strokeDasharray="3 3" opacity="0.7" />}
        {geo.down && <path d={geo.down} fill="none" stroke="var(--purple)" strokeWidth="1" strokeDasharray="3 3" opacity="0.7" />}
        {geo.s200 && <path d={geo.s200} fill="none" stroke="var(--orange)" strokeWidth="2" shapeRendering="geometricPrecision" />}
        {geo.s50 && <path d={geo.s50} fill="none" stroke="var(--yellow)" strokeWidth="2" shapeRendering="geometricPrecision" />}
        <path d={geo.price} fill="none" stroke="var(--cyan)" strokeWidth="2" shapeRendering="geometricPrecision"
          style={{ filter: 'drop-shadow(0 0 4px var(--cyan))' }} />
      </svg>
      <div className="tech-legend">
        <span style={{ color: 'var(--cyan)' }}>▬ price</span>
        {geo.has.s50 ? <span style={{ color: 'var(--yellow)' }}>▬ 50d</span>
          : <span className="muted">50d — needs 50 days</span>}
        {geo.has.s200 ? <span style={{ color: 'var(--orange)' }}>▬ 200d</span>
          : <span className="muted">200d — needs 200 days</span>}
        {geo.has.bb ? <span style={{ color: 'var(--purple)' }}>┄ 20d bands</span>
          : <span className="muted">bands — need 20 days</span>}
      </div>
    </div>
  );
}

// ---- RSI, with its zones drawn rather than described ---------------------

export function RsiPanel({ candles = [], height = 74 }) {
  const c = closes(candles);
  const r = rsi(c, 14);
  const pts = r.map((v, i) => ({ v, i })).filter(p => p.v != null);
  if (pts.length < 2) {
    return <div className="small muted">RSI needs 15 days of prices; this series has {c.length}.</div>;
  }
  const W = 660, H = height, pad = 3;
  const x = i => pad + (i / Math.max(1, r.length - 1)) * (W - pad * 2);
  const y = v => H - pad - (v / 100) * (H - pad * 2);
  const d = pts.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
  const last = pts[pts.length - 1].v;
  return (
    <div>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} shapeRendering="crispEdges"
        style={{ imageRendering: 'pixelated', display: 'block' }}>
        <rect x={0} y={y(70)} width={W} height={Math.max(1, y(0) - y(70) - (y(0) - y(30)))} fill="rgba(255,77,109,.07)" />
        <line x1={0} x2={W} y1={y(70)} y2={y(70)} stroke="var(--red)" strokeWidth="1" strokeDasharray="3 3" opacity="0.6" />
        <line x1={0} x2={W} y1={y(30)} y2={y(30)} stroke="var(--green)" strokeWidth="1" strokeDasharray="3 3" opacity="0.6" />
        <path d={d} fill="none" stroke="var(--pink)" strokeWidth="2" shapeRendering="geometricPrecision"
          style={{ filter: 'drop-shadow(0 0 3px var(--pink))' }} />
      </svg>
      <div className="small muted">
        RSI 14 · now {last.toFixed(0)} · 30 and 70 marked. Those lines are conventions, not thresholds
        anything is obliged to respect.
      </div>
    </div>
  );
}

// ---- MACD histogram ------------------------------------------------------

export function MacdPanel({ candles = [], height = 74 }) {
  const c = closes(candles);
  const m = macd(c);
  if (!m) return <div className="small muted">MACD needs 35 days of prices; this series has {c.length}.</div>;
  const bars = m.hist.map((v, i) => ({ v, i })).filter(p => p.v != null);
  if (!bars.length) return <div className="small muted">MACD has not warmed up on this series yet.</div>;
  const W = 660, H = height, pad = 3;
  const mx = Math.max(...bars.map(b => Math.abs(b.v))) || 1;
  const bw = Math.max(1, (W - pad * 2) / m.hist.length - 0.5);
  const zero = H / 2;
  return (
    <div>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} shapeRendering="crispEdges"
        style={{ imageRendering: 'pixelated', display: 'block' }}>
        <line x1={0} x2={W} y1={zero} y2={zero} stroke="var(--border-bright)" strokeWidth="1" />
        {bars.map(b => {
          const h = (Math.abs(b.v) / mx) * (zero - pad);
          return (
            <rect key={b.i} x={pad + (b.i / m.hist.length) * (W - pad * 2)}
              y={b.v >= 0 ? zero - h : zero} width={bw} height={Math.max(1, h)}
              fill={b.v >= 0 ? 'var(--green)' : 'var(--red)'} opacity="0.85" />
          );
        })}
      </svg>
      <div className="small muted">MACD 12/26/9 · bars are the gap between the line and its signal.</div>
    </div>
  );
}

// ---- the desk ------------------------------------------------------------

export default function Technicals({ ticker, price = null }) {
  const [candles, setCandles] = useState(null);
  const [state, setState] = useState('idle');   // idle | loading | done | nokey | fail

  useEffect(() => { setCandles(null); setState('idle'); }, [ticker]);

  async function load() {
    setState('loading');
    try {
      const c = await fetchCandles(ticker, '2Y');
      setCandles(c); setState(c && c.length ? 'done' : 'fail');
    } catch (e) {
      setState(String(e.message) === 'NO_KEY' ? 'nokey' : 'fail');
    }
  }

  const read = useMemo(() => (candles ? readings(candles) : null), [candles]);
  const lv = useMemo(() => (candles ? levels(candles, 5) : null), [candles]);

  return (
    <Card title="Chart reading" color="var(--pink)" right={
      state === 'idle' ? <button className="btn btn-sm btn-pink" onClick={load}>▤ Load chart</button>
        : state === 'loading' ? <span className="small muted">loading…</span>
          : <button className="btn btn-sm" onClick={load}>↻</button>
    }>
      {state === 'idle' && (
        <Empty icon="▤" text="Two years of daily prices, from a feed that allows eight requests a minute — so it loads on request rather than on every modal open." />
      )}
      {state === 'nokey' && (
        <Empty icon="⚿" text="Add a Twelve Data key in Settings to draw the chart. Nothing else on this page needs it." />
      )}
      {state === 'fail' && (
        <Empty icon="⚠" text="That feed returned nothing for this ticker — often the case for Indian listings and for symbols the free tier does not cover." />
      )}

      {(state === 'done' || (state === 'loading' && candles)) && (
        <>
          <PricePanel candles={candles} />
          <div className="mt"><RsiPanel candles={candles} /></div>
          <div className="mt"><MacdPanel candles={candles} /></div>

          {read?.score && (
            <>
              <div className="tile-row mt">
                <StatTile label="LEANING UP" value={String(read.score.up)} color="var(--green)"
                  note={`of ${read.score.judged} readable`} />
                <StatTile label="LEANING DOWN" value={String(read.score.down)} color="var(--red)"
                  note={`of ${read.score.judged} readable`} />
                <StatTile label="NEITHER" value={String(read.score.flat)} color="var(--ink-2)"
                  note={`${read.score.of - read.score.judged} could not be computed`} />
              </div>
              <table className="ptable tech-table mt">
                <tbody>
                  {read.readings.map(r => (
                    <tr key={r.label} className={r.ok ? '' : 'tech-na'}>
                      <td style={{ width: 150 }}>{r.label}</td>
                      <td>
                        <span className="tech-lean" style={{ background: tone(r.lean) }} />
                        {r.text}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {lv && (lv.support.length > 0 || lv.resistance.length > 0) && (
            <div className="mt">
              <div className="stat-label">RECENT SWING LEVELS</div>
              <div className="tech-levels">
                {lv.resistance.map(p => (
                  <span key={`r${p.i}`} className="chip c-red">▲ {p.price.toFixed(2)}</span>
                ))}
                {lv.support.map(p => (
                  <span key={`s${p.i}`} className="chip c-green">▼ {p.price.toFixed(2)}</span>
                ))}
              </div>
              <div className="small muted mt">
                A swing point is only a swing point once there are bars on both sides of it, so the newest
                level here can never be closer than {lv.staleBars} bars to today. These are places price
                turned before. They are not places it has agreed to turn again.
              </div>
            </div>
          )}

          <div className="ai-note mt">
            Every line above is arithmetic on prices that have already happened. None of it forecasts,
            none of it is a recommendation, and the readings routinely disagree with each other — which
            is why this counts them rather than picking one.
          </div>
        </>
      )}
    </Card>
  );
}
