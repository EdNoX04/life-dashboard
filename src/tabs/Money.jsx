import React, { useState } from 'react';
import { useCollection } from '../lib/hooks.js';
import { Card, Empty, StatTile, RefreshButton, EyeBtn, useMoneyVisible, money } from '../components/ui.jsx';

export default function Money() {
  const { items, add, patch, del, refresh } = useCollection('investments', { order: 'ticker', asc: true });
  const { items: news } = useCollection('news', { order: 'published_at' });
  const [form, setForm] = useState({ ticker: '', qty: '', avg_cost: '' });
  const [visible, toggle] = useMoneyVisible();

  const held = items.filter(h => Number(h.qty) > 0);
  const value = held.reduce((s, h) => s + (Number(h.qty) * Number(h.last_price || h.avg_cost || 0)), 0);
  const cost = held.reduce((s, h) => s + (Number(h.qty) * Number(h.avg_cost || 0)), 0);
  const pnl = value - cost;
  const pnlPct = cost ? (pnl / cost) * 100 : 0;
  const stockNews = news.filter(n => n.category === 'stocks').slice(0, 5);

  async function addHolding() {
    if (!form.ticker.trim() || !form.qty) return;
    await add({ ticker: form.ticker.trim().toUpperCase(), qty: Number(form.qty), avg_cost: Number(form.avg_cost) || null, last_price: null, currency: 'USD', source: 'manual' });
    setForm({ ticker: '', qty: '', avg_cost: '' });
  }

  const pctChip = p => (
    <span className="chip" style={{ color: p >= 0 ? 'var(--green)' : 'var(--red)', borderColor: p >= 0 ? 'var(--green)' : 'var(--red)' }}>
      {p >= 0 ? '▲' : '▼'} {Math.abs(p).toFixed(2)}%
    </span>
  );

  return (
    <>
      <div className="spread">
        <h1 className="tab-title">MONEY</h1>
        <span className="flex">
          <EyeBtn visible={visible} onClick={toggle} />
          <RefreshButton source="investments" onLocalRefresh={refresh} label="Prices" />
        </span>
      </div>
      <p className="tab-sub">US stocks (INDmoney) — holdings snapshot + live public prices.</p>

      <div className="tile-row">
        <StatTile label="Portfolio value" value={money(value, visible)} note={pctChip(pnlPct)} color="var(--green)" />
        <StatTile label="Invested" value={money(cost, visible)} color="var(--cyan)" />
        <StatTile label="Total P&L" value={money(pnl, visible)} note={pctChip(pnlPct)} color={pnl >= 0 ? 'var(--green)' : 'var(--red)'} />
        <StatTile label="Holdings" value={held.length} color="var(--pink)" />
      </div>

      <Card title="Holdings" color="var(--green)">
        {held.length === 0 && <Empty icon="$" text="No holdings yet — snapshot from INDmoney or add manually below." />}
        {held.length > 0 && (
          <div className="scroll-x">
            <table className="ptable">
              <thead><tr><th>Ticker</th><th>Qty</th><th>Avg</th><th>Last</th><th>Value</th><th>P&L</th><th /></tr></thead>
              <tbody>
                {held.map(h => {
                  const v = Number(h.qty) * Number(h.last_price || h.avg_cost || 0);
                  const c = Number(h.qty) * Number(h.avg_cost || 0);
                  const p = h.avg_cost ? v - c : null;
                  const pp = c ? (p / c) * 100 : 0;
                  return (
                    <tr key={h.id}>
                      <td><b style={{ fontWeight: 'normal', color: 'var(--cyan)' }}>{h.ticker}</b></td>
                      <td>{Number(h.qty).toFixed(4)}</td>
                      <td>{money(h.avg_cost, visible)}</td>
                      <td>{h.last_price ? '$' + Number(h.last_price).toFixed(2) : '—'}</td>
                      <td>{money(v, visible)}</td>
                      <td style={{ color: p == null ? undefined : p >= 0 ? 'var(--green)' : 'var(--red)' }}>
                        {money(p, visible)} {h.avg_cost ? <span className="small">({pp >= 0 ? '+' : ''}{pp.toFixed(1)}%)</span> : ''}
                      </td>
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
          Read-only. INDmoney has no trading API — Cowork snapshots your holdings from order history; place trades yourself in the app.
        </div>
      </Card>
    </>
  );
}
