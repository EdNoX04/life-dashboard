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
  // Auto has its own line because it IS the spending: 28 of the first 65
  // entries were autos, every one of them filed under a bucket that also had
  // to hold a car wash. A category that holds 43% of your rows tells you
  // nothing you did not already know — the whole point of a category is that
  // it can be compared with another one.
  { key: 'auto', label: 'Auto', icon: '🛺', color: 'var(--cyan)' },
  { key: 'cab', label: 'Cab', icon: '🚕', color: 'var(--yellow)' },
  { key: 'transport', label: 'Transport, other', icon: '🚌', color: 'var(--s2)' },
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

// LENDING IS NOT SPENDING, AND BEING REPAID IS NOT INCOME.
//
// Five thousand rupees lent to a friend leaves your pocket exactly like five
// thousand spent on dinner, and the two are nothing alike: one is gone, the
// other is still yours and is sitting with someone else. Counted as spending it
// makes a month look ruinous and then makes the month you are repaid look like
// a windfall — two wrong numbers that cancel out over a year, which is the
// worst kind, because the total looks right and every month is wrong.
//
// So a `ledger` row moves cash without touching income or spend. It is not a
// third category; it is a different axis, and the code keeps it that way.
//
//   'lend'    money out, they now owe you
//   'borrow'  money in, you now owe them
//   'settle'  a repayment, direction taken from `kind`
//
// ONE SIGN RULE COVERS ALL FOUR CASES. Positive means they owe you:
//
//   money OUT  -> +amount   (you lent, or you paid them back)
//   money IN   -> −amount   (they repaid you, or you borrowed)
//
// That is not a coincidence worth being pleased about — it is the definition of
// a running balance, and writing it as four branches is how three of them end
// up with the wrong sign.
export const LEDGER = ['lend', 'borrow', 'settle'];

// INVESTING IS NOT SPENDING EITHER, AND FOR THE SAME REASON.
//
// ₹500 into QQQ leaves your account exactly like ₹500 on dinner and is
// nothing like it: the dinner is gone, the QQQ is on the next tab of this app
// with a price against it. Counted as spending it is DOUBLE-COUNTED — once as
// money consumed here and once as an asset owned there — and it drags the
// savings rate down by precisely the amount you saved, which is about as
// backwards as a number can be while still looking plausible.
//
// So the invest category is a flow, not a spend. It leaves `spend`, keeps its
// own line, and lands in `net` where it belongs: money you did not consume.
export const INVEST_CATEGORY = 'invest';
export const LEDGER_LABEL = {
  lend: 'Lent', borrow: 'Borrowed', settle: 'Settling up',
};
export const isLedger = t => LEDGER.includes(t?.ledger);
export const isInvest = t => t?.kind === 'out' && t?.category === INVEST_CATEGORY && !isLedger(t);
/** Change to what this person owes you. Money out increases it; money in reduces it. */
export const ledgerDelta = (t = {}) =>
  (isLedger(t) ? (t.kind === 'out' ? 1 : -1) * Math.abs(num(t.amount)) : 0);

export const EMPTY_EXPENSES = { txns: [], budgets: {}, people: [] };

// ------------------------------------------------------------------ people

export const personId = name =>
  String(name || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 40);

export function normalisePerson(p = {}) {
  const name = String(p.name || '').trim().slice(0, 40);
  return { id: p.id || personId(name), name, note: String(p.note || '').slice(0, 200) };
}

export function addPerson(people = [], name, note = '') {
  const person = normalisePerson({ name, note });
  if (!person.name || !person.id) return people;
  if (people.some(p => p.id === person.id)) return people;
  return [...people, person];
}

export const removePerson = (people = [], id) => people.filter(p => p.id !== id);
export const personOf = (people = [], id) => people.find(p => p.id === id) || null;

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
    // A category only ever meant something for spending. Money coming in used
    // to keep whatever the form last had selected, which is how "Father,
    // ₹10,000" ended up filed under Fun and "Dunu, ₹2,000" under Transport —
    // six rows, ₹27,000, sorted into buckets they have nothing to do with.
    // Non-spending rows now carry no category rather than a misleading one.
    category: kind === 'out' && CATEGORY[t.category] ? t.category : kind === 'out' ? 'other' : '',
    // Who this was with. Free of the note field, so it can be totalled.
    person: String(t.person || '').slice(0, 40),
    ledger: LEDGER.includes(t.ledger) ? t.ledger : null,
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
  let lent = 0, borrowed = 0, repaidIn = 0, repaidOut = 0, invested = 0;
  for (const t of txns) {
    const a = amountIn(t, base, fx);
    if (a == null) { unconverted += 1; continue; }
    // Lending is not spending and repayment is not income. These rows are real
    // cash movements and are reported as such, on their own lines, outside the
    // two totals a savings rate is computed from.
    if (isLedger(t)) {
      if (t.ledger === 'lend') lent += a;
      else if (t.ledger === 'borrow') borrowed += a;
      else if (t.kind === 'in') repaidIn += a;
      else repaidOut += a;
      continue;
    }
    // Same argument as the ledger rows above: this money is not gone, it is
    // somewhere else with your name on it.
    if (isInvest(t)) { invested += a; continue; }
    if (t.kind === 'in') income += a;
    else if (t.kind === 'transfer') transfers += a;
    else spend += a;
  }
  const net = income - spend;
  return {
    income, spend, transfers, net, base, unconverted,
    lent, borrowed, repaidIn, repaidOut, invested,
    // What actually left or entered your hands, including the lending. Kept
    // apart from `net` because one answers "how am I doing" and the other
    // answers "where did the balance go", and they are different questions
    // that a single figure would have to pick between.
    cashOut: spend + lent + repaidOut + invested,
    cashIn: income + transfers + borrowed + repaidIn,
    // Unknown, not zero: with nothing coming in there is no rate to quote.
    // `net` is income minus what you CONSUMED, so money moved into investments
    // now counts as kept rather than against you. Reporting it the other way
    // was subtracting your saving from your savings rate.
    savingsRate: income > 0 ? (net / income) * 100 : null,
    // How much of what you kept actually went somewhere rather than sitting in
    // the account. Null, not 0, when nothing was kept — a share of nothing is
    // undefined, not zero percent.
    investedShare: net > 0 ? (invested / net) * 100 : null,
    count: txns.length,
  };
}

export function byCategory(txns = [], { base = DEFAULT_CUR, fx = null } = {}) {
  const out = new Map();
  let spend = 0;
  for (const t of txns) {
    // Investing stays out of the spending breakdown for the same reason it
    // stays out of `spend`: reported on its own, where it cannot be mistaken
    // for money that is gone.
    if (t.kind !== 'out' || isLedger(t) || isInvest(t)) continue;
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

// ------------------------------------------------------- who owes whom

/**
 * Running balance per person. Positive means they owe you.
 *
 * People with a zero balance are KEPT, not dropped. "Dunu: settled" is the
 * answer to a question you will ask again, and a name vanishing the moment it
 * squares up is how you end up unsure whether it was ever settled or whether
 * you forgot to record the loan at all.
 */
export function peopleBalances(txns = [], people = [], { base = DEFAULT_CUR, fx = null } = {}) {
  const rows = new Map();
  const ensure = (id, name) => {
    if (!rows.has(id)) {
      rows.set(id, { id, name: name || id, balance: 0, rows: [], lent: 0, borrowed: 0, settled: 0, unconverted: 0, last: null });
    }
    return rows.get(id);
  };
  for (const p of people) ensure(p.id, p.name);

  for (const t of txns) {
    if (!isLedger(t) || !t.person) continue;
    const id = personId(t.person) || t.person;
    const known = people.find(p => p.id === id);
    const row = ensure(id, known ? known.name : t.person);
    const a = amountIn(t, base, fx);
    // An unconvertible row must not silently contribute nothing to a balance
    // somebody is going to act on. It is counted and named instead.
    if (a == null) { row.unconverted += 1; row.rows.push(t); continue; }
    row.balance += (t.kind === 'out' ? 1 : -1) * a;
    if (t.ledger === 'lend') row.lent += a;
    else if (t.ledger === 'borrow') row.borrowed += a;
    else row.settled += a;
    row.rows.push(t);
    if (!row.last || (t.date && t.date > row.last)) row.last = t.date || row.last;
  }

  return [...rows.values()]
    .map(r => ({
      ...r,
      // Rounded before comparing to zero: a balance of 0.0000001 from two
      // conversions is settled, and printing "owes you ₹0" is worse than
      // printing nothing.
      settledUp: Math.abs(r.balance) < 0.005,
      direction: Math.abs(r.balance) < 0.005 ? 'square' : r.balance > 0 ? 'owes-you' : 'you-owe',
      count: r.rows.length,
    }))
    .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));
}

/** Net across everyone, kept as two figures because they are two facts. */
export function ledgerSummary(balances = []) {
  const owedToYou = balances.filter(b => b.balance > 0).reduce((a, b) => a + b.balance, 0);
  const youOwe = balances.filter(b => b.balance < 0).reduce((a, b) => a - b.balance, 0);
  return {
    owedToYou, youOwe, net: owedToYou - youOwe,
    people: balances.length,
    open: balances.filter(b => !b.settledUp).length,
    // Never a single "net position" alone. Being owed ₹5,000 and owing ₹5,000
    // is not the same as owing nobody anything, and one number says it is.
    square: balances.filter(b => b.settledUp).length,
  };
}

// --------------------------------------------------- reading old entries

// Names were being written into the note field, often in brackets — "GYM
// ( Dunu )", "Popcorn ( Mansi )", "Aman ( Social )" — because there was
// nowhere else to put them. This finds them so they can be offered back as
// real people rather than retyped.
//
// It SUGGESTS. It never rewrites a row on its own: whether "Mami Dida" is a
// person you lent to or a shop you paid is not a thing a regular expression
// knows, and guessing wrong writes a debt into your ledger that nobody owes.
const NOT_A_NAME = new Set([
  'auto', 'cab', 'uber', 'ola', 'food', 'fun', 'gym', 'movie', 'printout',
  'social', 'gold', 'unknown', 'roll', 'popcorn', 'car', 'wash', 'shake',
  'mango', 'apple', 'music', 'spotify', 'apotify', 'money', 'ind', 'qqq', 'ntcc',
]);

export function detectPeople(txns = [], people = []) {
  const known = new Set(people.map(p => p.id));
  const found = new Map();
  for (const t of txns) {
    const note = String(t.note || '').trim();
    if (!note) continue;
    // Bracketed first — that was the deliberate convention.
    const bracket = note.match(/\(([^)]{2,30})\)/);
    const candidates = [];
    if (bracket) candidates.push(bracket[1]);
    const bare = note.replace(/\([^)]*\)/g, '').trim();
    if (bare && !/\s/.test(bare)) candidates.push(bare);
    else if (bare && bare.split(/\s+/).length === 2 && /^[A-Z]/.test(bare)) candidates.push(bare);

    for (const c of candidates) {
      const name = c.trim();
      const id = personId(name);
      if (!id || known.has(id)) continue;
      // Word by word, not on the joined id. "Car Wash" and "Apple Music" both
      // look like two-word names and neither is one — checking only the whole
      // string let them through, because 'car-wash' is not in the list while
      // 'car' and 'wash' both are. A false person is worse than a missed one:
      // it invites you to open a debt with a car wash.
      if (id.split('-').some(w => NOT_A_NAME.has(w))) continue;
      if (/^\d+$/.test(id)) continue;
      const row = found.get(id) || { id, name, count: 0, seen: [], total: 0 };
      row.count += 1;
      row.total += Math.abs(num(t.amount));
      if (row.seen.length < 4) row.seen.push({ date: t.date, amount: t.amount, note, kind: t.kind });
      found.set(id, row);
    }
  }
  return [...found.values()].sort((a, b) => b.count - a.count || b.total - a.total);
}

// Which of the new transport categories a note belongs to. Only ever used to
// OFFER a reclassification — an entry already sitting in auto or cab is left
// alone, because the reader has by then made the choice themselves.
const AUTO_RE = /\b(auto|rickshaw|toto|tuk)\b/i;
const CAB_RE = /\b(cab|uber|ola|taxi|rapido|blusmart|blu smart)\b/i;

export function suggestCategory(note = '', current = '') {
  if (current === 'auto' || current === 'cab') return null;
  const n = String(note || '');
  if (CAB_RE.test(n)) return 'cab';
  if (AUTO_RE.test(n)) return 'auto';
  return null;
}

/** What a category clean-up WOULD do, so it can be shown before it is done. */
export function suggestRecategorise(txns = []) {
  const out = [];
  for (const t of txns) {
    if (t.kind !== 'out' || isLedger(t)) continue;
    const to = suggestCategory(t.note, t.category);
    if (to && to !== t.category) out.push({ id: t.id, from: t.category, to, note: t.note, amount: t.amount, date: t.date });
  }
  return out;
}

export function applyRecategorise(txns = [], changes = []) {
  const by = new Map(changes.map(c => [c.id, c.to]));
  return txns.map(t => (by.has(t.id) ? { ...t, category: by.get(t.id) } : t));
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
