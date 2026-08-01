import React, { useEffect, useMemo, useState } from 'react';
import { Card, Empty } from '../ui.jsx';
import * as M from '../../lib/finmetric.js';
import { fetchFundamentals } from '../../lib/fundamentals.js';

// The screen half of lib/finmetric.js.
//
// The six decisions about the arithmetic live in that file. Three belong here,
// because they are about what a CONTROL implies rather than what a number is —
// and on this screen the controls are the dangerous part. Every one of them
// offers a transformation that the feed cannot actually support, and the honest
// version of each is a button that stays put and explains itself.
//
// A. A REFUSED CONTROL IS DISABLED WITH ITS REASON BESIDE IT, NEVER HIDDEN, AND
//    NEVER SILENTLY RE-ROUTED. TTM is impossible for a ratio. Three ways to
//    handle that: hide the button, quietly switch the frequency to Quarterly, or
//    disable it and say why. Hiding makes the control row change shape as Neel
//    clicks through metrics, which reads as a bug and teaches nothing. Silently
//    switching is worse than either — it changes every number on the screen
//    without a word, so a chart he selected as TTM is showing quarterly figures
//    under a heading he chose. The button therefore stays, stays selected, and
//    the panel below prints the refusal in place of the chart.
//
// B. A REFUSED GROWTH TILE PRINTS ITS OWN REASON, BECAUSE THE REASONS ARE NOT
//    INTERCHANGEABLE. The reference draws four CAGR tiles and a dash where a
//    figure is missing. But "not enough history", "the base was negative" and
//    "the company lost money in the final year" are three different facts about
//    the company, and only the first is about the data. Collapsing them into one
//    dash throws away the only interesting part.
//
// C. EVERY HEADLINE CARRIES ITS PERIOD. A large figure with no date looks
//    current. An annual series that ends in 2023 because the 2024 filing has not
//    reached this feed yet looks identical to one that ends last quarter, and
//    the difference is a year of the company's life. The date rides with the
//    number everywhere it appears — headline, total, and both ends of every
//    change.

const f2 = n => (Number.isFinite(n) ? n.toFixed(2) : '—');
const pctS = n => (Number.isFinite(n) ? `${n >= 0 ? '+' : ''}${n.toFixed(2)}%` : '—');

// ---------- the menu (lib decision 1 on screen) ----------

export function MetricMenu({ metrics, value, onPick }) {
  if (!metrics || !metrics.length) return null;
  return (
    <div className="fm-menu">
      {metrics.map(m => (
        <button
          key={m.key}
          className={`fm-menu-btn${m.key === value ? ' on' : ''}${m.known ? '' : ' fm-unknown'}`}
          onClick={() => onPick(m.key)}
          title={m.known
            ? `${m.n} periods · treated as a ${M.kindInfo(m.kind).label}`
            : `${m.n} periods · this key is not in the catalogue, so it is treated as a ratio and TTM is disabled for it`}
        >
          {m.label}
          <span className="fm-menu-n">{m.n}</span>
        </button>
      ))}
    </div>
  );
}

// ---------- what kind of figure this is, and whether we know ----------

export function KindPill({ info }) {
  if (!info) return null;
  const k = M.kindInfo(info.kind);
  return (
    <span className={`fm-kind${info.known ? '' : ' fm-kind-x'}`} title={k.note}>
      {k.label}
      {/* Decision 4 in the lib is invisible unless the screen says it out loud:
          an unknown key is not known to be a ratio, it is being TREATED as one
          so that nothing gets summed by accident. */}
      {!info.known && <em> assumed</em>}
    </span>
  );
}

// ---------- year on year ----------

export function YoyChip({ y, unit, cur = '$' }) {
  if (!y) return <span className="fm-chip fm-chip-x">not a full year of periods yet</span>;
  if (y.state === 'base_zero') {
    return <span className="fm-chip fm-chip-x">the figure a year ago was zero, so a percentage change has no meaning</span>;
  }
  const up = y.pct >= 0;
  const col = up ? 'var(--green)' : 'var(--red)';
  return (
    <span className="fm-chip" style={{ color: col, borderColor: col }}>
      <b>{up ? '▲' : '▼'} {pctS(y.pct)}</b>
      {/* Decision C: both ends, both dated. */}
      <span className="fm-chip-base">
        {M.fmtVal(y.from.v, unit, cur)} ({y.from.period}) → {M.fmtVal(y.to.v, unit, cur)} ({y.to.period})
      </span>
      {y.crossed && (
        <span className="fm-chip-warn">crossed zero — the percentage is arithmetic, not a description</span>
      )}
    </span>
  );
}

// ---------- the bars (lib decision 6) ----------

export function BarChart({ rows, unit = '', cur = '$' }) {
  const g = useMemo(() => M.barGeometry(rows), [rows]);
  if (!g) return null;
  // Labels thin out rather than overlap; forty quarters cannot each carry a date.
  const every = Math.max(1, Math.ceil(g.n / 8));
  return (
    <div className="fm-chart">
      <svg className="fm-svg" viewBox={`0 0 ${g.w} ${g.h}`} preserveAspectRatio="none"
        shapeRendering="crispEdges" style={{ imageRendering: 'pixelated' }}>
        {g.bars.map(b => (
          <rect key={b.period} x={b.x} y={b.y} width={b.w} height={b.h}
            fill={b.neg ? 'var(--red)' : 'var(--green)'} opacity="0.85" />
        ))}
        {/* The baseline is drawn on top of the bars, never under them, so a bar
            that touches zero cannot hide the line it is measured from. */}
        <line className="fm-zero" x1="0" x2={g.w} y1={g.zero} y2={g.zero}
          stroke="var(--ink-3)" strokeWidth="1" strokeDasharray="4 3" />
      </svg>
      <div className="fm-axis">
        {g.bars.map((b, i) => (
          <span key={b.period} className="fm-ax" style={{ left: `${(b.cx / g.w) * 100}%` }}>
            {i % every === 0 || i === g.n - 1 ? b.period.slice(0, 7) : ''}
          </span>
        ))}
      </div>
      <p className="fm-zlab">
        Bars run from zero, which is the dashed line{g.anyNeg ? ' — the bars below it are negative' : ''}.
        Range {M.fmtVal(g.lo, unit, cur)} to {M.fmtVal(g.hi, unit, cur)} · {g.n} periods.
      </p>
    </div>
  );
}

// ---------- growth tiles (decision B) ----------

export function GrowthTiles({ rows, freqKey }) {
  const g = useMemo(() => M.growthRow(rows, freqKey), [rows, freqKey]);
  return (
    <div className="fm-grow">
      {g.map(t => (
        <div key={t.years} className={`fm-tile${t.state === 'ok' ? '' : ' fm-tile-x'}`}>
          <span className="fm-tile-lab">{t.years}Y CAGR</span>
          {t.state === 'ok'
            ? (
              <>
                <b className="fm-tile-v" style={{ color: t.pct >= 0 ? 'var(--green)' : 'var(--red)' }}>
                  {pctS(t.pct)}
                </b>
                <span className="fm-tile-note">{f2(t.from.v)} → {f2(t.to.v)}</span>
              </>
            )
            : (
              // Decision B: the reason, not a dash.
              <span className="fm-tile-why">{M.CAGR_REASONS[t.state] || 'not available'}</span>
            )}
        </div>
      ))}
    </div>
  );
}

// ---------- the total toggle, which is a refusal (lib decision 2) ----------

export function TotalPanel({ rows, profile, unit, cur = '$' }) {
  const shares = profile?.shareOutstanding;
  const t = M.latestTotal(rows, shares);
  return (
    <div className="fm-total">
      <p className="fm-total-refuse">{M.TOTAL_REFUSAL}</p>
      {t
        ? (
          <p className="fm-total-v">
            <b>{M.fmtTotalM(t.totalM, cur)}</b>
            <span className="fm-total-work">
              {M.fmtVal(t.perShare, unit, cur)} per share × {t.shares.toFixed(1)}M shares · {t.period}
            </span>
          </p>
        )
        : (
          <p className="fm-total-v fm-total-none">
            No share count came back for this company, so even the latest total cannot be worked out.
          </p>
        )}
    </div>
  );
}

// ---------- screen ----------

export default function FinMetric({ held = [], cur = '$' }) {
  const tickers = useMemo(
    () => [...new Set(held.map(h => String(h.ticker || '').toUpperCase()).filter(Boolean))].sort(),
    [held.map(h => h.ticker).join(',')], // eslint-disable-line
  );

  // Derived, not synced by an effect — the same fix bug #17 forced on the ticker
  // screen, applied here before it can bite: a selection held in state alone is
  // stranded the moment the holding it names is sold, and the screen then draws
  // a chart for something Neel does not own.
  const [pick, setPick] = useState('');
  const ticker = pick && tickers.includes(pick) ? pick : (tickers[0] || '');

  const [fund, setFund] = useState({});      // ticker -> fundamentals
  const [freq, setFreq] = useState('annual');
  const [mPick, setMPick] = useState('');
  const [total, setTotal] = useState(false);
  const [err, setErr] = useState('');

  // Fundamentals are cached for a day inside fundamentals.js and this endpoint is
  // Finnhub's, not Twelve Data's, so it is not competing for the eight-a-minute
  // price budget. That is why this one may run on open and the price chart's may
  // not.
  useEffect(() => {
    if (!ticker) return undefined;
    let dead = false;
    setErr('');
    fetchFundamentals(ticker)
      .then(v => { if (!dead) setFund(p => ({ ...p, [ticker]: v || null })); })
      .catch(e => { if (!dead) { setFund(p => ({ ...p, [ticker]: null })); setErr(e?.message || 'could not load'); } });
    return () => { dead = true; };
  }, [ticker]);

  const f = fund[ticker];
  const series = f?.series || null;
  const metrics = useMemo(() => M.availableMetrics(series, freq), [series, freq]);

  // Derived for the same reason the ticker is: the menu changes when the
  // frequency changes, and a metric that exists annually may not exist quarterly.
  // Holding a stale key in state would leave the screen charting nothing while
  // every button looks unselected.
  const metric = mPick && metrics.some(m => m.key === mPick) ? mPick : (metrics[0]?.key || '');
  const info = metric ? M.metricInfo(metric) : null;

  const res = useMemo(
    () => (series && metric ? M.rowsFor(series, freq, metric) : null),
    [series, freq, metric],
  );
  const rows = res?.rows || [];
  const y = useMemo(() => M.yoy(rows, freq), [rows, freq]);
  const last = rows.length ? rows[rows.length - 1] : null;

  // Decision A: the TTM button knows whether it is possible, and says so in
  // place rather than moving.
  const ttmOff = info ? info.kind === 'ratio' : false;

  return (
    <Card title="Financials" color="var(--cyan)" className="fm-card">
      <div className="fm-bar">
        <div className="seg">
          {tickers.slice(0, 12).map(t => (
            <button key={t} className={`seg-btn${t === ticker ? ' on' : ''}`} onClick={() => setPick(t)}>{t}</button>
          ))}
        </div>
      </div>

      {!tickers.length && <Empty icon="◇" text="No holdings with a ticker yet — this screen reads the filings summary for something you own." />}

      {ticker && !f && !err && <p className="fm-note">Loading the filings summary for {ticker}…</p>}
      {err && <p className="fm-err">{err}</p>}

      {f && !metrics.length && (
        <Empty icon="⌁" text={`This feed returned no ${M.freqMeta(freq).label.toLowerCase()} series with two or more periods for ${ticker}. That is a gap in the free tier, not a gap in the company — try the other frequency.`} />
      )}

      {!!metrics.length && (
        <>
          <div className="fm-freq">
            {M.FREQS.map(fq => {
              const off = fq.key === 'ttm' && ttmOff;
              return (
                <button
                  key={fq.key}
                  className={`fm-freq-btn${freq === fq.key ? ' on' : ''}${off ? ' fm-off' : ''}`}
                  onClick={() => setFreq(fq.key)}
                  title={fq.note}
                >
                  {fq.label}
                </button>
              );
            })}
            <button className={`fm-freq-btn fm-total-btn${total ? ' on' : ''}`} onClick={() => setTotal(v => !v)}>
              Company total
            </button>
          </div>

          {/* Decision A again: the reason sits beside the disabled control, in
              body text, so it is readable on a phone and survives a screenshot. */}
          {ttmOff && (
            <p className="fm-why">
              TTM is off for {info.label}: {M.kindInfo('ratio').note}
            </p>
          )}

          <MetricMenu metrics={metrics} value={metric} onPick={setMPick} />

          <div className="fm-headline">
            <span className="fm-hv">
              {last ? M.fmtVal(last.v, info.unit, cur) : '—'}
            </span>
            {/* Decision C: the period rides with the number. */}
            <span className="fm-hp">{last ? last.period : 'no period'}</span>
            <KindPill info={info} />
            <YoyChip y={y} unit={info.unit} cur={cur} />
          </div>

          {res && res.state === 'refused' && (
            <Empty icon="◇" text={`There is no trailing-twelve-month ${info.label.toLowerCase()}. ${M.kindInfo('ratio').note} Switch to Annual or Quarterly to see the reported figures.`} />
          )}
          {res && res.state === 'too_short' && (
            <Empty icon="◇" text={`A trailing twelve months needs four quarters and this feed returned ${res.have} for ${ticker}. No partial window is drawn — three quarters shown as a year would put a false drop at the left edge of the chart.`} />
          )}
          {res && res.state === 'empty' && (
            <Empty icon="◇" text={`Nothing reported for ${info.label} at this frequency.`} />
          )}

          {res && res.state === 'ok' && res.ttmKind === 'latest' && (
            <p className="fm-note">
              {info.label} is a level, so its trailing figure is simply the latest reading — these bars are the
              reported balances, not four of them added together.
            </p>
          )}

          {res && res.state === 'ok' && rows.length > 0 && (
            <>
              <BarChart rows={rows} unit={info.unit} cur={cur} />
              <GrowthTiles rows={rows} freqKey={freq} />
              {total && <TotalPanel rows={rows} profile={f?.profile} unit={info.unit} cur={cur} />}
            </>
          )}

          {!info.known && (
            <p className="fm-thin">
              “{info.label}” is not a key this screen has a definition for. It is charted as reported and treated as
              a ratio, which is the assumption that permits the least — nothing is summed.
            </p>
          )}
        </>
      )}

      <p className="fm-disc">{M.FIN_DISCLAIMER}</p>
    </Card>
  );
}
