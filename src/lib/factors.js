// factors.js — what your book is actually tilted towards, and what it is betting on.
//
// Two different questions live in this file and they are deliberately kept apart:
//
//   FACTORS are properties of a company measurable from its own numbers — is it
//   cheap, is it profitable, is it growing, has it been going up, does it pay you.
//   These are computed, and where the number is missing the answer is "unmeasured",
//   not "average".
//
//   THEMES are stories about what a company sells — AI, semiconductors, banking,
//   defence. These are matched from names and sectors, which means they are
//   sometimes wrong, so every theme exposure carries the list of holdings behind
//   it and the screen prints that list. A wrong match you can see is a small
//   problem; a wrong match hidden inside a percentage is a large one.
//
// Six decisions, each of which is a way this screen could quietly mislead:
//
// 1. A MISSING RATIO IS NOT A NEUTRAL SCORE. Scoring an unmeasured holding at 50
//    drags every portfolio total towards the middle, so a book nobody has data for
//    reads as perfectly balanced. Unmeasured holdings are excluded from the average
//    and their weight is reported separately as coverage.
//
// 2. SCORES ARE ABSOLUTE, NOT RANKED WITHIN YOUR OWN BOOK. Ranking always produces
//    a winner: ten expensive stocks would still show a "value leader". Every factor
//    is scored against stated bands, and the bands are printed on screen so the
//    number can be argued with.
//
// 3. THEMES OVERLAP AND DO NOT SUM TO 100%. One chip designer is AI *and*
//    semiconductors *and* possibly datacentre. Theme exposure is "share of the book
//    touching this theme" and must never be drawn as a pie, because a pie asserts
//    the slices are exclusive and exhaustive, and these are neither.
//
// 4. A TILT NEEDS A REFERENCE, AND OURS IS A STATED NEUTRAL. There is no market
//    factor data available here, so the comparison is against the midpoint of each
//    band — which is an arbitrary anchor and is labelled as one. It is not "versus
//    the market", and this file never says it is.
//
// 5. COVERAGE GATES THE CONCLUSION. Below a stated share of the book classified,
//    no tilt is reported at all. A tilt computed from a third of a portfolio is a
//    statement about that third.
//
// 6. CONCENTRATION IS A RISK STATEMENT, NOT A SELL SIGNAL. This file describes what
//    is there. It does not tell anyone what to hold, and nothing in it is advice.

const num = v => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

// Minimum share of the book, by value, that must be classified before a tilt is
// reported. Below this the screen says "not enough coverage" instead of a number.
export const MIN_COVERAGE = 0.5;

// ---------------------------------------------------------------------------
// Factor definitions. Each carries the metric it reads, the direction that counts
// as exposure, and the two anchors that map a raw value onto 0–100. The anchors
// are the argument — they are exported so the screen can print them.
// ---------------------------------------------------------------------------

// `lo` scores 0, `hi` scores 100. Where `invert` is true the mapping runs the
// other way: a LOW P/E is HIGH value exposure.
export const FACTORS = [
  {
    key: 'value', label: 'Value', color: 'var(--green)',
    metric: 'peBasicExclExtraTTM', invert: true, lo: 8, hi: 45,
    band: 'P/E of 8 or under scores 100; 45 or over scores 0',
    what: 'Cheap relative to what the company earns. A low score is not a fault — growth is paid for.',
  },
  {
    key: 'quality', label: 'Quality', color: 'var(--cyan)',
    metric: 'roeTTM', invert: false, lo: 5, hi: 35,
    band: 'Return on equity of 5% scores 0; 35% or over scores 100',
    what: 'How much profit the company makes on the capital shareholders left in it.',
  },
  {
    key: 'growth', label: 'Growth', color: 'var(--pink)',
    metric: 'revenueGrowthTTMYoy', invert: false, lo: 0, hi: 40,
    band: 'Flat revenue scores 0; 40% year-on-year or more scores 100',
    what: 'How fast the top line is moving. Says nothing about whether it is profitable growth.',
  },
  {
    key: 'momentum', label: 'Momentum', color: 'var(--orange)',
    metric: '52WeekPriceReturnDaily', invert: false, lo: -20, hi: 60,
    band: 'Down 20% over a year scores 0; up 60% or more scores 100',
    what: 'What the price has done, not what the company has done. The least fundamental thing here.',
  },
  {
    key: 'yield', label: 'Yield', color: 'var(--yellow)',
    metric: 'dividendYieldIndicatedAnnual', invert: false, lo: 0, hi: 5,
    band: 'No dividend scores 0; 5% or more scores 100',
    what: 'What the company hands back in cash. A high score often trades against growth.',
  },
  {
    key: 'lowvol', label: 'Low volatility', color: 'var(--purple)',
    metric: 'beta', invert: true, lo: 0.6, hi: 1.8,
    band: 'Beta of 0.6 or under scores 100; 1.8 or over scores 0',
    what: 'How much it moves when the market moves. Beta is backward-looking and changes.',
  },
];

// Decision 4: the anchor a tilt is measured against. It is the midpoint of the
// band, which is arbitrary, and the screen says so in those words.
export const NEUTRAL = 50;

export function scoreOne(factor, metric = {}) {
  const raw = num(metric?.[factor.metric]);
  // Decision 1: absence is absence. It does not become 50.
  if (raw == null) return { key: factor.key, raw: null, score: null };
  const { lo, hi, invert } = factor;
  const t = (raw - lo) / (hi - lo);
  const clamped = Math.max(0, Math.min(1, t));
  return { key: factor.key, raw, score: (invert ? 1 - clamped : clamped) * 100 };
}

// One holding's full factor row.
export function scoreHolding(metric = {}) {
  const out = {};
  for (const f of FACTORS) out[f.key] = scoreOne(f, metric);
  return out;
}

// ---------------------------------------------------------------------------
// Portfolio tilt: value-weighted, over the holdings that actually have the metric.
// ---------------------------------------------------------------------------

// `rows` is [{ ticker, name, value, metric }]. `value` is the market value of the
// position, which is the only sensible weight — an equal-weighted factor score
// says what you own a list of, not what you own.
export function portfolioTilt(rows = []) {
  const total = rows.reduce((s, r) => s + (num(r.value) || 0), 0);
  const out = {};
  for (const f of FACTORS) {
    let wsum = 0, w = 0;
    const missing = [];
    for (const r of rows) {
      const v = num(r.value) || 0;
      const s = scoreOne(f, r.metric);
      // Decision 1 again, at the aggregation step: an unmeasured holding leaves
      // the average alone rather than pulling it to the middle.
      if (s.score == null) { if (v > 0) missing.push(r.ticker); continue; }
      wsum += s.score * v; w += v;
    }
    out[f.key] = {
      key: f.key, label: f.label, color: f.color, band: f.band, what: f.what,
      score: w > 0 ? wsum / w : null,
      // Decision 5: coverage travels with every single score, not just the page.
      covered: total > 0 ? w / total : 0,
      missing,
      tilt: w > 0 ? wsum / w - NEUTRAL : null,
    };
  }
  return out;
}

// The one-line summary, which refuses to exist when coverage is too thin.
export function tiltSummary(tilt = {}) {
  const usable = FACTORS
    .map(f => tilt[f.key])
    .filter(t => t && t.score != null && t.covered >= MIN_COVERAGE);
  if (!usable.length) {
    return {
      readable: false,
      reason: 'not enough of the book has the data these scores are computed from',
      leans: [], against: [],
    };
  }
  const sorted = [...usable].sort((a, b) => b.tilt - a.tilt);
  return {
    readable: true,
    reason: null,
    // Only tilts of real size are named. A book scoring 53 on value is not a
    // value portfolio, and calling it one is how a rounding error becomes a story.
    leans: sorted.filter(t => t.tilt >= 12),
    against: sorted.filter(t => t.tilt <= -12).reverse(),
    strongest: sorted[0],
    weakest: sorted[sorted.length - 1],
  };
}

// ---------------------------------------------------------------------------
// Themes. Keyword matching, honestly labelled as such.
// ---------------------------------------------------------------------------

// Each theme is a set of patterns tested against the ticker, the company name and
// the sector. Deliberately broad rather than clever: a theme that misses is
// invisible, whereas a theme that over-matches is visible in the holdings list it
// prints, and visible is the failure mode to prefer.
export const THEMES = [
  { key: 'ai', label: 'AI & compute', color: 'var(--pink)',
    tickers: ['NVDA', 'AMD', 'AVGO', 'SMCI', 'PLTR', 'MSFT', 'GOOGL', 'GOOG', 'META', 'TSM', 'ARM', 'MU'],
    re: /\bA\.?I\b|artificial intelligence|machine learning|gpu|accelerat/i },
  { key: 'semis', label: 'Semiconductors', color: 'var(--cyan)',
    tickers: ['NVDA', 'AMD', 'INTC', 'TSM', 'AVGO', 'MU', 'QCOM', 'ASML', 'AMAT', 'LRCX', 'ARM', 'TXN'],
    re: /semiconduct|microchip|foundry|wafer/i },
  { key: 'cloud', label: 'Cloud & software', color: 'var(--purple)',
    tickers: ['MSFT', 'AMZN', 'GOOGL', 'GOOG', 'CRM', 'NOW', 'SNOW', 'DDOG', 'NET', 'ORCL', 'ADBE'],
    re: /cloud|software|saas|platform/i },
  { key: 'ev', label: 'EV & clean energy', color: 'var(--green)',
    tickers: ['TSLA', 'RIVN', 'LCID', 'ENPH', 'FSLR', 'SUZLON', 'TATAMOTORS'],
    re: /electric vehicle|solar|renewable|wind|battery|clean energy/i },
  { key: 'defence', label: 'Defence & aerospace', color: 'var(--orange)',
    tickers: ['LMT', 'RTX', 'NOC', 'GD', 'BA', 'HAL', 'BEL', 'HINDALCO'],
    re: /defen[cs]e|aerospace|aeronaut|missile|shipyard/i },
  { key: 'banks', label: 'Banks & financials', color: 'var(--yellow)',
    tickers: ['HDFCBANK', 'ICICIBANK', 'SBIN', 'AXISBANK', 'KOTAKBANK', 'INDUSINDBK', 'BANKBEES',
      'JPM', 'BAC', 'GS', 'MS', 'V', 'MA', 'PNB', 'BANKBARODA', 'YESBANK', 'BAJFINANCE'],
    re: /\bbank\b|financial|insur|lending|nbfc|payments?\b/i },
  { key: 'pharma', label: 'Pharma & healthcare', color: 'var(--cyan)',
    tickers: ['SUNPHARMA', 'CIPLA', 'DRREDDY', 'DIVISLAB', 'APOLLOHOSP', 'LLY', 'UNH', 'JNJ', 'PFE', 'MRK'],
    re: /pharma|health|hospital|biotech|medic/i },
  { key: 'consumer', label: 'Consumer', color: 'var(--pink)',
    tickers: ['HINDUNILVR', 'ITC', 'NESTLEIND', 'BRITANNIA', 'DMART', 'TITAN', 'TATACONSUM',
      'NKE', 'SBUX', 'MCD', 'KO', 'PEP', 'PG', 'ZOMATO', 'NYKAA'],
    re: /consumer|retail|food|bevera|apparel|restaurant/i },
  { key: 'energy', label: 'Energy & commodities', color: 'var(--orange)',
    tickers: ['RELIANCE', 'ONGC', 'COALINDIA', 'NTPC', 'POWERGRID', 'TATASTEEL', 'JSWSTEEL',
      'XOM', 'CVX', 'GLD', 'GOLDBEES'],
    re: /\boil\b|\bgas\b|petro|energy|steel|metal|mining|gold|power\b/i },
  { key: 'india', label: 'India broad market', color: 'var(--green)',
    tickers: ['NIFTYBEES', 'JUNIORBEES', 'ITBEES', 'MON100'],
    re: /nifty|sensex|india\b/i },
];

export function themesOf(holding = {}, meta = {}) {
  const t = String(holding.ticker || '').toUpperCase().replace(/\.(NS|BO|NSE|BSE)$/i, '');
  const hay = `${holding.ticker || ''} ${holding.name || ''} ${meta.sector || ''}`;
  return THEMES.filter(th => th.tickers.includes(t) || th.re.test(hay)).map(th => th.key);
}

// `rows` is [{ ticker, name, value, meta }]. Returns one entry per theme that
// matched anything, each carrying the holdings behind it so a bad match is visible.
export function themeExposure(rows = []) {
  const total = rows.reduce((s, r) => s + (num(r.value) || 0), 0);
  const out = [];
  for (const th of THEMES) {
    const hits = rows.filter(r => themesOf(r, r.meta || {}).includes(th.key));
    if (!hits.length) continue;
    const value = hits.reduce((s, r) => s + (num(r.value) || 0), 0);
    out.push({
      key: th.key, label: th.label, color: th.color,
      value,
      pct: total > 0 ? (value / total) * 100 : 0,
      holdings: hits.map(h => ({ ticker: h.ticker, name: h.name, value: num(h.value) || 0 }))
        .sort((a, b) => b.value - a.value),
    });
  }
  // Decision 3: these percentages overlap and will sum past 100. That is correct
  // and is the reason nothing downstream may draw them as a pie.
  return out.sort((a, b) => b.pct - a.pct);
}

// How badly the overlap breaks the "these are slices" reading — printed on screen
// so nobody tries to add the bars up.
export function themeOverlap(exposure = []) {
  const sum = exposure.reduce((s, e) => s + e.pct, 0);
  const counted = new Set();
  for (const e of exposure) for (const h of e.holdings) counted.add(h.ticker);
  return { sum, distinct: counted.size, overlapping: sum > 100.5 };
}

// A holding matching no theme at all. Worth naming rather than dropping: it is
// usually a cash-like or broad instrument, and occasionally it is a gap in the list.
export function untagged(rows = []) {
  return rows.filter(r => themesOf(r, r.meta || {}).length === 0)
    .map(r => ({ ticker: r.ticker, name: r.name, value: num(r.value) || 0 }))
    .sort((a, b) => b.value - a.value);
}

// Decision 6: concentration is described, never prescribed. The thresholds are
// conventional rules of thumb and are labelled as such wherever they are shown.
export function concentrationFlags(exposure = [], { warn = 30, heavy = 45 } = {}) {
  return exposure
    .filter(e => e.pct >= warn)
    .map(e => ({
      key: e.key, label: e.label, pct: e.pct,
      level: e.pct >= heavy ? 'heavy' : 'notable',
      // Phrased as an observation with a consequence, not as an instruction.
      note: e.pct >= heavy
        ? `${e.pct.toFixed(0)}% of the book moves with this one story. When it turns, most of the portfolio turns with it.`
        : `${e.pct.toFixed(0)}% of the book sits in one theme, which is enough for a single sector event to be felt across the whole portfolio.`,
    }));
}
