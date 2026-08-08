import { BENCHMARKS, benchmarkOf, loadBenchCache, proxyEnabled } from './india.js';
import { MARKETS, KINDS } from './assets.js';

// The market catalogue, and — much more importantly — an honest account of how
// much of it this app can actually see.
//
// A screen titled "every market we cover" is a claim, and it is the easiest kind
// of claim in a finance app to overstate, because the overstatement is made by
// the LAYOUT rather than by any sentence. Six index tiles in a neat grid, each
// showing a number, read as six equally live markets. In this app they are not:
// one might be a print from four minutes ago, one a close from Friday, one a
// figure pulled out of a twelve-hour cache, and one a market we can name but
// have never successfully reached. A single green dot on each tile would flatten
// four different facts into one, and the flattened version is the flattering one.
//
// So this module refuses to answer "is it covered" with a boolean. Six decisions:
//
//   1. Coverage is a STATE WITH AN AGE, not a yes/no. LIVE, STALE, CACHED and
//      UNREACHABLE are four different things and the screen renders four
//      different things.
//
//   2. Freshness is measured against the market's OWN LAST SESSION, never
//      against the wall clock. This is the load-bearing decision of the file.
//      NIFTY shows 15:30 Friday's number all through Saturday, and that number
//      is not stale — it is the correct current price of the index, and there
//      will not be another one until Monday. An app that measures age in
//      hours-since-now paints every tile amber all weekend, and a warning that
//      is always on is a warning nobody reads by the third weekend.
//
//   3. A market we cannot reach is LISTED ANYWAY, with the reason and the
//      remedy. Dropping it makes coverage look complete, which is the same
//      mistake report.js exists to avoid: a section quietly missing is worse
//      than a section printed as missing.
//
//   4. The catalogue is what we can NAME; coverage is what we can REACH. Those
//      two counts are different numbers and both are stated, because the gap
//      between them IS the honest description of this app.
//
//   5. Nothing here fetches. The screen opens on what the cache already knows,
//      stamped, and a network round-trip is a press — same rule as the scanner
//      and the report.
//
//   6. THE AGE OF A FETCH IS NOT THE AGE OF THE DATA. The cache stamps when we
//      last called a provider; the series stamps what day the last close is for.
//      A successful call four minutes ago that came back with Wednesday's close
//      on a Friday is not fresh data — it is fresh confirmation that the provider
//      is behind. Those two need different words on screen because they need
//      different actions from the reader: one is fixed by pressing Refresh and
//      the other is not fixed by pressing anything. Freshness is therefore always
//      judged on the DATA date, and the fetch time is reported beside it.
//
// What this file cannot do, stated because a limitation you have not been told
// about is indistinguishable from a bug: it knows weekends and trading hours,
// but it does NOT know exchange HOLIDAYS. There is no holiday calendar in this
// app and inventing one that silently went out of date would be worse than not
// having one. So on Diwali or Thanksgiving a market reads as open-with-no-fresh
// -print rather than as closed, and `sessionState` says so in `holidayCaveat`.

const num = v => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const MIN = 60000;
export const LIVE_WINDOW_MIN = 60;   // during a session, a print older than this is stale
export const CACHE_STALE_H = 12;     // matches india.js's own cache lifetime

// ------------------------------------------------------------------ exchanges

// Offsets are STANDARD time. US exchanges carry `dst: 'US'` and the shift is
// computed; Indian exchanges do not observe daylight saving at all, which is why
// IST is a flat +5:30 year round and needs no rule.
export const EXCHANGES = {
  NSE: { id: 'NSE', label: 'National Stock Exchange', city: 'Mumbai', tz: 330, tzLabel: 'IST', dst: null, open: 9 * 60 + 15, close: 15 * 60 + 30 },
  BSE: { id: 'BSE', label: 'Bombay Stock Exchange', city: 'Mumbai', tz: 330, tzLabel: 'IST', dst: null, open: 9 * 60 + 15, close: 15 * 60 + 30 },
  NYSE: { id: 'NYSE', label: 'New York Stock Exchange', city: 'New York', tz: -300, tzLabel: 'ET', dst: 'US', open: 9 * 60 + 30, close: 16 * 60 },
  NASDAQ: { id: 'NASDAQ', label: 'Nasdaq', city: 'New York', tz: -300, tzLabel: 'ET', dst: 'US', open: 9 * 60 + 30, close: 16 * 60 },
};
export const exchangeOf = id => EXCHANGES[String(id || '').toUpperCase()] || null;

// US daylight saving: second Sunday in March to first Sunday in November.
// Computed rather than tabulated, so it does not expire.
export function usDST(d) {
  const t = d instanceof Date ? d : new Date(d);
  const y = t.getUTCFullYear();
  const firstSun = (mon) => {
    const first = new Date(Date.UTC(y, mon, 1));
    return 1 + ((7 - first.getUTCDay()) % 7);
  };
  const start = Date.UTC(y, 2, firstSun(2) + 7, 7);  // 02:00 EST = 07:00 UTC
  const end = Date.UTC(y, 10, firstSun(10), 6);      // 02:00 EDT = 06:00 UTC
  const ms = t.getTime();
  return ms >= start && ms < end;
}

// The offset actually in force at that instant, in minutes east of UTC.
export const offsetAt = (ex, now = new Date()) =>
  ex.tz + (ex.dst === 'US' && usDST(now) ? 60 : 0);

// Wall-clock parts as seen from the exchange's own city.
function localParts(d, offMin) {
  const s = new Date(d.getTime() + offMin * MIN);
  return {
    y: s.getUTCFullYear(), m: s.getUTCMonth(), d: s.getUTCDate(),
    dow: s.getUTCDay(), min: s.getUTCHours() * 60 + s.getUTCMinutes(),
  };
}
const utcFromLocal = (y, m, d, min, offMin) => new Date(Date.UTC(y, m, d, 0, min) - offMin * MIN);
const isWeekday = dow => dow >= 1 && dow <= 5;

export const fmtLocal = (ex, now = new Date()) => {
  const p = localParts(now, offsetAt(ex, now));
  const hh = String(Math.floor(p.min / 60)).padStart(2, '0');
  const mm = String(p.min % 60).padStart(2, '0');
  return `${hh}:${mm} ${ex.tzLabel}`;
};

export const fmtHours = ex => {
  const t = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  return `${t(ex.open)}–${t(ex.close)} ${ex.tzLabel}`;
};

// ------------------------------------------------------------------ sessions

// Where an exchange is in its week, plus the boundaries either side of now.
//
// `phase` is one of: 'open' | 'pre' | 'post' | 'weekend'. 'pre' and 'post' are
// kept apart from 'weekend' because they mean different things to a reader —
// pre-open is "wait twenty minutes", the weekend is "wait two days" — and a
// single 'closed' would make those the same sentence.
export function sessionState(exId, now = new Date()) {
  const ex = exchangeOf(exId);
  if (!ex) return null;
  const off = offsetAt(ex, now);
  const p = localParts(now, off);

  const weekend = !isWeekday(p.dow);
  const open = !weekend && p.min >= ex.open && p.min < ex.close;
  const phase = weekend ? 'weekend' : open ? 'open' : p.min < ex.open ? 'pre' : 'post';

  // The most recent close that has actually happened. Walk back at most a week —
  // if nothing is found in seven days the exchange definition is wrong, and
  // returning null is better than returning a confident wrong date.
  let lastClose = null;
  for (let i = 0; i <= 7; i += 1) {
    const c = utcFromLocal(p.y, p.m, p.d - i, ex.close, off);
    const cp = localParts(c, off);
    if (isWeekday(cp.dow) && c.getTime() <= now.getTime()) { lastClose = c; break; }
  }

  let nextOpen = null;
  for (let i = 0; i <= 7; i += 1) {
    const o = utcFromLocal(p.y, p.m, p.d + i, ex.open, off);
    const op = localParts(o, off);
    if (isWeekday(op.dow) && o.getTime() > now.getTime()) { nextOpen = o; break; }
  }

  return {
    exchange: ex.id, label: ex.label, city: ex.city, hours: fmtHours(ex),
    localTime: fmtLocal(ex, now), offsetMin: off,
    dstInForce: ex.dst === 'US' ? usDST(now) : false,
    open, phase, weekend, lastClose, nextOpen,
    // Said out loud on every session answer rather than buried in a footnote:
    // the one thing this calculation does not know about.
    holidayCaveat: 'Weekends and trading hours only — this app has no exchange holiday calendar, so a public holiday reads as an open market with no fresh print.',
  };
}

// How long until the phase changes, in whole minutes. Null when unknown.
export function minutesToChange(st, now = new Date()) {
  if (!st) return null;
  const target = st.open ? null : st.nextOpen;
  if (st.open) {
    const ex = exchangeOf(st.exchange);
    const off = st.offsetMin;
    const p = localParts(now, off);
    const close = utcFromLocal(p.y, p.m, p.d, ex.close, off);
    return Math.max(0, Math.round((close.getTime() - now.getTime()) / MIN));
  }
  if (!target) return null;
  return Math.max(0, Math.round((target.getTime() - now.getTime()) / MIN));
}

// The instant a given calendar date's session closed, at a given exchange. The
// series stores dates ('2026-07-28'), not timestamps, because a daily close is a
// property of the day — so to compare it against now it has to be placed at the
// hour it actually happened, in the city it happened in. Placing it at UTC
// midnight instead would make every Indian close look 10 hours early and every
// US close look 20 hours early, which is enough to flip a freshness verdict.
export function closeInstant(dateStr, exId) {
  const ex = exchangeOf(exId);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || '').trim());
  if (!ex || !m) return null;
  const [, y, mo, d] = m.map(Number);
  const approx = new Date(Date.UTC(y, mo - 1, d, 12));
  return utcFromLocal(y, mo - 1, d, ex.close, offsetAt(ex, approx));
}

// ------------------------------------------------------------------ coverage

export const LIVE = 'live';
export const STALE = 'stale';
export const CACHED = 'cached';
export const UNREACHABLE = 'unreachable';

export const COVERAGE_LABEL = {
  [LIVE]: 'Live', [STALE]: 'Behind', [CACHED]: 'From cache', [UNREACHABLE]: 'Not reached',
};
export const COVERAGE_COLOR = {
  [LIVE]: 'var(--green)', [STALE]: 'var(--orange)',
  [CACHED]: 'var(--yellow)', [UNREACHABLE]: 'var(--ink-3)',
};

// Whole weekdays between two instants, which is the closest this file gets to
// counting sessions. It is approximate for exactly the reason stated at the top —
// no holiday calendar — so it is reported as "sessions behind (approx)" wherever
// it surfaces, and never as a precise count.
export function weekdaysBetween(a, b) {
  if (!a || !b) return null;
  let from = new Date(Math.min(a.getTime(), b.getTime()));
  const to = new Date(Math.max(a.getTime(), b.getTime()));
  let n = 0;
  from = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  while (from.getTime() < end) {
    from = new Date(from.getTime() + 86400000);
    if (isWeekday(from.getUTCDay())) n += 1;
  }
  return n;
}

// The coverage verdict for one market.
//
// Two branches carry the weight of this function.
//
// The first is `st.open`. During a session a two-hour-old print is stale, because
// the index has moved since. Outside a session the SAME two-hour-old print may be
// perfectly current — if it is at or after the last close, it IS the close, and no
// fresher number exists anywhere. Measuring both cases against the wall clock gets
// the second one wrong, every evening and all weekend.
//
// The second is `providerBehind`. When the data is old but the fetch that produced
// it is recent, refreshing is not the remedy and must not be offered as one — the
// app is up to date with a provider that is not.
export function coverageOf(entry, st, now = new Date()) {
  if (!entry || entry.value == null || !entry.asOf) {
    return {
      state: UNREACHABLE, fresh: false, ageMin: null, sessionsBehind: null,
      providerBehind: false, fetchedMin: null,
      why: entry && entry.error
        ? `Last attempt failed: ${entry.error}`
        : 'No level has ever been stored for this index on this device.',
      remedy: proxyEnabled()
        ? 'Press Refresh — if it keeps failing the provider is refusing the request rather than the app being misconfigured.'
        : 'Press Refresh. If every index fails, the data hosts are not sending CORS headers to this browser; the relay in Settings routes public index symbols through a third party and is off by default.',
    };
  }

  const asOf = entry.asOf instanceof Date ? entry.asOf : new Date(entry.asOf);
  if (Number.isNaN(asOf.getTime())) {
    return {
      state: UNREACHABLE, fresh: false, ageMin: null, sessionsBehind: null,
      providerBehind: false, fetchedMin: null,
      why: 'A level is stored but its date is unreadable, so its age cannot be established.',
      // An undated number is treated as no number at all. This is finboy.js's rule
      // in a different place: an undated fact carries no date rather than today's,
      // and a figure whose age is unknown must not be shown as current.
      remedy: 'Press Refresh to replace it with a dated reading.',
    };
  }

  const ageMin = Math.max(0, Math.round((now.getTime() - asOf.getTime()) / MIN));
  const fetchedMin = entry.fetchedAt
    ? Math.max(0, Math.round((now.getTime() - new Date(entry.fetchedAt).getTime()) / MIN))
    : null;

  if (st && st.open) {
    const fresh = ageMin <= LIVE_WINDOW_MIN;
    const behindProvider = !fresh && fetchedMin != null && fetchedMin <= LIVE_WINDOW_MIN;
    return {
      state: fresh ? LIVE : STALE, fresh, ageMin, sessionsBehind: 0,
      providerBehind: behindProvider, fetchedMin,
      why: fresh
        ? `${st.label} is open and this level is ${ageMin} minute${ageMin === 1 ? '' : 's'} old.`
        : behindProvider
          ? `${st.label} is open and trading. The app checked ${fetchedMin} minute${fetchedMin === 1 ? '' : 's'} ago, but the newest level the provider offered is ${ageMin} minutes old — the delay is upstream, not here.`
          : `${st.label} is open and trading, but this level is ${ageMin} minutes old, so the index has moved since.`,
      remedy: fresh ? null
        : behindProvider ? 'Refreshing will not help — the provider itself is behind. Free tiers commonly delay intraday index levels.'
          : 'Press Refresh for the current level.',
    };
  }

  // Closed. The question is no longer "how old" but "which session".
  const lastClose = st ? st.lastClose : null;
  if (lastClose && asOf.getTime() >= lastClose.getTime() - 5 * MIN) {
    return {
      state: LIVE, fresh: true, ageMin, sessionsBehind: 0,
      providerBehind: false, fetchedMin,
      // Worded to deny the reading the number's age would otherwise invite.
      why: `${st.label} is closed. This is the last close, which is the current level of the index — it will not change until the next session.`,
      remedy: null,
    };
  }

  const behind = lastClose ? weekdaysBetween(asOf, lastClose) : null;
  const old = ageMin > CACHE_STALE_H * 60;
  const behindProvider = fetchedMin != null && fetchedMin <= CACHE_STALE_H * 60 && behind > 0;
  return {
    state: old ? CACHED : STALE, fresh: false, ageMin, sessionsBehind: behind,
    providerBehind: behindProvider, fetchedMin,
    why: behind
      ? `This level predates the last close by about ${behind} session${behind === 1 ? '' : 's'}, so at least one close has happened that this figure does not include.`
      : 'This level is older than the most recent close.',
    remedy: behindProvider
      ? `The app last checked ${fetchedMin} minute${fetchedMin === 1 ? '' : 's'} ago and this was the newest close on offer, so the gap is the provider's, not the app's.`
      : 'Press Refresh.',
  };
}

// ------------------------------------------------------------------ catalogue

// Which exchange stands behind each index. NIFTY and BANKNIFTY are NSE products,
// SENSEX is BSE's; the US indices are not exchange products in the same way, but
// they track NYSE and Nasdaq hours, and hours are what this module needs them for.
const INDEX_EXCHANGE = {
  NIFTY50: 'NSE', NIFTYBANK: 'NSE', SENSEX: 'BSE',
  SPX: 'NYSE', DJI: 'NYSE', NDX: 'NASDAQ',
};
export const exchangeForIndex = key => INDEX_EXCHANGE[key] || null;

export const REGIONS = {
  IN: { key: 'IN', label: 'India', cur: '₹', color: 'var(--orange)' },
  US: { key: 'US', label: 'United States', cur: '$', color: 'var(--cyan)' },
};

// One row per index: what it is, when its exchange trades, what we hold for it,
// and how much that is worth believing.
export function catalogue(cache = {}, now = new Date()) {
  return BENCHMARKS.map(b => {
    const exId = exchangeForIndex(b.key);
    const st = exId ? sessionState(exId, now) : null;
    const raw = cache[b.key] || null;
    const pts = raw && Array.isArray(raw.points) ? raw.points : [];
    const lastPt = pts.length ? pts[pts.length - 1] : null;
    const prevPt = pts.length > 1 ? pts[pts.length - 2] : null;

    // Placing the data date at the hour it actually happened — except when that
    // hour has not happened yet. A point dated TODAY during an open session has
    // not closed; it is an intraday reading, and a date alone cannot say how old
    // an intraday reading is. The fetch time is the only defensible answer there,
    // and it is an upper bound on the age rather than a claim about it.
    const closeAt = lastPt ? closeInstant(lastPt.d, exId) : null;
    const asOf = closeAt && closeAt.getTime() <= now.getTime()
      ? closeAt
      : (raw && raw.fetchedAt ? new Date(raw.fetchedAt) : null);

    const value = lastPt ? num(lastPt.v) : null;
    const entry = raw ? { ...raw, value, asOf } : null;
    const cov = coverageOf(entry, st, now);
    const prev = prevPt ? num(prevPt.v) : null;

    return {
      key: b.key, label: b.label, short: b.short, color: b.color,
      region: b.region, regionLabel: (REGIONS[b.region] || {}).label || b.region,
      cur: b.cur, exchange: exId, session: st, coverage: cov,
      value,
      // A change needs two readings from the same series. One reading is a level,
      // not a move, and rendering it as "+0.0%" would be inventing the second.
      change: value != null && prev != null && prev !== 0 ? ((value - prev) / prev) * 100 : null,
      points: pts,
      lastDate: lastPt ? lastPt.d : null,
      asOf,
      fetchedAt: raw && raw.fetchedAt ? new Date(raw.fetchedAt) : null,
      source: (raw && raw.source) || null,
    };
  });
}

// The two counts that matter, kept apart on purpose.
export function coverageSummary(rows = []) {
  const named = rows.length;
  const by = s => rows.filter(r => r.coverage.state === s).length;
  const live = by(LIVE), stale = by(STALE), cached = by(CACHED), unreachable = by(UNREACHABLE);
  const reached = named - unreachable;
  return {
    named, reached, live, stale, cached, unreachable,
    // Deliberately NOT called "coverage percent". The number is the share of the
    // catalogue we have any figure at all for, which is a weaker claim than the
    // word coverage makes, so it travels under a name that cannot be rounded up
    // in the reading.
    reachedPct: named ? (reached / named) * 100 : null,
    currentPct: named ? (live / named) * 100 : null,
    complete: named > 0 && live === named,
  };
}

// The honest sentence for the top of the screen. It always states BOTH counts,
// because "we cover six indices" and "four of them have a current level" are
// different claims and only the second one is about right now.
export function coverageNote(sum) {
  if (!sum || !sum.named) return 'No indices are configured.';
  if (sum.complete) return `All ${sum.named} indices have a current level.`;
  if (!sum.reached) return `${sum.named} indices are listed and none of them has a level stored on this device yet.`;
  const bits = [];
  if (sum.live) bits.push(`${sum.live} current`);
  if (sum.stale) bits.push(`${sum.stale} behind`);
  if (sum.cached) bits.push(`${sum.cached} from cache`);
  if (sum.unreachable) bits.push(`${sum.unreachable} never reached`);
  return `${sum.named} indices listed — ${bits.join(', ')}.`;
}

// ------------------------------------------------------------ what we can hold

// The second half of an honest answer to "every market we cover". The index grid
// above describes what this app can WATCH; this describes what it can HOLD, and
// crucially by what mechanism — because "supported" covers both a US stock whose
// price arrives on its own and a fixed deposit whose value exists only because it
// was typed in, and a reader who is not told the difference will assume the first.
export const INSTRUMENTS = [
  { key: 'us-stock', label: 'US stocks', market: 'US', kind: 'stock', priced: 'live', note: 'Quoted from the fundamentals provider.' },
  { key: 'us-etf', label: 'US ETFs', market: 'US', kind: 'etf', priced: 'live', note: 'Quoted the same way as a stock.' },
  { key: 'in-stock', label: 'Indian stocks', market: 'IN', kind: 'stock', priced: 'live', note: 'NSE and BSE symbols, quoted via the India provider chain.' },
  { key: 'in-etf', label: 'Indian ETFs', market: 'IN', kind: 'etf', priced: 'live', note: 'Same chain as Indian stocks.' },
  { key: 'crypto', label: 'Crypto', market: 'US', kind: 'crypto', priced: 'manual', note: 'Held and valued from what you enter — no exchange feed is wired in.' },
  { key: 'fd', label: 'Fixed deposits', market: 'IN', kind: 'fd', priced: 'computed', note: 'Value accrues from the rate and dates you entered; nothing is fetched.' },
  { key: 'bond', label: 'Bonds', market: 'IN', kind: 'bond', priced: 'computed', note: 'Valued from face, coupon and maturity as entered.' },
  { key: 'mf', label: 'Mutual funds', market: 'IN', kind: 'fund', priced: 'manual', note: 'Tracked at the NAV you enter — no AMC feed is wired in.' },
];

export const PRICING_LABEL = {
  live: 'Priced automatically',
  computed: 'Computed from your entry',
  manual: 'Valued at what you enter',
};
export const PRICING_COLOR = {
  live: 'var(--green)', computed: 'var(--cyan)', manual: 'var(--yellow)',
};

// Grouped for rendering, and counted so the screen can state the split rather
// than leaving a reader to tally coloured chips.
export function instrumentSummary(list = INSTRUMENTS) {
  const by = p => list.filter(i => i.priced === p).length;
  return {
    total: list.length, live: by('live'), computed: by('computed'), manual: by('manual'),
    // The one sentence a reader needs: how much of the book prices itself.
    note: `${by('live')} of ${list.length} instrument types price themselves; the other ${list.length - by('live')} are worth exactly what you told the app they are worth.`,
  };
}

// ------------------------------------------------------------------ loading

// Reads the cache india.js already keeps. It does NOT fetch — see decision 5.
//
// The store keys two different timestamps that are easy to conflate and must not
// be: `at` is when the app last CALLED a provider, and the last point's `d` is
// what day the data is FOR. Both come out of here under names that cannot be
// mistaken for each other, and `catalogue` judges freshness on the second.
export async function readCache(keys = BENCHMARKS.map(b => b.key)) {
  const out = {};
  let store = {};
  try { store = (await loadBenchCache()) || {}; } catch { store = {}; }
  for (const k of keys) {
    // Looked up by the literal key, NOT via benchmarkOf(). benchmarkOf falls back
    // to BENCHMARKS[0] for anything it does not recognise, which is a sane default
    // when you want a chart to render but a silent misattribution here: an unknown
    // key would come back carrying NIFTY's numbers under its own name, and a wrong
    // number wearing the right label is the one failure this whole module exists
    // to prevent. An unrecognised key gets null, and the catalogue renders it as
    // never reached.
    const known = BENCHMARKS.some(b => b.key === k);
    const hit = known ? store[k] : null;
    if (!hit) { out[k] = null; continue; }
    const pts = Array.isArray(hit.points) ? hit.points : [];
    out[k] = {
      points: pts,
      lastDate: pts.length ? pts[pts.length - 1].d : null,
      fetchedAt: hit.at ? new Date(hit.at) : null,
      source: hit.source || null,
      error: hit.error || null,
    };
  }
  return out;
}

export const DISCLAIMER =
  'This screen describes what the app can see, not what any market is doing. '
  + 'Index levels are shown so you can tell how current the app’s data is; '
  + 'nothing here is a view on any market and no level is a signal to act on.';

export { BENCHMARKS, benchmarkOf, MARKETS, KINDS };


// Live USD→INR. Keyless and CORS-friendly, with a second provider behind the
// first because a rate that fails to load is not cosmetic here: every rupee
// holding is EXCLUDED from the dollar totals until it arrives, rather than
// counted at par.
//
// Lifted out of Money.jsx because the dashboard needs it too. That file's copy
// being private is half of why the two portfolio tiles disagreed - HQ could not
// convert even if it had wanted to.
export async function fetchUsdInr() {
  try { const j = await (await fetch('https://api.frankfurter.app/latest?from=USD&to=INR')).json(); if (j?.rates?.INR) return j.rates.INR; } catch { /* try the next one */ }
  try { const j = await (await fetch('https://open.er-api.com/v6/latest/USD')).json(); if (j?.rates?.INR) return j.rates.INR; } catch { /* both refused */ }
  return null;
}
