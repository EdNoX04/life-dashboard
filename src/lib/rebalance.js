// Rebalancing arithmetic: how far a book has drifted from targets its owner set,
// and what it would take to close the gap.
//
// This file computes; it does not counsel. Every number here is a mechanical
// consequence of weights Neel typed in himself, which is why it is allowed to
// exist at all. The moment it started deciding what the targets *should* be it
// would be giving investment advice, and it is not licensed to do that.
//
// Six decisions, each one a way this could quietly mislead:
//
// 1. Targets that do not sum to 100 are normalised so the maths works, and the
//    plan SAYS the original sum. Silently rescaling someone's numbers and then
//    reporting drift against the rescaled version is how a book ends up
//    "balanced" against a target nobody set.
//
// 2. Drift inside the band is not a trade. Bands exist precisely so ordinary
//    market noise does not generate churn, so drift and actionability are two
//    separate columns and a row can be drifted without being actionable.
//
// 3. New money before selling. A contribution that fills the underweights costs
//    a fee; a sale that fills them costs a fee AND spread AND possibly tax. So
//    the contribution-only plan is computed first and shown first, and the
//    sell-side plan is what remains after the cash runs out.
//
// 4. Holding period is derived from the actual order history by FIFO, and where
//    the history is incomplete it reports UNKNOWN rather than assuming the
//    favourable answer. A sale plan that quietly assumes everything is long-term
//    is a tax bill disguised as a suggestion.
//
// 5. Whole-share rounding leaves a residual, and the residual is reported. A
//    plan that claims to land exactly on target is a plan that has been rounded
//    somewhere it did not admit to.
//
// 6. No ordering of holdings within a sleeve is ever presented as a
//    recommendation. Which specific name to trim is a judgement about companies;
//    this file only knows arithmetic about weights.

const num = v => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

// Twelve months is the long-term line for US equity and for listed Indian
// equity alike, which is the only reason one constant serves both books.
export const LONG_TERM_DAYS = 365;

export const DEFAULT_BAND = 5;        // percentage points either side of target
export const DEFAULT_MIN_TRADE = 2000; // below this a trade is mostly fee

// The dimensions a book can be balanced along. Each maps to one of the
// breakdowns allocationBreakdown() already produces.
export const DIMENSIONS = [
  { key: 'byClass', label: 'Asset class', hint: 'Equity, ETFs, debt, gold, cash-likes — the coarsest and usually the only one worth a hard target.' },
  { key: 'byMarket', label: 'India vs world', hint: 'Home bias is a real risk and a real comfort; the split is a preference, not a right answer.' },
  { key: 'byCap', label: 'Company size', hint: 'Mega through micro. Unclassified names sit in their own bucket rather than being guessed into one.' },
  { key: 'bySector', label: 'Sector', hint: 'The noisiest dimension — sector labels move and one company can plausibly sit in two.' },
];

// ---- targets -------------------------------------------------------------

// Decision 1: normalise, but never quietly.
export function normaliseTargets(raw = {}) {
  const entries = Object.entries(raw)
    .map(([k, v]) => [k, num(v)])
    .filter(([, v]) => v != null && v > 0);
  const given = entries.reduce((s, [, v]) => s + v, 0);
  if (!entries.length || !(given > 0)) {
    return { targets: {}, given: 0, normalised: false, empty: true };
  }
  const scale = 100 / given;
  const targets = Object.fromEntries(entries.map(([k, v]) => [k, v * scale]));
  return {
    targets,
    given,
    // A hundredth of a point of float error is not a user error.
    normalised: Math.abs(given - 100) > 0.01,
    empty: false,
  };
}

// ---- drift ---------------------------------------------------------------

// `slices` is [{ label, value, pct }] as allocationBreakdown returns.
// `targets` is { label: pct } already normalised.
export function driftRows({ slices = [], targets = {}, total = 0, band = DEFAULT_BAND }) {
  const seen = new Set();
  const rows = [];

  for (const s of slices) {
    seen.add(s.label);
    const t = num(targets[s.label]);
    rows.push(makeRow(s.label, s.value, s.pct, t, total, band));
  }
  // A target for a sleeve the book does not hold yet is not an error — it is
  // the most under-weight position possible, and dropping it would hide the
  // largest gap in the plan.
  for (const [label, t] of Object.entries(targets)) {
    if (seen.has(label)) continue;
    rows.push(makeRow(label, 0, 0, num(t), total, band));
  }

  return rows.sort((a, b) => {
    // Untargeted sleeves sink to the bottom; among the rest, biggest gap first.
    if ((a.target == null) !== (b.target == null)) return a.target == null ? 1 : -1;
    return Math.abs(b.driftPp ?? 0) - Math.abs(a.driftPp ?? 0);
  });
}

function makeRow(label, value, weight, target, total, band) {
  if (target == null) {
    // Held but untargeted. Reporting it as 100% overweight would be arithmetic
    // on a target that does not exist.
    return {
      label, value, weight, target: null, driftPp: null, gap: null,
      side: null, actionable: false, band, untargeted: true,
    };
  }
  const driftPp = weight - target;
  const gap = ((target - weight) / 100) * total;   // positive = needs buying
  return {
    label, value, weight, target, driftPp, gap,
    side: driftPp > 0 ? 'over' : driftPp < 0 ? 'under' : 'on',
    // Decision 2: drifted and actionable are different facts.
    actionable: Math.abs(driftPp) > band,
    band, untargeted: false,
  };
}

// ---- the contribution-first plan -----------------------------------------

// Decision 3. Spend `cash` on the underweight sleeves in proportion to how far
// under they are, never selling anything. Returns what it could not fix.
//
// Note that this deliberately fills sleeves that are inside the band too. The
// band exists to stop noise from triggering *sales*, which cost spread and tax;
// a purchase with money that was going in anyway costs one fee. Skipping the
// mildly-under sleeves would push their share of the cash into the badly-under
// ones and overshoot them straight past target.
export function contributionPlan(rows = [], cash = 0, minTrade = DEFAULT_MIN_TRADE) {
  const money = num(cash) || 0;
  const needy = rows.filter(r => !r.untargeted && r.gap > 0);
  const need = needy.reduce((s, r) => s + r.gap, 0);
  if (!(money > 0) || !needy.length) {
    return { buys: [], spent: 0, unspent: money, need, covers: 0, tooSmall: [] };
  }
  const share = Math.min(1, money / need);
  const raw = needy.map(r => ({ label: r.label, amount: r.gap * share }));
  // A ₹300 top-up is a brokerage fee with a trade attached to it.
  const buys = raw.filter(b => b.amount >= minTrade);
  const tooSmall = raw.filter(b => b.amount < minTrade);
  const spent = buys.reduce((s, b) => s + b.amount, 0);
  return {
    buys: buys.sort((a, b) => b.amount - a.amount),
    spent,
    unspent: money - spent,
    need,
    covers: need ? Math.min(100, (money / need) * 100) : 0,
    tooSmall,
  };
}

// What the book would look like after a contribution plan lands. Useful because
// "you would still be 3pp under" is a more honest ending than "done".
export function afterPlan(rows = [], buys = [], added = 0) {
  const by = Object.fromEntries(buys.map(b => [b.label, b.amount]));
  const total = rows.reduce((s, r) => s + r.value, 0) + (num(added) || 0);
  if (!(total > 0)) return rows;
  return rows.map(r => {
    const value = r.value + (by[r.label] || 0);
    const weight = (value / total) * 100;
    if (r.untargeted) return { ...r, value, weight };
    const driftPp = weight - r.target;
    return {
      ...r, value, weight, driftPp,
      gap: ((r.target - weight) / 100) * total,
      side: driftPp > 0 ? 'over' : driftPp < 0 ? 'under' : 'on',
      actionable: Math.abs(driftPp) > r.band,
    };
  });
}

// ---- the sell-side plan --------------------------------------------------

// Only reached when there is not enough new money. Trims the overweights by
// exactly what the underweights are short of, capped at what the overweights
// can actually give.
export function sellPlan(rows = [], minTrade = DEFAULT_MIN_TRADE) {
  const over = rows.filter(r => !r.untargeted && r.actionable && r.side === 'over');
  const under = rows.filter(r => !r.untargeted && r.actionable && r.side === 'under');
  const surplus = over.reduce((s, r) => s + -r.gap, 0);
  const deficit = under.reduce((s, r) => s + r.gap, 0);
  const move = Math.min(surplus, deficit);
  if (!(move > 0)) return { sells: [], buys: [], turnover: 0, limited: null };

  const scale = (list, pool, sign) => list
    .map(r => ({ label: r.label, amount: (sign * r.gap / pool) * move }))
    .filter(x => x.amount >= minTrade)
    .sort((a, b) => b.amount - a.amount);

  return {
    sells: scale(over, surplus, -1),
    buys: scale(under, deficit, 1),
    turnover: move,
    // Saying which side ran out first is the difference between "here is the
    // plan" and "here is as much of the plan as your book permits".
    limited: surplus < deficit ? 'surplus' : deficit < surplus ? 'deficit' : null,
  };
}

// ---- share rounding ------------------------------------------------------

// Decision 5: the residual is part of the answer.
export function roundToShares(amount, price, whole = true) {
  const a = num(amount), p = num(price);
  if (a == null || p == null || !(p > 0)) return null;
  const exact = a / p;
  const shares = whole ? Math.floor(exact) : Math.round(exact * 1e4) / 1e4;
  const spend = shares * p;
  return { shares, spend, residual: a - spend, exact };
}

// ---- holding period ------------------------------------------------------

// Decision 4: FIFO against the real order history, and unknown where the
// history cannot support an answer.
export function holdingPeriod(orders = [], ticker, asOf = new Date(), qtyHeld = null) {
  const mine = orders
    .filter(o => o && o.ticker === ticker && o.date)
    .map(o => ({ ...o, ts: new Date(o.date + (String(o.date).length <= 10 ? 'T00:00:00' : '')).getTime() }))
    .filter(o => Number.isFinite(o.ts))
    .sort((a, b) => a.ts - b.ts);

  if (!mine.length) {
    return { shortQty: 0, longQty: 0, unknownQty: num(qtyHeld) || 0, lots: [], unknown: true };
  }

  // Walk the tape, consuming the oldest open lot on every sale.
  const lots = [];
  let orphanSales = 0;
  for (const o of mine) {
    const q = num(o.qty) || 0;
    if (o.side === 'B') { lots.push({ ts: o.ts, qty: q, price: num(o.price) }); continue; }
    let left = q;
    while (left > 1e-9 && lots.length) {
      const take = Math.min(left, lots[0].qty);
      lots[0].qty -= take; left -= take;
      if (lots[0].qty <= 1e-9) lots.shift();
    }
    // A sale with nothing open in front of it means the tape is missing buys.
    if (left > 1e-9) orphanSales += left;
  }

  const open = lots.filter(l => l.qty > 1e-9);
  const cut = asOf.getTime() - LONG_TERM_DAYS * 86400e3;
  const shortQty = open.filter(l => l.ts > cut).reduce((s, l) => s + l.qty, 0);
  const longQty = open.filter(l => l.ts <= cut).reduce((s, l) => s + l.qty, 0);

  // If the book says more shares are held than the tape accounts for, the
  // difference has no acquisition date and must not be assumed long-term.
  const held = num(qtyHeld);
  const accounted = shortQty + longQty;
  const unknownQty = held != null && held - accounted > 1e-6 ? held - accounted : 0;

  return {
    shortQty, longQty, unknownQty,
    lots: open.map(l => ({ ...l, days: Math.floor((asOf.getTime() - l.ts) / 86400e3) })),
    unknown: unknownQty > 0 || orphanSales > 1e-9,
    orphanSales,
  };
}

// Decision 6: sorted by weight because a table has to be in *some* order, and
// weight is the only ordering that is a fact rather than an opinion.
export function sleeveHoldings({ held = [], priceOf, labelOf, label, orders = [], asOf = new Date() }) {
  const rows = held
    .filter(h => labelOf(h) === label)
    .map(h => {
      const value = Number(h.qty) * priceOf(h);
      const hp = holdingPeriod(orders, h.ticker, asOf, Number(h.qty));
      return { ticker: h.ticker, name: h.name || h.ticker, qty: Number(h.qty), value, ...hp };
    })
    .filter(r => r.value > 0)
    .sort((a, b) => b.value - a.value);
  const total = rows.reduce((s, r) => s + r.value, 0);
  return rows.map(r => ({ ...r, share: total ? (r.value / total) * 100 : 0 }));
}

// ---- a one-line summary that stays a summary -----------------------------

export function summarise(rows = [], band = DEFAULT_BAND) {
  const targeted = rows.filter(r => !r.untargeted);
  const actionable = targeted.filter(r => r.actionable);
  const worst = targeted.slice().sort((a, b) => Math.abs(b.driftPp ?? 0) - Math.abs(a.driftPp ?? 0))[0] || null;
  return {
    targeted: targeted.length,
    untargeted: rows.length - targeted.length,
    actionable: actionable.length,
    // Total absolute drift halved: the share of the book that would have to
    // change hands to land exactly on target.
    turnoverPct: targeted.reduce((s, r) => s + Math.abs(r.driftPp ?? 0), 0) / 2,
    worst,
    band,
  };
}
