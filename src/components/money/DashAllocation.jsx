import React, { useEffect, useMemo, useState } from 'react';
import { Card } from '../ui.jsx';
import AllocationPie from './AllocationPie.jsx';
import { allocationBreakdown, concentration, loadAssetMeta, loadFixedIncome, EMPTY_FI } from '../../lib/assets.js';
import { memGet, memSet } from '../../lib/advisor.js';
import { sectorAllocation, roleAllocation, suggestRoles, EMPTY_ROLES } from '../../lib/allocation.js';
import { currencyOf } from '../../lib/indiabook.js';

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

// SECTOR leads, because on this book the other two have nothing to say. 99.6%
// of the money is one asset class, so CLASS draws a circle; and the sector
// field on the raw data cannot see inside a fund, so two-thirds of it lands in
// one bucket called Miscellaneous. The look-through axis is the one that
// answers the question the card is asked at a glance.
const DIMS = [
  { key: 'sector', label: 'SECTOR' },
  { key: 'role', label: 'ROLES' },
  { key: 'byClass', label: 'CLASS' },
];

const pctTxt = v => (v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(1)}%`);
const signed = v => (v == null || !Number.isFinite(v) ? null : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}%`);

// The legend is where identity actually lives. The five wedge hues clear the
// colourblind separation check, but a legend that carries the name and the
// percentage means no reader has to rely on hue at all — which is the point of
// having one rather than labelling the ring itself.
export function Legend({ slices = [], showDay = false }) {
  return (
    <div className="da-legend">
      {slices.map(s2 => (
        <div key={s2.key || s2.label} className="da-leg">
          <span className="da-dot" style={{ background: s2.color }} />
          <span className="da-leg-t" title={s2.members ? s2.members.map(m => m.label || m).join(', ') : undefined}>
            {s2.label}
            {s2.other && s2.count ? <i className="da-leg-n"> · {s2.count}</i> : null}
          </span>
          {showDay && (
            <span className="da-leg-d" style={{ color: s2.dayPct == null ? 'var(--ink-3)' : s2.dayPct >= 0 ? 'var(--green)' : 'var(--red)' }}>
              {s2.dayPct == null ? '—' : signed(s2.dayPct)}
            </span>
          )}
          <span className="da-leg-p">{pctTxt(s2.pct)}</span>
        </div>
      ))}
    </div>
  );
}

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
  held = [], quotes = {}, moneyVis = true, cur = '$', fx = null, onOpen,
}) {
  const [dim, setDim] = useState('sector');
  const [extra, setExtra] = useState(null);   // null === still reading (decision 2)
  const [roleData, setRoleData] = useState(null);
  const [offer, setOffer] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const failed = [];
      const [meta, fi, cryptoBlob, roles] = await Promise.all([
        loadAssetMeta().catch(() => { failed.push('your asset labels'); return {}; }),
        loadFixedIncome().catch(() => { failed.push('your deposits and bonds'); return null; }),
        memGet('crypto_holdings').catch(() => { failed.push('your crypto'); return null; }),
        memGet('alloc_roles').catch(() => null),
      ]);
      if (!alive) return;
      const rows = Array.isArray(cryptoBlob?.rows) ? cryptoBlob.rows
        : Array.isArray(cryptoBlob) ? cryptoBlob : [];
      setExtra({ meta: meta || {}, fi: fi || EMPTY_FI, cryptoRows: rows, failed });
      setRoleData(roles && typeof roles === 'object' ? { ...EMPTY_ROLES, ...roles } : EMPTY_ROLES);
    })();
    return () => { alive = false; };
  }, []);

  const priceOf = h => Number(quotes[h.ticker]?.price ?? h.last_price ?? h.avg_cost ?? 0);

  const alloc = useMemo(() => {
    if (!extra) return null;
    // fx was NOT passed here, and allocationBreakdown defaults it to 1 — so a
    // rupee-priced holding was divided by one and entered the ring at its rupee
    // figure. That is why gold read as 19.4% of a book it is 0.3% of. The rate
    // is required now rather than defaulted, and a missing one is reported.
    return allocationBreakdown({
      held, priceOf, saved: extra.meta, fi: extra.fi, fx: fx || 1, inr: false,
      crypto: extra.cryptoRows.map(c => ({ qty: c.qty, price: c.price ?? c.last_price ?? 0 })),
    });
  }, [extra, held, quotes, fx]);

  // Rupee holdings that would be misconverted if the rate never arrived. Named
  // rather than silently divided by 1.
  const inrUnpriced = useMemo(
    () => (fx ? [] : held.filter(h => currencyOf(h) === 'INR').map(h => h.ticker)),
    [held, fx],
  );

  const sectors = useMemo(
    () => (extra ? sectorAllocation(held, { priceOf, fx }) : null),
    [extra, held, quotes, fx],
  );
  const roles = useMemo(() => (roleData ? roleAllocation(held, {
    priceOf, fx, roles: roleData.roles, map: roleData.map, quotes, currencyOf,
  }) : null), [roleData, held, quotes, fx]);

  const suggestion = useMemo(
    () => (roleData && !roleData.roles.length ? suggestRoles(held) : null),
    [roleData, held],
  );

  const conc = useMemo(() => (held.length ? concentration(held, priceOf) : null), [held, quotes]);

  const applyRoles = () => {
    if (!suggestion) return;
    const next = { roles: suggestion.roles, map: suggestion.map };
    setRoleData(next);
    memSet('alloc_roles', next);
    setOffer(false);
  };

  const right = (
    <div className="seg da-seg">
      {DIMS.map(d => (
        <button key={d.key} className={`seg-btn${dim === d.key ? ' on' : ''}`} onClick={() => setDim(d.key)}>
          {d.label}
        </button>
      ))}
    </div>
  );

  // The two new axes are their own render, because they are their own data.
  // Squeezing them through the class-breakdown Body would mean pretending a
  // look-through exposure and an asset class are the same kind of thing.
  const ringFor = () => {
    if (dim === 'sector') {
      if (!sectors) return <div className="small muted">Nothing priced yet, so there is nothing to allocate.</div>;
      return (
        <>
          <div className="da-ring">
            <AllocationPie slices={sectors.slices} label="SECTOR" size={132} thickness={19} minPct={0} showLegend={false} />
            <Legend slices={sectors.slices} />
          </div>
          <div className="da-total">
            <span className="da-total-k">Across everything</span>
            <span className="da-total-v">
              {moneyVis ? `${cur}${Math.round(sectors.total).toLocaleString('en-IN')}` : '••••••'}
            </span>
          </div>
          {/* Without this the wedges read as definitive. It is the share of the
              ring that is a NAMED sector rather than one of the kinds of
              not-knowing folded into the grey wedge. */}
          <div className="da-note">
            {pctTxt(sectors.resolved)} of this sits in a named sector, after decomposing
            every fund into the companies it holds. The rest is the part of your funds
            below their published top-25 lists, plus gold — folded into one grey wedge
            rather than four, so grey never reads as a category.
            {' '}Day moves are not shown here: a sector wedge is made of companies you
            do not hold, so there is no quote to move.
          </div>
          {sectors.excluded.length > 0 && (
            <div className="da-note da-warn">
              {sectors.excluded.length} holding{sectors.excluded.length === 1 ? '' : 's'} left
              out — no exchange rate loaded for {sectors.excluded.length === 1 ? 'its' : 'their'} currency.
            </div>
          )}
        </>
      );
    }

    if (dim === 'role') {
      if (suggestion && suggestion.roles.length) {
        return (
          <>
            <div className="da-single">
              Roles are yours to name — what a holding is <b>for</b> is a judgement, not
              something the data knows, so nothing here is assigned until you say so.
            </div>
            {!offer ? (
              <button className="btn btn-sm btn-green mt" onClick={() => setOffer(true)}>
                suggest a starting set →
              </button>
            ) : (
              <div className="da-offer">
                <div className="da-offer-why">{suggestion.reason}</div>
                <div className="da-offer-what">
                  Creates {suggestion.roles.map(r2 => r2.label).join(', ')} and files{' '}
                  {suggestion.assigned} of {suggestion.total} holdings.
                </div>
                <div className="flex" style={{ gap: 6 }}>
                  <button className="btn btn-sm btn-green" onClick={applyRoles}>DO IT</button>
                  <button className="btn btn-sm" onClick={() => setOffer(false)}>NOT NOW</button>
                </div>
              </div>
            )}
          </>
        );
      }
      if (!roles) return <div className="small muted">Nothing priced yet.</div>;
      return (
        <>
          <div className="da-ring">
            <AllocationPie slices={roles.slices} label="ROLES" size={132} thickness={19} minPct={0} showLegend={false} />
            {/* Day move belongs on this axis and only this one: a role holds
                whole positions you own, each with its own quote. */}
            <Legend slices={roles.slices} showDay />
          </div>
          <div className="da-total">
            <span className="da-total-k">Across everything</span>
            <span className="da-total-v">
              {moneyVis ? `${cur}${Math.round(roles.total).toLocaleString('en-IN')}` : '••••••'}
            </span>
          </div>
          {roles.unassignedValue > 0 && (
            <div className="da-note">
              Some holdings are not filed under a role yet and sit in their own wedge
              rather than being left out of the ring.
            </div>
          )}
        </>
      );
    }

    return (
      <>
        {inrUnpriced.length > 0 && (
          <div className="da-note da-warn">
            No exchange rate has loaded yet, so {inrUnpriced.join(', ')} would be counted
            at face value in dollars. Waiting for the rate rather than showing a wrong ring.
          </div>
        )}
        {inrUnpriced.length === 0 && (
          <Body alloc={alloc} dim="byClass" conc={conc} note={coverageNote(extra)}
            moneyVis={moneyVis} cur={cur} onOpen={onOpen} />
        )}
      </>
    );
  };

  return (
    <Card key="alloc" title="Allocation" color="var(--purple)" right={right}>
      {/* Decision 2: no partial ring, ever. */}
      {!extra && <div className="small muted">Reading deposits, bonds and crypto…</div>}
      {extra && ringFor()}
      {extra && onOpen && dim !== 'byClass' && (
        <button className="btn btn-sm mt" onClick={onOpen}>open money →</button>
      )}
    </Card>
  );
}
