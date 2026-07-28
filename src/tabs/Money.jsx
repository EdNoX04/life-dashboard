import React, { useEffect, useMemo, useState } from 'react';
import { useCollection } from '../lib/hooks.js';
import { Card, Empty, StatTile, EyeBtn, useMoneyVisible, money } from '../components/ui.jsx';
import StockDetail from '../components/StockDetail.jsx';
import PortfolioChart from '../components/PortfolioChart.jsx';
import CryptoHoldings from '../components/CryptoHoldings.jsx';
import SipCard from '../components/SipCard.jsx';
import { PortfolioAdvisor, NextBuyDesk } from '../components/MoneyAI.jsx';
import FeesCard from '../components/FeesCard.jsx';
import { useLiveQuotes, usMarketState } from '../lib/live.js';
import { fetchHoldingsNews } from '../lib/news.js';
import { buildDailySeries, buildIntradaySeries, loadPriceHistory, refreshPriceHistory } from '../lib/portfolioHistory.js';
import MarketCalendar from '../components/MarketCalendar.jsx';
import Benchmark from '../components/money/Benchmark.jsx';
import DataStatus from '../components/money/DataStatus.jsx';
import Book from '../components/money/Book.jsx';
import RiskProfile from '../components/money/RiskProfile.jsx';
import Planner from '../components/money/Planner.jsx';
import DividendDesk from '../components/money/DividendDesk.jsx';
import Expenses from '../components/money/Expenses.jsx';
import Leaderboard from '../components/money/Leaderboard.jsx';
import Compare from '../components/money/Compare.jsx';
import Rebalance from '../components/money/Rebalance.jsx';
import TaxDesk from '../components/money/TaxDesk.jsx';
import { defaultBenchmark } from '../lib/india.js';
import { aiNewsSummary, memGet, memSet } from '../lib/advisor.js';
import { pickProvider } from '../lib/ai.js';
import * as db from '../lib/db.js';

// live USD→INR (keyless, CORS-ok; frankfurter with er-api fallback)
async function fetchUsdInr() {
  try { const j = await (await fetch('https://api.frankfurter.app/latest?from=USD&to=INR')).json(); if (j?.rates?.INR) return j.rates.INR; } catch {}
  try { const j = await (await fetch('https://open.er-api.com/v6/latest/USD')).json(); if (j?.rates?.INR) return j.rates.INR; } catch {}
  return null;
}

const STOP = new Set(['inc', 'inc.', 'corp', 'corp.', 'corporation', 'ltd', 'ltd.', 'co', 'co.', 'company', 'holdings', 'group', 'the', 'and', 'plc', 'etf', 'trust', 'index', 'fund', 'class', 'common', 'stock', 'nv', 'sa', 'ag']);
// company-name keywords used to match news to a holding
const nameKeys = name => String(name || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 3 && !STOP.has(w));

// Retro P&L backdrop styled after the neon "crash chart": a jagged neon trend
// line (red falling / green rising) over a dark grid strewn with faint direction
// arrows, glowing softly. Static line + gentle glow pulse — no crawling.
function DayFx({ up }) {
  const line = up
    ? 'M2 50 L16 44 L28 47 L44 33 L58 37 L74 22 L90 28 L106 13 L122 19 L138 7 L150 5'
    : 'M2 6 L16 12 L28 9 L44 23 L58 19 L74 34 L90 28 L106 43 L122 37 L138 49 L150 51';
  const glow = up ? '#6ee76e' : '#e84141';
  return (
    <div className={`daypl-fx ${up ? 'up' : 'down'}`} aria-hidden="true">
      <div className="daypl-arrows">{Array.from({ length: 24 }).map((_, i) => <span key={i}>{up ? '▲' : '▼'}</span>)}</div>
      <svg viewBox="0 0 152 56" preserveAspectRatio="none">
        <path d={line} fill="none" stroke={glow} strokeWidth="6" opacity="0.22" vectorEffect="non-scaling-stroke" style={{ filter: 'blur(3px)' }} />
        <path className="daypl-line" d={line} fill="none" stroke={glow} strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
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
  const [planSeed, setPlanSeed] = useState(null);   // monthly surplus handed over by the Cash tab
  const [view, setView] = useState('portfolio'); // portfolio | book | vs | risk | plan | divs | cash | markets | compare | rebal | tax | nextbuy | calendar
  const [newsSum, setNewsSum] = useState(null);
  const [sumBusy, setSumBusy] = useState(false);
  const [fx, setFx] = useState(null);            // USD → INR
  const [cur, setCur] = useState('usd');         // display currency ($ default)
  const [manualFees, setManualFees] = useState({});

  useEffect(() => {
    fetchUsdInr().then(setFx);
    const t = setInterval(() => fetchUsdInr().then(r => r && setFx(r)), 6 * 3600e3);
    memGet('stock_fees').then(v => v?.manual && setManualFees(v.manual));
    return () => clearInterval(t);
  }, []);

  const inr = cur === 'inr' && fx;
  const disp = n => money(inr ? n * fx : n, visible, inr ? '₹' : '$');
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

  // External cash moving in and out, per day. The value line jumps when a buy
  // settles, and that jump is not performance — analytics subtracts these before
  // computing any return. Fees are excluded here: they cost money but they don't
  // add market value, so they belong in the return, not in the flow.
  const flowsByDay = useMemo(() => {
    const m = {};
    for (const o of orders || []) {
      const d = String(o.date || '').slice(0, 10);
      const amt = Number(o.qty || 0) * Number(o.price || 0);
      if (!d || !amt) continue;
      m[d] = (m[d] || 0) + (o.side === 'S' ? -amt : amt);
    }
    return m;
  }, [orders]);

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

  // intraday (1D) value line — timestamp-aligned 5-min candles, refreshed with quotes
  useEffect(() => {
    if (!histTickers.length) return;
    let alive = true;
    buildIntradaySeries(held, livePrices).then(s => { if (alive) setIntraday(s); }).catch(() => {});
    const t = setInterval(() => buildIntradaySeries(held, livePrices).then(s => { if (alive) setIntraday(s); }).catch(() => {}), 5 * 60000);
    return () => { alive = false; clearInterval(t); };
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
    const T = form.ticker.trim().toUpperCase();
    await add({ ticker: T, qty: Number(form.qty), avg_cost: Number(form.avg_cost) || null, last_price: null, currency: 'USD', source: 'manual' });
    if (Number(form.fees) > 0) {
      const next = { ...manualFees, [T]: (manualFees[T] || 0) + Number(form.fees) };
      setManualFees(next);
      memSet('stock_fees', { manual: next, updated: new Date().toISOString() });
    }
    setForm({ ticker: '', qty: '', avg_cost: '', fees: '' });
  }

  // total fees: per-order fees from the ledger (buys) + manual entries
  const orderFees = orders.reduce((s, o) => s + (o.side !== 'S' ? Number(o.fee || 0) : 0), 0);
  const totalFees = orderFees + Object.values(manualFees).reduce((s, f) => s + Number(f || 0), 0);

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
            <button className={`seg-btn${view === 'book' ? ' on' : ''}`} onClick={() => setView('book')}>Book</button>
            <button className={`seg-btn${view === 'vs' ? ' on' : ''}`} onClick={() => setView('vs')}>vs Index</button>
            <button className={`seg-btn${view === 'risk' ? ' on' : ''}`} onClick={() => setView('risk')}>Risk</button>
            <button className={`seg-btn${view === 'plan' ? ' on' : ''}`} onClick={() => setView('plan')}>Plan</button>
            <button className={`seg-btn${view === 'divs' ? ' on' : ''}`} onClick={() => setView('divs')}>Dividends</button>
            <button className={`seg-btn${view === 'cash' ? ' on' : ''}`} onClick={() => setView('cash')}>Cash</button>
            <button className={`seg-btn${view === 'markets' ? ' on' : ''}`} onClick={() => setView('markets')}>Markets</button>
            <button className={`seg-btn${view === 'compare' ? ' on' : ''}`} onClick={() => setView('compare')}>Compare</button>
            <button className={`seg-btn${view === 'rebal' ? ' on' : ''}`} onClick={() => setView('rebal')}>Rebalance</button>
            <button className={`seg-btn${view === 'tax' ? ' on' : ''}`} onClick={() => setView('tax')}>Tax</button>
            <button className={`seg-btn${view === 'nextbuy' ? ' on' : ''}`} onClick={() => setView('nextbuy')}>✦ Next buy</button>
            <button className={`seg-btn${view === 'calendar' ? ' on' : ''}`} onClick={() => setView('calendar')}>Calendar</button>
          </span>
          <span className="seg">
            <button className={`seg-btn${cur === 'usd' ? ' on' : ''}`} onClick={() => setCur('usd')}>$</button>
            <button className={`seg-btn${cur === 'inr' ? ' on' : ''}`} onClick={() => setCur('inr')} disabled={!fx} title={fx ? '' : 'FX loading…'}><span className="rupee">₹</span></button>
          </span>
          <EyeBtn visible={visible} onClick={toggle} />
        </span>
      </div>
      <p className="tab-sub">US stocks (INDmoney) + crypto — live prices, auto-refreshing. {liveTag}</p>

      {view === 'book' && (
        <Book held={held} priceOf={priceOf} quotes={quotes} visible={visible}
          onOpen={setOpenStock} fx={fx} inr={!!inr} />
      )}
      {view === 'vs' && (
        <Benchmark
          series={valSeries} orders={orders} flowsByDay={flowsByDay}
          currentValue={value} cur={inr ? '₹' : '$'} visible={visible}
          defaultKey={defaultBenchmark('US')}
        />
      )}
      {view === 'vs' && <DataStatus />}
      {view === 'risk' && (
        <RiskProfile
          held={held} priceOf={priceOf} quotes={quotes}
          series={valSeries} orders={orders} flowsByDay={flowsByDay}
          currentValue={value} fx={fx} inr={!!inr}
          defaultKey={defaultBenchmark('US')}
        />
      )}
      {view === 'plan' && (
        <Planner currentValue={inr && fx ? value * fx : value} cur={inr ? '\u20b9' : '$'} seedMonthly={planSeed} />
      )}
      {view === 'divs' && (
        <DividendDesk
          held={held} priceOf={priceOf} costOf={h => Number(h.avg_cost || 0)}
          cur={inr ? '\u20b9' : '$'} fx={fx} inr={!!inr}
        />
      )}
      {view === 'cash' && (
        <Expenses
          cur={inr ? '\u20b9' : '$'}
          onContribution={m => { setPlanSeed(m); setView('plan'); }}
        />
      )}

      {/* The board only ever opens a row you actually own, because the detail modal
          is built around your order history — there is nothing to show for a company
          you have never bought. So the ticker is resolved back to the holding here,
          and a name that does not resolve is simply not clickable. */}
      {view === 'markets' && (
        <Leaderboard
          holdings={held}
          onOpen={t => { const h = held.find(x => x.ticker === t); if (h) setOpenStock(h); }}
        />
      )}

      {view === 'compare' && <Compare holdings={held} quotes={quotes} />}

      {/* The rebalancing desk needs the order tape as well as the book, because
          the tax consequence of a trim is a fact about when the shares were
          bought — and that only exists in the orders, never in the positions. */}
      {view === 'rebal' && (
        <Rebalance held={held} priceOf={priceOf} orders={orders} fx={fx} inr={!!inr} cur={inr ? '\u20b9' : '$'} />
      )}

      {/* The tax desk needs the order tape, not the positions: a gain is a fact
          about a matched pair of trades, and a holding period is a fact about
          when the first of that pair happened. Neither exists in a position. */}
      {view === 'tax' && (
        <TaxDesk held={held} orders={orders} priceOf={priceOf} cur={inr ? '\u20b9' : '$'} />
      )}

      {view === 'nextbuy' && <NextBuyDesk held={held} priceOf={priceOf} quotes={quotes} />}
      {view === 'calendar' && <MarketCalendar held={held} />}

      {view === 'portfolio' && <>
      <div className="tile-row">
        <StatTile label="Portfolio value" value={disp(value)} note={pctChip(pnlPct)} color="var(--green)" />
        <StatTile label="Invested" value={disp(cost)} color="var(--cyan)" />
        <StatTile label="Total P&L" value={disp(pnl)} note={pctChip(pnlPct)} color={pnl >= 0 ? 'var(--green)' : 'var(--red)'} />
        <StatTile label="Holdings" value={held.length} color="var(--pink)" />
        <StatTile label="USD → INR" value={fx ? <><span className="rupee">₹</span>{fx.toFixed(2)}</> : '…'} note="live FX" color="var(--orange)" />
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
              {dayGain >= 0 ? '+' : '−'}{disp(Math.abs(dayGain))}
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
          <input style={{ width: 110 }} type="number" placeholder="Fees $" value={form.fees || ''} onChange={e => setForm({ ...form, fees: e.target.value })} />
          <button className="btn btn-sm btn-green" onClick={addHolding}>+ Add</button>
        </div>
        <div className="mt" style={{ textAlign: 'right' }}>
          <span className="small muted">Total fees (all buys): </span>
          <span className="chip c-yellow">{disp(totalFees)}</span>
        </div>
      </Card>

      <CryptoHoldings visible={visible} />

      <SipCard fx={fx} />

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

      <FeesCard orders={orders} investedUsd={cost} fx={fx} visible={visible} cur={cur} />

      <PortfolioAdvisor held={held} priceOf={priceOf} quotes={quotes} />
      </>}

      <StockDetail holding={openStock} orders={orders} visible={visible} onClose={() => setOpenStock(null)} />
    </>
  );
}
