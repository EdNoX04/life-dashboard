// Turning the shelf into something the X-ray can decompose.
//
// Three jobs, each of which is a place the arithmetic can go quietly wrong:
//
//   1. CANONICAL SYMBOLS. GOOG and GOOGL are the same company. Left apart,
//      Alphabet appears twice at half size each and drops out of the top five
//      — the book looks more spread than it is, which is the direction every
//      mistake in this module tends to fall. Same for BRK.B / BRK-B / BRKB,
//      which three different data sources spell three different ways.
//
//   2. ONE CURRENCY. GOLDBEES is priced in rupees. Summed alongside dollar
//      positions it enters the book at about ninety times its real weight —
//      the exact bug the portfolio totals already had once. Positions whose
//      currency cannot be converted are EXCLUDED and counted, never converted
//      at 1.0.
//
//   3. FUND OR COMPANY. An ETF with no composition on file must be reported as
//      uncovered. Treating it as a company would file a 500-stock index fund
//      in the concentration table as a single name — a lie in the flattering
//      direction, since it makes the top-1 exposure look like an index rather
//      than whatever the index is mostly made of.

import { ETF_SEED, KNOWN_FUNDS } from '../data/etfSeed.js';

// Share classes of one company. Deliberately tiny and explicit: a clever
// pattern that merged anything ending in a letter would fold unrelated tickers
// together, and a wrong merge is far harder to notice than a missing one.
const SHARE_CLASSES = {
  GOOG: 'GOOGL',      // Alphabet C -> A
  BRKA: 'BRKB',       // Berkshire A -> B (same issuer, same economic exposure)
  FOX: 'FOXA',
  NWS: 'NWSA',
  UAA: 'UA',
};

/** Canonical form of a ticker: case, punctuation and share class all folded. */
export function normSym(s) {
  const u = String(s == null ? '' : s).toUpperCase().trim().replace(/[.\-\/\s]/g, '');
  return SHARE_CLASSES[u] || u;
}

/**
 * Seed rows -> the shape lookThrough() wants.
 *
 * `covered` is COMPUTED from the weights rather than declared, so it cannot
 * drift out of step with the list it describes. A hand-written 0.40 next to a
 * list summing to 0.51 would overstate the unlisted remainder and understate
 * every resolved exposure.
 */
export function toComposition(entry) {
  if (!entry) return null;
  const raw = Array.isArray(entry.holdings) ? entry.holdings : [];
  const holdings = raw.map(h => (Array.isArray(h)
    ? { sym: normSym(h[0]), name: h[1], weight: Number(h[2]) / 100 }
    : { sym: normSym(h.sym ?? h.ticker), name: h.name, weight: Number(h.weight) / (h.weightIsFraction ? 1 : 100) }
  )).filter(h => h.sym && Number.isFinite(h.weight) && h.weight > 0);

  // Share classes merge here, before anything downstream sees them, so a fund
  // holding Alphabet twice contributes one line at the combined weight.
  const merged = new Map();
  for (const h of holdings) {
    const prev = merged.get(h.sym);
    if (prev) prev.weight += h.weight;
    else merged.set(h.sym, { ...h });
  }
  const list = [...merged.values()].sort((a, b) => b.weight - a.weight);

  return {
    name: entry.name || null,
    asOf: entry.asOf || null,
    source: entry.source || null,
    count: entry.count ?? null,
    holdings: list,
    covered: list.reduce((s, h) => s + h.weight, 0),
  };
}

/** The seed, in decomposable form. Pure — no I/O, so tests can use it directly. */
export function seedCompositions() {
  const out = {};
  for (const [ticker, entry] of Object.entries(ETF_SEED)) {
    out[normSym(ticker)] = toComposition(entry);
  }
  return out;
}

/**
 * Seed plus anything saved in memory.etf_holdings, newer entry wins per fund.
 *
 * Merged per FUND rather than per file so a payload refreshing one ETF does not
 * silently delete the other four — the failure mode of a whole-blob overwrite
 * is that four funds move from "resolved" to "uncovered" and the screen reports
 * it as a data gap rather than as the mistake it is.
 */
export function mergeCompositions(seed = {}, saved = {}) {
  const out = { ...seed };
  for (const [ticker, entry] of Object.entries(saved || {})) {
    const c = toComposition(entry);
    if (!c || !c.holdings.length) continue;
    const key = normSym(ticker);
    const prev = out[key];
    // Older data never replaces newer. Without this a stale payload replayed
    // after a fresh one would quietly walk the numbers backwards.
    if (prev?.asOf && c.asOf && c.asOf < prev.asOf) continue;
    out[key] = c;
  }
  return out;
}

/** Is this row a fund we should look through rather than a company? */
export function isFundRow(row, comps = {}) {
  const t = normSym(row?.ticker ?? row?.sym);
  if (!t) return false;
  const kind = String(row?.kind ?? row?.type ?? '').toLowerCase();
  if (kind === 'etf' || kind === 'fund' || kind === 'mf') return true;
  return !!comps[t] || KNOWN_FUNDS.has(t);
}

/**
 * The book as X-ray input: one currency, one row per position.
 *
 * `fx` is USD -> INR, the direction the Money tab already fetches. A rupee
 * position with no rate loaded is dropped into `excluded` rather than converted
 * at 1.0, because a total that has silently absorbed an account at the wrong
 * rate looks exactly like a correct one.
 */
export function bookPositions(held = [], {
  priceOf, fx = null, currencyOf = () => 'USD', comps = {},
} = {}) {
  const positions = [];
  const excluded = [];
  for (const h of held) {
    const qty = Number(h?.qty ?? h?.shares) || 0;
    const px = Number(priceOf ? priceOf(h) : h?.last_price) || 0;
    const gross = qty * px;
    if (gross <= 0) continue;

    const ccy = currencyOf(h);
    let usd = gross;
    if (ccy !== 'USD') {
      if (!fx || fx <= 0) { excluded.push({ ticker: h.ticker, ccy, value: gross }); continue; }
      usd = gross / fx;
    }

    positions.push({
      ticker: normSym(h.ticker ?? h.sym),
      name: h.name || null,
      value: usd,
      isFund: isFundRow(h, comps),
    });
  }
  return { positions, excluded };
}
