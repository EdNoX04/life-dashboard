import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Card, StatTile, Empty } from '../ui.jsx';
import {
  normaliseEarnings, beatRate, timeline, coverage, barScale,
} from '../../lib/estimates.js';
import { fetchFundamentals, fetchEstimates, cachedAt, hasKey } from '../../lib/fundamentals.js';

// The Estimates screen: fiscal-year earnings, reported and forecast, side by side.
//
// The whole design problem here is one of typography rather than arithmetic. The
// numbers are easy; what is hard is making sure that after five seconds of looking
// at this screen you could not possibly be confused about which figures happened
// and which ones are somebody's guess. Every device on the page is spent on that
// one distinction:
//
//   * reported years are SOLID bars; forecast years are HOLLOW with a dashed edge
//   * reported years are green; forecast years are purple — never the same hue
//   * the table stamps every row with a chip that says which it is
//   * the forward P/E column is empty for reported years, because a forward P/E of
//     a year that already happened is a category error, not a missing number
//   * the legend says it in words as well, because not everyone reads a chart
//
// The reference screen runs its bars from 2017 to 2031 without ever marking where
// the past stops. This one draws a line there.

const fmt = (n, dp = 2) =>
  n == null || !Number.isFinite(n) ? '—' : n.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
const pct = (n, dp = 1) => (n == null || !Number.isFinite(n) ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(dp)}%`);
const tone = n => (n == null ? 'var(--ink-3)' : n > 0 ? 'var(--green)' : n < 0 ? 'var(--red)' : 'var(--ink-2)');

const ACTUAL = 'var(--green)';
const ESTIMATE = 'var(--purple)';

// ---- The paired bar chart ------------------------------------------------
// Reported and forecast share one vertical scale — that is the entire reason to
// put them on one chart — but they never share a bar, a colour or a fill.
export function EpsBars({ rows = [], height = 210 }) {
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
  if (!show.length) return <Empty icon="◔" text="No fiscal-year earnings on file for this ticker." />;

  const sc = barScale(show);
  const W = cw || 680, H = height;
  const PAD = { l: 44, r: 8, t: 12, b: 26 };
  const iw = (W - PAD.l - PAD.r) / show.length;
  const bw = Math.max(4, iw - 9);
  const span = sc.span * 1.12 || 1;
  const y = v => PAD.t + (1 - (v - sc.min) / span) * (H - PAD.t - PAD.b);
  const zero = y(0);

  // Where the reported years end and the forecasts begin. Drawn as a wall, because
  // it is the most important fact on the chart and the reference omits it entirely.
  const firstEst = show.findIndex(r => r.kind === 'estimate');
  const wallX = firstEst > 0 ? PAD.l + firstEst * iw : null;

  return (
    <div className="chart-wrap px" ref={wrapRef} style={{ position: 'relative' }}>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} shapeRendering="crispEdges"
        style={{ imageRendering: 'pixelated', display: 'block' }}>
        {[0, 0.25, 0.5, 0.75, 1].map(f => {
          const v = sc.min + f * span;
          return (
            <g key={f}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth="1" strokeDasharray="2 4" />
              <text x={PAD.l - 5} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--ink-3)"
                fontFamily="'VT323', monospace">{v.toFixed(1)}</text>
            </g>
          );
        })}
        <line x1={PAD.l} x2={W - PAD.r} y1={zero} y2={zero} stroke="var(--border-bright)" strokeWidth="2" />

        {wallX != null && (
          <g>
            <line x1={wallX} x2={wallX} y1={PAD.t} y2={H - PAD.b} stroke="var(--orange)" strokeWidth="2" strokeDasharray="4 3" />
            <text x={wallX + 4} y={PAD.t + 10} fontSize="11" fill="var(--orange)" fontFamily="'VT323', monospace">
              forecast →
            </text>
          </g>
        )}

        {show.map((r, i) => {
          const est = r.kind === 'estimate';
          const v = r.eps;
          if (v == null) return null;
          const x = PAD.l + i * iw + (iw - bw) / 2;
          const top = Math.min(y(v), zero), h = Math.max(2, Math.abs(y(v) - zero));
          const c = est ? ESTIMATE : ACTUAL;
          return (
            <g key={r.year} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={PAD.l + i * iw} y={PAD.t} width={iw} height={H - PAD.t - PAD.b} fill="transparent" />
              <rect
                x={x} y={top} width={bw} height={h}
                // Decision 1, made visible: a forecast is hollow. You can see straight
                // through it, which is exactly the right impression.
                fill={est ? 'transparent' : c}
                stroke={c} strokeWidth="2" strokeDasharray={est ? '3 2' : undefined}
                style={{ filter: `drop-shadow(0 0 ${hover === i ? 6 : 3}px ${c})` }}
              />
              {/* The estimate that stood before a reported year, as a thin marker.
                  It is deliberately not a bar: it is a memory of what was expected,
                  not a second measurement of what happened. */}
              {!est && r.estimate != null && (
                <line x1={x - 2} x2={x + bw + 2} y1={y(r.estimate)} y2={y(r.estimate)}
                  stroke="var(--cyan)" strokeWidth="2" strokeDasharray="2 2" />
              )}
              <text x={PAD.l + i * iw + iw / 2} y={H - 8} textAnchor="middle" fontSize="11"
                fill={est ? ESTIMATE : 'var(--ink-3)'} fontFamily="'VT323', monospace">
                {String(r.year).slice(2)}
              </text>
            </g>
          );
        })}
      </svg>

      {hover != null && show[hover] && (
        <div className="est-tip">
          <b>FY{show[hover].year}</b> · {show[hover].kind === 'estimate' ? 'analyst estimate' : 'reported'}
          {show[hover].partial ? ' (partial year)' : ''}
          <br />EPS {fmt(show[hover].eps)}
          {show[hover].kind === 'actual' && show[hover].estimate != null &&
            <> · expected {fmt(show[hover].estimate)}</>}
          {show[hover].analysts != null && <> · {show[hover].analysts} analysts</>}
        </div>
      )}

      <div className="est-legend small">
        <span><i className="est-key est-key-actual" /> solid = reported</span>
        <span><i className="est-key est-key-est" /> hollow = analyst estimate</span>
        <span><i className="est-key est-key-prior" /> dashes on a reported bar = what was expected of it</span>
      </div>
    </div>
  );
}

// ---- The record against the bar ------------------------------------------
export function BeatStrip({ record }) {
  if (!record || !record.judged) {
    return (
      <div className="small muted">
        No quarter in this history had a published estimate standing before it, so there is no
        beat record to report. That is an absence of data, not a record of failure.
      </div>
    );
  }
  return (
    <>
      <div className="tile-row">
        <StatTile label="Beat rate" value={pct(record.pct, 0).replace('+', '')} color="green"
          note={`${record.beats} of ${record.judged} quarters`} />
        <StatTile label="Missed" value={String(record.misses)} color="red" note="came in under" />
        <StatTile label="Exactly inline" value={String(record.inline)} color="cyan" note="landed on the number" />
        <StatTile label="No estimate" value={String(record.unjudged)} color="orange"
          note="excluded from the rate" />
      </div>
      {record.unjudged > 0 && (
        <div className="small muted mt">
          {record.unjudged} quarter{record.unjudged === 1 ? '' : 's'} had no published estimate and
          {record.unjudged === 1 ? ' is' : ' are'} left out of the rate entirely rather than counted as a
          beat. A company with two covered quarters and eight uncovered ones can otherwise show a
          perfect record it never earned.
        </div>
      )}
    </>
  );
}

// ---- FISCAL YEAR / EPS / YoY GROWTH / FWD P/E / ANALYSTS -------------------
export function EstimateTable({ rows = [] }) {
  if (!rows.length) return null;
  return (
    <div className="scroll-x">
      <table className="ptable est-table">
        <thead>
          <tr>
            <th>Fiscal year</th><th></th><th>EPS</th><th>YoY growth</th><th>Fwd P/E</th><th>Analysts</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const est = r.kind === 'estimate';
            return (
              <tr key={r.year} className={est ? 'est-row-est' : ''}>
                <td><b>FY{r.year}</b></td>
                <td>
                  <span className={`chip ${est ? 'c-purple' : 'c-green'}`}>{est ? 'EST' : 'REPORTED'}</span>
                  {r.partial && <span className="chip c-orange" style={{ marginLeft: 4 }}>PARTIAL</span>}
                </td>
                <td style={{ color: est ? ESTIMATE : 'var(--ink)' }}>
                  {fmt(r.eps)}
                  {est && r.low != null && r.high != null &&
                    <span className="muted small"> ({fmt(r.low)}–{fmt(r.high)})</span>}
                </td>
                {/* Decision 5: where growth cannot be computed the cell says WHY.
                    A dash alone reads as "we did not bother"; the reason reads as
                    "this number would have been a lie". */}
                <td style={{ color: tone(r.growth?.pct) }}>
                  {r.growth?.pct != null ? pct(r.growth.pct) : <span className="muted small">{r.growth?.reason || '—'}</span>}
                </td>
                {/* Decision 4: a reported year has no forward P/E — not a missing
                    one, an inapplicable one. The two are written differently. */}
                <td>
                  {!est
                    ? <span className="muted small">n/a — reported</span>
                    : r.fpe?.pe != null
                      ? `${r.fpe.pe.toFixed(1)}×`
                      : <span className="muted small">{r.fpe?.reason || 'no price'}</span>}
                </td>
                {/* Decision 6: the count is never hidden, and a thin one is coloured. */}
                <td>
                  {r.analysts == null
                    ? <span className="muted small">{est ? 'count not published' : '—'}</span>
                    : <span style={{ color: r.analysts < 5 ? 'var(--orange)' : 'var(--ink-2)' }}>
                        {r.analysts}{r.analysts < 5 ? ' — thin' : ''}
                      </span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---- What this screen cannot see -----------------------------------------
export function CoverageNote({ cov, status, ticker }) {
  if (!cov) return null;
  if (!cov.forwardMissing) return null;
  // The distinction the whole `coverage` function exists for.
  if (cov.forwardBlocked) {
    return (
      <div className="est-warn small">
        No forward years are shown because the analyst-estimate endpoint is not included on this
        data plan — not because nobody covers {ticker}. The reported history above is complete and
        unaffected; only the forecast half is missing, and it is missing for a billing reason
        rather than a factual one.
      </div>
    );
  }
  if (status === 'nokey') {
    return (
      <div className="est-warn small">
        No market-data key is configured, so nothing forward-looking can be fetched. Add one in
        Config and this section fills in.
      </div>
    );
  }
  return (
    <div className="small muted">
      The data provider returned no forward estimates for {ticker}. For a small or newly listed
      company that usually means no analyst publishes one, which is itself worth knowing.
    </div>
  );
}

// ---- The screen ----------------------------------------------------------
export default function Estimates({ ticker, price = null }) {
  const [fund, setFund] = useState(undefined);
  const [est, setEst] = useState(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!ticker) return;
    let dead = false;
    setFund(undefined); setEst(undefined);
    fetchFundamentals(ticker).then(v => { if (!dead) setFund(v || null); }).catch(() => { if (!dead) setFund(null); });
    fetchEstimates(ticker).then(v => { if (!dead) setEst(v || null); }).catch(() => { if (!dead) setEst(null); });
    return () => { dead = true; };
  }, [ticker]);

  async function refresh() {
    setBusy(true);
    try {
      const [a, b] = await Promise.all([
        fetchFundamentals(ticker, { force: true }),
        fetchEstimates(ticker, { force: true }),
      ]);
      setFund(a || null); setEst(b || null);
    } catch {}
    setBusy(false);
  }

  const quarters = useMemo(() => normaliseEarnings(fund?.earnings || []), [fund]);
  const record = useMemo(() => beatRate(quarters), [quarters]);
  const rows = useMemo(
    () => timeline({ earnings: fund?.earnings || [], forward: est?.forward || [], price }),
    [fund, est, price],
  );
  const status = est?.forwardStatus || (hasKey() ? null : 'nokey');
  const cov = useMemo(
    () => coverage(rows, { hadForwardEndpoint: status === 'ok' }),
    [rows, status],
  );

  const at = ticker ? cachedAt(ticker) : null;
  const loading = fund === undefined || est === undefined;

  return (
    <Card
      title="Earnings & estimates"
      color="var(--purple)"
      right={
        <div className="flex" style={{ gap: 6, alignItems: 'center' }}>
          {at && <span className="small muted">as of {new Date(at).toLocaleDateString('en-IN')}</span>}
          <button className="btn btn-sm" onClick={refresh} disabled={busy || !ticker}>{busy ? '…' : '↻'}</button>
        </div>
      }
    >
      {/* Stated once, at the top, in words. Everything below is coloured to match. */}
      <div className="small muted mb">
        Green and solid is what the company reported. Purple and hollow is what analysts expect it
        to report. Nothing on this screen is a forecast this app made — every forward number is
        somebody else's published estimate, and it is only as good as they are.
      </div>

      {loading && <div className="small muted">Reading earnings history for {ticker}…</div>}

      {!loading && !rows.length && (
        <Empty icon="◔" text={`No earnings history or estimates on file for ${ticker || 'this ticker'}. ETFs and index funds have neither — they hold companies, they are not one.`} />
      )}

      {!loading && rows.length > 0 && (
        <>
          <EpsBars rows={rows} />

          <div className="card-title mt">
            <span className="sq" style={{ background: 'var(--purple)' }} />Year by year
          </div>
          <EstimateTable rows={rows} />
          <CoverageNote cov={cov} status={status} ticker={ticker} />

          <div className="card-title mt">
            <span className="sq" style={{ background: 'var(--green)' }} />Record against the estimate
          </div>
          <BeatStrip record={record} />

          <div className="ai-note mt small">
            A forward P/E is a live price divided by a number nobody has earned yet. It moves when
            the price moves and it moves again when the estimate is revised, and estimates are
            revised most sharply exactly when they matter most. Treat the growth column the same
            way: past growth is measured, future growth is hoped for, and this table puts them in
            the same column only because they belong on the same axis — not because they carry the
            same weight.
          </div>
        </>
      )}
    </Card>
  );
}
