// Head-to-head stock comparison.
//
// Six decisions this file is built around, because each one is easy to get
// quietly wrong and each one produces a confident, wrong screen when you do:
//
// 1. A metric only counts if EVERY side reports it. Crowning a winner on a row
//    where two of four companies are blank is not a comparison, it is a ranking
//    of who files on time. Those rows still render — the numbers are real — but
//    they carry no winner and they are excluded from the tally.
//
// 2. Direction is per metric, not global. Lower P/E is cheaper; lower ROE is
//    worse. And some metrics have no better direction at all: beta and dividend
//    yield describe what a company IS, not how well it is doing. Those rows
//    never crown anyone, no matter how complete their coverage.
//
// 3. Price series are rebased to the window they SHARE, not to each one's own
//    first day. A company listed two years ago must not appear to have been
//    flat for the three years before that, and it must not be handed the chart's
//    start line as though it had been there all along.
//
// 4. A percentage difference against a zero or negative base is not a
//    percentage difference. A company losing money has no meaningful P/E, so
//    "300% cheaper than the other one" is arithmetic on nonsense.
//
// 5. The tally reports its own denominator. "Wins 3" means nothing; "wins 3 of
//    the 5 metrics all four report" is a claim you can check.
//
// 6. None of this is advice. Every number here answers "what is", never "what
//    should you do".

const num = v => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

// `dir` is which way is better: 'low', 'high', or 'none' for the descriptive
// ones that are not a contest.
export const COMPARE_METRICS = [
  { key: 'peTTM', label: 'P/E (TTM)', dir: 'low', fmt: 'x', hint: 'Price per unit of the last year of earnings. Cheaper is lower — but cheap and struggling look identical here.' },
  { key: 'psTTM', label: 'P/S (TTM)', dir: 'low', fmt: 'x', hint: 'Price against revenue. Still works when earnings are negative.' },
  { key: 'pbAnnual', label: 'P/B', dir: 'low', fmt: 'x', hint: 'Price against book value.' },
  { key: 'roeTTM', label: 'ROE %', dir: 'high', fmt: '%', hint: 'What the company earns on shareholders’ money.' },
  { key: 'netProfitMarginTTM', label: 'Net margin %', dir: 'high', fmt: '%', hint: 'How much of each unit of revenue survives to the bottom line.' },
  { key: 'revenueGrowthTTMYoy', label: 'Revenue growth %', dir: 'high', fmt: '%', hint: 'Top line, year on year.' },
  { key: 'currentRatioAnnual', label: 'Current ratio', dir: 'high', fmt: 'x', hint: 'Short-term assets over short-term debts. Under 1 is a squeeze.' },
  { key: 'totalDebt/totalEquityAnnual', label: 'Debt / equity', dir: 'low', fmt: 'x', hint: 'Leverage. High is not automatically bad, but it is automatically fragile.' },
  // Decision 2: descriptive, not a contest. A beta of 0.4 is not "better" than
  // 1.3 — it is a different thing to own.
  { key: 'beta', label: 'Beta', dir: 'none', fmt: 'x', hint: 'How hard it moves when the market moves. 1 is the market. Neither end is better; they are different jobs.' },
  { key: 'dividendYieldIndicatedAnnual', label: 'Dividend yield %', dir: 'none', fmt: '%', hint: 'Annual payout against price. A high yield can mean a generous company or a falling one.' },
];

export const METRIC_BY_KEY = Object.fromEntries(COMPARE_METRICS.map(m => [m.key, m]));

// ---- the grid ------------------------------------------------------------

// entries: [{ ticker, name, price, changePct, marketCap, metric, mine }]
// Returns one row per metric, in COMPARE_METRICS order, each carrying every
// side's value plus who wins — or null, loudly, when nobody can.
export function compareRows(entries = [], keys = null) {
  const sides = entries.filter(e => e && e.ticker);
  const want = keys && keys.length ? keys : COMPARE_METRICS.map(m => m.key);

  return want.map(k => {
    const m = METRIC_BY_KEY[k] || { key: k, label: k, dir: 'none', fmt: 'x' };
    const values = Object.fromEntries(sides.map(s => [s.ticker, num(s.metric?.[k])]));
    const have = sides.filter(s => values[s.ticker] != null);

    // Decision 1: complete means EVERY side, not "enough of them".
    const complete = have.length === sides.length && sides.length >= 2;
    const contested = complete && m.dir !== 'none';

    let best = null, worst = null, spread = null;
    if (contested) {
      const sorted = have
        .map(s => ({ t: s.ticker, v: values[s.ticker] }))
        .sort((a, b) => (m.dir === 'low' ? a.v - b.v : b.v - a.v));
      // A tie has no winner. Two identical numbers are a fact about the pair,
      // not a victory for whichever one the sort happened to put first.
      if (sorted.length > 1 && sorted[0].v !== sorted[1].v) best = sorted[0].t;
      const last = sorted[sorted.length - 1];
      if (sorted.length > 1 && last.v !== sorted[sorted.length - 2].v) worst = last.t;
      spread = { min: Math.min(...sorted.map(x => x.v)), max: Math.max(...sorted.map(x => x.v)) };
    }

    return {
      key: k, label: m.label, dir: m.dir, fmt: m.fmt, hint: m.hint,
      values, coverage: have.length, of: sides.length,
      complete, contested, best, worst, spread,
    };
  });
}

// Decision 5: the tally always states what it was counted out of, and it counts
// only rows where a winner was actually available to be won.
export function tally(rows = [], entries = []) {
  const contested = rows.filter(r => r.contested);
  const scored = contested.filter(r => r.best != null);
  return {
    of: contested.length,
    ties: contested.length - scored.length,
    // How many rows were dropped for incomplete coverage — shown on screen so a
    // thin comparison cannot pass itself off as a thorough one.
    skipped: rows.filter(r => !r.complete).length,
    total: rows.length,
    rows: entries.filter(e => e && e.ticker).map(e => ({
      ticker: e.ticker,
      name: e.name || e.ticker,
      wins: scored.filter(r => r.best === e.ticker).length,
      losses: scored.filter(r => r.worst === e.ticker).length,
    })).sort((a, b) => b.wins - a.wins || a.ticker.localeCompare(b.ticker)),
  };
}

// Decision 4: guard the base. Against zero or a negative there is no percentage
// to report, and reporting one anyway is how a loss-making company ends up
// described as infinitely cheap.
export function relDiff(mine, other) {
  const a = num(mine), b = num(other);
  if (a == null || b == null || b === 0 || b < 0 || a < 0) return null;
  return ((a - b) / b) * 100;
}

// ---- the chart -----------------------------------------------------------

// Decision 3. seriesMap: { TICKER: [{t, c}] }. Everything is trimmed to the
// window every series covers, then rebased to 100 at that shared start, so the
// lines answer "since the day they were all quotable, who is up more".
export function commonWindow(seriesMap = {}) {
  const lists = Object.entries(seriesMap)
    .map(([t, s]) => [t, (s || []).filter(p => p && num(p.c) != null && num(p.t) != null)])
    .filter(([, s]) => s.length >= 2);
  if (lists.length < 1) return null;
  const from = Math.max(...lists.map(([, s]) => Number(s[0].t)));
  const to = Math.min(...lists.map(([, s]) => Number(s[s.length - 1].t)));
  if (!(to > from)) return null;
  return { from, to, tickers: lists.map(([t]) => t) };
}

export function rebaseAll(seriesMap = {}, at = 100) {
  const win = commonWindow(seriesMap);
  if (!win) return null;
  const out = {};
  for (const t of win.tickers) {
    const pts = (seriesMap[t] || [])
      .filter(p => p && num(p.c) != null && Number(p.t) >= win.from && Number(p.t) <= win.to)
      .map(p => ({ t: Number(p.t), c: Number(p.c) }));
    if (pts.length < 2) continue;
    const base = pts[0].c;
    if (!(base > 0)) continue;      // a zero base is a division, not a baseline
    out[t] = pts.map(p => ({ t: p.t, v: (p.c / base) * at, c: p.c }));
  }
  const tickers = Object.keys(out);
  if (!tickers.length) return null;
  return {
    from: win.from, to: win.to, tickers, series: out,
    // What each line actually returned over the shared window — the number the
    // chart is a picture of, so the two can never disagree.
    change: Object.fromEntries(tickers.map(t => {
      const s = out[t];
      return [t, ((s[s.length - 1].v - at) / at) * 100];
    })),
  };
}

// Path geometry for the rebased lines, all on one shared scale — because two
// charts with two different y-axes side by side is the classic way to make a
// worse performer look like a better one.
export function chartPaths(rebased, w = 640, h = 190, pad = 4) {
  if (!rebased) return null;
  const all = rebased.tickers.flatMap(t => rebased.series[t].map(p => p.v));
  let lo = Math.min(...all), hi = Math.max(...all);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  if (hi === lo) { lo -= 1; hi += 1; }        // a dead-flat pair still needs a box
  const span = rebased.to - rebased.from || 1;
  const x = t => pad + ((t - rebased.from) / span) * (w - pad * 2);
  const y = v => h - pad - ((v - lo) / (hi - lo)) * (h - pad * 2);

  return {
    w, h, lo, hi,
    // Where 100 sits — the line every series started on.
    baseY: lo <= 100 && hi >= 100 ? y(100) : null,
    paths: rebased.tickers.map(t => ({
      ticker: t,
      d: rebased.series[t].map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(''),
      end: { x: x(rebased.series[t][rebased.series[t].length - 1].t), y: y(rebased.series[t][rebased.series[t].length - 1].v) },
      change: rebased.change[t],
    })),
  };
}

// Four is the ceiling on purpose. A fifth line is not more information, it is
// less — nobody reads a five-way ratio table, and the colours run out.
export const MAX_SIDES = 4;
export const SIDE_COLORS = ['var(--cyan)', 'var(--pink)', 'var(--yellow)', 'var(--purple)'];

export function fmtMetric(v, fmt) {
  const n = num(v);
  if (n == null) return '—';
  if (fmt === '%') return `${n.toFixed(2)}%`;
  return n.toFixed(2);
}
