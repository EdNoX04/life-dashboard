// "Every market we cover" — rendered so that it cannot overstate itself.
//
// The design problem this screen has, and which markets.js exists to solve, is
// that a coverage screen lies through its LAYOUT rather than through any sentence.
// Six index tiles in a neat grid, each showing a number, read as six equally live
// markets. Put a green dot on each and you have asserted something the app cannot
// back up. So three rendering rules follow from the library's four-state model:
//
//   1. THE STATE IS THE LOUDEST THING ON THE ROW, louder than the number. A level
//      that is two sessions old is not a small caveat on a big number; it is the
//      main fact about that row, and it is drawn that way.
//
//   2. AN UNREACHED MARKET IS DRAWN AT FULL SIZE, in its normal place in the list,
//      with its name and its exchange and its reason. The tempting alternative —
//      hiding it, or shrinking it into a footnote — makes the grid look complete,
//      and a grid that looks complete when it is not is the exact failure the
//      whole module was written to avoid.
//
//   3. THE HEADLINE IS TWO NUMBERS, never one. "6 markets" is a claim about the
//      catalogue; "2 current" is a claim about right now. A single number would
//      have to be one or the other, and whichever it was, it would be read as
//      the other.
//
// The sparkline is hand-rolled because there is no chart library in this app, and
// it draws only what it has: fewer than two points renders as nothing at all
// rather than as a flat line, because a flat line is a statement about a series
// and one point is not a series.

import React, { useEffect, useState, useCallback } from 'react';
import { Card, Empty, useNow } from '../ui.jsx';
import {
  BENCHMARKS, catalogue, coverageSummary, coverageNote, readCache,
  sessionState, minutesToChange, exchangeForIndex, exchangeOf,
  COVERAGE_LABEL, COVERAGE_COLOR, LIVE, STALE, CACHED, UNREACHABLE,
  INSTRUMENTS, PRICING_LABEL, PRICING_COLOR, instrumentSummary,
  REGIONS, DISCLAIMER, EXCHANGES,
} from '../../lib/markets.js';
import { fetchBenchmarks } from '../../lib/india.js';

const pad = n => String(n).padStart(2, '0');

// Ages are written the way a person would say them out loud. "1440m" is
// technically the same fact as "1d" and nobody reads it as one.
function ago(min) {
  if (min == null) return '—';
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  if (min < 60 * 36) return `${Math.round(min / 60)}h ago`;
  return `${Math.round(min / 1440)}d ago`;
}

function until(min) {
  if (min == null) return '—';
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 36) return `${h}h ${min % 60}m`;
  return `${Math.round(min / 1440)}d`;
}

const fmtNum = v => (v == null ? '—' : v.toLocaleString(undefined, { maximumFractionDigits: 2 }));

// ------------------------------------------------------------------ sparkline

export function Spark({ points = [], color = 'var(--green)', w = 96, h = 26 }) {
  // One point is a level, not a shape. Drawing it as a horizontal line would
  // assert that the index has been flat, which is a claim about data we do not
  // have. Nothing is the honest render.
  if (!points || points.length < 2) {
    return (
      <svg className="gm-spark" width={w} height={h} shapeRendering="crispEdges" aria-hidden="true">
        <text x={w / 2} y={h / 2 + 4} textAnchor="middle" fill="var(--ink-3)" fontSize="9">no series</text>
      </svg>
    );
  }
  const vals = points.map(p => Number(p.v)).filter(Number.isFinite);
  if (vals.length < 2) return <svg className="gm-spark" width={w} height={h} />;
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const span = hi - lo || 1;
  const step = w / (vals.length - 1);
  const y = v => h - 2 - ((v - lo) / span) * (h - 4);
  const d = vals.map((v, i) => `${i ? 'L' : 'M'}${(i * step).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const up = vals[vals.length - 1] >= vals[0];
  const c = up ? 'var(--green)' : 'var(--red)';
  return (
    <svg className="gm-spark" width={w} height={h} shapeRendering="crispEdges" aria-hidden="true">
      <path d={d} fill="none" stroke={c} strokeWidth="1.5" style={{ filter: `drop-shadow(0 0 3px ${c})` }} />
    </svg>
  );
}

// ------------------------------------------------------------- coverage chip

export function CoverageChip({ state }) {
  return (
    <span
      className={`gm-chip gm-chip-${state}`}
      style={{ color: COVERAGE_COLOR[state], borderColor: COVERAGE_COLOR[state] }}
    >
      {COVERAGE_LABEL[state]}
    </span>
  );
}

// ------------------------------------------------------------- session strip

export function SessionStrip({ now }) {
  const ids = Object.keys(EXCHANGES);
  return (
    <div className="gm-sessions">
      {ids.map(id => {
        const st = sessionState(id, now);
        const mins = minutesToChange(st, now);
        const c = st.open ? 'var(--green)' : st.weekend ? 'var(--ink-3)' : 'var(--orange)';
        return (
          <div key={id} className={`gm-sess${st.open ? ' on' : ''}`} style={{ borderColor: c }}>
            <div className="gm-sess-top">
              <span className="gm-sess-id" style={{ color: c }}>{id}</span>
              <span className="gm-sess-dot" style={{ background: c, boxShadow: `0 0 6px ${c}` }} />
            </div>
            <div className="gm-sess-city">{st.city} · {st.localTime}</div>
            <div className="gm-sess-hours">{st.hours}</div>
            <div className="gm-sess-phase" style={{ color: c }}>
              {st.open ? `OPEN · closes in ${until(mins)}`
                : st.phase === 'pre' ? `PRE-OPEN · opens in ${until(mins)}`
                  : st.phase === 'post' ? `CLOSED · opens in ${until(mins)}`
                    : `WEEKEND · opens in ${until(mins)}`}
            </div>
            {/* Shown per exchange rather than once at the bottom, because the
                exchange row is where a reader forms the belief that this app
                knows when that exchange is trading. The correction belongs
                next to the belief. */}
            {st.dstInForce && <div className="gm-sess-dst">daylight saving in force</div>}
          </div>
        );
      })}
    </div>
  );
}

// --------------------------------------------------------------- index row

export function IndexRow({ row }) {
  const [open, setOpen] = useState(false);
  const cov = row.coverage;
  const reached = cov.state !== UNREACHABLE;
  const chg = row.change;
  return (
    <div className={`gm-row gm-row-${cov.state}`}>
      <button className="gm-row-main" onClick={() => setOpen(o => !o)}>
        <span className="gm-row-mark" style={{ background: row.color, boxShadow: `0 0 6px ${row.color}` }} />
        <span className="gm-row-id">
          <span className="gm-row-short" style={{ color: row.color }}>{row.short}</span>
          <span className="gm-row-label">{row.label}</span>
          <span className="gm-row-ex">{row.exchange || '—'} · {row.regionLabel}</span>
        </span>
        <Spark points={row.points} />
        <span className="gm-row-val">
          {/* An unreached index shows a dash, never a zero. Zero is a number and
              would sort, colour and read as one. */}
          <span className="gm-row-num">{reached ? fmtNum(row.value) : '—'}</span>
          <span
            className="gm-row-chg"
            style={{ color: chg == null ? 'var(--ink-3)' : chg >= 0 ? 'var(--green)' : 'var(--red)' }}
          >
            {chg == null ? 'no change data' : `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%`}
          </span>
        </span>
        <span className="gm-row-state">
          <CoverageChip state={cov.state} />
          <span className="gm-row-age">
            {reached ? ago(cov.ageMin) : 'never'}
          </span>
        </span>
        <span className="gm-row-caret">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="gm-row-why">
          <p className="gm-why-text">{cov.why}</p>
          {cov.remedy && <p className="gm-why-remedy">{cov.remedy}</p>}
          <div className="gm-why-facts">
            {/* The two timestamps side by side, always both, because the whole
                point of decision 6 is that they are different facts. Showing
                only one lets the reader assume they are the same. */}
            <span><b>Data for</b> {row.lastDate || '—'}</span>
            <span><b>Last checked</b> {row.fetchedAt ? ago(cov.fetchedMin) : 'never'}</span>
            <span><b>Source</b> {row.source || '—'}</span>
            {cov.sessionsBehind ? (
              <span><b>Behind by</b> ~{cov.sessionsBehind} session{cov.sessionsBehind === 1 ? '' : 's'} (approx)</span>
            ) : null}
          </div>
          {cov.providerBehind && (
            <p className="gm-why-flag">
              The app is up to date with a provider that is not. This is not fixed by refreshing.
            </p>
          )}
          {row.session && <p className="gm-why-caveat">{row.session.holidayCaveat}</p>}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------- instruments

export function InstrumentTable() {
  const s = instrumentSummary();
  return (
    <div className="gm-inst">
      <p className="gm-inst-note">{s.note}</p>
      <div className="gm-inst-grid">
        {INSTRUMENTS.map(i => (
          <div key={i.key} className="gm-inst-row" style={{ borderColor: PRICING_COLOR[i.priced] }}>
            <div className="gm-inst-top">
              <span className="gm-inst-label">{i.label}</span>
              <span className="gm-inst-region">{(REGIONS[i.market] || {}).label || i.market}</span>
            </div>
            <div className="gm-inst-how" style={{ color: PRICING_COLOR[i.priced] }}>
              {PRICING_LABEL[i.priced]}
            </div>
            <div className="gm-inst-desc">{i.note}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ screen

export default function GlobalMarkets() {
  const now = useNow(60000);
  const [cache, setCache] = useState({});
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [region, setRegion] = useState('all');

  // Decision 5: the screen opens on what the cache already knows. Reading the
  // cache is not a network call and does not need a press; a network call does.
  const load = useCallback(async () => {
    try { setCache(await readCache()); } catch { setCache({}); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const refresh = async () => {
    setLoading(true);
    setMsg('');
    try {
      await fetchBenchmarks();
      await load();
      setMsg('Checked every provider.');
    } catch (e) {
      // The failure is reported as a failure. The alternative — silently keeping
      // the old numbers on screen after a failed refresh — leaves the reader
      // believing they just saw fresh data.
      setMsg(`Refresh failed: ${e && e.message ? e.message : 'no provider answered'}. The levels below are unchanged.`);
    }
    setLoading(false);
  };

  const rows = catalogue(cache, now);
  const shown = region === 'all' ? rows : rows.filter(r => r.region === region);
  // Summarised over the FULL catalogue, never over the filter. A filtered
  // headline would say "2 of 2 current" while four other markets sat unreached
  // one click away, which is a true sentence doing a false job.
  const sum = coverageSummary(rows);

  return (
    <div className="gm-wrap">
      <p className="gm-disclaimer">{DISCLAIMER}</p>

      <Card
        title="Every market we cover"
        color="var(--cyan)"
        right={
          <button className="btn btn-sm btn-cyan" onClick={refresh} disabled={loading}>
            {loading ? 'CHECKING…' : 'REFRESH'}
          </button>
        }
      >
        {/* Rule 3: two numbers, never one. */}
        <div className="gm-head">
          <div className="gm-head-nums">
            <div className="gm-head-num">
              <span className="gm-head-v" style={{ color: 'var(--cyan)' }}>{sum.named}</span>
              <span className="gm-head-l">markets listed</span>
            </div>
            <span className="gm-head-sep">/</span>
            <div className="gm-head-num">
              <span
                className="gm-head-v"
                style={{ color: sum.live ? 'var(--green)' : 'var(--ink-3)' }}
              >{sum.live}</span>
              <span className="gm-head-l">with a current level</span>
            </div>
          </div>
          <p className="gm-head-note">{coverageNote(sum)}</p>
        </div>

        {msg && <p className="gm-msg">{msg}</p>}

        <SessionStrip now={now} />

        <div className="gm-filter">
          <button className={`seg-btn${region === 'all' ? ' on' : ''}`} onClick={() => setRegion('all')}>All</button>
          {Object.values(REGIONS).map(r => (
            <button
              key={r.key}
              className={`seg-btn${region === r.key ? ' on' : ''}`}
              onClick={() => setRegion(r.key)}
            >{r.label}</button>
          ))}
        </div>

        <div className="gm-rows">
          {shown.length === 0
            ? <Empty icon="?" text="No markets in this region." />
            : shown.map(r => <IndexRow key={r.key} row={r} />)}
        </div>

        <p className="gm-foot">
          Tap any row for why its level reads the way it does. Freshness is judged
          against that market’s own last session, not against the clock — a Friday
          close is the current level of the index all weekend.
        </p>
      </Card>

      <Card title="What this app can hold" color="var(--purple)">
        <InstrumentTable />
      </Card>
    </div>
  );
}
