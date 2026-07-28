// Strategised market scanning (spec 18).
//
// A screener is the single easiest thing in a finance app to misread, because
// its output looks like a recommendation no matter what is written underneath
// it. A column of tickers with green ticks next to them IS a buy list to the
// eye, and a paragraph at the bottom saying "this is not advice" does not undo
// what the layout already said.
//
// So the module is built so that the *rule* is the primary object and the
// ticker is secondary. You do not ask "what should I buy"; you ask "which of
// the names I follow currently satisfy these five stated conditions, and which
// conditions did each one fail?"
//
// Six decisions, each of which has a negative assertion behind it:
//
//   1. A screen filters a STATED universe; it never searches "the market".
//      The app has no market feed and no coverage list. What it has is the
//      names you hold plus the names on the leaderboard, and the count is
//      printed next to every result. A list of six names implies a market of
//      six, and pretending otherwise is the first lie a screener tells.
//
//   2. Unknown is not fail. A rule that could not be evaluated returns
//      'unknown', and a name is never dropped for missing data — it is listed
//      separately with the missing input named. Otherwise the screen silently
//      rewards whichever tickers happen to have a fundamentals cache entry,
//      which is a fact about your API usage, not about the companies.
//
//   3. Both sides are shown. Every result carries the rules it FAILED next to
//      the rules it passed. A card listing only the passes is a verdict wearing
//      a filter's clothes.
//
//   4. Rank is a count, not a score, and ties stay tied. There is no
//      tiebreaker anywhere in this file. Four names matching three of five
//      rules are all first, and the screen says four are tied. Sorting them
//      by anything at all would invent a preference the rules do not contain.
//
//   5. A match has an expiry condition, not a target. Every rule carries the
//      literal inverse of itself — "stops matching above a P/E of 20" — which
//      is a fact about the rule. There is no entry price, no target, no stop
//      and no position size in this module, and there never will be: those are
//      the four things that turn a filter into advice.
//
//   6. Every scan is stamped with the age of its oldest input. A momentum rule
//      run on three-week-old candles is a true statement about three weeks ago,
//      and a screen that does not say so is presenting it as a statement about
//      now.

import { closes, sma, rsi, macd, volumeTrend } from './technicals.js';

const num = v => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

export const PASS = 'pass';
export const FAIL = 'fail';
export const UNKNOWN = 'unknown';

// ---- rules ---------------------------------------------------------------
//
// Every rule states its own threshold in words (`rule`) and its own inverse
// (`ends`). Both strings are rendered; neither is derived at the render layer,
// because a threshold printed in one place and applied in another is a
// threshold that drifts.

const mk = (id, label, need, rule, ends, fn) => ({ id, label, need, rule, ends, test: ctx => {
  const r = fn(ctx);
  return { id, label, rule, ends, need, state: r[0], text: r[1] };
} });

const M = (ctx, key) => num(ctx?.metric?.[key]);

const miss = what => [UNKNOWN, `${what} is not in the saved data for this name.`];

const pct = n => `${n >= 0 ? '' : '−'}${Math.abs(n).toFixed(1)}%`;

export const RULES = [
  mk('pe.cheap', 'Modest multiple', 'metric',
    'Trailing P/E at or under 20',
    'the P/E rising above 20',
    ctx => {
      const v = M(ctx, 'peTTM');
      if (v == null) return miss('Trailing P/E');
      // A negative P/E is a loss, not a bargain, and the two must not share a branch.
      if (v <= 0) return [FAIL, `Earnings are negative, so the P/E of ${v.toFixed(1)} is not a multiple of anything.`];
      return [v <= 20 ? PASS : FAIL, `Trailing P/E is ${v.toFixed(1)}.`];
    }),

  mk('pe.rich', 'Stretched multiple', 'metric',
    'Trailing P/E above 40',
    'the P/E falling back to 40 or below',
    ctx => {
      const v = M(ctx, 'peTTM');
      if (v == null) return miss('Trailing P/E');
      if (v <= 0) return [UNKNOWN, `Earnings are negative, so "expensive on earnings" cannot be measured here.`];
      return [v > 40 ? PASS : FAIL, `Trailing P/E is ${v.toFixed(1)}.`];
    }),

  mk('roe.strong', 'Return on equity', 'metric',
    'Return on equity at or above 15%',
    'return on equity falling below 15%',
    ctx => {
      const v = M(ctx, 'roeTTM');
      if (v == null) return miss('Return on equity');
      return [v >= 15 ? PASS : FAIL, `Return on equity is ${pct(v)}.`];
    }),

  mk('margin.solid', 'Net margin', 'metric',
    'Net profit margin at or above 10%',
    'the net margin falling below 10%',
    ctx => {
      const v = M(ctx, 'netProfitMarginTTM');
      if (v == null) return miss('Net profit margin');
      return [v >= 10 ? PASS : FAIL, `Net margin is ${pct(v)}.`];
    }),

  mk('growth.rev', 'Revenue growth', 'metric',
    'Revenue up 10% or more year on year',
    'revenue growth slowing below 10%',
    ctx => {
      const v = M(ctx, 'revenueGrowthTTMYoy');
      if (v == null) return miss('Year-on-year revenue growth');
      return [v >= 10 ? PASS : FAIL, `Revenue is ${pct(v)} year on year.`];
    }),

  mk('growth.eps', 'Earnings growth', 'metric',
    'Earnings per share up 10% or more year on year',
    'earnings growth slowing below 10%',
    ctx => {
      const v = M(ctx, 'epsGrowthTTMYoy');
      if (v == null) return miss('Year-on-year EPS growth');
      return [v >= 10 ? PASS : FAIL, `EPS is ${pct(v)} year on year.`];
    }),

  mk('debt.low', 'Balance sheet', 'metric',
    'Total debt no more than equity (D/E at or under 1.0)',
    'debt rising past equity',
    ctx => {
      const v = M(ctx, 'totalDebt/totalEquityQuarterly');
      if (v == null) return miss('Debt to equity');
      return [v <= 1 ? PASS : FAIL, `Debt to equity is ${v.toFixed(2)}.`];
    }),

  mk('yield.pays', 'Pays a dividend', 'metric',
    'Indicated dividend yield at or above 2%',
    'the yield falling below 2%, which a rising price alone can do',
    ctx => {
      const v = M(ctx, 'dividendYieldIndicatedAnnual');
      if (v == null) return miss('Indicated dividend yield');
      return [v >= 2 ? PASS : FAIL, `Indicated yield is ${pct(v)}.`];
    }),

  mk('beta.calm', 'Moves less than the index', 'metric',
    'Beta at or under 1.0',
    'beta rising above 1.0',
    ctx => {
      const v = M(ctx, 'beta');
      if (v == null) return miss('Beta');
      return [v <= 1 ? PASS : FAIL, `Beta is ${v.toFixed(2)}.`];
    }),

  mk('near.low', 'Near its 52-week low', 'price',
    'Price within 15% of the 52-week low',
    'the price rising more than 15% above the low',
    ctx => {
      const lo = M(ctx, '52WeekLow'), p = num(ctx?.price);
      if (lo == null) return miss('The 52-week low');
      if (p == null) return [UNKNOWN, 'There is no current price for this name.'];
      if (!(lo > 0)) return [UNKNOWN, 'The saved 52-week low is zero, which cannot be a distance from.'];
      const d = ((p - lo) / lo) * 100;
      return [d <= 15 ? PASS : FAIL, `Price is ${pct(d)} above the 52-week low.`];
    }),

  mk('near.high', 'Near its 52-week high', 'price',
    'Price within 5% of the 52-week high',
    'the price falling more than 5% below the high',
    ctx => {
      const hi = M(ctx, '52WeekHigh'), p = num(ctx?.price);
      if (hi == null) return miss('The 52-week high');
      if (p == null) return [UNKNOWN, 'There is no current price for this name.'];
      if (!(hi > 0)) return [UNKNOWN, 'The saved 52-week high is zero, which cannot be a distance from.'];
      const d = ((hi - p) / hi) * 100;
      return [d <= 5 ? PASS : FAIL, `Price is ${pct(d)} below the 52-week high.`];
    }),

  // ---- the candle rules ---------------------------------------------------
  // These need history nobody has loaded yet on first open, and decision 2 is
  // what makes that survivable: they come back UNKNOWN and say which button
  // would fix it, rather than failing every name that has not been fetched.

  mk('trend.up', 'Above its 200-day average', 'candles',
    'Latest close above the 200-day moving average',
    'the close dropping back under the 200-day average',
    ctx => {
      const c = closes(ctx?.candles || []);
      if (c.length < 200) return [UNKNOWN, `Needs 200 days of closes; ${c.length ? `there are ${c.length}` : 'none are loaded'}.`];
      const s = sma(c, 200), v = s[s.length - 1], p = c[c.length - 1];
      if (v == null || p == null) return [UNKNOWN, 'The 200-day average could not be computed from this history.'];
      return [p > v ? PASS : FAIL, `Close is ${pct(((p - v) / v) * 100)} against the 200-day average.`];
    }),

  mk('trend.cross', '50-day above the 200-day', 'candles',
    'The 50-day moving average sitting above the 200-day',
    'the 50-day crossing back below the 200-day',
    ctx => {
      const c = closes(ctx?.candles || []);
      if (c.length < 200) return [UNKNOWN, `Needs 200 days of closes; ${c.length ? `there are ${c.length}` : 'none are loaded'}.`];
      const a = sma(c, 50), b = sma(c, 200);
      const av = a[a.length - 1], bv = b[b.length - 1];
      if (av == null || bv == null) return [UNKNOWN, 'One of the two averages could not be computed.'];
      return [av > bv ? PASS : FAIL, `The 50-day is ${pct(((av - bv) / bv) * 100)} against the 200-day.`];
    }),

  mk('rsi.washed', 'RSI in the washed-out zone', 'candles',
    'RSI(14) at or below 35',
    'RSI recovering above 35',
    ctx => {
      const c = closes(ctx?.candles || []);
      if (c.length < 15) return [UNKNOWN, `Needs 15 days of closes; ${c.length ? `there are ${c.length}` : 'none are loaded'}.`];
      const r = rsi(c), v = r[r.length - 1];
      if (v == null) return [UNKNOWN, 'RSI could not be computed from this history.'];
      return [v <= 35 ? PASS : FAIL, `RSI is ${v.toFixed(0)}.`];
    }),

  mk('rsi.hot', 'RSI in the stretched zone', 'candles',
    'RSI(14) at or above 70',
    'RSI cooling below 70',
    ctx => {
      const c = closes(ctx?.candles || []);
      if (c.length < 15) return [UNKNOWN, `Needs 15 days of closes; ${c.length ? `there are ${c.length}` : 'none are loaded'}.`];
      const r = rsi(c), v = r[r.length - 1];
      if (v == null) return [UNKNOWN, 'RSI could not be computed from this history.'];
      return [v >= 70 ? PASS : FAIL, `RSI is ${v.toFixed(0)}.`];
    }),

  mk('macd.up', 'MACD above its signal', 'candles',
    'The MACD histogram above zero',
    'the histogram crossing back under zero',
    ctx => {
      const c = closes(ctx?.candles || []);
      if (c.length < 35) return [UNKNOWN, `Needs 35 days of closes; ${c.length ? `there are ${c.length}` : 'none are loaded'}.`];
      const m = macd(c);
      const h = m?.hist?.[m.hist.length - 1];
      if (h == null) return [UNKNOWN, 'MACD could not be computed from this history.'];
      return [h > 0 ? PASS : FAIL, `The histogram reads ${h.toFixed(2)}.`];
    }),

  mk('vol.surge', 'Trading above its usual volume', 'candles',
    'Latest bar at 1.5× the 20-day average volume or more',
    'volume settling back towards its 20-day average',
    ctx => {
      const vt = volumeTrend(ctx?.candles || []);
      if (!vt) return [UNKNOWN, 'This feed did not return enough volume history.'];
      return [vt.ratio >= 1.5 ? PASS : FAIL, `Latest bar is ${vt.ratio.toFixed(2)}× the 20-day average.`];
    }),
];

export const ruleById = id => RULES.find(r => r.id === id) || null;

// ---- strategies ----------------------------------------------------------
//
// A strategy is a named bundle of rules and nothing else. It has no weights, no
// score and no opinion about which rule matters most, because weighting is
// where a filter starts having a view. The word "score" is avoided in the copy
// as well as in the code: a name here PASSES rules, and a screen that talks
// about scoring is one step from being read as ranking things by quality. `thesis` says what the bundle
// DESCRIBES; `caution` says what it cannot see. Both are rendered.

export const STRATEGIES = [
  {
    id: 'quality-value',
    name: 'Profitable at a modest multiple',
    rules: ['pe.cheap', 'roe.strong', 'margin.solid', 'debt.low'],
    thesis: 'Names that were profitable over the last twelve months and are not trading on a high multiple of those earnings.',
    caution: 'A low multiple is often low because the market expects the earnings to fall. This screen cannot see expectations at all.',
  },
  {
    id: 'momentum',
    name: 'Already trending up',
    rules: ['trend.up', 'trend.cross', 'macd.up', 'near.high', 'vol.surge'],
    thesis: 'Names whose price is above its own long averages, on volume heavier than usual.',
    caution: 'Every one of these rules is computed from prices that have already happened. A trend is visible only in the past tense.',
  },
  {
    id: 'pullback',
    name: 'Profitable, and well off its high',
    rules: ['roe.strong', 'margin.solid', 'rsi.washed', 'near.low'],
    thesis: 'Names that pass the profitability rules while sitting near the bottom of their own twelve-month range.',
    caution: 'The washed-out zone is also exactly where companies that keep falling spend their time. Nothing here distinguishes the two.',
  },
  {
    id: 'income',
    name: 'Pays, without stretching',
    rules: ['yield.pays', 'debt.low', 'margin.solid', 'beta.calm'],
    thesis: 'Names paying an indicated yield of 2% or more whose balance sheet and margin are not carrying it.',
    caution: 'An indicated yield is the last declared rate annualised. It is not a promise, and a cut does not announce itself in advance.',
  },
  {
    id: 'growth',
    name: 'Both lines compounding',
    rules: ['growth.rev', 'growth.eps', 'margin.solid'],
    thesis: 'Names where revenue and earnings per share both grew by 10% or more over the trailing year.',
    caution: 'Trailing growth is history. Nothing in this screen says whether it continues.',
  },
  {
    id: 'stretched',
    name: 'Run ahead of the numbers',
    rules: ['pe.rich', 'rsi.hot', 'near.high'],
    thesis: 'Names trading on a high multiple, near their high, with RSI in the stretched zone — a description of what has already run.',
    caution: 'This is not the opposite of the other screens and it is not a list of things to sell. Expensive names stay expensive for years at a time.',
  },
];

export const strategyById = id => STRATEGIES.find(s => s.id === id) || null;

// ---- evaluation ----------------------------------------------------------

// Decision 3: `results` holds every rule in the strategy, passed and failed
// alike, in the strategy's own order. Nothing is filtered out here — the caller
// gets the whole card, and the counts are derived from it rather than tracked
// alongside it, so they cannot disagree with what is drawn.
export function evaluate(strategy, ctx) {
  const s = typeof strategy === 'string' ? strategyById(strategy) : strategy;
  if (!s) return null;
  const results = s.rules.map(id => {
    const r = ruleById(id);
    if (!r) return { id, label: id, state: UNKNOWN, text: 'This rule is not defined.', rule: '', ends: '', need: null };
    return r.test(ctx || {});
  });
  const of = results.length;
  const passed = results.filter(r => r.state === PASS);
  const failed = results.filter(r => r.state === FAIL);
  const unknown = results.filter(r => r.state === UNKNOWN);
  return {
    ticker: ctx?.ticker || null,
    name: ctx?.name || null,
    price: num(ctx?.price),
    held: !!ctx?.held,
    strategy: s.id,
    results, passed, failed, unknown,
    matched: passed.length,
    of,
    // Decision 2 again, in the shape the screen needs: a name evaluated on
    // three of five rules did not "match three of five" — it matched three of
    // the three that could be answered, and the screen has to be able to say
    // which denominator it is using.
    answered: of - unknown.length,
    complete: unknown.length === 0,
    // The set of data kinds that would have to be loaded for this card to be
    // complete, so the screen can name the button rather than saying "no data".
    needs: [...new Set(unknown.map(r => r.need).filter(Boolean))],
  };
}

// Decision 4. Equal matched-counts share a rank, and `tied` marks every member
// of a group larger than one. There is deliberately no secondary sort key: the
// input order survives within a group, and the screen says the group is tied
// rather than pretending the top of it is the best of it.
export function rankWithTies(list = []) {
  const rows = [...list].sort((a, b) => (b.matched - a.matched) || 0);
  const out = [];
  let rank = 0, lastCount = null;
  for (const r of rows) {
    if (r.matched !== lastCount) { rank = out.length + 1; lastCount = r.matched; }
    out.push({ ...r, rank });
  }
  const sizes = out.reduce((m, r) => ({ ...m, [r.rank]: (m[r.rank] || 0) + 1 }), {});
  return out.map(r => ({ ...r, tied: sizes[r.rank] > 1, tiedWith: sizes[r.rank] }));
}

// The scan itself. Decision 2 is enforced here and nowhere else: a name that
// could not be evaluated at all is NOT dropped, it is moved into `blocked` with
// the missing inputs named. `hits` is everything with at least one pass;
// `misses` is everything answered that passed nothing. Three lists, because
// collapsing them into one and sorting is exactly how "nobody has data for this"
// becomes "this failed".
export function scan(strategy, rows = []) {
  const s = typeof strategy === 'string' ? strategyById(strategy) : strategy;
  if (!s) return { strategy: null, hits: [], misses: [], blocked: [], universe: 0 };
  const all = rows.map(ctx => evaluate(s, ctx)).filter(Boolean);
  const blocked = all.filter(r => r.answered === 0);
  const rest = all.filter(r => r.answered > 0);
  return {
    strategy: s,
    universe: all.length,
    hits: rankWithTies(rest.filter(r => r.matched > 0)),
    misses: rest.filter(r => r.matched === 0),
    blocked,
  };
}

// ---- the universe --------------------------------------------------------

// Decision 1. This is the sentence that stops the screen being read as a market
// scan, so it is computed rather than written once and left to rot: it counts
// what actually went in and where each part came from.
export function universeNote({ held = 0, watch = 0 } = {}) {
  const parts = [];
  if (held) parts.push(`${held} name${held === 1 ? '' : 's'} you hold`);
  if (watch) parts.push(`${watch} more from the leaderboard list`);
  const total = held + watch;
  if (!total) {
    return {
      total: 0,
      text: 'There is nothing to scan yet. This screen filters names you already hold plus the leaderboard list; it has no market feed behind it and does not search listed companies at large.',
    };
  }
  return {
    total,
    text: `Scanning ${total} name${total === 1 ? '' : 's'} — ${parts.join(' and ')}. This is the whole universe: there is no market feed behind this screen, so a name that is not in that list cannot appear here however well it would have scored.`,
  };
}

// ---- freshness -----------------------------------------------------------

export const DAY = 86400e3;

// Decision 6. `oldest` is what the stamp is drawn from, because a scan is only
// as current as its stalest input, and averaging the ages would hide exactly
// the one that matters.
export function dataAge(stamps = [], now = Date.now()) {
  const list = stamps.map(s => (s instanceof Date ? s.getTime() : num(s))).filter(v => v != null && v > 0);
  if (!list.length) return { known: false, text: 'The age of this data is not recorded, so it cannot be treated as current.' };
  const oldest = Math.min(...list);
  const days = Math.floor((now - oldest) / DAY);
  return {
    known: true,
    oldest,
    days,
    stale: days >= 7,
    text: days <= 0
      ? 'Every input was read today.'
      : `The oldest input is ${days} day${days === 1 ? '' : 's'} old, so this is a statement about the data as it stood then.`,
  };
}

// ---- the card ------------------------------------------------------------

// Decision 5. What a matched name gets is a description of the match and the
// condition that ends it. No entry, no target, no stop, no size. `ends` comes
// straight off the rule so the inverse can never drift from the threshold.
export function ideaCard(result) {
  if (!result) return null;
  return {
    ticker: result.ticker,
    matched: result.matched,
    of: result.of,
    answered: result.answered,
    what: result.passed.map(r => ({ label: r.label, rule: r.rule, text: r.text })),
    ends: result.passed.map(r => ({ label: r.label, ends: r.ends })),
    // Decision 3: the misses travel with the card, in the card, not one screen away.
    missed: result.failed.map(r => ({ label: r.label, rule: r.rule, text: r.text })),
    unmeasured: result.unknown.map(r => ({ label: r.label, text: r.text })),
    note: result.complete
      ? `Matched ${result.matched} of ${result.of} rules in this screen.`
      : `Matched ${result.matched} of the ${result.answered} rule${result.answered === 1 ? '' : 's'} that could be answered; ${result.unknown.length} could not be evaluated from the saved data.`,
  };
}

// The one sentence the whole file exists to make true. It is exported rather
// than inlined into the component so the suite can pin the wording, and so
// there is exactly one place it can be softened from.
export const DISCLAIMER =
  'These are filters, not suggestions. A name appears here because it satisfied stated arithmetic conditions on saved data, which is a description of the past and not a view about what happens next. Nothing on this screen is a recommendation to buy or sell anything.';
