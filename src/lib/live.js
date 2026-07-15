// ---- Live US-stock prices (browser-side, low latency) ----
// Finnhub free tier: REST /quote for the opening snapshot + prev-close (needed for
// today's 1D gain/loss), and a WebSocket that pushes trade ticks while the US
// market is open. One shared connection for the whole app (HQ + Money + chart)
// via a tiny singleton store; React components subscribe through useLiveQuotes().
import { getConfig } from './db.js';
import { useEffect, useState } from 'react';

// Finnhub uses dotted class shares (BRK.B). Bare US tickers resolve as-is.
export const finnhubSymbol = t => String(t || '').toUpperCase().replace('-', '.');

// US market open? 9:30–16:00 America/New_York, Mon–Fri (holidays not modelled).
export function usMarketState(now = new Date()) {
  try {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
      .formatToParts(now).reduce((a, x) => (a[x.type] = x.value, a), {});
    if (p.weekday === 'Sat' || p.weekday === 'Sun') return 'closed';
    const mins = (Number(p.hour) % 24) * 60 + Number(p.minute);
    return mins >= 570 && mins < 960 ? 'open' : 'closed';
  } catch { return 'open'; }
}

// ---------- singleton store ----------
const store = {
  quotes: {},            // TICKER -> { price, prevClose, change, changePct, live }
  refs: {},              // TICKER -> subscriber count
  listeners: new Set(),
  ws: null,
  pollTimer: null,
  reconnectTimer: null,
  status: 'idle',        // 'live' | 'closed' | 'nokey' | 'idle'
};

const key = () => (getConfig().finnhubKey || '').trim();
const emit = () => store.listeners.forEach(fn => { try { fn(); } catch {} });
// coalesce burst trade updates into at most ~1.5 renders/sec (battery-friendly)
let emitTimer = null;
function scheduleEmit() {
  if (emitTimer) return;
  emitTimer = setTimeout(() => { emitTimer = null; emit(); }, 650);
}

function setQuote(t, patch) {
  const prev = store.quotes[t] || {};
  const next = { ...prev, ...patch };
  if (next.price != null && next.prevClose != null && next.prevClose > 0) {
    next.change = next.price - next.prevClose;
    next.changePct = (next.change / next.prevClose) * 100;
  }
  store.quotes[t] = next;
}

async function restSnapshot(tickers) {
  const k = key(); if (!k) return;
  for (const t of tickers) {
    try {
      const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(finnhubSymbol(t))}&token=${k}`);
      if (!r.ok) continue;
      const j = await r.json();
      if (typeof j.c === 'number' && j.c > 0) setQuote(t, { price: j.c, prevClose: typeof j.pc === 'number' && j.pc > 0 ? j.pc : (store.quotes[t]?.prevClose ?? j.c), live: false });
    } catch {}
  }
  emit();
}

function openSocket() {
  const k = key(); if (!k || store.ws) return;
  let ws;
  try { ws = new WebSocket(`wss://ws.finnhub.io?token=${k}`); } catch { return; }
  store.ws = ws;
  ws.onopen = () => { Object.keys(store.refs).forEach(t => { try { ws.send(JSON.stringify({ type: 'subscribe', symbol: finnhubSymbol(t) })); } catch {} }); };
  ws.onmessage = ev => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.type !== 'trade' || !Array.isArray(m.data)) return;
    // last trade per symbol
    const bySym = {};
    for (const d of m.data) bySym[d.s] = d.p;
    let changed = false;
    for (const t of Object.keys(store.refs)) {
      const p = bySym[finnhubSymbol(t)];
      if (typeof p === 'number' && p > 0) { setQuote(t, { price: p, live: true }); changed = true; }
    }
    if (changed) scheduleEmit();
  };
  ws.onclose = () => {
    store.ws = null;
    if (store.status === 'live' && Object.keys(store.refs).length) {
      clearTimeout(store.reconnectTimer);
      store.reconnectTimer = setTimeout(openSocket, 4000);
    }
  };
  ws.onerror = () => { try { ws.close(); } catch {} };
}

function wsSub(t, on) {
  if (!store.ws || store.ws.readyState !== 1) return;
  try { store.ws.send(JSON.stringify({ type: on ? 'subscribe' : 'unsubscribe', symbol: finnhubSymbol(t) })); } catch {}
}

function refreshEngine() {
  const tickers = Object.keys(store.refs);
  if (!key()) { store.status = 'nokey'; emit(); return; }
  if (!tickers.length) { teardown(); store.status = 'idle'; emit(); return; }
  const open = usMarketState() === 'open';
  store.status = open ? 'live' : 'closed';
  restSnapshot(tickers); // snapshot always (gives last close + prev close when shut)
  clearInterval(store.pollTimer);
  if (open) {
    openSocket();
    store.pollTimer = setInterval(() => restSnapshot(Object.keys(store.refs)), 60000); // fallback for illiquid names
  } else {
    teardownSocket();
  }
  emit();
}

function teardownSocket() {
  clearTimeout(store.reconnectTimer);
  if (store.ws) { try { store.ws.close(); } catch {} store.ws = null; }
}
function teardown() {
  teardownSocket();
  clearInterval(store.pollTimer); store.pollTimer = null;
}

// re-evaluate open/closed every minute so we auto-connect at the bell
let clock = null;
function ensureClock() {
  if (clock) return;
  clock = setInterval(() => { if (Object.keys(store.refs).length) refreshEngine(); }, 60000);
  // when keys sync in from another device, re-evaluate immediately (no reload needed)
  if (typeof window !== 'undefined') {
    window.addEventListener('ldx-config-synced', () => { if (Object.keys(store.refs).length) refreshEngine(); });
  }
}

export function subscribe(tickers, cb) {
  const list = [...new Set((tickers || []).filter(Boolean).map(t => String(t).toUpperCase()))];
  list.forEach(t => {
    store.refs[t] = (store.refs[t] || 0) + 1;
    if (store.refs[t] === 1) wsSub(t, true);
  });
  store.listeners.add(cb);
  ensureClock();
  refreshEngine();
  return () => {
    store.listeners.delete(cb);
    list.forEach(t => {
      store.refs[t] = (store.refs[t] || 1) - 1;
      if (store.refs[t] <= 0) { delete store.refs[t]; wsSub(t, false); }
    });
    if (!Object.keys(store.refs).length) teardown();
  };
}

export const getQuotes = () => store.quotes;
export const getStatus = () => store.status;

// React hook: pass the tickers you care about, get a live {quotes, status}.
export function useLiveQuotes(tickers) {
  const kt = (tickers || []).join(',');
  const [, force] = useState(0);
  useEffect(() => {
    const unsub = subscribe(tickers, () => force(x => x + 1));
    return unsub;
  }, [kt]); // eslint-disable-line
  return { quotes: store.quotes, status: store.status };
}
