// ---- Historical candles for the retro chart (Twelve Data, free tier, CORS-ok) ----
// One request per (ticker, timeframe) on demand. Free tier: 8 req/min, 800/day —
// fine because candles only load when a chart is open and a timeframe is picked.
import { getConfig } from './db.js';

// timeframe -> Twelve Data { interval, outputsize (# candles) }
export const TIMEFRAMES = [
  ['1m', '1min', 130], ['5m', '5min', 130], ['15m', '15min', 130], ['30m', '30min', 130],
  ['1h', '1h', 160], ['4h', '4h', 160],
  ['1D', '1day', 130], ['1W', '1week', 160], ['1M', '1month', 120],
  ['3M', '1day', 66], ['6M', '1day', 130], ['1Y', '1day', 260],
  ['3Y', '1week', 160], ['5Y', '1week', 260], ['ALL', '1month', 400],
];
const TF_MAP = Object.fromEntries(TIMEFRAMES.map(([k, interval, size]) => [k, { interval, size }]));

// intraday timeframes should splice the live tick into the last candle
export const isIntraday = tf => ['1m', '5m', '15m', '30m', '1h', '4h'].includes(tf);

const twelveSymbol = t => String(t || '').toUpperCase().replace('-', '.');
const cache = new Map(); // `${sym}|${tf}` -> { at, candles }

export async function fetchCandles(ticker, tf) {
  const key = (getConfig().twelveKey || '').trim();
  if (!key) throw new Error('NO_KEY');
  const conf = TF_MAP[tf] || TF_MAP['1D'];
  const ck = `${twelveSymbol(ticker)}|${tf}`;
  const hit = cache.get(ck);
  // short cache so rapid tf toggling / re-opens don't burn credits
  if (hit && Date.now() - hit.at < (isIntraday(tf) ? 20000 : 5 * 60000)) return hit.candles;

  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(twelveSymbol(ticker))}`
    + `&interval=${conf.interval}&outputsize=${conf.size}&order=ASC&timezone=America/New_York&apikey=${key}`;
  const r = await fetch(url);
  const j = await r.json();
  if (j.status === 'error') throw new Error(j.message || 'Twelve Data error');
  const values = Array.isArray(j.values) ? j.values : [];
  const candles = values.map(v => ({
    t: v.datetime, o: +v.open, h: +v.high, l: +v.low, c: +v.close, v: +(v.volume || 0),
  })).filter(c => Number.isFinite(c.c));
  cache.set(ck, { at: Date.now(), candles });
  return candles;
}
