import React, { useEffect, useMemo, useState } from 'react';
import { Card, Empty, StatTile } from '../ui.jsx';
import { metaOf, assetMetaSync, loadAssetMeta } from '../../lib/assets.js';
import { fetchMetrics, hasKey, cachedAt } from '../../lib/fundamentals.js';
import {
  FACTORS, THEMES, MIN_COVERAGE, NEUTRAL,
  portfolioTilt, tiltSummary, themeExposure, themeOverlap, untagged, concentrationFlags,
} from '../../lib/factors.js';

// The factor and theme desk.
//
// Two screens stacked, and the whole design job is keeping them from being read
// as one thing. The top half is measurement: computed properties of the companies
// you own, which are either known or not known. The bottom half is storytelling:
// keyword guesses about what those companies sell, which are sometimes wrong.
// Presenting a guess in the same visual language as a measurement is the single
// worst thing this screen could do, so they get different marks, different words,
// and the theme half prints its own working.
//
// Four things this component does that a prettier version would not:
//
//   1. An unmeasured factor renders as the WORDS "not measured" — never as a bar
//      at the neutral line. A bar at neutral is a claim; a gap is the truth.
//   2. Theme exposure is drawn as separate bars on their own baselines, never as
//      a pie or a stacked bar, and the screen prints the sum out loud when it
//      exceeds 100 so nobody tries to read the bars as slices.
//   3. Every theme lists the holdings behind it, so an over-match is visible
//      rather than buried inside a percentage.
//   4. The neutral line is drawn AND labelled as arbitrary. It is the midpoint of
//      a band this app chose, not the market.

// ---- the factor bars -----------------------------------------------------

// One factor, one bar, plus the coverage that bar was computed from. The bar and
// the coverage are deliberately adjacent: a score of 80 computed from a fifth of
// the book is a different fact from a score of 80 computed from all of it, and
// putting the two numbers apart is how the difference gets lost.
export function FactorBars({ tilt = {}, onPick = null, picked = null }) {
  const any = FACTORS.some(f => tilt[f.key]?.score != null);
  if (!any) {
    return (
      <Empty
        icon="?"
        text="No ratios loaded yet. Nothing here is zero — it is unknown, which is a different thing, and the screen will not guess."
      />
    );
  }
  return (
    <div className="fac-bars">
      {FACTORS.map(f => {
        const t = tilt[f.key] || {};
        const has = t.score != null;
        const thin = has && t.covered < MIN_COVERAGE;
        return (
          <div
            key={f.key}
            className={`fac-row${picked === f.key ? ' on' : ''}`}
            onClick={onPick ? () => onPick(picked === f.key ? null : f.key) : undefined}
            role={onPick ? 'button' : undefined}
          >
            <div className="fac-label" style={{ color: f.color }}>{f.label}</div>
            <div className="fac-track">
              {/* Decision 4 made visible: the reference line is drawn, and the
                  caption below the block says what it is and is not. */}
              <div className="fac-neutral" style={{ left: NEUTRAL + '%' }} />
              {has ? (
                <div
                  className="fac-fill"
                  style={{
                    width: Math.max(1.5, t.score) + '%',
                    background: f.color,
                    filter: `drop-shadow(0 0 4px ${f.color})`,
                    opacity: thin ? 0.45 : 1,
                  }}
                />
              ) : (
                // Decision 1: absence is words, not a bar at the middle.
                <div className="fac-unmeasured">not measured</div>
              )}
            </div>
            <div className="fac-score">
              {has
                ? <b style={{ color: f.color }}>{t.score.toFixed(0)}</b>
                : <span className="muted small">—</span>}
            </div>
            <div className="fac-cov">
              {has ? (
                <span className={thin ? 'chip c-orange' : 'chip'}>
                  {(t.covered * 100).toFixed(0)}% covered{thin ? ' — thin' : ''}
                </span>
              ) : (
                <span className="muted small">no holding has this ratio</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// The band a factor was scored against, plus what it means and who is missing.
// Opened by clicking a bar, because six of these on screen at once is a wall.
export function FactorDetail({ tilt = {}, factorKey = null }) {
  const f = FACTORS.find(x => x.key === factorKey);
  if (!f) return null;
  const t = tilt[f.key] || {};
  return (
    <div className="fac-detail">
      <div className="fac-dhead" style={{ color: f.color }}>{f.label}</div>
      <p className="small">{f.what}</p>
      {/* Decision 2: the band is printed so the score can be argued with. A score
          you cannot check the arithmetic of is a score you have to take on faith. */}
      <p className="small muted">Scored against a fixed band: {f.band}. The band is this app's, not a market standard.</p>
      {t.missing?.length > 0 && (
        <p className="small">
          <span className="muted">Left out for want of data: </span>
          {t.missing.map(m => <span key={m} className="chip" style={{ marginRight: 4 }}>{m}</span>)}
        </p>
      )}
    </div>
  );
}

// The one-line read, which refuses to exist when coverage is too thin.
export function TiltSummary({ summary = {} }) {
  if (!summary.readable) {
    return (
      <div className="fac-warn">
        <b>No tilt reported.</b> {summary.reason || 'not enough data'}. A tilt computed from a
        fraction of the book is a statement about that fraction, so this screen would rather
        say nothing than say it about the whole portfolio.
      </div>
    );
  }
  const name = arr => arr.map(t => t.label).join(', ');
  return (
    <div className="fac-summary">
      {summary.leans.length > 0 && (
        <p><span className="muted">Leans towards </span><b style={{ color: 'var(--green)' }}>{name(summary.leans)}</b>.</p>
      )}
      {summary.against.length > 0 && (
        <p><span className="muted">Leans away from </span><b style={{ color: 'var(--orange)' }}>{name(summary.against)}</b>.</p>
      )}
      {summary.leans.length === 0 && summary.against.length === 0 && (
        <p className="muted">Nothing in this book tilts far enough from the middle to be worth a name.</p>
      )}
      <p className="small muted">
        "Towards" and "away" are measured against the midpoint of each band above — an anchor
        this app picked, not the market. Nothing here is a comparison to an index.
      </p>
    </div>
  );
}

// ---- themes --------------------------------------------------------------

// Decision 2 and 3, which are the whole reason this is a bar list and not a pie:
// each bar sits on its own baseline, so nothing about the layout suggests the
// percentages partition anything. The overlap line above says it in words too.
export function ThemeBars({ exposure = [], overlap = null, open = null, onOpen = null }) {
  if (!exposure.length) {
    return <Empty icon="?" text="Nothing in the book matched a theme. That is usually a book of broad funds, and occasionally a gap in the keyword list." />;
  }
  return (
    <div>
      {overlap?.overlapping && (
        <div className="fac-overlap">
          These bars <b>add up to {overlap.sum.toFixed(0)}%</b>, which is not a mistake. A company
          can belong to several themes at once — one chip designer is AI and semiconductors and
          possibly cloud — so each bar is "share of the book that touches this theme", and they
          overlap. They are not slices of anything and must not be added up. The book holds{' '}
          {overlap.distinct} distinct positions across all themes shown.
        </div>
      )}
      <div className="fac-themes">
        {exposure.map(e => (
          <div key={e.key} className="fac-theme">
            <div className="fac-thead" onClick={onOpen ? () => onOpen(open === e.key ? null : e.key) : undefined} role={onOpen ? 'button' : undefined}>
              <span className="fac-tname" style={{ color: e.color }}>{e.label}</span>
              <span className="fac-tpct" style={{ color: e.color }}>{e.pct.toFixed(1)}%</span>
              <span className="muted small">{e.holdings.length} holding{e.holdings.length === 1 ? '' : 's'}</span>
              {onOpen && <span className="muted small">{open === e.key ? '▾' : '▸'}</span>}
            </div>
            {/* Own baseline, own track. Nothing is stacked against anything. */}
            <div className="fac-ttrack">
              <div className="fac-tfill" style={{ width: Math.min(100, e.pct) + '%', background: e.color, filter: `drop-shadow(0 0 4px ${e.color})` }} />
            </div>
            {/* Decision 3: the holdings behind every theme, always available.
                A keyword match that is wrong is only correctable if it is visible. */}
            {(open === e.key || !onOpen) && (
              <div className="fac-tholds">
                {e.holdings.map(h => (
                  <span key={h.ticker} className="chip" title={h.name || h.ticker}>{h.ticker}</span>
                ))}
                <span className="small muted">
                  Matched by ticker, company name or sector — which means a match here is a guess,
                  and a wrong one is yours to spot.
                </span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ConcentrationFlags({ flags = [] }) {
  if (!flags.length) return null;
  return (
    <div className="mt">
      {flags.map(f => (
        <div key={f.key} className={`fac-flag ${f.level}`}>
          <b>{f.label} — {f.pct.toFixed(0)}%</b>
          <div className="small">{f.note}</div>
        </div>
      ))}
      {/* Decision 6, said out loud rather than left implied by the absence of a
          verb: this block describes a shape. It does not ask for a trade. */}
      <p className="small muted mt">
        These thresholds are conventional rules of thumb, not rules. Nothing above is a
        suggestion to buy or sell anything — concentration is a description of how the book is
        arranged, and a concentrated book is a choice some people make deliberately.
      </p>
    </div>
  );
}

export function UntaggedList({ rows = [], total = 0 }) {
  if (!rows.length) return null;
  const value = rows.reduce((s, r) => s + r.value, 0);
  return (
    <div className="mt">
      <div className="small muted mb">
        Matched no theme at all — {total > 0 ? ((value / total) * 100).toFixed(1) : '0'}% of the book.
        Usually broad funds and cash-like holdings; occasionally a keyword this app has not learnt.
      </div>
      <div className="flex" style={{ gap: 4, flexWrap: 'wrap' }}>
        {rows.map(r => <span key={r.ticker} className="chip" title={r.name || r.ticker}>{r.ticker}</span>)}
      </div>
    </div>
  );
}

// ---- the screen ----------------------------------------------------------

export default function FactorDesk({ held = [], priceOf = () => null, visible = true }) {
  const [metrics, setMetrics] = useState({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [meta, setMeta] = useState(() => assetMetaSync());
  const [pick, setPick] = useState(null);
  const [openTheme, setOpenTheme] = useState(null);

  useEffect(() => { loadAssetMeta().then(setMeta).catch(() => {}); }, []);

  // Value-weighted, because an equal-weighted factor score describes a watchlist
  // rather than a portfolio.
  const rows = useMemo(() => held.map(h => {
    const px = Number(priceOf(h.ticker)) || Number(h.last_price) || Number(h.avg_cost) || 0;
    return {
      ticker: h.ticker,
      name: h.name || h.ticker,
      value: px * (Number(h.qty) || 0),
      meta: metaOf(h.ticker, meta),
      metric: metrics[String(h.ticker || '').toUpperCase()] || null,
    };
  }).filter(r => r.value > 0), [held, priceOf, meta, metrics]);

  const total = rows.reduce((s, r) => s + r.value, 0);
  const tilt = useMemo(() => portfolioTilt(rows), [rows]);
  const summary = useMemo(() => tiltSummary(tilt), [tilt]);
  const exposure = useMemo(() => themeExposure(rows), [rows]);
  const overlap = useMemo(() => themeOverlap(exposure), [exposure]);
  const flags = useMemo(() => concentrationFlags(exposure), [exposure]);
  const loose = useMemo(() => untagged(rows), [rows]);

  const measured = rows.filter(r => r.metric).length;

  async function load() {
    if (busy || !rows.length) return;
    setBusy(true); setDone(0);
    try {
      await fetchMetrics(rows.map(r => r.ticker), (t, v, all) => {
        setDone(Object.keys(all).length);
        setMetrics({ ...all });
      });
    } catch {}
    setBusy(false);
  }

  if (!held.length) return <Empty icon="$" text="No holdings yet — nothing to measure." />;

  return (
    <>
      <div className="tile-row">
        <StatTile label="Holdings" value={rows.length} color="var(--cyan)" />
        <StatTile label="With ratios" value={`${measured} / ${rows.length}`} note="everything else scores as unmeasured" color={measured ? 'var(--green)' : 'var(--orange)'} />
        <StatTile label="Themes matched" value={exposure.length} note="overlapping, not slices" color="var(--pink)" />
        <StatTile label="Untagged" value={loose.length} color="var(--purple)" />
      </div>

      <Card
        title="Factor tilt"
        color="var(--green)"
        right={
          <button className="btn btn-sm btn-cyan" onClick={load} disabled={busy || !hasKey()}>
            {busy ? `loading ${done}/${rows.length}…` : measured ? 'reload ratios' : 'load ratios'}
          </button>
        }
      >
        {/* The convention, stated before any bar is shown. */}
        <p className="small muted mb">
          Six measured properties of the companies you own — not opinions about them. Each bar is a
          value-weighted average across the holdings that actually have the ratio; the ones that do
          not are left out entirely rather than scored down the middle, because a book nobody has
          data for would otherwise read as perfectly balanced.
        </p>
        {!hasKey() && (
          <div className="fac-warn mb">
            No market-data key configured, so no ratios can be fetched. The screen below is empty
            rather than estimated.
          </div>
        )}
        <FactorBars tilt={tilt} onPick={setPick} picked={pick} />
        <FactorDetail tilt={tilt} factorKey={pick} />
        <div className="small muted mt">
          The dotted line is {NEUTRAL} — the midpoint of each band. It is an arbitrary anchor this
          app chose so the bars have somewhere to be measured from. It is <b>not</b> the market
          average, and this screen never compares you to one.
          {cachedAt(rows[0]?.ticker) ? ' Ratios are cached for a day.' : ''}
        </div>
        <div className="mt"><TiltSummary summary={summary} /></div>
      </Card>

      <Card title="Theme exposure" color="var(--pink)">
        <p className="small muted mb">
          What the book is betting on, matched from tickers, company names and sectors. This half of
          the screen is guesswork and is labelled as such — every theme lists the holdings behind it
          so a bad match is something you can see rather than something buried in a percentage.
        </p>
        <ThemeBars exposure={exposure} overlap={overlap} open={openTheme} onOpen={setOpenTheme} />
        <ConcentrationFlags flags={flags} />
        <UntaggedList rows={loose} total={total} />
      </Card>

      <div className="ai-note">
        Everything on this page describes what you already own. It does not rank your holdings, it
        does not suggest what to add, and it is not investment advice — a low value score is not a
        fault, and a concentrated theme is not a mistake. Both are just the shape of the book,
        written down.
      </div>
    </>
  );
}
