import React, { useEffect, useMemo, useState } from 'react';
import { Card, Empty } from '../ui.jsx';
import YieldLens from './YieldLens.jsx';
import { divSeriesFromMeta } from '../../lib/yieldlens.js';
import { memGet } from '../../lib/advisor.js';
import { loadPriceHistory } from '../../lib/portfolioHistory.js';

// The container that makes YieldLens reachable.
//
// YieldLens itself is pure: hand it a ticker, a price series and a dividend
// series and it draws the yield history and ranks today against it. It has been
// built and committed for a while and nothing rendered it, which is the same
// failure this project has now hit three times — a screen that exists in the
// repo and not in the app is indistinguishable from one that was never built.
//
// The wiring is the awkward part, and it is awkward for a real reason: the two
// series come from different places and go stale on different clocks.
//
//   PRICES live in the `price_history` memory blob, refreshed by the Twelve Data
//   sync behind an explicit button because that key is rate-limited to 8 calls a
//   minute.
//   DIVIDENDS live in `div_meta`, which is partly declared payments scraped or
//   entered by hand and partly a modelled rate.
//
// divSeriesFromMeta reconciles those into one series and reports which source it
// used, so the screen can say "modelled from the current rate" rather than
// implying it read a filing.

export default function YieldDesk({ held = [], priceOf, onOpen = null }) {
  const [ticker, setTicker] = useState('');
  const [divMeta, setDivMeta] = useState(null);
  const [prices, setPrices] = useState({});
  const [state, setState] = useState('loading');

  useEffect(() => {
    let dead = false;
    Promise.all([
      memGet('div_meta').catch(() => null),
      loadPriceHistory().catch(() => null),
    ]).then(([dm, ph]) => {
      if (dead) return;
      setDivMeta(dm && typeof dm === 'object' ? (dm.rows && typeof dm.rows === 'object' ? dm.rows : dm) : {});
      setPrices(ph?.data && typeof ph.data === 'object' ? ph.data : {});
      setState('ready');
    });
    return () => { dead = true; };
  }, []);

  // Only holdings that actually pay. A yield history for a stock with no
  // dividend is a flat line at zero, which is true and useless, and offering it
  // in the picker wastes the reader's attention on a dead end.
  const payers = useMemo(() => {
    if (!divMeta) return [];
    return held
      .map(h => String(h.ticker || '').toUpperCase())
      .filter(t => {
        const e = divMeta[t];
        if (!e) return false;
        const hasDeclared = Array.isArray(e.declared) && e.declared.length > 0;
        return hasDeclared || Number(e.perShare) > 0;
      })
      .sort();
  }, [held, divMeta]);

  const active = ticker || payers[0] || '';

  // divSeriesFromMeta returns an ENVELOPE - {rows, source, note} - not a bare
  // array, and this passed the envelope straight to YieldLens as its dividend
  // series. Every screen under Yield then called .map on an object and the tab
  // died with "map is not a function" before it drew anything.
  //
  // The envelope is kept, because `source` is the whole reason it exists: a
  // declared payment history and a rate walked backwards produce yield lines
  // that look identical and mean completely different things. It is unwrapped at
  // the boundary and the source is stated on screen rather than thrown away.
  const div = useMemo(
    () => (active && divMeta?.[active]
      ? divSeriesFromMeta(divMeta[active])
      : { rows: [], source: 'none', note: null }),
    [active, divMeta],
  );

  // price_history stores {TICKER: {'YYYY-MM-DD': close}}; YieldLens wants points.
  const priceSeries = useMemo(() => {
    const raw = prices?.[active];
    if (!raw || typeof raw !== 'object') return [];
    return Object.entries(raw)
      .map(([t, c]) => ({ t, c: Number(c) }))
      .filter(p => Number.isFinite(p.c) && p.c > 0)
      .sort((a, b) => a.t.localeCompare(b.t));
  }, [prices, active]);

  const holding = held.find(h => String(h.ticker).toUpperCase() === active);

  if (state === 'loading') {
    return <Card title="Yield analyzer" color="var(--orange)"><Empty icon="◷" text="Loading dividend and price history…" /></Card>;
  }

  if (!payers.length) {
    return (
      <Card title="Yield analyzer" color="var(--orange)">
        {/* Named precisely. "No data" would be true of three different problems
            with three different fixes, and the reader has to know which. */}
        <Empty
          icon="%"
          text={
            held.length === 0
              ? 'No holdings recorded yet, so there is nothing to analyse.'
              : 'None of your holdings has dividend data saved yet. This screen reads the div_meta store — add a declared payment or a per-share rate on the Dividends screen and the yield history builds itself from there.'
          }
        />
      </Card>
    );
  }

  return (
    <>
      <Card
        title="Yield analyzer"
        color="var(--orange)"
        right={
          <select value={active} onChange={e => setTicker(e.target.value)} style={{ width: 120 }}>
            {payers.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        }
      >
        <p className="yd-lead">
          Where today&#39;s yield sits against its own history — the question a
          yield number on its own cannot answer. A 4% yield is cheap for one stock
          and expensive for another; only its own past says which.
        </p>
        {/* Which of the three sources this line is built from. Stated on the
            screen rather than in a comment, because a modelled back-cast drawn
            in the same ink as a payment record is the screen lying quietly. */}
        {div.source === 'declared' && (
          <p className="yd-src">Built from {div.rows.length} declared payments — this is history, not a model.</p>
        )}
        {div.source === 'modelled' && (
          <p className="yd-warn">
            No declared payment history saved for {active}, so the past dividend is
            the current rate walked backwards at its stated growth. That is a smooth
            curve no company ever paid — treat the shape, not the level.
          </p>
        )}
        {div.source === 'flat' && (
          <p className="yd-warn">{div.note}</p>
        )}
        {priceSeries.length < 2 && (
          <p className="yd-warn">
            No price history saved for {active}, so the yield line cannot be drawn
            against price. Refresh price history on the Portfolio screen — it is
            behind a button because the Twelve Data key allows eight calls a minute.
          </p>
        )}
      </Card>

      <YieldLens
        ticker={active}
        name={holding?.name || active}
        prices={priceSeries}
        divSeries={div.rows}
      />
    </>
  );
}
