import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Card, Empty, StatTile } from '../ui.jsx';
import {
  RULES, STRATEGIES, strategyById, scan, universeNote, dataAge, ideaCard, DISCLAIMER,
  buildUniverse, fetchEstimate, CANDLE_PACE_MS,
} from '../../lib/scanner.js';

import { fetchMetrics, hasKey, cachedAt } from '../../lib/fundamentals.js';
import { fetchCandles } from '../../lib/marketdata.js';

// The rules are looked up by id all over this file. Building the index once,
// beside the import, keeps every lookup in the file pointing at the same
// objects the library defined — there is no second source of thresholds here.
const RULES_INDEX = Object.fromEntries(RULES.map(r => [r.id, r]));

// The screen half of spec 18.
//
// The library refuses to produce advice. This file's job is to not put it back,
// which is a separate problem: a results list is a shape that ARGUES. Rows in
// descending order look ranked by quality; a green tick column looks like a
// verdict; a disclaimer at the bottom is read after the reader has already
// drawn the conclusion it was written to prevent.
//
// Six screen decisions, distinct from the library's six:
//
//   1. The rules are drawn ABOVE the results, in full, with their thresholds.
//      You read the filter before you read the names. A screener that keeps its
//      rules behind a dropdown label is asking to be read as an oracle.
//
//   2. All three lists are drawn — matched, matched nothing, and could-not-be-
//      evaluated — and the third is never collapsed. Its size is the honest
//      measure of how much this screen actually knows, so it is the one number
//      that must not be hideable.
//
//   3. A row's failures are inline, at the same size and in the same column as
//      its passes. Not a hover, not a second click. A card showing only what
//      matched is a verdict wearing a filter's clothes.
//
//   4. Tied names are drawn as ONE group under ONE rank chip. Consecutive rows
//      imply an order even when the numbers behind them are identical, and the
//      library deliberately has no tiebreaker to justify one.
//
//   5. The disclaimer is at the top, before the first result.
//
//   6. Nothing is fetched on open. Ratios are one press, candles are another,
//      and the candle press says what it costs before you make it — the free
//      tier is 8 calls a minute, so a twenty-name scan is a two-and-a-half
//      minute wait and the button says so.

const stateColour = s => (s === 'pass' ? 'var(--green)' : s === 'fail' ? 'var(--ink-3)' : 'var(--orange)');
const stateMark = s => (s === 'pass' ? '■' : s === 'fail' ? '□' : '?');

// ---- decision 1: the filter, printed ------------------------------------

export function RuleList({ strategy }) {
  const s = typeof strategy === 'string' ? strategyById(strategy) : strategy;
  if (!s) return null;
  return (
    <div className="sc-rules">
      {s.rules.map((id, i) => {
        const r = RULES_INDEX[id];
        if (!r) return null;
        return (
          <div className="sc-rule" key={id}>
            <span className="sc-rule-n">{String(i + 1).padStart(2, '0')}</span>
            <span className="sc-rule-b">
              <b className="sc-rule-l">{r.label}</b>
              <span className="sc-rule-t">{r.rule}.</span>
              {/* Decision 5 of the library, rendered: the inverse travels with
                  the threshold so the two can never drift apart on screen. */}
              <span className="sc-rule-e">Stops matching on {r.ends}.</span>
            </span>
            <span className="sc-rule-need">{r.need}</span>
          </div>
        );
      })}
    </div>
  );
}

// ---- decision 3: one row, both sides -------------------------------------

export function ResultRow({ result, cur = '$' }) {
  const card = ideaCard(result);
  if (!card) return null;
  return (
    <div className="sc-row">
      <div className="sc-row-h">
        <span className="sc-tk">{result.ticker}</span>
        {result.held && <span className="sc-held">held</span>}
        <span className="sc-count">{card.matched}/{card.answered}</span>
        {result.price != null && <span className="sc-px">{cur}{result.price.toFixed(2)}</span>}
      </div>
      <div className="sc-note">{card.note}</div>
      <div className="sc-lines">
        {result.results.map(r => (
          <div className={`sc-line sc-${r.state}`} key={r.id}>
            <span className="sc-mark" style={{ color: stateColour(r.state) }}>{stateMark(r.state)}</span>
            <span className="sc-line-l">{r.label}</span>
            <span className="sc-line-t">{r.text}</span>
          </div>
        ))}
      </div>
      {card.ends.length > 0 && (
        <div className="sc-ends">
          <span className="sc-ends-k">stops matching on</span>
          <span className="sc-ends-x">
            {card.ends.map(e => e.ends).join('; ')}.
          </span>
        </div>
      )}
    </div>
  );
}

// ---- decision 4: a tie is one group --------------------------------------

export function TieGroup({ rank, rows, cur }) {
  return (
    <div className="sc-group">
      <div className="sc-group-h">
        <span className="sc-rank">#{rank}</span>
        <span className="sc-group-t">
          {rows.length === 1
            ? `${rows[0].matched} of ${rows[0].answered} rules matched`
            : `${rows.length} names tied on ${rows[0].matched} of ${rows[0].answered} rules — nothing here separates them, and no order is implied`}
        </span>
      </div>
      {rows.map(r => <ResultRow key={r.ticker} result={r} cur={cur} />)}
    </div>
  );
}

// ---- decision 2: the third list, never folded ----------------------------

export function Blocked({ rows }) {
  if (!rows.length) return null;
  const kinds = [...new Set(rows.flatMap(r => r.needs))];
  return (
    <Card title={`Could not be evaluated — ${rows.length}`} color="var(--orange)">
      <p className="small muted mb">
        Not one rule in this screen could be answered for these names, so they are neither
        matches nor misses. They are here rather than hidden because a name filtered out for
        missing data looks exactly like a name filtered out for failing, and the difference
        matters: this list is a fact about what has been loaded, not about the companies.
        {kinds.length > 0 && ` Loading ${kinds.join(' and ')} would move them into one of the lists above.`}
      </p>
      <div className="sc-blocked">
        {rows.map(r => (
          <div className="sc-bl" key={r.ticker}>
            <span className="sc-tk">{r.ticker}</span>
            <span className="sc-bl-t">{r.unknown[0]?.text || 'No data.'}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ---- the screen ----------------------------------------------------------

export default function Scanner({ held = [], priceOf = () => null, cur = '$' }) {
  const [pick, setPick] = useState('quality-value');
  const [metrics, setMetrics] = useState({});
  const [candles, setCandles] = useState({});
  const [busy, setBusy] = useState(null);   // 'metrics' | 'candles' | null
  const [done, setDone] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(t); }, []);

  const strategy = strategyById(pick);

  // Decision 1 of the library, delegated to the library rather than rebuilt
  // here. This used to compose the universe inline from two sources, which put
  // the dedup rule in this file and the sentence describing it in the other
  // one — so widening the universe meant changing both and hoping.
  const universe = useMemo(() => buildUniverse({ holdings: held }), [held]);
  const note = useMemo(() => universeNote(universe.counts), [universe]);

  const rows = useMemo(() => universe.rows.map(u => {
    const h = held.find(x => String(x.ticker || '').toUpperCase() === u.ticker);
    const px = Number(priceOf(u.ticker)) || Number(h?.last_price) || null;
    return {
      ticker: u.ticker,
      name: h?.name || u.name || u.ticker,
      held: u.held,
      source: u.source,
      price: px,
      metric: metrics[u.ticker] || null,
      candles: candles[u.ticker] || null,
    };
  }), [universe, held, priceOf, metrics, candles]);

  const result = useMemo(() => scan(pick, rows), [pick, rows]);

  // Decision 6 of the library: the stamp is the OLDEST input, taken from the
  // fundamentals cache itself rather than from when this screen was opened.
  const age = useMemo(() => {
    const stamps = rows.map(r => cachedAt(r.ticker)).filter(Boolean);
    return dataAge(stamps, now);
  }, [rows, now]);

  const needsCandles = !!strategy?.rules.some(id => RULES_INDEX[id]?.need === 'candles');
  const candleCount = Object.keys(candles).length;
  const estimate = useMemo(() => fetchEstimate(rows.length), [rows.length]);
  const metricCount = Object.keys(metrics).filter(k => metrics[k]).length;

  const groups = useMemo(() => {
    const out = [];
    for (const r of result.hits) {
      const last = out[out.length - 1];
      if (last && last.rank === r.rank) last.rows.push(r);
      else out.push({ rank: r.rank, rows: [r] });
    }
    return out;
  }, [result]);

  async function loadMetrics() {
    if (busy || !rows.length) return;
    setBusy('metrics'); setDone(0);
    try {
      await fetchMetrics(rows.map(r => r.ticker), (t, v, all) => {
        setDone(Object.keys(all).length);
        setMetrics({ ...all });
      });
    } catch {}
    setBusy(null);
  }

  // Paced because the candle provider's free tier is 8 calls a minute. The wait
  // is stated on the button before it is pressed rather than discovered halfway
  // through it — and since the universe was widened that wait is now measured
  // in minutes, so the run is also STOPPABLE.
  //
  // Making it stoppable is safe only because of the library's decision 2: a
  // name with no history comes back 'unknown', not 'fail'. A half-loaded run
  // therefore produces a screen that knows less, not a screen that is wrong,
  // and the "not evaluated" list — which decision 2 of the screen forbids
  // collapsing — grows to say exactly how much less.
  //
  // The flag is a ref rather than state on purpose: the loop reads it after
  // every await, and a state value captured in this closure would still be
  // `false` on the next tick however many times the button was pressed.
  const stopRef = useRef(false);

  async function loadCandles() {
    if (busy || !rows.length) return;
    stopRef.current = false;
    setBusy('candles'); setDone(0);
    const acc = {};
    for (let i = 0; i < rows.length; i++) {
      if (stopRef.current) break;
      try {
        const c = await fetchCandles(rows[i].ticker, '1D');
        if (c && c.length) acc[rows[i].ticker] = c;
      } catch {}
      setDone(d => d + 1);
      setCandles({ ...acc });
      // The pace is between calls, so the last name does not pay for a pause
      // nobody is waiting on — and a stop pressed during the wait is honoured
      // at the top of the next iteration rather than after another 8 seconds.
      if (i < rows.length - 1 && !stopRef.current) {
        await new Promise(res => setTimeout(res, CANDLE_PACE_MS));
      }
    }
    stopRef.current = false;
    setBusy(null);
  }

  if (!note.total) return <Empty icon="⌕" text={note.text} />;

  return (
    <>
      <div className="tile-row">
        <StatTile label="Universe" value={note.total} note="held + lists" color="var(--cyan)" />
        <StatTile label="Matching" value={result.hits.length} note="at least one rule" color={result.hits.length ? 'var(--green)' : 'var(--ink-2)'} />
        <StatTile label="No match" value={result.misses.length} note="answered, matched nothing" color="var(--ink-2)" />
        <StatTile label="Not evaluated" value={result.blocked.length} note="missing data, not a failure" color={result.blocked.length ? 'var(--orange)' : 'var(--green)'} />
      </div>

      {/* Decision 5: this is the first thing on the screen, not the last. */}
      <Card title="What this screen is" color="var(--red)">
        <p className="sc-disclaim">{DISCLAIMER}</p>
        <p className="small muted">{note.text}</p>
        <p className={`small ${age.stale ? 'sc-stale' : 'muted'}`}>{age.text}</p>
      </Card>

      <Card
        title="Screen"
        color="var(--purple)"
        right={
          <button className="btn btn-sm btn-cyan" onClick={loadMetrics} disabled={!!busy || !hasKey()}>
            {busy === 'metrics' ? `ratios ${done}/${rows.length}…` : metricCount ? 'reload ratios' : 'load ratios'}
          </button>
        }
      >
        <div className="seg mb">
          {STRATEGIES.map(s => (
            <button
              key={s.id}
              className={`seg-btn${pick === s.id ? ' on' : ''}`}
              onClick={() => setPick(s.id)}
            >{s.name}</button>
          ))}
        </div>

        {!hasKey() && (
          <p className="small sc-warn">
            No Finnhub key is set, so the ratio rules cannot be answered at all. They will read as
            unmeasured rather than as failures — see the third list below.
          </p>
        )}

        <p className="sc-thesis">{strategy.thesis}</p>
        <p className="sc-caution"><b>What it cannot see:</b> {strategy.caution}</p>

        {/* Decision 1. */}
        <RuleList strategy={strategy} />

        {needsCandles && (
          <div className="sc-candles">
            <span className="sc-candles-t">
              {candleCount
                ? `Price history loaded for ${candleCount} of ${rows.length} names.`
                : 'The trend rules in this screen need daily price history, which is not loaded.'}
              {' '}{estimate.text}
            </span>
            {busy === 'candles' ? (
              /* Stop is a real button, not a cancel hidden behind the progress
                 text. A ten-minute run the reader cannot end is a run they will
                 end by closing the tab, which loses the names already fetched. */
              <button className="btn btn-sm" onClick={() => { stopRef.current = true; }}>
                ■ stop — {done}/{rows.length}
              </button>
            ) : (
              <button className="btn btn-sm btn-pink" onClick={loadCandles} disabled={!!busy}>
                load price history
              </button>
            )}
          </div>
        )}
      </Card>

      {groups.length > 0 ? (
        <Card title={`Matched — ${result.hits.length}`} color="var(--green)">
          <p className="small muted mb">
            Ordered by how many of the strategy's rules each name satisfied. That count is not a
            quality ranking and the names inside a group are in no order at all — the rules do not
            contain a preference, so neither does this list.
          </p>
          {groups.map(g => <TieGroup key={g.rank} rank={g.rank} rows={g.rows} cur={cur} />)}
        </Card>
      ) : (
        <Card title="Matched — 0" color="var(--ink-2)">
          <Empty icon="○" text={
            metricCount
              ? 'Nothing in the universe satisfied a single rule in this screen. That is a result, not an error.'
              : 'No ratios are loaded yet, so nothing can match. Press “load ratios” above.'
          } />
        </Card>
      )}

      {result.misses.length > 0 && (
        <Card title={`Matched nothing — ${result.misses.length}`} color="var(--ink-2)">
          <p className="small muted mb">
            These were evaluated and satisfied none of the rules. They are listed because a screen
            that shows only its matches never tells you how selective it was being.
          </p>
          <div className="sc-misses">
            {result.misses.map(r => (
              <span className="sc-miss" key={r.ticker}>{r.ticker}</span>
            ))}
          </div>
        </Card>
      )}

      {/* Decision 2: always drawn, never behind a toggle. */}
      <Blocked rows={result.blocked} />
    </>
  );
}
