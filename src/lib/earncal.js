// Earnings calendar — the arithmetic half.
//
// The reference screen is a Mon–Fri grid, each column split into "Before Open"
// and "After Close", company tiles in the cells, an overflow tile reading "+143",
// All Stocks / My Watchlist / My Portfolio tabs, a Week/Month toggle, and week
// arrows with a week number. Every one of those parts is buildable from what
// Finnhub's calendar endpoint returns — which makes this the first money screen
// where the danger is not missing data but a grid that quietly loses some.
//
// Six decisions, and five of them are about not dropping rows on the floor.
//
// 1. DATES ARE COMPARED AS STRINGS AND BUILT IN UTC, NEVER THROUGH LOCAL TIME.
//    `new Date('2026-08-01')` is midnight UTC, which is the 31st of July in Los
//    Angeles and the 1st of August in Delhi. A calendar that puts a company in
//    the wrong column depending on where it is opened is not a rounding error,
//    it is a different week. Every date in this file is a 'YYYY-MM-DD' string,
//    every construction goes through Date.UTC, and every comparison is a string
//    comparison — which is exact for this format and needs no timezone at all.
//
// 2. THERE ARE FOUR SESSIONS, NOT TWO. Finnhub's `hour` is 'bmo', 'amc', 'dmh'
//    (during market hours) or an empty string. The reference has two rows, so a
//    build that copies it has to put 'dmh' somewhere — and either choice is a
//    false statement about when a company reports. An empty string is worse:
//    folding it into "before open" invents a fact the feed explicitly did not
//    supply. So there are four buckets, and the two the reference does not have
//    are rendered only when something lands in them.
//
// 3. AN OVERFLOW COUNT IS A PROMISE ABOUT WHAT IS BEHIND IT. The reference's
//    "+143" is the good part of that screen: it says the cell was truncated. So
//    the cap here always returns the hidden rows as well as the count, the
//    screen can open them, and no caller can truncate without receiving what it
//    truncated. Silent slicing is the failure this exists to prevent.
//
// 4. A WEEKEND ROW IS COUNTED EVEN THOUGH THERE IS NO COLUMN FOR IT. Companies
//    do occasionally file on a Saturday. A Mon–Fri grid has nowhere to draw
//    them, and the honest version of "nowhere to draw them" is a line under the
//    grid saying how many there were and which, not a filter that makes them
//    never have existed.
//
// 5. AN ESTIMATE AND A RESULT ARE DIFFERENT FIELDS AND ARE NEVER MERGED INTO
//    ONE "EPS". Finnhub returns both, and after the date has passed both are
//    populated. A tile that shows whichever one is present is a tile whose
//    meaning changes silently on the morning of the report. Both are carried,
//    both are labelled, and the surprise is computed only when both exist.
//
// 6. WEEK NUMBERS ARE ISO-8601. "Week 31" is meaningless without a convention —
//    the answer differs by up to a week between the common ones. ISO is the one
//    every other tool Neel might cross-check against also uses.

// Fifth copy of the guard. On this screen a coerced zero is an EPS estimate of
// zero dollars, which is a real and different claim from "no analyst estimate".
export function num(v) {
  if (v === null || v === undefined || typeof v === 'boolean') return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  const n = +v;
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------- dates (decision 1)

export const ymd = d => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;

// Parses 'YYYY-MM-DD' into a UTC Date. Anything else returns null rather than an
// Invalid Date, which would otherwise propagate as NaN into every date sum.
export function parseISO(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function addDays(iso, n) {
  const d = parseISO(iso);
  if (!d) return null;
  d.setUTCDate(d.getUTCDate() + n);
  return ymd(d);
}

// 1 = Monday … 7 = Sunday. getUTCDay() calls Sunday 0, which puts Sunday at the
// start of the week in every arithmetic that uses it raw — the single most
// common off-by-a-week in calendar code.
export function dowOf(iso) {
  const d = parseISO(iso);
  if (!d) return null;
  return d.getUTCDay() === 0 ? 7 : d.getUTCDay();
}

export const isWeekend = iso => dowOf(iso) >= 6;

export function mondayOf(iso) {
  const dw = dowOf(iso);
  return dw === null ? null : addDays(iso, 1 - dw);
}

// Decision 6. The ISO week containing a date is the week whose Thursday shares
// that date's year — which is the whole trick, and why this is not `Math.ceil(
// dayOfYear / 7)`.
export function isoWeek(iso) {
  const mon = mondayOf(iso);
  if (!mon) return null;
  const thu = parseISO(addDays(mon, 3));
  const year = thu.getUTCFullYear();
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const week = Math.floor((thu - jan1) / 86400000 / 7) + 1;
  return { year, week };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function dayLabel(iso) {
  const d = parseISO(iso);
  if (!d) return '';
  return `${DOW[dowOf(iso) - 1]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

// ---------------------------------------------------------------- windows

// A week window is always Mon–Fri for the grid, but `from`/`to` span the full
// seven days — because the fetch must ASK for the weekend in order for decision
// 4 to have anything to count.
export function weekWindow(anchorISO, offset = 0) {
  const base = mondayOf(anchorISO);
  if (!base) return null;
  const mon = addDays(base, offset * 7);
  const days = Array.from({ length: 7 }, (_, i) => addDays(mon, i));
  const w = isoWeek(mon);
  return {
    kind: 'week',
    from: days[0], to: days[6],
    days, grid: days.slice(0, 5), weekend: days.slice(5),
    week: w.week, year: w.year,
    label: `${dayLabel(days[0])} – ${dayLabel(days[4])}`,
  };
}

// The month view keeps whole ISO weeks as rows, so a month never begins with
// four blank cells that look like four days with no earnings.
export function monthWindow(anchorISO, offset = 0) {
  const d = parseISO(anchorISO);
  if (!d) return null;
  const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
  const startMon = mondayOf(ymd(first));
  const endSun = addDays(mondayOf(ymd(last)), 6);
  const weeks = [];
  for (let cur = startMon; cur <= endSun; cur = addDays(cur, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(cur, i)));
  }
  return {
    kind: 'month',
    from: startMon, to: endSun,
    weeks,
    month: first.getUTCMonth(), year: first.getUTCFullYear(),
    // The window is wider than the month it is named after, and the screen has
    // to be able to grey the spill-over days rather than pretend they belong.
    monthFrom: ymd(first), monthTo: ymd(last),
    label: `${MONTHS[first.getUTCMonth()]} ${first.getUTCFullYear()}`,
  };
}

export const inMonth = (iso, win) => !!win && iso >= win.monthFrom && iso <= win.monthTo;

// ---------------------------------------------------------------- sessions (decision 2)

export const SESSIONS = [
  { key: 'bmo', label: 'Before open', note: 'Reported before the US market opened.' },
  { key: 'amc', label: 'After close', note: 'Reported after the US market closed.' },
  { key: 'dmh', label: 'During hours', note: 'Reported while the US market was open — rare, and its own row rather than rounded into one of the others.' },
  { key: 'unk', label: 'Time not stated', note: 'The feed gave a date but no session. This is not the same as "before open", so it is not filed there.' },
];
export const sessionMeta = k => SESSIONS.find(s => s.key === k) || SESSIONS[3];

export function sessionOf(row) {
  const h = String(row?.hour || '').trim().toLowerCase();
  if (h === 'bmo' || h === 'amc' || h === 'dmh') return h;
  return 'unk';
}

// ---------------------------------------------------------------- rows

export function normalise(rows) {
  return (rows || [])
    .map(r => {
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(r?.date || '')) ? r.date : null;
      const symbol = String(r?.symbol || '').toUpperCase();
      if (!date || !symbol) return null;
      return {
        symbol,
        date,
        session: sessionOf(r),
        // Decision 5: four separate fields, never collapsed.
        epsEst: num(r?.epsEstimate),
        epsAct: num(r?.epsActual),
        revEst: num(r?.revenueEstimate),
        revAct: num(r?.revenueActual),
        quarter: num(r?.quarter),
        year: num(r?.year),
      };
    })
    .filter(Boolean)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.symbol.localeCompare(b.symbol)));
}

export const SCOPES = [
  { key: 'port', label: 'My portfolio', note: 'Only the companies you hold.' },
  { key: 'watch', label: 'Watchlist', note: 'Only the tickers on your watchlist.' },
  { key: 'all', label: 'All stocks', note: 'Everything the feed returned for this window, which is thousands of companies a week — the cells are capped and say by how much.' },
];
export const scopeMeta = k => SCOPES.find(s => s.key === k) || SCOPES[0];

export function inScope(row, scope, port = [], watch = []) {
  if (scope === 'all') return true;
  const set = new Set((scope === 'watch' ? watch : port).map(t => String(t || '').toUpperCase()));
  return set.has(row.symbol);
}

export function filterRows(rows, scope, port, watch) {
  return (rows || []).filter(r => inScope(r, scope, port, watch));
}

// ---------------------------------------------------------------- grouping

// { iso: { bmo: [...], amc: [...], dmh: [...], unk: [...], n } }
export function groupByDay(rows) {
  const out = {};
  for (const r of rows || []) {
    if (!out[r.date]) out[r.date] = { bmo: [], amc: [], dmh: [], unk: [], n: 0 };
    out[r.date][r.session].push(r);
    out[r.date].n += 1;
  }
  return out;
}

// Decision 3. `hidden` is the ROWS, not just how many — a caller that wants to
// expand the cell already has them, and a caller that only prints the count
// cannot accidentally lose them.
export function capCell(list, cap = 6) {
  const all = list || [];
  if (all.length <= cap) return { shown: all, hidden: [], more: 0, total: all.length };
  return { shown: all.slice(0, cap), hidden: all.slice(cap), more: all.length - cap, total: all.length };
}

// Decision 4: the rows a Mon–Fri grid has no column for.
export function weekendRows(rows, win) {
  if (!win || win.kind !== 'week') return [];
  const wk = new Set(win.weekend || []);
  return (rows || []).filter(r => wk.has(r.date));
}

export function countIn(rows, days) {
  const set = new Set(days || []);
  return (rows || []).filter(r => set.has(r.date)).length;
}

// ---------------------------------------------------------------- surprise (decision 5)

export function surpriseOf(row) {
  const a = num(row?.epsAct);
  const e = num(row?.epsEst);
  if (a === null) return { state: 'not_reported' };
  if (e === null) return { state: 'no_estimate', actual: a };
  if (e === 0) return { state: 'base_zero', actual: a, estimate: e, abs: a - e };
  // Same absolute-base divide as the financials screen, and for the same reason:
  // a company that was expected to lose $1 and lost $0.50 beat the estimate, and
  // dividing by −1 would print that beat as a negative surprise.
  return {
    state: 'ok',
    actual: a, estimate: e,
    abs: a - e,
    pct: ((a - e) / Math.abs(e)) * 100,
    beat: a >= e,
  };
}

// ---------------------------------------------------------------- formatting

export function fmtEps(v, cur = '$') {
  const n = num(v);
  if (n === null) return '—';
  return `${n < 0 ? '−' : ''}${cur}${Math.abs(n).toFixed(2)}`;
}

// Revenue arrives from this endpoint in RAW currency units, unlike the share
// counts on the financials screen which arrive in millions. Two feeds, two
// units, one place each where the conversion is written down.
export function fmtRev(v, cur = '$') {
  const n = num(v);
  if (n === null) return '—';
  const a = Math.abs(n);
  const s = n < 0 ? '−' : '';
  if (a >= 1e12) return `${s}${cur}${(a / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${s}${cur}${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}${cur}${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${s}${cur}${(a / 1e3).toFixed(1)}K`;
  return `${s}${cur}${a.toFixed(0)}`;
}

export const fmtQuarter = r => (num(r?.quarter) && num(r?.year) ? `Q${r.quarter} ${r.year}` : '');

export const EARN_DISCLAIMER =
  'Dates and estimates come from the data provider\'s calendar, which companies revise and which the free tier '
  + 'returns in whatever completeness it returns. A company missing from a day is missing from this feed, not '
  + 'necessarily silent. Estimates are analysts\' figures, not forecasts made here, and nothing on this screen is '
  + 'investment advice.';
