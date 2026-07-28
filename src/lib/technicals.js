// Technical indicators, computed by hand on a candle series.
//
// Six decisions, each of which is the difference between a chart that informs
// and a chart that misleads:
//
// 1. An indicator without enough history is NULL, not computed from whatever is
//    lying around. A 14-period RSI on nine bars is not a fast RSI, it is a
//    different number wearing RSI's name. Short series produce nulls, and nulls
//    render as "not enough history yet".
//
// 2. An EMA has to warm up. Seeding it from a single close makes the first
//    dozen values a decaying memory of one arbitrary day, so the warm-up region
//    is seeded from a simple average and then explicitly marked unusable until
//    the seed's influence has decayed.
//
// 3. A crossover needs a confirmed state on BOTH sides. The first bar where two
//    lines both exist is not a cross — nothing crossed, they simply started.
//
// 4. A swing high needs bars on both sides of it. The most recent bar can never
//    be a confirmed swing point, so the levels this file reports always lag, and
//    it says by how much rather than pretending to see the present.
//
// 5. Every reading is a description of where price has been, never an
//    instruction. "Above its 50-day average" is a fact. "Buy" is advice, this
//    file does not have a licence, and it never says it.
//
// 6. Indicators disagree, and the honest summary says how many pointed which
//    way out of how many could be computed — not a single confident verdict
//    manufactured from a majority of three.

const num = v => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

// candles: [{ t, o, h, l, c, v }] oldest-first.
export function closes(candles = []) {
  return candles.map(c => num(c?.c)).filter(v => v != null);
}

// ---- moving averages -----------------------------------------------------

// Decision 1: the first `period - 1` slots are null, they are not the average
// of a shorter window.
export function sma(values = [], period = 20) {
  const out = new Array(values.length).fill(null);
  if (!(period > 0) || values.length < period) return out;
  let run = 0;
  for (let i = 0; i < values.length; i++) {
    run += values[i];
    if (i >= period) run -= values[i - period];
    if (i >= period - 1) out[i] = run / period;
  }
  return out;
}

// Decision 2: seeded from the simple average of the first window, and the first
// `period` values after the seed are flagged as still warming up.
export function ema(values = [], period = 20) {
  const out = new Array(values.length).fill(null);
  if (!(period > 0) || values.length < period) return { values: out, warmUntil: values.length };
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  // Until roughly two windows in, the value still remembers its seed more than
  // it remembers the market.
  return { values: out, warmUntil: Math.min(values.length, period * 2 - 1) };
}

// ---- RSI -----------------------------------------------------------------

// Wilder's smoothing. Returns nulls until there is a full period of changes,
// because there is no such thing as a partial RSI.
export function rsi(values = [], period = 14) {
  const out = new Array(values.length).fill(null);
  if (values.length < period + 1) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  gain /= period; loss /= period;
  // All-gain with zero losses is 100, and it is reached by definition, not by
  // dividing by zero.
  out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    gain = (gain * (period - 1) + (d > 0 ? d : 0)) / period;
    loss = (loss * (period - 1) + (d < 0 ? -d : 0)) / period;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

// ---- MACD ----------------------------------------------------------------

export function macd(values = [], fast = 12, slow = 26, signal = 9) {
  if (values.length < slow + signal) return null;
  const f = ema(values, fast).values;
  const s = ema(values, slow).values;
  const line = values.map((_, i) => (f[i] == null || s[i] == null ? null : f[i] - s[i]));
  const dense = line.filter(v => v != null);
  const sig = ema(dense, signal).values;
  const offset = line.length - dense.length;
  const signalLine = new Array(values.length).fill(null);
  sig.forEach((v, i) => { if (v != null) signalLine[i + offset] = v; });
  const hist = values.map((_, i) => (line[i] == null || signalLine[i] == null ? null : line[i] - signalLine[i]));
  return { line, signal: signalLine, hist };
}

// Decision 3: a cross requires the previous bar to have both values too, and to
// have been on the other side. Two lines appearing together is a start, not a
// crossing.
export function lastCross(a = [], b = []) {
  for (let i = a.length - 1; i > 0; i--) {
    const now = a[i], nowB = b[i], was = a[i - 1], wasB = b[i - 1];
    if (now == null || nowB == null || was == null || wasB == null) continue;
    const d = now - nowB, p = was - wasB;
    if (d === 0 || p === 0) continue;
    if ((d > 0) !== (p > 0)) return { index: i, up: d > 0, barsAgo: a.length - 1 - i };
  }
  return null;
}

// ---- bands ---------------------------------------------------------------

export function bollinger(values = [], period = 20, mult = 2) {
  const mid = sma(values, period);
  const upper = new Array(values.length).fill(null);
  const lower = new Array(values.length).fill(null);
  const width = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    if (mid[i] == null) continue;
    const win = values.slice(i - period + 1, i + 1);
    const sd = Math.sqrt(win.reduce((s, v) => s + (v - mid[i]) ** 2, 0) / period);
    upper[i] = mid[i] + sd * mult;
    lower[i] = mid[i] - sd * mult;
    // Width as a share of the middle band, so it is comparable across prices.
    width[i] = mid[i] > 0 ? ((upper[i] - lower[i]) / mid[i]) * 100 : null;
  }
  return { mid, upper, lower, width };
}

// ---- levels --------------------------------------------------------------

// Decision 4: a swing point needs `look` bars on each side, so the last `look`
// bars can never produce one. `staleBars` says how far back the newest
// confirmable point is — the honest answer to "is this level current".
export function levels(candles = [], look = 5, keep = 4) {
  const n = candles.length;
  if (n < look * 2 + 1) return { support: [], resistance: [], staleBars: null, look };
  const highs = [], lows = [];
  for (let i = look; i < n - look; i++) {
    const h = num(candles[i].h), l = num(candles[i].l);
    if (h == null || l == null) continue;
    let isHigh = true, isLow = true;
    for (let j = i - look; j <= i + look; j++) {
      if (j === i) continue;
      const hj = num(candles[j].h), lj = num(candles[j].l);
      if (hj != null && hj >= h) isHigh = false;
      if (lj != null && lj <= l) isLow = false;
      if (!isHigh && !isLow) break;
    }
    if (isHigh) highs.push({ i, price: h });
    if (isLow) lows.push({ i, price: l });
  }
  const recent = a => a.slice(-keep).reverse();
  return {
    resistance: recent(highs),
    support: recent(lows),
    // The newest bar that could possibly have been confirmed.
    staleBars: look,
    look,
  };
}

// ---- volume --------------------------------------------------------------

export function volumeTrend(candles = [], period = 20) {
  const vols = candles.map(c => num(c?.v)).filter(v => v != null && v >= 0);
  if (vols.length < period + 1) return null;
  const recent = vols[vols.length - 1];
  const avg = vols.slice(-period - 1, -1).reduce((a, b) => a + b, 0) / period;
  if (!(avg > 0)) return null;      // a series of zero-volume bars is not a baseline
  return { latest: recent, avg, ratio: recent / avg };
}

// ---- the reading ---------------------------------------------------------

// Decision 5 and 6. Every entry is a statement about where price sits relative
// to something measurable, with a `lean` of 'up' | 'down' | 'flat' that is a
// direction of the reading, NOT a suggested action.
export function readings(candles = []) {
  const c = closes(candles);
  const px = c[c.length - 1] ?? null;
  const out = [];
  const push = (label, lean, text, ok = true) => out.push({ label, lean: ok ? lean : null, text, ok });

  if (px == null) return { price: null, readings: [], score: null };

  for (const p of [50, 200]) {
    const m = sma(c, p);
    const v = m[m.length - 1];
    if (v == null) {
      push(`${p}-day average`, null, `Needs ${p} days of history; there are ${c.length}.`, false);
    } else {
      const d = ((px - v) / v) * 100;
      push(`${p}-day average`, d > 0 ? 'up' : d < 0 ? 'down' : 'flat',
        `Price is ${Math.abs(d).toFixed(1)}% ${d >= 0 ? 'above' : 'below'} it.`);
    }
  }

  const r = rsi(c);
  const rv = r[r.length - 1];
  if (rv == null) push('RSI (14)', null, `Needs 15 days; there are ${c.length}.`, false);
  else {
    push('RSI (14)', rv > 55 ? 'up' : rv < 45 ? 'down' : 'flat',
      `${rv.toFixed(0)}. ${rv >= 70 ? 'Historically a stretched zone — it describes the run so far, not what comes next.'
        : rv <= 30 ? 'Historically a washed-out zone, which is equally where things that keep falling live.'
          : 'Mid range.'}`);
  }

  const m = macd(c);
  if (!m) push('MACD', null, `Needs ${26 + 9} days; there are ${c.length}.`, false);
  else {
    const x = lastCross(m.line, m.signal);
    const h = m.hist[m.hist.length - 1];
    push('MACD', h == null ? null : h > 0 ? 'up' : h < 0 ? 'down' : 'flat',
      x ? `Last crossed ${x.up ? 'up' : 'down'} ${x.barsAgo} bar${x.barsAgo === 1 ? '' : 's'} ago.`
        : 'No crossing in this window.', h != null);
  }

  const b = bollinger(c);
  const bu = b.upper[b.upper.length - 1], bl = b.lower[b.lower.length - 1];
  if (bu == null || bl == null) push('20-day bands', null, `Needs 20 days; there are ${c.length}.`, false);
  else {
    const pos = bu > bl ? ((px - bl) / (bu - bl)) * 100 : null;
    push('20-day bands', pos == null ? 'flat' : pos > 60 ? 'up' : pos < 40 ? 'down' : 'flat',
      pos == null ? 'The band has no width to sit inside.' : `Sitting ${pos.toFixed(0)}% of the way up the band.`);
  }

  const vt = volumeTrend(candles);
  if (!vt) push('Volume', null, 'Not enough volume history on this feed.', false);
  else push('Volume', 'flat',
    `Latest bar is ${vt.ratio.toFixed(2)}× the 20-day average.`);

  // Decision 6: count, do not conclude. The denominator is the point.
  const judged = out.filter(x => x.ok && x.lean);
  const up = judged.filter(x => x.lean === 'up').length;
  const down = judged.filter(x => x.lean === 'down').length;
  return {
    price: px,
    readings: out,
    score: { up, down, flat: judged.length - up - down, judged: judged.length, of: out.length },
  };
}

// Path geometry for one indicator overlaid on price, sharing price's scale.
export function overlayPath(series = [], lo, hi, w = 640, h = 180, pad = 4) {
  const pts = [];
  for (let i = 0; i < series.length; i++) {
    const v = series[i];
    if (v == null || !Number.isFinite(v)) continue;
    const x = pad + (i / Math.max(1, series.length - 1)) * (w - pad * 2);
    const y = h - pad - ((v - lo) / (hi - lo || 1)) * (h - pad * 2);
    pts.push(`${pts.length ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`);
  }
  // A single surviving point is a dot's worth of information and no line's.
  return pts.length >= 2 ? pts.join('') : null;
}
