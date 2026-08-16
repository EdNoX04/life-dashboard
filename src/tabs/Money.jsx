import React, { useEffect, useMemo, useState } from 'react';
import GlobalOverview from '../components/money/GlobalOverview.jsx';
import { useCollection } from '../lib/hooks.js';
import { Card, Empty, StatTile, EyeBtn, useMoneyVisible, money } from '../components/ui.jsx';
import StockDetail from '../components/StockDetail.jsx';
import PortfolioChart from '../components/PortfolioChart.jsx';
import RangeBrush from '../components/money/RangeBrush.jsx';
import Diversification from '../components/money/Diversification.jsx';
import Xray from '../components/money/Xray.jsx';
import Desk from '../components/money/Desk.jsx';
import AccountTabs from '../components/money/AccountTabs.jsx';
import DivSync from '../components/money/DivSync.jsx';
import DivReceived from '../components/money/DivReceived.jsx';
import PaymentHistory from '../components/money/PaymentHistory.jsx';
import { loadAccounts, filterRows as filterByAccount } from '../lib/accounts.js';
import YieldDesk from '../components/money/YieldDesk.jsx';
import ValueDesk from '../components/money/ValueDesk.jsx';
import { holdingRows, dayPnl } from '../lib/holdings.js';
import { clampRange, sliceRange } from '../lib/range.js';
import { currencyOf } from '../lib/indiabook.js';
import CryptoHoldings from '../components/CryptoHoldings.jsx';
import SipCard from '../components/SipCard.jsx';
import IndiaDesk from '../components/money/IndiaDesk.jsx';
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
import DivLists from '../components/money/DivLists.jsx';
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
import LEDGERDock from '../components/money/LEDGERDock.jsx';
import Scanner from '../components/money/Scanner.jsx';
import Sentiment from '../components/money/Sentiment.jsx';
import Briefing, { useBriefing, BriefStrip } from '../components/money/Briefing.jsx';
import FairValue from '../components/money/FairValue.jsx';
import Intrinsic from '../components/money/Intrinsic.jsx';
import TickerHead from '../components/money/TickerHead.jsx';
import FinMetric from '../components/money/FinMetric.jsx';
import EarningsCal from '../components/money/EarningsCal.jsx';
import { defaultBenchmark } from '../lib/india.js';
import { aiNewsSummary, memGet, memSet } from '../lib/advisor.js';
import { pickProvider } from '../lib/ai.js';
import * as db from '../lib/db.js';
import Crypto from '../components/money/Crypto.jsx';
import { MONEY_SECTIONS } from '../lib/moneynav.js';
import { portfolioTotals } from '../lib/holdings.js';
import { fetchUsdInr } from '../lib/markets.js';

const STOP = new Set(['inc', 'inc.', 'corp', 'corp.', 'corporation', 'ltd', 'ltd.', 'co', 'co.', 'company', 'holdings', 'group', 'the', 'and', 'plc', 'etf', 'trust', 'index', 'fund', 'class', 'common', 'stock', 'nv', 'sa', 'ag']);
// company-name keywords used to match news to a holding
const nameKeys = name => String(name || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 3 && !STOP.has(w));

// Retro P&L backdrop styled after the neon "crash chart": a jagged neon trend
// line (red rising / green falling) over a dark grid strewn with faint direction
// arrows, glowing softly.
//
// This used to DRAW itself — stroke-dashoffset running from 100 to 0 and back
// on a nine-second loop. Two things were wrong with that. The visible one is
// that a dash animation on a line is a line with a gap in it for two thirds of
// every cycle, so most of the time you were looking at a chart that appeared to
// be missing segments; and because the erase phase ran fast, the line also
// snapped backwards once every nine seconds. The deeper one is that "draws
// itself, pauses, redraws" is not what a live market looks like. A price series
// does not restart.
//
// So it scrolls instead, and the geometry is built to make that seamless. ONE
// path, not one per tile: the polyline below is a single M...L...L... through
// every point of every repeat, so there is no join anywhere for a butt cap to
// notch. The tile repeats every TILE_W units horizontally AND steps TILE_RISE
// units vertically, and the scroll translates by exactly (-TILE_W, +TILE_RISE),
// which lands each repeat precisely on its neighbour's old position. The loop
// point is therefore invisible — the line genuinely never restarts, it only
// ever moves, which is the whole difference between decoration and a chart.
//
// The vertical step is what makes it rise rather than merely slide. New segments
// enter from the right at a higher position than the ones leaving on the left,
// so the line climbs continuously and forever, exactly as a rising session does.
//
// MOTION IS GATED ON THE MARKET, not on the sign of the number. When the market
// is shut the line holds still, because a chart that keeps animating after the
// close is claiming something is happening that is not. The pause is CSS
// (animation-play-state) rather than a conditional render, so the line freezes
// where it is instead of jumping to a start position at 3:30.
//
// Up and down use the same mechanism and the same timing — a rise that animates
// and a fall that just sits there would make good news feel like an event and
// bad news feel like a fact, which is a lie the styling would be telling on its
// own.
export const TILE_W = 38;     // user units of one repeat
export const TILE_RISE = 7;   // how far a repeat climbs; must match the CSS keyframes
const TILE_PTS = [[0, 0], [6, -4], [12, -1], [19, -8], [25, -4], [31, -10], [38, -7]];
const TILE_COPIES = 7; // covers the 152-unit viewBox four times over, plus the wrap

/** The whole scrolling series as one continuous polyline. */
export function dayLinePath(up) {
  // TILE_PTS already climbs 7 units across one repeat (its last y is -7). The
  // per-repeat offset must therefore be SUBTRACTED, not added: adding it doubles
  // the climb inside the tile while the seam only accounts for it once, which
  // puts a 14-unit cliff at every join. That is a zigzag with a cliff in it, not
  // a price series, and it is exactly what the dash animation was replaced for.
  const m = up ? 1 : -1;        // -1 mirrors the climb into a slide
  // Chosen so five visible repeats span y=2..54 inside the 56-unit viewBox: the
  // series drifts by TILE_RISE per repeat, so where it STARTS decides whether
  // the far end is on screen at all. Up starts LOW and climbs to the right,
  // which is both what a rising series looks like standing still and what the
  // left-to-right scroll needs - the translate is +one repeat, so the drawn
  // slope and the motion agree rather than cancelling. Down is the mirror, and
  // the two bases sum to the viewBox height.
  const base = up ? 47 : 9;
  const pts = [];
  for (let i = -1; i < TILE_COPIES - 1; i++) {
    // Every repeat after the first skips its own point 0: it is the same point
    // as the previous repeat's last one, and emitting it twice would put a
    // zero-length segment at each seam.
    for (let k = i === -1 ? 0 : 1; k < TILE_PTS.length; k++) {
      const [x, y] = TILE_PTS[k];
      pts.push([x + i * TILE_W, base + m * (y - i * TILE_RISE)]);
    }
  }
  return `M${pts.map(([x, y]) => `${x} ${y.toFixed(1)}`).join(' L')}`;
}

function DayFx({ up, live }) {
  const line = dayLinePath(up);
  const glow = up ? '#6ee76e' : '#e84141';
  return (
    <div className={`daypl-fx ${up ? 'up' : 'down'}${live ? '' : ' closed'}`} aria-hidden="true">
      <div className="daypl-arrows">{Array.from({ length: 24 }).map((_, i) => <span key={i}>{up ? '▲' : '▼'}</span>)}</div>
      {/* crispEdges is deliberately NOT set here, though it is the house style
          everywhere else. This svg is preserveAspectRatio="none" over a ~4x
          horizontal stretch, and turning off anti-aliasing on a near-horizontal
          2.5px stroke under that much scaling renders it as a staircase of
          detached chunks. The grid behind it is a CSS background and stays
          crisp, so the retro texture survives; only the trend line is smoothed,
          and only because the alternative is a line that looks broken. */}
      <svg viewBox="0 0 152 56" preserveAspectRatio="none" shapeRendering="geometricPrecision">
        <g className="daypl-scroll">
          <path
            className="daypl-under" d={line} fill="none" stroke={glow}
            strokeWidth="6" strokeLinejoin="miter" opacity="0.22"
            vectorEffect="non-scaling-stroke" style={{ filter: 'blur(3px)' }}
          />
          <path
            className="daypl-line" d={line} fill="none" stroke={glow}
            strokeWidth="2.5" strokeLinejoin="miter" vectorEffect="non-scaling-stroke"
          />
        </g>
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
  // Which account the holdings views are scoped to. Held here rather than in
  // AccountTabs so the tabs and the table it scopes cannot disagree, and so the
  // scope survives switching between views inside the section.
  const [scope, setScope] = useState('all');
  const [acctMap, setAcctMap] = useState({});
  const [sortBy, setSortBy] = useState('value');
  const [liveNews, setLiveNews] = useState([]);
  const [planSeed, setPlanSeed] = useState(null);   // monthly surplus handed over by the Cash tab
  const [finboy, setFinboy] = useState(false);     // the dock, open on any view
  const [view, setView] = useState('portfolio');
  // The two-tier nav shows one section's views at a time, which is what stopped
  // twenty-six buttons wrapping onto three unreadable lines. The cost of that is
  // real and was reported as a bug: with MY MONEY lit you can see six screens
  // and the other twenty are behind four small pixel-font words, so the honest
  // reading of the strip is "the rest are gone". This opens the whole map at
  // once. It is off by default because the collapsed strip is the better daily
  // control; it exists so that "where is everything" has an answer on screen
  // rather than requiring you to click each section to find out.
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
  // The Indian desk's inputs. They are broker scans rather than live feeds, so
  // they live in memory blobs and are read once: `sips` is the schedule the
  // broker reports, `stock_fees.remittances` the deposit receipts behind the
  // real cost of investing from India.
  const [sips, setSips] = useState([]);
  const [remittances, setRemittances] = useState([]);
  const [indMeta, setIndMeta] = useState({});

  useEffect(() => {
    fetchUsdInr().then(setFx);
    const t = setInterval(() => fetchUsdInr().then(r => r && setFx(r)), 6 * 3600e3);
    memGet('stock_fees').then(v => {
      if (v?.manual) setManualFees(v.manual);
      if (Array.isArray(v?.remittances)) setRemittances(v.remittances);
    });
    memGet('sips').then(v => { if (Array.isArray(v?.list)) setSips(v.list); });
    memGet('ind_meta').then(v => { if (v) setIndMeta(v); });
    // The same map AccountTabs reads. Loaded here too so the scope can be
    // applied to the book itself - the tabs own the UI, not the filtering.
    loadAccounts().then(({ map }) => setAcctMap(map || {})).catch(() => {});
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

  // Every total below is in DOLLARS, and getting there needs a currency check
  // per holding rather than a bare multiply. GOLDBEES is priced at about 122
  // RUPEES; summed as if it were 122 dollars it entered the portfolio at
  // roughly ninety times its real weight. The display toggle then multiplied
  // that already-wrong figure by the FX rate, which does not fix it - it
  // scales it.
  //
  // A rupee holding with no FX rate loaded is EXCLUDED and counted, not
  // converted at 1.0. A total that silently absorbs an account at the wrong
  // rate looks exactly like a correct one.
  const usdOf = (h, per) => {
    const q = Number(h.qty) || 0;
    const v = q * (Number(per) || 0);
    if (currencyOf(h) !== 'INR') return v;
    return fx ? v / fx : null;
  };

  // The totals come from lib/holdings so the dashboard tile computes them the
  // same way. They were worked out separately before and disagreed by the full
  // rupee value of the GOLDBEES position.
  const { value, cost, pnl, pnlPct, excludedInr } = portfolioTotals(held, { priceOf, fx, currencyOf });

  // Today's move, WITH the count of what it actually covers. This used to be a
  // bare reduce that skipped any holding whose quote had not arrived and then
  // printed the result as the portfolio's day — which is why it could read
  // −$7.63 while the broker's own app said +$2.52. Neither figure was wrong
  // about what it measured; only one of them said what it measured.
  const day = useMemo(
    () => dayPnl(held, quotes, { fx, currencyOf, priceOf }),
    [held, quotes, fx],
  );
  const dayGain = day.gain;
  const dayPct = day.pct ?? 0;
  const haveLive = day.base > 0;

  // Rows for the accounts screen. Built from the same held/priceOf/quotes the
  // headline numbers above are built from, so an account total and the portfolio
  // total can never disagree about what a position is worth — decision 5 of
  // lib/accounts.js made real at the call site rather than trusted to it.
  //
  // invested is null, not 0, when there is no avg_cost. Zero would mean "bought
  // for nothing", which reads as infinite profit; null means "we don't know",
  // and accountTotals is built to carry that through to a sentence instead of a
  // percentage.
  //
  // CURRENCY. These rows used to be built with a bare `qty * priceOf(h)` while
  // every other total on this tab went through usdOf. So a GOLDBEES position
  // worth about sixteen dollars entered the accounts screen as one thousand
  // four hundred and fifty-five, and INDstocks reported itself as a fifth of
  // the book. Nothing looked broken: a rupee and a dollar are both just numbers
  // once the symbol is gone, so they summed without complaint and the total was
  // wrong by roughly the exchange rate. This is the same bug lib/indiabook.js
  // exists to kill, in a screen nobody had checked.
  //
  // A holding that cannot be converted is EXCLUDED and reported, never
  // converted at 1.0 — decision 2 of indiabook, made real at the call site.
  //
  // Every figure here is in the DISPLAY currency, converted exactly once. Two
  // steps, and collapsing them is how this goes wrong: native -> dollars using
  // the holding's OWN currency, then dollars -> whatever the toggle says. The
  // second step must use the same factor the header uses or the account shares
  // will not add up to the portfolio total sitting above them.
  const toDisp = inr && fx ? fx : 1;
  const accountRows = useMemo(() => held.map(h => {
    const qty = Number(h.qty) || 0;
    const q = quotes[h.ticker];
    const avg = Number(h.avg_cost);
    const inrRow = currencyOf(h) === 'INR';
    const rate = inrRow ? (fx || null) : 1;       // native -> USD
    if (!rate) return null;                       // no rate: excluded, never converted at 1.0
    const f = toDisp / rate;                      // native -> display, in one multiply
    const px = priceOf(h);
    const marketValue = qty * px * f;
    const invested = Number.isFinite(avg) && avg > 0 ? qty * avg * f : null;
    return {
      ticker: h.ticker,
      name: h.name || h.ticker,
      qty,
      currency: inrRow ? 'INR' : 'USD',
      price: px * f,
      marketValue,
      invested,
      dayGain: q?.change != null ? qty * Number(q.change) * f : 0,
      // Percentages are ratios and carry no currency — converting one would be
      // as wrong as failing to convert a total.
      dayPct: q?.changePct == null ? null : Number(q.changePct),
      unrealisedPct: invested != null && invested > 0 ? ((marketValue - invested) / invested) * 100 : null,
    };
  }).filter(Boolean), [held.map(h => h.ticker).join(','), quotes, fx, toDisp]);

  // Holdings the accounts screen had to drop for want of a rate. Named, because
  // a total quietly missing a position looks exactly like a correct one.
  const accountsDropped = held.length - accountRows.length;

  // ---- reconstructed value-over-time (orders × historical prices) ----
  const tickerKey = held.map(h => h.ticker).join(',');
  const histTickers = useMemo(() => held.map(h => String(h.ticker || '').toUpperCase()).filter(Boolean), [tickerKey]);
  // The book, narrowed to the selected account. Derived from `held` rather than
  // re-fetched, so a per-account total can never disagree with the combined one:
  // they are partitions of the same array, not two answers to the same question.
  const scopedHeld = useMemo(
    () => filterByAccount(held, acctMap, scope),
    [held, acctMap, scope],
  );

  const livePrices = useMemo(() => {
    const m = {}; held.forEach(h => { m[String(h.ticker).toUpperCase()] = priceOf(h); }); return m;
  }, [tickerKey, quotes]);
  const { invested: invSeries, value: valSeries } = useMemo(
    () => buildDailySeries(orders, histTickers, priceHist.data || {}, livePrices),
    [orders, histTickers, priceHist, livePrices]
  );

  // The brush's selection. Held as indices into `valSeries` rather than as a
  // pair of dates, because the series is the authority on which days exist -
  // see lib/range.js. Null means "everything", so a portfolio whose history has
  // just finished loading shows all of it rather than an empty window.
  const [chartRange, setChartRange] = useState(null);
  const chartFrom = useMemo(
    () => (chartRange ? sliceRange(valSeries, chartRange) : valSeries),
    [valSeries, chartRange],
  );
  // The invested line has to be cut to the SAME index window, not re-derived
  // from dates: the two series are built in one pass over the same day list, so
  // index i is the same day in both, and slicing them separately by date would
  // let them drift apart on any day one of them skipped.
  const investedFrom = useMemo(
    () => (chartRange ? sliceRange(invSeries, chartRange) : invSeries),
    [invSeries, chartRange],
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
  // fx goes in raw, NOT the inr display toggle. The look-through rules convert
  // every position to one currency before summing, and they need the rate even
  // when the screen is showing dollars — a rupee holding is a rupee holding
  // whichever symbol is on the button.
  const briefResult = useBriefing({
    held, priceOf, orders, series: valSeries, flowsByDay,
    currentValue: value, cur: inr ? '\u20b9' : '$', fx,
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
  // The book split by the unit its prices are quoted in. Nothing here converts:
  // the dollar table shows dollars, the rupee table shows rupees, and the two
  // are never added together on this screen. The combined figure lives in the
  // tiles above, which do convert, deliberately and in one place.
  const usHeld = useMemo(() => held.filter(h => currencyOf(h) !== 'INR'), [held]);
  const inHeld = useMemo(() => held.filter(h => currencyOf(h) === 'INR'), [held]);

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
  // Per-ORDER fees only. INDmoney charges none on US fractional trades - every
  // order value in the scanned ledger equals qty x price exactly - so this sum
  // is legitimately zero for the US book, and labelling it "total fees" was the
  // wrongest number on the screen. The real cost is the INR->USD remittance,
  // which FeesCard computes from the saved receipts.
  const orderFees = orders.reduce((s, o) => s + (o.side !== 'S' ? Number(o.fee || 0) : 0), 0);
  const manualFeeTotal = Object.values(manualFees).reduce((s, f) => s + Number(f || 0), 0);
  const tradeFees = orderFees + manualFeeTotal;

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
      <div className="spread money-head">
        <h1 className="tab-title">MONEY</h1>
        <span className="flex" style={{ gap: 8 }}>
          <span className="seg">
            <button className={`seg-btn${cur === 'usd' ? ' on' : ''}`} onClick={() => setCur('usd')}>$</button>
            <button className={`seg-btn${cur === 'inr' ? ' on' : ''}`} onClick={() => setCur('inr')} disabled={!fx} title={fx ? '' : 'FX loading\u2026'}><span className="rupee">₹</span></button>
          </span>
          <EyeBtn visible={visible} onClick={toggle} />
        </span>
      </div>
      <p className="tab-sub money-sub">US stocks (INDmoney) + crypto — live prices, auto-refreshing. {liveTag}</p>

      {/* The only nav. There used to be a two-tier strip above this - a row of
          sections, then a row of that section's views, then a toggle that
          revealed this panel. Three mechanisms to answer one question, and the
          strip could only ever show one section's contents at a time, so
          "what else is there" needed a click before it needed an answer.

          This panel already showed everything AND kept it grouped, so the strip
          was the redundant half. Every screen is one click away, each group
          wears its section's colour, and the hint line under each heading says
          what the group is FOR - which a row of nine equal-weight buttons never
          did. It stays open after a pick rather than collapsing: it is a map,
          and a map you have to reopen is a menu. */}
      <div className="money-all px money-nav">
        {MONEY_SECTIONS.map(sec => (
          <div className="mall-sec" key={sec.id} style={{ '--msec': sec.color }}>
            <div className="mall-head">
              <span className="mall-title">{sec.label}</span>
              <span className="mall-hint">{sec.hint}</span>
            </div>
            <div className="mall-grid">
              {sec.views.map(v => (
                <button
                  key={v.id}
                  className={`mall-item${view === v.id ? ' on' : ''}`}
                  onClick={() => setView(v.id)}
                >{v.label}</button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* The account switcher lives HERE rather than above the portfolio. On the
          portfolio screen it was a second row of tabs stacked under the section
          nav, and two tab strips in a column read as one confused control. This
          is the screen that is about accounts, so this is where choosing one
          belongs. */}
      {view === 'accounts' && (
        <>
          <AccountTabs
            rows={held.map(h => ({ ...h, ticker: h.ticker }))}
            scope={scope} onScope={setScope} cur={cur}
          />
          {/* ONE selection. `scope` lives here, the tabs set it, and the card
              below is a function of it — it used to keep a second copy of its
              own, which is why choosing INDstocks still showed the US account.
              `cur` here is the MODE ('usd'/'inr'), not a symbol; passing it
              straight through is what once rendered "usd367.44".
              `value` is the same converted book total the header prints, so the
              account shares cannot disagree with the portfolio total. */}
          <Accounts
            rows={accountRows} cur={inr ? '\u20b9' : '$'}
            scope={scope} onScope={setScope}
            bookTotal={inr && fx ? value * fx : value}
            dropped={accountsDropped}
          />
        </>
      )}

      {/* The Indian desk takes `held` raw rather than the display-currency
          totals the rest of the tab passes around. Its whole job is to keep
          rupee figures in rupees, so a converted number arriving here would be
          exactly the bug it exists to fix. `fx` is passed so it can state a
          combined total, and interbank separately because the gap between the
          two IS the fee. */}
      {view === 'india' && (
        <IndiaDesk
          rows={held} priceOf={priceOf}
          sips={sips} remittances={remittances}
          wallet={indMeta.wallet_inr ?? null}
          believedFreq={indMeta.believed_freq ?? null}
          interbank={indMeta.interbank ?? null}
          fx={fx} scanned={indMeta.scanned ?? null}
        />
      )}

      {/* Crypto owns its own currency the way Cash does. Binance P2P settles in
          rupees, so a rupee is the honest unit here regardless of what the rest
          of the tab is displaying, and converting it to dollars to match would
          be inventing a number nobody transacted in. */}
      {view === 'crypto' && <Crypto />}

      {view === 'book' && (
        <Book held={scopedHeld} priceOf={priceOf} quotes={quotes} visible={visible}
          onOpen={setOpenStock} fx={fx} inr={!!inr} />
      )}
      {view === 'vs' && (
        <Benchmark
          series={valSeries} invested={invSeries} orders={orders} flowsByDay={flowsByDay}
          currentValue={value} cur={inr ? '₹' : '$'} visible={visible}
          rate={inr && fx ? fx : 1}
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
      {view === 'divlists' && <DivLists held={held} quotes={quotes} />}
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
          {mkSub === 'world' && <><GlobalOverview /><GlobalMarkets /></>}
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

      {/* The screen that turns the FMP key into working dividend screens. It
          writes into div_meta, which every other dividend view already reads -
          one import lights up the calendar, the income lists, the yield
          analyzer and the holdings total-return column at once. */}
      {view === 'divsync' && <DivSync held={held} cur={inr ? '\u20b9' : '$'} />}

      {/* What was actually received, as opposed to what the projections say a
          year would look like. Different question, different screen. */}
      {view === 'divgot' && <DivReceived fx={fx} />}

      {/* Payment history needs the ORDER TAPE as well as the book: what you
          received depends on how many shares you held on each ex-date, which
          only the tape knows. Today's holding applied backwards would credit
          you for shares you had not bought yet. */}
      {view === 'divhist' && (
        <PaymentHistory held={held} orders={orders} cur={inr ? '\u20b9' : '$'} />
      )}

      {/* Two screens that had been built, committed and never rendered. Both
          are pure given their inputs; the containers exist because the inputs
          come from stores with different refresh clocks, and reconciling those
          is not the pure component's job. */}
      {view === 'yield' && <YieldDesk held={held} priceOf={priceOf} onOpen={setOpenStock} />}
      {view === 'vlib' && (
        <ValueDesk held={held} quotes={quotes} cur={inr ? '\u20b9' : '$'} onOpen={setOpenStock} />
      )}

      {/* The spread desk is handed built rows rather than raw holdings because
          it weights by marketValue and by income, and neither is a column on a
          position - both are derived. holdingRows is the one place that
          derivation lives, so deriving it again here would be a second
          definition of "what this position is worth". */}
      {view === 'divers' && (
        <Diversification
          rows={holdingRows(held, { priceOf, quotes, fx: inr && fx ? fx : 1 })}
          cur={inr ? '\u20b9' : '$'}
        />
      )}

      {/* The X-ray is handed the RAW book, not holdingRows, because it is the
          one screen that has to know a position's currency and whether the
          position is a fund at all - and both of those are facts about the
          holding record, not about the derived row. It converts to dollars
          itself, once, and excludes anything it cannot convert rather than
          letting a rupee figure into a dollar total. */}
      {view === 'xray' && (
        <Xray held={held} priceOf={priceOf} fx={fx} inr={!!inr} />
      )}

      {/* The Desk is handed the briefing RESULT rather than being allowed to
          run the rules itself. Two computations of "what is past a threshold"
          is two chances for the Desk and the Briefing to print different
          answers to one question, with no way for a reader to tell which is
          wrong — the same reason useBriefing is a hook shared with the overview
          strip rather than a body each screen repeats. */}
      {view === 'desk' && (
        <Desk
          held={held} priceOf={priceOf} quotes={quotes} orders={orders}
          fx={fx} inr={!!inr} briefResult={briefResult} onGo={setView}
        />
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
      {view === 'intrinsic' && <Intrinsic held={held} quotes={quotes} cur="₹" />}

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
          cur={inr ? '\u20b9' : '$'} onGo={setView} fx={fx}
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
        {haveLive && <DayFx up={dayGain >= 0} live={marketOpen} />}
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
            {/* WHICH WINDOW. This tile read "last session" and disagreed with
                INDmoney by about ten dollars, and the disagreement was real
                arithmetic on both sides measuring different things: the
                completed regular session here, the move since that close
                there. Naming the window is the whole fix. */}
            <span className="muted small">
              {marketOpen ? 'since prev close · updating live' : 'last full session · regular hours only'}
            </span>
          </div>
        ) : (
          <div className="muted small">{status === 'nokey' ? 'Add a free Finnhub key in Settings to see live daily P&L.' : 'Waiting for live quotes…'}</div>
        )}
        {/* The figure above is a sum over the holdings that reported. Saying so
            is the difference between a number you can reconcile against your
            broker and a number that just disagrees with it. */}
        {haveLive && !day.whole && (
          <div className="daypl-cov">
            from {day.quoted} of {day.total} holdings
            {day.covered != null && ` · ${day.covered.toFixed(0)}% of the book by value`}
            {day.missing.length > 0 && ` · no quote yet for ${day.missing.slice(0, 4).join(', ')}${day.missing.length > 4 ? `+${day.missing.length - 4}` : ''}`}
            {day.excluded.length > 0 && ` · ${day.excluded.join(', ')} excluded, no exchange rate`}
          </div>
        )}
        {haveLive && day.whole && (
          <div className="daypl-cov">all {day.total} holdings reported</div>
        )}
        {/* Said once, plainly, because this figure WILL get compared against a
            broker app and the two will differ whenever the market is shut.
            Neither is wrong. Finnhub's quote gives the last regular close
            against the one before it, so this is the completed session.
            INDmoney's "1D" after the bell is the extended-hours move since
            that close — a different window, and it can point the other way.
            The free quote feed does not carry extended-hours prices, so this
            screen cannot show that second number rather than guessing at it. */}
        {haveLive && !marketOpen && (
          <div className="daypl-cov daypl-why">
            This is the last completed regular session, close against the close
            before it. A broker app open right now may show a different figure —
            that is usually the after-hours move since this close, which is a
            different window rather than a different answer.
          </div>
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
        <PortfolioChart orders={orders} invested={investedFrom} value={chartFrom} intraday={intraday} currentValue={value} visible={visible} variant="full" />
        {/* The brush sits BELOW the chart it controls. Above, it pushed the
            chart down and read as a second chart competing with the real one -
            two plots stacked, the small one on top. Underneath it reads as what
            it is: a scrubber for the thing above it, the way a video timeline
            sits under the video. */}
        <RangeBrush
          series={valSeries}
          valueOf={p => Number(p?.v ?? 0)}
          range={chartRange || (valSeries.length ? clampRange(valSeries, 0, valSeries.length - 1) : null)}
          onChange={setChartRange}
          color="var(--purple)"
        />
      </Card>

      {/* SIPs sit directly under the chart rather than at the bottom of the
          page. They were below the holdings table, the crypto book and the
          Indian box - four screens of scrolling - and a standing commitment
          that debits money every week is not a footnote to the portfolio, it is
          the part of it that has not happened yet. */}
      <SipCard fx={fx} />

      {/* Rupee holdings are drawn separately. GOLDBEES was appearing in this
          table with a DOLLAR value and a RUPEE average cost side by side, which
          is not a rounding problem - it is two different currencies in one row
          pretending to be one number. Splitting the table is the honest fix:
          each box states its own unit and never converts. */}
      <Card title="Holdings — stocks" color="var(--green)" right={usHeld.length > 0 && (
        <span className="flex" style={{ gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {SORTS.map(([k, label]) => (
            <button key={k} className={`tf-btn${sortBy === k ? ' on' : ''}`} onClick={() => setSortBy(k)}>{label}</button>
          ))}
        </span>
      )}>
        {usHeld.length === 0 && <Empty icon="$" text="No dollar holdings yet — the INDmoney sync fills this, or add one manually below." />}
        {usHeld.length > 0 && (
          <div className="scroll-x">
            <table className="ptable">
              <thead><tr><th>Ticker</th><th>Qty</th><th>Avg</th><th>Last</th><th>Day</th><th>Value</th><th>P&L</th><th /></tr></thead>
              <tbody>
                {sortedHeld.filter(h => currencyOf(h) !== 'INR').map(h => {
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
          <span className="small muted">Per-trade fees entered here: </span>
          <span className="chip c-yellow">{disp(tradeFees)}</span>
          {/* Said out loud, because a zero here is a true answer to a narrow
              question and reads as a false answer to a broad one. */}
          {tradeFees === 0 && (
            <div className="small muted" style={{ marginTop: 3 }}>
              Zero is correct — INDmoney charges no brokerage on US fractional
              trades. What investing actually costs you is the rupee-to-dollar
              transfer, in Fees &amp; forex below.
            </div>
          )}
        </div>
      </Card>

      {/* Rupees, stated as rupees. This box exists because converting a rupee
          holding into the dollar table produced a row whose value and cost were
          in different currencies - which looked like a small discrepancy and was
          actually a factor of ninety. */}
      {inHeld.length > 0 && (
        <Card title="Holdings — Indian stocks (₹)" color="var(--orange)"
          right={<span className="chip c-orange">INDstocks</span>}>
          <div className="scroll-x">
            <table className="ptable">
              <thead><tr><th>Ticker</th><th>Qty</th><th>Avg ₹</th><th>Last ₹</th><th>Value ₹</th><th>P&L ₹</th><th /></tr></thead>
              <tbody>
                {inHeld.map(h => {
                  const price = Number(quotes[h.ticker]?.price ?? h.last_price ?? h.avg_cost ?? 0);
                  const q2 = Number(h.qty) || 0;
                  const v = q2 * price;
                  const ac = h.avg_cost == null ? null : Number(h.avg_cost);
                  const c = ac == null ? null : q2 * ac;
                  const p = c == null ? null : v - c;
                  return (
                    <tr key={h.id}>
                      <td><b style={{ fontWeight: 'normal', color: 'var(--orange)' }}>{h.ticker}</b></td>
                      <td>{q2}</td>
                      {/* A null average is printed as "not set", never as zero:
                          GOLDBEES is held across two brokers and one leg has no
                          recorded cost, so the blended basis is genuinely unknown. */}
                      <td>{ac == null ? <span className="muted">not set</span> : `₹${ac.toFixed(2)}`}</td>
                      <td>₹{price.toFixed(2)}</td>
                      <td>₹{v.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                      <td style={{ color: p == null ? undefined : p >= 0 ? 'var(--green)' : 'var(--red)' }}>
                        {p == null ? '—' : `₹${p.toFixed(2)}`}
                      </td>
                      <td><button className="btn btn-sm" onClick={() => del(h.id)}>✕</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="small muted mt">
            Kept in rupees on purpose. These are never added to the dollar table above;
            the combined figure in the tiles converts once, at the live rate.
          </p>
        </Card>
      )}

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

      <FeesCard orders={orders} investedUsd={cost} fx={fx} visible={visible} cur={cur} />

      <PortfolioAdvisor held={held} priceOf={priceOf} quotes={quotes} />
      </>}

      <StockDetail holding={openStock} orders={orders} visible={visible} onClose={() => setOpenStock(null)} />

      {/* Outside every view branch, so it is reachable from all thirty-five of
          them. It is handed exactly what the Report is handed, for the reason
          the Report is: a sentence about a figure and the screen showing that
          figure must not be able to disagree. It builds its index from the
          saved blobs and never fetches a price of its own. */}
      <LEDGERDock
        open={finboy}
        onOpen={() => setFinboy(true)}
        onClose={() => setFinboy(false)}
        held={held} priceOf={priceOf} orders={orders}
        series={valSeries} flowsByDay={flowsByDay} currentValue={value}
        fx={fx} cur={inr ? '\u20b9' : '$'}
      />
    </>
  );
}
