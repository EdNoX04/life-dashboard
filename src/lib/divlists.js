// Curated dividend lists: Kings, Aristocrats, Achievers, and a high-yield cut.
//
// dividenddata.com's most-used pages are these lists, and they are also the
// easiest thing on a finance dashboard to get quietly, confidently wrong. Five
// decisions here exist to stop that:
//
//   1. ONE membership table, THREE derived lists. Kings, Aristocrats and
//      Achievers are not three hand-typed lists — they are three thresholds on
//      one `streak` column. Typed separately they drift, and the drift always
//      shows up the same way: a name sitting in Kings that is missing from
//      Aristocrats, which is arithmetically impossible and makes the whole page
//      untrustworthy.
//
//   2. STREAKS ARE NEVER EXTRAPOLATED. A 50-year streak recorded in 2025 is not
//      a 51-year streak in 2026 — it is a 50-year streak that may have been
//      broken. Every streak is reported with the year it was true, and the UI
//      says "as of". Adding the elapsed years would invent a raise that may not
//      have happened, in the one place a user is looking for reliability.
//
//   3. YIELD IS HALF LIVE AND SAYS SO. Price is live; the annual rate is from
//      the snapshot. So the yield is stamped with the rate's as-of date and the
//      list flags itself stale once a full declaration cycle has passed since.
//      A "4.1% yield" with a year-old numerator is a number, not a fact.
//
//   4. NOT-HELD IS NOT A RECOMMENDATION. `gaps()` answers "which names on this
//      list am I not in", which is a fact about the user's portfolio. It is
//      deliberately not scored, not ranked by attractiveness, and carries no
//      buy signal — the sort is by yield because that is the list's own
//      organising column, not because high yield is better.
//
//   5. A MISSING RATE MEANS NO YIELD, NOT ZERO. Same rule as everywhere else on
//      this dashboard: a blank is a blank. A 0.0% yield on a dividend list is a
//      specific and wrong claim.

// The snapshot date for BOTH the streak column and the rate column. One date,
// because they were read together and pretending otherwise would let one of
// them age invisibly.
export const AS_OF = '2025-05-01';

// A snapshot older than this has had a full year of declarations pass over it,
// which is long enough for a streak to have ended and a rate to have moved.
export const STALE_AFTER_DAYS = 365;

// ---- the thresholds ------------------------------------------------------
// Decision 1: these are queries over MEMBERS, not lists of their own.
export const LISTS = [
  {
    key: 'kings', label: 'Dividend Kings', minStreak: 50, color: 'var(--yellow)',
    blurb: '50+ consecutive years of dividend increases.',
  },
  {
    key: 'aristocrats', label: 'Dividend Aristocrats', minStreak: 25, color: 'var(--cyan)',
    blurb: '25+ consecutive years of increases. The published index also requires S&P 500 membership and a size and liquidity screen, so this is the streak test only.',
  },
  {
    key: 'achievers', label: 'Dividend Achievers', minStreak: 10, color: 'var(--green)',
    blurb: '10+ consecutive years of increases.',
  },
  {
    key: 'highyield', label: 'High yield', minStreak: 0, minYield: 3.5, color: 'var(--orange)',
    blurb: 'Yield above 3.5% on the snapshot rate. A high yield is often a fallen price rather than a generous payout — read it next to the streak column, not alone.',
  },
];

// ---- the membership table ------------------------------------------------
// t = ticker, n = name, s = sector, streak = consecutive years of increases as
// of AS_OF, rate = indicated annual dividend per share as of AS_OF, f = pays
// per year. A name with a null rate still counts for streak-based lists; it
// simply has no yield until a rate arrives.
export const MEMBERS = [
  // The comment headers below are a reading aid only — the LISTS thresholds
  // are the truth, per decision 1, and a name is in whichever lists its streak
  // qualifies it for regardless of which block it is typed in.
  // --- long-tenured ---
  { t: 'KO', n: 'Coca-Cola', s: 'Staples', streak: 63, rate: 1.94, f: 4 },
  { t: 'JNJ', n: 'Johnson & Johnson', s: 'Health', streak: 62, rate: 5.20, f: 4 },
  { t: 'PG', n: 'Procter & Gamble', s: 'Staples', streak: 68, rate: 4.03, f: 4 },
  { t: 'CL', n: 'Colgate-Palmolive', s: 'Staples', streak: 62, rate: 2.04, f: 4 },
  { t: 'EMR', n: 'Emerson Electric', s: 'Industrial', streak: 68, rate: 2.10, f: 4 },
  { t: 'GPC', n: 'Genuine Parts', s: 'Discretionary', streak: 69, rate: 4.12, f: 4 },
  { t: 'DOV', n: 'Dover', s: 'Industrial', streak: 69, rate: 2.06, f: 4 },
  { t: 'NWN', n: 'Northwest Natural', s: 'Utilities', streak: 69, rate: 1.96, f: 4 },
  { t: 'PH', n: 'Parker Hannifin', s: 'Industrial', streak: 68, rate: 6.52, f: 4 },
  { t: 'CINF', n: 'Cincinnati Financial', s: 'Financials', streak: 64, rate: 3.24, f: 4 },
  { t: 'LOW', n: "Lowe's", s: 'Discretionary', streak: 62, rate: 4.60, f: 4 },
  { t: 'HRL', n: 'Hormel Foods', s: 'Staples', streak: 59, rate: 1.16, f: 4 },
  { t: 'SWK', n: 'Stanley Black & Decker', s: 'Industrial', streak: 57, rate: 3.28, f: 4 },
  { t: 'TGT', n: 'Target', s: 'Staples', streak: 53, rate: 4.48, f: 4 },
  { t: 'SYY', n: 'Sysco', s: 'Staples', streak: 55, rate: 2.04, f: 4 },
  { t: 'BDX', n: 'Becton Dickinson', s: 'Health', streak: 53, rate: 4.16, f: 4 },
  { t: 'ABM', n: 'ABM Industries', s: 'Industrial', streak: 58, rate: 0.90, f: 4 },
  { t: 'FRT', n: 'Federal Realty', s: 'Real estate', streak: 57, rate: 4.40, f: 4 },
  { t: 'NFG', n: 'National Fuel Gas', s: 'Utilities', streak: 54, rate: 2.06, f: 4 },
  { t: 'BKH', n: 'Black Hills', s: 'Utilities', streak: 55, rate: 2.60, f: 4 },
  { t: 'TR', n: 'Tootsie Roll', s: 'Staples', streak: 59, rate: 0.40, f: 4 },
  // --- mid-tenured ---
  { t: 'MCD', n: "McDonald's", s: 'Discretionary', streak: 48, rate: 7.08, f: 4 },
  { t: 'WMT', n: 'Walmart', s: 'Staples', streak: 52, rate: 0.94, f: 4 },
  { t: 'CVX', n: 'Chevron', s: 'Energy', streak: 38, rate: 6.84, f: 4 },
  { t: 'XOM', n: 'Exxon Mobil', s: 'Energy', streak: 42, rate: 3.96, f: 4 },
  { t: 'PEP', n: 'PepsiCo', s: 'Staples', streak: 53, rate: 5.42, f: 4 },
  { t: 'ADP', n: 'Automatic Data Processing', s: 'Industrial', streak: 50, rate: 6.16, f: 4 },
  { t: 'ABBV', n: 'AbbVie', s: 'Health', streak: 53, rate: 6.56, f: 4 },
  { t: 'AFL', n: 'Aflac', s: 'Financials', streak: 42, rate: 2.24, f: 4 },
  { t: 'ITW', n: 'Illinois Tool Works', s: 'Industrial', streak: 61, rate: 6.00, f: 4 },
  { t: 'CAT', n: 'Caterpillar', s: 'Industrial', streak: 31, rate: 5.64, f: 4 },
  { t: 'LIN', n: 'Linde', s: 'Materials', streak: 32, rate: 5.80, f: 4 },
  { t: 'SHW', n: 'Sherwin-Williams', s: 'Materials', streak: 46, rate: 3.16, f: 4 },
  { t: 'ECL', n: 'Ecolab', s: 'Materials', streak: 33, rate: 2.60, f: 4 },
  { t: 'ROP', n: 'Roper Technologies', s: 'Tech', streak: 32, rate: 3.12, f: 4 },
  { t: 'CB', n: 'Chubb', s: 'Financials', streak: 32, rate: 3.64, f: 4 },
  { t: 'MDT', n: 'Medtronic', s: 'Health', streak: 47, rate: 2.80, f: 4 },
  { t: 'O', n: 'Realty Income', s: 'Real estate', streak: 30, rate: 3.22, f: 12 },
  { t: 'ESS', n: 'Essex Property', s: 'Real estate', streak: 31, rate: 9.80, f: 4 },
  { t: 'ATO', n: 'Atmos Energy', s: 'Utilities', streak: 41, rate: 3.48, f: 4 },
  { t: 'WEC', n: 'WEC Energy', s: 'Utilities', streak: 22, rate: 3.57, f: 4 },
  { t: 'ED', n: 'Consolidated Edison', s: 'Utilities', streak: 51, rate: 3.40, f: 4 },
  { t: 'VZ', n: 'Verizon', s: 'Comms', streak: 18, rate: 2.71, f: 4 },
  { t: 'MO', n: 'Altria', s: 'Staples', streak: 55, rate: 4.08, f: 4 },
  { t: 'PM', n: 'Philip Morris', s: 'Staples', streak: 17, rate: 5.40, f: 4 },
  { t: 'IBM', n: 'IBM', s: 'Tech', streak: 30, rate: 6.68, f: 4 },
  // --- shorter records ---
  { t: 'AVGO', n: 'Broadcom', s: 'Tech', streak: 15, rate: 2.36, f: 4 },
  { t: 'MSFT', n: 'Microsoft', s: 'Tech', streak: 20, rate: 3.32, f: 4 },
  { t: 'AAPL', n: 'Apple', s: 'Tech', streak: 13, rate: 1.04, f: 4 },
  { t: 'HD', n: 'Home Depot', s: 'Discretionary', streak: 15, rate: 9.20, f: 4 },
  { t: 'V', n: 'Visa', s: 'Financials', streak: 17, rate: 2.36, f: 4 },
  { t: 'MA', n: 'Mastercard', s: 'Financials', streak: 14, rate: 3.04, f: 4 },
  { t: 'UNH', n: 'UnitedHealth', s: 'Health', streak: 15, rate: 8.40, f: 4 },
  { t: 'LMT', n: 'Lockheed Martin', s: 'Industrial', streak: 22, rate: 13.20, f: 4 },
  { t: 'TXN', n: 'Texas Instruments', s: 'Tech', streak: 21, rate: 5.44, f: 4 },
  { t: 'QCOM', n: 'Qualcomm', s: 'Tech', streak: 22, rate: 3.56, f: 4 },
  { t: 'MAIN', n: 'Main Street Capital', s: 'Financials', streak: 14, rate: 3.54, f: 12 },
  { t: 'STAG', n: 'Stag Industrial', s: 'Real estate', streak: 13, rate: 1.49, f: 12 },
  // --- streak reset ---
  // Kept in the table on purpose. A spin-off resets the streak whatever the
  // company's own history was, and a name that silently vanished from the page
  // would read as delisted rather than as demoted. Streak 0 excludes them from
  // every streak list automatically; they can still surface on yield.
  { t: 'MMM', n: '3M', s: 'Industrial', streak: 0, rate: 2.92, f: 4, note: 'Streak reset by the 2024 Solventum spin-off' },
  { t: 'T', n: 'AT&T', s: 'Comms', streak: 0, rate: 1.11, f: 4, note: 'Streak reset by the 2022 WarnerMedia spin-off' },
];

const num = v => (v == null || v === '' || typeof v === 'boolean' || !Number.isFinite(Number(v))
  ? null : Number(v));

const parseISO = v => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(`${String(v).slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
};

// ---- staleness -----------------------------------------------------------

// How old the snapshot is, and whether that is old enough to say so out loud.
// Decision 3: this is the honesty valve on every yield on the page.
export function snapshotAge(today = new Date(), asOf = AS_OF) {
  const a = parseISO(asOf), t = parseISO(today);
  if (!a || !t) return { days: null, stale: false, asOf, asOfYear: null };
  const days = Math.round((t - a) / 86400000);
  return {
    days,
    stale: days > STALE_AFTER_DAYS,
    asOf,
    asOfYear: a.getFullYear(),
  };
}

// ---- yield ---------------------------------------------------------------

// Decision 5: no rate or no price means no yield. Never zero.
export function yieldOf(rate, price) {
  const r = num(rate), p = num(price);
  if (r == null || p == null || p <= 0 || r < 0) return null;
  return (r / p) * 100;
}

// ---- rows ----------------------------------------------------------------

// Build one list. `quotes` is { TICKER: { price } }, `holdings` is the user's
// book. Members are matched to holdings on ticker so the page can mark what is
// already owned without the user tagging anything.
export function buildList(key, { quotes = {}, holdings = [], today = new Date(), members = MEMBERS } = {}) {
  const list = LISTS.find(l => l.key === key) || LISTS[0];
  const age = snapshotAge(today);
  const mine = new Map();
  for (const h of holdings) {
    const t = String(h.ticker || '').toUpperCase();
    if (t) mine.set(t, Number(h.qty ?? h.shares ?? 0) || 0);
  }

  const rows = members.map(m => {
    const price = num((quotes[m.t] || {}).price);
    const y = yieldOf(m.rate, price);
    return {
      ticker: m.t,
      name: m.n,
      sector: m.s,
      // Decision 2: the streak is reported with the year it was true, and the
      // year travels with the row so no caller has to remember to add it.
      streak: num(m.streak),
      streakAsOf: age.asOfYear,
      note: m.note || null,
      rate: num(m.rate),
      freq: num(m.f),
      price,
      // Decision 3: the yield is half-snapshot, and the row carries the proof.
      yieldPct: y,
      // A yield computed against the snapshot rate AND a snapshot-era price is
      // not available here — we only have live price — so this flag means
      // exactly one thing: the numerator is old.
      rateAsOf: age.asOf,
      rateStale: age.stale,
      held: mine.has(m.t),
      qty: mine.get(m.t) ?? 0,
      annualIncome: mine.has(m.t) && m.rate != null ? m.rate * mine.get(m.t) : null,
    };
  });

  const passes = r => {
    if (list.minStreak > 0 && !(r.streak >= list.minStreak)) return false;
    // A yield floor cannot be applied to a row with no yield. Excluding those
    // is right — "high yield" is a claim about a number we do not have — but it
    // is worth being explicit that they are excluded, not defaulted in.
    //
    // Written as an explicit null check rather than `(r.yieldPct || 0) >= floor`
    // on purpose. The two agree for every floor above zero, so no test can tell
    // them apart today — but a floor of 0, which is a perfectly reasonable
    // "anything that pays" list to add later, would silently admit every
    // unpriced row under the `|| 0` form. The check says what it means so that
    // change stays safe.
    if (list.minYield != null && !(r.yieldPct != null && r.yieldPct >= list.minYield)) return false;
    return true;
  };
  return rows.filter(passes);
}

// The list's own organising column decides the sort: streak lists rank by
// streak, the yield list ranks by yield. Ties break on ticker so the table does
// not reshuffle between renders.
export function sortList(rows = [], key = 'kings') {
  const list = LISTS.find(l => l.key === key) || LISTS[0];
  const by = list.minYield != null ? 'yieldPct' : 'streak';
  const have = [], lack = [];
  for (const r of rows) (r[by] == null ? lack : have).push(r);
  have.sort((a, b) => (b[by] - a[by]) || a.ticker.localeCompare(b.ticker));
  lack.sort((a, b) => a.ticker.localeCompare(b.ticker));
  return [...have, ...lack];
}

// ---- summary -------------------------------------------------------------

// Median rather than mean, because one 12% yield in a list of forty 2.5%s drags
// a mean somewhere no member of the list actually sits.
export function listSummary(rows = []) {
  const ys = rows.map(r => r.yieldPct).filter(v => v != null).sort((a, b) => a - b);
  const held = rows.filter(r => r.held);
  const med = ys.length
    ? (ys.length % 2 ? ys[(ys.length - 1) / 2] : (ys[ys.length / 2 - 1] + ys[ys.length / 2]) / 2)
    : null;
  return {
    count: rows.length,
    withYield: ys.length,
    medianYield: med,
    heldCount: held.length,
    // Coverage is reported as a fraction of the list, not as a score. "You hold
    // 4 of 22" is a fact; "you have 18% list coverage" reads like a grade.
    heldOf: rows.length,
    income: held.reduce((s, r) => s + (r.annualIncome || 0), 0) || null,
  };
}

// Decision 4: the names on this list that are absent from the book. A fact
// about the portfolio, not a suggestion about what to buy.
export function gaps(rows = [], limit = 0) {
  const out = rows.filter(r => !r.held)
    .sort((a, b) => (b.yieldPct ?? -1) - (a.yieldPct ?? -1) || a.ticker.localeCompare(b.ticker));
  return limit > 0 ? out.slice(0, limit) : out;
}

// Sector spread of a list, biggest first. Used to show that a high-yield screen
// has quietly become a utilities-and-tobacco list, which it usually has.
export function sectorMix(rows = []) {
  const m = new Map();
  for (const r of rows) m.set(r.sector, (m.get(r.sector) || 0) + 1);
  return [...m.entries()]
    .map(([sector, n]) => ({ sector, n, pct: (n / rows.length) * 100 }))
    .sort((a, b) => b.n - a.n || a.sector.localeCompare(b.sector));
}

// Every ticker any list could need, for the quote fetcher. Deduped and sorted
// so the request order is stable and the rate-limit pacing is predictable.
export function allTickers(members = MEMBERS) {
  return [...new Set(members.map(m => m.t))].sort();
}
