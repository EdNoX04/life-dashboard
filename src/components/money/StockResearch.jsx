import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Card, StatTile, Empty } from '../ui.jsx';
import {
  normaliseEarnings, surpriseRecord, fiscalYears, keyMetrics, fiftyTwoWeek,
  peerTable, versusPeers, totalReturnBreakdown, yearsBetween, cagr,
} from '../../lib/research.js';
import { fetchFundamentals, fetchPeerMetrics, cachedAt, hasKey } from '../../lib/fundamentals.js';

// The research half of a stock page: what it was expected to earn against what
// it earned, what it costs relative to its own history, who it competes with,
// and what holding it has actually returned you.
//
// The rule this screen keeps above all others is that it distinguishes a number
// from the absence of one. Estimated figures are drawn hatched and dashed;
// reported figures are solid. A ratio the feed does not carry is missing from
// the grid rather than present at zero. A peer column that only half the peers
// report says so, under the column.

const fmt = (n, dp = 2, suf = '') =>
  n == null || !Number.isFinite(n) ? '—' : n.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp }) + suf;
const pct = (n, dp = 1) => (n == null || !Number.isFinite(n) ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(dp)}%`);
const cap = n => {
  if (n == null || !Number.isFinite(n)) return '—';
  const a = Math.abs(n);                        // finnhub reports in $ millions
  if (a >= 1e6) return `$${(n / 1e6).toFixed(2)}T`;
  if (a >= 1e3) return `$${(n / 1e3).toFixed(1)}B`;
  return `$${n.toFixed(0)}M`;
};
const tone = n => (n == null ? 'var(--ink-3)' : n > 0 ? 'var(--green)' : n < 0 ? 'var(--red)' : 'var(--ink-2)');

// ---- EPS: reported versus expected --------------------------------------
// The paired-bar chart from the reference, with one addition the reference does
// not make: a quarter nobody has reported yet is hatched, so the eye can tell
// the company's record from the analysts' hopes without reading the axis.
export function EpsChart({ rows = [], height = 190 }) {
  const wrapRef = useRef(null);
  const [cw, setCw] = useState(0);
  const [hover, setHover] = useState(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(es => { const w = es[0]?.contentRect?.width; if (w) setCw(Math.round(w)); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const show = rows.slice(-16);
  const vals = show.flatMap(r => [r.actual, r.estimate].filter(v => v != null));
  if (!show.length || !vals.length) {
    return <Empty icon="◔" text="No earnings history on file for this ticker." />;
  }
  const hi = Math.max(...vals, 0), lo = Math.min(...vals, 0);
  const W = cw || 660, H = height;
  const PAD = { l: 42, r: 6, t: 10, b: 24 };
  const iw = (W - PAD.l - PAD.r) / show.length;
  const bw = Math.max(3, (iw - 7) / 2);
  const span = (hi - lo) * 1.15 || 1;
  const y = v => PAD.t + (1 - (v - lo) / span) * (H - PAD.t - PAD.b);
  const zero = y(0);

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} shapeRendering="crispEdges"
        style={{ imageRendering: 'pixelated', display: 'block' }} onMouseLeave={() => setHover(null)}>
        <defs>
          <pattern id="eps-hatch" width="4" height="4" patternUnits="userSpaceOnUse">
            <rect width="4" height="4" fill="transparent" />
            <path d="M0,4 l4,-4" stroke="var(--cyan)" strokeWidth="1" />
          </pattern>
        </defs>
        <line x1={PAD.l} x2={W - PAD.r} y1={zero} y2={zero} stroke="rgba(255,255,255,0.22)" />
        <text x={PAD.l - 5} y={zero + 3} fontSize="9" textAnchor="end" fill="rgba(255,255,255,0.38)">0</text>
        <text x={PAD.l - 5} y={PAD.t + 8} fontSize="9" textAnchor="end" fill="rgba(255,255,255,0.38)">{hi.toFixed(2)}</text>
        {show.map((r, i) => {
          const x0 = PAD.l + i * iw;
          const on = hover === i;
          const barsFor = (v, x, fill, extra = {}) => {
            if (v == null) return null;
            const top = Math.min(y(v), zero), h = Math.max(1, Math.abs(zero - y(v)));
            return <rect x={x} y={top} width={bw} height={h} fill={fill} {...extra} />;
          };
          return (
            <g key={r.period} onMouseEnter={() => setHover(i)}>
              <rect x={x0} y={PAD.t} width={iw} height={H - PAD.t - PAD.b}
                fill={on ? 'rgba(255,255,255,0.05)' : 'transparent'} />
              {/* Estimate first, in cyan, behind the fact. */}
              {barsFor(r.estimate, x0 + iw / 2 - bw - 1, 'rgba(79,209,255,0.35)',
                { stroke: 'var(--cyan)', strokeWidth: 1, strokeDasharray: '2 2' })}
              {barsFor(r.actual, x0 + iw / 2 + 1,
                r.surprisePct != null && r.surprisePct < 0 ? 'var(--red)' : 'var(--green)',
                { style: { filter: 'drop-shadow(0 0 3px currentColor)' } })}
              {/* Not reported yet: the estimate stands alone, hatched, so an
                  empty slot beside it never reads as a miss. */}
              {r.actual == null && barsFor(r.estimate, x0 + iw / 2 + 1, 'url(#eps-hatch)',
                { stroke: 'var(--cyan)', strokeWidth: 1, strokeDasharray: '2 2' })}
              <text x={x0 + iw / 2} y={H - 8} fontSize="8" textAnchor="middle"
                fill={on ? 'var(--ink)' : 'rgba(255,255,255,0.42)'}>{r.label}</text>
            </g>
          );
        })}
      </svg>
      {hover != null && show[hover] && (
        <div className="div-tip small">
          <div className="muted" style={{ fontSize: 10 }}>
            {show[hover].label}{show[hover].actual == null ? ' · not reported' : ''}
          </div>
          <div style={{ color: 'var(--cyan)' }}>est {fmt(show[hover].estimate)}</div>
          <div style={{ color: 'var(--green)' }}>actual {fmt(show[hover].actual)}</div>
          <div style={{ color: tone(show[hover].surprisePct) }}>
            {show[hover].surprisePct == null ? 'no estimate to beat' : `${pct(show[hover].surprisePct)} surprise`}
          </div>
        </div>
      )}
    </div>
  );
}

// A ratio against its 52-week range, drawn as a track with a marker.
function RangeBar({ low, high, pct: p, labelLow, labelHigh }) {
  return (
    <div className="res-range">
      <div className="res-track"><i style={{ left: `${p}%` }} /></div>
      <div className="spread small muted">
        <span>{labelLow ?? fmt(low)}</span><span>{labelHigh ?? fmt(high)}</span>
      </div>
    </div>
  );
}

// ---- main ---------------------------------------------------------------
export default function StockResearch({ ticker, price, orders = [], divYield = null, cur = '$' }) {
  const [tab, setTab] = useState('estimates');   // estimates | valuation | peers | return
  const [f, setF] = useState(undefined);          // undefined = loading, null = nothing
  const [peers, setPeers] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!ticker) return;
    let dead = false;
    setF(undefined); setPeers(null);
    fetchFundamentals(ticker)
      .then(v => { if (!dead) setF(v || null); })
      .catch(() => { if (!dead) setF(null); });
    return () => { dead = true; };
  }, [ticker]);

  // Peer ratios are a second fan-out, so they only load when the tab is opened.
  useEffect(() => {
    if (tab !== 'peers' || peers || !f?.peers?.length) return;
    let dead = false;
    setBusy(true);
    fetchPeerMetrics(f.peers).then(r => { if (!dead) { setPeers(r); setBusy(false); } })
      .catch(() => { if (!dead) { setPeers([]); setBusy(false); } });
    return () => { dead = true; };
  }, [tab, f, peers]);

  const earnings = useMemo(() => normaliseEarnings(f?.earnings || []), [f]);
  const record = useMemo(() => surpriseRecord(earnings), [earnings]);
  const years = useMemo(() => fiscalYears(earnings, { price }), [earnings, price]);
  const metrics = useMemo(() => keyMetrics(f?.metric || {}), [f]);
  const week52 = useMemo(() => fiftyTwoWeek(f?.metric || {}, price), [f, price]);

  const pt = useMemo(() => {
    if (!peers?.length) return null;
    return peerTable([
      { ticker, name: f?.profile?.name, marketCap: f?.profile?.marketCapitalization, metric: f?.metric, self: true },
      ...peers,
    ]);
  }, [peers, ticker, f]);
  const vs = useMemo(() => (pt ? versusPeers(f?.metric || {}, pt) : []), [pt, f]);

  // What holding it has actually returned. The first buy is the start; anything
  // earlier is somebody else's return.
  const mine = useMemo(() => (orders || []).filter(o => o.ticker === ticker && o.side === 'B')
    .sort((a, b) => (a.date < b.date ? -1 : 1)), [orders, ticker]);
  // If the caller does not know the yield, the ratio blob already fetched for
  // this ticker does. Falling back to it beats quoting a dividend contribution
  // of zero for a company that plainly pays one.
  const yld = useMemo(() => {
    const given = Number(divYield);
    if (Number.isFinite(given) && given > 0) return given;
    const fromFeed = Number(f?.metric?.dividendYieldIndicatedAnnual);
    return Number.isFinite(fromFeed) && fromFeed > 0 ? fromFeed : null;
  }, [divYield, f]);

  const ret = useMemo(() => {
    if (!mine.length || !price) return null;
    const first = mine[0];
    const yrs = yearsBetween(first.date);
    if (yrs == null || yrs <= 0) return null;
    return {
      ...totalReturnBreakdown({ start: Number(first.price), end: Number(price), years: yrs, divYield: yld ?? 0 }),
      since: first.date,
      startPrice: Number(first.price),
    };
  }, [mine, price, yld]);

  const stamp = cachedAt(ticker);

  if (!hasKey()) {
    return (
      <Card title="Research" color="var(--cyan)">
        <Empty icon="◔" text="Add a Finnhub key in Config and the estimates, ratios and peer table fill in here." />
      </Card>
    );
  }

  return (
    <Card title="Research" color="var(--cyan)" right={
      <span className="seg">
        {[['estimates', 'Estimates'], ['valuation', 'Valuation'], ['peers', 'Peers'], ['return', 'My return']].map(([k, l]) => (
          <button key={k} className={`seg-btn${tab === k ? ' on' : ''}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </span>
    }>
      {f === undefined && <div className="small muted">Loading fundamentals…</div>}
      {f === null && <Empty icon="◔" text={`No fundamentals came back for ${ticker}. Normal for ETFs and index funds — they have no earnings of their own.`} />}

      {f && f.partial?.length > 0 && (
        <div className="div-cover">
          <b>Partly covered.</b> No {f.partial.join(', ')} on file for {ticker} — those sections are
          blank rather than filled with zeros. ETFs and funds have no earnings or peers by nature.
        </div>
      )}

      {f && tab === 'estimates' && (
        <>
          <div className="tile-row">
            <StatTile label="BEAT RATE" color="var(--green)" value={pct(record.beatRate, 0)}
              note={record.quarters ? `${record.beats}/${record.quarters} judged quarters` : 'no estimates on file'} />
            <StatTile label="AVG SURPRISE" color={tone(record.avgSurprise)} value={pct(record.avgSurprise)}
              note="against consensus" />
            <StatTile label="MISSES" color="var(--red)" value={String(record.misses)}
              note={`${record.inline} in line`} />
            <StatTile label="LATEST EPS" color="var(--cyan)"
              value={fmt(earnings.filter(r => r.actual != null).slice(-1)[0]?.actual)}
              note={earnings.filter(r => r.actual != null).slice(-1)[0]?.label || '—'} />
          </div>

          <EpsChart rows={earnings} />
          <div className="div-legend small mt">
            <span><i className="div-key solid" /> reported, beat or in line</span>
            <span><i className="res-key miss" /> reported, missed</span>
            <span><i className="div-key est" /> consensus estimate</span>
            <span><i className="res-key wait" /> not reported yet</span>
          </div>

          {years.length > 0 && (
            <div className="scroll-x mt">
              <table className="ptable">
                <thead>
                  <tr>
                    <th>Fiscal year</th>
                    <th style={{ textAlign: 'right' }}>EPS</th>
                    <th style={{ textAlign: 'right' }}>YoY growth</th>
                    <th style={{ textAlign: 'right' }}>P/E at today’s price</th>
                    <th style={{ textAlign: 'right' }}>Quarters</th>
                  </tr>
                </thead>
                <tbody>
                  {[...years].reverse().map(r => (
                    <tr key={r.year} className={r.estimated || r.partial ? 'res-est' : ''}>
                      <td>
                        {r.year}
                        {r.estimated && <span className="chip c-cyan" style={{ marginLeft: 6 }}>est</span>}
                      </td>
                      <td style={{ textAlign: 'right' }}>{fmt(r.eps)}</td>
                      <td style={{ textAlign: 'right', color: tone(r.yoy) }}>{pct(r.yoy)}</td>
                      <td style={{ textAlign: 'right' }}>{r.pe == null ? '—' : fmt(r.pe, 1) + '×'}</td>
                      <td style={{ textAlign: 'right' }} className={r.partial ? 'muted' : ''}>
                        {r.quarters}/4{r.partial ? ' · short' : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="small muted mt">
            A quarter nobody put a number on is left out of the beat rate entirely —
            it is not a beat. Years marked <b>est</b> contain quarters that have not
            been reported, and a year marked <b>short</b> has fewer than four quarters
            on file, so the growth beside it is comparing unequal things.
          </div>
        </>
      )}

      {f && tab === 'valuation' && (
        <>
          {week52 && (
            <div className="mb">
              <div className="spread">
                <div className="plan-flabel">52-WEEK RANGE</div>
                <div className="small">
                  <span style={{ color: tone(week52.offHigh) }}>{pct(week52.offHigh)}</span>
                  <span className="muted"> from the high</span>
                </div>
              </div>
              <RangeBar low={week52.low} high={week52.high} pct={week52.pct}
                labelLow={`${cur}${week52.low.toFixed(2)}`} labelHigh={`${cur}${week52.high.toFixed(2)}`} />
            </div>
          )}

          {!metrics.length && <Empty icon="◔" text="No ratios on file for this ticker." />}
          {metrics.length > 0 && (
            <div className="res-metrics">
              {metrics.map(m => (
                <div key={m.key} className="res-metric" title={m.hint}>
                  <div className="res-mlabel">{m.label}</div>
                  <div className="res-mval">{fmt(m.value, Math.abs(m.value) < 10 ? 2 : 1)}</div>
                  <div className="small muted">{m.hint}</div>
                </div>
              ))}
            </div>
          )}
          <div className="small muted mt">
            Ratios come from the provider’s last filing snapshot{stamp ? `, cached ${new Date(stamp).toLocaleDateString()}` : ''} —
            they are quarterly facts, not live numbers, and a ratio the provider does not carry
            is missing from this grid rather than shown as zero.
          </div>
        </>
      )}

      {f && tab === 'peers' && (
        <>
          {busy && <div className="small muted">Loading peer ratios…</div>}
          {!busy && !pt && <Empty icon="◔" text={`No peer group came back for ${ticker}.`} />}
          {pt && (
            <>
              <div className="scroll-x">
                <table className="ptable">
                  <thead>
                    <tr>
                      <th>Company</th>
                      <th style={{ textAlign: 'right' }}>Market cap</th>
                      {pt.cols.map(c => <th key={c.key} style={{ textAlign: 'right' }}>{c.label}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {pt.rows.map(r => (
                      <tr key={r.ticker} className={r.self ? 'res-self' : ''}>
                        <td>
                          <b style={{ fontWeight: 'normal', color: r.self ? 'var(--yellow)' : 'var(--cyan)' }}>{r.ticker}</b>
                          {r.self && <span className="chip c-yellow" style={{ marginLeft: 6 }}>yours</span>}
                          {r.name && <div className="small muted">{r.name}</div>}
                        </td>
                        <td style={{ textAlign: 'right' }}>{cap(r.marketCap)}</td>
                        {pt.cols.map(c => (
                          <td key={c.key} style={{ textAlign: 'right' }}>
                            {r.values[c.key] == null ? <span className="muted">—</span> : fmt(r.values[c.key], 1)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td className="small muted">Peer median</td>
                      <td />
                      {pt.cols.map(c => (
                        <td key={c.key} style={{ textAlign: 'right' }}>
                          <b>{fmt(c.median, 1)}</b>
                          <div className="small muted">{c.coverage}/{c.of} report</div>
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                </table>
              </div>

              <div className="flex mt" style={{ gap: 8, flexWrap: 'wrap' }}>
                {vs.filter(c => c.deltaPct != null).map(c => (
                  <span key={c.key} className={`chip ${c.deltaPct > 0 ? 'c-orange' : 'c-green'}`}>
                    {c.label} {pct(c.deltaPct, 0)} vs median
                  </span>
                ))}
              </div>

              <div className="small muted mt">
                Each column says how many of the group actually report that figure. A column
                that only some of them report is a comparison between the ones that do —
                ranking on it would be ranking who discloses, not who is cheap. The median is
                used rather than the average so one company on 400× earnings cannot become
                “the industry”.
              </div>
            </>
          )}
        </>
      )}

      {f && tab === 'return' && (
        <>
          {!ret && (
            <Empty icon="▲" text={`No dated buy on file for ${ticker} — import your orders and the since-purchase return appears here.`} />
          )}
          {ret && (
            <>
              <div className="tile-row">
                <StatTile label="TOTAL RETURN" color={tone(ret.totalReturn)} value={pct(ret.totalReturn, 2)}
                  note={`since ${ret.since}`} />
                <StatTile label="CAGR" color="var(--cyan)" value={ret.totalCagr == null ? '—' : pct(ret.totalCagr, 2)}
                  note={ret.reliable ? 'compounded annually' : 'under a year — no annual rate'} />
                <StatTile label="PRICE ALONE" color={tone(ret.priceReturn)} value={pct(ret.priceReturn, 2)}
                  note={`${cur}${ret.startPrice.toFixed(2)} → ${cur}${Number(price).toFixed(2)}`} />
                <StatTile label="FROM DIVIDENDS" color="var(--green)" value={pct(ret.fromDividends, 2)}
                  note={yld ? `reinvested at ~${yld.toFixed(2)}% yield` : 'no yield on file'} />
                <StatTile label="HELD FOR" color="var(--purple)" value={`${ret.years.toFixed(1)}y`}
                  note={`${mine.length} buy${mine.length === 1 ? '' : 's'}`} />
              </div>
              <div className="small muted mt">
                Measured from your first buy at {cur}{ret.startPrice.toFixed(2)}, not from the
                company’s listing. The dividend share is what <i>reinvesting</i> would have added —
                each payment buying shares that then rode every later price move — which is
                always more than the cash you actually received added up.
                {!ret.reliable && ' Held under a year, so no annual rate is quoted: annualising a few months is arithmetic, not a return.'}
              </div>
            </>
          )}
        </>
      )}
    </Card>
  );
}
