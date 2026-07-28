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

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

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
export function totals(txns = []) {
  let income = 0, spend = 0, transfers = 0;
  for (const t of txns) {
    const a = Math.abs(num(t.amount));
    if (t.kind === 'in') income += a;
    else if (t.kind === 'transfer') transfers += a;
    else spend += a;
  }
  const net = income - spend;
  return {
    income, spend, transfers, net,
    // Unknown, not zero: with nothing coming in there is no rate to quote.
    savingsRate: income > 0 ? (net / income) * 100 : null,
    count: txns.length,
  };
}

export function byCategory(txns = []) {
  const out = new Map();
  let spend = 0;
  for (const t of txns) {
    if (t.kind !== 'out') continue;
    const k = CATEGORY[t.category] ? t.category : 'other';
    const a = Math.abs(num(t.amount));
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
export function monthlySeries(txns = [], { upTo = new Date() } = {}) {
  const cur = thisMonthKey(upTo);
  return monthsSpanned(txns, upTo).map(key => {
    const rows = inMonth(txns, key);
    const t = totals(rows);
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

// How far the current month is through, and what it is on track to reach. A
// projection, and labelled as one wherever it is shown.
export function runRate(txns = [], { now = new Date() } = {}) {
  const key = thisMonthKey(now);
  const rows = inMonth(txns, key);
  const t = totals(rows);
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
export function fixedSplit(txns = []) {
  let fixed = 0, variable = 0;
  for (const t of txns) {
    if (t.kind !== 'out') continue;
    const a = Math.abs(num(t.amount));
    if (t.fixed) fixed += a; else variable += a;
  }
  const total = fixed + variable;
  return { fixed, variable, total, fixedPct: total > 0 ? (fixed / total) * 100 : null };
}

// A charge that shows up in most months at roughly the same size is a
// subscription whether or not it was ever labelled one. Flagging them is the
// cheapest money any budget ever finds.
export function likelyRecurring(txns = [], { minMonths = 3, tolerance = 0.15 } = {}) {
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
    const amounts = rows.map(t => Math.abs(num(t.amount)));
    const avg = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    if (!(avg > 0)) continue;
    const spread = Math.max(...amounts) - Math.min(...amounts);
    if (spread / avg > tolerance) continue;
    out.push({
      note: rows[0].note, key: k, months: months.size, average: avg,
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
