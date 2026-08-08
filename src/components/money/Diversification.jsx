import React, { useMemo, useState } from 'react';
import { Card, Empty, StatTile, money, useMoneyVisible, EyeBtn } from '../ui.jsx';
import {
  WEIGHT_BASES, weightBasis, hhiOf, allocationSlices, arcs, OTHER_KEY,
  concentration, topBy,
} from '../../lib/holdings.js';

// Diversification.
//
// The screen answers one question — how much of this book is riding on how few
// names — and it answers it twice, because there are two different books hiding
// in one portfolio:
//
//   BY VALUE  is where your capital sits. It is what a drawdown hits.
//   BY INCOME is where your cash flow comes from. It is what a dividend cut
//             hits, and a 3% position paying 9% can be a tenth of your income.
//
// A portfolio can look fine on one axis and awful on the other. That gap is why
// the toggle exists rather than a default nobody changes.
//
// The headline number is EFFECTIVE HOLDINGS (1/HHI), not HHI itself. Nobody has
// an intuition for 0.184. "These nineteen positions behave like six equal ones"
// is a sentence you can act on, and it is the same fact.
//
// Nothing here judges. There is no threshold at which the screen declares you
// too concentrated, because that depends on your horizon, your income needs and
// your other assets — none of which this code knows. Stating a number is
// information; stating a verdict is advice.

const PALETTE = [
  'var(--cyan)', 'var(--green)', 'var(--pink)', 'var(--orange)', 'var(--purple)',
  'var(--yellow)', 'var(--red)', 'var(--s1)', 'var(--s3)', 'var(--s5)',
];
const colorAt = i => PALETTE[i % PALETTE.length];

const R = 100, RING = 34;   // outer radius and ring thickness, in viewBox units

// A donut wedge as a filled path. Hand-rolled because the project ships no
// chart library — every arc in this app is trigonometry and a path string.
function wedge(startDeg, sweepDeg) {
  // A full circle cannot be drawn as one arc: start and end coincide and the
  // renderer draws nothing at all. Two half-arcs is the standard workaround.
  if (sweepDeg >= 359.999) {
    return `M0 ${-R} A${R} ${R} 0 1 1 0 ${R} A${R} ${R} 0 1 1 0 ${-R} `
      + `M0 ${-(R - RING)} A${R - RING} ${R - RING} 0 1 0 0 ${R - RING} `
      + `A${R - RING} ${R - RING} 0 1 0 0 ${-(R - RING)} Z`;
  }
  const rad = d => ((d - 90) * Math.PI) / 180;
  const r2 = R - RING;
  const a0 = rad(startDeg), a1 = rad(startDeg + sweepDeg);
  const large = sweepDeg > 180 ? 1 : 0;
  const x0 = R * Math.cos(a0), y0 = R * Math.sin(a0);
  const x1 = R * Math.cos(a1), y1 = R * Math.sin(a1);
  const x2 = r2 * Math.cos(a1), y2 = r2 * Math.sin(a1);
  const x3 = r2 * Math.cos(a0), y3 = r2 * Math.sin(a0);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${R} ${R} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} `
    + `L${x2.toFixed(2)} ${y2.toFixed(2)} A${r2} ${r2} 0 ${large} 0 ${x3.toFixed(2)} ${y3.toFixed(2)} Z`;
}

const pctText = v => (v == null ? '—' : `${v.toFixed(1)}%`);

export default function Diversification({
  rows = [],
  cur = '$',
  limit = 10,
}) {
  const [basis, setBasis] = useState('value');
  const [hover, setHover] = useState(null);
  const [visible, toggleVisible] = useMoneyVisible();

  const b = weightBasis(basis);
  const alloc = useMemo(() => allocationSlices(rows, { basis, limit }), [rows, basis, limit]);
  const wedges = useMemo(() => arcs(alloc.slices), [alloc]);
  const h = useMemo(() => hhiOf(rows, b.field), [rows, b.field]);
  const conc = useMemo(() => concentration(rows), [rows]);
  const top5 = useMemo(() => topBy(rows, b.field, 5), [rows, b.field]);
  const top10 = useMemo(() => topBy(rows, b.field, 10), [rows, b.field]);

  const shareOf = list => (h.total > 0
    ? (list.reduce((s, r) => s + (Number(r[b.field]) || 0), 0) / h.total) * 100
    : null);

  const centre = hover != null ? wedges[hover] : null;

  // The income basis genuinely has nothing to show until dividend data lands,
  // and that is worth saying rather than drawing an empty ring.
  const incomeMissing = basis === 'income' && alloc.slices.length === 0 && rows.length > 0;

  return (
    <>
      <Card
        title="Diversification"
        color="var(--purple)"
        right={
          <span className="flex" style={{ gap: 6 }}>
            <span className="seg dv-basis">
              {WEIGHT_BASES.map(w => (
                <button
                  key={w.key}
                  className={`seg-btn${basis === w.key ? ' on' : ''}`}
                  onClick={() => { setBasis(w.key); setHover(null); }}
                  title={w.note}
                >{w.label}</button>
              ))}
            </span>
            <EyeBtn visible={visible} onClick={toggleVisible} />
          </span>
        }
      >
        <p className="dv-lead">
          Weighted by <strong>{b.label.toLowerCase()}</strong> — {b.note}.
        </p>

        {rows.length === 0 ? (
          <Empty icon="◔" text="No holdings recorded yet." />
        ) : incomeMissing ? (
          <Empty
            icon="◔"
            text="No dividend income recorded against these holdings yet, so there is nothing to weight by. Weighting by value works now; income weighting needs a dividend data source."
          />
        ) : (
          <div className="dv-wrap">
            <div className="dv-chart">
              <svg viewBox="-110 -110 220 220" className="dv-svg">
                {wedges.map((w, i) => (
                  <path
                    key={w.ticker}
                    d={wedge(w.start, w.sweep)}
                    fill={w.other ? 'var(--ink-3)' : colorAt(i)}
                    className={`dv-wedge${hover === i ? ' on' : ''}`}
                    opacity={hover == null || hover === i ? 1 : 0.32}
                    onMouseEnter={() => setHover(i)}
                    onMouseLeave={() => setHover(null)}
                  />
                ))}
                {/* The centre reads the hovered slice, and falls back to the
                    headline when nothing is hovered — so the hole is never
                    just a hole. */}
                <text className="dv-cx-top" x="0" y="-10" textAnchor="middle">
                  {centre ? (centre.other ? 'OTHER' : centre.ticker) : 'EFFECTIVE'}
                </text>
                <text className="dv-cx-mid" x="0" y="14" textAnchor="middle">
                  {centre ? pctText(centre.pct) : (h.effective == null ? '—' : h.effective.toFixed(1))}
                </text>
                <text className="dv-cx-sub" x="0" y="30" textAnchor="middle">
                  {centre
                    ? money(centre.value, visible, cur)
                    : `of ${h.names} holdings`}
                </text>
              </svg>
            </div>

            <div className="dv-legend">
              {wedges.map((w, i) => (
                <button
                  key={w.ticker}
                  className={`dv-leg${hover === i ? ' on' : ''}`}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                >
                  <span className="dv-dot" style={{ background: w.other ? 'var(--ink-3)' : colorAt(i) }} />
                  <span className="dv-leg-t">{w.other ? w.label : w.ticker}</span>
                  <span className="dv-leg-p">{pctText(w.pct)}</span>
                  <span className="dv-leg-v">{money(w.value, visible, cur)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </Card>

      {rows.length > 0 && !incomeMissing && (
        <>
          <div className="tile-row">
            <StatTile
              label="Top 5" value={pctText(shareOf(top5))}
              note={`${top5.map(r => r.ticker).slice(0, 3).join(', ')}${top5.length > 3 ? '…' : ''}`}
              color="var(--cyan)"
            />
            <StatTile
              label="Top 10" value={pctText(shareOf(top10))}
              note={`of ${h.names} holdings`}
              color="var(--green)"
            />
            <StatTile
              label="Concentration index"
              value={h.hhi == null ? '—' : h.hhi.toFixed(3)}
              note="HHI — 1.0 is everything in one name"
              color="var(--orange)"
            />
            <StatTile
              label="Effective holdings"
              value={h.effective == null ? '—' : h.effective.toFixed(1)}
              note={h.effective == null ? '' : `${h.names} names behaving like ${h.effective.toFixed(1)} equal ones`}
              color="var(--pink)"
            />
          </div>

          <Card title="What this says" color="var(--ink-3)">
            {/* Described, not judged. Every sentence here is a restatement of a
                number already on the screen — there is no threshold at which
                this text tells you to do something about it. */}
            <p className="dv-read">
              Half of this book{basis === 'income' ? "'s income" : ''} sits in{' '}
              <strong>{conc.namesToHalf ?? '—'}</strong> of its{' '}
              <strong>{h.names}</strong> holdings. The largest single position is{' '}
              <strong>{pctText(conc.top1)}</strong>.
              {h.effective != null && h.names > 0 && (
                <> On the {b.label.toLowerCase()} axis the spread is equivalent to{' '}
                  <strong>{h.effective.toFixed(1)}</strong> equally sized positions
                  {h.effective < h.names * 0.6
                    ? ' — meaningfully fewer than the count suggests.'
                    : ' — close to what the count suggests.'}
                </>
              )}
            </p>
            {alloc.folded > 0 && (
              <p className="dv-read dv-fold">
                The OTHER wedge stands for {alloc.folded} smaller position
                {alloc.folded === 1 ? '' : 's'}, folded rather than dropped so the
                ring still sums to the whole book.
              </p>
            )}
          </Card>
        </>
      )}
    </>
  );
}
