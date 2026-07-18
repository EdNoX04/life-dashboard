import React, { useEffect, useMemo, useState } from 'react';
import { useCollection } from '../lib/hooks.js';
import { Card, Empty, StatTile, EyeBtn, useMoneyVisible, money } from '../components/ui.jsx';
import StockDetail from '../components/StockDetail.jsx';
import PortfolioChart from '../components/PortfolioChart.jsx';
import CryptoHoldings from '../components/CryptoHoldings.jsx';
import { PortfolioAdvisor, NextBuyDesk } from '../components/MoneyAI.jsx';
import { useLiveQuotes, usMarketState } from '../lib/live.js';
import { fetchHoldingsNews } from '../lib/news.js';
import { buildDailySeries, buildIntradaySeries, loadPriceHistory, refreshPriceHistory } from '../lib/portfolioHistory.js';
import { aiNewsSummary, memGet } from '../lib/advisor.js';
import { pickProvider } from '../lib/ai.js';
import * as db from '../lib/db.js';

const STOP = new Set(['inc', 'inc.', 'corp', 'corp.', 'corporation', 'ltd', 'ltd.', 'co', 'co.', 'company', 'holdings', 'group', 'the', 'and', 'plc', 'etf', 'trust', 'index', 'fund', 'class', 'common', 'stock', 'nv', 'sa', 'ag']);
// company-name keywords used to match news to a holding
const nameKeys = name => String(name || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 3 && !STOP.has(w));

// Retro P&L backdrop: a jagged market line scrolling on the card's right edge,
// tinted red (falling) or green (rising), fading into the panel on the left.
function DayFx({ up }) {
  // tileable jagged path (starts/ends same y) drawn twice for a seamless loop
  const seg = up
    ? 'M0 44 L20 36 L34 41 L52 26 L66 33 L84 18 L102 27 L118 12 L134 21 L152 8 L170 16 L188 6 L200 44'
    : 'M0 12 L20 20 L34 15 L52 30 L66 23 L84 38 L102 29 L118 44 L134 35 L152 48 L170 40 L188 50 L200 12';
  const d = `${seg.replace(/L200 \d+$/, '')}`;
  const line = up
    ? 'M0 44 L20 36 L34 41 L52 26 L66 33 L84 18 L102 27 L118 12 L134 21 L152 8 L170 16 L200 12 L220 20 L234 15 L252 30 L266 23 L284 38 L302 29 L318 44 L334 35 L352 48 L370 40 L400 44'
    : 'M0 12 L20 20 L34 15 L52 30 L66 23 L84 38 L102 29 L118 44 L134 35 L152 48 L170 40 L200 44 L220 36 L234 41 L252 26 L266 33 L284 18 L302 27 L318 12 L334 21 L352 8 L370 16 L400 12';
  return (
    <div className={`daypl-fx ${up ? 'up' : 'down'}`} aria-hidden="true">
      <svg viewBox="0 0 400 56" preserveAspectRatio="none">
        <path className="daypl-line" d={line} fill="none" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
        <path className="daypl-line dim" d={line} fill="none" strokeWidth="2.5" vectorEffect="non-scaling-stroke" transform="translate(400 0)" />
      </svg>
    </div>
  );
}

export default function Money() {
  const { items, add, patch, del, refresh } = useCollection('investments', { order: 'ticker', asc: true });
  const { items: news } = useCollection('news', { order: 'published_at' });
  const [form, setForm] = useState({ ticker: '', qty: '', avg_cost: '' });
  const [visible, toggle] = useMoneyVisible();
  const [orders, setOrders] = useState([]);
  const [snapshots, setSnapshots] = useState([]);
  const [openStock, setOpenStock] = useState(null);
  const [sortBy, setSortBy] = useState('value');
  const [liveNews, setLiveNews] = useState([]);
  const [view, setView] = useState('portfolio'); // portfolio | nextbuy
  const [newsSum, setNewsSum] = useState(null);
  const [sumBusy, setSumBusy] = useState(false);
  const [priceHist, setPriceHist] = useState({ data: {} });
  const [intraday, setIntraday] = useState([]);
  const [histState, setHistState] = useState('idle'); // idle | loading | ready | nokey
  const histTried = React.useRef(false);

  useEffect(() => {
    db.list('memory', { filter: 'key=eq.stock_orders', order: 'key' })
      .then(rows => setOrders(rows?.[0]?.value?.orders || []))
      .catch(() => {});
    db.list('portfolio_snapshots', { order: 'date', asc: true })
      .then(rows => setSnapshots(rows || []))
      .catch(() => {});
  }, []);

  const held = items.filter(h => Number(h.qty) > 0);
  const { quotes, status } = useLiveQuotes(held.map(h => h.ticker));
  const marketOpen = usMarketState() === 'open';

  // live price for a holding: streamed quote → stored last_price → avg cost
  const priceOf = h => Number(quotes[h.ticker]?.price ?? h.last_price ?? h.avg_cost ?? 0);

  const value = held.reduce((s, h) => s + Number(h.qty) * priceOf(h), 0);
  const cost = held.reduce((s, h) => s + Number(h.qty) * Number(h.avg_cost || 0), 0);
  const pnl = value - cost;
  const pnlPct = cost ? (pnl / cost) * 100 : 0;

  // today's 1D gain/loss from live change vs prev close
  const { dayGain, dayBase } = held.reduce((a, h) => {
    const q = quotes[h.ticker];
    const qty = Number(h.qty);
    if (q?.change != null && q?.prevClose != null) { a.dayGain += qty * q.change; a.dayBase += qty * q.prevClose; }
    return a;
  }, { dayGain: 0, dayBase: 0 });
  const dayPct = dayBase ? (dayGain / dayBase) * 100 : 0;
  const haveLive = dayBase > 0;

  // ---- reconstructed value-over-time (orders × historical prices) ----
  const tickerKey = held.map(h => h.ticker).join(',');
  const histTickers = useMemo(() => held.map(h => String(h.ticker || '').toUpperCase()).filter(Boolean), [tickerKey]);
  const livePrices = useMemo(() => {
    const m = {}; held.forEach(h => { m[String(h.ticker).toUpperCase()] = priceOf(h); }); return m;
  }, [tickerKey, quotes]);
  const { invested: invSeries, value: valSeries } = useMemo(
    () => buildDailySeries(orders, histTickers, priceHist.data || {}, livePrices),
    [orders, histTickers, priceHist, livePrices]
  );

  // load cached daily closes; fetch missing/stale tickers in the background
  useEffect(() => {
    if (!orders.length || !histTickers.length || histTried.current) return;
    histTried.current = true;
    (async () => {
      const cache = await loadPriceHistory();
      setPriceHist(cache);
      const today = new Date().toISOString().slice(0, 10);
      const missing = histTickers.filter(t => !cache.data?.[t]);
      const stale = !cache.updated || cache.updated.slice(0, 10) !== today;
      if (missing.length || stale) {
        setHistState('loading');
        try { const fresh = await refreshPriceHistory(histTickers); setPriceHist(fresh); setHistState('ready'); }
        catch (e) { setHistState(String(e).includes('NO_KEY') ? 'nokey' : 'idle'); }
      } else setHistState('ready');
    })();
  }, [orders, histTickers]);

  // intraday (1D) value line — a few 5-min candle fetches, cached
  useEffect(() => {
    if (!histTickers.length) return;
    let alive = true;
    buildIntradaySeries(held).then(s => { if (alive) setIntraday(s); }).catch(() => {});
    return () => { alive = false; };
  }, [tickerKey]);

  // sortable holdings — default largest position first
  const SORTS = [
    ['value', 'Largest'], ['pnl', 'Most profit'], ['pnlpct', 'Best return'],
    ['day', "Today's gainers"], ['loss', 'Biggest loser'], ['ticker', 'A–Z'],
  ];
  const metricsOf = h => {
    const price = priceOf(h);
    const v = Number(h.qty) * price;
    const c = Number(h.qty) * Number(h.avg_cost || 0);
    const p = h.avg_cost ? v - c : 0;
    const pp = c ? (p / c) * 100 : 0;
    const dp = quotes[h.ticker]?.changePct;
    return { v, p, pp, dp };
  };
  const sortedHeld = useMemo(() => {
    const arr = [...held];
    const m = new Map(arr.map(h => [h.id, metricsOf(h)]));
    const g = h => m.get(h.id);
    arr.sort((a, b) => {
      switch (sortBy) {
        case 'pnl': return g(b).p - g(a).p;
        case 'pnlpct': return g(b).pp - g(a).pp;
        case 'day': return (g(b).dp ?? -Infinity) - (g(a).dp ?? -Infinity);
        case 'loss': return g(a).p - g(b).p;
        case 'ticker': return a.ticker.localeCompare(b.ticker);
        default: return g(b).v - g(a).v; // value
      }
    });
    return arr;
  }, [held, sortBy, quotes]); // eslint-disable-line

  // news relevant to what you actually own (ticker symbol or company name match)
  const stockNews = useMemo(() => {
    const tickers = held.map(h => h.ticker.toUpperCase());
    const keyset = held.flatMap(h => nameKeys(h.name));
    const match = n => {
      const hay = `${n.title || ''} ${n.summary || ''} ${(n.tickers || []).join(' ')}`.toLowerCase();
      const HAY = hay.toUpperCase();
      if (tickers.some(t => new RegExp(`(^|[^A-Z])${t.replace('.', '\\.')}([^A-Z]|$)`).test(HAY))) return true;
      return keyset.some(k => hay.includes(k));
    };
    const rel = news.filter(match);
    const base = rel.length ? rel : news.filter(n => n.category === 'stocks');
    return base.slice(0, 6);
  }, [news, held]);

  // live per-holding headlines (Finnhub company-news) — inherently about what you own
  const heldTickers = held.map(h => h.ticker).join(',');
  useEffect(() => {
    let dead = false;
    const load = () => fetchHoldingsNews(heldTickers ? heldTickers.split(',') : []).then(n => { if (!dead && n.length) setLiveNews(n); }).catch(() => {});
    load();
    const id = setInterval(load, 15 * 60000); // keep fresh through the day
    return () => { dead = true; clearInterval(id); };
  }, [heldTickers, status]);
  const shownNews = liveNews.length ? liveNews : stockNews;

  // cached AI news digest loads with the tab; regenerate on demand
  useEffect(() => { memGet('ai_news_summary').then(v => v && setNewsSum(v)); }, []);
  async function summarize() {
    if (!shownNews.length) return;
    setSumBusy(true);
    try { setNewsSum(await aiNewsSummary(shownNews, held.map(h => h.ticker))); } catch {}
    setSumBusy(false);
  }

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

  const liveTag = status === 'nokey'
    ? <span className="chip c-yellow">add Finnhub key → live</span>
    : marketOpen && status === 'live'
      ? <span className="rc-live"><span className="rc-dot" />LIVE · market open</span>
      : <span className="chip">market closed · last close</span>;

  return (
    <>
      <div className="spread">
        <h1 className="tab-title">MONEY</h1>
        <span className="flex" style={{ gap: 8 }}>
          <span className="seg">
            <button className={`seg-btn${view === 'portfolio' ? ' on' : ''}`} onClick={() => setView('portfolio')}>Portfolio</button>
            <button className={`seg-btn${view === 'nextbuy' ? ' on' : ''}`} onClick={() => setView('nextbuy')}>✦ Next buy</button>
          </span>
          <EyeBtn visible={visible} onClick={toggle} />
        </span>
      </div>
      <p className="tab-sub">US stocks (INDmoney) + crypto — live prices, auto-refreshing. {liveTag}</p>

      {view === 'nextbuy' && <NextBuyDesk held={held} priceOf={priceOf} quotes={quotes} />}

      {view === 'portfolio' && <>
      <div className="tile-row">
        <StatTile label="Portfolio value" value={money(value, visible)} note={pctChip(pnlPct)} color="var(--green)" />
        <StatTile label="Invested" value={money(cost, visible)} color="var(--cyan)" />
        <StatTile label="Total P&L" value={money(pnl, visible)} note={pctChip(pnlPct)} color={pnl >= 0 ? 'var(--green)' : 'var(--red)'} />
        <StatTile label="Holdings" value={held.length} color="var(--pink)" />
      </div>

      {/* Today's 1D gain / loss */}
      <div className={`px daypl ${dayGain >= 0 ? 'up' : 'down'}`}>
        {haveLive && <DayFx up={dayGain >= 0} />}
        <div className="flex" style={{ gap: 10, alignItems: 'baseline' }}>
          <span className="daypl-label">TODAY'S P&L <span className="muted">(1D)</span></span>
          {marketOpen && status === 'live' && <span className="rc-live"><span className="rc-dot" />LIVE</span>}
        </div>
        {haveLive ? (
          <div className="flex" style={{ gap: 14, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <span className="daypl-val" style={{ color: dayGain >= 0 ? 'var(--green)' : 'var(--red)' }}>
              {dayGain >= 0 ? '+' : '−'}{money(Math.abs(dayGain), visible)}
            </span>
            <span className="chip" style={{ color: dayGain >= 0 ? 'var(--green)' : 'var(--red)', borderColor: dayGain >= 0 ? 'var(--green)' : 'var(--red)' }}>
              {dayPct >= 0 ? '▲' : '▼'} {Math.abs(dayPct).toFixed(2)}%
            </span>
            <span className="muted small">{marketOpen ? 'since prev close · updating live' : 'last session'}</span>
          </div>
        ) : (
          <div className="muted small">{status === 'nokey' ? 'Add a free Finnhub key in Settings to see live daily P&L.' : 'Waiting for live quotes…'}</div>
        )}
      </div>

      <Card title="Portfolio over time" color="var(--purple)"
        right={histState === 'loading' ? <span className="chip c-yellow">building line…</span> : histState === 'nokey' ? <span className="chip c-yellow">add Twelve Data key</span> : null}>
        <PortfolioChart orders={orders} invested={invSeries} value={valSeries} intraday={intraday} currentValue={value} visible={visible} variant="full" />
      </Card>

      <Card title="Holdings — stocks" color="var(--green)" right={held.length > 0 && (
        <span className="flex" style={{ gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {SORTS.map(([k, label]) => (
            <button key={k} className={`tf-btn${sortBy === k ? ' on' : ''}`} onClick={() => setSortBy(k)}>{label}</button>
          ))}
        </span>
      )}>
        {held.length === 0 && <Empty icon="$" text="No holdings yet — snapshot from INDmoney or add manually below." />}
        {held.length > 0 && (
          <div className="scroll-x">
            <table className="ptable">
              <thead><tr><th>Ticker</th><th>Qty</th><th>Avg</th><th>Last</th><th>Day</th><th>Value</th><th>P&L</th><th /></tr></thead>
              <tbody>
                {sortedHeld.map(h => {
                  const q = quotes[h.ticker];
                  const price = priceOf(h);
                  const v = Number(h.qty) * price;
                  const c = Number(h.qty) * Number(h.avg_cost || 0);
                  const p = h.avg_cost ? v - c : null;
                  const pp = c ? (p / c) * 100 : 0;
                  const dp = q?.changePct;
                  return (
                    <tr key={h.id} style={{ cursor: 'pointer' }} onClick={() => setOpenStock(h)}>
                      <td><b style={{ fontWeight: 'normal', color: 'var(--cyan)' }}>{h.ticker} ›</b></td>
                      <td>{Number(h.qty).toFixed(4)}</td>
                      <td>{money(h.avg_cost, visible)}</td>
                      <td>{price ? '$' + price.toFixed(2) : '—'}{q?.live && <span className="live-tick" />}</td>
                      <td style={{ color: dp == null ? undefined : dp >= 0 ? 'var(--green)' : 'var(--red)' }}>{dp == null ? '—' : `${dp >= 0 ? '+' : ''}${dp.toFixed(2)}%`}</td>
                      <td>{money(v, visible)}</td>
                      <td style={{ color: p == null ? undefined : p >= 0 ? 'var(--green)' : 'var(--red)' }}>
                        {money(p, visible)} {h.avg_cost ? <span className="small">({pp >= 0 ? '+' : ''}{pp.toFixed(1)}%)</span> : ''}
                      </td>
                      <td><button className="btn btn-sm" onClick={e => { e.stopPropagation(); del(h.id); }}>✕</button></td>
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

      <CryptoHoldings visible={visible} />

      <Card title="Your stocks in the news" color="var(--pink)"
        right={pickProvider() && shownNews.length > 0 && (
          <button className="btn btn-sm btn-pink" onClick={summarize} disabled={sumBusy}>{sumBusy ? '…' : newsSum ? '↻ AI summary' : '✦ AI summary'}</button>
        )}>
        {shownNews.length === 0 && (
          <Empty icon="※" text={status === 'nokey'
            ? 'Add a free Finnhub key in Settings — headlines about your holdings load here live.'
            : 'Loading headlines for your holdings…'} />
        )}
        {shownNews.map(n => (
          <div className="row" key={n.id} style={{ alignItems: 'flex-start' }}>
            {n.ticker && <span className="chip c-pink" style={{ minWidth: 52, textAlign: 'center' }}>{n.ticker}</span>}
            <span style={{ flex: 1 }}>
              <a href={n.url} target="_blank" rel="noreferrer" style={{ color: 'var(--ink)' }}>{n.title}</a>
              {n.summary && <div className="small muted">{n.summary}</div>}
            </span>
            {n.source && <span className="chip c-cyan">{n.source}</span>}
          </div>
        ))}
        {newsSum && (
          <div className="ai-note mt">
            <div className="flex" style={{ gap: 8, marginBottom: 4 }}>
              <span className="chip c-purple">✦ AI summary</span>
              <span className="small muted">{new Date(newsSum.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
            <div style={{ lineHeight: 1.55 }}>{newsSum.text}</div>
          </div>
        )}
      </Card>

      <PortfolioAdvisor held={held} priceOf={priceOf} quotes={quotes} />
      </>}

      <StockDetail holding={openStock} orders={orders} visible={visible} onClose={() => setOpenStock(null)} />
    </>
  );
}
