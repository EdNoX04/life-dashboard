// Multiple accounts, laid over a book that was never told about accounts.
//
// The holdings table has one row per position and no account column, and adding
// one would be a schema migration this app has spent its whole life avoiding. So
// the assignment lives in a `memory` blob: ticker → account id. That is a cheap
// mechanism, and cheap mechanisms lie in a specific way that has to be designed
// against rather than discovered later.
//
// Five decisions:
//
//   1. THE UNASSIGNED PILE IS A FIRST-CLASS ACCOUNT AND IS NEVER EMPTY BY
//      DEFAULT. When you add accounts to a book that already has thirty
//      positions, all thirty start unassigned. The tempting default is to sweep
//      them into the first account, or into one called "Main", because then
//      every tab total is instantly correct-looking. It would also be wrong for
//      every position you had not actually reviewed. Unassigned is shown, with
//      its count, until you empty it yourself.
//
//   2. ONE TICKER, ONE ACCOUNT. Real life allows the same stock in two accounts;
//      this app cannot represent that, because the underlying row is per-ticker
//      and splitting it would require splitting the cost basis, which we do not
//      have a per-account record of. Rather than silently showing the whole
//      position under whichever account you tapped last, the limitation is
//      stated (`SPLIT_CAVEAT`) and the ticker carries exactly one assignment.
//      A feature that cannot be built correctly should announce that, not
//      approximate it.
//
//   3. A FILTERED TOTAL IS LABELLED AS A FILTERED TOTAL. This is the real risk
//      of the whole feature. The instant a tab can show one account, every
//      number on it — net worth, day P&L, allocation, concentration — silently
//      becomes a number about a subset. The same 12% figure means "you are 12%
//      in tech" or "you are 12% in tech within this one account", and nothing on
//      screen distinguishes them. So `scopeLabel` and `scopeNote` exist and the
//      screens are expected to print them whenever a filter is on.
//
//   4. DELETING AN ACCOUNT NEVER DELETES POSITIONS. It returns them to
//      unassigned. There is no confirmation dialog anywhere in this app that
//      would make destroying holdings data acceptable, so the operation simply
//      is not destructive.
//
//   5. ACCOUNT TOTALS ARE COMPUTED FROM THE SAME ROWS AS THE MAIN BOOK, never
//      re-derived. If the two ever disagree, one of them is wrong and there is
//      no way for a reader to tell which. So this module takes the rows the
//      holdings module already built and only ever partitions them.

import { memGet, memSet } from './advisor.js';

export const MAP_KEY = 'account_map';      // { [ticker]: accountId }
export const LIST_KEY = 'account_list';    // [{ id, label, kind, color, note }]

export const UNASSIGNED = '__unassigned__';

// The kinds are deliberately about TAX AND ACCESS, not about brokers. Which app
// you happen to hold something in is a fact about your phone; whether you can
// withdraw it without a penalty, and what happens when you sell, are facts about
// your money. The second set is what a portfolio screen should organise by.
export const ACCOUNT_KINDS = [
  { key: 'broker', label: 'Brokerage', color: 'var(--cyan)', note: 'Taxable. Sell whenever; gains are taxed in the year you realise them.' },
  { key: 'retire', label: 'Retirement', color: 'var(--purple)', note: 'Locked or penalised before retirement age. Long horizon by construction.' },
  { key: 'tax-free', label: 'Tax-advantaged', color: 'var(--green)', note: 'Growth is sheltered under the scheme’s own rules and limits.' },
  { key: 'bank', label: 'Bank / deposits', color: 'var(--yellow)', note: 'Deposits and FDs. Capital is stable; interest is normally taxed as income.' },
  { key: 'other', label: 'Other', color: 'var(--orange)', note: 'Anything that does not fit the above.' },
];
export const kindOf = k => ACCOUNT_KINDS.find(x => x.key === k) || ACCOUNT_KINDS[4];

// Stated wherever accounts are edited, because a reader who holds the same ETF
// in two places will otherwise assume the app has quietly handled it.
export const SPLIT_CAVEAT =
  'One holding sits in exactly one account. If you hold the same ticker in two '
  + 'places, this app cannot split it — the book keeps a single cost basis per '
  + 'ticker and dividing it here would be inventing a number. Assign it to '
  + 'whichever account holds most of it and treat that account’s total as approximate.';

const slug = s => String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// A new id that cannot collide with an existing one or with UNASSIGNED.
export function newId(label, existing = []) {
  const base = slug(label) || 'account';
  if (base === slug(UNASSIGNED)) return `${base}-1`;
  const taken = new Set(existing.map(a => a.id));
  if (!taken.has(base)) return base;
  for (let i = 2; i < 500; i += 1) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
  return `${base}-${Date.now()}`;
}

export function normaliseAccount(a, existing = []) {
  const kind = kindOf(a && a.kind).key;
  return {
    id: (a && a.id) || newId(a && a.label, existing),
    label: String((a && a.label) || 'Untitled account').slice(0, 40),
    kind,
    color: (a && a.color) || kindOf(kind).color,
    note: String((a && a.note) || '').slice(0, 200),
  };
}

// ------------------------------------------------------------------ loading

export async function loadAccounts() {
  const [rawList, rawMap] = await Promise.all([
    memGet(LIST_KEY).catch(() => null),
    memGet(MAP_KEY).catch(() => null),
  ]);
  const accounts = Array.isArray(rawList) ? rawList.map(a => normaliseAccount(a)) : [];
  const map = rawMap && typeof rawMap === 'object' && !Array.isArray(rawMap) ? { ...rawMap } : {};

  // An assignment pointing at an account that no longer exists is dropped rather
  // than kept. Keeping it would make the ticker vanish from every account view
  // AND from unassigned, which is the one outcome worse than being unassigned:
  // a holding that is in the book but appears in no tab at all.
  const ids = new Set(accounts.map(a => a.id));
  const orphans = [];
  for (const [ticker, id] of Object.entries(map)) {
    if (!ids.has(id)) { orphans.push(ticker); delete map[ticker]; }
  }
  return { accounts, map, orphans };
}

export const saveAccounts = list => memSet(LIST_KEY, list);
export const saveMap = map => memSet(MAP_KEY, map);

// ------------------------------------------------------------------ mutation

// All four mutators are pure: they take state and return new state. The caller
// persists. This keeps "what happens to the holdings" testable without a
// network, which matters most for the one operation that could lose data.
export function addAccount(accounts, draft) {
  const a = normaliseAccount({ ...draft, id: null }, accounts);
  return [...accounts, a];
}

export function editAccount(accounts, id, patch) {
  return accounts.map(a => (a.id === id ? normaliseAccount({ ...a, ...patch, id: a.id }, accounts) : a));
}

// Decision 4, made mechanical. The positions are not touched; their assignment
// is. A caller cannot accidentally get the destructive version because the
// destructive version does not exist in this file.
export function removeAccount(accounts, map, id) {
  const nextMap = { ...map };
  let returned = 0;
  for (const [ticker, aid] of Object.entries(nextMap)) {
    if (aid === id) { delete nextMap[ticker]; returned += 1; }
  }
  return {
    accounts: accounts.filter(a => a.id !== id),
    map: nextMap,
    returned,
    note: returned
      ? `${returned} holding${returned === 1 ? '' : 's'} returned to unassigned. Nothing was deleted from your book.`
      : 'That account held nothing. Nothing was deleted from your book.',
  };
}

export function assign(map, ticker, accountId) {
  const next = { ...map };
  if (!accountId || accountId === UNASSIGNED) delete next[ticker];
  else next[ticker] = accountId;
  return next;
}

// ------------------------------------------------------------------ grouping

// Decision 5: partition the rows we were given, never rebuild them.
export function groupRows(rows = [], map = {}, accounts = []) {
  const buckets = new Map(accounts.map(a => [a.id, []]));
  const loose = [];
  for (const r of rows) {
    const id = map[r.ticker];
    if (id && buckets.has(id)) buckets.get(id).push(r);
    else loose.push(r);
  }
  return { buckets, loose };
}

const sum = (rows, k) => rows.reduce((a, r) => a + (Number.isFinite(r[k]) ? r[k] : 0), 0);

// Money is summed; percentages are derived from the sums afterwards. Averaging
// the per-row percentages would weight a ₹500 position the same as a ₹5,00,000
// one, which is the classic way a portfolio return comes out wrong and plausible.
export function accountTotals(rows = []) {
  const marketValue = sum(rows, 'marketValue');
  const dayGain = sum(rows, 'dayGain');

  // Positions with an unknown cost basis contribute their market value — you do
  // own them — but not their invested capital, which we do not know. The count
  // travels with the totals so a screen can say why the percentage is missing
  // rather than just omitting it.
  const priced = rows.filter(r => r.invested != null);
  const invested = sum(priced, 'invested');
  // Measured against the priced rows' OWN market value, not the account's. Using
  // the account total here would credit the gain on positions whose cost we do
  // not know to the positions whose cost we do, inflating the return by exactly
  // the value of the holdings we know least about.
  const pricedValue = sum(priced, 'marketValue');
  const unknownCost = rows.length - priced.length;

  return {
    count: rows.length,
    marketValue,
    invested: priced.length ? invested : null,
    unrealised: priced.length ? pricedValue - invested : null,
    unrealisedPct: priced.length && invested > 0 ? ((pricedValue - invested) / invested) * 100 : null,
    dayGain,
    dayPct: marketValue - dayGain !== 0 ? (dayGain / (marketValue - dayGain)) * 100 : null,
    unknownCost,
    // Said out loud rather than left for a reader to infer from a missing figure.
    costNote: unknownCost
      ? `${unknownCost} of these ${rows.length} ${unknownCost === 1 ? 'has' : 'have'} no cost basis recorded, so the return figures cover only the other ${priced.length}.`
      : null,
  };
}

// One summary row per account plus the unassigned pile, in display order.
export function accountSummary(rows = [], map = {}, accounts = []) {
  const { buckets, loose } = groupRows(rows, map, accounts);
  const grand = rows.reduce((a, r) => a + (Number.isFinite(r.marketValue) ? r.marketValue : 0), 0);

  const out = accounts.map(a => {
    const rs = buckets.get(a.id) || [];
    const t = accountTotals(rs);
    return {
      ...a, rows: rs, totals: t,
      share: grand > 0 ? (t.marketValue / grand) * 100 : 0,
      empty: rs.length === 0,
    };
  });

  // Decision 1: the pile is listed whenever it has anything in it, at the same
  // visual weight as a real account, and it is never merged into one.
  if (loose.length) {
    const t = accountTotals(loose);
    out.push({
      id: UNASSIGNED,
      label: 'Unassigned',
      kind: 'other',
      color: 'var(--ink-3)',
      note: 'Holdings that have not been put in an account yet. They are still in every total.',
      rows: loose, totals: t,
      share: grand > 0 ? (t.marketValue / grand) * 100 : 0,
      empty: false,
      unassigned: true,
    });
  }
  return out;
}

// ------------------------------------------------------------------ scoping

// Decision 3. The single most important export in this file, because it is what
// stops every other tab from quietly changing what its numbers mean.
export function scopeLabel(accounts = [], scope = 'all') {
  if (scope === 'all' || !scope) return 'All accounts';
  if (scope === UNASSIGNED) return 'Unassigned only';
  const a = accounts.find(x => x.id === scope);
  return a ? a.label : 'Unknown account';
}

export function scopeNote(accounts = [], scope = 'all', totals = null) {
  if (scope === 'all' || !scope) return null;
  const label = scopeLabel(accounts, scope);
  const n = totals && totals.count != null ? totals.count : null;
  return `Showing ${label} only — every figure on this screen describes ${n != null ? `these ${n} holding${n === 1 ? '' : 's'}` : 'this account'}, not your whole portfolio.`;
}

export const filterRows = (rows = [], map = {}, scope = 'all') => {
  if (scope === 'all' || !scope) return rows;
  if (scope === UNASSIGNED) return rows.filter(r => !map[r.ticker]);
  return rows.filter(r => map[r.ticker] === scope);
};

// ------------------------------------------------------------------ seeding

// The cold-start problem this module otherwise has: accounts are useless until
// every holding is assigned, and assigning twenty tickers by hand is a chore
// nobody does, so the feature sits unused and the tabs stay empty forever.
//
// Currency is a good enough first guess for exactly one reason: a rupee-priced
// holding cannot be sitting in a dollar brokerage account. It is not a general
// rule — plenty of people hold US stock through an Indian broker, which is
// precisely what the US account below IS — but it separates the two books
// correctly for this setup, and every assignment it makes is editable.
//
// It is offered as a SUGGESTION with its reasoning attached, never applied
// silently. An app that quietly decides where your money lives and then reports
// totals per account has made a claim on your behalf.
export const SEED_ACCOUNTS = [
  { id: 'indstocks', label: 'INDstocks', kind: 'broker', currency: 'INR',
    note: 'Indian equities and ETFs, priced in rupees.' },
  { id: 'indmoney-us', label: 'INDmoney US', kind: 'broker', currency: 'USD',
    note: 'US stock held through INDmoney, priced in dollars.' },
];

export function currencyOfRow(row) {
  const c = String(row?.currency || row?.raw?.currency || '').toUpperCase();
  return c === 'INR' ? 'INR' : 'USD';
}

// Returns what WOULD be created and assigned, plus the reasoning, so the caller
// can show it before doing anything. Only accounts that would actually hold
// something are proposed — offering an empty INDstocks account to someone with
// no Indian holdings is clutter.
export function suggestFromCurrency(rows = [], existing = []) {
  const taken = new Set(existing.map(a => a.id));
  const byCur = { INR: [], USD: [] };
  for (const r of rows) byCur[currencyOfRow(r)].push(r.ticker);

  const accounts = [];
  const map = {};
  for (const seed of SEED_ACCOUNTS) {
    const tickers = byCur[seed.currency] || [];
    if (!tickers.length) continue;
    if (!taken.has(seed.id)) accounts.push(normaliseAccount(seed, existing));
    for (const t of tickers) map[t] = seed.id;
  }

  if (!accounts.length && !Object.keys(map).length) return null;
  return {
    accounts,
    map,
    counts: { INR: byCur.INR.length, USD: byCur.USD.length },
    reason: 'Split by the currency each holding is priced in: rupee-priced holdings to INDstocks, dollar-priced to INDmoney US. Every assignment is editable afterwards.',
  };
}

// ------------------------------------------------------------------ reading

// What the account split is actually telling you, in one sentence, or null when
// it is telling you nothing. A screen that prints a sentence here on day one —
// when there is one account holding everything — trains the reader to skip it.
export function concentrationNote(summary = []) {
  const real = summary.filter(s => !s.unassigned && !s.empty);
  if (real.length < 2) return null;
  const top = [...real].sort((a, b) => b.share - a.share)[0];
  if (!top || top.share < 60) return null;
  return `${top.label} holds ${top.share.toFixed(0)}% of everything. That is a fact about where your money sits, not a problem in itself — but it does mean this account’s rules (access, tax, lock-in) apply to most of your portfolio.`;
}

export const DISCLAIMER =
  'Accounts here are a way of organising what you already own. Nothing in this '
  + 'app moves money, opens accounts, or knows your real balances — the split is '
  + 'whatever you have told it.';
