import React, { useEffect, useMemo, useState } from 'react';
import { Card } from '../ui.jsx';
import { getConfig, list, upsertMemory } from '../../lib/db.js';
import {
  COUNTRIES, FUTURES, worldBankUrl, parseWorldBank, quoteUrl, parseQuotes,
  symbolsFor, marketRows, sortByCap, coverageNote, capsAreFresh, fmtPct,
} from '../../lib/globalmarkets.js';

// The Money tab's opening screen.
//
// Modelled on stockanalysis.com's overview, with one difference that runs through
// every tile: the cap and the change are DIFFERENT KINDS OF FACT and the screen
// says so. "$80.58T" is the World Bank's annual total from the World Federation
// of Exchanges — real, citable, and from last year. "+0.75%" is today's move in
// the S&P. Printing them side by side without their labels would imply a live
// measurement of a whole market that nobody performs for free.
//
// So every cap carries its year, and every tile names the index its percentage
// refers to. Six characters of honesty against a number someone might act on.

const DIR = { 1: 'var(--green)', '-1': 'var(--red)', 0: 'var(--ink-3)' };

export default function GlobalOverview() {
  const [caps, setCaps] = useState({});
  const [quotes, setQuotes] = useState({});
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(true);
  const key = (getConfig().twelveKey || '').trim();

  // ---- caps: annual, so cached for a week rather than a minute ----
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const rows = await list('memory', { filter: 'key=eq.global_caps', order: 'key' });
        const cached = rows?.[0]?.value;
        if (capsAreFresh(cached)) { if (!dead) setCaps(cached.caps); return; }

        const r = await fetch(worldBankUrl());
        const parsed = parseWorldBank(await r.json());
        if (dead) return;
        setCaps(parsed);
        // Written even when the fetch was partial. A partial cache still spares
        // the next visit a request, and every value in it is one the World Bank
        // actually returned.
        if (Object.keys(parsed).length) {
          await upsertMemory('global_caps', { caps: parsed, at: new Date().toISOString() })
            .catch(() => {});
        }
      } catch (e) {
        if (!dead) setErr(`market sizes unavailable — ${String(e.message || e)}`);
      }
    })();
    return () => { dead = true; };
  }, []);

  // ---- quotes: ONE request for all fifteen symbols ----
  useEffect(() => {
    let dead = false;
    if (!key) { setBusy(false); setErr('Add a Twelve Data key in Settings to see live index moves.'); return; }
    (async () => {
      try {
        const syms = symbolsFor();
        const r = await fetch(quoteUrl(syms, key));
        const parsed = parseQuotes(await r.json(), syms);
        if (!dead) setQuotes(parsed);
      } catch (e) {
        if (!dead) setErr(String(e.message || e));
      } finally {
        if (!dead) setBusy(false);
      }
    })();
    return () => { dead = true; };
  }, [key]);

  const rows = useMemo(() => sortByCap(marketRows(caps, quotes)), [caps, quotes]);
  const note = useMemo(() => coverageNote(rows), [rows]);

  return (
    <>
      <div className="gm-futures">
        {FUTURES.map(f => {
          const q = quotes[f.symbol];
          const dir = q?.pct == null ? 0 : q.pct > 0 ? 1 : q.pct < 0 ? -1 : 0;
          return (
            <div key={f.symbol} className="gm-fut">
              <div className="gm-fut-lbl">{f.label}</div>
              <div className="gm-fut-row">
                <span className="gm-fut-val">
                  {q?.level != null ? q.level.toLocaleString('en-US', { minimumFractionDigits: 2 }) : '—'}
                </span>
                {/* The arrow carries direction as well as the colour, so the tile
                    is readable without relying on red-versus-green alone. */}
                <span className="gm-chip" style={{ color: DIR[dir], borderColor: DIR[dir] }}>
                  {dir > 0 ? '▲' : dir < 0 ? '▼' : '·'} {fmtPct(q?.pct) || 'no quote'}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <Card title="Every market we cover" color="var(--cyan)">
        {/* The claim the screen makes about itself, stated rather than implied by
            a grid of equally confident tiles. */}
        <div className="small muted" style={{ marginBottom: 10, lineHeight: 1.55 }}>{note}</div>
        {err && <div className="small" style={{ color: 'var(--yellow)', marginBottom: 10 }}>{err}</div>}

        <div className="gm-list">
          {/* Rows are divs, not buttons. Drilling into a country needs somewhere
              to drill TO, and a row that looks clickable and does nothing is a
              worse first impression than one that plainly is not. */}
          {rows.map(r => (
            <div key={r.iso2} className="gm-row" title={`${r.indexName} — ${r.exchange}`}>
              <span className="gm-flag" aria-hidden="true">{r.flag}</span>
              <span className="gm-name">
                {r.name}
                {/* The index is named on every row. Without it, the percentage
                    reads as the whole market's move rather than one benchmark's. */}
                <span className="gm-idx">{r.indexName}</span>
              </span>

              <span className="gm-cap">
                {r.capText || <span className="muted">not reported</span>}
                {r.capText && (
                  <span className={`gm-year ${r.capAge.stale ? 'gm-year-old' : ''}`}>
                    {r.capAge.label}
                  </span>
                )}
              </span>

              <span className="gm-pct" style={{ color: DIR[r.dir] }}>
                {r.pctText
                  ? `${r.dir > 0 ? '▲' : r.dir < 0 ? '▼' : '·'} ${r.pctText}`
                  : <span className="muted">{busy ? '…' : 'no quote'}</span>}
                {r.quoteState === 'cached' && r.pctText && <span className="gm-closed">closed</span>}
              </span>
            </div>
          ))}
        </div>

        <div className="small muted mt" style={{ lineHeight: 1.55 }}>
          Sizes are the World Bank's annual total for listed domestic companies,
          sourced from the World Federation of Exchanges — the year is on each row.
          Percentages are today's move in the named index, which is a different
          measurement and a different moment.
        </div>
      </Card>
    </>
  );
}
