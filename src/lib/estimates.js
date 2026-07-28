// estimates.js — earnings actuals, analyst estimates, and the gap between them.
//
// This backs the Estimates tab from the reference set: paired actual/estimate bars
// across fiscal years, and a table of FY / EPS estimate / YoY growth / forward P/E /
// analyst count.
//
// Six decisions, each of which is a way this screen could quietly lie:
//
// 1. AN ACTUAL AND AN ESTIMATE ARE DIFFERENT KINDS OF NUMBER. They are never averaged,
//    never joined into one continuous line, and never drawn in the same colour. A chart
//    that runs a single line from history into forecast is claiming the forecast has the
//    same standing as the past, which is the one thing it does not have.
//
// 2. A BEAT IS ONLY A BEAT IF THE ESTIMATE EXISTED FIRST. Where no estimate was
//    published, the surprise is null — not zero. Zero means "landed exactly on the
//    number", which is a real and rare event, and must not share a value with "nobody
//    was asked".
//
// 3. A FISCAL YEAR SUMMED FROM INCOMPLETE QUARTERS IS NOT A FISCAL YEAR. Three quarters
//    summed and labelled as a year understates it by roughly a quarter. Partial years
//    are marked partial and are never compared against complete ones for growth.
//
// 4. FORWARD P/E IS A LIVE PRICE OVER A STALE GUESS. It is not a valuation the way
//    trailing P/E is; it is a ratio of one number that is known to another that is not.
//    It is labelled as such, and it carries the date of the estimate it used.
//
// 5. YoY GROWTH OFF A ZERO OR NEGATIVE BASE IS MEANINGLESS. A company going from −$1 to
//    +$1 has not grown 200%. Those cases return null and the table prints the reason.
//
// 6. THE ANALYST COUNT IS PART OF THE ESTIMATE. A consensus of three is not the same
//    object as a consensus of forty, and showing the number without the count invites
//    reading a thin estimate as a firm one. The count is never hidden.
//
// Nothing here is a forecast this app made. Every forward number is somebody else's
// published estimate, passed through arithmetic and attributed.

// Number(null), Number('') and Number(false) are all 0, and 0 is finite — so the
// obvious `Number.isFinite(Number(v)) ? Number(v) : null` turns a MISSING value
// into a real zero. A missing price becoming a price of zero is the difference
// between 'we do not know' and 'it is free'. Absence is checked before coercion.
const num = v => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

export const QUARTERS_PER_YEAR = 4;

// ---------------------------------------------------------------------------
// Historical actuals vs the estimate that stood before them.
// ---------------------------------------------------------------------------

// Finnhub's stock/earnings returns quarterly rows:
//   { period, actual, estimate, surprise, surprisePercent, quarter, year }
export function normaliseEarnings(rows = []) {
  return (rows || [])
    .map(r => {
      const actual = num(r?.actual);
      const estimate = num(r?.estimate);
      return {
        period: r?.period || null,
        year: num(r?.year),
        quarter: num(r?.quarter),
        actual,
        estimate,
        // Decision 2: no estimate means no surprise, not a surprise of zero.
        surprise: actual != null && estimate != null ? actual - estimate : null,
        surprisePct:
          actual != null && estimate != null && Math.abs(estimate) > 1e-9
            ? ((actual - estimate) / Math.abs(estimate)) * 100
            : null,
      };
    })
    .filter(r => r.year != null && r.quarter != null)
    .sort((a, b) => a.year - b.year || a.quarter - b.quarter);
}

// How often the company cleared the bar, over the quarters where a bar existed.
export function beatRate(quarters = []) {
  const judged = quarters.filter(q => q.surprise != null);
  if (!judged.length) return { beats: 0, misses: 0, inline: 0, judged: 0, pct: null, unjudged: quarters.length };
  const beats = judged.filter(q => q.surprise > 0).length;
  const misses = judged.filter(q => q.surprise < 0).length;
  const inline = judged.filter(q => q.surprise === 0).length;
  return {
    beats, misses, inline,
    judged: judged.length,
    pct: (beats / judged.length) * 100,
    // Quarters with no published estimate are excluded from the rate and counted
    // separately, so a thin history cannot masquerade as a perfect record.
    unjudged: quarters.length - judged.length,
  };
}

// Decision 3: a year is four quarters or it is marked partial.
export function byFiscalYear(quarters = []) {
  const years = new Map();
  for (const q of quarters) {
    if (!years.has(q.year)) years.set(q.year, []);
    years.get(q.year).push(q);
  }
  return [...years.entries()]
    .map(([year, qs]) => {
      const complete = qs.length === QUARTERS_PER_YEAR;
      const haveAll = qs.every(q => q.actual != null);
      const estAll = qs.every(q => q.estimate != null);
      return {
        year,
        quarters: qs.length,
        partial: !complete,
        actual: haveAll ? qs.reduce((s, q) => s + q.actual, 0) : null,
        estimate: estAll ? qs.reduce((s, q) => s + q.estimate, 0) : null,
        kind: 'actual',
      };
    })
    .sort((a, b) => a.year - b.year);
}

// ---------------------------------------------------------------------------
// Forward estimates.
// ---------------------------------------------------------------------------

// Finnhub's stock/eps-estimate returns { data: [{ period, epsAvg, epsHigh, epsLow,
// numberAnalysts, year, quarter }] }. On the free tier this endpoint is usually not
// available; the caller passes whatever it got, including nothing, and the screen
// says which it was.
export function normaliseForward(rows = []) {
  return (rows || [])
    .map(r => ({
      year: num(r?.year),
      period: r?.period || null,
      eps: num(r?.epsAvg),
      high: num(r?.epsHigh),
      low: num(r?.epsLow),
      // Decision 6: the count travels with the number, always.
      analysts: num(r?.numberAnalysts),
      kind: 'estimate',
    }))
    .filter(r => r.year != null && r.eps != null)
    .sort((a, b) => a.year - b.year);
}

// Decision 5: growth off a base that is zero or negative is not a percentage.
export function yoy(cur, prev) {
  const c = num(cur), p = num(prev);
  if (c == null || p == null) return { pct: null, reason: 'no comparable year' };
  if (p <= 0) return { pct: null, reason: p === 0 ? 'prior year was zero' : 'prior year was a loss' };
  return { pct: ((c - p) / p) * 100, reason: null };
}

// Decision 4: a live price over a published guess. Both halves are labelled.
export function forwardPE(price, eps, { asOf = null } = {}) {
  const p = num(price), e = num(eps);
  if (p == null || e == null) return null;
  // A negative or zero EPS estimate has no meaningful P/E — a company expected to
  // lose money does not have a cheap multiple, it has no multiple.
  if (e <= 0) return { pe: null, reason: 'EPS estimate is not positive', price: p, eps: e, asOf };
  return { pe: p / e, reason: null, price: p, eps: e, asOf };
}

// ---------------------------------------------------------------------------
// The combined table. Actuals and estimates sit in ONE list but never lose the
// tag that says which they are — that tag is what every renderer keys off.
// ---------------------------------------------------------------------------

export function timeline({ earnings = [], forward = [], price = null } = {}) {
  const past = byFiscalYear(normaliseEarnings(earnings));
  const fwd = normaliseForward(forward);

  // Decision 1: where a year appears in both, the ACTUAL wins and the estimate is
  // kept beside it rather than replacing it. A reported year is not a forecast.
  const rows = [];
  const seen = new Set();
  for (const y of past) {
    seen.add(y.year);
    rows.push({
      year: y.year,
      kind: 'actual',
      partial: y.partial,
      quarters: y.quarters,
      eps: y.actual,
      estimate: y.estimate,
      analysts: null,
      high: null,
      low: null,
    });
  }
  for (const f of fwd) {
    if (seen.has(f.year)) continue;
    rows.push({
      year: f.year,
      kind: 'estimate',
      partial: false,
      quarters: null,
      eps: f.eps,
      estimate: f.eps,
      analysts: f.analysts,
      high: f.high,
      low: f.low,
    });
  }
  rows.sort((a, b) => a.year - b.year);

  // Growth, computed only between years that are actually comparable.
  for (let i = 0; i < rows.length; i++) {
    const prev = rows[i - 1];
    // Decision 3 again: a partial year is not a valid base or a valid subject.
    if (!prev || prev.partial || rows[i].partial) {
      rows[i].growth = { pct: null, reason: prev ? 'incomplete fiscal year' : 'no prior year' };
    } else {
      rows[i].growth = yoy(rows[i].eps, prev.eps);
    }
    rows[i].fpe = rows[i].kind === 'estimate' ? forwardPE(price, rows[i].eps) : null;
  }

  return rows;
}

// What the screen needs to say about its own completeness, in one object.
export function coverage(rows = [], { hadForwardEndpoint = true } = {}) {
  const actuals = rows.filter(r => r.kind === 'actual');
  const ests = rows.filter(r => r.kind === 'estimate');
  return {
    actuals: actuals.length,
    estimates: ests.length,
    partials: rows.filter(r => r.partial).length,
    firstYear: rows.length ? rows[0].year : null,
    lastYear: rows.length ? rows[rows.length - 1].year : null,
    // The honest distinction: no forward years because the company has none
    // published, versus no forward years because this plan cannot see them.
    forwardMissing: ests.length === 0,
    forwardBlocked: ests.length === 0 && !hadForwardEndpoint,
  };
}

// Bar geometry for the paired chart. Returns plain numbers; the component draws
// them. Actual and estimate share a scale — that is the entire point of the chart —
// but never share a bar.
export function barScale(rows = []) {
  const vals = rows.flatMap(r => [r.eps, r.estimate, r.high, r.low]).filter(v => num(v) != null);
  if (!vals.length) return { min: 0, max: 1, zero: 0, span: 1 };
  const max = Math.max(...vals, 0);
  const min = Math.min(...vals, 0);
  const span = max - min || 1;
  return { min, max, span, zero: (max / span) * 100 };
}
