import React, { useEffect, useMemo, useState } from 'react';
import { Card, StatTile } from '../ui.jsx';
import {
  RISK_MAX, RISK_BANDS, MIN_HISTORY_DAYS, riskProfile, streetConsensus,
} from '../../lib/risk.js';
import { analyse, align, normalise, drawdown, sliceRange } from '../../lib/analytics.js';
import { concentration, allocationBreakdown, loadAssetMeta, assetMetaSync, loadFixedIncome, EMPTY_FI } from '../../lib/assets.js';
import { BENCHMARKS, benchmarkOf, fetchBenchmark, cachedBenchmark } from '../../lib/india.js';
import { fetchRecommendations, memGet, memSet } from '../../lib/advisor.js';

// Item 10 rendered: the risk dial, the health grade, where the book sits on a
// ladder of textbook allocations, and what the Street thinks about what you own.
//
// The maths all lives in lib/risk.js — this file only draws. Two things it draws
// deliberately: every component score is shown next to the headline number, and
// anything that could not be measured says so instead of quietly counting as
// zero. A gauge that hides its inputs is decoration, and this one has to be
// arguable.

const nn = (n, d = 1) => (n == null || !Number.isFinite(n) ? '—' : n.toFixed(d));
const pct = n => (n == null || !Number.isFinite(n) ? '—' : `${n.toFixed(1)}%`);
const CONSENSUS_TTL = 12 * 3600e3;

// The trailing windows the score can be measured over. MAX is kept because it
// is the right answer to a different question — "what has this book ever done"
// — and dropping it would trade one fixed view for another.
const RISK_WINDOWS = [['90D', 90], ['6M', 182], ['1Y', 365], ['MAX', null]];
// How far back the comparison score is taken. A month: long enough that a
// couple of quiet days do not read as a trend, short enough to still be news.
const LOOKBACK = 30;

// ---------------------------------------------------------------- the dial ----
// A semicircular VU-meter: 48 radial ticks, each coloured by the band it falls
// in, lit up to the score and left dark beyond it. Ticks rather than a smooth
// arc because a smooth gradient is the one thing a CRT never drew.
const TICKS = 48;

function polar(cx, cy, r, frac) {
  const a = Math.PI * (1 - frac); // 0 → right, 1 → left
  return [cx + r * Math.cos(a), cy - r * Math.sin(a)];
}

function RiskDial({ score, band, max = RISK_MAX }) {
  const cx = 100, cy = 104, rOut = 92, rIn = 64;
  const frac = score == null ? 0 : Math.max(0, Math.min(1, score / max));

  const ticks = [];
  for (let i = 0; i < TICKS; i++) {
    const f = (i + 0.5) / TICKS;
    const lit = score != null && f <= frac;
    const colour = RISK_BANDS.find(b => f * max <= b.upTo)?.color || 'var(--red)';
    const [x1, y1] = polar(cx, cy, rIn, f);
    const [x2, y2] = polar(cx, cy, rOut, f);
    ticks.push(
      <line
        key={i} x1={x1} y1={y1} x2={x2} y2={y2}
        style={{
          stroke: lit ? colour : 'var(--border)',
          strokeWidth: 5.4,
          opacity: lit ? 1 : 0.35,
          filter: lit ? `drop-shadow(0 0 3px ${colour})` : undefined,
        }}
        strokeLinecap="butt"
      />,
    );
  }

  // Band boundaries marked outside the arc, so the label under the number can be
  // checked against the dial rather than taken on trust.
  const edges = RISK_BANDS.slice(0, -1).map(b => b.upTo / max);

  const [nx, ny] = polar(cx, cy, rIn - 6, frac);
  const [lx, ly] = polar(cx, cy, 9, frac - 0.5);
  const [rx, ry] = polar(cx, cy, 9, frac + 0.5);

  return (
    <svg viewBox="0 0 200 132" className="risk-dial" style={{ imageRendering: 'pixelated' }} aria-hidden="true">
      {ticks}
      {edges.map((f, i) => {
        const [ex1, ey1] = polar(cx, cy, rOut + 2, f);
        const [ex2, ey2] = polar(cx, cy, rOut + 8, f);
        return <line key={i} x1={ex1} y1={ey1} x2={ex2} y2={ey2}
          style={{ stroke: 'var(--ink-3)', strokeWidth: 1.5 }} shapeRendering="crispEdges" />;
      })}

      {score != null && (
        <polygon
          points={`${lx},${ly} ${nx},${ny} ${rx},${ry}`}
          style={{ fill: band?.color || 'var(--cyan)', filter: `drop-shadow(0 0 4px ${band?.color || 'var(--cyan)'})` }}
        />
      )}
      <circle cx={cx} cy={cy} r={5} style={{ fill: 'var(--bg-deep)', stroke: 'var(--border-bright)', strokeWidth: 1.5 }} />

      <text x={cx} y={cy - 26} textAnchor="middle"
        style={{ fill: band?.color || 'var(--ink-3)', fontSize: 34, fontFamily: 'VT323, monospace', filter: `drop-shadow(0 0 6px ${band?.color || 'transparent'})` }}>
        {score == null ? '––' : score}
      </text>
      <text x={cx} y={cy - 10} textAnchor="middle" style={{ fill: 'var(--ink-3)', fontSize: 11, fontFamily: 'VT323, monospace' }}>
        MAX {max}
      </text>
      <text x={8} y={cy + 14} style={{ fill: 'var(--ink-3)', fontSize: 11, fontFamily: 'VT323, monospace' }}>0</text>
      <text x={192} y={cy + 14} textAnchor="end" style={{ fill: 'var(--ink-3)', fontSize: 11, fontFamily: 'VT323, monospace' }}>{max}</text>
    </svg>
  );
}

// -------------------------------------------------------------- pixel bars ----
// A 0–100 score drawn as 20 discrete cells. Discrete because the eye reads "14
// out of 20 lit" far faster than it reads the length of a smooth bar.
function PxBar({ value, color = 'var(--cyan)', cells = 20 }) {
  const lit = value == null ? 0 : Math.round((Math.max(0, Math.min(100, value)) / 100) * cells);
  return (
    <span className="pxbar" aria-hidden="true">
      {Array.from({ length: cells }).map((_, i) => (
        <i key={i} style={i < lit ? { background: color, boxShadow: `0 0 4px ${color}` } : undefined} />
      ))}
    </span>
  );
}

// Five boxes, each fillable in part — a 3.4 reads as three full and one at 40%.
function Pips({ score, color = 'var(--green)', of = 5 }) {
  return (
    <span className="health-pips" aria-hidden="true">
      {Array.from({ length: of }).map((_, i) => {
        const fill = Math.max(0, Math.min(1, (score ?? 0) - i));
        return (
          <i key={i}>
            <b style={{ width: `${fill * 100}%`, background: color, boxShadow: fill ? `0 0 4px ${color}` : undefined }} />
          </i>
        );
      })}
    </span>
  );
}

// --------------------------------------------------------------- the ladder ----
function Ladder({ placement, score, band }) {
  const rungs = placement.rungs || [];
  if (!rungs.length) return null;
  const top = Math.max(RISK_MAX * 0.95, score || 0, ...rungs.map(r => r.score));

  // The book is spliced into the ladder at its own score rather than pinned to
  // the bottom, so "where do I sit" is answered by position, not by reading two
  // numbers and subtracting.
  const rows = [...rungs.map(r => ({ ...r, you: false }))];
  if (score != null) rows.push({ label: 'YOUR PORTFOLIO', score, you: true });
  rows.sort((a, b) => b.score - a.score);

  return (
    <div className="risk-ladder">
      {rows.map((r, i) => (
        <div key={i} className={`ladder-row${r.you ? ' you' : ''}`}>
          <span className="ladder-label">{r.label}</span>
          <span className="ladder-track">
            <span className="ladder-bar" style={{
              width: `${(r.score / top) * 100}%`,
              background: r.you ? (band?.color || 'var(--cyan)') : 'var(--ink-3)',
              boxShadow: r.you ? `0 0 6px ${band?.color || 'var(--cyan)'}` : undefined,
            }} />
          </span>
          <span className="ladder-score" style={r.you ? { color: band?.color } : undefined}>{r.score}</span>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------ Street ratings ----
function StreetBar({ buy, hold, sell }) {
  const parts = [
    ['buy', buy, 'var(--green)'], ['hold', hold, 'var(--yellow)'], ['sell', sell, 'var(--red)'],
  ].filter(p => p[1] > 0);
  return (
    <span className="street-bar" aria-hidden="true">
      {parts.map(([k, v, c]) => (
        <i key={k} style={{ width: `${v}%`, background: c, boxShadow: `0 0 5px ${c}` }} />
      ))}
    </span>
  );
}

// ==================================================================== main ====
export default function RiskProfile({
  held = [], priceOf = () => 0, quotes = {},
  series = [], orders = [], flowsByDay = {}, currentValue = null,
  fx = null, inr = false, crypto = [], defaultKey = 'NIFTY50',
}) {
  const [benchKey, setBenchKey] = useState(defaultKey);
  const [bench, setBench] = useState({ points: [], loading: true });
  const [fi, setFi] = useState(EMPTY_FI);
  const [metaVer, setMetaVer] = useState(0);
  const [street, setStreet] = useState(null);
  const [streetBusy, setStreetBusy] = useState(false);
  const [streetErr, setStreetErr] = useState(null);
  const [openPart, setOpenPart] = useState(null);
  const [windowKey, setWindowKey] = useState('90D');

  useEffect(() => {
    loadAssetMeta().then(() => setMetaVer(v => v + 1)).catch(() => {});
    loadFixedIncome().then(setFi).catch(() => {});
    memGet('street_consensus').then(v => { if (v?.rows) setStreet(v); }).catch(() => {});
  }, []);

  useEffect(() => {
    let dead = false;
    (async () => {
      setBench(b => ({ ...b, loading: true }));
      const cached = await cachedBenchmark(benchKey);
      if (!dead && cached.length) setBench({ points: cached, loading: true });
      const res = await fetchBenchmark(benchKey);
      if (!dead) setBench({ points: res.points, loading: false });
    })();
    return () => { dead = true; };
  }, [benchKey]);

  const bm = benchmarkOf(benchKey);

  // Why this number never moved.
  //
  // The score was computed over the ENTIRE stored history, and a volatility or
  // a max drawdown measured over all time is designed not to move: one more day
  // is one observation in hundreds, and the worst drawdown on record only ever
  // changes on the day a new worst one happens. So the dial sat still, correctly
  // reporting a statistic that does not change — which is not the question
  // anyone opens this screen to ask. "How risky is this book *now*" is a
  // trailing-window question.
  //
  // The window is a control rather than a constant because the honest answer
  // depends on it: 90 days says what the book is doing lately, MAX says what it
  // has done in total, and those genuinely differ after a volatile quarter.
  const winDays = (RISK_WINDOWS.find(w => w[0] === windowKey) || [])[1] ?? null;

  const statsFor = React.useCallback((pts, benchPts) => {
    const [A, B] = benchPts.length ? align(pts, benchPts) : [pts, []];
    return {
      stats: analyse({ series: A, benchmark: B, orders, flowsByDay, currentValue }),
      benchMaxDD: B.length ? drawdown(B).maxDD : null,
      days: A.length,
    };
  }, [orders, flowsByDay, currentValue]);

  const { stats, benchMaxDD, days } = useMemo(
    () => statsFor(sliceRange(series, winDays), bench.points),
    [series, winDays, bench.points, statsFor],
  );


  const conc = useMemo(() => concentration(held, priceOf), [held, quotes]); // eslint-disable-line
  const alloc = useMemo(
    () => allocationBreakdown({ held, priceOf, saved: assetMetaSync(), fi, crypto, fx: fx || 1, inr }),
    [held, quotes, metaVer, fi, crypto, fx, inr], // eslint-disable-line
  );

  const profile = useMemo(
    () => riskProfile({ stats: { ...stats, benchMaxDD }, conc, alloc }),
    [stats, benchMaxDD, conc, alloc],
  );

  // The same score as it stood a month ago, over the same window length ending
  // 30 days back. Without it the dial is a level with no sense of direction, and
  // a risk level you cannot watch move is indistinguishable from one that is
  // stuck — which is exactly how this read.
  //
  // conc and alloc are TODAY'S: per-day holdings history is not stored, so this
  // comparison isolates the market-behaviour drivers and holds the book's shape
  // fixed. That is a real limitation and it is said on screen, because a reader
  // would otherwise assume both halves moved.
  const prev = useMemo(() => {
    const p = normalise(series);
    if (p.length < MIN_HISTORY_DAYS + LOOKBACK) return null;
    const endAt = p[p.length - 1 - LOOKBACK]?.d;
    if (!endAt) return null;
    const past = p.filter(x => x.d <= endAt);
    const pastBench = bench.points.filter(x => x.d <= endAt);
    const s = statsFor(sliceRange(past, winDays), pastBench);
    if (s.days < MIN_HISTORY_DAYS) return null;
    return riskProfile({ stats: { ...s.stats, benchMaxDD: s.benchMaxDD }, conc, alloc });
  }, [series, bench.points, winDays, statsFor, conc, alloc]);

  const drift = prev?.risk?.score != null && profile.risk.score != null
    ? profile.risk.score - prev.risk.score
    : null;

  const { risk, health, placement } = profile;
  const band = risk.band;

  // The Street costs one API call per holding, so it is a button and the answer
  // is cached — reopening this tab shouldn't spend the free tier.
  const pollStreet = async () => {
    setStreetBusy(true); setStreetErr(null);
    try {
      const res = await streetConsensus(held, priceOf, fetchRecommendations);
      if (!res.rows.length || res.buyPct == null) {
        setStreetErr('No analyst coverage came back. That usually means the Finnhub key is missing or the tickers are Indian — US coverage is what the free tier carries.');
      }
      const out = { ...res, at: new Date().toISOString() };
      setStreet(out);
      memSet('street_consensus', out);
    } catch (e) {
      setStreetErr(String(e.message || e));
    } finally {
      setStreetBusy(false);
    }
  };

  const streetAge = street?.at ? Date.now() - new Date(street.at).getTime() : null;
  const streetStale = streetAge != null && streetAge > CONSENSUS_TTL;

  const measured = risk.parts.filter(p => p.score != null).length;

  return (
    <>
      <Card
        title="Risk profile"
        color={band?.color || 'var(--orange)'}
        right={
          <span className="flex" style={{ gap: 4, flexWrap: 'wrap' }}>
            {BENCHMARKS.map(b => (
              <button key={b.key} className={`btn btn-sm${benchKey === b.key ? ' btn-cyan' : ''}`} onClick={() => setBenchKey(b.key)}>{b.short}</button>
            ))}
          </span>
        }
      >
        <div className="risk-top">
          <div className="risk-dial-wrap">
            <RiskDial score={risk.score} band={band} max={risk.max} />
            <div className="risk-band-label" style={{ color: band?.color || 'var(--ink-3)' }}>
              {risk.score == null ? 'NOT ENOUGH DATA YET' : `YOUR RISK PROFILE: ${band.label.toUpperCase()}`}
            </div>
            <div className="small muted" style={{ textAlign: 'center' }}>
              {measured} of {risk.parts.length} drivers measured · beta vs {bm.short}
            </div>

            {/* Measured over what. The score was computed over all history and
                therefore barely moved; a window makes it answer "how risky is
                this book now" instead of "how risky has it ever been". */}
            <div className="risk-win">
              {RISK_WINDOWS.map(([k]) => (
                <button key={k} className={`vsb-range${windowKey === k ? ' on' : ''}`}
                  onClick={() => setWindowKey(k)}>{k}</button>
              ))}
            </div>

            {drift != null ? (
              <div className="risk-drift small" style={{ textAlign: 'center' }}>
                {drift === 0 ? 'Unchanged over the past month' : (
                  <>
                    <b style={{ color: drift > 0 ? 'var(--red)' : 'var(--green)' }}>
                      {drift > 0 ? '\u25b2' : '\u25bc'} {Math.abs(drift)}
                    </b>{' '}
                    vs a month ago ({prev.risk.score} \u2192 {risk.score})
                    {prev.risk.band?.label !== band?.label && (
                      <> \u00b7 crossed from <b>{prev.risk.band?.label}</b> into <b>{band?.label}</b></>
                    )}
                  </>
                )}
                <div className="muted" style={{ marginTop: 2 }}>
                  Market drivers only \u2014 per-day holdings history isn&#39;t stored,
                  so concentration and growth share are held at today&#39;s values in
                  both scores.
                </div>
              </div>
            ) : (
              <div className="risk-drift small muted" style={{ textAlign: 'center' }}>
                Not enough stored history yet to show which way this is moving \u2014
                that needs {MIN_HISTORY_DAYS + LOOKBACK} days of daily value.
              </div>
            )}
          </div>

          <div className="risk-parts">
            {risk.parts.map(p => (
              <div key={p.key} className="risk-part" onClick={() => setOpenPart(openPart === p.key ? null : p.key)}>
                <div className="spread small">
                  <span>{p.label} <span className="muted">×{p.weight.toFixed(2)}</span></span>
                  <span style={{ color: p.score == null ? 'var(--ink-3)' : band?.color || 'var(--cyan)' }}>
                    {p.score == null ? 'not measured' : `${Math.round(p.score)}/100`}
                  </span>
                </div>
                <PxBar value={p.score} color={p.score == null ? 'var(--ink-3)' : band?.color || 'var(--cyan)'} />
                {openPart === p.key && <div className="small muted risk-note">{p.note}</div>}
              </div>
            ))}
            <div className="small muted mt">
              Tap a driver to see what it measures. Anything unmeasured is dropped
              from the weighting rather than counted as zero, so a young portfolio
              is not flattered into looking safe.
              {!profile.inputs.enoughHistory && (
                <> Only <b>{profile.inputs.days ?? 0}</b> days of daily value are stored so far,
                which is too few to measure swings or falls honestly — those drivers stay dark
                until there are {MIN_HISTORY_DAYS}. Concentration and growth share are read
                straight off your holdings, so they count from day one.</>
              )}
            </div>
          </div>
        </div>

        <div className="small muted mt risk-caveat">
          The 0–600 scale is this app's own, built from five drivers and shown in full
          above — there is no industry-standard 600-point index to copy. It measures
          how much risk the book carries. It is not advice, and it does not say whether
          that risk is the right amount for you.
        </div>
      </Card>

      <div className="grid2">
        <Card title="Portfolio health" color={health.grade?.color || 'var(--green)'}>
          <div className="flex" style={{ gap: 14, alignItems: 'center', marginBottom: 10 }}>
            <div style={{
              fontSize: 40, fontFamily: 'VT323, monospace', lineHeight: 1,
              color: health.grade?.color || 'var(--ink-3)',
              filter: health.grade ? `drop-shadow(0 0 6px ${health.grade.color})` : undefined,
            }}>
              {health.score == null ? '—' : health.score.toFixed(2)}
            </div>
            <div>
              <div style={{ color: health.grade?.color || 'var(--ink-3)' }}>{health.grade?.label || 'Not enough data'}</div>
              <div className="small muted">out of 5.00 · {health.measured} of {health.of} measured</div>
            </div>
          </div>

          {health.parts.map(p => (
            <div key={p.key} className="health-row" title={p.note}>
              <span className="health-label small">{p.label}</span>
              <Pips score={p.score} color={health.grade?.color || 'var(--green)'} />
              <span className="small" style={{ color: p.score == null ? 'var(--ink-3)' : 'var(--ink-2)', width: 34, textAlign: 'right' }}>
                {p.score == null ? '—' : p.score.toFixed(1)}
              </span>
            </div>
          ))}

          <div className="small muted mt">
            Health is deliberately separate from risk: a bold book can be well built,
            and a timid one badly built. {days < 2 && 'Most of this fills in once a few days of daily value are stored.'}
          </div>
        </Card>

        <Card title="How you compare" color="var(--purple)">
          <Ladder placement={placement} score={risk.score} band={band} />
          <div className="small mt">
            {risk.score == null
              ? 'Once the risk score computes, your book gets spliced into this ladder at its own level.'
              : <>Your book carries more risk than <b style={{ color: band?.color }}>{placement.below}</b> of
                the {placement.rungs.length} reference allocations, and sits closest
                to <b style={{ color: 'var(--cyan)' }}>{placement.nearest?.label}</b>.</>}
          </div>
          <div className="small muted mt">
            These rungs are textbook model allocations scored on the same five drivers —
            not other users. There is no user base here, and inventing a peer
            distribution would be fiction dressed as a percentile.
          </div>
        </Card>
      </div>

      <Card
        title="What the Street thinks"
        color="var(--cyan)"
        right={
          <span className="flex" style={{ gap: 6 }}>
            {street?.at && <span className={`chip ${streetStale ? 'c-yellow' : 'c-cyan'}`}>{new Date(street.at).toLocaleDateString()}</span>}
            <button className="btn btn-sm btn-cyan" onClick={pollStreet} disabled={streetBusy || !held.length}>
              {streetBusy ? 'polling…' : street ? 'refresh' : 'poll analysts'}
            </button>
          </span>
        }
      >
        {!street && !streetErr && (
          <div className="small muted">
            Analyst recommendation trends come from Finnhub, one call per holding.
            Tap <b>poll analysts</b> to pull the latest month and cache it.
          </div>
        )}

        {streetErr && <div className="small" style={{ color: 'var(--orange)' }}>{streetErr}</div>}

        {street?.buyPct != null && (
          <>
            <div className="tile-row">
              <StatTile label="CONSENSUS" value={street.verdict || '—'} note="value-weighted" color={street.verdict === 'Bullish' ? 'var(--green)' : street.verdict === 'Bearish' ? 'var(--red)' : 'var(--yellow)'} />
              <StatTile label="BUY" value={pct(street.buyPct)} note="of weighted ratings" color="var(--green)" />
              <StatTile label="HOLD" value={pct(street.holdPct)} color="var(--yellow)" />
              <StatTile label="SELL" value={pct(street.sellPct)} color="var(--red)" />
            </div>

            <div className="mt">
              <StreetBar buy={street.buyPct} hold={street.holdPct} sell={street.sellPct} />
            </div>
            <div className="small muted" style={{ marginTop: 6 }}>
              Weighted by position size, so a rating on a 30% holding counts thirty times
              a rating on a 1% one. Covers {pct(street.coveragePct)} of the book by value.
            </div>

            <div className="scroll-x mt">
              <table className="ptable" style={{ minWidth: 380 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>TICKER</th>
                    <th style={{ textAlign: 'right' }}>ANALYSTS</th>
                    <th style={{ width: 110 }}>B / H / S</th>
                    <th style={{ textAlign: 'right' }}>LEAN</th>
                  </tr>
                </thead>
                <tbody>
                  {street.rows.map(r => (
                    <tr key={r.ticker}>
                      <td style={{ textAlign: 'left' }}>{r.ticker}</td>
                      <td style={{ textAlign: 'right', color: r.rec ? 'var(--ink-2)' : 'var(--ink-3)' }}>
                        {r.rec ? r.rec.total : 'no coverage'}
                      </td>
                      <td>{r.rec ? <StreetBar buy={r.buyPct} hold={r.holdPct} sell={r.sellPct} /> : <span className="muted">—</span>}</td>
                      <td style={{ textAlign: 'right' }}>
                        {r.rec
                          ? <span className={`chip ${r.lean === 'buy' ? 'c-green' : r.lean === 'sell' ? 'c-red' : 'c-yellow'}`}>{r.lean}</span>
                          : <span className="muted">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="small muted mt">
              Sell-side ratings, reported as they are. Analysts are collectively bullish
              far more often than not, so a wall of BUY is the base rate rather than a
              signal — and none of this is advice.
            </div>
          </>
        )}
      </Card>
    </>
  );
}
