import React, { useEffect, useState } from 'react';
import { money } from './ui.jsx';
import RetroChart from './RetroChart.jsx';
import { useLiveQuotes, usMarketState } from '../lib/live.js';
import { pickProvider } from '../lib/ai.js';
import { fetchRecommendations, aiStockNote, memGet } from '../lib/advisor.js';

// Wall Street analyst consensus as a 3-part retro bar: BUY / HOLD / SELL
function StreetBar({ rec }) {
  if (!rec) return null;
  const pct = n => Math.round((n / rec.total) * 100);
  const segs = [
    ['BUY', rec.buy, 'var(--green)'], ['HOLD', rec.hold, 'var(--yellow)'], ['SELL', rec.sell, 'var(--red)'],
  ].filter(s => s[1] > 0);
  return (
    <div>
      <div className="street-bar">
        {segs.map(([k, n, c]) => (
          <div key={k} className="street-seg" style={{ width: pct(n) + '%', '--sc': c }} title={`${k}: ${n} analysts`}>
            {pct(n) >= 14 && <span>{k} {pct(n)}%</span>}
          </div>
        ))}
      </div>
      <div className="small muted" style={{ marginTop: 4 }}>{rec.total} Wall Street analysts · {rec.period}</div>
    </div>
  );
}

// TradingView symbol quirks
function tvSymbol(ticker) {
  const NYSE = ['BRK.B', 'V', 'MA', 'CRM', 'TSM', 'NET', 'SCHD', 'VOO', 'SPMO', 'GLD'];
  const t = ticker;
  if (t === 'BRK.B') return 'NYSE:BRK.B';
  if (NYSE.includes(t)) return `AMEX:${t}`; // most ETFs list on AMEX; TV still resolves
  return t; // TV auto-resolves bare tickers for NASDAQ names
}

export default function StockDetail({ holding, orders, visible, onClose }) {
  const [mode, setMode] = useState('retro'); // default retro; toggle to tradingview
  const { quotes } = useLiveQuotes(holding ? [holding.ticker] : []);
  const [rec, setRec] = useState(null);
  const [note, setNote] = useState(null);
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteErr, setNoteErr] = useState('');
  const provider = pickProvider();
  const ticker = holding?.ticker;

  // Street consensus + cached AI note load on open; AI auto-refreshes if stale (24h)
  useEffect(() => {
    if (!ticker) return;
    let dead = false;
    setRec(null); setNote(null); setNoteErr('');
    fetchRecommendations(ticker).then(r => { if (!dead) setRec(r); });
    memGet('ai_stock_notes').then(all => { if (!dead && all?.[ticker]) setNote(all[ticker]); });
    return () => { dead = true; };
  }, [ticker]);

  async function runNote(force) {
    if (!holding || !provider) return;
    setNoteBusy(true); setNoteErr('');
    try {
      const px = Number(quotes[holding.ticker]?.price ?? holding.last_price ?? holding.avg_cost ?? 0);
      setNote(await aiStockNote(holding, px, quotes[holding.ticker]?.changePct, { force }));
    } catch (e) { setNoteErr(String(e.message || e)); }
    setNoteBusy(false);
  }

  if (!holding) return null;

  const q = quotes[holding.ticker];
  const live = q?.price ?? null;
  const marketOpen = usMarketState() === 'open';
  const qty = Number(holding.qty);
  const px = Number(live || holding.last_price || holding.avg_cost || 0);
  const avg = Number(holding.avg_cost || 0);
  const value = qty * px;
  const cost = qty * avg;
  const pnl = value - cost;
  const pnlPct = cost ? (pnl / cost) * 100 : 0;
  const dayChg = q?.change != null ? q.change * qty : null;
  const dayPct = q?.changePct;
  const mine = (orders || []).filter(o => o.ticker === holding.ticker);
  const buys = mine.filter(o => o.side === 'B');
  const sells = mine.filter(o => o.side === 'S');

  const tv = `https://s.tradingview.com/widgetembed/?frameElementId=tv_${holding.ticker}&symbol=${encodeURIComponent(tvSymbol(holding.ticker))}&interval=D&hidesidetoolbar=1&symboledit=0&saveimage=0&toolbarbg=17101f&theme=dark&style=1&timezone=Asia/Kolkata&withdateranges=1`;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="px modal-panel modal-wide" onClick={e => e.stopPropagation()}>
        <div className="spread" style={{ marginBottom: 12 }}>
          <div>
            <div className="card-title" style={{ margin: 0 }}>
              <span className="sq" style={{ background: 'var(--cyan)' }} />
              {holding.ticker}
              {q && marketOpen && <span className="rc-live" style={{ marginLeft: 8 }}><span className="rc-dot" />LIVE</span>}
            </div>
            <div className="muted small">{holding.name}</div>
          </div>
          <button className="btn btn-sm btn-pink" onClick={onClose}>✕ close</button>
        </div>

        <div className="tile-row" style={{ marginBottom: 12 }}>
          <div className="px stat-tile"><div className="stat-label">Last price</div><div className="stat-value">{px ? '$' + px.toFixed(2) : '—'}</div>
            {dayPct != null && <div className="stat-note" style={{ color: dayPct >= 0 ? 'var(--green)' : 'var(--red)' }}>{dayPct >= 0 ? '▲' : '▼'} {Math.abs(dayPct).toFixed(2)}% today</div>}
          </div>
          <div className="px stat-tile"><div className="stat-label">Qty</div><div className="stat-value" style={{ fontSize: 15 }}>{qty.toFixed(4)}</div></div>
          <div className="px stat-tile"><div className="stat-label">Avg cost</div><div className="stat-value" style={{ fontSize: 15 }}>{money(avg, visible)}</div></div>
          <div className="px stat-tile"><div className="stat-label">Value</div><div className="stat-value" style={{ fontSize: 15 }}>{money(value, visible)}</div>
            {dayChg != null && <div className="stat-note" style={{ color: dayChg >= 0 ? 'var(--green)' : 'var(--red)' }}>{dayChg >= 0 ? '+' : ''}{money(Math.abs(dayChg), visible).replace('$', dayChg < 0 ? '-$' : '$')} today</div>}
          </div>
          <div className="px stat-tile"><div className="stat-label">Total P&L</div>
            <div className="stat-value" style={{ fontSize: 15, color: pnl >= 0 ? 'var(--green)' : 'var(--red)' }}>{money(pnl, visible)}</div>
            <div className="stat-note" style={{ color: pnl >= 0 ? 'var(--green)' : 'var(--red)' }}>{pnlPct >= 0 ? '▲' : '▼'} {Math.abs(pnlPct).toFixed(2)}%</div>
          </div>
        </div>

        <div className="spread" style={{ marginBottom: 8 }}>
          <div className="card-title" style={{ margin: 0 }}><span className="sq" style={{ background: 'var(--purple)' }} />Chart</div>
          <div className="seg">
            <button className={`seg-btn${mode === 'retro' ? ' on' : ''}`} onClick={() => setMode('retro')}>Retro</button>
            <button className={`seg-btn${mode === 'tradingview' ? ' on' : ''}`} onClick={() => setMode('tradingview')}>TradingView</button>
          </div>
        </div>

        {mode === 'retro'
          ? <RetroChart ticker={holding.ticker} live={live} marketOpen={marketOpen} defaultTf="1D" />
          : (
            <div className="chart-wrap px">
              <iframe title={`${holding.ticker} chart`} src={tv} style={{ width: '100%', height: 340, border: 'none' }} loading="lazy" />
            </div>
          )}

        {/* Street + AI verdict */}
        <div className="card-title mt"><span className="sq" style={{ background: 'var(--yellow)' }} />Street & AI verdict</div>
        {rec
          ? <StreetBar rec={rec} />
          : <div className="small muted">Wall Street consensus loads with a Finnhub key… (or none published for this ticker)</div>}

        <div className="ai-note mt">
          {!provider && <div className="small muted">Add an AI key in Config → the AI verdict + quick analysis appears here.</div>}
          {provider && !note && !noteBusy && (
            <button className="btn btn-sm btn-pink" onClick={() => runNote(false)}>✦ AI analysis</button>
          )}
          {noteBusy && <div className="small muted">AI reading {holding.ticker}…</div>}
          {noteErr && <div className="small" style={{ color: 'var(--red)' }}>{noteErr}</div>}
          {note && (
            <>
              <div className="flex" style={{ gap: 8, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
                <span className={`chip ${note.verdict === 'BUY' ? 'c-green' : note.verdict === 'SELL' ? 'c-red' : 'c-yellow'}`} style={{ fontSize: 13 }}>AI: {note.verdict}</span>
                {note.confidence != null && <span className="chip">{note.confidence}% sure</span>}
                <button className="btn btn-sm" onClick={() => runNote(true)} disabled={noteBusy}>↻</button>
              </div>
              <div style={{ lineHeight: 1.55 }}>{note.analysis}</div>
              {note.risk && <div className="small mt" style={{ color: 'var(--orange)' }}>⚠ {note.risk}</div>}
            </>
          )}
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
