import React, { useState } from 'react';
import { useCollection } from '../lib/hooks.js';
import { Card, Empty, StatTile, RefreshButton } from '../components/ui.jsx';

const fmt = (n, cur = '$') => n == null ? '—' : cur + Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });

export default function Money() {
  const { items, add, patch, del, refresh } = useCollection('investments', { order: 'ticker', asc: true });
  const { items: news } = useCollection('news', { order: 'published_at' });
  const [form, setForm] = useState({ ticker: '', qty: '', avg_cost: '' });

  const value = items.reduce((s, h) => s + (Number(h.qty) * Number(h.last_price || h.avg_cost || 0)), 0);
  const cost = items.reduce((s, h) => s + (Number(h.qty) * Number(h.avg_cost || 0)), 0);
  const pnl = value - cost;
  const stockNews = news.filter(n => n.category === 'stocks').slice(0, 5);

  async function addHolding() {
    if (!form.ticker.trim() || !form.qty) return;
    await add({
      ticker: form.ticker.trim().toUpperCase(),
      qty: Number(form.qty),
      avg_cost: Number(form.avg_cost) || null,
      last_price: null, currency: 'USD', source: 'manual',
    });
    setForm({ ticker: '', qty: '', avg_cost: '' });
  }

  return (
    <>
      <div className="spread">
        <h1 className="tab-title">MONEY</h1>
        <RefreshButton source="investments" onLocalRefresh={refresh} label="Refresh prices" />
      </div>
      <p className="tab-sub">US stocks (INDmoney) — snapshot by Cowork, prices kept live.</p>

      <div className="tile-row">
        <StatTile label="Portfolio value" value={fmt(value)} color="var(--green)" />
        <StatTile label="Invested" value={fmt(cost)} color="var(--cyan)" />
        <StatTile label="P&L" value={fmt(pnl)}
          note={cost ? `${((pnl / cost) * 100).toFixed(1)}%` : ''}
          color={pnl >= 0 ? 'var(--green)' : 'var(--red)'} />
        <StatTile label="Holdings" value={items.length} color="var(--pink)" />
      </div>

      <Card title="Holdings" color="var(--green)">
        {items.length === 0 && <Empty icon="$" text="No holdings yet — add manually below, or wait for the INDmoney sync." />}
        {items.length > 0 && (
          <div className="scroll-x">
            <table className="ptable">
              <thead><tr><th>Ticker</th><th>Qty</th><th>Avg cost</th><th>Last</th><th>Value</th><th>P&L</th><th /></tr></thead>
              <tbody>
                {items.map(h => {
                  const v = Number(h.qty) * Number(h.last_price || h.avg_cost || 0);
                  const p = h.avg_cost ? v - Number(h.qty) * Number(h.avg_cost) : null;
                  return (
                    <tr key={h.id}>
                      <td><b style={{ fontWeight: 'normal', color: 'var(--cyan)' }}>{h.ticker}</b></td>
                      <td>{h.qty}</td><td>{fmt(h.avg_cost)}</td><td>{fmt(h.last_price)}</td><td>{fmt(v)}</td>
                      <td style={{ color: p == null ? undefined : p >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmt(p)}</td>
                      <td><button className="btn btn-sm" onClick={() => del(h.id)}>✕</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex mt" style={{ flexWrap: 'wrap' }}>
          <input style={{ width: 110 }} placeholder="Ticker" value={form.ticker} onChange={e => setForm({ ...form, ticker: e.target.value })} />
          <input style={{ width: 90 }} type="number" placeholder="Qty" value={form.qty} onChange={e => setForm({ ...form, qty: e.target.value })} />
          <input style={{ width: 110 }} type="number" placeholder="Avg cost" value={form.avg_cost} onChange={e => setForm({ ...form, avg_cost: e.target.value })} />
          <button className="btn btn-sm btn-green" onClick={addHolding}>+ Add</button>
        </div>
      </Card>

      <Card title="Your stocks in the news" color="var(--pink)">
        {stockNews.length === 0 && <Empty icon="※" text="Cowork drops headlines about your holdings here." />}
        {stockNews.map(n => (
          <div className="row" key={n.id} style={{ alignItems: 'flex-start' }}>
            <span style={{ flex: 1 }}>
              <a href={n.url} target="_blank" rel="noreferrer" style={{ color: 'var(--ink)' }}>{n.title}</a>
              {n.summary && <div className="small muted">{n.summary}</div>}
            </span>
            <span className="chip c-cyan">{n.source}</span>
          </div>
        ))}
      </Card>

      <Card title="Note on orders" color="var(--yellow)">
        <div className="small" style={{ color: 'var(--ink-2)' }}>
          INDmoney has no public trading API — orders can't be placed from here safely.
          Cowork preps the trade idea (ticker, qty, reasoning) in your morning brief; you execute in the app in two taps.
        </div>
      </Card>
    </>
  );
}
