import React, { useEffect, useMemo, useState } from 'react';
import { Card, Empty, StatTile } from '../ui.jsx';
import { memGet, memSet } from '../../lib/advisor.js';
import {
  allocationBreakdown, metaOf, assetMetaSync, loadAssetMeta, MARKETS, CAP_LABEL, EMPTY_FI, loadFixedIncome,
} from '../../lib/assets.js';
import {
  DIMENSIONS, DEFAULT_BAND, DEFAULT_MIN_TRADE, normaliseTargets, driftRows,
  contributionPlan, afterPlan, sellPlan, sleeveHoldings, summarise,
} from '../../lib/rebalance.js';

// The rebalancing desk.
//
// It answers one question — "how far is this book from the mix I said I wanted,
// and what would it take to get back" — and it refuses to answer the question
// underneath it, which is what the mix should be. That one is advice.
//
// The order of the screen is the order of the argument: what you chose, where
// you actually are, what new money alone would fix, and only then what selling
// would fix, with the tax consequence of selling stated before the trade is.

const KEY = 'rebal_targets';

// ---- the target editor ---------------------------------------------------

export function TargetEditor({ labels = [], targets = {}, onChange, onEven, onMatch }) {
  const { given, normalised, empty } = normaliseTargets(targets);
  return (
    <div>
      <div className="rb-targets">
        {labels.map(l => (
          <label key={l} className="rb-trow">
            <span className="rb-tlabel">{l}</span>
            <input
              className="rb-tin" type="number" min="0" max="100" step="1"
              value={targets[l] ?? ''} placeholder="—"
              onChange={e => onChange(l, e.target.value)}
            />
            <span className="rb-tpct">%</span>
          </label>
        ))}
      </div>
      <div className="flex mt" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <button className="btn btn-sm" onClick={onEven}>÷ even split</button>
        <button className="btn btn-sm" onClick={onMatch}>= match current</button>
        <span className="small muted">
          {empty
            ? 'No targets yet — nothing below is drift until there is something to drift from.'
            : normalised
              ? `These add up to ${given.toFixed(0)}%, so they are read as proportions of that ${given.toFixed(0)} rather than of 100. A sleeve left blank has no target at all.`
              : 'Adds up to 100%. A sleeve left blank has no target at all, and is reported rather than trimmed.'}
        </span>
      </div>
    </div>
  );
}

// ---- the drift table -----------------------------------------------------

export function DriftTable({ rows = [], fmt = n => n.toFixed(0), band = DEFAULT_BAND }) {
  if (!rows.length) return <Empty icon="◎" text="Nothing in this book to weigh yet." />;
  return (
    <div className="scroll-x">
      <table className="ptable rb-table">
        <thead>
          <tr>
            <th>Sleeve</th><th>Now</th><th>Target</th><th>Drift</th>
            <th style={{ minWidth: 130 }}>Position</th><th>Gap</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.label} className={r.untargeted ? 'rb-untg' : r.actionable ? 'rb-act' : ''}>
              <td>{r.label}</td>
              <td>{r.weight.toFixed(1)}%</td>
              <td>{r.target == null ? <span className="muted">none</span> : r.target.toFixed(1) + '%'}</td>
              <td style={{ color: r.driftPp == null ? 'var(--ink-3)' : Math.abs(r.driftPp) > band ? 'var(--orange)' : 'var(--ink-2)' }}>
                {r.driftPp == null ? '—' : (r.driftPp > 0 ? '+' : '') + r.driftPp.toFixed(1) + 'pp'}
              </td>
              <td>
                <div className="rb-bar">
                  <div className="rb-bar-fill" style={{
                    width: Math.min(100, r.weight) + '%',
                    background: r.untargeted ? 'var(--ink-3)' : r.actionable ? 'var(--orange)' : 'var(--cyan)',
                  }} />
                  {r.target != null && <div className="rb-bar-mark" style={{ left: Math.min(100, r.target) + '%' }} />}
                </div>
              </td>
              <td>
                {r.gap == null ? <span className="muted">—</span>
                  : <span style={{ color: r.gap > 0 ? 'var(--green)' : 'var(--red)' }}>
                    {r.gap > 0 ? '+' : '−'}{fmt(Math.abs(r.gap))}
                  </span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---- the tax consequence of a proposed sale ------------------------------

export function TaxPanel({ rows = [], label }) {
  if (!rows.length) return null;
  const anyUnknown = rows.some(r => r.unknown);
  return (
    <div className="mt">
      <div className="stat-label">WHAT SITS INSIDE {String(label).toUpperCase()}</div>
      <div className="scroll-x">
        <table className="ptable rb-table">
          <thead><tr><th>Holding</th><th>Share</th><th>Held &gt; 1yr</th><th>Held &lt; 1yr</th><th>No record</th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.ticker}>
                <td>{r.ticker}</td>
                <td>{r.share.toFixed(0)}%</td>
                <td>{r.longQty > 0 ? <span className="chip c-green">{r.longQty.toFixed(2)}</span> : <span className="muted">—</span>}</td>
                <td>{r.shortQty > 0 ? <span className="chip c-orange">{r.shortQty.toFixed(2)}</span> : <span className="muted">—</span>}</td>
                <td>{r.unknownQty > 0 ? <span className="chip c-red">{r.unknownQty.toFixed(2)}</span> : <span className="muted">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="small muted mt">
        Shares held under a year are taxed at the short-term rate on both books, which is the higher one.
        {anyUnknown && ' Shares marked "no record" are held according to the book but have no matching purchase '
          + 'in the order history, so their acquisition date is genuinely unknown — they are not assumed to be old.'}
        {' '}This table is not choosing which name to trim; that is a judgement about companies, and this screen
        only knows arithmetic about weights.
      </div>
    </div>
  );
}

// ---- the desk ------------------------------------------------------------

export default function Rebalance({
  held = [], priceOf = () => 0, orders = [], fx = null, inr = false, cur = '$',
}) {
  const [dim, setDim] = useState('byClass');
  const [all, setAll] = useState({});           // { dimKey: { label: pct } }
  const [band, setBand] = useState(DEFAULT_BAND);
  const [cash, setCash] = useState('');
  const [fi, setFi] = useState(EMPTY_FI);
  const [metaTick, setMetaTick] = useState(0);
  const [openSleeve, setOpenSleeve] = useState(null);

  useEffect(() => {
    memGet(KEY).then(v => setAll(v?.targets || {}));
    loadAssetMeta().then(() => setMetaTick(t => t + 1));
    loadFixedIncome().then(setFi);
  }, []);

  const saved = assetMetaSync();
  const breakdown = useMemo(
    () => allocationBreakdown({ held, priceOf, saved, fi, fx: fx || 1, inr }),
    [held, fi, fx, inr, metaTick, priceOf] // eslint-disable-line
  );

  const slices = breakdown[dim] || [];
  const targetsRaw = all[dim] || {};
  const { targets } = normaliseTargets(targetsRaw);

  const rows = useMemo(
    () => driftRows({ slices, targets, total: breakdown.total, band }),
    [slices, targets, breakdown.total, band]
  );
  const score = summarise(rows, band);

  const money = n => `${cur}${Math.round(n).toLocaleString(inr ? 'en-IN' : 'en-US')}`;
  const minTrade = inr ? DEFAULT_MIN_TRADE : DEFAULT_MIN_TRADE / 80;

  const contribution = useMemo(
    () => contributionPlan(rows, Number(cash) || 0, minTrade),
    [rows, cash, minTrade]
  );
  const rest = useMemo(
    () => afterPlan(rows, contribution.buys, contribution.spent),
    [rows, contribution]
  );
  const sells = useMemo(() => sellPlan(rest, minTrade), [rest, minTrade]);

  // Which holdings sit in the sleeve the user opened, and how old they are.
  const labelOf = h => {
    const m = metaOf(h, saved);
    if (dim === 'byMarket') return MARKETS[m.market].label;
    if (dim === 'byCap') return m.cap ? CAP_LABEL[m.cap] : 'Unclassified';
    if (dim === 'bySector') return m.sector || 'Unclassified';
    return m.sleeve === 'debt' ? 'Debt' : m.sleeve === 'commodity' ? 'Gold' : m.kind === 'etf' ? 'Equity ETF' : 'Equity';
  };
  const sleeveRows = useMemo(
    () => (openSleeve ? sleeveHoldings({ held, priceOf, labelOf, label: openSleeve, orders }) : []),
    [openSleeve, held, orders, saved, dim] // eslint-disable-line
  );

  function setTarget(label, v) {
    setAll(prev => {
      const next = { ...prev, [dim]: { ...(prev[dim] || {}) } };
      if (v === '' || v == null) delete next[dim][label]; else next[dim][label] = Number(v);
      memSet(KEY, { targets: next, updated: new Date().toISOString() });
      return next;
    });
  }
  function bulk(fn) {
    setAll(prev => {
      const next = { ...prev, [dim]: fn(slices) };
      memSet(KEY, { targets: next, updated: new Date().toISOString() });
      return next;
    });
  }

  const dimMeta = DIMENSIONS.find(d => d.key === dim);

  if (!held.length && !fi.fds.length && !fi.bonds.length) {
    return (
      <Card title="Rebalancing" color="var(--orange)">
        <Empty icon="⚖" text="Nothing in the book to weigh yet." />
      </Card>
    );
  }

  return (
    <>
      <Card title="What mix you said you wanted" color="var(--orange)" right={
        <div className="seg">
          {DIMENSIONS.map(d => (
            <button key={d.key} className={`seg-btn${dim === d.key ? ' on' : ''}`} onClick={() => { setDim(d.key); setOpenSleeve(null); }}>
              {d.label}
            </button>
          ))}
        </div>
      }>
        <div className="small muted mb">{dimMeta?.hint}</div>
        <TargetEditor
          labels={Array.from(new Set([...slices.map(s => s.label), ...Object.keys(targetsRaw)]))}
          targets={targetsRaw}
          onChange={setTarget}
          onEven={() => bulk(sl => Object.fromEntries(sl.map(s => [s.label, Math.round(100 / Math.max(1, sl.length))])))}
          onMatch={() => bulk(sl => Object.fromEntries(sl.map(s => [s.label, Math.round(s.pct)])))}
        />
        <div className="flex mt" style={{ gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          <label className="small">
            Tolerance band{' '}
            <input className="rb-tin" type="number" min="0" max="25" step="1" value={band}
              onChange={e => setBand(Math.max(0, Number(e.target.value) || 0))} /> pp
          </label>
          <label className="small">
            New money to deploy{' '}
            <input className="rb-tin" style={{ width: 96 }} type="number" min="0" step="1000" value={cash}
              placeholder="0" onChange={e => setCash(e.target.value)} /> {cur}
          </label>
        </div>
        <div className="small muted mt">
          The band is how far the book may wander before the drift counts as something to act on. Markets move
          every day; a band is the difference between a plan and a treadmill.
        </div>
      </Card>

      <Card title="Where the book actually is" color="var(--cyan)" className="mt">
        <div className="tile-row mb">
          <StatTile label="OFF TARGET" value={String(score.actionable)} color="var(--orange)"
            note={`of ${score.targeted} sleeve${score.targeted === 1 ? '' : 's'} with a target`} />
          <StatTile label="WOULD HAVE TO MOVE" value={score.turnoverPct.toFixed(1) + '%'} color="var(--pink)"
            note="of the book, to land exactly on target" />
          <StatTile label="WIDEST GAP"
            value={score.worst?.driftPp == null ? '—' : (score.worst.driftPp > 0 ? '+' : '') + score.worst.driftPp.toFixed(1) + 'pp'}
            color="var(--yellow)" note={score.worst ? score.worst.label : 'nothing targeted yet'} />
          <StatTile label="UNTARGETED" value={String(score.untargeted)} color="var(--ink-2)"
            note="sleeves held but not part of the plan" />
        </div>
        <DriftTable rows={rows} fmt={money} band={band} />
        <div className="rb-picker mt">
          <span className="small muted">Look inside a sleeve:</span>
          {rows.filter(r => r.value > 0).map(r => (
            <button key={r.label} className={`btn btn-sm${openSleeve === r.label ? ' btn-cyan' : ''}`}
              onClick={() => setOpenSleeve(openSleeve === r.label ? null : r.label)}>{r.label}</button>
          ))}
        </div>
        {openSleeve && <TaxPanel rows={sleeveRows} label={openSleeve} />}
      </Card>

      <Card title="What new money alone would fix" color="var(--green)" className="mt">
        {!(Number(cash) > 0) ? (
          <Empty icon="₹" text="Put a figure in “new money to deploy” above and this becomes a shopping list that never sells anything." />
        ) : contribution.buys.length === 0 ? (
          <div className="small muted">
            {contribution.need > 0
              ? `Every underweight sleeve would receive less than ${money(minTrade)}, which is mostly brokerage. Nothing proposed.`
              : 'Nothing is under target on this dimension, so there is nothing for new money to fill.'}
          </div>
        ) : (
          <>
            <table className="ptable rb-table">
              <thead><tr><th>Buy into</th><th>Amount</th><th>Takes it to</th></tr></thead>
              <tbody>
                {contribution.buys.map(b => {
                  const a = rest.find(r => r.label === b.label);
                  return (
                    <tr key={b.label}>
                      <td>{b.label}</td>
                      <td style={{ color: 'var(--green)' }}>{money(b.amount)}</td>
                      <td>{a ? `${a.weight.toFixed(1)}% of ${a.target.toFixed(0)}%` : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="small muted mt">
              {money(contribution.spent)} of {money(Number(cash))} deployed — {contribution.covers.toFixed(0)}% of
              the total shortfall of {money(contribution.need)}.
              {contribution.unspent > 1 && ` ${money(contribution.unspent)} is left over rather than being pushed into a sleeve that does not need it.`}
              {contribution.tooSmall.length > 0 && ` ${contribution.tooSmall.length} sleeve${contribution.tooSmall.length === 1 ? '' : 's'} would have received under ${money(minTrade)} and ${contribution.tooSmall.length === 1 ? 'was' : 'were'} left out: ${contribution.tooSmall.map(t => t.label).join(', ')}.`}
            </div>
          </>
        )}
      </Card>

      <Card title="What selling would fix" color="var(--red)" className="mt">
        {sells.sells.length === 0 ? (
          <div className="small muted">
            Nothing is far enough outside its band, after the contribution above, to be worth a sale. This is
            the state to prefer: selling costs spread, brokerage and — on anything held under a year — the
            higher tax rate.
          </div>
        ) : (
          <>
            <div className="rb-warn small mb">
              Read the holding-period table above before acting on any of this. A trim that looks free on a
              weights chart can carry a real tax bill.
            </div>
            <table className="ptable rb-table">
              <thead><tr><th>Trim</th><th>By</th></tr></thead>
              <tbody>
                {sells.sells.map(s => (
                  <tr key={s.label}><td>{s.label}</td><td style={{ color: 'var(--red)' }}>−{money(s.amount)}</td></tr>
                ))}
                {sells.buys.map(b => (
                  <tr key={b.label}><td>{b.label}</td><td style={{ color: 'var(--green)' }}>+{money(b.amount)}</td></tr>
                ))}
              </tbody>
            </table>
            <div className="small muted mt">
              {money(sells.turnover)} would change hands, which is {breakdown.total ? ((sells.turnover / breakdown.total) * 100).toFixed(1) : '0'}%
              of the book.
              {sells.limited === 'surplus' && ' The overweight sleeves cannot fund the whole shortfall, so this closes as much of the gap as they can pay for.'}
              {sells.limited === 'deficit' && ' The underweight sleeves need less than the overweight ones have to give, so the trim stops at what is actually needed.'}
            </div>
          </>
        )}
      </Card>

      <div className="ai-note mt">
        Every figure on this screen is arithmetic against a mix you typed in yourself. It has no view on whether
        that mix is a good one, no view on the companies inside it, and it is not a recommendation to buy or
        sell anything — a target allocation is a personal decision about risk, timeline and tax, and none of
        those are things a dashboard can know for you.
      </div>
    </>
  );
}
