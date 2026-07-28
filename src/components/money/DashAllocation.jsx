import React, { useEffect, useMemo, useState } from 'react';
import { Card } from '../ui.jsx';
import AllocationPie from './AllocationPie.jsx';
import { allocationBreakdown, concentration, loadAssetMeta, loadFixedIncome, EMPTY_FI } from '../../lib/assets.js';
import { memGet } from '../../lib/advisor.js';

// DashAllocation — the allocation ring on the home dashboard (spec item 11).
//
// The same donut already exists inside the Book view, where the reader arrived on
// purpose and will scroll. Here it sits on a glance surface, and a glance is the
// one reading condition under which a chart cannot be corrected by anything below
// it. That changes what can go wrong, so five decisions live in this file:
//
//   1. The ring covers NET WORTH, not the stock book. The dashboard already shows
//      a Portfolio tile that counts equities; a ring next to it labelled
//      "Allocation" that also counted only equities would be read as "this is
//      everything I own", which is the one claim it must never make by accident.
//   2. Nothing is drawn until the deposits, bonds and crypto have been read. A ring
//      that appears equities-only and then re-slices a beat later is worse than a
//      ring that appears late: the first frame is the one that gets believed, and
//      nobody re-reads a chart they have already understood.
//   3. What is NOT in the ring is stated in words, and "you hold none" is
//      distinguished from "it could not be read". Both leave the same shaped hole
//      in the chart and they are completely different facts about your money.
//   4. Hiding money hides AMOUNTS, never the shape. Percentages are not sensitive
//      — the reason to blank a screen is the number someone could read over your
//      shoulder, and 41% in a café tells them nothing.
//   5. One slice is not an allocation. A ring at 100% draws a full circle, which is
//      the same picture a perfectly balanced portfolio would draw at a glance, so
//      a single-class book is written out as a sentence instead.
//
// It fetches no quotes of its own: it is handed the prices the dashboard already
// paid for, so the ring and the Portfolio tile can never disagree.

const DIMS = [
  { key: 'byClass', label: 'CLASS' },
  { key: 'byMarket', label: 'MARKET' },
  { key: 'bySector', label: 'SECTOR' },
];

// Decision 3: what the ring covers beyond equities, and why a part might be absent.
export function coverageNote({ fi, cryptoRows, failed }) {
  const bits = [];
  const say = (n, one, many) => bits.push(`${n} ${n === 1 ? one : many}`);
  if (failed.length) {
    return { tone: 'warn', text: `Could not read ${failed.join(' or ')}, so ${failed.length > 1 ? 'those are' : 'that is'} missing from the ring. The percentages below are of what could be read, not of everything you own.` };
  }
  if (fi.fds.length) say(fi.fds.length, 'deposit', 'deposits');
  if (fi.bonds.length) say(fi.bonds.length, 'bond', 'bonds');
  if (cryptoRows.length) say(cryptoRows.length, 'coin', 'coins');
  if (!bits.length) {
    return { tone: 'plain', text: 'Equities only — no deposits, bonds or crypto are recorded, so there are none missing from the ring.' };
  }
  return { tone: 'plain', text: `Equities plus ${bits.join(', ')}. Everything recorded is in the ring.` };
}

export function Shape({ conc }) {
  if (!conc || !conc.top1) return null;
  const n = conc.effectiveN;
  return (
    <div className="da-shape">
      <span className="da-shape-k">Top holding</span>
      <span className="da-shape-v">{conc.top1.toFixed(1)}%</span>
      <span className="da-shape-k">Top 3</span>
      <span className="da-shape-v">{conc.top3.toFixed(1)}%</span>
      <span className="da-shape-k">Spread like</span>
      <span className="da-shape-v">{n >= 1 ? `${n.toFixed(1)} equal positions` : '—'}</span>
    </div>
  );
}

// The whole post-load render, lifted out as its own export. The card's states are
// decided by an effect that a static render never runs, so leaving this inline
// would mean the loaded states could only ever be checked by reading the source —
// and a regex over source proves the code says something, not that the screen
// shows it.
export function Body({ alloc, dim, conc, note, moneyVis = true, cur = '$', onOpen }) {
  if (!alloc?.total) {
    return <div className="small muted">Nothing is recorded yet, so there is nothing to allocate.</div>;
  }
  const slices = alloc[dim] || [];
  const noteEl = <div className={`da-note${note?.tone === 'warn' ? ' da-warn' : ''}`}>{note?.text}</div>;

  // Decision 5: one bucket is not an allocation. A 100% ring draws a full circle,
  // which at a glance is the same picture as a portfolio spread evenly across many
  // things — so a single-bucket book is written out in words instead.
  if (slices.length < 2) {
    return (
      <>
        <div className="da-single">
          Everything you hold sits in one bucket — <b>{slices[0]?.label}</b>. A ring would draw a
          full circle for that, which looks exactly like a portfolio spread evenly across
          many things, so it is written out instead.
        </div>
        {noteEl}
      </>
    );
  }

  return (
    <>
      <AllocationPie slices={slices} label={(DIMS.find(d => d.key === dim) || DIMS[0]).label}
        size={148} thickness={20} />
      {/* Decision 4: the total is blanked when money is hidden; the ring above and
          every percentage in it stay exactly as they were. */}
      <div className="da-total">
        <span className="da-total-k">Across everything</span>
        <span className="da-total-v">
          {moneyVis ? `${cur}${Math.round(alloc.total).toLocaleString('en-IN')}` : '••••••'}
        </span>
      </div>
      <Shape conc={conc} />
      {noteEl}
      {onOpen && <button className="btn btn-sm mt" onClick={onOpen}>open money →</button>}
    </>
  );
}

export default function DashAllocation({
  held = [], quotes = {}, moneyVis = true, cur = '$', onOpen,
}) {
  const [dim, setDim] = useState('byClass');
  const [extra, setExtra] = useState(null);   // null === still reading (decision 2)

  useEffect(() => {
    let alive = true;
    (async () => {
      const failed = [];
      const [meta, fi, cryptoBlob] = await Promise.all([
        loadAssetMeta().catch(() => { failed.push('your asset labels'); return {}; }),
        loadFixedIncome().catch(() => { failed.push('your deposits and bonds'); return null; }),
        memGet('crypto_holdings').catch(() => { failed.push('your crypto'); return null; }),
      ]);
      if (!alive) return;
      const rows = Array.isArray(cryptoBlob?.rows) ? cryptoBlob.rows
        : Array.isArray(cryptoBlob) ? cryptoBlob : [];
      setExtra({ meta: meta || {}, fi: fi || EMPTY_FI, cryptoRows: rows, failed });
    })();
    return () => { alive = false; };
  }, []);

  const priceOf = h => Number(quotes[h.ticker]?.price ?? h.last_price ?? h.avg_cost ?? 0);

  const alloc = useMemo(() => {
    if (!extra) return null;
    return allocationBreakdown({
      held, priceOf, saved: extra.meta, fi: extra.fi,
      crypto: extra.cryptoRows.map(c => ({ qty: c.qty, price: c.price ?? c.last_price ?? 0 })),
    });
  }, [extra, held, quotes]);

  const conc = useMemo(() => (held.length ? concentration(held, priceOf) : null), [held, quotes]);

  const right = (
    <div className="seg da-seg">
      {DIMS.map(d => (
        <button key={d.key} className={`seg-btn${dim === d.key ? ' on' : ''}`} onClick={() => setDim(d.key)}>
          {d.label}
        </button>
      ))}
    </div>
  );

  return (
    <Card key="alloc" title="Allocation" color="var(--purple)" right={right}>
      {/* Decision 2: no partial ring, ever. */}
      {!extra && <div className="small muted">Reading deposits, bonds and crypto…</div>}

      {extra && <Body alloc={alloc} dim={dim} conc={conc} note={coverageNote(extra)}
        moneyVis={moneyVis} cur={cur} onOpen={onOpen} />}

    </Card>
  );
}
