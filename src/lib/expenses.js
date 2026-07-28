// Money in, money out, and the one number that decides whether the plan on the
// Plan tab is fiction: the savings rate.
//
// Four decisions here are load-bearing, and each is the kind of thing a
// spreadsheet gets wrong quietly:
//
//   1. A transfer between your own accounts is neither income nor spending.
//      Counting it as both is how people convince themselves they earn twice
//      what they earn. Transfers are kept — you want to see them — but they are
//      excluded from every total.
//
//   2. With no income recorded, the savings rate is UNKNOWN, not 0% and not
//      100%. Dividing by zero and shrugging is how a month with one logged
//      coffee becomes "you saved -infinity percent".
//
//   3. The current month is incomplete by definition. It never enters an
//      average, and anything derived from it is labelled partial.
//
//   4. Category shares are computed against spending, not against the sum of
//      income and spending, so "rent is 30%" means 30% of what you spent.
//
//   5. An amount without a currency is not a number. Every transaction carries
//      the currency it was ENTERED in, and totals convert into one base before
//      adding. The failure this prevents is the quiet one: a $12 subscription
//      and a Rs 12 chai are both "12", and a sum that treats them as equal is
//      wrong by a factor of eighty-odd while looking perfectly reasonable.
//      If a rate is missing, the row is reported as unconverted and LEFT OUT of
//      the total rather than added at face value.

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

// ---- currency -------------------------------------------------------------
// Rupees first. This is a log kept in India: rent, autos, canteen and college
// fees are all INR, and the dollar is the exception that has to be asked for.
export const CURRENCIES = [
  { key: 'INR', symbol: '\u20b9', label: 'Rupees', name: 'Indian rupee' },
  { key: 'USD', symbol: '$', label: 'Dollars', name: 'US dollar' },
];
export const DEFAULT_CUR = 'INR';
export const CUR = Object.fromEntries(CURRENCIES.map(c => [c.key, c]));
export const curOf = k => CUR[String(k || '').toUpperCase()] || CUR[DEFAULT_CUR];
export const symbolOf = k => curOf(k).symbol;

// `fx` throughout this file means USD -> INR, the same number the Money tab
// already loads. One direction only, so there is never a question about which
// way round a given call site had it.
export function convert(v, from, to, fx) {
  const a = num(v, NaN);
  if (!Number.isFinite(a)) return null;
  const f = String(from || DEFAULT_CUR).toUpperCase();
  const t = String(to || DEFAULT_CUR).toUpperCase();
  if (f === t) return a;
  const r = num(fx, 0);
  if (!(r > 0)) return null;              // no rate: unconvertible, not zero
  if (f === 'USD' && t === 'INR') return a * r;
  if (f === 'INR' && t === 'USD') return a / r;
  return null;
}

// The amount of one transaction expressed in `base`, or null if it cannot be
// expressed there. Callers must handle the null — that is the whole point.
export const amountIn = (t = {}, base = DEFAULT_CUR, fx = null) =>
  convert(Math.abs(num(t.amount)), t.cur || DEFAULT_CUR, base, fx);

export const CATEGORIES = [
  { key: 'food', label: 'Food', icon: '🍜', color: 'var(--orange)' },
  { key: 'rent', label: 'Rent & bills', icon: '⌂', color: 'var(--pink)' },
  { key: 'transport', label: 'Transport', icon: '🚌', color: 'var(--cyan)' },
  { key: 'college', label: 'College', icon: '✎', color: 'var(--purple)' },
  { key: 'shopping', label: 'Shopping', icon: '🛍', color: 'var(--yellow)' },
  { key: 'fun', label: 'Fun', icon: '★', color: 'var(--green)' },
  { key: 'health', label: 'Health', icon: '✚', color: 'var(--red)' },
  { key: 'subs', label: 'Subscriptions', icon: '↻', color: 'var(--cyan)' },
  { key: 'invest', label: 'Investing', icon: '▲', color: 'var(--green)' },
  { key: 'other', label: 'Other', icon: '·', color: 'var(--ink-2)' },
];
export const CATEGORY = Object.fromEntries(CATEGORIES.map(c => [c.key, c]));
export const catOf = k => CATEGORY[k] || CATEGORY.other;

export const KINDS = ['in', 'out', 'transfer'];
export const EMPTY_EXPENSES = { txns: [], budgets: {} };

export const monthKey = d => String(d).slice(0, 7);
export const thisMonthKey = (now = new Date()) =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

export function normaliseTxn(t = {}) {
  const kind = KINDS.includes(t.kind) ? t.kind : 'out';
  return {
    id: t.id || `tx_${Math.round(num(t.ts, 0)) || ''}${Math.random().toString(36).slice(2, 8)}`,
    date: typeof t.date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(t.date) ? t.date.slice(0, 10) : '',
    amount: Math.abs(num(t.amount)),
    kind,
    category: kind === 'out' && CATEGORY[t.category] ? t.category : kind === 'out' ? 'other' : (t.category || ''),
    note: String(t.note || '').slice(0, 120),
    account: String(t.account || ''),
    fixed: !!t.fixed,
    cur: CUR[String(t.cur || '').toUpperCase()] ? String(t.cur).toUpperCase() : DEFAULT_CUR,
    // Rows saved before currencies existed have no `cur`. They are read as
    // rupees, which is what they were typed as — the dollar sign they used to
    // render with came from the portfolio's display toggle, not from anything
    // stored on the row. Flagging the assumption so the screen can say so out
    // loud rather than quietly restating history.
    curAssumed: !CUR[String(t.cur || '').toUpperCase()],
  };
}

// Every month between the first transaction and `upTo`, in order, including the
// empty ones — a month you spent nothing in is a fact about the year, and
// dropping it makes the bar chart lie about the shape.
export function monthsSpanned(txns = [], upTo = new Date()) {
  const dated = txns.filter(t => t.date);
  if (!dated.length) return [thisMonthKey(upTo)];
  const keys = dated.map(t => monthKey(t.date)).sort();
  const [fy, fm] = keys[0].split('-').map(Number);
  const out = [];
  let y = fy, m = fm;
  const ey = upTo.getFullYear(), em = upTo.getMonth() + 1;
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

export function inMonth(txns = [], key) {
  return txns.filter(t => t.date && monthKey(t.date) === key);
}

// The totals for a set of transactions. `transfers` is reported separately and
// deliberately kept out of income and spend.
export function totals(txns = [], { base = DEFAULT_CUR, fx = null } = {}) {
  let income = 0, spend = 0, transfers = 0, unconverted = 0;
  for (const t of txns) {
    const a = amountIn(t, base, fx);
    if (a == null) { unconverted += 1; continue; }
    if (t.kind === 'in') income += a;
    else if (t.kind === 'transfer') transfers += a;
    else spend += a;
  }
  const net = income - spend;
  return {
    income, spend, transfers, net, base, unconverted,
    // Unknown, not zero: with nothing coming in there is no rate to quote.
    savingsRate: income > 0 ? (net / income) * 100 : null,
    count: txns.length,
  };
}

export function byCategory(txns = [], { base = DEFAULT_CUR, fx = null } = {}) {
  const out = new Map();
  let spend = 0;
  for (const t of txns) {
    if (t.kind !== 'out') continue;
    const k = CATEGORY[t.category] ? t.category : 'other';
    const a = amountIn(t, base, fx);
    if (a == null) continue;
    spend += a;
    const row = out.get(k) || { key: k, ...catOf(k), total: 0, count: 0, fixed: 0 };
    row.total += a;
    row.count += 1;
    if (t.fixed) row.fixed += a;
    out.set(k, row);
  }
  return [...out.values()]
    .map(r => ({ ...r, pct: spend > 0 ? (r.total / spend) * 100 : 0 }))
    .sort((a, b) => b.total - a.total);
}

// Month-by-month history. The current month is flagged `partial` and every
// consumer is expected to treat it differently — it is a month in progress, not
// a month that came in low.
export function monthlySeries(txns = [], { upTo = new Date(), base = DEFAULT_CUR, fx = null } = {}) {
  const cur = thisMonthKey(upTo);
  return monthsSpanned(txns, upTo).map(key => {
    const rows = inMonth(txns, key);
    const t = totals(rows, { base, fx });
    return { key, label: key.slice(5) + '/' + key.slice(2, 4), ...t, partial: key === cur, rows };
  });
}

// Averages over COMPLETE months only. Including a month that is four days old
// drags every average down and makes the run-rate look better than it is.
export function averages(series = []) {
  const done = series.filter(s => !s.partial);
  if (!done.length) return { months: 0, income: null, spend: null, net: null, savingsRate: null };
  const n = done.length;
  const income = done.reduce((a, s) => a + s.income, 0) / n;
  const spend = done.reduce((a, s) => a + s.spend, 0) / n;
  const totalIncome = done.reduce((a, s) => a + s.income, 0);
  const totalNet = done.reduce((a, s) => a + s.net, 0);
  return {
    months: n, income, spend, net: income - spend,
    // Money-weighted across the period, not the mean of the monthly rates —
    // one freak month with ₹100 of income would otherwise dominate.
    savingsRate: totalIncome > 0 ? (totalNet / totalIncome) * 100 : null,
  };
}

// The history of what actually got saved, month by month, with the running
// total beside it. Three decisions:
//
//   * The running total INCLUDES the month in progress, because that money is
//     genuinely already saved — but the month is flagged so the last point can
//     be drawn as provisional rather than as a finished month that came in low.
//
//   * Best and worst months are picked from COMPLETE months only. A month that
//     is three days old is always the worst month, and saying so is useless.
//
//   * The running total is allowed to go negative and the caller is told so.
//     A cumulative line clamped at zero is a chart that cannot show the thing
//     you most need to see.
export function savingsHistory(series = []) {
  let running = 0;
  const months = series.map(s => {
    running += s.net;
    return {
      key: s.key,
      label: s.label,
      income: s.income,
      spend: s.spend,
      saved: s.net,
      rate: s.savingsRate,
      cumulative: running,
      partial: !!s.partial,
      count: s.count,
    };
  });
  const done = months.filter(m => !m.partial && m.count > 0);
  const positive = done.filter(m => m.saved > 0);

  // Counted backwards from the most recent COMPLETE month. A streak that
  // stopped in March is not a streak you are currently on.
  let streak = 0;
  for (let i = done.length - 1; i >= 0; i -= 1) {
    if (done[i].saved > 0) streak += 1; else break;
  }

  return {
    months,
    total: running,
    negative: running < 0,
    completeMonths: done.length,
    best: done.length ? done.reduce((a, b) => (b.saved > a.saved ? b : a)) : null,
    worst: done.length ? done.reduce((a, b) => (b.saved < a.saved ? b : a)) : null,
    positiveMonths: positive.length,
    streak,
    // Only meaningful once there is something to be consistent about.
    consistency: done.length ? (positive.length / done.length) * 100 : null,
  };
}

// How far the current month is through, and what it is on track to reach. A
// projection, and labelled as one wherever it is shown.
export function runRate(txns = [], { now = new Date(), base = DEFAULT_CUR, fx = null } = {}) {
  const key = thisMonthKey(now);
  const rows = inMonth(txns, key);
  const t = totals(rows, { base, fx });
  const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const elapsed = Math.max(1, now.getDate());
  const frac = elapsed / days;
  return {
    key, elapsed, days, frac,
    spend: t.spend, income: t.income,
    projectedSpend: t.spend / frac,
    projectedIncome: t.income / frac,
    partial: elapsed < days,
  };
}

// Fixed versus variable. Fixed costs are the ones you cannot decide your way out
// of this month, so the split says how much of the spending is actually
// controllable — which is the only part a budget can touch.
export function fixedSplit(txns = [], { base = DEFAULT_CUR, fx = null } = {}) {
  let fixed = 0, variable = 0;
  for (const t of txns) {
    if (t.kind !== 'out') continue;
    const a = amountIn(t, base, fx);
    if (a == null) continue;
    if (t.fixed) fixed += a; else variable += a;
  }
  const total = fixed + variable;
  return { fixed, variable, total, fixedPct: total > 0 ? (fixed / total) * 100 : null };
}

// A charge that shows up in most months at roughly the same size is a
// subscription whether or not it was ever labelled one. Flagging them is the
// cheapest money any budget ever finds.
export function likelyRecurring(txns = [], { minMonths = 3, tolerance = 0.15, base = DEFAULT_CUR, fx = null } = {}) {
  const byNote = new Map();
  for (const t of txns) {
    if (t.kind !== 'out' || !t.note) continue;
    const k = t.note.trim().toLowerCase();
    if (!byNote.has(k)) byNote.set(k, []);
    byNote.get(k).push(t);
  }
  const out = [];
  for (const [k, rows] of byNote) {
    const months = new Set(rows.map(t => monthKey(t.date)));
    if (months.size < minMonths) continue;
    const amounts = rows.map(t => amountIn(t, base, fx)).filter(v => v != null);
    if (!amounts.length) continue;
    const avg = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    if (!(avg > 0)) continue;
    const spread = Math.max(...amounts) - Math.min(...amounts);
    if (spread / avg > tolerance) continue;
    out.push({
      note: rows[0].note, key: k, months: months.size, average: avg, base,
      annual: avg * 12, category: rows[0].category, alreadyFixed: rows.every(t => t.fixed),
    });
  }
  return out.sort((a, b) => b.annual - a.annual);
}

export function budgetStatus(cats = [], budgets = {}) {
  return cats.map(c => {
    const cap = num(budgets[c.key], 0);
    return {
      ...c,
      budget: cap > 0 ? cap : null,
      usedPct: cap > 0 ? (c.total / cap) * 100 : null,
      over: cap > 0 && c.total > cap,
      left: cap > 0 ? cap - c.total : null,
    };
  });
}

// The handshake with the Plan tab: a monthly surplus is a contribution the plan
// can compound. Computed from complete months only, so it is a rate that has
// actually been sustained rather than one good week.
export function plannerContribution(series = []) {
  const a = averages(series);
  if (!a.months || a.net == null) return { monthly: 0, months: 0, savingsRate: null, confident: false };
  return {
    monthly: Math.max(0, a.net),
    months: a.months,
    savingsRate: a.savingsRate,
    // Two months is an anecdote. Six is a habit.
    confident: a.months >= 6,
  };
}
