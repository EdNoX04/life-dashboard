// tax.js — capital-gains arithmetic for the money tab.
//
// This is the most dangerous file in the money tab, because tax arithmetic looks
// authoritative even when it is out of date, and being out of date is the default
// state of any tax rate written into source code. Everything below is arithmetic
// on numbers the user supplies. It is not tax advice, and the screen that renders
// it says so in as many words.
//
// Six decisions, each of which is easy to get quietly wrong:
//
// 1. RATES ARE INPUTS, NEVER CONSTANTS. DEFAULT_RATES carries an `asOf` stamp that
//    is displayed on screen. A rate hard-coded without a date is a lie with a long
//    shelf life: it keeps producing confident numbers years after it stopped being
//    true. Every rate here is editable and every screen shows when it was written.
//
// 2. THE LONG-TERM EXEMPTION IS PER FINANCIAL YEAR AND SHARED ACROSS THE WHOLE BOOK.
//    Applying it per position multiplies the exemption by the number of holdings,
//    which is the single most expensive mistake this file could make. It is applied
//    exactly once, to the aggregate.
//
// 3. THE INDIAN FINANCIAL YEAR RUNS 1 APRIL – 31 MARCH. A sale in January belongs to
//    the previous April's year. Bucketing by calendar year moves three months of
//    gains into the wrong return.
//
// 4. THE LONG-TERM THRESHOLD IS A PROPERTY OF THE ASSET, NOT OF THE PORTFOLIO.
//    Domestic listed equity turns long-term at 12 months; unlisted foreign shares at
//    24. A single global threshold silently reclassifies half the book.
//
// 5. UNREALISED IS NOT REALISED. Harvest candidates are positions that *could* be
//    sold. Nothing in that section has happened, and it never enters the realised
//    figures until an order exists on the tape.
//
// 6. IT COMPUTES; IT DOES NOT ADVISE. Nothing here decides what to sell, when to
//    sell, or whether a given treatment applies to Neel's particular facts. Neel has
//    an accountant for a reason and this file says so.

// Number(null), Number('') and Number(false) are all 0, and 0 is finite — so the
// obvious `Number.isFinite(Number(v)) ? Number(v) : null` turns a MISSING value
// into a real zero. A missing price becoming a price of zero is the difference
// between 'we do not know' and 'it is free'. Absence is checked before coercion.
const num = v => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

const DAY = 86400e3;
const MONTH_DAYS = 30.44; // average; months are not a fixed number of days

// Decision 1: dated, editable, and honest about what it does not know.
export const DEFAULT_RATES = {
  asOf: '2026-07',
  note: 'Indian resident, listed equity and foreign shares. Confirm against the current Finance Act — these change most budgets.',
  inShortPct: 20,
  inLongPct: 12.5,
  inLongExempt: 125000,
  fgShortPct: 30,
  fgLongPct: 12.5,
  fgLongMonths: 24,
  inLongMonths: 12,
  dividendWhtPct: 25,
  cess: 4,
};

export const RATE_FIELDS = [
  { key: 'inShortPct', label: 'India short-term %', hint: 'Listed equity sold inside the holding period, on which STT was paid.' },
  { key: 'inLongPct', label: 'India long-term %', hint: 'Applies only to the gain left after the annual exemption below.' },
  { key: 'inLongExempt', label: 'Long-term exempt ₹', hint: 'Per financial year, shared across every holding — not per stock.' },
  { key: 'fgShortPct', label: 'Foreign short-term %', hint: 'Usually taxed at the slab rate, so this is the marginal rate, not a flat one.' },
  { key: 'fgLongPct', label: 'Foreign long-term %', hint: 'Check whether indexation is available for the year in question.' },
  { key: 'inLongMonths', label: 'India long after (months)', hint: 'Listed equity has historically been 12 months.' },
  { key: 'fgLongMonths', label: 'Foreign long after (months)', hint: 'Unlisted and foreign shares have historically been 24 months.' },
];

// ---------------------------------------------------------------------------
// Decision 3: the year runs April to March.
// ---------------------------------------------------------------------------

export function fyBounds(d = new Date()) {
  const dt = d instanceof Date ? d : new Date(d);
  const y = dt.getUTCFullYear();
  // January, February and March belong to the financial year that opened the
  // previous April. This is the whole point of the function.
  const startYear = dt.getUTCMonth() >= 3 ? y : y - 1;
  return {
    startYear,
    from: Date.UTC(startYear, 3, 1),
    to: Date.UTC(startYear + 1, 2, 31, 23, 59, 59, 999),
    label: `FY${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`,
  };
}

export function fyList(back = 4, d = new Date()) {
  const cur = fyBounds(d);
  const out = [];
  for (let i = 0; i <= back; i++) {
    out.push(fyBounds(new Date(Date.UTC(cur.startYear - i, 6, 1))));
  }
  return out;
}

// Decision 4: resolved per asset, never globally.
export function termOf(days, foreign, rates = DEFAULT_RATES) {
  const months = foreign ? (rates.fgLongMonths ?? 24) : (rates.inLongMonths ?? 12);
  return days >= months * MONTH_DAYS ? 'long' : 'short';
}

const tsOf = o => {
  if (!o || !o.date) return null;
  const s = String(o.date);
  const t = new Date(s + (s.length <= 10 ? 'T00:00:00Z' : '')).getTime();
  return Number.isFinite(t) ? t : null;
};

// ---------------------------------------------------------------------------
// FIFO against the real order tape.
// ---------------------------------------------------------------------------

// Returns { open, closed, orphanQty }. A closed lot is one matched buy-then-sell
// pair. Both the cost of acquisition and the cost of transfer reduce the gain —
// charging only one of them overstates every disposal on the book.
export function fifo(orders = [], ticker) {
  const mine = (orders || [])
    .filter(o => o && o.ticker === ticker)
    .map(o => ({ ...o, ts: tsOf(o) }))
    .filter(o => o.ts != null)
    .sort((a, b) => a.ts - b.ts);

  const open = [];
  const closed = [];
  let orphanQty = 0;

  for (const o of mine) {
    const q = num(o.qty) || 0;
    const price = num(o.price) || 0;
    const fee = num(o.fee) || 0;
    if (q <= 0) continue;

    if (o.side !== 'S') {
      open.push({ ts: o.ts, qty: q, price, feePerShare: q > 0 ? fee / q : 0 });
      continue;
    }

    let left = q;
    const feePerShare = q > 0 ? fee / q : 0;
    while (left > 1e-9 && open.length) {
      const lot = open[0];
      const take = Math.min(left, lot.qty);
      const buyFeeShare = lot.feePerShare * take;
      closed.push({
        ticker,
        qty: take,
        buyTs: lot.ts,
        sellTs: o.ts,
        buyPrice: lot.price,
        sellPrice: price,
        days: Math.floor((o.ts - lot.ts) / DAY),
        gain: take * (price - lot.price) - buyFeeShare - feePerShare * take,
      });
      lot.qty -= take;
      left -= take;
      if (lot.qty <= 1e-9) open.shift();
    }
    // A sale with nothing open in front of it means the tape is missing buys.
    // It is reported, not silently treated as a zero-cost acquisition.
    if (left > 1e-9) orphanQty += left;
  }

  return { open: open.filter(l => l.qty > 1e-9), closed, orphanQty };
}

// Every closed lot whose SALE falls inside the year. The purchase may be from any
// year at all — that is exactly what a holding period is.
export function realised({ orders = [], fy = fyBounds(), foreignOf = () => false, rates = DEFAULT_RATES }) {
  const tickers = [...new Set((orders || []).filter(o => o && o.ticker).map(o => o.ticker))];
  const lots = [];
  let incomplete = 0;

  for (const t of tickers) {
    const { closed, orphanQty } = fifo(orders, t);
    if (orphanQty > 1e-9) incomplete += 1;
    const foreign = !!foreignOf(t);
    for (const c of closed) {
      if (c.sellTs < fy.from || c.sellTs > fy.to) continue;
      lots.push({ ...c, foreign, term: termOf(c.days, foreign, rates) });
    }
  }

  lots.sort((a, b) => a.sellTs - b.sellTs);

  const bucket = (foreign, term) =>
    lots.filter(l => l.foreign === foreign && l.term === term).reduce((s, l) => s + l.gain, 0);

  return {
    fy,
    lots,
    orphan: incomplete,
    inShort: bucket(false, 'short'),
    inLong: bucket(false, 'long'),
    fgShort: bucket(true, 'short'),
    fgLong: bucket(true, 'long'),
    incomplete: incomplete > 0,
  };
}

// ---------------------------------------------------------------------------
// Decision 2: the exemption is applied ONCE, to the aggregate.
// ---------------------------------------------------------------------------

export function taxPosition(r, rates = DEFAULT_RATES) {
  // A loss does not produce a negative tax. Rate × negative number is a refund
  // this file is in no position to promise.
  const pct = (v, p) => (v > 0 ? (v * (num(p) || 0)) / 100 : 0);

  const exempt = num(rates.inLongExempt) || 0;
  const inLongTaxable = Math.max(0, r.inLong - exempt);

  const base = {
    inShort: pct(r.inShort, rates.inShortPct),
    inLong: pct(inLongTaxable, rates.inLongPct),
    fgShort: pct(r.fgShort, rates.fgShortPct),
    fgLong: pct(r.fgLong, rates.fgLongPct),
  };

  const tax = Object.values(base).reduce((s, v) => s + v, 0);
  const cess = (tax * (num(rates.cess) || 0)) / 100;

  return {
    ...base,
    exemptionUsed: Math.min(Math.max(0, r.inLong), exempt),
    exemptionLeft: Math.max(0, exempt - Math.max(0, r.inLong)),
    inLongTaxable,
    tax,
    cess,
    total: tax + cess,
    // Losses carry forward; they do not net against this year's tax as a refund.
    // Reporting a negative total would be inventing money.
    carry: {
      short: Math.min(0, r.inShort) + Math.min(0, r.fgShort),
      long: Math.min(0, r.inLong) + Math.min(0, r.fgLong),
    },
  };
}

// ---------------------------------------------------------------------------
// Decision 5: these are unrealised. Nothing in this section has happened.
// ---------------------------------------------------------------------------

export function recentBuys(orders = [], ticker, asOf = new Date(), days = 30) {
  const cut = (asOf instanceof Date ? asOf.getTime() : new Date(asOf).getTime()) - days * DAY;
  return (orders || [])
    .filter(o => o && o.ticker === ticker && o.side !== 'S')
    .map(o => ({ ...o, ts: tsOf(o) }))
    .filter(o => o.ts != null && o.ts >= cut);
}

// Open lots sitting at a loss. Each carries the flag that matters for it:
//
//   washKind 'statutory'  — a US holding, where the wash-sale rule is actual law
//                           and disallows the loss outright.
//   washKind 'scrutiny'   — an Indian listed holding, where no equivalent statute
//                           exists for equity, but buying straight back is exactly
//                           the pattern an assessing officer reads as a device.
//
// One blanket warning would be wrong in both directions: it would overstate the
// Indian case and understate the American one.
export function harvestCandidates({
  held = [],
  orders = [],
  priceOf = () => null,
  foreignOf = () => false,
  asOf = new Date(),
  rates = DEFAULT_RATES,
  washDays = 30,
} = {}) {
  const now = asOf instanceof Date ? asOf : new Date(asOf);
  const out = [];

  for (const h of held) {
    const ticker = h?.ticker;
    if (!ticker) continue;
    const price = num(priceOf(h));
    if (price == null || !(price > 0)) continue;

    const foreign = !!foreignOf(h);
    const { open } = fifo(orders, ticker);
    const recent = recentBuys(orders, ticker, now, washDays);

    for (const lot of open) {
      const cost = lot.qty * lot.price;
      const value = lot.qty * price;
      const loss = value - cost;
      if (!(loss < 0)) continue; // only lots at a loss are candidates
      const days = Math.floor((now.getTime() - lot.ts) / DAY);
      out.push({
        ticker,
        name: h.name || ticker,
        foreign,
        term: termOf(days, foreign, rates),
        days,
        qty: lot.qty,
        cost,
        price,
        value,
        loss,
        boughtTs: lot.ts,
        washRisk: recent.length > 0,
        washKind: foreign ? 'statutory' : 'scrutiny',
        washDays,
      });
    }
  }

  return out.sort((a, b) => a.loss - b.loss); // largest loss first
}

// Re-runs taxPosition with the losses added, rather than subtracting a rate from a
// total. The exemption makes the shortcut wrong: below the threshold a harvested
// long-term loss saves nothing at all.
export function harvestEffect(r, picks = [], rates = DEFAULT_RATES) {
  const before = taxPosition(r, rates);
  const add = { inShort: 0, inLong: 0, fgShort: 0, fgLong: 0 };
  let lossUsed = 0;

  for (const p of picks) {
    const loss = num(p?.loss) || 0;
    if (!(loss < 0)) continue;
    lossUsed += loss;
    const key = p.foreign ? (p.term === 'long' ? 'fgLong' : 'fgShort') : p.term === 'long' ? 'inLong' : 'inShort';
    add[key] += loss;
  }

  const after = taxPosition(
    {
      inShort: r.inShort + add.inShort,
      inLong: r.inLong + add.inLong,
      fgShort: r.fgShort + add.fgShort,
      fgLong: r.fgLong + add.fgLong,
    },
    rates
  );

  const saved = before.total - after.total;

  return {
    before,
    after,
    saved,
    lossUsed,
    // The exemption already covered the gain, so harvesting here spends a loss
    // that could have sheltered a future year for nothing.
    wasted: picks.length > 0 && saved <= 0.01,
  };
}

// ---------------------------------------------------------------------------
// The filing pack. Not a return — a list of the figures a return asks for, so the
// conversation with an accountant starts from arithmetic instead of screenshots.
// ---------------------------------------------------------------------------

export function filingPack({ r, position, dividends = 0, foreignWht = 0, foreignAssets = [] }) {
  const lines = [
    { code: 'CG-A', label: 'Short-term capital gains — Indian listed equity', amount: r.inShort },
    { code: 'CG-B', label: 'Long-term capital gains — Indian listed equity', amount: r.inLong },
    { code: 'CG-B1', label: 'Long-term gain remaining after the annual exemption', amount: position.inLongTaxable },
    { code: 'CG-C', label: 'Short-term capital gains — foreign shares', amount: r.fgShort },
    { code: 'CG-D', label: 'Long-term capital gains — foreign shares', amount: r.fgLong },
    { code: 'OS-1', label: 'Dividend income', amount: dividends },
    { code: 'FTC', label: 'Foreign tax already withheld (credit claimable)', amount: foreignWht },
    { code: 'TAX', label: 'Tax before cess', amount: position.tax },
    { code: 'CESS', label: 'Cess', amount: position.cess },
    { code: 'TOT', label: 'Total tax on capital gains', amount: position.total },
  ];

  return {
    fy: r.fy,
    lines,
    // Schedule FA is a disclosure, not a tax. Missing it is penalised far more
    // harshly than the tax on the assets it discloses, which is why it is listed
    // separately rather than folded into the numbers above.
    scheduleFA: foreignAssets.map(a => ({
      ticker: a.ticker,
      name: a.name || a.ticker,
      qty: a.qty,
      value: a.value,
      note: 'Foreign asset — disclosure required regardless of whether it was sold.',
    })),
    caveats: [
      'Rates are whatever was typed into the rate editor, stamped with the date they were entered. Confirm them against the Finance Act for this year before anything is filed.',
      'Gains are computed FIFO from the order tape in this app. If a trade is missing from the tape it is missing from these figures.',
      'Set-off and carry-forward of losses across years is not modelled here; only this year is.',
      'This is arithmetic, not tax advice. Neel has an accountant; this is what to hand them.',
    ],
  };
}

const esc = v => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCSV(pack) {
  const rows = [['Code', 'Line', 'Amount'], ...pack.lines.map(l => [l.code, l.label, Math.round(l.amount * 100) / 100])];
  for (const a of pack.scheduleFA || []) {
    rows.push(['FA', `${a.ticker} — ${a.name} (${a.qty} units)`, Math.round((a.value || 0) * 100) / 100]);
  }
  return rows.map(r => r.map(esc).join(',')).join('\n');
}
