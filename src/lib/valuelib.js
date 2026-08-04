// The valuation library.
//
// src/lib/intrinsic.js already runs four models. What it will not do is run them
// for a name you have not typed inputs for, and that is deliberate — the whole
// screen is built around making you own the assumptions. This module is the
// other half: it runs all four at ONE published set of default assumptions
// across many names at once, so there is something to browse before there is
// something to model.
//
// That convenience is also the danger, and four decisions exist to contain it.
//
// 1. THE DEFAULTS ARE NOT DATA AND ARE NAMED. Growth and the discount rate are
//    the two inputs a DCF is most sensitive to, and neither is observable. Here
//    they are constants somebody chose. So DEFAULTS is exported, each entry
//    carries a `why`, and every card records the assumption set it ran under.
//    A card that cannot say what it assumed is a card that is pretending its
//    output is a measurement.
//
// 2. ONE MODEL AGREEING IS NOT AGREEMENT. A Graham formula will happily return a
//    number for a company whose cash flow it has never seen, and on its own it
//    would put a confident "Undervalued" badge on a card. MIN_FIT is the floor:
//    below it the card returns the no-fit reading and says how many models
//    actually ran, rather than quoting the one that did.
//
// 3. THE PRICE INSIDE THE RANGE IS NOT A VERDICT. Same rule as readRange() in
//    intrinsic.js, kept consistent on purpose: when today's price sits between
//    the bear and the bull case, the models have not distinguished cheap from
//    expensive, and the honest badge says explore rather than quoting the base
//    case as though the spread were decoration.
//
// 4. NO RANKING BY UPSIDE. The shelves group by a stated property — below their
//    base case, largest by market cap, on your watchlist — and within a shelf
//    the order is the order the source gave. Sorting by "% to base" would turn a
//    browse into a leaderboard of whichever names the default assumptions happen
//    to flatter most, which is a ranking of the assumptions, not of the
//    companies.

import {
  MODELS, modelMeta, runScenarios, readRange, upside, num,
} from './intrinsic.js';

export { num };

// ---------- the published assumptions ----------

// Every one of these is a judgement. They are gathered here, with reasons,
// rather than sprinkled as literals through the model calls, because the single
// most useful thing a reader can do with this screen is disagree with one number
// here and watch every card move.
export const DEFAULTS = {
  growth: { value: 8, unit: '%/yr', label: 'Growth, years 1–5',
    why: 'Roughly long-run nominal earnings growth for a large listed company. Deliberately unexciting: a default that flatters is a default that produces a screen full of bargains.' },
  growth2: { value: 4, unit: '%/yr', label: 'Growth, years 6–10',
    why: 'Half the first stage. Almost nothing compounds at its five-year rate for ten.' },
  terminal: { value: 3, unit: '%/yr', label: 'Terminal growth',
    why: 'Below long-run global nominal GDP. Above it, the model implies the company eventually becomes the economy.' },
  rate: { value: 11, unit: '%', label: 'Discount rate',
    why: 'A required return with an equity risk premium over a ~7% risk-free rate. Move this one point and every valuation here moves several percent.' },
  bond: { value: 7, unit: '%', label: 'AAA bond yield',
    why: 'Graham\'s formula normalises against the corporate bond yield; the Indian 10-year G-sec is the usual stand-in.' },
};

/** The plain {field: value} form the models consume. */
export const defaultAssumptions = () =>
  Object.fromEntries(Object.entries(DEFAULTS).map(([k, v]) => [k, v.value]));

export const ASSUMPTION_NOTE =
  'Every card below ran at one shared set of assumptions that nobody chose for the individual company. They are a starting point for a conversation, not an estimate of anything.';

// ---------- per-model inputs ----------

// Which fundamental each model needs beyond the shared assumptions. Kept as a
// table so a model added to intrinsic.js that is missing here fails loudly at
// the fit count rather than silently never appearing.
export const MODEL_DRIVER = {
  dcf: 'fcf',
  sdcf: 'fcf',
  graham: 'eps',
  ddm: 'dividend',
};

/**
 * The inputs one model runs with for one company.
 *
 * Returns null when the driver is missing or non-positive, and null is the
 * correct answer rather than zero: a DCF on zero free cash flow returns a
 * valuation of the net cash alone, which is a real number and a meaningless one.
 * The negative case matters more — a loss-making company run through Graham
 * produces a negative "value" that would sort to the top of any cheapness list.
 */
export function modelInputs(model, fund = {}, assumptions = defaultAssumptions()) {
  const driver = MODEL_DRIVER[model];
  if (!driver) return null;
  const v = num(fund[driver]);
  if (v === null || v <= 0) return null;
  const base = { ...assumptions, [driver]: v };
  if (num(fund.netCash) !== null) base.netCash = num(fund.netCash);
  return base;
}

// Below this many models producing a usable value, no verdict is published.
// Two is not a consensus; it is the minimum at which the word "models" is not a
// singular dressed up as a plural.
export const MIN_FIT = 2;

// ---------- one card ----------

export const VERDICT_KINDS = {
  under: { key: 'under', label: 'Undervalued', color: 'var(--green)',
    line: 'Today\'s price sits below every scenario these models produced at the default assumptions.' },
  over: { key: 'over', label: 'Overvalued', color: 'var(--red)',
    line: 'Today\'s price sits above every scenario these models produced at the default assumptions.' },
  explore: { key: 'explore', label: 'Open to Explore', color: 'var(--cyan)',
    line: 'The price falls inside the bear–bull range, so at these assumptions the models do not distinguish cheap from expensive.' },
  nofit: { key: 'nofit', label: 'Open to Explore', color: 'var(--ink-3)',
    line: 'No clean fit at default assumptions.' },
};

/**
 * Run all four models at the shared assumptions and reduce them to one card.
 *
 * The bar is ONE model's bear→base→bull, not a union across all four, and that
 * is a considered choice rather than a convenience. A union of four models'
 * scenarios on a real company routinely spans thirtyfold — a Graham formula and
 * a two-stage DCF are not two measurements of one quantity — and a range that
 * wide swallows every price, so every card comes back "explore" and the screen
 * stops saying anything at all. So the bar belongs to the named model at the top
 * of BASE_PREFERENCE that fitted, the card prints which one, and the count of
 * models that fitted is shown SEPARATELY. Those two facts together — "Advanced
 * DCF base $214.20" and "3 of 4 methods fit" — are what the reader needs, and
 * neither is recoverable from a merged range.
 */
export function valueCard(ticker, fund = {}, price = null, assumptions = defaultAssumptions()) {
  const p = num(price);
  const methods = MODELS.map(m => {
    const inputs = modelInputs(m.key, fund, assumptions);
    if (!inputs) {
      return { key: m.key, label: m.label, short: m.short, ok: false,
        reason: `No ${MODEL_DRIVER[m.key]} saved.`, lo: null, base: null, hi: null };
    }
    const scen = runScenarios(m.key, inputs);
    const read = readRange(scen, p);
    const okRuns = scen.filter(s => s.result && s.result.ok);
    if (!read || !okRuns.length) {
      return { key: m.key, label: m.label, short: m.short, ok: false,
        reason: scen.find(s => s.result && s.result.reason)?.result?.reason || 'Model did not produce a value.',
        lo: null, base: null, hi: null };
    }
    return { key: m.key, label: m.label, short: m.short, ok: true, reason: null,
      lo: read.lo, base: read.base, hi: read.hi, scenarios: scen };
  });

  const fit = methods.filter(m => m.ok);
  const card = {
    ticker: String(ticker || '').toUpperCase(),
    name: fund.name || null,
    price: p,
    methods,
    fit: fit.length,
    of: MODELS.length,
    assumptions,
  };

  if (fit.length < MIN_FIT || p === null) {
    return { ...card, range: null, verdict: VERDICT_KINDS.nofit, base: null, baseModel: null, toBase: null };
  }

  // ONE named model, not an average of four. Averaging a DCF with a Graham
  // formula produces a number that no method supports and that cannot be
  // reproduced by opening any of them.
  const best = pickBase(fit);
  const lo = best.lo, hi = best.hi;
  const base = best.base ?? null;

  let verdict = VERDICT_KINDS.explore;
  if (p < lo) verdict = VERDICT_KINDS.under;
  else if (p > hi) verdict = VERDICT_KINDS.over;

  return {
    ...card,
    range: { lo, hi },
    base,
    baseModel: best ? best.key : null,
    baseLabel: best ? best.label : null,
    toBase: base === null ? null : upside(base, p),
    verdict,
  };
}

// Model preference when more than one fits: cash flow first, then the rules of
// thumb. This is a stated order, not a quality judgement made per company — a
// per-company "best model" chosen by which answer looked most reasonable is
// exactly how a valuation screen ends up agreeing with whatever you hoped.
export const BASE_PREFERENCE = ['dcf', 'sdcf', 'ddm', 'graham'];

export function pickBase(fitting = []) {
  for (const k of BASE_PREFERENCE) {
    const hit = fitting.find(m => m.key === k);
    if (hit) return hit;
  }
  return fitting[0] || null;
}

// ---------- the little bar ----------

/**
 * Geometry for the bear→bull track with the base tick and today's price dot.
 *
 * The domain covers the price even when the price is far outside the range,
 * which is why a card can show its dot pinned near one end with the green
 * segment squashed at the other. That squashing is the finding. Clamping the dot
 * to the track instead would draw a stock trading at triple its bull case
 * identically to one trading a rupee above it.
 */
export function bar(card, { pad = 0.06 } = {}) {
  if (!card || !card.range || card.price === null) return null;
  const { lo, hi } = card.range;
  const p = card.price;
  const dLo = Math.min(lo, p), dHi = Math.max(hi, p);
  const width = dHi - dLo;
  const padding = width > 0 ? width * pad : Math.abs(dHi || 1) * pad;
  const a = dLo - padding, b = dHi + padding;
  const span = b - a || 1;
  const at = v => (v - a) / span;
  return {
    domain: { lo: a, hi: b },
    loX: at(lo), hiX: at(hi),
    baseX: card.base === null ? null : at(card.base),
    priceX: at(p),
    outside: p < lo || p > hi,
  };
}

// ---------- shelves ----------

// Decision 4. Every shelf is a stated membership rule, and none of them is
// "highest upside". `pick` receives the whole card list and returns a subset in
// the ORDER IT WAS GIVEN — no shelf sorts.
export const SHELVES = [
  { key: 'below', title: 'Trading Below Their Base Case',
    note: 'Price under the lowest scenario every fitting model produced.',
    pick: cards => cards.filter(c => c.verdict.key === 'under') },
  { key: 'held', title: 'What You Already Own',
    note: 'Your holdings, run through the same four models at the same assumptions.',
    pick: cards => cards.filter(c => c.held) },
  { key: 'mega', title: 'The Megacaps',
    note: 'The largest listed companies, in the order the leaderboard lists them.',
    pick: cards => cards.filter(c => c.mega) },
  { key: 'income', title: 'The Dividend Payers',
    note: 'Names with a saved dividend, so the dividend discount model has something to work with.',
    pick: cards => cards.filter(c => c.methods.some(m => m.key === 'ddm' && m.ok)) },
  { key: 'nofit', title: 'No Clean Fit',
    note: 'Fewer than two models produced a value at these assumptions. Usually a missing figure, sometimes a company these models were never meant for.',
    pick: cards => cards.filter(c => c.fit < MIN_FIT) },
];

export function buildLibrary(cards = []) {
  return SHELVES
    .map(s => ({ ...s, cards: s.pick(cards) }))
    .filter(s => s.cards.length);
}

/**
 * Ticker-or-name search. Ticker prefix matches sort ahead of name matches
 * because somebody typing "KO" wants Coca-Cola and not every company with "ko"
 * somewhere in its name — that is a relevance order over the QUERY, which is a
 * different thing from ranking companies against each other.
 */
export function searchLibrary(cards = [], query = '') {
  const q = String(query || '').trim().toUpperCase();
  if (!q) return [];
  const exact = [], prefix = [], name = [];
  for (const c of cards) {
    const t = c.ticker || '';
    const n = String(c.name || '').toUpperCase();
    if (t === q) exact.push(c);
    else if (t.startsWith(q)) prefix.push(c);
    else if (n.includes(q)) name.push(c);
  }
  return [...exact, ...prefix, ...name];
}

export const POPULAR = ['AAPL', 'MSFT', 'JNJ', 'KO', 'PG', 'O'];

export const DISCLAIMER =
  'Every card here ran at one shared set of default assumptions, and the two that matter most — growth and the discount rate — are opinions rather than measurements. A badge on a card is a statement about arithmetic performed on those assumptions and on figures that may be months old. It is not a view about the company, and nothing on this screen is a recommendation to buy or sell anything.';
