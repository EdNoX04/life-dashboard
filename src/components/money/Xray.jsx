import React, { useEffect, useMemo, useState } from 'react';
import { Card, Empty, StatTile, money, useMoneyVisible, EyeBtn } from '../ui.jsx';
import {
  lookThrough, overlapMatrix, concentration, shelfWeights,
} from '../../lib/xray.js';
import {
  seedCompositions, mergeCompositions, bookPositions,
} from '../../lib/etfdata.js';
import { currencyOf } from '../../lib/indiabook.js';
import { memGet } from '../../lib/advisor.js';

// X-RAY — what the shelf is hiding.
//
// Every other screen on this tab counts POSITIONS. This one counts COMPANIES,
// and the two disagree by a lot: four of the biggest lines in this book are US
// large-cap index funds that hold the same twenty names, and several of those
// names are also held outright on top. Counting positions says "nineteen
// holdings, well spread". Counting companies says something else entirely.
//
// The screen is built to be un-flattering, because every arithmetic shortcut
// available here fails in the reassuring direction. Three things are therefore
// on screen at all times and cannot be dismissed:
//
//   COVERAGE   — how much of the book was actually decomposed. A concentration
//                figure over 30% of the book is not a fact about the book.
//   FLOOR      — overlaps computed from two top-25 lists are lower bounds. The
//                unlisted halves of two S&P funds overlap too; we cannot see it.
//   AS-OF      — the composition dates. Stale is fine and invisible-stale is not.
//
// And it states no verdict. There is no threshold at which this screen tells
// you that you are too concentrated, because that depends on your horizon and
// your other assets, neither of which this program knows. Describing a number
// is information. Grading it is advice.

const pct = (v, d = 1) => (v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(d)}%`);

const BUCKETS = [
  { key: 'resolved', label: 'Resolved', color: 'var(--cyan)',
    note: 'decomposed to a named company' },
  { key: 'rest', label: 'Rest of fund', color: 'var(--purple)',
    note: 'inside your funds, below their top-25 lists' },
  { key: 'unknown', label: 'Uncovered', color: 'var(--red)',
    note: 'a fund with no composition on file' },
  { key: 'nonEquity', label: 'Non-equity', color: 'var(--yellow)',
    note: 'gold, cash and crypto — nothing to look through to' },
];

export default function Xray({ held = [], priceOf, fx = null, inr = false, limit = 20 }) {
  const [visible, toggleVisible] = useMoneyVisible();
  const [saved, setSaved] = useState(null);
  const [all, setAll] = useState(false);
  const [openPair, setOpenPair] = useState(null);

  // Saved compositions override the checked-in seed per fund. Failure is silent
  // and harmless: the seed is always there, so the screen degrades to
  // "somewhat out of date" rather than to blank.
  useEffect(() => { memGet('etf_holdings').then(v => setSaved(v || {})).catch(() => setSaved({})); }, []);

  const comps = useMemo(
    () => mergeCompositions(seedCompositions(), saved || {}),
    [saved],
  );

  const { positions, excluded } = useMemo(
    () => bookPositions(held, { priceOf, fx, currencyOf, comps }),
    [held, priceOf, fx, comps],
  );

  const x = useMemo(() => lookThrough(positions, comps), [positions, comps]);
  const shelf = useMemo(() => shelfWeights(positions), [positions]);
  const conc = useMemo(() => concentration(x.exposures, x.total), [x]);

  // Only funds actually held get compared. An overlap between two funds you do
  // not own is a true fact about the market and a waste of a row.
  const heldFunds = useMemo(
    () => positions.filter(p => p.isFund && comps[p.ticker]).map(p => p.ticker),
    [positions, comps],
  );
  const pairs = useMemo(() => overlapMatrix(heldFunds, comps), [heldFunds, comps]);

  // Everything above is dollars. The display toggle converts once, here, rather
  // than each call site multiplying by fx and one of them forgetting.
  const disp = v => money(inr && fx ? v * fx : v, visible, inr && fx ? '₹' : '$');

  if (!held.length) {
    return <Card title="X-ray" color="var(--cyan)"><Empty icon="◎" text="No holdings recorded yet." /></Card>;
  }

  const sizes = {
    resolved: x.coverage,
    rest: x.rest.pct,
    unknown: x.unknown.pct,
    nonEquity: x.nonEquity.pct,
  };
  const values = {
    resolved: x.exposures.reduce((s, e) => s + e.value, 0),
    rest: x.rest.value,
    unknown: x.unknown.value,
    nonEquity: x.nonEquity.value,
  };

  const rows = all ? x.exposures : x.exposures.slice(0, limit);
  const top = x.exposures[0];
  const maxPct = top ? top.pct : 1;

  // The biggest single lie the shelf tells, in percentage points. This is the
  // actual finding — the largest exposure is usually a name you knew about,
  // whereas the widest GAP is one you did not. NVDA at 0.5% on the shelf and
  // 6.7% after unpacking is a different sentence from "your biggest holding is
  // Microsoft", and it is the one worth leading with.
  const gap = x.exposures.reduce((best, e) => {
    const d = e.pct - (shelf[e.sym] || 0);
    return best && best.d >= d ? best : { e, d };
  }, null);

  // Names you own more of than you realise: reachable only through funds, or
  // materially larger once the funds are unpacked. This is the actionable list.
  const hidden = x.exposures.filter(e => !e.direct && e.pct >= 1).length;

  return (
    <>
      <Card
        title="X-ray"
        color="var(--cyan)"
        right={<EyeBtn visible={visible} onClick={toggleVisible} />}
      >
        <p className="xr-lead">
          Your <strong>{positions.length}</strong> position
          {positions.length === 1 ? '' : 's'} resolve to{' '}
          <strong>{x.exposures.length}</strong> distinct compan
          {x.exposures.length === 1 ? 'y' : 'ies'}, because the funds hold each
          other&rsquo;s biggest names.
          {top && (
            <> The largest single company exposure is <strong>{top.name}</strong> at{' '}
              <strong>{pct(top.pct)}</strong> of everything you own
              {shelf[top.sym] != null
                ? <> — the shelf shows that ticker at {pct(shelf[top.sym])}.</>
                : <>, and it does not appear on the shelf at all.</>}
            </>
          )}
        </p>
        {gap && gap.d > 1 && (
          <p className="xr-lead">
            The widest gap is <strong>{gap.e.name}</strong>: the shelf line is{' '}
            {shelf[gap.e.sym] ? pct(shelf[gap.e.sym]) : 'not there at all'}, the real
            exposure is <strong>{pct(gap.e.pct)}</strong>, and the difference arrives
            through {gap.e.via.map(v => v.fund).join(', ')}. Nothing about that is
            wrong — index funds are supposed to hold big companies. It is only worth
            knowing that trimming the ticker would not trim the exposure.
          </p>
        )}

        {/* Coverage first and unmissable. Every figure below it is a statement
            about the resolved slice only, and a reader who does not know how big
            that slice is cannot weigh any of them. */}
        <div className="xr-cov">
          <div className="xr-cov-bar">
            {BUCKETS.map(b => (sizes[b.key] > 0 ? (
              <span
                key={b.key}
                className="xr-cov-seg"
                style={{ width: `${sizes[b.key]}%`, background: b.color }}
                title={`${b.label} — ${pct(sizes[b.key])}`}
              />
            ) : null))}
          </div>
          <div className="xr-cov-key">
            {BUCKETS.map(b => (sizes[b.key] > 0 ? (
              <span key={b.key} className="xr-cov-item" title={b.note}>
                <i className="xr-dot" style={{ background: b.color }} />
                <b>{b.label}</b>
                <span className="xr-cov-p">{pct(sizes[b.key])}</span>
                <span className="xr-cov-v">{disp(values[b.key])}</span>
              </span>
            ) : null))}
          </div>
        </div>

        {x.unknown.funds.length > 0 && (
          <p className="xr-warn">
            No composition on file for{' '}
            <strong>{x.unknown.funds.map(f => f.sym).join(', ')}</strong>. That money is
            counted in the total and left out of every company figure below, rather
            than being spread across the names we do happen to know — which would
            make the book look better than it is.
          </p>
        )}

        {excluded.length > 0 && (
          <p className="xr-warn">
            {excluded.length} position{excluded.length === 1 ? '' : 's'} in another
            currency ({excluded.map(e => e.ticker).join(', ')}) had no exchange rate
            loaded and {excluded.length === 1 ? 'is' : 'are'} excluded entirely. A
            rupee figure added to a dollar total is wrong by a factor of about ninety,
            and a total that has quietly absorbed one looks exactly like a correct one.
          </p>
        )}
      </Card>

      <div className="tile-row">
        <StatTile
          label="Largest company" value={pct(conc.top1)}
          note={top ? top.name : ''} color="var(--pink)"
        />
        <StatTile label="Top 5 companies" value={pct(conc.top5)} note="of the whole book" color="var(--cyan)" />
        <StatTile label="Top 10 companies" value={pct(conc.top10)} note="of the whole book" color="var(--green)" />
        {/* Stated as "69 companies behaving like 20" rather than a bare 20,
            because a lone "19.8" sitting next to nineteen positions reads as a
            coincidence instead of as the comparison it is. */}
        <StatTile
          label="Effective holdings"
          value={conc.effective == null ? '—' : conc.effective.toFixed(1)}
          note={conc.effective == null ? ''
            : `${x.exposures.length} companies behaving like ${conc.effective.toFixed(0)} equal ones, across the ${pct(conc.basis, 0)} that is resolved`}
          color="var(--orange)"
        />
      </div>

      <Card
        title="True exposure by company"
        color="var(--purple)"
        right={x.exposures.length > limit && (
          <button className="seg-btn on" onClick={() => setAll(a => !a)}>
            {all ? `Top ${limit}` : `All ${x.exposures.length}`}
          </button>
        )}
      >
        <p className="xr-note">
          TRUE is the company&rsquo;s share of the whole book after unpacking every
          fund. SHELF is what that ticker&rsquo;s own line is worth. A blank shelf
          column means you never bought the company — you own it anyway.
          {hidden > 0 && <> <strong>{hidden}</strong> companies above 1% are held
            only through funds.</>}
        </p>
        <div className="xr-table">
          <div className="xr-head">
            <span>#</span><span>Company</span><span>True</span><span>Shelf</span>
            <span>Value</span><span>Held through</span>
          </div>
          {rows.map((e, i) => {
            const sh = shelf[e.sym];
            return (
              <div key={e.sym} className={`xr-row${e.direct ? ' xr-direct' : ''}`}>
                <span className="xr-rank">{i + 1}</span>
                <span className="xr-name">
                  <b>{e.name}</b><i>{e.sym}</i>
                  <span className="xr-bar" style={{ width: `${(e.pct / maxPct) * 100}%` }} />
                </span>
                <span className="xr-true">{pct(e.pct, 2)}</span>
                <span className="xr-shelf">{sh == null ? '—' : pct(sh, 2)}</span>
                <span className="xr-val">{disp(e.value)}</span>
                <span className="xr-via">
                  {e.direct && <em className="xr-chip xr-own" title="bought outright">OWNED</em>}
                  {e.via.map(v => (
                    <em key={v.fund} className="xr-chip" title={`${disp(v.value)} of your ${v.fund}`}>
                      {v.fund}
                    </em>
                  ))}
                </span>
              </div>
            );
          })}
        </div>
        {x.rest.value > 0 && (
          <p className="xr-note xr-rest">
            Plus {disp(x.rest.value)} ({pct(x.rest.pct)}) spread across the companies
            below each fund&rsquo;s top-25 list — real holdings in real businesses,
            simply not enumerated here. It is shown as its own line rather than
            dropped, because dropping it would inflate every percentage above.
          </p>
        )}
      </Card>

      {pairs.length > 0 && (
        <Card title="How much of each fund you already own via another" color="var(--orange)">
          <p className="xr-note">
            For every company in both funds, the smaller of the two weights, added
            up. These are <strong>floors</strong>: computed from top-25 lists, so
            the unlisted remainders of two S&amp;P funds overlap further than this
            and there is no way to see by how much.
          </p>
          <div className="xr-pairs">
            {pairs.map(p => {
              const id = `${p.a}|${p.b}`;
              const open = openPair === id;
              return (
                <div key={id} className="xr-pair">
                  <button className="xr-pair-hd" onClick={() => setOpenPair(open ? null : id)}>
                    <span className="xr-pair-t">{p.a} <i>∩</i> {p.b}</span>
                    <span className="xr-pair-bar">
                      <span style={{ width: `${Math.min(100, p.pct)}%` }} />
                    </span>
                    <span className="xr-pair-p">≥ {pct(p.pct)}</span>
                    <span className="xr-pair-x">{open ? '−' : '+'}</span>
                  </button>
                  {open && (
                    <div className="xr-pair-names">
                      {p.names.slice(0, 12).map(n => (
                        <span key={n.sym} className="xr-chip">
                          {n.sym} <i>{(n.weight * 100).toFixed(2)}%</i>
                        </span>
                      ))}
                      <span className="xr-pair-cov">
                        seen across {pct(p.coverage, 0)} of the smaller fund
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <Card title="Where these numbers come from" color="var(--ink-3)">
        <p className="xr-note">
          Composition is a dated snapshot, not a feed. Index funds drift slowly, so
          a month-old list is fine — but it has to be visible that it is a month old,
          which is why every date is printed rather than implied.
        </p>
        <div className="xr-src">
          {heldFunds.map(t => {
            const c = comps[t];
            return (
              <div key={t} className="xr-src-row">
                <b>{t}</b>
                <span className="xr-src-n">{c.name || '—'}</span>
                <span>top {c.holdings.length} of {c.count ?? '?'}</span>
                <span>{pct(c.covered * 100, 0)} of the fund</span>
                <span className="xr-src-d">as of {c.asOf || 'unknown'}</span>
              </div>
            );
          })}
        </div>
        <p className="xr-note xr-rest">
          Sector and country maps need a per-company data source this app does not
          have a key for yet. The arithmetic for them is already written and unused —
          it will light up when the data arrives, and until then the panel is absent
          rather than guessed at.
        </p>
      </Card>
    </>
  );
}
