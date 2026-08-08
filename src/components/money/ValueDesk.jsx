import React, { useEffect, useMemo, useState } from 'react';
import { Card, Empty } from '../ui.jsx';
import ValueLibrary from './ValueLibrary.jsx';
import { memGet } from '../../lib/advisor.js';
import { UNIVERSE } from '../../lib/leaders.js';

// The container that makes ValueLibrary reachable.
//
// ValueLibrary runs four valuation models over a list of companies. It is pure
// and takes `rows` — one per company, carrying whatever fundamentals we have.
// Nothing rendered it, so like YieldLens it existed only in the repo.
//
// The rows are assembled from two sources, and keeping them distinct matters:
//
//   `fundamentals` is the Finnhub cache — real numbers, fetched per ticker, at
//   most a day old, and present only for companies someone has actually opened.
//   UNIVERSE is a static list of thirty large caps. It supplies NAMES and the
//   `mega` flag, never figures.
//
// The union is deliberate. Showing only cached companies would make the library
// look empty on a fresh install; showing UNIVERSE alone would produce thirty
// cards that all say "no data saved". So every company appears, and one that has
// no fundamentals cached says exactly that rather than modelling a value out of
// nothing — which is the failure mode that makes valuation screens untrustworthy.

export default function ValueDesk({ held = [], quotes = {}, cur = '$', onOpen = null }) {
  const [fund, setFund] = useState(null);

  useEffect(() => {
    let dead = false;
    memGet('fundamentals')
      .then(v => { if (!dead) setFund(v && typeof v === 'object' ? v : {}); })
      .catch(() => { if (!dead) setFund({}); });
    return () => { dead = true; };
  }, []);

  const rows = useMemo(() => {
    if (!fund) return [];
    const megas = new Set(UNIVERSE.map(u => u.t.toUpperCase()));
    const names = Object.fromEntries(UNIVERSE.map(u => [u.t.toUpperCase(), u.n]));

    // Held first, then anything with fundamentals cached, then the static
    // universe. A Set keeps the order of first insertion, which is the order
    // that matters: your own positions are the ones you came to look at.
    const seen = new Set();
    const order = [];
    const push = t => {
      const k = String(t || '').toUpperCase();
      if (!k || seen.has(k)) return;
      seen.add(k); order.push(k);
    };
    held.forEach(h => push(h.ticker));
    Object.keys(fund).forEach(push);
    UNIVERSE.forEach(u => push(u.t));

    return order.map(t => {
      const f = fund[t] || {};
      const m = f.metric?.metric || f.metric || {};
      const profile = f.profile || {};
      return {
        ticker: t,
        // The name can come from the cache or the static list; the FIGURES only
        // ever come from the cache.
        name: profile.name || names[t] || t,
        mega: megas.has(t),
        price: quotes[t]?.c ?? quotes[t]?.price ?? null,
        // Passed through under the names valuelib's modelInputs looks for. A
        // missing key stays missing — modelInputs returns null for a model whose
        // driver is absent, and the card then says which model could not run.
        eps: m.epsTTM ?? m.epsBasicExclExtraTTM ?? null,
        bookValuePerShare: m.bookValuePerShareQuarterly ?? m.bookValuePerShareAnnual ?? null,
        freeCashFlowPerShare: m.freeCashFlowPerShareTTM ?? null,
        dividendPerShare: m.dividendPerShareTTM ?? m.dividendPerShareAnnual ?? null,
        growth: m.epsGrowth5Y ?? m.revenueGrowth5Y ?? null,
        beta: m.beta ?? null,
        at: f.at ?? null,
      };
    });
  }, [fund, held, quotes]);

  if (fund === null) {
    return <Card title="Valuation library" color="var(--purple)"><Empty icon="◷" text="Loading saved fundamentals…" /></Card>;
  }

  const withData = rows.filter(r => r.eps != null || r.freeCashFlowPerShare != null
    || r.bookValuePerShare != null || r.dividendPerShare != null).length;

  return (
    <>
      <Card title="Valuation library" color="var(--purple)">
        <p className="yd-lead">
          Four models over {rows.length} companies — a two-stage DCF, Graham,
          earnings power and dividend discount. {withData} of them have
          fundamentals saved; the rest name which model could not run and why,
          rather than producing a number from assumptions alone.
        </p>
        {withData === 0 && (
          <p className="yd-warn">
            Nothing has fundamentals cached yet. They are fetched per company when
            you open one in Research, and kept for a day — open a few there and
            they will appear here.
          </p>
        )}
      </Card>

      <ValueLibrary rows={rows} quotes={quotes} held={held} cur={cur} onOpen={onOpen} />
    </>
  );
}
