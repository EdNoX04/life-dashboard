import React, { useEffect, useMemo, useState } from 'react';
import { Card, StatTile, money } from '../ui.jsx';
import VersusChart from './VersusChart.jsx';
import { BENCHMARKS, benchmarkOf, fetchBenchmark, cachedBenchmark } from '../../lib/india.js';
import { align, normalise, analyse, sliceRange, benchmarkEquivalent } from '../../lib/analytics.js';

// "Returns vs benchmark" — the centrepiece. Everything here is derived from two
// series and the order ledger; nothing is fetched per-render.
//
// A note on what the numbers mean, because two of them look like they should
// agree and don't:
//   XIRR  — money-weighted. What *you* earned, given when you actually funded.
//   CAGR  — time-weighted. What the *picks* did, ignoring contribution timing.
// For a portfolio still being funded monthly these diverge a lot, and the gap is
// itself informative, so both are shown side by side rather than picking one.

// ---------------------------------------------------------------------------
// The headline used to be two numbers rebased to 100 and a percentage for the
// index. Both were true and neither was legible: "you 118.4, index 112.9" makes
// you do the arithmetic that is the whole point of the screen, and the index's
// XIRR sat next to your rupee total as though they were comparable quantities.
//
// It now reads the way INDmoney's does, because that framing is simply the
// right one: your portfolio's value against *what the identical cashflows would
// be worth today in the index* - two amounts in the same currency, one axis,
// XIRR under each. benchmarkEquivalent() had been sitting in analytics.js
// unwired since it was written; this is what it was for.
//
// The Growth tab answers the other question people actually ask - value against
// what you put in - which the app could already compute (the invested line from
// portfolioHistory) but never showed here.
// ---------------------------------------------------------------------------

const RANGE_OPTS = [['1M', 30], ['3M', 91], ['6M', 182], ['1Y', 365], ['3Y', 1095], ['MAX', null]];
const TRAIL = [['1W', 7], ['1M', 30], ['3M', 91], ['6M', 182], ['1Y', 365], ['3Y', 1095], ['MAX', null]];

const pct = n => (n == null || !Number.isFinite(n) ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`);
const nn = (n, d = 2) => (n == null || !Number.isFinite(n) ? '—' : n.toFixed(d));
// The theme scopes c-green / c-red to .chip, so plain cells colour themselves.
const tone = n => ({ color: n == null || !Number.isFinite(n) ? 'var(--ink-3)' : n >= 0 ? 'var(--green)' : 'var(--red)' });

// green through to red, saturation tracking magnitude — the consistency heat grid
function heat(r) {
  if (r == null || !Number.isFinite(r)) return 'rgba(255,255,255,0.05)';
  const mag = Math.min(1, Math.abs(r) / 8);
  return r >= 0
    ? `rgba(70, 220, 130, ${0.12 + mag * 0.65})`
    : `rgba(255, 95, 95, ${0.12 + mag * 0.65})`;
}
const MONTH_ABBR = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

// "27th Jan'25" — the caption format, matching the axis labels in VersusChart.
function longDay(d) {
  if (!d) return '—';
  const dt = new Date(d);
  const n = dt.getDate();
  const suf = n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th';
  return `${n}${suf} ${dt.toLocaleString('en', { month: 'short' })}'${String(dt.getFullYear()).slice(2)}`;
}

const PORT_C = '#ff5fa2';
const INVEST_C = 'var(--cyan)';

export default function Benchmark({
  series = [], invested = [], orders = [], flowsByDay = {}, currentValue = null,
  cur = '$', visible = true, defaultKey = 'NIFTY50',
  // Everything upstream of here is priced in the ledger's own currency (USD).
  // The tab's ₹/$ toggle only changes presentation, so the conversion happens
  // at the very last moment, on display values only - percentages, XIRR and
  // every risk statistic are ratios and must not be touched by it. This used to
  // be missing entirely: the card stamped whatever `cur` said onto unconverted
  // dollar figures, so switching to ₹ relabelled the number without changing it.
  rate = 1,
}) {
  const [benchKey, setBenchKey] = useState(defaultKey);
  const [range, setRange] = useState('1Y');
  const [tab, setTab] = useState('bench');
  const [bench, setBench] = useState({ points: [], source: null, stale: false, loading: true });

  const bm = benchmarkOf(benchKey);

  // paint from cache immediately, then refresh in the background
  useEffect(() => {
    let dead = false;
    (async () => {
      setBench(b => ({ ...b, loading: true }));
      const cachedPts = await cachedBenchmark(benchKey);
      if (!dead && cachedPts.length) setBench({ points: cachedPts, source: 'cache', stale: false, loading: true });
      const res = await fetchBenchmark(benchKey);
      if (!dead) setBench({ points: res.points, source: res.source, stale: res.stale, tried: res.tried, loading: false });
    })();
    return () => { dead = true; };
  }, [benchKey]);

  const days = (RANGE_OPTS.find(r => r[0] === range) || [])[1] ?? null;

  // Align first, then slice both sides by the same cutoff — slicing before
  // aligning would let the two lines start on different dates and quietly
  // overstate or understate the gap.
  const { pSlice, bSlice } = useMemo(() => {
    const p = normalise(series);
    if (!p.length) return { pSlice: [], bSlice: [] };
    const [A, B] = bench.points.length ? align(p, bench.points) : [p, []];
    if (!days) return { pSlice: A, bSlice: B };
    const last = A[A.length - 1]?.d;
    if (!last) return { pSlice: A, bSlice: B };
    const cut = new Date(new Date(last).getTime() - days * 86400e3).toISOString().slice(0, 10);
    const keep = A.map((x, i) => [x, B[i]]).filter(([x]) => x.d >= cut);
    return { pSlice: keep.map(k => k[0]), bSlice: keep.map(k => k[1]).filter(Boolean) };
  }, [series, bench.points, days]);

  const stats = useMemo(
    () => analyse({ series: pSlice, benchmark: bSlice, orders, flowsByDay, currentValue }),
    [pSlice, bSlice, orders, flowsByDay, currentValue],
  );

  // full-history trailing table (not range-limited — a trailing table that
  // respected the range toggle would be tautological)
  const full = useMemo(() => {
    const p = normalise(series);
    const [A, B] = bench.points.length ? align(p, bench.points) : [p, []];
    return { A, B };
  }, [series, bench.points]);

  const trailRows = useMemo(() => TRAIL.map(([label, d]) => {
    const p = sliceRange(full.A, d), b = sliceRange(full.B, d);
    const ret = s => {
      if (s.length < 2) return null;
      const a0 = s[0].v, a1 = s[s.length - 1].v;
      if (a0 <= 0) return null;
      const simple = (a1 - a0) / a0;
      return !d || d <= 365 ? simple * 100 : (Math.pow(1 + simple, 365 / d) - 1) * 100;
    };
    return { label, you: ret(p), bench: ret(b), annualised: !!d && d > 365 };
  }), [full]);

  // ---- the two headline charts, both in currency ----

  // "the same money, into the index instead", computed over the WHOLE history
  // and only then sliced. Computing it inside the range window would restart
  // the unit count at the window's left edge and quietly compare a full
  // portfolio against a part-funded index.
  const equivFull = useMemo(
    () => (bench.points.length ? benchmarkEquivalent(orders, bench.points) : []),
    [orders, bench.points],
  );

  const scale = pts => pts.map(pt => ({ d: pt.d, v: pt.v * (rate || 1) }));

  // Clip a pair of series to the active range on the portfolio's own dates, so
  // both lines always start and end on the same day.
  const clipPair = (A, B) => {
    if (!A.length) return [[], []];
    if (!days) return [A, B];
    const last = A[A.length - 1].d;
    const cut = new Date(new Date(last).getTime() - days * 86400e3).toISOString().slice(0, 10);
    const keep = A.map((x, i) => [x, B[i]]).filter(([x]) => x.d >= cut);
    return [keep.map(k => k[0]), keep.map(k => k[1]).filter(Boolean)];
  };

  const vsChart = useMemo(() => {
    const p = normalise(series);
    if (!p.length) return { a: [], b: [] };
    const [A, B] = equivFull.length ? align(p, equivFull) : [p, []];
    const [a, b] = clipPair(A, B);
    return { a: scale(a), b: scale(b) };
  }, [series, equivFull, days, rate]);

  const growthChart = useMemo(() => {
    const p = normalise(series);
    if (!p.length) return { a: [], b: [] };
    const inv = normalise(invested);
    const [A, B] = inv.length ? align(p, inv) : [p, []];
    const [a, b] = clipPair(A, B);
    return { a: scale(a), b: scale(b) };
  }, [series, invested, days, rate]);

  const shown = tab === 'growth' ? growthChart : vsChart;
  const lastOf = arr => (arr.length ? arr[arr.length - 1].v : null);
  // The portfolio headline is live value where we have it; the chart's last
  // point is only a fallback, because the reconstructed line ends at the last
  // stored close and can lag today's quotes by a session.
  const portNow = currentValue != null ? currentValue * (rate || 1) : lastOf(shown.a);
  const rightNow = lastOf(shown.b);
  const fmtMoney = v => (v == null || !Number.isFinite(v) ? '—' : money(v, visible, cur));

  // months laid out as a year × month grid
  const grid = useMemo(() => {
    const byYear = new Map();
    for (const m of stats.months || []) {
      const [y, mo] = m.month.split('-');
      if (!byYear.has(y)) byYear.set(y, Array(12).fill(null));
      byYear.get(y)[Number(mo) - 1] = m.ret;
    }
    return [...byYear.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [stats.months]);

  const cons = stats.consistency || {};
  const dd = stats.drawdown || {};
  const noHistory = normalise(series).length < 2;

  return (
    <>
      <Card title="Returns vs benchmark" color="var(--pink)">
        {/* Two questions, two tabs. They share the range control and the axis
            because they are the same chart with a different second line. */}
        <div className="vsb-tabs">
          {[['bench', 'vs Benchmark'], ['growth', 'Growth']].map(([k, label]) => (
            <button key={k} className={`vsb-tab${tab === k ? ' on' : ''}`} onClick={() => setTab(k)}>{label}</button>
          ))}
        </div>

        {noHistory ? (
          <div className="muted small" style={{ padding: 12 }}>
            No portfolio history recorded yet. Once a few days of daily value are
            stored, this chart and every statistic below fill in automatically.
          </div>
        ) : (
          <>
            <div className="vsb-head">
              <div className="vsb-side">
                <div className="vsb-name"><i style={{ background: PORT_C }} />Portfolio</div>
                <div className="vsb-val" style={{ color: PORT_C }}>{fmtMoney(portNow)}</div>
                <div className="vsb-sub">
                  XIRR <b style={tone(stats.xirr)}>{pct(stats.xirr)}</b>
                </div>
              </div>

              <div className="vsb-vs">VS</div>

              <div className="vsb-side vsb-right">
                {tab === 'bench' ? (
                  <div className="vsb-name">
                    <i style={{ background: bm.color }} />
                    {/* A select rather than six buttons: the index you compare
                        against is a single choice out of a list that will keep
                        growing, and a row of pills was already wrapping. */}
                    <select className="vsb-select" value={benchKey} onChange={e => setBenchKey(e.target.value)}
                      style={{ color: bm.color }} aria-label="Benchmark index">
                      {BENCHMARKS.map(b => <option key={b.key} value={b.key}>{b.label}</option>)}
                    </select>
                  </div>
                ) : (
                  <div className="vsb-name"><i style={{ background: 'var(--cyan)' }} />Invested Value</div>
                )}
                <div className="vsb-val" style={{ color: tab === 'bench' ? bm.color : 'var(--cyan)' }}>
                  {fmtMoney(rightNow)}
                </div>
                <div className="vsb-sub">
                  {tab === 'bench'
                    ? <>XIRR <b style={tone(stats.benchXirr)}>{pct(stats.benchXirr)}</b></>
                    : <span className="muted">what you put in</span>}
                </div>
              </div>
            </div>

            <div className="vsb-caption">
              Value from {longDay(shown.a[0]?.d)} to {longDay(shown.a[shown.a.length - 1]?.d)}
            </div>

            <VersusChart
              a={shown.a} b={shown.b}
              aLabel="Portfolio" aColor={PORT_C}
              bLabel={tab === 'bench' ? bm.short : 'Invested'}
              bColor={tab === 'bench' ? bm.color : INVEST_C}
              fmt={v => money(v, visible, cur)}
              height={230}
              emptyNote={tab === 'bench'
                ? 'Waiting on index closes — the comparison draws itself once they load.'
                : 'Not enough history yet.'}
            />

            <div className="vsb-ranges">
              {RANGE_OPTS.map(([k]) => (
                <button key={k} className={`vsb-range${range === k ? ' on' : ''}`} onClick={() => setRange(k)}>{k}</button>
              ))}
            </div>

            <div className="small muted mt">
              {tab === 'bench' ? (
                <>
                  The {bm.short} line is not the index level — it is your own
                  cashflows, on the dates you actually made them, bought into the
                  index instead. That is why both lines are in {cur} and why the
                  gap between them is the only number that matters here.
                </>
              ) : (
                <>
                  Invested is cost basis on the same positions, so the gap between
                  the lines is unrealised profit. It steps up when you buy — a step
                  is money arriving, not a gain.
                </>
              )}
              {bench.source === 'cache' && ' · showing stored data while refreshing'}
              {bench.stale && ' · live refresh failed, showing last stored closes'}
              {tab === 'bench' && !bench.points.length && !bench.loading && ' · no index data yet — run the data self-test in Settings'}
            </div>
          </>
        )}
      </Card>

      {!noHistory && (
        <>
          <Card title="Risk & return efficiency" color="var(--cyan)">
            <div className="tile-row">
              <StatTile label="CAGR" value={pct(stats.cagr)} note={`index ${pct(stats.benchCagr)}`} color="var(--green)" />
              <StatTile label="VOLATILITY" value={pct(stats.volatility)} note={`index ${pct(stats.benchVolatility)}`} color="var(--orange)" />
              <StatTile label="SHARPE" value={nn(stats.sharpe)} note={`index ${nn(stats.benchSharpe)}`} color="var(--cyan)" />
              <StatTile label="SORTINO" value={nn(stats.sortino)} note={`index ${nn(stats.benchSortino)}`} color="var(--purple)" />
            </div>
            <div className="tile-row mt">
              <StatTile label="BETA" value={nn(stats.beta)} note="1.00 = moves with the index" color="var(--yellow)" />
              <StatTile label="ALPHA" value={pct(stats.alpha == null ? null : stats.alpha * 100)} note="excess over risk taken" color="var(--pink)" />
              <StatTile label="TRACKING ERR" value={pct(stats.trackingError)} note="how far you drift from it" color="var(--orange)" />
              <StatTile label="INFO RATIO" value={nn(stats.informationRatio)} note="reward per unit of drift" color="var(--green)" />
            </div>
            <div className="tile-row mt">
              <StatTile label="95% VaR" value={pct(-Math.abs(stats.var95 || 0))} note="rough bad-year loss" color="var(--red)" />
              <StatTile label="UP CAPTURE" value={stats.capture?.up == null ? '—' : `${stats.capture.up.toFixed(0)}%`} note={`${stats.capture?.upDays || 0} up days`} color="var(--green)" />
              <StatTile label="DOWN CAPTURE" value={stats.capture?.down == null ? '—' : `${stats.capture.down.toFixed(0)}%`} note={`${stats.capture?.downDays || 0} down days`} color="var(--red)" />
              <StatTile label="MAX DRAWDOWN" value={pct(dd.maxDD)} note={dd.trough ? `trough ${dd.trough}` : ''} color="var(--red)" />
            </div>
            <div className="small muted mt">
              Up capture above 100 with down capture below 100 is the shape you want:
              catching most of the rallies while sitting out part of the falls.
            </div>
          </Card>

          <div className="grid2">
            <Card title="Loss recovery" color="var(--red)">
              <div className="tile-row">
                <StatTile label="CURRENT DD" value={pct(dd.currentDD)} note="below your peak right now" color="var(--orange)" />
                <StatTile label="DEEPEST" value={pct(dd.maxDD)} note={dd.from ? `from ${dd.from}` : ''} color="var(--red)" />
              </div>
              <div className="small mt">
                {dd.recovered
                  ? <>Deepest fall was fully recovered in <b>{dd.recoveredInDays}</b> days.</>
                  : dd.maxDD < 0
                    ? <>Still climbing back — longest stretch underwater so far is <b>{dd.longestUnderwaterDays}</b> days.</>
                    : 'No drawdown recorded yet.'}
              </div>
            </Card>

            <Card title="Performance consistency" color="var(--green)">
              <div className="tile-row">
                <StatTile label="WIN RATE" value={`${nn(cons.winRate, 0)}%`} note={`${cons.positive || 0} of ${cons.total || 0} months`} color="var(--green)" />
                <StatTile label="BEST STREAK" value={`${cons.streak || 0} mo`} note="consecutive green months" color="var(--cyan)" />
              </div>
              <div className="small mt">
                {cons.best && <>Best month <b style={tone(1)}>{cons.best.month} {pct(cons.best.ret)}</b> · </>}
                {cons.worst && <>worst <b style={tone(-1)}>{cons.worst.month} {pct(cons.worst.ret)}</b></>}
              </div>
            </Card>
          </div>

          {grid.length > 0 && (
            <Card title="Month by month" color="var(--yellow)">
              <div style={{ overflowX: 'auto' }}>
                <table className="ptable" style={{ minWidth: 420 }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left' }}>YR</th>
                      {MONTH_ABBR.map((m, i) => <th key={i} style={{ textAlign: 'center', width: 30 }}>{m}</th>)}
                      <th style={{ textAlign: 'right' }}>YEAR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grid.map(([year, months]) => {
                      const yearRet = months.reduce((a, r) => (r == null ? a : a * (1 + r / 100)), 1) - 1;
                      const anyMonth = months.some(r => r != null);
                      return (
                        <tr key={year}>
                          <td style={{ textAlign: 'left' }}>{year}</td>
                          {months.map((r, i) => (
                            <td key={i} title={r == null ? '' : `${year}-${String(i + 1).padStart(2, '0')} · ${pct(r)}`}
                              style={{
                                background: heat(r), textAlign: 'center', fontSize: 9,
                                padding: '4px 2px', color: r == null ? 'rgba(255,255,255,0.2)' : '#fff',
                              }}>
                              {r == null ? '·' : r.toFixed(0)}
                            </td>
                          ))}
                          <td style={{ ...(anyMonth ? tone(yearRet * 100) : {}), textAlign: 'right' }}>
                            {anyMonth ? pct(yearRet * 100) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="small muted mt">Each cell is that month's return in percent. Greener is better.</div>
            </Card>
          )}

          <Card title={`Trailing returns vs ${bm.short}`} color="var(--purple)">
            <div style={{ overflowX: 'auto' }}>
              <table className="ptable" style={{ minWidth: 380 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>PERIOD</th>
                    <th style={{ textAlign: 'right' }}>YOU</th>
                    <th style={{ textAlign: 'right' }}>{bm.short}</th>
                    <th style={{ textAlign: 'right' }}>DIFF</th>
                  </tr>
                </thead>
                <tbody>
                  {trailRows.map(r => {
                    const diff = r.you != null && r.bench != null ? r.you - r.bench : null;
                    return (
                      <tr key={r.label}>
                        <td style={{ textAlign: 'left' }}>
                          {r.label}{r.annualised && <span className="muted small"> p.a.</span>}
                        </td>
                        <td style={{ ...tone(r.you), textAlign: 'right' }}>{pct(r.you)}</td>
                        <td style={{ ...tone(r.bench), textAlign: 'right' }}>{pct(r.bench)}</td>
                        <td style={{ ...tone(diff), textAlign: 'right' }}>{pct(diff)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="small muted mt">
              Periods longer than a year are annualised. Blank rows just mean the
              history doesn't reach back that far yet.
            </div>
          </Card>
        </>
      )}
    </>
  );
}
