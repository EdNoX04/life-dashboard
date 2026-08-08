import React, { useEffect, useMemo, useState } from 'react';
import { Card, Empty, StatTile } from '../ui.jsx';
import {
  STATUS, hasKey, loadCached, fetchMany, toDivMetaAll, cacheAge, ttm, runRate,
  isFetchable,
} from '../../lib/divdata.js';
import { memGet, memSet } from '../../lib/advisor.js';

// The one screen that turns a key into working dividend screens.
//
// It does three things, and the order matters: fetch history for your holdings,
// show you what came back per ticker, and then — only on your say-so — merge it
// into `div_meta`, which is what the calendar, income lists, earnings screen,
// yield analyzer and the holdings table's total-return column all read.
//
// The merge is the part that needed care. `div_meta` may already contain
// hand-entered figures, and a fetch that half-fails must never erase them. So:
//
//   Only tickers that fetched CLEANLY are merged. A failure, a no-key, or an
//   uncovered listing leaves whatever was there untouched.
//
//   The merge is per-ticker, not a wholesale replace. Importing AAPL cannot
//   remove the row you typed for GOLDBEES.
//
//   Imported entries are marked `source: 'fmp'`, so a later screen can tell an
//   imported figure from one you entered — and so a re-import knows which rows
//   it is allowed to overwrite.

const STATUS_LOOK = {
  [STATUS.ok]: { label: 'OK', color: 'var(--green)' },
  [STATUS.none]: { label: 'NOTHING FOUND', color: 'var(--ink-3)' },
  [STATUS.uncovered]: { label: 'NOT COVERED', color: 'var(--orange)' },
  [STATUS.failed]: { label: 'FAILED', color: 'var(--red)' },
  [STATUS.nokey]: { label: 'NO KEY', color: 'var(--yellow)' },
};

const ago = ms => {
  if (ms == null) return 'never';
  const h = Math.floor(ms / 3600e3);
  if (h < 1) return 'just now';
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

export default function DivSync({ held = [], cur = '$' }) {
  const [store, setStore] = useState(null);
  const [divMeta, setDivMeta] = useState({});
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [merged, setMerged] = useState(0);
  const keyed = hasKey();

  // Only what the source can actually answer for. A rupee holding is skipped
  // rather than fetched-and-failed: it would spend one of 250 daily requests to
  // learn nothing, and twenty red FAILED rows look exactly like a broken key.
  const fetchable = useMemo(() => held.filter(isFetchable), [held]);
  const skipped = useMemo(
    () => held.filter(h => !isFetchable(h)).map(h => String(h.ticker || '').toUpperCase()),
    [held],
  );
  const tickers = useMemo(
    () => fetchable.map(h => String(h.ticker || '').toUpperCase()).filter(Boolean).sort(),
    [fetchable],
  );

  useEffect(() => {
    let dead = false;
    Promise.all([loadCached(), memGet('div_meta').catch(() => null)]).then(([s, dm]) => {
      if (dead) return;
      setStore(s || {});
      setDivMeta(dm && typeof dm === 'object' ? (dm.rows && typeof dm.rows === 'object' ? dm.rows : dm) : {});
    });
    return () => { dead = true; };
  }, []);

  async function refresh(force) {
    setBusy(true); setProgress({ done: 0, total: tickers.length, ticker: '' });
    const out = await fetchMany(tickers, {
      force,
      onProgress: (done, total, ticker) => setProgress({ done, total, ticker }),
    });
    setStore(s => ({ ...(s || {}), ...out }));
    setBusy(false); setProgress(null);
  }

  async function merge() {
    const bridged = toDivMetaAll(store || {});
    const n = Object.keys(bridged).length;
    if (!n) return;
    // Per-ticker merge, never a replace. A hand-entered row for a ticker that
    // did not fetch cleanly survives untouched.
    const next = { ...divMeta, ...bridged };
    setDivMeta(next);
    setMerged(n);
    try { await memSet('div_meta', next); } catch { /* offline: local state stands */ }
  }

  const rows = useMemo(() => tickers.map(t => {
    const e = store?.[t];
    const st = e?.status || null;
    const r = e?.rows || [];
    return {
      ticker: t,
      status: st,
      count: r.length,
      ttm: r.length ? ttm(r) : null,
      rate: r.length ? runRate(r) : null,
      imported: divMeta[t]?.source === 'fmp',
      hasManual: !!divMeta[t] && divMeta[t].source !== 'fmp',
      note: e?.note || null,
    };
  }), [tickers, store, divMeta]);

  const okCount = rows.filter(r => r.status === STATUS.ok).length;
  const bridgeable = Object.keys(toDivMetaAll(store || {})).length;
  const age = cacheAge(store || {});

  if (store === null) {
    return <Card title="Dividend data" color="var(--orange)"><Empty icon="◷" text="Loading…" /></Card>;
  }

  if (!keyed) {
    return (
      <Card title="Dividend data" color="var(--orange)">
        <Empty
          icon="%"
          text="No Financial Modeling Prep key saved. Add one in Settings → Live market data and this screen fills the dividend calendar, the income lists, the yield analyzer and the total-return column from real declared payments."
        />
      </Card>
    );
  }

  return (
    <>
      <div className="tile-row">
        <StatTile
          label="Holdings" value={tickers.length}
          note={skipped.length ? `${skipped.join(', ')} skipped — not US-listed` : 'in the fetch list'}
          color="var(--cyan)"
        />
        <StatTile label="With history" value={okCount} note={`${rows.length - okCount} without`} color="var(--green)" />
        <StatTile label="Ready to import" value={bridgeable} note="clean fetches only" color="var(--pink)" />
        <StatTile label="Last fetched" value={ago(age)} note="cached for a week" color="var(--orange)" />
      </div>

      <Card
        title="Dividend data"
        color="var(--orange)"
        right={
          <span className="flex" style={{ gap: 6 }}>
            <button className="btn btn-sm btn-cyan" onClick={() => refresh(false)} disabled={busy || !tickers.length}>
              {busy ? `${progress?.done ?? 0}/${progress?.total ?? 0}` : 'FETCH'}
            </button>
            <button className="btn btn-sm" onClick={() => refresh(true)} disabled={busy || !tickers.length} title="Ignore the week-long cache">
              FORCE
            </button>
            <button className="btn btn-sm btn-green" onClick={merge} disabled={busy || !bridgeable}>
              IMPORT {bridgeable || ''}
            </button>
          </span>
        }
      >
        <p className="ds-lead">
          Fetches declared payments for each holding, then — on the IMPORT button,
          not automatically — writes them into the store every other dividend screen
          reads. Only clean fetches are imported, so a bad day at the API cannot
          erase anything you entered by hand.
        </p>

        {/* One explanation at the top beats the same tooltip on twenty rows.
            A 403 across the board is one cause, not twenty problems. */}
        {(() => {
          const failed = rows.filter(r => r.status === STATUS.failed);
          if (!failed.length || failed.length < rows.length) return null;
          return (
            <p className="ds-fail">
              <strong>Every fetch failed.</strong> {failed[0].note}
            </p>
          );
        })()}

        {busy && progress && (
          <p className="ds-prog">Fetching {progress.ticker} — {progress.done} of {progress.total}, paced to stay inside the free tier.</p>
        )}
        {merged > 0 && (
          <p className="ds-done">
            Imported {merged} holding{merged === 1 ? '' : 's'}. The calendar, income
            lists, yield analyzer and total-return column are now reading real
            declared payments.
          </p>
        )}

        {!tickers.length ? (
          <Empty icon="$" text="No holdings recorded, so there is nothing to fetch." />
        ) : (
          <div className="ds-rows">
            <div className="ds-row ds-head">
              <span>Ticker</span><span>Status</span><span>Payments</span>
              <span>TTM / share</span><span>Forward</span><span>In div_meta</span>
            </div>
            {rows.map(r => {
              const look = STATUS_LOOK[r.status] || { label: 'NOT FETCHED', color: 'var(--ink-3)' };
              return (
                <div className="ds-row" key={r.ticker} title={r.note || undefined}>
                  <span className="ds-t">{r.ticker}</span>
                  <span style={{ color: look.color }}>{look.label}</span>
                  <span>{r.count || '—'}</span>
                  <span>
                    {r.ttm && r.ttm.total > 0 ? `${cur}${r.ttm.total.toFixed(2)}` : '—'}
                    {/* A part-year history reports a real number that means less
                        than it looks like. Marked rather than hidden. */}
                    {r.ttm && r.ttm.total > 0 && !r.ttm.complete && (
                      <i className="ds-part" title="Fewer than four payments in the last year — this understates a full year">part-year</i>
                    )}
                  </span>
                  <span>
                    {r.rate?.perYear ? `${cur}${r.rate.perYear.toFixed(2)}` : '—'}
                    {r.rate?.cadence && <i className="ds-sub">{r.rate.cadence}</i>}
                  </span>
                  <span>
                    {r.imported
                      ? <em className="ds-imported">imported</em>
                      : r.hasManual
                        ? <em className="ds-manual">entered by hand</em>
                        : <em className="ds-empty">—</em>}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        <p className="ds-foot">
          The free plan covers US listings only, so{skipped.length ? ` ${skipped.join(', ')} ` : ' a non-US holding '}
          is not fetched at all rather than fetched and failed. A US holding that
          comes back with nothing found may pay no dividend or may simply not be
          covered — from here the two are indistinguishable, so neither is asserted.
          {rows.some(r => r.hasManual) && ' Rows you entered by hand are marked, and importing will overwrite them for that ticker.'}
        </p>
      </Card>
    </>
  );
}
