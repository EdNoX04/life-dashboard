import React, { useEffect, useMemo, useState } from 'react';
import { Card, Empty, money } from './ui.jsx';
import { useCollection } from '../lib/hooks.js';
import { fetchCryptoPrices } from '../lib/advisor.js';
import * as db from '../lib/db.js';

// Crypto side of the holdings split. Stored in memory.crypto_holdings (no schema
// change needed); live USD prices from CoinGecko (free, keyless), 60s refresh.
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));

export default function CryptoHoldings({ visible }) {
  const { items: mem, refresh } = useCollection('memory', { filter: 'key=eq.crypto_holdings', order: 'key' });
  const list = mem?.[0]?.value?.list || [];
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
  const addCoin = async () => {
    const sym = form.sym.trim().toUpperCase();
    if (!sym || !Number(form.qty)) return;
    await save([...list, { id: uid(), sym, qty: Number(form.qty), avg: Number(form.avg) || null }]);
    setForm({ sym: '', qty: '', avg: '' });
  };

  const rows = useMemo(() => list.map(c => {
    const q = prices[c.sym];
    const px = q?.price ?? null;
    const v = px != null ? c.qty * px : null;
    const cost = c.avg != null ? c.qty * c.avg : null;
    const pnl = v != null && cost != null ? v - cost : null;
    return { ...c, px, v, cost, pnl, dp: q?.changePct ?? null };
  }), [list, prices]);
  const totalV = rows.reduce((s, r) => s + (r.v || 0), 0);
  const totalC = rows.reduce((s, r) => s + (r.cost || 0), 0);
  const totPnl = totalV - totalC;

  return (
    <Card title="Holdings — crypto" color="var(--orange)"
      right={rows.length > 0 && (
        <span className="flex" style={{ gap: 6 }}>
          <span className="chip c-orange">{money(totalV, visible)}</span>
          {totalC > 0 && <span className="chip" style={{ color: totPnl >= 0 ? 'var(--green)' : 'var(--red)', borderColor: totPnl >= 0 ? 'var(--green)' : 'var(--red)' }}>{totPnl >= 0 ? '▲' : '▼'} {money(Math.abs(totPnl), visible)}</span>}
        </span>
      )}>
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
                  <td>{r.avg != null ? money(r.avg, visible) : '—'}</td>
                  <td>{r.px != null ? '$' + (r.px >= 100 ? r.px.toFixed(0) : r.px.toFixed(4)) : '…'}</td>
                  <td style={{ color: r.dp == null ? undefined : r.dp >= 0 ? 'var(--green)' : 'var(--red)' }}>{r.dp == null ? '—' : `${r.dp >= 0 ? '+' : ''}${r.dp.toFixed(2)}%`}</td>
                  <td>{r.v != null ? money(r.v, visible) : '—'}</td>
                  <td style={{ color: r.pnl == null ? undefined : r.pnl >= 0 ? 'var(--green)' : 'var(--red)' }}>{r.pnl != null ? money(r.pnl, visible) : '—'}</td>
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
