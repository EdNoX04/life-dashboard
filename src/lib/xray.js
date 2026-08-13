// Look-through exposure — what you actually own.
//
// The shelf says nineteen holdings. The truth is narrower: VOO, SPMO, QQQM and
// QQQ are all large-cap US index funds whose biggest positions are the same
// handful of companies, and MSFT, GOOGL, AMZN and NVDA are held directly on top
// of all four. So a screen showing "MSFT 5.5%" is understating the real
// exposure, and "nineteen holdings" reads as diversification the book does not
// have.
//
// This decomposes every fund into its underlying companies and adds them up. It
// is the same idea as a fund X-ray, and it is pure arithmetic — no judgement
// about whether the resulting concentration is good or bad, which depends on
// what you are trying to do and is not a thing a program knows.
//
// FOUR RULES, EACH LEARNED FROM A WAY THIS GOES WRONG
//
// 1. AN UNKNOWN FUND IS NOT AN EMPTY FUND. If a composition is missing, the
//    money in it is reported as UNCOVERED, never dropped and never spread over
//    the names we happen to know. Dropping it would shrink the denominator and
//    inflate every percentage on screen — the errors all point the same way,
//    toward looking more diversified than you are.
//
// 2. TOP-25 IS NOT THE WHOLE FUND. VOO's top 25 is about half of it; the other
//    half is 495 companies we do not list. That remainder is reported as its own
//    line, because treating it as absent would do the same inflating trick, and
//    treating it as concentrated would be a lie in the other direction.
//
// 3. GOLD IS NOT A COMPANY. GOLDBEES decomposes into nothing — it is bullion.
//    It belongs in the total and outside the equity look-through, or it lands
//    in "uncovered" and reads as a data gap rather than an asset class.
//
// 4. GOOG AND GOOGL ARE ONE COMPANY. Share classes are folded to a canonical
//    symbol before anything is summed. Left apart, Alphabet shows up twice at
//    half size and falls out of the top five — the same flattering direction as
//    every other mistake here.

import { normSym, bookPositions, seedCompositions, mergeCompositions } from './etfdata.js';
import { currencyOf } from './indiabook.js';

export const num = v => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Asset classes that have no underlying companies to look through to. Reported
// separately rather than as missing data, because "we could not decompose this"
// and "there is nothing to decompose" look identical in a total and mean
// opposite things.
export const NON_EQUITY = {
  GOLDBEES: 'Gold', GOLDSHARE: 'Gold', SETFGOLD: 'Gold', HDFCGOLD: 'Gold',
  SILVERBEES: 'Silver', LIQUIDBEES: 'Cash', GLD: 'Gold', IAU: 'Gold',
  BTC: 'Crypto', ETH: 'Crypto', SOL: 'Crypto', XRP: 'Crypto',
};

export const isNonEquity = sym => !!NON_EQUITY[normSym(sym)];

/**
 * Decompose a book into true company-level exposure.
 *
 * `positions`: [{ ticker, value, isFund }] — all in ONE currency, converted by
 * the caller. Mixing currencies here would repeat the factor-of-ninety bug the
 * portfolio totals already had.
 *
 * `compositions`: { TICKER: { holdings: [{sym, name, weight}], covered } }
 * where `weight` is a fraction of the FUND (0.07 = 7% of the fund) and
 * `covered` is how much of the fund those holdings represent.
 */
export function lookThrough(positions = [], compositions = {}) {
  const total = positions.reduce((s, p) => s + (num(p.value) || 0), 0);
  const byName = new Map();
  const buckets = { rest: 0, unknown: 0, nonEquity: 0 };
  const unknownFunds = [];
  const nonEquityRows = [];
  const restByFund = [];

  const add = (sym, name, value, via, direct) => {
    const key = normSym(sym);
    if (!byName.has(key)) {
      byName.set(key, { sym: key, name: name || key, value: 0, via: [], direct: false, directValue: 0 });
    }
    const row = byName.get(key);
    row.value += value;
    if (direct) { row.direct = true; row.directValue += value; }
    if (via) {
      const v = row.via.find(x => x.fund === via);
      if (v) v.value += value;
      else row.via.push({ fund: via, value });
    }
    // A name first seen as a bare ticker keeps the better label if a fund
    // supplies one later.
    if (name && (row.name === key || !row.name)) row.name = name;
  };

  for (const p of positions) {
    const value = num(p.value) || 0;
    if (value <= 0) continue;
    const ticker = normSym(p.ticker);

    if (isNonEquity(ticker)) {
      buckets.nonEquity += value;
      nonEquityRows.push({ sym: ticker, klass: NON_EQUITY[ticker], value });
      continue;
    }

    const comp = compositions[ticker];
    if (!comp || !Array.isArray(comp.holdings) || !comp.holdings.length) {
      // Either a single stock (which IS its own exposure) or a fund we have no
      // composition for. Distinguished by an explicit `isFund` flag, because
      // guessing from the ticker would file every unknown ETF as a company and
      // report false precision.
      if (p.isFund) {
        buckets.unknown += value;
        unknownFunds.push({ sym: ticker, value });
      } else {
        add(ticker, p.name, value, null, true);
      }
      continue;
    }

    let placed = 0;
    for (const h of comp.holdings) {
      const w = num(h.weight);
      if (w == null || w <= 0) continue;
      const slice = value * w;
      add(h.sym, h.name, slice, ticker, false);
      placed += slice;
    }
    // Everything the listed holdings did not account for. Real money in real
    // companies we simply have not enumerated — its own line, not a gap.
    const left = Math.max(0, value - placed);
    buckets.rest += left;
    if (left > 0) restByFund.push({ sym: ticker, value: left, covered: num(comp.covered) });
  }

  const exposures = [...byName.values()]
    .map(r => ({ ...r, pct: total ? (r.value / total) * 100 : 0 }))
    .sort((a, b) => b.value - a.value);

  const decomposed = exposures.reduce((s, r) => s + r.value, 0);

  return {
    total,
    exposures,
    // Every bucket as a share of the WHOLE book, so the reader can see how much
    // of the picture is actually resolved.
    rest: {
      value: buckets.rest,
      pct: total ? (buckets.rest / total) * 100 : 0,
      funds: restByFund.sort((a, b) => b.value - a.value),
    },
    unknown: {
      value: buckets.unknown,
      pct: total ? (buckets.unknown / total) * 100 : 0,
      funds: unknownFunds.sort((a, b) => b.value - a.value),
    },
    nonEquity: {
      value: buckets.nonEquity,
      pct: total ? (buckets.nonEquity / total) * 100 : 0,
      rows: nonEquityRows.sort((a, b) => b.value - a.value),
    },
    coverage: total ? (decomposed / total) * 100 : 0,
  };
}

/**
 * What the shelf says, for comparison with what the X-ray says.
 *
 * The gap between the two is the entire point of the screen, so it is computed
 * here from the same positions rather than read off another component — two
 * derivations of "what MSFT is worth" is two chances for them to disagree.
 */
export function shelfWeights(positions = []) {
  const total = positions.reduce((s, p) => s + (num(p.value) || 0), 0);
  const out = {};
  for (const p of positions) {
    const v = num(p.value) || 0;
    if (v <= 0) continue;
    const k = normSym(p.ticker);
    out[k] = (out[k] || 0) + (total ? (v / total) * 100 : 0);
  }
  return out;
}

/**
 * How much two funds are the same fund.
 *
 * The standard measure: for every company in both, take the SMALLER of the two
 * weights and add them up. If VOO holds NVDA at 7.5% and QQQM at 8.5%, they
 * overlap on 7.5 of those points — the extra 1 in QQQM is exposure VOO does not
 * give you.
 *
 * Reported alongside the coverage of both funds, because an overlap computed
 * from two top-25 lists is a FLOOR: the unlisted remainders almost certainly
 * overlap further. Quoting it as a total would understate the problem, which is
 * the direction that flatters.
 */
export function overlap(a, b) {
  if (!a?.holdings?.length || !b?.holdings?.length) return null;
  const bw = new Map(b.holdings.map(h => [normSym(h.sym), num(h.weight) || 0]));
  let shared = 0;
  const names = [];
  for (const h of a.holdings) {
    const sym = normSym(h.sym);
    const w = Math.min(num(h.weight) || 0, bw.get(sym) || 0);
    if (w > 0) { shared += w; names.push({ sym, name: h.name || sym, weight: w }); }
  }
  names.sort((x, y) => y.weight - x.weight);
  return {
    pct: shared * 100,
    names,
    // Both coverages, so the floor can be stated as a floor.
    coverage: Math.min(num(a.covered) ?? 1, num(b.covered) ?? 1) * 100,
    isFloor: true,
  };
}

export function overlapMatrix(tickers = [], compositions = {}) {
  const out = [];
  for (let i = 0; i < tickers.length; i++) {
    for (let j = i + 1; j < tickers.length; j++) {
      const o = overlap(compositions[tickers[i]], compositions[tickers[j]]);
      if (o) out.push({ a: tickers[i], b: tickers[j], ...o });
    }
  }
  return out.sort((x, y) => y.pct - x.pct);
}

/**
 * Concentration of the true exposure.
 *
 * `effective` is 1/HHI — the number of EQUALLY sized holdings that would give
 * the same concentration. Nineteen positions with an effective count of six is
 * the sentence this whole screen exists to be able to say.
 */
export function concentration(exposures = [], total = 0) {
  if (!exposures.length) return { top1: 0, top5: 0, top10: 0, hhi: null, effective: null, basis: 0 };

  // Two denominators, and picking the wrong one is the flattering mistake.
  //
  // TOP-N SHARES are of the WHOLE BOOK — "NVDA is 6% of everything I own" is
  // the sentence a reader wants, and measuring it against a subset overstates it.
  //
  // HHI is computed over the RESOLVED exposures only. Dividing by the whole book
  // instead lets the un-enumerated remainder behave like perfect
  // diversification: every weight shrinks, HHI collapses, and the effective
  // holding count comes out ABOVE the real number of positions — so the screen
  // built to reveal concentration would report LESS of it the less data it had.
  // A test caught exactly that, which is why the denominators are separate.
  const resolved = exposures.reduce((s, e) => s + e.value, 0);
  const denom = total || resolved;

  const sum = n => (denom
    ? exposures.slice(0, n).reduce((s, e) => s + e.value, 0) / denom * 100
    : 0);

  const w = resolved ? exposures.map(e => e.value / resolved) : [];
  const hhi = w.reduce((s, x) => s + x * x, 0);

  return {
    top1: sum(1), top5: sum(5), top10: sum(10),
    hhi: hhi || null,
    effective: hhi > 0 ? 1 / hhi : null,
    // How much of the book that effective count actually describes. Without it
    // the number is unanchored: "effective 2.3" means something very different
    // at 90% coverage than at 30%.
    basis: denom ? (resolved / denom) * 100 : 0,
  };
}

// Sector totals, when the composition data carries sectors. Absent sectors are
// their own bucket rather than being folded into "Other" — one means we do not
// know, the other means it genuinely is other.
export function bySector(exposures = [], compositions = {}, sectors = {}) {
  const out = new Map();
  let unknown = 0;
  for (const e of exposures) {
    const s = sectors[e.sym];
    if (!s) { unknown += e.value; continue; }
    out.set(s, (out.get(s) || 0) + e.value);
  }
  const rows = [...out.entries()].map(([sector, value]) => ({ sector, value }))
    .sort((a, b) => b.value - a.value);
  return { rows, unknown };
}

/**
 * The whole look-through, from a raw book to everything a caller needs.
 *
 * This exists as a function rather than as fifteen lines inside a React
 * component for one reason: the briefing's five look-through rules read it, and
 * a rule that cannot be tested is a rule that quietly stops firing. The
 * component version was untestable in this repo — it lives in a .jsx file that
 * needs a bundler — so the logic moved here where a plain test can reach it.
 *
 * `fx` is USD -> INR and is NOT defaulted to 1. Defaulting would convert a
 * rupee position at par and understate the book by the exchange rate; passing
 * null instead excludes those positions and names them, which the caller can
 * then report.
 */
export function xrayFromBook(held = [], { priceOf, fx = null, saved = null, comps = null } = {}) {
  const compositions = comps || mergeCompositions(seedCompositions(), saved || {});
  const { positions, excluded } = bookPositions(held, { priceOf, fx, currencyOf, comps: compositions });
  if (!positions.length) return null;

  const base = lookThrough(positions, compositions);
  const heldFunds = positions.filter(p => p.isFund && compositions[p.ticker]).map(p => p.ticker);

  return {
    ...base,
    positions,
    excluded,
    shelf: shelfWeights(positions),
    conc: concentration(base.exposures, base.total),
    pairs: overlapMatrix(heldFunds, compositions),
    funds: heldFunds,
  };
}
