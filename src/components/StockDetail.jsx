import React from 'react';
import { money } from './ui.jsx';

// TradingView symbol quirks
function tvSymbol(ticker) {
  const NYSE = ['BRK.B', 'V', 'MA', 'CRM', 'TSM', 'NET', 'SCHD', 'VOO', 'SPMO', 'GLD'];
  const t = ticker;
  if (t === 'BRK.B') return 'NYSE:BRK.B';
  if (NYSE.includes(t)) return `AMEX:${t}`; // most ETFs list on AMEX; TV still resolves
  return t; // TV auto-resolves bare tickers for NASDAQ names
}

export default function StockDetail({ holding, orders, visible, onClose }) {
  if (!holding) return null;
  const qty = Number(holding.qty);
  const px = Number(holding.last_price || holding.avg_cost || 0);
  const avg = Number(holding.avg_cost || 0);
  const value = qty * px;
  const cost = qty * avg;
  const pnl = value - cost;
  const pnlPct = cost ? (pnl / cost) * 100 : 0;
  const mine = (orders || []).filter(o => o.ticker === holding.ticker);
  const buys = mine.filter(o => o.side === 'B');
  const sells = mine.filter(o => o.side === 'S');

  const tv = `https://s.tradingview.com/widgetembed/?frameElementId=tv_${holding.ticker}&symbol=${encodeURIComponent(tvSymbol(holding.ticker))}&interval=D&hidesidetoolbar=1&symboledit=0&saveimage=0&toolbarbg=17101f&theme=dark&style=1&timezone=Asia/Kolkata&withdateranges=1`;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="px modal-panel" onClick={e => e.stopPropagation()}>
        <div className="spread" style={{ marginBottom: 12 }}>
          <div>
            <div className="card-title" style={{ margin: 0 }}>
              <span className="sq" style={{ background: 'var(--cyan)' }} />
              {holding.ticker}
            </div>
            <div className="muted small">{holding.name}</div>
          </div>
          <button className="btn btn-sm btn-pink" onClick={onClose}>✕ close</button>
        </div>

        <div className="tile-row" style={{ marginBottom: 12 }}>
          <div className="px stat-tile"><div className="stat-label">Last price</div><div className="stat-value">{px ? '$' + px.toFixed(2) : '—'}</div></div>
          <div className="px stat-tile"><div className="stat-label">Qty</div><div className="stat-value" style={{ fontSize: 15 }}>{qty.toFixed(4)}</div></div>
          <div className="px stat-tile"><div className="stat-label">Avg cost</div><div className="stat-value" style={{ fontSize: 15 }}>{money(avg, visible)}</div></div>
          <div className="px stat-tile"><div className="stat-label">Value</div><div className="stat-value" style={{ fontSize: 15 }}>{money(value, visible)}</div></div>
          <div className="px stat-tile"><div className="stat-label">P&L</div>
            <div className="stat-value" style={{ fontSize: 15, color: pnl >= 0 ? 'var(--green)' : 'var(--red)' }}>{money(pnl, visible)}</div>
            <div className="stat-note" style={{ color: pnl >= 0 ? 'var(--green)' : 'var(--red)' }}>{pnlPct >= 0 ? '▲' : '▼'} {Math.abs(pnlPct).toFixed(2)}%</div>
          </div>
        </div>

        <div className="chart-wrap px">
          <iframe title={`${holding.ticker} chart`} src={tv} style={{ width: '100%', height: 320, border: 'none' }} loading="lazy" />
        </div>

        <div className="card-title mt"><span className="sq" style={{ background: 'var(--purple)' }} />
          Order history · {mine.length} orders ({buys.length} buys{sells.length ? `, ${sells.length} sells` : ''})
        </div>
        <div className="scroll-x" style={{ maxHeight: 260, overflowY: 'auto' }}>
          <table className="ptable">
            <thead><tr><th>Date</th><th>Side</th><th>Qty</th><th>Price</th><th>Value</th></tr></thead>
            <tbody>
              {mine.map((o, i) => (
                <tr key={i}>
                  <td>{o.date}</td>
                  <td><span className={`chip ${o.side === 'B' ? 'c-green' : 'c-red'}`}>{o.side === 'B' ? 'BUY' : 'SELL'}</span></td>
                  <td>{Number(o.qty).toFixed(4)}</td>
                  <td>${Number(o.price).toFixed(2)}</td>
                  <td>{money(o.value, visible)}</td>
                </tr>
              ))}
              {mine.length === 0 && <tr><td colSpan={5} className="muted">No stored orders for this ticker.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
