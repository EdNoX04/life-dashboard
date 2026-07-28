// Dividends: what the book pays, when it pays it, and how sure we are.
//
// The single most important idea in this file is the distinction between a
// payment that has been DECLARED and one that has been ESTIMATED from a payment
// history. They look identical on a calendar and they are not remotely the same
// claim. A declared payment has a board resolution behind it. An estimate is a
// guess that the last pattern repeats — a guess that a dividend cut vaporises
// without warning. Every payment this module produces carries `status`, and any
// UI that draws them must draw them differently.
//
// Nothing here fetches. The data comes from what the user has entered (or an
// import), because dividend detail is behind a paywall on every free API worth
// trusting, and a wrong dividend schedule is worse than an empty one.

export const FREQS = [
  { key: 'monthly', label: 'Monthly', per: 12 },
  { key: 'quarterly', label: 'Quarterly', per: 4 },
  { key: 'semiannual', label: 'Twice a year', per: 2 },
  { key: 'annual', label: 'Yearly', per: 1 },
  { key: 'none', label: 'Pays nothing', per: 0 },
];

export const perYear = f => FREQS.find(x => x.key === f)?.per ?? 0;
export const EMPTY_DIVS = { rows: {} };

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTH_NAMES = MONTHS;

const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

// A dividend entry, normalised. Missing fields get defensible defaults; a
// missing per-share amount is left as null rather than 0, because "I don't know
// what this pays" and "this pays nothing" are different facts and only one of
// them should be shown as a zero.
export function normaliseEntry(e = {}) {
  const freq = FREQS.some(f => f.key === e.freq) ? e.freq : 'quarterly';
  const perShare = e.perShare == null || e.perShare === '' ? null : Math.max(0, num(e.perShare));
  return {
    perShare,
    freq,
    anchorMonth: Math.min(11, Math.max(0, Math.round(num(e.anchorMonth, 0)))),
    payDay: Math.min(28, Math.max(1, Math.round(num(e.payDay, 15)))),
    exOffsetDays: Math.max(0, Math.round(num(e.exOffsetDays, 14))),
    growthPct: num(e.growthPct, 0),
    baseYear: Math.round(num(e.baseYear, new Date().getFullYear())),
    declared: Array.isArray(e.declared) ? e.declared : [],
    note: e.note || '',
  };
}

// Annual per-share payout at the entry's stated rate.
export function annualPerShare(entry) {
  const e = normaliseEntry(entry);
  if (e.perShare == null) return null;
  return e.perShare * perYear(e.freq);
}

// The months a schedule pays in, given its frequency and anchor.
export function payMonths(entry) {
  const e = normaliseEntry(entry);
  const per = perYear(e.freq);
  if (!per) return [];
  const step = 12 / per;
  return Array.from({ length: per }, (_, k) => (e.anchorMonth + k * step) % 12).sort((a, b) => a - b);
}

// Every payment a single holding makes in a calendar year.
//
// Declared payments win over estimates for the same month — if a board has told
// you what it will pay, an extrapolation of past behaviour is strictly worse
// information and must not overwrite it.
export function paymentsForYear(ticker, entry, shares, year, { fx = 1 } = {}) {
  const e = normaliseEntry(entry);
  const per = perYear(e.freq);
  const qty = Math.max(0, num(shares));
  if (!per || e.perShare == null || !(e.perShare > 0) || !(qty > 0)) return [];

  const grow = Math.pow(1 + num(e.growthPct) / 100, year - e.baseYear);
  const base = e.perShare * (Number.isFinite(grow) && grow > 0 ? grow : 1);

  const declaredByMonth = new Map();
  for (const d of e.declared) {
    const pay = d?.pay ? new Date(d.pay) : null;
    if (!pay || Number.isNaN(pay.getTime()) || pay.getFullYear() !== year) continue;
    declaredByMonth.set(pay.getMonth(), d);
  }

  const out = [];
  for (const m of payMonths(e)) {
    const d = declaredByMonth.get(m);
    if (d) {
      const pay = new Date(d.pay);
      const ex = d.ex ? new Date(d.ex) : addDays(pay, -e.exOffsetDays);
      const ps = d.perShare == null ? base : num(d.perShare);
      out.push({
        ticker, month: m, pay: iso(pay), ex: iso(ex),
        perShare: ps, shares: qty, amount: ps * qty * fx, status: 'declared',
      });
      declaredByMonth.delete(m);
    } else {
      const pay = new Date(year, m, Math.min(e.payDay, daysInMonth(year, m)));
      const ex = addDays(pay, -e.exOffsetDays);
      out.push({
        ticker, month: m, pay: iso(pay), ex: iso(ex),
        perShare: base, shares: qty, amount: base * qty * fx, status: 'estimated',
      });
    }
  }
  // A special or off-cycle declared payment that fell outside the regular
  // months still happened. Dropping it would understate real income.
  for (const [m, d] of declaredByMonth) {
    const pay = new Date(d.pay);
    const ps = d.perShare == null ? base : num(d.perShare);
    out.push({
      ticker, month: m, pay: iso(pay),
      ex: iso(d.ex ? new Date(d.ex) : addDays(pay, -e.exOffsetDays)),
      perShare: ps, shares: qty, amount: ps * qty * fx, status: 'declared', special: true,
    });
  }
  return out.sort((a, b) => a.pay.localeCompare(b.pay));
}

// The whole book's payments for a year, flattened and sorted.
export function calendarForYear(held = [], meta = {}, year, { sharesOf, fx = 1 } = {}) {
  const y = Math.round(num(year, new Date().getFullYear()));
  const out = [];
  for (const h of held) {
    const t = h.ticker || h.symbol;
    if (!t) continue;
    const shares = sharesOf ? sharesOf(h) : num(h.qty ?? h.shares);
    out.push(...paymentsForYear(t, meta[t], shares, y, { fx }));
  }
  return out.sort((a, b) => a.pay.localeCompare(b.pay));
}

// Twelve buckets. Always twelve — a month with no payments is a real, meaningful
// zero and collapsing it would make the bar chart lie about the shape of the year.
export function monthlyTotals(payments = []) {
  const rows = MONTHS.map((label, m) => ({ month: m, label, total: 0, declared: 0, estimated: 0, items: [] }));
  for (const p of payments) {
    const r = rows[p.month];
    if (!r) continue;
    r.total += num(p.amount);
    r[p.status === 'declared' ? 'declared' : 'estimated'] += num(p.amount);
    r.items.push(p);
  }
  return rows;
}

// Headline numbers for the stat tiles.
export function incomeSummary(payments = [], { today = new Date() } = {}) {
  const rows = monthlyTotals(payments);
  const annual = rows.reduce((a, r) => a + r.total, 0);
  const paying = rows.filter(r => r.total > 0);
  const peak = rows.reduce((best, r) => (!best || r.total > best.total ? r : best), null);
  const lean = paying.length ? paying.reduce((worst, r) => (!worst || r.total < worst.total ? r : worst), null) : null;
  const declared = payments.filter(p => p.status === 'declared').reduce((a, p) => a + num(p.amount), 0);
  return {
    annual,
    averageMonthly: annual / 12,
    thisMonth: rows[today.getMonth()]?.total ?? 0,
    thisMonthLabel: MONTHS[today.getMonth()],
    peak: peak && peak.total > 0 ? peak : null,
    lean,
    payingMonths: paying.length,
    declaredShare: annual > 0 ? (declared / annual) * 100 : 0,
    rows,
  };
}

// The next few payments from a date. Used for the "coming up" strip — the one
// part of this screen with any immediacy to it.
export function upcoming(payments = [], { today = new Date(), limit = 6, key = 'pay' } = {}) {
  const t = iso(today);
  return payments.filter(p => p[key] >= t).sort((a, b) => a[key].localeCompare(b[key])).slice(0, limit);
}

// Per-holding income lines: what each position pays, at what yield, and on what
// basis. yieldOnCost is the number dividend investors actually care about and
// almost no broker shows.
export function perHolding(held = [], meta = {}, { sharesOf, priceOf, costOf, year, fx = 1 } = {}) {
  const y = Math.round(num(year, new Date().getFullYear()));
  return held.map(h => {
    const ticker = h.ticker || h.symbol;
    const shares = sharesOf ? sharesOf(h) : num(h.qty ?? h.shares);
    const price = priceOf ? num(priceOf(h)) : num(h.last_price ?? h.price);
    const cost = costOf ? num(costOf(h)) : num(h.avg_cost ?? h.cost);
    const entry = meta[ticker];
    const has = entry && normaliseEntry(entry).perShare != null && perYear(normaliseEntry(entry).freq) > 0;
    const aps = has ? annualPerShare(entry) : null;
    const income = aps == null ? null : aps * shares * fx;
    const pays = has ? paymentsForYear(ticker, entry, shares, y, { fx }) : [];
    return {
      ticker, shares, price, cost, entry: has ? normaliseEntry(entry) : null,
      annualPerShare: aps,
      income,
      currentYield: aps != null && price > 0 ? (aps / price) * 100 : null,
      yieldOnCost: aps != null && cost > 0 ? (aps / cost) * 100 : null,
      marketValue: price * shares * fx,
      payments: pays,
      next: upcoming(pays, { limit: 1 })[0] || null,
      declared: pays.some(p => p.status === 'declared'),
      unknown: !has,
    };
  });
}

// How much of the book we actually have dividend data for. A screen that
// reports "₹12,000/yr" while silently ignoring half the portfolio is worse than
// one that reports nothing, so this coverage figure is not optional decoration
// — it belongs next to the headline.
export function coverage(lines = []) {
  const total = lines.reduce((a, l) => a + num(l.marketValue), 0);
  const known = lines.filter(l => !l.unknown).reduce((a, l) => a + num(l.marketValue), 0);
  const missing = lines.filter(l => l.unknown).map(l => l.ticker);
  return {
    total, known, missing,
    pct: total > 0 ? (known / total) * 100 : 0,
    complete: missing.length === 0 && lines.length > 0,
  };
}

// Portfolio-level yield, computed on the value we have data for rather than on
// the whole book — otherwise adding a non-dividend stock would appear to cut
// the yield of the dividend holdings, which it does not do.
export function bookYield(lines = []) {
  const known = lines.filter(l => !l.unknown);
  const value = known.reduce((a, l) => a + num(l.marketValue), 0);
  const income = known.reduce((a, l) => a + num(l.income), 0);
  const costBase = known.reduce((a, l) => a + num(l.cost) * num(l.shares), 0);
  return {
    income,
    onValue: value > 0 ? (income / value) * 100 : null,
    onCost: costBase > 0 ? (income / costBase) * 100 : null,
    value,
  };
}

// Forward years of income, letting per-share growth compound. This is the
// snowball seen from the income side; it deliberately holds share count fixed,
// so it answers "what do the shares I own today pay in five years" and not
// "what happens if I keep buying" — which is the planner's question, not this one.
export function incomeLadder(lines = [], years = 5, { growthPct = null } = {}) {
  const out = [];
  const y0 = new Date().getFullYear();
  for (let k = 0; k <= Math.max(0, Math.round(num(years, 5))); k++) {
    let total = 0;
    for (const l of lines) {
      if (l.unknown || l.income == null) continue;
      const g = growthPct == null ? num(l.entry?.growthPct) : num(growthPct);
      total += l.income * Math.pow(1 + g / 100, k);
    }
    out.push({ year: y0 + k, offset: k, income: total, monthly: total / 12 });
  }
  return out;
}
