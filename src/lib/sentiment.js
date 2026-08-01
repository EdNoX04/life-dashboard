// Market sentiment — a fear/greed gauge built the auditable way.
//
// The reference gauge (CNN's) is a mean of seven components. Six of its seven
// inputs are data a personal app cannot buy: NYSE 52-week high/low counts,
// McClellan advancing/declining volume, exchange-wide put/call ratios. The
// tempting move is to fill those with 50 so the arithmetic still works. That
// produces a number that looks like a market reading and is actually a reading
// of how many things we failed to measure, pulled toward neutral. So:
//
// 1. A COMPONENT WITH NO DATA IS ABSENT, NOT NEUTRAL. Missing components are
//    dropped from the mean and the divisor shrinks. The gauge always prints how
//    many of the seven it actually had. A 4-of-7 reading is a weaker claim than
//    a 7-of-7 reading and the UI must let Neel see which one he got.
//
// 2. EVERY NUMBER CARRIES ITS FORMULA AND ITS BAND. Normalising "SPY is 3.1%
//    above its 125-day average" to 65 is only honest if the mapping is visible:
//    -10% scores 0, +10% scores 100, clamped, linear. A normalised number whose
//    band is printed is arithmetic. The same number without it is an opinion
//    wearing a number's clothes. Every component therefore exports `band` and
//    `explain(raw)` and the screen prints both.
//
// 3. THE MEAN IS UNWEIGHTED, DELIBERATELY. Weighting the components would mean
//    choosing which signal matters more, and there is no defensible source for
//    those weights — they would be mine, presented as the market's. An equal
//    mean is a stated, boring, checkable rule.
//
// 4. SCOPE IS PRINTED WHEN IT IS NARROWER THAN IT SOUNDS. "Day breadth" here is
//    breadth across the tickers Neel actually tracks, not across an exchange.
//    That is real data answering a smaller question, which is fine — as long as
//    the smaller question is the one written on the label.
//
// 5. NOTHING HERE IS ADVICE. The gauge reports what prices did. It does not say
//    buy, sell, or wait, and no function in this file returns a recommendation.

// ---------- session ----------

// live.js answers open/closed because that is all a websocket needs to know.
// Movers need the finer split: a 4pm-to-8pm move is a different claim from a
// 10am move, and calling both "today's movers" would blur them.
export function session(now = new Date()) {
  try {
    const p = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(now).reduce((a, x) => (a[x.type] = x.value, a), {});
    if (p.weekday === 'Sat' || p.weekday === 'Sun') return 'closed';
    const mins = (Number(p.hour) % 24) * 60 + Number(p.minute);
    if (mins >= 240 && mins < 570) return 'pre';    // 04:00–09:30
    if (mins >= 570 && mins < 960) return 'open';   // 09:30–16:00
    if (mins >= 960 && mins < 1200) return 'after'; // 16:00–20:00
    return 'closed';
  } catch { return 'closed'; }
}

export const SESSION_LABEL = {
  pre: 'Pre-market', open: 'Market open', after: 'After hours', closed: 'Market closed',
};

// ---------- small maths, stated once ----------

// The whole file's honesty rests on this one function. `+null`, `+''` and
// `+false` are all 0, so a naive Number.isFinite(+v) check turns every absent
// value into a real zero — a missing VIX becomes a VIX of 0, which is not a
// calm market, it is no market. Only numbers and non-empty numeric strings pass.
function num(v) {
  if (v === null || v === undefined || typeof v === 'boolean') return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  const n = +v;
  return Number.isFinite(n) ? n : null;
}

export function clamp(n, lo = 0, hi = 100) {
  if (!Number.isFinite(n)) return null;
  return Math.min(hi, Math.max(lo, n));
}

// Linear map from a measured band onto 0..100, clamped at the ends. This is the
// only normalisation in the file; every component states its own lo/hi and the
// screen prints them, so any score can be checked by hand.
export function scale(raw, lo, hi) {
  const r = num(raw);
  // hi may be LOWER than lo. Volatility declares [40, -40] on purpose: a VIX
  // above its own average is fear, and inverting the band states that in the
  // one place the band is written down, rather than hiding a minus sign inside
  // the arithmetic where nobody printing the band would see it.
  if (r === null || !Number.isFinite(lo) || !Number.isFinite(hi) || lo === hi) return null;
  return clamp(((r - lo) / (hi - lo)) * 100);
}

export function sma(closes, n) {
  if (!Array.isArray(closes) || closes.length < n || n <= 0) return null;
  let s = 0;
  for (let i = closes.length - n; i < closes.length; i++) {
    const v = num(closes[i]);
    if (v === null) return null;
    s += v;
  }
  return s / n;
}

// Percent change over the last n bars. Returns null rather than 0 when the
// series is too short — a flat reading and a missing reading are different
// facts and only one of them means "the market did nothing".
export function pctChange(closes, n) {
  if (!Array.isArray(closes) || closes.length < n + 1) return null;
  const a = num(closes[closes.length - 1 - n]);
  const b = num(closes[closes.length - 1]);
  if (a === null || b === null || a === 0) return null;
  return ((b - a) / a) * 100;
}

export const closesOf = candles =>
  (Array.isArray(candles) ? candles : []).map(c => num(c?.c)).filter(v => v !== null);

// ---------- the seven components ----------

// Each component owns: the symbols it needs, the arithmetic, the band it maps
// onto 0..100, and one line of plain English saying what it measures. `blocked`
// marks the ones no free data source can answer — they are declared here rather
// than quietly omitted, because "we cannot see this" is itself worth showing.
export const COMPONENTS = [
  {
    key: 'momentum',
    label: 'Momentum',
    why: 'Where the S&P 500 sits against its own 125-day average.',
    needs: ['SPY'],
    band: [-10, 10],
    unit: '%',
    scope: 'S&P 500 via SPY',
    raw(series) {
      const c = closesOf(series.SPY);
      const avg = sma(c, 125);
      const last = c[c.length - 1];
      if (avg === null || !Number.isFinite(last) || avg === 0) return null;
      return ((last - avg) / avg) * 100;
    },
    explain: r => `SPY is ${r >= 0 ? '' : '-'}${Math.abs(r).toFixed(1)}% ${r >= 0 ? 'above' : 'below'} its 125-day average`,
  },
  {
    key: 'volatility',
    label: 'Volatility',
    why: 'The VIX against its own 50-day average — calm reads as greed.',
    needs: ['VIX'],
    // Inverted on purpose: a VIX above its average is fear, so the band runs
    // high-to-low. Stating the inversion in the band beats hiding it in a sign.
    band: [40, -40],
    unit: '%',
    scope: 'CBOE VIX',
    raw(series) {
      const c = closesOf(series.VIX);
      const avg = sma(c, 50);
      const last = c[c.length - 1];
      if (avg === null || !Number.isFinite(last) || avg === 0) return null;
      return ((last - avg) / avg) * 100;
    },
    explain: r => `VIX is ${Math.abs(r).toFixed(0)}% ${r >= 0 ? 'above' : 'below'} its 50-day average`,
  },
  {
    key: 'safeHaven',
    label: 'Safe Haven',
    why: 'Stocks minus bonds over 20 days. Money leaving bonds for stocks reads as greed.',
    needs: ['SPY', 'TLT'],
    band: [-6, 6],
    unit: 'pts',
    scope: 'SPY vs TLT, 20 sessions',
    raw(series) {
      const s = pctChange(closesOf(series.SPY), 20);
      const t = pctChange(closesOf(series.TLT), 20);
      if (s === null || t === null) return null;
      return s - t;
    },
    explain: r => `stocks beat long bonds by ${r.toFixed(1)} points over 20 sessions`,
  },
  {
    key: 'junkBonds',
    label: 'Junk Bonds',
    why: 'Junk debt against investment grade. Investors reaching for risky debt reads as greed.',
    needs: ['HYG', 'LQD'],
    band: [-3, 3],
    unit: 'pts',
    scope: 'HYG vs LQD, 20 sessions',
    raw(series) {
      const h = pctChange(closesOf(series.HYG), 20);
      const l = pctChange(closesOf(series.LQD), 20);
      if (h === null || l === null) return null;
      return h - l;
    },
    explain: r => `junk debt beat investment grade by ${r.toFixed(1)} points`,
  },
  {
    key: 'dayBreadth',
    label: 'Day Breadth',
    // Decision 4. The reference gauge measures an entire exchange. This measures
    // Neel's own list, which is a different and much smaller question, so the
    // label says so rather than letting "breadth" imply the market.
    why: 'How many of the tickers you track are up today, not how many on the exchange.',
    needs: [],
    band: [20, 80],
    unit: '% up',
    scope: 'your tracked tickers only',
    narrow: true,
    raw(series, ctx = {}) {
      const q = ctx.quotes || {};
      const ts = Object.keys(q);
      let up = 0, n = 0;
      for (const t of ts) {
        const dp = num(q[t]?.changePct);
        if (dp === null) continue;
        n++;
        if (dp > 0) up++;
      }
      // Under five names the percentage swings 20 points per stock, which is
      // noise wearing a statistic's clothes.
      if (n < 5) return null;
      return (up / n) * 100;
    },
    explain: r => `${r.toFixed(0)}% of your tracked tickers are up`,
  },
  {
    key: 'strength',
    label: 'Price Strength',
    why: 'Stocks at 52-week highs versus lows across the NYSE.',
    needs: [],
    blocked: 'Needs exchange-wide high/low counts — no free feed publishes them.',
    scope: 'NYSE',
  },
  {
    key: 'breadth',
    label: 'Price Breadth',
    why: 'Volume in rising stocks against volume in falling ones (McClellan).',
    needs: [],
    blocked: 'Needs advancing/declining volume for a whole exchange — not in any free feed.',
    scope: 'NYSE',
  },
];

// Every distinct symbol the computable components need, in one list, so the
// loader can pace them against the 8-requests-per-minute free tier.
export const SYMBOLS = [...new Set(COMPONENTS.flatMap(c => c.needs || []))];

export const TOTAL_COMPONENTS = COMPONENTS.length;

// ---------- zones ----------

// Fixed cut points, stated once. They are the reference gauge's own bands, kept
// so a reading here means the same thing a reading there does.
export const ZONES = [
  { key: 'extreme-fear', label: 'EXTREME FEAR', lo: 0, hi: 25, color: 'var(--red)' },
  { key: 'fear', label: 'FEAR', lo: 25, hi: 45, color: 'var(--orange)' },
  { key: 'neutral', label: 'NEUTRAL', lo: 45, hi: 55, color: 'var(--yellow)' },
  { key: 'greed', label: 'GREED', lo: 55, hi: 75, color: 'var(--cyan)' },
  { key: 'extreme-greed', label: 'EXTREME GREED', lo: 75, hi: 100, color: 'var(--green)' },
];

export function zoneOf(score) {
  const s = num(score);
  if (s === null) return null;
  return ZONES.find(z => s >= z.lo && s < z.hi) || ZONES[ZONES.length - 1];
}

// ---------- the gauge ----------

// series: { SPY: candles[], TLT: candles[], ... }
// ctx:    { quotes } for the components that read live prices instead of history
export function computeSentiment(series, ctx) {
  const S = series || {}, C = ctx || {};
  const rows = COMPONENTS.map(c => {
    if (c.blocked) {
      return {
        key: c.key, label: c.label, why: c.why, scope: c.scope, narrow: !!c.narrow,
        state: 'blocked', reason: c.blocked, raw: null, score: null, band: null, detail: null,
      };
    }
    let raw = null;
    try { raw = c.raw(S, C); } catch { raw = null; }
    if (raw === null) {
      return {
        key: c.key, label: c.label, why: c.why, scope: c.scope, narrow: !!c.narrow,
        state: 'nodata',
        // Named symbols, so "missing" is actionable rather than mysterious.
        reason: c.needs.length ? `No usable history for ${c.needs.join(', ')} yet.` : 'Not enough tickers with a live quote yet.',
        raw: null, score: null, band: c.band, detail: null,
      };
    }
    const score = scale(raw, c.band[0], c.band[1]);
    return {
      key: c.key, label: c.label, why: c.why, scope: c.scope, narrow: !!c.narrow,
      state: 'ok', reason: null, raw, score, band: c.band, unit: c.unit,
      detail: c.explain(raw),
    };
  });

  const live = rows.filter(r => r.state === 'ok');
  // Decision 1: the divisor is the number of components that answered, and it
  // travels with the score everywhere it goes.
  const score = live.length
    ? Math.round(live.reduce((a, r) => a + r.score, 0) / live.length)
    : null;

  return {
    score,
    zone: zoneOf(score),
    rows,
    have: live.length,
    total: COMPONENTS.length,
    blocked: rows.filter(r => r.state === 'blocked').length,
    missing: rows.filter(r => r.state === 'nodata').length,
    // The sentence the screen prints under the number. It never says "market
    // sentiment is X" without saying what X was measured from.
    basis: live.length
      ? `Equal-weighted mean of ${live.length} of ${COMPONENTS.length} components: ${live.map(r => r.label).join(', ')}.`
      : `No component has data yet — nothing is being averaged, so there is no reading.`,
  };
}

// ---------- movers ----------

// Scoped to what the app already knows. There is no "top gainers on the NYSE"
// here because there is no feed for it, and inventing one from a 30-ticker book
// would be a market claim made from a watchlist.
export function movers(quotes, meta, limit = 8) {
  const rows = [];
  // Default parameters do not fire for an explicit null, and a caller handing
  // over `quotes` straight from a store that has not loaded yet passes null.
  const qs = quotes || {}, m = meta || {};
  for (const [t, q] of Object.entries(qs)) {
    const dp = num(q?.changePct);
    const price = num(q?.price);
    if (dp === null || price === null) continue;
    rows.push({
      ticker: t,
      name: m[t]?.name || null,
      price,
      change: num(q?.change),
      changePct: dp,
      held: !!m[t]?.held,
    });
  }
  const sorted = [...rows].sort((a, b) => b.changePct - a.changePct);
  const gainers = sorted.filter(r => r.changePct > 0).slice(0, limit);
  // Sorted from the worst upward, so the biggest loser is the first row on both
  // sides. Slicing the tail of the ascending list would put it last, and the eye
  // reads the top of a column first.
  const losers = [...sorted].reverse().filter(r => r.changePct < 0).slice(0, limit);
  return {
    gainers, losers,
    counted: rows.length,
    flat: rows.length - gainers.length - losers.length,
  };
}

export function moversTitle(sess = session()) {
  if (sess === 'after') return 'After-hours movers';
  if (sess === 'pre') return 'Pre-market movers';
  if (sess === 'open') return 'Movers today';
  return 'Movers at the close';
}

// Said out loud under the movers list. During a closed session the numbers are
// the last session's, and a list that looks live but is a day old is worse than
// a list that says so.
export function moversNote(sess = session(), counted = 0) {
  const scope = `across the ${counted} ticker${counted === 1 ? '' : 's'} you track`;
  if (sess === 'open') return `Live, ${scope}.`;
  if (sess === 'after') return `Since the 4pm close, ${scope}. Free feeds update after-hours slowly.`;
  if (sess === 'pre') return `Against yesterday's close, ${scope}.`;
  return `Final numbers from the last session, ${scope}.`;
}

// ---------- gauge geometry ----------

// The arc is drawn from these, not from magic numbers in JSX, so the needle and
// the coloured bands can never drift apart: both are derived from one mapping.
export const ARC = { cx: 150, cy: 132, r: 104, start: 180, end: 360 };

export const angleFor = score => {
  const s = clamp(num(score) ?? 0);
  return ARC.start + (s / 100) * (ARC.end - ARC.start);
};

export function polar(cx, cy, r, deg) {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

// SVG arc path between two scores on the dial.
export function arcPath(fromScore, toScore, r = ARC.r) {
  const a = polar(ARC.cx, ARC.cy, r, angleFor(fromScore));
  const b = polar(ARC.cx, ARC.cy, r, angleFor(toScore));
  const large = Math.abs(angleFor(toScore) - angleFor(fromScore)) > 180 ? 1 : 0;
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
}
