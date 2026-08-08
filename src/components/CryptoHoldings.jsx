import React, { useEffect, useMemo, useState } from 'react';
import { Card, Empty, money } from './ui.jsx';
import { useCollection } from '../lib/hooks.js';
import { fetchCryptoPrices } from '../lib/advisor.js';
import * as db from '../lib/db.js';
import { addLot, dedupeBook, bookRows, bookTotals, normaliseSymbol } from '../lib/cryptobook.js';

// Crypto side of the holdings split. Stored in memory.crypto_holdings (no schema
// change needed); live USD prices from CoinGecko (free, keyless), 60s refresh.
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));

export default function CryptoHoldings({ visible }) {
  const { items: mem, refresh } = useCollection('memory', { filter: 'key=eq.crypto_holdings', order: 'key' });
  const stored = mem?.[0]?.value?.list || [];
  // Books written by the old append-only path contain duplicate rows for the
  // same coin - adding BTC twice made two BTC. They are folded on read rather
  // than requiring a manual clean-up, and the fold is reported so the screen
  // can offer to save it back.
  const folded = useMemo(() => dedupeBook(stored), [mem]);   // eslint-disable-line
  const list = folded.list;
  const [form, setForm] = useState({ sym: '', qty: '', avg: '' });
  const [prices, setPrices] = useState({});
  const [busy, setBusy] = useState(false);

  const symKey = list.map(c => c.sym).join(',');
  useEffect(() => {
    if (!symKey) return;
    let dead = false;
    const load = () => fetchCryptoPrices(symKey.split(',')).then(p => { if (!dead) setPrices(p); });
    load();
    const t = setInterval(load, 60000);
    return () => { dead = true; clearInterval(t); };
  }, [symKey]);

  const save = async next => {
    setBusy(true);
    try { await db.upsertMemory('crypto_holdings', { list: next, updated: new Date().toISOString() }); await refresh(); } catch {}
    setBusy(false);
  };
  const [notice, setNotice] = useState(null);

  const addCoin = async () => {
    // addLot merges into an existing coin rather than appending, and blends the
    // cost basis by quantity. Appending was the bug: two BTC rows with two
    // separate bases, drawn as two different coins.
    const r = addLot(list, { sym: form.sym, qty: form.qty, avg: form.avg }, uid);
    if (!r.added) { setNotice(r.reason); return; }
    await save(r.list);
    setNotice(r.merged
      ? (r.reason || `Merged into your existing ${normaliseSymbol(form.sym)} position — quantities added, cost basis averaged.`)
      : null);
    setForm({ sym: '', qty: '', avg: '' });
  };

  const rows = useMemo(() => bookRows(list, prices), [list, prices]);
  const tot = useMemo(() => bookTotals(rows), [rows]);
  const totalV = tot.value;
  const totPnl = tot.pnl;

  return (
    <Card title="Holdings — crypto" color="var(--orange)"
      right={rows.length > 0 && (
        <span className="flex" style={{ gap: 6 }}>
          <span className="chip c-orange">{money(totalV, visible)}</span>
          {totPnl != null && <span className="chip" style={{ color: totPnl >= 0 ? 'var(--green)' : 'var(--red)', borderColor: totPnl >= 0 ? 'var(--green)' : 'var(--red)' }}>{totPnl >= 0 ? '▲' : '▼'} {money(Math.abs(totPnl), visible)}</span>}
        </span>
      )}>
      {notice && <p className="cb-notice">{notice}</p>}
      {folded.merges > 0 && (
        <p className="cb-notice">
          {folded.merges} duplicate row{folded.merges === 1 ? '' : 's'} folded into
          the coin{folded.merges === 1 ? '' : 's'} above — the same coin added twice
          used to become two positions. Quantities are summed and cost bases
          averaged by quantity. Add or remove anything to save the tidy version.
        </p>
      )}
      {tot.missingCost.length > 0 && (
        <p className="cb-notice cb-dim">
          No cost recorded for {tot.missingCost.join(', ')} — those positions are in
          the value but not in the return, rather than being counted as free.
        </p>
      )}
      {rows.length === 0 && <Empty icon="₿" text="No crypto yet — when you start, add coins here (BTC, ETH, SOL… live prices, no key needed)." />}
      {rows.length > 0 && (
        <div className="scroll-x">
          <table className="ptable">
            <thead><tr><th>Coin</th><th>Qty</th><th>Avg</th><th>Price</th><th>24h</th><th>Value</th><th>P&L</th><th /></tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td><b style={{ fontWeight: 'normal', color: 'var(--orange)' }}>{r.sym}</b></td>
                  <td>{r.qty}</td>
                  <td>{r.avg != null ? money(r.avg, visible) : <span className="muted">not set</span>}</td>
                  <td>{r.price != null ? '$' + (r.price >= 100 ? r.price.toFixed(0) : r.price.toFixed(4)) : '…'}</td>
                  <td style={{ color: r.dayPct == null ? undefined : r.dayPct >= 0 ? 'var(--green)' : 'var(--red)' }}>{r.dayPct == null ? '—' : `${r.dayPct >= 0 ? '+' : ''}${r.dayPct.toFixed(2)}%`}</td>
                  <td>
                    {r.value != null ? money(r.value, visible) : '—'}
                    {/* Same reading the stock book gets: the currency figure and
                        its share of the book, so one column answers both. */}
                    {r.weight != null && <i className="hold-sub">{r.weight.toFixed(1)}% of crypto</i>}
                  </td>
                  <td style={{ color: r.pnl == null ? undefined : r.pnl >= 0 ? 'var(--green)' : 'var(--red)' }}>
                    {r.pnl != null ? money(r.pnl, visible) : '—'}
                    {r.pnlPct != null && <i className="hold-sub">{r.pnlPct >= 0 ? '+' : ''}{r.pnlPct.toFixed(1)}%</i>}
                  </td>
                  <td><button className="btn btn-sm" disabled={busy} onClick={() => save(list.filter(c => c.id !== r.id))}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex mt" style={{ flexWrap: 'wrap' }}>
        <input style={{ width: 90 }} placeholder="BTC" value={form.sym} onChange={e => setForm({ ...form, sym: e.target.value })} />
        <input style={{ width: 100 }} type="number" placeholder="Qty" value={form.qty} onChange={e => setForm({ ...form, qty: e.target.value })} />
        <input style={{ width: 120 }} type="number" placeholder="Avg cost $" value={form.avg} onChange={e => setForm({ ...form, avg: e.target.value })} />
        <button className="btn btn-sm btn-green" disabled={busy} onClick={addCoin}>+ Add</button>
      </div>
    </Card>
  );
}
