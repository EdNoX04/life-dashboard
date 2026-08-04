import { useMemo, useState } from 'react';
import { Card, Empty, StatTile } from '../ui.jsx';
import {
  YIELD_BASIS, basisMeta, YIELD_RANGES, DEFAULT_RANGE, windowSeries, stats, rankOf,
  ordinal, verdictFor, growthTable, growth1y, spectrum, SPECTRUM_HINT, PCTS,
  buildYieldSeries, MIN_OBS, DISCLAIMER,
} from '../../lib/yieldlens.js';

// The yield analyser screen.
//
// Three things on this page are load-bearing and easy to mistake for decoration.
//
// 1. THE SPECTRUM IS DRAWN IN YIELD, THE TICKS ARE NOT EVENLY SPACED. See
//    spectrum() in the lib. If the ticks ever come out evenly spaced on real
//    data, the bar has been rebuilt as a percentile ruler and has stopped
//    carrying any information about the shape of the distribution.
//
// 2. THE GROWTH ROW IS AN INPUT, NOT A FOOTNOTE. Its heading says so out loud —
//    "so the yield isn't shrinking on you" — because the verdict above it is
//    computed partly from these three numbers, and a reader who takes the row as
//    context rather than as evidence will not understand why a 95th-percentile
//    yield came back as a trap.
//
// 3. THE APPROXIMATION BANNER IS UNCONDITIONAL. When the yield history was
//    reconstructed from prices against a single dividend figure, everything on
//    the screen is biased, and the banner appears above the verdict rather than
//    below the chart. A caveat placed after the number it qualifies is a caveat
//    nobody reads.

const pct = v => (v === null || v === undefined ? '—' : `${v.toFixed(2)}%`);
const signed = v => (v === null || v === undefined ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`);

const fmtDate = d => (d instanceof Date && !Number.isNaN(d.getTime())
  ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  : '—');

/** The gradient bar with a needle on it. Red at the low-yield end, green at the high. */
function Spectrum({ sp, today }) {
  if (!sp) return null;
  const x = sp.span > 0 ? Math.max(0, Math.min(1, sp.at(today))) : 0.5;
  return (
    <div className="yl-spec">
      <div className="yl-spec-head">
        <span className="yl-spec-title">YIELD SPECTRUM</span>
        <span className="yl-spec-hint">{SPECTRUM_HINT}</span>
      </div>
      <div className="yl-spec-bar">
        <div className="yl-spec-grad" />
        {sp.marks.filter(m => m.p !== 0 && m.p !== 100).map(m => (
          <i key={m.key} className="yl-spec-tick" style={{ left: `${m.x * 100}%` }} />
        ))}
        <i className="yl-spec-needle" style={{ left: `${x * 100}%` }} title={`Today ${pct(today)}`} />
      </div>
      <div className="yl-spec-scale">
        {sp.marks.map(m => (
          <span key={m.key} className="yl-spec-mark" style={{ left: `${m.x * 100}%` }}>
            <b>{m.short}</b>
            <em>{pct(m.value)}</em>
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * The yield history line with the P10 and P90 floors drawn across it.
 *
 * Hand-rolled SVG, like every chart in this app — there is no chart library in
 * the dependency list and there is not going to be one. The floors are dashed
 * and labelled at the right edge because an unlabelled horizontal line on a
 * yield chart reads as a target, which is the one thing it is not.
 */
function History({ rows, st, w = 900, h = 260 }) {
  if (!rows || rows.length < 2 || !st) return null;
  const padL = 44, padR = 46, padT = 12, padB = 26;
  const t0 = rows[0].t.getTime(), t1 = rows[rows.length - 1].t.getTime();
  const span = t1 - t0 || 1;
  // The band is padded by a tenth of the range so the line never touches the
  // frame; a series that grazes the top of its own box looks clipped.
  const lo = st.min - (st.max - st.min) * 0.1 || st.min * 0.95;
  const hi = st.max + (st.max - st.min) * 0.1 || st.max * 1.05;
  const vspan = hi - lo || 1;
  const X = t => padL + ((t - t0) / span) * (w - padL - padR);
  const Y = v => padT + (1 - (v - lo) / vspan) * (h - padT - padB);

  const d = rows.map((r, i) => `${i ? 'L' : 'M'}${X(r.t.getTime()).toFixed(1)},${Y(r.y).toFixed(1)}`).join('');
  const last = rows[rows.length - 1];

  // Y gridlines on whole percentage points, which is what a yield reader
  // actually looks for. Ticks at computed intervals land on 7.34% and are
  // unreadable.
  const gridStep = vspan > 6 ? 2 : vspan > 2 ? 1 : 0.5;
  const grid = [];
  for (let v = Math.ceil(lo / gridStep) * gridStep; v <= hi; v += gridStep) grid.push(v);

  const years = [];
  const y0 = rows[0].t.getFullYear(), y1 = last.t.getFullYear();
  for (let y = y0; y <= y1; y++) {
    const t = new Date(y, 0, 1).getTime();
    if (t >= t0 && t <= t1) years.push({ y, x: X(t) });
  }

  return (
    <div className="yl-hist">
      <div className="yl-sec-title">YIELD HISTORY WITH PERCENTILE FLOORS</div>
      <svg className="yl-hist-svg" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img"
        aria-label="Yield history">
        {grid.map(v => (
          <g key={v}>
            <line x1={padL} x2={w - padR} y1={Y(v)} y2={Y(v)} stroke="var(--border)" strokeWidth="1"
              shapeRendering="crispEdges" />
            <text x={padL - 6} y={Y(v) + 4} className="yl-ax" textAnchor="end">{v.toFixed(0)}%</text>
          </g>
        ))}
        {years.map(t => (
          <text key={t.y} x={t.x} y={h - 8} className="yl-ax" textAnchor="middle">{t.y}</text>
        ))}
        <line x1={padL} x2={w - padR} y1={Y(st.p90)} y2={Y(st.p90)} stroke="var(--green)"
          strokeWidth="1" strokeDasharray="5 4" shapeRendering="crispEdges" />
        <line x1={padL} x2={w - padR} y1={Y(st.p10)} y2={Y(st.p10)} stroke="var(--red)"
          strokeWidth="1" strokeDasharray="5 4" shapeRendering="crispEdges" />
        <path d={d} fill="none" stroke="var(--green)" strokeWidth="1.5" className="yl-line" />
        <circle cx={X(last.t.getTime())} cy={Y(last.y)} r="3.5" fill="var(--green)" className="yl-dot" />
        <g>
          <rect x={w - padR + 2} y={Y(st.p90) - 8} width="38" height="16" rx="2"
            fill="var(--panel)" stroke="var(--green)" shapeRendering="crispEdges" />
          <text x={w - padR + 21} y={Y(st.p90) + 4} className="yl-flag" textAnchor="middle"
            fill="var(--green)">P90</text>
        </g>
        <g>
          <rect x={w - padR + 2} y={Y(st.p10) - 8} width="38" height="16" rx="2"
            fill="var(--panel)" stroke="var(--red)" shapeRendering="crispEdges" />
          <text x={w - padR + 21} y={Y(st.p10) + 4} className="yl-flag" textAnchor="middle"
            fill="var(--red)">P10</text>
        </g>
      </svg>
    </div>
  );
}

export default function YieldLens({
  ticker = '', name = '', prices = [], divSeries = [], series = null, today = new Date(),
}) {
  const [basis, setBasis] = useState('fwd');
  const [range, setRange] = useState(DEFAULT_RANGE);

  const built = useMemo(
    () => (series ? { rows: series, approx: false, note: null } : buildYieldSeries(prices, divSeries, { basis })),
    [series, prices, divSeries, basis],
  );
  const win = useMemo(() => windowSeries(built.rows, range, { today }), [built, range, today]);
  const st = useMemo(() => stats(win), [win]);
  const todayY = st ? st.last.y : null;
  const rank = useMemo(() => rankOf(win, todayY), [win, todayY]);
  const g1 = useMemo(() => growth1y(divSeries, { today }), [divSeries, today]);
  const verdict = verdictFor(rank, { n: st?.n || 0, growth1y: g1 });
  const growth = useMemo(() => growthTable(divSeries, { today }), [divSeries, today]);
  const sp = useMemo(() => spectrum(st), [st]);

  if (!built.rows.length) {
    return (
      <Card title="Yield Analyzer" color="var(--green)">
        <Empty icon="%" text={`No price or dividend history saved${ticker ? ` for ${ticker}` : ''}, so there is no yield series to analyse.`} />
      </Card>
    );
  }

  return (
    <Card
      title="Yield Analyzer"
      color="var(--green)"
      right={(
        <div className="yl-ranges">
          {YIELD_RANGES.map(r => (
            <button key={r.key} type="button"
              className={`yl-range${range === r.key ? ' on' : ''}`}
              onClick={() => setRange(r.key)}>{r.label}</button>
          ))}
        </div>
      )}
    >
      <div className="yl-top">
        <div className="yl-basis">
          {YIELD_BASIS.map(b => (
            <button key={b.key} type="button"
              className={`yl-basis-b${basis === b.key ? ' on' : ''}`}
              title={b.note}
              onClick={() => setBasis(b.key)}>{b.label}</button>
          ))}
        </div>
        <span className="yl-basis-note small">{basisMeta(basis).note}</span>
      </div>

      {built.approx && (
        <div className="yl-approx">▲ {built.note}</div>
      )}

      <div className="yl-verdict" style={{ borderColor: verdict.color }}>
        <div className="yl-verdict-l">
          <div className="yl-verdict-k">VERDICT</div>
          <div className="yl-verdict-v" style={{ color: verdict.color }}>{verdict.label}</div>
          <div className="yl-verdict-line">{verdict.line}</div>
        </div>
        <div className="yl-verdict-r">
          <div className="yl-verdict-k">TODAY&#39;S YIELD</div>
          <div className="yl-verdict-y">{pct(todayY)}</div>
          <div className="yl-verdict-p">
            {st && !st.thin && rank !== null
              ? `${ordinal(rank)} percentile of ${range}`
              : `under ${MIN_OBS} observations`}
          </div>
        </div>
      </div>

      <Spectrum sp={sp} today={todayY} />

      <div className="yl-sec">
        <div className="yl-sec-head">
          <span className="yl-sec-title">HISTORICAL YIELD STATS</span>
          <span className="yl-sec-n small">
            {st ? `${st.n.toLocaleString('en-IN')} observations · ${fmtDate(st.span.from)} → ${fmtDate(st.span.to)}` : '—'}
          </span>
        </div>
        <div className="yl-cuts">
          {PCTS.map(c => (
            <div key={c.key} className={`yl-cut yl-cut-${c.key}`}>
              <div className="yl-cut-k">{c.label}</div>
              <div className="yl-cut-v">{pct(st ? st[c.key] : null)}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="yl-sec">
        <div className="yl-sec-title">DIVIDEND GROWTH (SO THE YIELD ISN&#39;T SHRINKING ON YOU)</div>
        <div className="yl-grow">
          {growth.map(g => (
            <StatTile key={g.years} label={`${g.years}Y CAGR`} value={signed(g.cagr)}
              color={g.cagr === null ? 'var(--ink-3)' : g.cagr < 0 ? 'var(--red)' : 'var(--green)'}
              note={g.cagr === null ? 'no history that far back' : `${g.from ? fmtDate(g.from.t) : ''} → ${g.to ? fmtDate(g.to.t) : ''}`} />
          ))}
        </div>
      </div>

      <History rows={win} st={st} />

      <p className="yl-disc small">{DISCLAIMER}</p>
    </Card>
  );
}
