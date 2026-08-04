import { useMemo, useRef, useState } from 'react';
import { Card, Empty } from '../ui.jsx';
import {
  DEFAULTS, defaultAssumptions, ASSUMPTION_NOTE, valueCard, bar, buildLibrary,
  searchLibrary, POPULAR, MIN_FIT, DISCLAIMER,
} from '../../lib/valuelib.js';
import { MODELS } from '../../lib/intrinsic.js';

// Browse the valuation library.
//
// The screen this replaces did not exist: intrinsic.js could value one company
// you had typed inputs for, and there was no way to look at fifty. The cost of
// adding that is that fifty valuations now appear without anyone having agreed
// to a single assumption behind them, so three things on this page exist purely
// to keep that visible.
//
//   - The assumptions strip is above the cards, always, and shows the actual
//     numbers rather than the word "defaults".
//   - Every card footer names the model its base came from. "Base $757" is not
//     a fact about a company; "Graham base $757" is a fact about a calculation.
//   - The fit dots are drawn for all four models with the misses hollow, so a
//     card that only managed one shows three empty circles rather than simply
//     omitting them.
//
// The shelves never sort by upside. See decision 4 in src/lib/valuelib.js.

const money = (v, cur) => (v === null || v === undefined ? '—' : `${cur}${Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2)}`);
const signedPct = v => (v === null || v === undefined ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(0)}%`);

/** Bear→bull track, base tick, today's price dot. Geometry comes from bar(). */
function RangeBar({ card, cur }) {
  const g = bar(card);
  if (!g) {
    return <div className="vl-nobar">No clean fit at default assumptions</div>;
  }
  const clamp = x => `${Math.max(0, Math.min(1, x)) * 100}%`;
  return (
    <div className="vl-bar" title={`Bear ${money(card.range.lo, cur)} → bull ${money(card.range.hi, cur)}`}>
      <div className="vl-track" />
      <div className="vl-range"
        style={{ left: clamp(g.loX), width: `${Math.max(0, (g.hiX - g.loX)) * 100}%` }} />
      {g.baseX !== null && <i className="vl-base-tick" style={{ left: clamp(g.baseX) }} />}
      <i className={`vl-price-dot${g.outside ? ' out' : ''}`} style={{ left: clamp(g.priceX) }}
        title={`Today ${money(card.price, cur)}`} />
    </div>
  );
}

/** Four circles, filled for the models that produced a value. */
function FitDots({ card }) {
  return (
    <span className="vl-dots" title={`${card.fit} of ${card.of} methods fit`}>
      {MODELS.map(m => {
        const hit = card.methods.find(x => x.key === m.key);
        return (
          <i key={m.key} className={`vl-dot${hit && hit.ok ? ' on' : ''}`}
            title={hit && hit.ok ? `${m.label}: fits` : `${m.label}: ${hit ? hit.reason : 'no input'}`} />
        );
      })}
    </span>
  );
}

function ValueCardTile({ card, cur, onOpen }) {
  const v = card.verdict;
  const noFit = card.fit < MIN_FIT;
  return (
    <div className="vl-card" onClick={() => onOpen && onOpen(card.ticker)} role="button" tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' && onOpen) onOpen(card.ticker); }}>
      <div className="vl-card-head">
        <span className="vl-logo">{card.ticker.slice(0, 2)}</span>
        <span className="vl-idy">
          <b>{card.ticker}</b>
          <em>{card.name || '—'}</em>
        </span>
      </div>

      <RangeBar card={card} cur={cur} />
      {card.range && (
        <div className="vl-ends">
          <span>{money(card.range.lo, cur)}</span>
          <span>{money(card.range.hi, cur)}</span>
        </div>
      )}

      <div className="vl-verdict">
        <span className="vl-badge" style={{ color: v.color, borderColor: v.color }}>{v.label}</span>
        <span className="vl-to-base" style={{ color: card.toBase === null ? 'var(--ink-3)' : card.toBase >= 0 ? 'var(--green)' : 'var(--red)' }}>
          {card.toBase === null ? '' : `${signedPct(card.toBase)} to base`}
        </span>
      </div>

      <div className="vl-foot">
        <span className="vl-foot-t">
          {noFit ? `${card.fit} of ${card.of} Methods Fit` : `${card.baseLabel} base ${money(card.base, cur)}`}
        </span>
        <FitDots card={card} />
      </div>
    </div>
  );
}

function Shelf({ shelf, cur, onOpen }) {
  const ref = useRef(null);
  const [all, setAll] = useState(false);
  const shown = all ? shelf.cards : shelf.cards.slice(0, 12);
  const nudge = dir => { if (ref.current) ref.current.scrollBy({ left: dir * 260, behavior: 'smooth' }); };
  return (
    <div className="vl-shelf">
      <div className="vl-shelf-head">
        <div>
          <div className="vl-shelf-title">{shelf.title}</div>
          <div className="vl-shelf-note small">{shelf.note}</div>
        </div>
        <div className="vl-shelf-ctl">
          <button type="button" className="vl-all" onClick={() => setAll(a => !a)}>
            {all ? 'Show fewer' : `View all ${shelf.cards.length}`} ›
          </button>
          <button type="button" className="vl-arrow" onClick={() => nudge(-1)} aria-label="Scroll left">‹</button>
          <button type="button" className="vl-arrow" onClick={() => nudge(1)} aria-label="Scroll right">›</button>
        </div>
      </div>
      <div className="vl-rail" ref={ref}>
        {shown.map(c => <ValueCardTile key={c.ticker} card={c} cur={cur} onOpen={onOpen} />)}
      </div>
    </div>
  );
}

export default function ValueLibrary({
  rows = [], quotes = {}, held = [], cur = '₹', onOpen = null,
}) {
  const [q, setQ] = useState('');
  const assumptions = useMemo(() => defaultAssumptions(), []);

  const heldSet = useMemo(
    () => new Set(held.map(h => String(h?.ticker || '').toUpperCase())),
    [held],
  );

  const cards = useMemo(() => rows.map(r => {
    const t = String(r.ticker || '').toUpperCase();
    const price = r.price ?? quotes[t]?.c ?? quotes[t]?.price ?? null;
    const c = valueCard(t, r, price, assumptions);
    return { ...c, held: heldSet.has(t), mega: !!r.mega };
  }), [rows, quotes, heldSet, assumptions]);

  const hits = useMemo(() => searchLibrary(cards, q), [cards, q]);
  const shelves = useMemo(() => buildLibrary(cards), [cards]);

  return (
    <>
      <Card title="Search a Stock to Estimate Its Worth" color="var(--purple)">
        <p className="vl-lede">
          Run four valuation models, from a two-stage DCF to Ben Graham and Dividend Discount,
          at their default assumptions or your own.
        </p>
        <input className="vl-search" value={q} onChange={e => setQ(e.target.value)}
          placeholder="Search any stock by ticker or name" aria-label="Search stocks" />
        <div className="vl-popular small">
          <span>Popular:</span>
          {POPULAR.map(t => (
            <button key={t} type="button" className="vl-pop" onClick={() => setQ(t)}>{t}</button>
          ))}
        </div>

        <div className="vl-assume">
          <div className="vl-assume-note small">{ASSUMPTION_NOTE}</div>
          <div className="vl-assume-row">
            {Object.entries(DEFAULTS).map(([k, d]) => (
              <span key={k} className="vl-assume-k" title={d.why}>
                <b>{d.label}</b><em>{d.value}{d.unit}</em>
              </span>
            ))}
          </div>
        </div>

        {q && (
          <div className="vl-results">
            <div className="vl-shelf-title">{hits.length} match{hits.length === 1 ? '' : 'es'} for “{q}”</div>
            {hits.length
              ? <div className="vl-rail">{hits.map(c => <ValueCardTile key={c.ticker} card={c} cur={cur} onOpen={onOpen} />)}</div>
              : <Empty icon="?" text="Nothing in the library matches that. The library only covers names with saved fundamentals." />}
          </div>
        )}
      </Card>

      <Card title="Browse the Valuation Library" color="var(--purple)"
        right={(
          <span className="vl-legend small">
            <i className="vl-legend-range" /> Bear to Bull, Base Tick
            <i className="vl-legend-dot" /> Today&#39;s Price
          </span>
        )}
      >
        {shelves.length
          ? shelves.map(s => <Shelf key={s.key} shelf={s} cur={cur} onOpen={onOpen} />)
          : <Empty icon="$" text="No saved fundamentals yet, so there is nothing to value. Load financials for a few names first." />}
        <p className="vl-disc small">{DISCLAIMER}</p>
      </Card>
    </>
  );
}
