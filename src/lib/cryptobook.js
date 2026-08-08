// The crypto book: one row per coin, however many times you add it.
//
// The bug this exists to fix: adding BTC twice produced two rows with two
// separate cost bases, which the screen then drew as two different coins. The
// totals were right by luck — two halves of a position still sum to the
// position — but everything per-coin was wrong: the weight, the return, and
// the answer to "what did I pay for my bitcoin".
//
// Merging is not just concatenation. A second purchase at a different price
// changes your average cost, and the only correct way to combine them is a
// quantity-weighted average. Three cases have to be right:
//
//   BOTH LOTS HAVE A COST. Weighted average, weighted by quantity.
//   NEITHER HAS ONE. Stays unknown. Two unknowns do not make a number.
//   ONE HAS ONE. Also unknown — and this is the case people get wrong. A
//   position where you know what half of it cost has an unknown average, not
//   the known half's price. Reporting the known half would understate or
//   overstate the basis by exactly the part you cannot see, and a return
//   computed off it would look precise.

export const num = v => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Exchanges quote pairs; people say coins. BTCUSDT, BTC-USD and btc are the
// same asset, and storing them as three rows is the same bug in a different
// costume.
const QUOTE_SUFFIXES = ['USDT', 'USDC', 'BUSD', 'FDUSD', 'TUSD', 'USD', 'INR', 'EUR'];

export function normaliseSymbol(raw) {
  const s = String(raw ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!s) return null;
  // A symbol that IS a quote currency is a coin you can hold, not a pair. This
  // has to be checked first, before any suffix stripping: FDUSD ends with USD,
  // and stripping it would turn a stablecoin into a phantom coin called FD.
  if (QUOTE_SUFFIXES.includes(s)) return s;
  for (const q of QUOTE_SUFFIXES) {
    if (s.endsWith(q)) {
      const base = s.slice(0, -q.length);
      // A one-character base is far more likely to be a symbol this list does
      // not understand than a real coin, so it is left alone.
      if (base.length >= 2) return base;
    }
  }
  return s;
}

// Quantity-weighted average cost across two lots. See the header for why a
// half-known basis stays unknown.
export function blendCost(qtyA, avgA, qtyB, avgB) {
  const qa = num(qtyA) ?? 0, qb = num(qtyB) ?? 0;
  const aa = num(avgA), ab = num(avgB);
  if (qa <= 0 && qb <= 0) return null;
  if (qa <= 0) return ab;
  if (qb <= 0) return aa;
  if (aa == null || ab == null) return null;
  return (qa * aa + qb * ab) / (qa + qb);
}

// Add a lot to the book, merging into an existing coin if there is one.
export function addLot(list = [], lot = {}, makeId = () => String(Math.random())) {
  const sym = normaliseSymbol(lot.sym);
  const qty = num(lot.qty);
  if (!sym || qty == null || qty <= 0) return { list, added: false, merged: false, reason: 'A coin needs a symbol and a positive quantity.' };
  const avg = num(lot.avg);

  const idx = list.findIndex(c => normaliseSymbol(c.sym) === sym);
  if (idx < 0) {
    return {
      list: [...list, { id: makeId(), sym, qty, avg: avg ?? null }],
      added: true, merged: false, reason: null,
    };
  }

  const cur = list[idx];
  const nextQty = (num(cur.qty) ?? 0) + qty;
  const nextAvg = blendCost(cur.qty, cur.avg, qty, avg);
  const out = list.slice();
  out[idx] = { ...cur, sym, qty: nextQty, avg: nextAvg };
  return {
    list: out,
    added: true,
    merged: true,
    reason: nextAvg == null && (num(cur.avg) != null || avg != null)
      ? 'Merged, but the average cost is now unknown: one of the two lots has no price recorded, and a basis for part of a position is not a basis for the position.'
      : null,
  };
}

// Fold a book that already contains duplicates into one row per coin. Existing
// data was written by the old append-only path, so this runs on load rather
// than requiring anyone to clean up by hand.
export function dedupeBook(list = []) {
  const out = [];
  let merges = 0;
  for (const c of list) {
    const r = addLot(out, { sym: c.sym, qty: c.qty, avg: c.avg }, () => c.id || String(out.length));
    if (!r.added) continue;
    if (r.merged) merges += 1;
    out.length = 0;
    out.push(...r.list);
  }
  return { list: out, merges };
}

// ---------------------------------------------------------------- insights

// The same per-position reading the stock book gets: weight, return, and the
// day's move — computed here so the component does not re-derive them and drift.
export function bookRows(list = [], prices = {}) {
  const rows = list.map(c => {
    const sym = normaliseSymbol(c.sym) || c.sym;
    const q = prices[sym] || prices[c.sym] || {};
    const price = num(q.price);
    const qty = num(c.qty) ?? 0;
    const avg = num(c.avg);
    const value = price != null ? qty * price : null;
    const cost = avg != null ? qty * avg : null;
    const pnl = value != null && cost != null ? value - cost : null;
    return {
      ...c, sym, price, qty, avg, value, cost, pnl,
      pnlPct: pnl != null && cost > 0 ? (pnl / cost) * 100 : null,
      dayPct: num(q.changePct),
      dayGain: value != null && num(q.changePct) != null
        ? value - value / (1 + num(q.changePct) / 100)
        : null,
      unknownCost: avg == null,
    };
  });
  const total = rows.reduce((s, r) => s + (r.value ?? 0), 0);
  return rows.map(r => ({ ...r, weight: total > 0 && r.value != null ? (r.value / total) * 100 : null }))
    .sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
}

export function bookTotals(rows = []) {
  const value = rows.reduce((s, r) => s + (r.value ?? 0), 0);
  // Only positions with a known cost enter the invested total, and the ones
  // that do not are named — the same rule the stock book follows, for the same
  // reason: a return computed against a partial basis is not a return.
  const costed = rows.filter(r => r.cost != null);
  const cost = costed.reduce((s, r) => s + r.cost, 0);
  const valueOfCosted = costed.reduce((s, r) => s + (r.value ?? 0), 0);
  const dayGain = rows.reduce((s, r) => s + (r.dayGain ?? 0), 0);
  return {
    value,
    cost: costed.length ? cost : null,
    pnl: costed.length ? valueOfCosted - cost : null,
    pnlPct: costed.length && cost > 0 ? ((valueOfCosted - cost) / cost) * 100 : null,
    dayGain,
    count: rows.length,
    missingCost: rows.filter(r => r.unknownCost).map(r => r.sym),
  };
}
