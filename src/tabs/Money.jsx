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
import Levers from '../components/money/Levers.jsx';
import DividendDesk from '../components/money/DividendDesk.jsx';
import Expenses from '../components/money/Expenses.jsx';
import OverviewPanels from '../components/money/OverviewPanels.jsx';
import Leaderboard from '../components/money/Leaderboard.jsx';
import GlobalMarkets from '../components/money/GlobalMarkets.jsx';
import Accounts from '../components/money/Accounts.jsx';
import Compare from '../components/money/Compare.jsx';
import Rebalance from '../components/money/Rebalance.jsx';
import TaxDesk from '../components/money/TaxDesk.jsx';
import FactorDesk from '../components/money/FactorDesk.jsx';
import ReportDesk from '../components/money/ReportDesk.jsx';
import FinBoy from '../components/money/FinBoy.jsx';
import Scanner from '../components/money/Scanner.jsx';
import Sentiment from '../components/money/Sentiment.jsx';
import Briefing, { useBriefing, BriefStrip } from '../components/money/Briefing.jsx';
import FairValue from '../components/money/FairValue.jsx';
import TickerHead from '../components/money/TickerHead.jsx';
import FinMetric from '../components/money/FinMetric.jsx';
import EarningsCal from '../components/money/EarningsCal.jsx';
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
// arrows, glowing softly.
//
// The line DRAWS rather than appearing. Both directions use the same mechanism
// and the same timing so up and down read as one behaviour with two signs — a
// rise that animates and a fall that just sits there would make the good news
// feel like an event and the bad news feel like a fact, which is a lie the
// styling would be telling on its own.
//
// pathLength="100" is what makes that possible: it normalises the geometry so
// one dash-offset keyframe drives both paths regardless of how long each one
// actually is, and the blurred underlay stays exactly in step with the sharp
// line instead of finishing early.
//
// The whole plot is rotated a couple of degrees INTO its own direction. It is
// the same trick the arrows do — the tilt reinforces the sign before the eye
// has read a single number.
function DayFx({ up }) {
  const line = up
    ? 'M2 50 L16 44 L28 47 L44 33 L58 37 L74 22 L90 28 L106 13 L122 19 L138 7 L150 5'
    : 'M2 6 L16 12 L28 9 L44 23 L58 19 L74 34 L90 28 L106 43 L122 37 L138 49 L150 51';
  const glow = up ? '#6ee76e' : '#e84141';
  const tip = up ? 5 : 51;
  return (
    <div className={`daypl-fx ${up ? 'up' : 'down'}`} aria-hidden="true">
      <div className="daypl-arrows">{Array.from({ length: 24 }).map((_, i) => <span key={i}>{up ? '▲' : '▼'}</span>)}</div>
      <svg viewBox="0 0 152 56" preserveAspectRatio="none" shapeRendering="crispEdges">
        <path
          className="daypl-under" d={line} pathLength="100" fill="none" stroke={glow}
          strokeWidth="6" opacity="0.22" vectorEffect="non-scaling-stroke"
          style={{ filter: 'blur(3px)' }}
        />
        <path
          className="daypl-line" d={line} pathLength="100" fill="none" stroke={glow}
          strokeWidth="2.5" vectorEffect="non-scaling-stroke"
        />
        {/* The tip only exists once the line has arrived under it. */}
        <rect className="daypl-tip" x={147} y={tip - 3} width={6} height={6} fill={glow} />
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
  const [view, setView] = useState('portfolio');
  // The Markets view holds two different questions that were previously one tab:
  // "what is the app able to see" (world) and "what did my own holdings do"
  // (movers). They were never the same screen — the leaderboard ranks things you
  // own, which is a portfolio question wearing a markets label — so they now sit
  // side by side rather than one standing in for the other.
  const [mkSub, setMkSub] = useState('world'); // portfolio | book | vs | risk | factors | plan | divs | cash | markets | compare | rebal | tax | report | finboy | scanner | nextbuy | calendar
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
  // A tracked ticker with no position IS the watchlist. There is no separate
  // watchlist table and there does not need to be one — a row in `investments`
  // with a zero quantity is already exactly "a company I follow but do not own",
  // and inventing a second table would create two places a ticker can live and
  // one of them would go stale.
  const watched = items.filter(h => !(Number(h.qty) > 0));
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

  // Rows for the accounts screen. Built from the same held/priceOf/quotes the
  // headline numbers above are built from, so an account total and the portfolio
  // total can never disagree about what a position is worth — decision 5 of
  // lib/accounts.js made real at the call site rather than trusted to it.
  //
  // invested is null, not 0, when there is no avg_cost. Zero would mean "bought
  // for nothing", which reads as infinite profit; null means "we don't know",
  // and accountTotals is built to carry that through to a sentence instead of a
  // percentage.
  const accountRows = useMemo(() => held.map(h => {
    const qty = Number(h.qty) || 0;
    const q = quotes[h.ticker];
    const avg = Number(h.avg_cost);
    return {
      ticker: h.ticker,
      qty,
      marketValue: qty * priceOf(h),
      invested: Number.isFinite(avg) && avg > 0 ? qty * avg : null,
      dayGain: q?.change != null ? qty * Number(q.change) : 0,
    };
  }), [held.map(h => h.ticker).join(','), quotes]);

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

  // The overview strip and the Briefing screen run the SAME rules off the SAME
  // context — one hook, called here, handed to both. A strip that assembled its
  // own context could disagree with the screen it links to, and the reader would
  // have no way to tell which of the two was wrong.
  const briefResult = useBriefing({
    held, priceOf, orders, series: valSeries, flowsByDay,
    currentValue: value, cur: inr ? '\u20b9' : '$',
  });

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
            <button className={`seg-btn${view === 'brief' ? ' on' : ''}`} onClick={() => setView('brief')}>◆ Briefing</button>
            <button className={`seg-btn${view === 'portfolio' ? ' on' : ''}`} onClick={() => setView('portfolio')}>Portfolio</button>
            <button className={`seg-btn${view === 'book' ? ' on' : ''}`} onClick={() => setView('book')}>Book</button>
            <button className={`seg-btn${view === 'accounts' ? ' on' : ''}`} onClick={() => setView('accounts')}>Accounts</button>
            <button className={`seg-btn${view === 'vs' ? ' on' : ''}`} onClick={() => setView('vs')}>vs Index</button>
            <button className={`seg-btn${view === 'risk' ? ' on' : ''}`} onClick={() => setView('risk')}>Risk</button>
            <button className={`seg-btn${view === 'factors' ? ' on' : ''}`} onClick={() => setView('factors')}>Factors</button>
            <button className={`seg-btn${view === 'plan' ? ' on' : ''}`} onClick={() => setView('plan')}>Plan</button>
            <button className={`seg-btn${view === 'levers' ? ' on' : ''}`} onClick={() => setView('levers')}>Levers</button>
            <button className={`seg-btn${view === 'divs' ? ' on' : ''}`} onClick={() => setView('divs')}>Dividends</button>
            <button className={`seg-btn${view === 'cash' ? ' on' : ''}`} onClick={() => setView('cash')}>Cash</button>
            <button className={`seg-btn${view === 'markets' ? ' on' : ''}`} onClick={() => setView('markets')}>Markets</button>
            <button className={`seg-btn${view === 'compare' ? ' on' : ''}`} onClick={() => setView('compare')}>Compare</button>
            <button className={`seg-btn${view === 'rebal' ? ' on' : ''}`} onClick={() => setView('rebal')}>Rebalance</button>
            <button className={`seg-btn${view === 'tax' ? ' on' : ''}`} onClick={() => setView('tax')}>Tax</button>
            <button className={`seg-btn${view === 'report' ? ' on' : ''}`} onClick={() => setView('report')}>Report</button>
            <button className={`seg-btn${view === 'finboy' ? ' on' : ''}`} onClick={() => setView('finboy')}>FinBoy</button>
            <button className={`seg-btn${view === 'scanner' ? ' on' : ''}`} onClick={() => setView('scanner')}>Screens</button>
            <button className={`seg-btn${view === 'value' ? ' on' : ''}`} onClick={() => setView('value')}>Value</button>
            <button className={`seg-btn${view === 'ticker' ? ' on' : ''}`} onClick={() => setView('ticker')}>Ticker</button>
            <button className={`seg-btn${view === 'fin' ? ' on' : ''}`} onClick={() => setView('fin')}>Financials</button>
            <button className={`seg-btn${view === 'nextbuy' ? ' on' : ''}`} onClick={() => setView('nextbuy')}>✦ Next buy</button>
            <button className={`seg-btn${view === 'calendar' ? ' on' : ''}`} onClick={() => setView('calendar')}>Calendar</button>
            <button className={`seg-btn${view === 'earn' ? ' on' : ''}`} onClick={() => setView('earn')}>Earnings</button>
          </span>
          <span className="seg">
            <button className={`seg-btn${cur === 'usd' ? ' on' : ''}`} onClick={() => setCur('usd')}>$</button>
            <button className={`seg-btn${cur === 'inr' ? ' on' : ''}`} onClick={() => setCur('inr')} disabled={!fx} title={fx ? '' : 'FX loading…'}><span className="rupee">₹</span></button>
          </span>
          <EyeBtn visible={visible} onClick={toggle} />
        </span>
      </div>
      <p className="tab-sub">US stocks (INDmoney) + crypto — live prices, auto-refreshing. {liveTag}</p>

      {view === 'accounts' && <Accounts rows={accountRows} cur={cur} />}

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
      {view === 'levers' && (
        <Levers
          currentValue={inr && fx ? value * fx : value}
          cur={inr ? '\u20b9' : '$'}
          onEditPlan={() => setView('plan')}
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
      {/* Cash does NOT take the display currency the rest of this tab uses. Its
          rows are amounts that were actually typed in a currency — mostly rupees —
          and the toggle above is a viewing preference for a dollar-priced
          portfolio. Applying it here would restyle Rs 149 as $149 without
          converting anything. The tab owns its own base and is handed the rate. */}
      {view === 'cash' && (
        <Expenses
          fx={fx}
          onContribution={m => { setPlanSeed(m); setView('plan'); }}
        />
      )}

      {/* The board only ever opens a row you actually own, because the detail modal
          is built around your order history — there is nothing to show for a company
          you have never bought. So the ticker is resolved back to the holding here,
          and a name that does not resolve is simply not clickable. */}
      {view === 'markets' && (
        <>
          <span className="seg" style={{ marginBottom: 10 }}>
            <button className={`seg-btn${mkSub === 'world' ? ' on' : ''}`} onClick={() => setMkSub('world')}>Coverage</button>
            <button className={`seg-btn${mkSub === 'movers' ? ' on' : ''}`} onClick={() => setMkSub('movers')}>Your movers</button>
            <button className={`seg-btn${mkSub === 'sentiment' ? ' on' : ''}`} onClick={() => setMkSub('sentiment')}>Sentiment</button>
          </span>
          {mkSub === 'world' && <GlobalMarkets />}
          {mkSub === 'movers' && (
            <Leaderboard
              holdings={held}
              onOpen={t => { const h = held.find(x => x.ticker === t); if (h) setOpenStock(h); }}
            />
          )}
          {/* The dial reads the same live quotes the board already subscribes to,
              so opening this view costs no extra requests; only its price-history
              button spends the Twelve Data budget, and only when pressed. */}
          {mkSub === 'sentiment' && (
            <Sentiment
              quotes={quotes}
              meta={Object.fromEntries(held.map(h => [h.ticker, { name: h.name, held: true }]))}
              cur={inr ? '\u20b9' : '$'}
            />
          )}
        </>
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

      {/* The factor desk needs only the book and a price — it measures companies,
          not trades, so the order tape has nothing to tell it. */}
      {view === 'factors' && (
        <FactorDesk held={held} priceOf={priceOf} visible={visible} />
      )}

      {/* The report is the only view that reads from every other one. It is handed
          exactly what those views were handed — the same book, the same tape, the
          same series — so that a figure in the report cannot disagree with the same
          figure on the screen it came from. It fetches nothing of its own. */}
      {view === 'report' && (
        <ReportDesk
          held={held} priceOf={priceOf} orders={orders}
          series={valSeries} flowsByDay={flowsByDay} currentValue={value}
          benchName="S&P 500" cur={inr ? '\u20b9' : '$'}
        />
      )}

      {/* FinBoy is handed exactly what the Report is handed, for the same reason:
          a sentence about a figure and the screen showing that figure must not be
          able to disagree. It builds its index from the saved blobs and never
          fetches a price of its own. */}
      {view === 'finboy' && (
        <FinBoy
          held={held} priceOf={priceOf} orders={orders}
          series={valSeries} flowsByDay={flowsByDay} currentValue={value}
          cur={inr ? '\u20b9' : '$'}
        />
      )}

      {/* The scanner is handed a TICKER-keyed price function, not the holding-keyed
          one the rest of this file uses, because most of its universe is not held
          and there is no holding object to look a price up from. */}
      {view === 'scanner' && (
        <Scanner
          held={held}
          priceOf={t => Number(quotes[t]?.price) || null}
          cur={inr ? '\u20b9' : '$'}
        />
      )}

      {/* cur is the LITERAL dollar and not the inr toggle, deliberately. Every
          other screen here runs its numbers through disp(), which multiplies by
          fx before stamping a rupee sign. This one does not convert anything:
          the price comes straight off the quote feed, which live.js opens by
          saying it is US prices, and it is divided by a per-share figure Neel
          typed in the same currency. Stamping the display toggle's symbol onto
          an unconverted number would put a rupee sign on dollars — precisely the
          class of mislabelling this module exists to refuse. The multiple itself
          is a ratio and carries no currency at all. */}
      {view === 'value' && <FairValue held={held} quotes={quotes} cur="$" />}

      {/* Same literal dollar as FairValue above, for the same reason. Every price
          on this screen comes straight off the quote feed, which live.js opens by
          stating it is US prices, and nothing here multiplies by fx. Stamping the
          display toggle's rupee sign onto an unconverted dollar figure would put
          a wrong currency on a right number — and this screen's market-cap panel
          would then be wrong by the exchange rate as well as the unit. */}
      {view === 'ticker' && <TickerHead held={held} quotes={quotes} cur="$" />}

      {/* The third literal dollar on this tab, and the least ambiguous of the
          three: every figure on this screen is a per-share figure straight out of
          a US filing summary, and there is no quote feed involved at all. There
          is nothing here for fx to convert even in principle — a rupee sign would
          be pure mislabelling with no conversion behind it. */}
      {view === 'brief' && (
        <Briefing
          held={held} priceOf={priceOf} orders={orders}
          series={valSeries} flowsByDay={flowsByDay} currentValue={value}
          cur={inr ? '\u20b9' : '$'} onGo={setView}
        />
      )}
      {view === 'fin' && <FinMetric held={held} cur="$" />}

      {view === 'nextbuy' && <NextBuyDesk held={held} priceOf={priceOf} quotes={quotes} />}
      {view === 'calendar' && <MarketCalendar held={held} />}

      {/* The fourth literal dollar on this tab, and like the financials screen it
          is not a display choice: every EPS and revenue figure on the earnings
          calendar is a US filing figure straight out of the provider's calendar,
          with no quote feed and therefore nothing to convert. The watchlist is
          the zero-quantity half of the same holdings table — see `watched`. */}
      {view === 'earn' && <EarningsCal held={held} watch={watched} cur="$" />}

      {view === 'portfolio' && <>
      <div className="tile-row">
        <StatTile label="Portfolio value" value={disp(value)} note={pctChip(pnlPct)} color="var(--green)" />
        <StatTile label="Invested" value={disp(cost)} color="var(--cyan)" />
        <StatTile label="Total P&L" value={disp(pnl)} note={pctChip(pnlPct)} color={pnl >= 0 ? 'var(--green)' : 'var(--red)'} />
        <StatTile label="Holdings" value={held.length} color="var(--pink)" />
        <StatTile label="USD → INR" value={fx ? <><span className="rupee">₹</span>{fx.toFixed(2)}</> : '…'} note="live FX" color="var(--orange)" />
      </div>

      <BriefStrip result={briefResult} onOpen={() => setView('brief')} />

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

      {/* What you own most of, and what pays you most — the two questions the
          front page should answer without making you open a screen. Handed the
          same priceOf the holdings table uses, so the two can never disagree
          about what a position is worth. */}
      <OverviewPanels
        held={held}
        priceOf={priceOf}
        costOf={h => (h.avg_cost == null || h.avg_cost === '' ? null : Number(h.avg_cost))}
        quotes={quotes}
        fx={inr && fx ? fx : 1}
        cur={inr ? '\u20b9' : '$'}
        onOpen={t => { const h = held.find(x => x.ticker === t); if (h) setOpenStock(h); }}
      />

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
