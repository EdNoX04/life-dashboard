import React, { useEffect, useMemo, useRef, useState } from 'react';
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

  async function merge(silent = false) {
    const bridged = toDivMetaAll(store || {});
    const n = Object.keys(bridged).length;
    if (!n) return 0;
    // Per-ticker merge, never a replace. A hand-entered row for a ticker that
    // did not fetch cleanly survives untouched.
    const next = { ...divMeta, ...bridged };
    setDivMeta(next);
    if (!silent) setMerged(n);
    try { await memSet('div_meta', next); } catch { /* offline: local state stands */ }
    return n;
  }

  // Automatic. There is no reason to make someone press FETCH and then IMPORT:
  // the cache already decides when a real request is worth making (a week for a
  // success, five minutes for a failure, never for a plan boundary), so calling
  // this on mount costs nothing on a warm cache and does the right thing on a
  // cold one. The buttons stay for forcing a refresh, not for routine use.
  //
  // Importing is safe to do unattended for the same reason it was safe to do on
  // a button: only CLEAN fetches are merged, per ticker, so nothing you entered
  // by hand can be erased by a bad day at the API.
  const autoRef = useRef(false);
  useEffect(() => {
    if (!keyed || store === null || !tickers.length || autoRef.current) return;
    autoRef.current = true;
    (async () => {
      const out = await fetchMany(tickers, { force: false });
      setStore(s2 => ({ ...(s2 || {}), ...out }));
    })();
  }, [keyed, store, tickers]);

  // Import whenever there is something clean that is not already in div_meta.
  // Keyed on what is actually importable rather than on a timer, so it runs
  // once after a fetch lands and then stays quiet.
  const importable = useMemo(() => {
    const bridged = toDivMetaAll(store || {});
    return Object.keys(bridged).filter(t => divMeta[t]?.at !== bridged[t].at);
  }, [store, divMeta]);

  useEffect(() => {
    if (!importable.length || busy) return;
    merge(true);
  }, [importable.length]);   // eslint-disable-line react-hooks/exhaustive-deps

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
      code: e?.code ?? null,
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
            <button
              className="btn btn-sm btn-cyan" onClick={() => refresh(false)}
              disabled={busy || !tickers.length}
              title="Re-check anything the cache considers stale. This also runs on its own when you open the screen."
            >
              {busy ? `${progress?.done ?? 0}/${progress?.total ?? 0}` : 'REFRESH'}
            </button>
            <button
              className="btn btn-sm" onClick={() => refresh(true)}
              disabled={busy || !tickers.length}
              title="Ignore the cache entirely and call the API for every holding. Use this after fixing a key or when the rows look stale."
            >
              FORCE
            </button>
            {/* Kept as an override for the case where you want to re-apply an
                import you have since edited by hand. Routine importing happens
                on its own. */}
            <button
              className="btn btn-sm" onClick={() => merge(false)} disabled={busy || !bridgeable}
              title="Re-apply every clean fetch to the dividend store, overwriting hand edits for those tickers."
            >
              RE-APPLY
            </button>
          </span>
        }
      >
        <p className="ds-lead">
          Fetches declared payments for each holding and writes them into the store
          every other dividend screen reads — on its own, when you open this screen.
          Only clean fetches are imported, per ticker, so a bad day at the API cannot
          erase anything you entered by hand. A success is cached for a week, a
          failure for five minutes, and a listing the plan does not cover is not
          re-asked at all.
        </p>

        {/* One explanation at the top beats the same tooltip on twenty rows.
            A 403 across the board is one cause, not twenty problems. */}
        {(() => {
          const failed = rows.filter(r => r.status === STATUS.failed);
          if (!failed.length) return null;
          const byCode = {};
          for (const f of failed) byCode[f.code ?? '?'] = (byCode[f.code ?? '?'] || 0) + 1;
          const all = failed.length === rows.length;
          return (
            <p className="ds-fail">
              <strong>{all ? 'Every fetch failed.' : `${failed.length} of ${rows.length} failed.`}</strong>{' '}
              {/* Grouped by code, because a mixed result is several problems and
                  a single sentence about the first one would describe the wrong
                  one for most of the rows. */}
              {Object.entries(byCode).map(([c, n]) => `${n}× ${c === '0' ? 'network' : c}`).join(', ')}.
              {byCode['403'] && (
                <> A <b>403</b> on ETFs is the free plan: FMP restricts fund data,
                  and no client change reaches it. Those rows will stay empty until
                  the plan changes.</>
              )}
              {byCode['429'] && (
                <> A <b>429</b> is rate limiting, not a permission problem — wait a
                  minute and press FETCH, which retries only what failed.</>
              )}
              {all && (
                <> If your Financial Modeling Prep dashboard shows <b>0 requests today</b>,
                  nothing was sent at all: these are cached. Press <b>FORCE</b>.</>
              )}
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
                  <span style={{ color: look.color }}>
                    {look.label}
                    {/* The code, in the row. Twenty rows all saying FAILED tell
                        you nothing; 403 on the ETFs and 429 on two scattered
                        names are two different problems with two different
                        fixes, and only the code separates them. */}
                    {r.code != null && r.status === STATUS.failed && (
                      <i className="ds-code">{r.code || 'net'}</i>
                    )}
                  </span>
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
                  {/* Failures explain themselves in the row. A tooltip is a
                      place to hide something you are hoping nobody reads, and
                      the whole difficulty with these rows has been that the one
                      fact that would end the guessing was not on screen. */}
                  {r.status === STATUS.failed && r.note && (
                    <span className="ds-why">{r.note}</span>
                  )}
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
