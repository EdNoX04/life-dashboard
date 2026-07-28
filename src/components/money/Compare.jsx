import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Card, StatTile, Empty } from '../ui.jsx';
import {
  COMPARE_METRICS, compareRows, tally, rebaseAll, chartPaths,
  MAX_SIDES, SIDE_COLORS, fmtMetric,
} from '../../lib/compare.js';
import { fetchFundamentals, hasKey } from '../../lib/fundamentals.js';
import { fetchCandles } from '../../lib/marketdata.js';

// Two to four companies, side by side.
//
// The whole screen is built to make one thing impossible: a confident-looking
// verdict resting on numbers that were never comparable. So a metric row that
// any side does not report is drawn dimmed and crowns nobody; beta and yield
// crown nobody even when everyone reports them, because neither end of those is
// better; and the tally at the top always says what it was counted out of.
//
// It is a description, not a recommendation. Nothing here tells you what to buy.

const cap = n => {
  if (n == null || !Number.isFinite(n)) return '—';
  const a = Math.abs(n);                        // finnhub reports in $ millions
  if (a >= 1e6) return `$${(n / 1e6).toFixed(2)}T`;
  if (a >= 1e3) return `$${(n / 1e3).toFixed(1)}B`;
  return `$${n.toFixed(0)}M`;
};
const pct = (n, dp = 2) => (n == null || !Number.isFinite(n) ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(dp)}%`);
const tone = n => (n == null ? 'var(--ink-3)' : n > 0 ? 'var(--green)' : n < 0 ? 'var(--red)' : 'var(--ink-2)');

// ---- the rebased chart ---------------------------------------------------

// One scale, one start line, one shared window. The alternative — each series
// on its own axis — is the most reliable way to make a worse performer look
// like a better one.
export function VersusLines({ rebased, colorOf, height = 200 }) {
  const wrapRef = useRef(null);
  const [cw, setCw] = useState(0);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(es => { const w = es[0]?.contentRect?.width; if (w) setCw(Math.round(w)); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const geo = useMemo(
    () => chartPaths(rebased, cw || 660, height),
    [rebased, cw, height],
  );

  if (!geo) {
    return (
      <Empty icon="◈" text="No window these companies share yet — load the price shapes, or pick names whose listings overlap." />
    );
  }

  const days = Math.round((rebased.to - rebased.from) / 86400e3);

  return (
    <div ref={wrapRef} className="chart-wrap">
      <svg width="100%" height={geo.h} viewBox={`0 0 ${geo.w} ${geo.h}`} shapeRendering="crispEdges"
        style={{ imageRendering: 'pixelated', display: 'block' }}>
        {/* The line every series started on. Above it is a gain since the day
            they were all quotable; below it is a loss. */}
        {geo.baseY != null && (
          <line x1={0} x2={geo.w} y1={geo.baseY} y2={geo.baseY}
            stroke="var(--border-bright)" strokeWidth="1" strokeDasharray="3 3" />
        )}
        {geo.paths.map(p => (
          <g key={p.ticker}>
            <path d={p.d} fill="none" stroke={colorOf(p.ticker)} strokeWidth="2"
              shapeRendering="geometricPrecision"
              style={{ filter: `drop-shadow(0 0 4px ${colorOf(p.ticker)})` }} />
            <rect x={p.end.x - 2} y={p.end.y - 2} width="4" height="4" fill={colorOf(p.ticker)} />
          </g>
        ))}
      </svg>
      <div className="flex small muted" style={{ gap: 12, flexWrap: 'wrap', marginTop: 4 }}>
        <span>indexed to 100 at the shared start · {days} days both quotable</span>
        {geo.paths.map(p => (
          <span key={p.ticker} style={{ color: colorOf(p.ticker) }}>
            {p.ticker} {pct(p.change)}
          </span>
        ))}
      </div>
    </div>
  );
}

// ---- the metric grid -----------------------------------------------------

export function MetricGrid({ rows = [], sides = [], colorOf }) {
  if (!sides.length) return null;
  return (
    <div className="scroll-x">
      <table className="ptable cmp-table">
        <thead>
          <tr>
            <th style={{ minWidth: 150 }}>Metric</th>
            {sides.map(s => (
              <th key={s.ticker} style={{ color: colorOf(s.ticker), textAlign: 'right' }}>{s.ticker}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.key} className={r.complete ? '' : 'cmp-thin'} title={r.hint}>
              <td>
                {r.label}
                {/* A row nobody can win says why, right where the winner would
                    otherwise have been marked. */}
                {!r.complete && <span className="cmp-note"> · {r.coverage}/{r.of} report</span>}
                {r.complete && r.dir === 'none' && <span className="cmp-note"> · descriptive</span>}
              </td>
              {sides.map(s => {
                const v = r.values[s.ticker];
                const win = r.best === s.ticker;
                const lose = r.worst === s.ticker;
                return (
                  <td key={s.ticker} style={{ textAlign: 'right' }}
                    className={win ? 'cmp-win' : lose ? 'cmp-lose' : ''}>
                    <span style={{ color: v == null ? 'var(--ink-3)' : win ? 'var(--green)' : 'var(--ink)' }}>
                      {fmtMetric(v, r.fmt)}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---- the desk ------------------------------------------------------------

export default function Compare({ holdings = [], quotes = {} }) {
  const owned = useMemo(() => {
    const seen = new Set();
    return holdings
      .map(h => String(h.ticker || '').toUpperCase())
      .filter(t => t && !seen.has(t) && seen.add(t));
  }, [holdings]);

  const [picked, setPicked] = useState(() => owned.slice(0, 2));
  const [typed, setTyped] = useState('');
  const [data, setData] = useState({});         // ticker -> fundamentals blob
  const [loading, setLoading] = useState(false);
  const [series, setSeries] = useState({});     // ticker -> candles
  const [chartState, setChartState] = useState('idle');  // idle|loading|done|nokey
  const [done, setDone] = useState(0);

  // Seed from the book once it arrives, but never overwrite a choice already
  // made — a list that reshuffles under the cursor is worse than an empty one.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !owned.length) return;
    seeded.current = true;
    setPicked(p => (p.length ? p : owned.slice(0, 2)));
  }, [owned]);

  useEffect(() => {
    let dead = false;
    const missing = picked.filter(t => !data[t]);
    if (!missing.length) return;
    setLoading(true);
    (async () => {
      for (const t of missing) {
        const f = await fetchFundamentals(t);
        if (dead) return;
        setData(d => ({ ...d, [t]: f || null }));
      }
      if (!dead) setLoading(false);
    })();
    return () => { dead = true; };
  }, [picked, data]);

  const sides = useMemo(() => picked.map(t => {
    const f = data[t];
    const q = quotes[t] || {};
    return {
      ticker: t,
      name: f?.profile?.name || t,
      metric: f?.metric || null,
      marketCap: f?.profile?.marketCapitalization ?? null,
      price: q.price ?? null,
      changePct: q.changePct ?? null,
      mine: owned.includes(t),
      loaded: data[t] !== undefined,
    };
  }), [picked, data, quotes, owned]);

  const colorOf = t => SIDE_COLORS[picked.indexOf(t)] || 'var(--ink-2)';

  const rows = useMemo(() => compareRows(sides), [sides]);
  const score = useMemo(() => tally(rows, sides), [rows, sides]);
  const rebased = useMemo(() => rebaseAll(series), [series]);

  function add(raw) {
    const t = String(raw || '').trim().toUpperCase();
    if (!t || picked.includes(t) || picked.length >= MAX_SIDES) return;
    setPicked(p => [...p, t]);
    setTyped('');
    // The chart is only true for the set it was loaded for, so adding a name
    // retires it rather than leaving a stale picture beside fresh ratios.
    setSeries({}); setChartState('idle');
  }
  function drop(t) {
    setPicked(p => p.filter(x => x !== t));
    setSeries({}); setChartState('idle');
  }

  // Price shapes come from the 8-requests-a-minute provider, so they are asked
  // for rather than assumed — four charts is half a minute of its budget.
  async function loadChart() {
    setChartState('loading'); setDone(0);
    const acc = {}; let n = 0;
    for (const t of picked) {
      try {
        const c = await fetchCandles(t, '1Y');
        acc[t] = c;
        setSeries({ ...acc });
      } catch (e) {
        if (String(e.message) === 'NO_KEY') { setChartState('nokey'); return; }
        acc[t] = null;
      }
      setDone(++n);
      if (n < picked.length) await new Promise(r => setTimeout(r, 8200));
    }
    setChartState('done');
  }

  if (!hasKey()) {
    return (
      <Card title="Head to head" color="var(--cyan)">
        <Empty icon="⚿" text="Add a Finnhub key in Settings and this compares any two to four companies on the same ratios." />
      </Card>
    );
  }

  return (
    <>
      <Card title="Head to head" color="var(--cyan)" right={
        picked.length >= 2 && chartState === 'idle'
          ? <button className="btn btn-sm btn-cyan" onClick={loadChart}>▤ Load price shapes</button>
          : chartState === 'loading'
            ? <span className="small muted">{done} of {picked.length}…</span>
            : null
      }>
        <div className="cmp-picker">
          {picked.map(t => (
            <span key={t} className="cmp-pill" style={{ borderColor: colorOf(t), color: colorOf(t) }}>
              {t}
              <button className="cmp-x" onClick={() => drop(t)} title={`Remove ${t}`}>×</button>
            </span>
          ))}
          {picked.length < MAX_SIDES && (
            <form onSubmit={e => { e.preventDefault(); add(typed); }} style={{ display: 'inline-flex', gap: 4 }}>
              <input className="plan-fin cmp-in" value={typed} placeholder="TICKER"
                onChange={e => setTyped(e.target.value.toUpperCase())} maxLength={12} />
              <button className="btn btn-sm" type="submit">+</button>
            </form>
          )}
        </div>

        {owned.length > 0 && (
          <div className="flex small muted mt" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <span>From your book:</span>
            {owned.filter(t => !picked.includes(t)).slice(0, 14).map(t => (
              <button key={t} className="btn btn-sm" onClick={() => add(t)}
                disabled={picked.length >= MAX_SIDES}>{t}</button>
            ))}
          </div>
        )}

        {picked.length < 2 && (
          <div className="mt"><Empty icon="⇄" text="Pick at least two companies. Four is the most this compares at once — a fifth column stops being readable." /></div>
        )}

        {picked.length >= 2 && (
          <>
            <div className="tile-row mt">
              {score.rows.map(r => (
                <StatTile key={r.ticker} label={r.ticker} color={colorOf(r.ticker)}
                  value={`${r.wins} / ${score.of}`}
                  note={score.of ? 'metrics led' : 'nothing comparable yet'} />
              ))}
            </div>
            {/* Decision 5, on screen: the tally is worth nothing without the
                count of rows it could not judge. */}
            <div className="small muted mt">
              Counted across {score.of} metric{score.of === 1 ? '' : 's'} every name reports and where one
              direction is actually better. {score.skipped > 0 && <>{score.skipped} row{score.skipped === 1 ? ' was' : 's were'} left out
              because at least one company does not report {score.skipped === 1 ? 'it' : 'them'}. </>}
              {score.ties > 0 && <>{score.ties} ended level. </>}
              Beta and dividend yield are shown but never scored — neither end of either is better, they
              are different things to own.
            </div>
          </>
        )}
      </Card>

      {picked.length >= 2 && (
        <Card title="Since they were all quotable" color="var(--pink)" className="mt">
          {chartState === 'idle' && (
            <Empty icon="▤" text="Price shapes are a separate feed on a tight free-tier budget, so they load on request. One request per company, paced eight a minute." />
          )}
          {chartState === 'nokey' && (
            <Empty icon="⚿" text="Add a Twelve Data key in Settings to draw the price lines. The ratios above do not need it." />
          )}
          {(chartState === 'loading' || chartState === 'done') && (
            <VersusLines rebased={rebased} colorOf={colorOf} />
          )}
          <div className="small muted mt">
            Every line is rebased to 100 on the first day all of them were trading, not on each one’s own
            first day — otherwise a company that listed last year would appear to have sat flat through
            the years before it existed.
          </div>
        </Card>
      )}

      {picked.length >= 2 && (
        <Card title="The numbers" color="var(--yellow)" className="mt"
          right={loading ? <span className="small muted">loading…</span> : null}>
          <MetricGrid rows={rows} sides={sides} colorOf={colorOf} />
          <div className="div-legend mt">
            <span className="div-key solid" /> <span className="small muted">led on this metric</span>
            <span className="cmp-key thin" /> <span className="small muted">not every name reports it — dimmed, and nobody is credited</span>
          </div>
          <div className="small muted mt">
            Winning a row means one number is lower where lower is cheaper, or higher where higher is
            stronger. It does not mean the company is better, and none of this is a recommendation —
            a low P/E is equally the signature of a bargain and of a business the market has given up on.
          </div>
        </Card>
      )}
    </>
  );
}
