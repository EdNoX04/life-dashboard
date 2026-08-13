// The Desk — the facts you would want in front of you before deciding anything.
//
// This is the screen that most wants to become an advice engine, so the line is
// drawn in the code rather than in the copy. Everything here is a measurement,
// an attributed third-party opinion, or a rule Neel wrote himself. There is no
// function in this file that combines them, because the combining is the
// judgement, and the judgement is his.
//
// SIX RULES, EACH ONE A WAY THIS OTHERWISE FLATTERS OR MISLEADS
//
// 1. UNMEASURED IS NOT ZERO, AND IT IS NOT "DID NOT FIRE". Breadth reading
//    "12 up, 0 down" when seven holdings never got a quote is a claim about
//    nineteen positions built from twelve. Every count in this file carries the
//    number it could not measure, and every rule evaluation has three outcomes
//    — fired, did not fire, could not tell — not two.
//
// 2. ANALYST CALLS KEEP THEIR DISPERSION AND THEIR DATE. "Consensus: Buy" is a
//    summary that deletes the only informative part. Twenty-eight buys against
//    two sells and twelve buys against eleven sells are opposite situations and
//    the same word. So the counts travel together, a `divided` flag is computed
//    from them, and the period the brokers filed in is never dropped — a
//    four-month-old consensus on a stock that has moved 30% is a fact about
//    March.
//
// 3. A MEDIAN NEEDS A HISTORY. Valuation drift compares a multiple against the
//    same company's own past, which requires enough past for a median to mean
//    anything. Below MIN_HISTORY the function returns null rather than a
//    number, because "trading 40% above its median" computed from three
//    observations is a sentence with the authority of statistics and the
//    content of an anecdote.
//
// 4. THE RULES ARE HIS. The engine ships with no active rules at all. There are
//    templates, and adding one is an explicit act — because the moment this file
//    enables a threshold by default, that threshold is mine, and every fired
//    alert downstream is my opinion wearing his interface.
//
// 5. NOTHING HERE SYNTHESISES. There is deliberately no score, no grade, no
//    ranked "what to look at first" across categories. Such a row would be the
//    most authoritative thing on the screen and would have the least behind it:
//    a weighted mean whose weights I chose, burying the dispersion, the dates
//    and the unmeasured counts underneath a single number.
//
// 6. THE CLOCK IS HONEST ABOUT BEING A CLOCK. The scan runs on a timer while
//    the US market is open and stops when it closes. `nextScanAt` is pure so
//    the UI can print when the next one is due, and a stale scan says its age
//    rather than looking current.

const num = v => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export const MIN_HISTORY = 5;

// ---------------------------------------------------------------- breadth

/**
 * How much of the book is up today, and how much could not be measured.
 *
 * A position with no quote is not flat. It is unknown, and it is counted as
 * such — decision 1, and the reason this returns four numbers instead of two.
 */
export function breadth(rows = []) {
  let up = 0, down = 0, flat = 0, unmeasured = 0;
  let upValue = 0, downValue = 0;
  for (const r of rows) {
    const d = num(r?.dayPct);
    if (d == null) { unmeasured++; continue; }
    if (d > 0) { up++; upValue += num(r.value) || 0; }
    else if (d < 0) { down++; downValue += num(r.value) || 0; }
    else flat++;
  }
  const measured = up + down + flat;
  return {
    up, down, flat, unmeasured, measured, total: rows.length,
    upValue, downValue,
    // Share of the MEASURED positions, with `measured` alongside so the reader
    // can see what it is a share of.
    upPct: measured ? (up / measured) * 100 : null,
  };
}

/** Biggest movers by absolute day change, gainers and losers kept apart. */
export function movers(rows = [], limit = 5) {
  const withDay = rows.filter(r => num(r?.dayPct) != null);
  const sorted = [...withDay].sort((a, b) => b.dayPct - a.dayPct);
  return {
    gainers: sorted.filter(r => r.dayPct > 0).slice(0, limit),
    losers: sorted.filter(r => r.dayPct < 0).reverse().slice(0, limit),
    unmeasured: rows.length - withDay.length,
  };
}

// ------------------------------------------------------- 52-week position

/**
 * Where a price sits in its own 52-week range, 0 at the low and 100 at the high.
 *
 * Returns null on missing or nonsensical inputs rather than clamping. A high
 * below a low is corrupt data, and pinning it to 0 or 100 would turn a data
 * problem into a confident reading at one extreme of the range.
 */
export function rangePosition(price, low, high) {
  const p = num(price), lo = num(low), hi = num(high);
  if (p == null || lo == null || hi == null) return null;
  if (!(hi > lo)) return null;
  const pos = ((p - lo) / (hi - lo)) * 100;
  return Math.max(0, Math.min(100, pos));
}

// ------------------------------------------------------ analyst consensus

/**
 * Broker recommendations, kept as counts.
 *
 * `divided` is true when no camp holds a majority — the case where a one-word
 * summary would be actively misleading, and the case a reader most wants
 * flagged. It is arithmetic (no group over half), not a judgement about whether
 * disagreement is meaningful.
 */
export function consensus(rec) {
  if (!rec) return null;
  const buy = num(rec.buy) ?? 0, hold = num(rec.hold) ?? 0, sell = num(rec.sell) ?? 0;
  const total = buy + hold + sell;
  if (!total) return null;
  const pct = n => (n / total) * 100;
  const biggest = Math.max(buy, hold, sell);
  return {
    buy, hold, sell, total,
    buyPct: pct(buy), holdPct: pct(hold), sellPct: pct(sell),
    period: rec.period || null,
    divided: biggest <= total / 2,
    // Never collapsed to a verdict here. The UI prints the counts; this is only
    // the label for which camp is largest, and it is not the same thing as a
    // recommendation to this reader about this book.
    largest: biggest === buy ? 'buy' : biggest === sell ? 'sell' : 'hold',
  };
}

/** How stale a dated consensus is, in whole months. Null if undated. */
export function consensusAgeMonths(period, now = new Date()) {
  if (!period) return null;
  const d = new Date(period);
  if (Number.isNaN(+d)) return null;
  return Math.max(0, (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth()));
}

// -------------------------------------------------------- valuation drift

export function median(values = []) {
  const v = values.map(num).filter(x => x != null).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/**
 * A multiple against the same company's own past.
 *
 * Peer comparison is deliberately not offered. "Cheaper than its peers" needs a
 * peer set someone chose, and whoever chose it has made the argument before the
 * number is computed. A company against its own history needs no such choice.
 *
 * Returns null below MIN_HISTORY observations — see decision 3. `n` is returned
 * so the screen can print how thin the comparison is even when it passes.
 */
export function valuationDrift(history = [], current) {
  const pts = (history || [])
    .map(h => ({ period: h?.period ?? null, v: num(h?.v ?? h?.value ?? h) }))
    .filter(h => h.v != null && h.v > 0);
  const cur = num(current);
  if (cur == null || cur <= 0) return null;
  if (pts.length < MIN_HISTORY) {
    return { enough: false, n: pts.length, need: MIN_HISTORY, current: cur, median: null, vsMedian: null };
  }
  const med = median(pts.map(p => p.v));
  return {
    enough: true,
    n: pts.length,
    need: MIN_HISTORY,
    current: cur,
    median: med,
    vsMedian: med ? ((cur - med) / med) * 100 : null,
    from: pts[0].period,
    to: pts[pts.length - 1].period,
  };
}

// ------------------------------------------------- reading the saved blob

// Finnhub spells the price-to-earnings series several ways depending on the
// endpoint and the plan, and the ones it omits it omits silently. Each name is
// tried in turn rather than assuming one, because the failure of assuming is a
// permanently empty panel that looks like "this company has no history".
const PE_KEYS = ['peTTM', 'peBasicExclExtraTTM', 'peNormalizedAnnual', 'pe'];
const HIGH_KEYS = ['52WeekHigh', 'weekHigh52'];
const LOW_KEYS = ['52WeekLow', 'weekLow52'];

const firstOf = (obj, keys) => {
  for (const k of keys) {
    const v = obj?.[k];
    if (v != null && v !== '') return v;
  }
  return null;
};

/** The 52-week band out of a saved fundamentals entry, or nulls. */
export function bandOf(entry) {
  const m = entry?.metric || null;
  return { high: num(firstOf(m, HIGH_KEYS)), low: num(firstOf(m, LOW_KEYS)) };
}

/**
 * The multiple's own history, oldest first.
 *
 * Annual is preferred over quarterly: a quarterly P/E series swings on one
 * quarter's earnings and its median describes the noise as much as the level.
 */
export function peHistoryOf(entry) {
  const series = entry?.series || null;
  for (const bucket of ['annual', 'quarterly']) {
    const b = series?.[bucket];
    for (const k of PE_KEYS) {
      const arr = b?.[k];
      if (Array.isArray(arr) && arr.length) {
        return [...arr]
          .map(x => ({ period: x?.period ?? null, v: num(x?.v) }))
          .filter(x => x.v != null)
          .sort((a, b2) => String(a.period).localeCompare(String(b2.period)));
      }
    }
  }
  return [];
}

/** Today's multiple out of the same entry. */
export const currentPeOf = entry => num(firstOf(entry?.metric, PE_KEYS));

// ------------------------------------------------------------ rule engine

/**
 * What a rule may measure. Every metric is a number already on some other
 * screen, so a fired rule can always be checked against the thing it fired on.
 *
 * `unit` exists so the UI can render a threshold input that says what it wants.
 * `higherIsMore` is not a judgement about good or bad — it only tells the UI
 * which way round to phrase "above" and "below".
 */
export const METRICS = [
  { key: 'weight', label: 'Weight in book', unit: '%', view: 'book',
    note: 'The position as a share of the whole book, as the Book screen shows it.' },
  { key: 'trueWeight', label: 'True weight after unpacking funds', unit: '%', view: 'xray',
    note: 'The company as a share of the book once every fund is decomposed. Usually larger than the line above.' },
  { key: 'dayPct', label: 'Move today', unit: '%', view: 'portfolio',
    note: 'Change against the previous close.' },
  { key: 'rangePct', label: 'Position in 52-week range', unit: '/100', view: 'ticker',
    note: '0 sits at the 52-week low, 100 at the high.' },
  { key: 'unrealisedPct', label: 'Unrealised return', unit: '%', view: 'book',
    note: 'Against your own average cost. Null when no cost was recorded.' },
  { key: 'peVsMedian', label: 'Multiple vs its own median', unit: '%', view: 'fin',
    note: 'How far the current multiple sits from this company’s own historical median.' },
  { key: 'sellPct', label: 'Share of analysts saying sell', unit: '%', view: 'ticker',
    note: 'From the broker counts, not from any view of this app’s own.' },
];

export const METRIC = Object.fromEntries(METRICS.map(m => [m.key, m]));
export const OPS = { above: { label: 'is above', test: (v, t) => v > t },
  below: { label: 'is below', test: (v, t) => v < t } };

/**
 * Templates, offered and never enabled.
 *
 * Decision 4. These exist because a blank rule builder is a worse first
 * experience than a list of examples, and because writing "weight above 25"
 * from scratch requires knowing the metric keys. Adding one is a click Neel
 * makes; nothing here is active until he does, and the numbers are starting
 * points he can change rather than settings he has to notice and override.
 */
export const TEMPLATES = [
  { label: 'A position grew past a quarter of the book', metric: 'weight', op: 'above', value: 25 },
  { label: 'A company is past a quarter of the book once funds are unpacked', metric: 'trueWeight', op: 'above', value: 25 },
  { label: 'Something moved more than 5% today', metric: 'dayPct', op: 'above', value: 5 },
  { label: 'Something fell more than 5% today', metric: 'dayPct', op: 'below', value: -5 },
  { label: 'Trading in the top tenth of its 52-week range', metric: 'rangePct', op: 'above', value: 90 },
  { label: 'Trading in the bottom tenth of its 52-week range', metric: 'rangePct', op: 'below', value: 10 },
  { label: 'Multiple is 40% above its own median', metric: 'peVsMedian', op: 'above', value: 40 },
  { label: 'More than a fifth of analysts say sell', metric: 'sellPct', op: 'above', value: 20 },
];

export const ruleLabel = rule => {
  const m = METRIC[rule?.metric];
  const op = OPS[rule?.op];
  if (!m || !op) return 'Invalid rule';
  return `${m.label} ${op.label} ${rule.value}${m.unit === '%' ? '%' : ''}`;
};

export function validRule(rule) {
  return !!(rule && METRIC[rule.metric] && OPS[rule.op] && num(rule.value) != null);
}

/**
 * Run the rules over the book.
 *
 * THREE OUTCOMES, NOT TWO. A holding whose metric is missing lands in
 * `unmeasured`, never in "did not fire" — that distinction is the whole of
 * decision 1 applied to the part of this file most likely to be trusted
 * blindly. A screen reporting "no rules fired" while a third of the book had no
 * data for them is the reassuring failure this app keeps being built to refuse.
 */
export function evaluate(rules = [], rows = []) {
  const fired = [], unmeasured = [];
  const active = rules.filter(r => r && r.enabled !== false && validRule(r));

  for (const rule of active) {
    const op = OPS[rule.op];
    const threshold = num(rule.value);
    for (const row of rows) {
      const v = num(row?.[rule.metric]);
      if (v == null) { unmeasured.push({ rule, ticker: row?.ticker, metric: rule.metric }); continue; }
      if (op.test(v, threshold)) fired.push({ rule, ticker: row?.ticker, name: row?.name, value: v, threshold });
    }
  }

  // Ordered by how far past the threshold, in the metric's own units — the same
  // ordering rule the briefing uses, for the same reason: it is reproducible
  // from the numbers rather than from my ranking of what matters.
  fired.sort((a, b) => Math.abs(b.value - b.threshold) - Math.abs(a.value - a.threshold));

  const byRule = new Map(active.map(r => [r.id, { rule: r, hits: [], blind: 0 }]));
  for (const f of fired) byRule.get(f.rule.id)?.hits.push(f);
  for (const u of unmeasured) { const e = byRule.get(u.rule.id); if (e) e.blind++; }

  return {
    fired, unmeasured, active: active.length,
    byRule: [...byRule.values()],
    // How many rule-checks could not be answered at all, out of how many were
    // attempted. Printed next to the fired count, never underneath it.
    attempted: active.length * rows.length,
    blind: unmeasured.length,
  };
}

// ------------------------------------------------------------- the clock

export const SCAN_INTERVAL_MIN = 30;

/**
 * When the next scan is due, and whether one is owed right now.
 *
 * Pure, so the screen can print the time without owning a timer, and so this
 * can be tested without waiting half an hour. `marketOpen` is passed in rather
 * than read here — the market clock lives in live.js and having two of them is
 * how a screen ends up disagreeing with the header about whether it is Tuesday.
 */
export function nextScanAt(lastAt, { now = new Date(), intervalMin = SCAN_INTERVAL_MIN, marketOpen = true } = {}) {
  const last = lastAt ? new Date(lastAt) : null;
  const valid = last && !Number.isNaN(+last);
  if (!valid) return { due: true, at: null, inMs: 0, reason: 'never scanned' };
  const at = new Date(+last + intervalMin * 60000);
  const inMs = +at - +now;
  if (!marketOpen) {
    return { due: false, at, inMs, reason: 'the US market is closed — the next scan is when it opens' };
  }
  return { due: inMs <= 0, at, inMs, reason: inMs <= 0 ? 'due now' : 'waiting for the interval' };
}

/** Age of a scan in minutes, so a stale panel can say so instead of looking current. */
export function scanAge(lastAt, now = new Date()) {
  if (!lastAt) return null;
  const d = new Date(lastAt);
  if (Number.isNaN(+d)) return null;
  return Math.max(0, Math.round((+now - +d) / 60000));
}
