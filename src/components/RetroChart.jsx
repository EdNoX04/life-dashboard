import React, { useEffect, useMemo, useRef, useState } from 'react';
import { fetchCandles, TIMEFRAMES, isIntraday } from '../lib/marketdata.js';

const TF_KEYS = TIMEFRAMES.map(t => t[0]); // 1m,5m,...,ALL
const UP = '#2fd06b', DN = '#e84191', GRID = '#3a2b58', AXIS = '#8474a0';
const fmtNum = n => n == null ? '—' : n >= 1000 ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : n.toFixed(2);
const fmtVol = v => v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(0) + 'K' : String(v || 0);

// short axis label for a candle timestamp given the timeframe
function tlabel(t, tf) {
  const d = new Date(t.includes(' ') ? t.replace(' ', 'T') : t);
  if (isNaN(d)) return t;
  if (['1m', '5m', '15m', '30m', '1h', '4h'].includes(tf)) return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  if (['1D', '1W', '1M', '3M', '6M', '1Y'].includes(tf)) return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
  return "'" + String(d.getFullYear()).slice(2);
}

export default function RetroChart({ ticker, live = null, marketOpen = false, defaultTf = '1D' }) {
  const wrapRef = useRef(null);
  const [w, setW] = useState(680);
  const [tf, setTf] = useState(defaultTf);
  const [candles, setCandles] = useState([]);
  const [state, setState] = useState('loading'); // loading | ok | nokey | error
  const [err, setErr] = useState('');
  const [hover, setHover] = useState(null); // index

  useEffect(() => {
    const el = wrapRef.current; if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(es => { const x = es[0]?.contentRect?.width; if (x) setW(Math.round(x)); });
    ro.observe(el); return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let dead = false;
    setState('loading'); setHover(null);
    fetchCandles(ticker, tf)
      .then(c => { if (dead) return; setCandles(c); setState(c.length ? 'ok' : 'error'); if (!c.length) setErr('No data for this range'); })
      .catch(e => { if (dead) return; setState(e.message === 'NO_KEY' ? 'nokey' : 'error'); setErr(e.message || 'fetch failed'); });
    return () => { dead = true; };
  }, [ticker, tf]);

  // refresh intraday candles periodically while the market is open
  useEffect(() => {
    if (!marketOpen || !isIntraday(tf)) return;
    const id = setInterval(() => {
      fetchCandles(ticker, tf).then(c => c.length && setCandles(c)).catch(() => {});
    }, 30000);
    return () => clearInterval(id);
  }, [ticker, tf, marketOpen]);

  // splice the live tick into the last candle so the chart breathes in real time
  const data = useMemo(() => {
    if (!candles.length) return candles;
    if (live == null || !marketOpen || !isIntraday(tf)) return candles;
    const out = candles.slice();
    const last = { ...out[out.length - 1] };
    last.c = live; last.h = Math.max(last.h, live); last.l = Math.min(last.l, live);
    out[out.length - 1] = last;
    return out;
  }, [candles, live, marketOpen, tf]);

  const H = 300, padT = 12, padB = 22, padR = 54, padL = 6, volH = 46;
  const priceTop = padT, priceBot = H - padB - volH, priceH = priceBot - priceTop;
  const volTop = priceBot + 8, volBot = H - padB;
  const chartW = w - padL - padR;

  const view = useMemo(() => {
    if (!data.length) return null;
    let lo = Infinity, hi = -Infinity, vmax = 0;
    for (const c of data) { lo = Math.min(lo, c.l); hi = Math.max(hi, c.h); vmax = Math.max(vmax, c.v || 0); }
    const pad = (hi - lo) * 0.08 || hi * 0.02 || 1; lo -= pad; hi += pad;
    const n = data.length;
    const step = chartW / n;
    const cw = Math.max(1.5, Math.min(14, step * 0.64));
    const x = i => padL + step * (i + 0.5);
    const y = p => priceTop + (1 - (p - lo) / (hi - lo || 1)) * priceH;
    const vy = v => volBot - (v / (vmax || 1)) * (volBot - volTop);
    return { lo, hi, vmax, n, step, cw, x, y, vy };
  }, [data, w]); // eslint-disable-line

  const first = data[0], last = data[data.length - 1];
  const up = first && last ? last.c >= first.o : true;
  const chg = first && last ? last.c - first.o : 0;
  const chgPct = first && first.o ? (chg / first.o) * 100 : 0;
  const hc = hover != null ? data[hover] : last;

  const priceTicks = view ? [0, 0.25, 0.5, 0.75, 1].map(f => view.lo + (view.hi - view.lo) * f) : [];
  const xTickIdx = view ? Array.from({ length: Math.min(6, view.n) }, (_, k) => Math.round(k * (view.n - 1) / (Math.min(6, view.n) - 1 || 1))) : [];

  return (
    <div className="rchart">
      <div className="tf-row">
        {TF_KEYS.map(k => (
          <button key={k} className={`tf-btn${tf === k ? ' on' : ''}`} onClick={() => setTf(k)}>{k}</button>
        ))}
      </div>

      <div className="rchart-head">
        <span className="rc-oclc">
          <b style={{ color: up ? UP : DN }}>{ticker}</b>
          <span className="muted"> {tf} · </span>
          O<span style={{ color: AXIS }}>{fmtNum(hc?.o)}</span>
          H<span style={{ color: UP }}>{fmtNum(hc?.h)}</span>
          L<span style={{ color: DN }}>{fmtNum(hc?.l)}</span>
          C<span style={{ color: up ? UP : DN }}>{fmtNum(hc?.c)}</span>
          <span style={{ color: chg >= 0 ? UP : DN }}> {chg >= 0 ? '+' : ''}{fmtNum(chg)} ({chgPct >= 0 ? '+' : ''}{chgPct.toFixed(2)}%)</span>
        </span>
        {marketOpen && isIntraday(tf) && <span className="rc-live"><span className="rc-dot" />LIVE</span>}
      </div>

      <div ref={wrapRef} style={{ width: '100%' }}>
        {state === 'loading' && <div className="rc-msg muted">◌ loading {ticker} {tf}…</div>}
        {state === 'nokey' && <div className="rc-msg muted">Add a free Twelve Data key in Settings to load candles.</div>}
        {state === 'error' && <div className="rc-msg muted">⚠ {err}</div>}
        {state === 'ok' && view && (
          <svg width={w} height={H} style={{ display: 'block' }}
            onMouseLeave={() => setHover(null)}
            onMouseMove={e => {
              const rect = e.currentTarget.getBoundingClientRect();
              const px = e.clientX - rect.left;
              const i = Math.max(0, Math.min(view.n - 1, Math.round((px - padL) / view.step - 0.5)));
              setHover(i);
            }}>
            {/* price grid + right-axis labels */}
            {priceTicks.map((p, i) => (
              <g key={'p' + i}>
                <line x1={padL} y1={view.y(p)} x2={w - padR} y2={view.y(p)} stroke={GRID} strokeWidth="1" strokeDasharray="2 5" />
                <text x={w - padR + 6} y={view.y(p) + 4} fontSize="11" fill={AXIS} fontFamily="VT323, monospace">{fmtNum(p)}</text>
              </g>
            ))}
            {/* x-axis time labels */}
            {xTickIdx.map((idx, i) => (
              <text key={'x' + i} x={view.x(idx)} y={H - 7} fontSize="10.5" fill={AXIS} fontFamily="VT323, monospace" textAnchor="middle">{tlabel(data[idx].t, tf)}</text>
            ))}
            {/* volume bars */}
            {data.map((c, i) => (
              <rect key={'v' + i} x={view.x(i) - view.cw / 2} y={view.vy(c.v || 0)} width={view.cw} height={Math.max(0, volBot - view.vy(c.v || 0))}
                fill={c.c >= c.o ? UP : DN} opacity="0.28" />
            ))}
            {/* candles */}
            {data.map((c, i) => {
              const col = c.c >= c.o ? UP : DN;
              const yO = view.y(c.o), yC = view.y(c.c);
              const top = Math.min(yO, yC), bh = Math.max(1.5, Math.abs(yC - yO));
              return (
                <g key={i}>
                  <line x1={view.x(i)} y1={view.y(c.h)} x2={view.x(i)} y2={view.y(c.l)} stroke={col} strokeWidth="1.2" />
                  <rect x={view.x(i) - view.cw / 2} y={top} width={view.cw} height={bh} fill={col} shapeRendering="crispEdges" />
                </g>
              );
            })}
            {/* last price marker line */}
            {last && (
              <g>
                <line x1={padL} y1={view.y(last.c)} x2={w - padR} y2={view.y(last.c)} stroke={up ? UP : DN} strokeWidth="1" strokeDasharray="1 3" opacity=".7" />
                <rect x={w - padR} y={view.y(last.c) - 9} width={padR} height={18} fill={up ? UP : DN} />
                <text x={w - padR + 5} y={view.y(last.c) + 4} fontSize="11" fill="#12091b" fontFamily="VT323, monospace" fontWeight="bold">{fmtNum(last.c)}</text>
              </g>
            )}
            {/* crosshair */}
            {hover != null && data[hover] && (
              <line x1={view.x(hover)} y1={priceTop} x2={view.x(hover)} y2={volBot} stroke="#7a55b0" strokeWidth="1" strokeDasharray="2 3" />
            )}
          </svg>
        )}
      </div>

      {state === 'ok' && hc && (
        <div className="rc-foot small muted">
          <span>{hc.t}</span>
          <span>Vol {fmtVol(hc.v)}</span>
          <span>range {fmtNum(view?.lo)}–{fmtNum(view?.hi)}</span>
        </div>
      )}
    </div>
  );
}
