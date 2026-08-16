import React, { useEffect, useRef, useState } from 'react';
import { Card } from '../ui.jsx';
import { getConfig } from '../../lib/db.js';
import { searchUrl, parseSearch, rankResults, searchable, MIN_QUERY } from '../../lib/globalmarkets.js';

// Search a stock, anywhere.
//
// Two constraints shape this more than the layout does.
//
// The free tier allows eight requests a minute, and a search box that fires per
// keystroke spends that in one word. So: debounced, a minimum query length, and
// an in-memory cache of queries already asked — retyping a search you just ran
// must not cost a request.
//
// And the EXCHANGE is not decoration. AAPL is listed on a dozen venues at
// different prices in different currencies on different sessions. A result list
// that omits the venue looks tidier and is actively misleading, so every row
// carries exchange, country and currency even when that makes the row busy.

const DEBOUNCE_MS = 400;
const cache = new Map();   // query -> rows, for the life of the page

export default function GlobalSearch({ onPick }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const timer = useRef(null);
  const key = (getConfig().twelveKey || '').trim();

  useEffect(() => {
    clearTimeout(timer.current);
    const query = q.trim();

    if (!searchable(query)) { setRows(null); setErr(''); setBusy(false); return; }
    if (cache.has(query)) { setRows(cache.get(query)); setErr(''); setBusy(false); return; }
    if (!key) { setErr('Add a Twelve Data key in Settings to search.'); return; }

    setBusy(true);
    timer.current = setTimeout(async () => {
      try {
        const r = await fetch(searchUrl(query, key));
        const parsed = rankResults(parseSearch(await r.json()), query);
        cache.set(query, parsed);
        setRows(parsed);
        setErr('');
      } catch (e) {
        // Named rather than swallowed. An empty result list and a failed request
        // look identical on screen, and only one of them means "no such ticker".
        setErr(String(e.message || e));
        setRows(null);
      } finally {
        setBusy(false);
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer.current);
  }, [q, key]);

  return (
    <Card title="Search any market" color="var(--purple)">
      <input
        className="gs-input"
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder="Ticker or company — NVDA, RELIANCE, 2330, 005930…"
        autoComplete="off"
        spellCheck="false"
      />

      <div className="small muted mt">
        US, India, Taiwan, Korea, Japan, Europe — whatever Twelve Data lists.
        Every result names its exchange, because the same ticker trades on several
        and they are not the same thing to buy.
      </div>

      {err && <div className="small mt" style={{ color: 'var(--yellow)' }}>{err}</div>}
      {busy && <div className="small muted mt">searching…</div>}

      {rows && rows.length === 0 && !busy && (
        <div className="small muted mt">Nothing matched “{q.trim()}”.</div>
      )}

      {rows && rows.length > 0 && (
        <div className="gs-list mt">
          {rows.slice(0, 25).map(r => (
            <button
              key={`${r.symbol}|${r.exchange}`}
              className="gs-row"
              onClick={() => onPick?.(r)}
            >
              <span className="gs-sym">{r.symbol}</span>
              <span className="gs-name">{r.name || '—'}</span>
              <span className="gs-venue">
                {r.exchange || '—'}
                <span className="gs-country">{[r.country, r.currency].filter(Boolean).join(' · ')}</span>
              </span>
            </button>
          ))}
          {rows.length > 25 && (
            // Said out loud. A silently truncated list reads as "that is all
            // there is", and here that would mean a listing you own is missing.
            <div className="small muted mt">
              Showing 25 of {rows.length} — narrow the search to see the rest.
            </div>
          )}
        </div>
      )}

      {!rows && !busy && !err && (
        <div className="small muted mt">
          Type at least {MIN_QUERY} characters.
        </div>
      )}
    </Card>
  );
}
