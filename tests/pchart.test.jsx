// Tests for the PortfolioChart range/decimation arithmetic.
//
// The chart was rewritten to fix two complaints — that it lagged and that the
// range buttons did not mean what they said — and the second one is arithmetic,
// which is the part a person cannot check by looking at it. A window that is
// off by a day, or a decimation that quietly flattens a step, produces a chart
// that looks entirely plausible and is wrong. So the three pure helpers are
// exported and pinned here.
//
// Run: bun tests/pchart.test.jsx
import { addMonths, cutoffFor, decimate } from '../src/components/PortfolioChart.jsx';

let pass = 0, fail = 0;
function ok(what, cond, got) {
  if (cond) { pass++; }
  else { fail++; console.log(`FAIL: ${what}${got !== undefined ? `  (got ${got})` : ''}`); }
}
const iso = d => new Date(d).toISOString().slice(0, 10);
const D = s => new Date(s + 'T00:00:00Z');

// ---------------------------------------------------------------- addMonths
{
  // The ordinary cases first, so a failure in the interesting ones cannot be
  // dismissed as the helper simply not working.
  ok('a month back from mid-month is the same day of the previous month',
    iso(addMonths(D('2026-08-15'), -1)) === '2026-07-15', iso(addMonths(D('2026-08-15'), -1)));
  ok('three months back crosses into the previous quarter',
    iso(addMonths(D('2026-08-15'), -3)) === '2026-05-15', iso(addMonths(D('2026-08-15'), -3)));
  ok('twelve months back is the same date a year earlier',
    iso(addMonths(D('2026-08-15'), -12)) === '2025-08-15', iso(addMonths(D('2026-08-15'), -12)));
  ok('six months back crosses the new year when it has to',
    iso(addMonths(D('2026-03-10'), -6)) === '2025-09-10', iso(addMonths(D('2026-03-10'), -6)));

  // This is the whole reason the helper exists rather than a bare setMonth.
  // 31 March minus one month is 31 February, which Date rolls FORWARD into
  // 3 March — so the naive version returns a cutoff four days AFTER the one it
  // returns for 30 March, and the "1M" window on the 31st of a long month is
  // shorter than the window on the 30th. Clamping to the last day of the target
  // month is what a person means.
  ok('the 31st of March minus a month clamps to the end of February',
    iso(addMonths(D('2026-03-31'), -1)) === '2026-02-28', iso(addMonths(D('2026-03-31'), -1)));
  ok('and it does not roll forward past the month it landed in',
    addMonths(D('2026-03-31'), -1).getMonth() === 1, String(addMonths(D('2026-03-31'), -1).getMonth()));
  ok('the same date in a leap year clamps to the 29th, not the 28th',
    iso(addMonths(D('2024-03-31'), -1)) === '2024-02-29', iso(addMonths(D('2024-03-31'), -1)));
  ok('the 31st of May minus one month clamps to the 30th of April',
    iso(addMonths(D('2026-05-31'), -1)) === '2026-04-30', iso(addMonths(D('2026-05-31'), -1)));
  ok('a year back from the 29th of February clamps to the 28th',
    iso(addMonths(D('2024-02-29'), -12)) === '2023-02-28', iso(addMonths(D('2024-02-29'), -12)));

  // The clamp must not fire when it is not needed — an over-eager clamp would
  // pull every window back to the 28th and nobody would notice for a month.
  ok('a date that exists in the target month is left alone',
    iso(addMonths(D('2026-03-28'), -1)) === '2026-02-28', iso(addMonths(D('2026-03-28'), -1)));
  ok('the input date is not mutated',
    (() => { const d = D('2026-03-31'); addMonths(d, -1); return iso(d) === '2026-03-31'; })());

  // Monotonicity is the property that actually matters downstream: a longer
  // range button must never produce a later cutoff than a shorter one.
  let mono = true;
  for (let day = 1; day <= 31; day++) {
    const base = new Date(Date.UTC(2026, 2, day));
    const a = addMonths(base, -1).getTime(), b = addMonths(base, -3).getTime(), c = addMonths(base, -12).getTime();
    if (!(c < b && b < a && a < base.getTime())) mono = false;
  }
  ok('across every day of a 31-day month, longer lookbacks are strictly earlier', mono);
}

// ---------------------------------------------------------------- cutoffFor
{
  const anchor = D('2026-08-01').getTime();
  ok('1W is exactly seven days', iso(cutoffFor('1W', anchor)) === '2026-07-25', iso(cutoffFor('1W', anchor)));
  ok('1M is a calendar month, not thirty days',
    iso(cutoffFor('1M', anchor)) === '2026-07-01', iso(cutoffFor('1M', anchor)));
  // The old code used 30/91/182/365-day constants. On 1 August a 30-day window
  // starts on 2 July, so the button labelled "1M" excluded the 1st of July —
  // the first day of the month it claims to show.
  ok('and it is therefore NOT the same as thirty days back',
    cutoffFor('1M', anchor) !== anchor - 30 * 86400000);
  ok('3M is three calendar months', iso(cutoffFor('3M', anchor)) === '2026-05-01', iso(cutoffFor('3M', anchor)));
  ok('6M is six calendar months', iso(cutoffFor('6M', anchor)) === '2026-02-01', iso(cutoffFor('6M', anchor)));
  ok('1Y is twelve calendar months', iso(cutoffFor('1Y', anchor)) === '2025-08-01', iso(cutoffFor('1Y', anchor)));
  // That last line does not distinguish anything on its own: 1 August 2025 to
  // 1 August 2026 happens to be exactly 365 days, so replacing the calendar
  // arithmetic with `anchor - 365 * DAY` passes it. The difference only shows
  // up across a leap day, which is precisely when the naive version is wrong —
  // a "1Y" window opened in mid-2024 would start on the 2nd of August 2023 and
  // quietly omit a day.
  const leap = D('2024-08-01').getTime();
  ok('a year back across a leap day is still the same calendar date',
    iso(cutoffFor('1Y', leap)) === '2023-08-01', iso(cutoffFor('1Y', leap)));
  ok('and 365 days back from that anchor would have been a day late',
    iso(leap - 365 * 86400000) === '2023-08-02', iso(leap - 365 * 86400000));
  ok('ALL has no cutoff at all', cutoffFor('ALL', anchor) === -Infinity, String(cutoffFor('ALL', anchor)));
  ok('an unrecognised label falls through to no cutoff rather than to zero',
    cutoffFor('7Y', anchor) === -Infinity, String(cutoffFor('7Y', anchor)));

  // Ordering again, this time through the public entry point.
  const order = ['1W', '1M', '3M', '6M', '1Y'].map(k => cutoffFor(k, anchor));
  ok('the five bounded ranges come back in strictly decreasing order',
    order.every((v, i) => i === 0 || v < order[i - 1]), order.map(iso).join(' '));
  ok('and every one of them is before the anchor', order.every(v => v < anchor));
}

// ---------------------------------------------------------------- decimate
{
  const mk = n => Array.from({ length: n }, (_, i) => ({ t: String(i), v: i, ms: i * 86400000 }));

  ok('a series smaller than the pixel budget is returned untouched',
    decimate(mk(10), 100).length === 10, String(decimate(mk(10), 100).length));
  ok('and it is the very same array, so no work was done',
    (() => { const a = mk(10); return decimate(a, 100) === a; })());
  ok('a degenerate column count is a no-op rather than a crash',
    decimate(mk(1000), 1).length === 1000, String(decimate(mk(1000), 1).length));

  const big = mk(5000);
  const out = decimate(big, 200);
  ok('a long series is actually reduced', out.length < big.length, `${out.length} of ${big.length}`);
  ok('and reduced to roughly two points per column, not one and not ten',
    out.length <= 200 * 2 + 4, String(out.length));
  ok('the first point survives', out[0] === big[0]);
  ok('the last point survives', out[out.length - 1] === big[big.length - 1]);
  ok('the output stays in time order',
    out.every((p, i) => i === 0 || p.ms >= out[i - 1].ms));

  // The property that a stride-based "keep every k-th point" would break. A
  // cost-basis chart is a staircase: a single order can double the invested
  // line in one day, and that day is exactly the one a stride is most likely to
  // skip. Keeping the extremes of each pixel column means the peak survives no
  // matter which column it lands in.
  let spikeKept = 0;
  for (let at = 0; at < 5000; at += 137) {
    const s = mk(5000).map(p => ({ ...p, v: 1 }));
    s[at] = { ...s[at], v: 999 };
    if (decimate(s, 200).some(p => p.v === 999)) spikeKept++;
  }
  ok('a one-day spike survives decimation wherever it falls in the series',
    spikeKept === 37, `${spikeKept} of 37`);

  // Troughs matter as much as peaks: a sell that drops the cost basis for a
  // single day is the same shape upside down, and keeping only the maximum per
  // column would erase it.
  const trough = mk(5000).map(p => ({ ...p, v: 500 }));
  trough[2222] = { ...trough[2222], v: 3 };
  ok('a one-day trough survives too', decimate(trough, 200).some(p => p.v === 3));

  // Within a column the two kept points must be emitted in time order, or the
  // path string zig-zags backwards and the area fill self-intersects.
  const zig = mk(5000).map((p, i) => ({ ...p, v: i % 2 ? 0 : 100 }));
  const zo = decimate(zig, 100);
  ok('alternating highs and lows still come out chronologically',
    zo.every((p, i) => i === 0 || p.ms >= zo[i - 1].ms));

  // The overall vertical extent must not shrink — that is what "the drawn shape
  // is identical at this width" means, and it is the claim in the source
  // comment. If decimation clipped the range the y-axis would rescale and the
  // chart would look subtly different at different widths.
  const noisy = mk(5000).map((p, i) => ({ ...p, v: Math.abs((i * 7919) % 1000) }));
  const nd = decimate(noisy, 300);
  ok('decimation preserves the maximum of the whole series',
    Math.max(...nd.map(p => p.v)) === Math.max(...noisy.map(p => p.v)));
  ok('decimation preserves the minimum of the whole series',
    Math.min(...nd.map(p => p.v)) === Math.min(...noisy.map(p => p.v)));

  // The endpoint guards. Nothing above could fail if they were deleted, because
  // every fixture so far rises monotonically — so the first point is its
  // column's minimum and the last is its column's maximum, and both survive as
  // extremes by luck rather than by rule. The guards exist for the case where
  // they are not extremes: a first point that is bracketed by higher and lower
  // values inside its own column is replaced as both `lo` and `hi` and vanishes,
  // and that is not cosmetic — the chart's left edge is where t0 comes from, so
  // losing it shifts the entire x-axis, and losing the last point drops today.
  const bracket = mk(5000).map((p, i) => ({ ...p, v: 500 }));
  for (let i = 1; i < 12; i++) bracket[i] = { ...bracket[i], v: i % 2 ? 900 : 100 };
  for (let i = 4988; i < 4999; i++) bracket[i] = { ...bracket[i], v: i % 2 ? 900 : 100 };
  const bd = decimate(bracket, 200);
  ok('the fixture really does bracket its first point, or this proves nothing',
    bracket.slice(0, 25).some(p => p.v > 500) && bracket.slice(0, 25).some(p => p.v < 500));
  ok('the fixture brackets its last point too',
    bracket.slice(-25).some(p => p.v > 500) && bracket.slice(-25).some(p => p.v < 500));
  ok('the first point survives even when it is not an extreme of its column',
    bd[0] === bracket[0], `v=${bd[0].v} ms=${bd[0].ms}`);
  // The matching claim for the last point cannot be made, and the reason is a
  // property of the bucket formula rather than an oversight. The column index is
  // `floor((p.ms - first.ms) / span * (cols - 1))`, and only the final point
  // reaches the full ratio of 1, so it is always alone in the last column and
  // always emitted as its own extreme. Its guard in the source is therefore
  // unreachable — deliberately kept as insurance against someone changing that
  // formula, but there is no fixture that can make it fire, and writing one
  // that appeared to would mean asserting a coincidence.
  ok('the last point is always alone in the final column, so it cannot be dropped',
    bracket.filter((_, i) => Math.floor((i / (bracket.length - 1)) * 199) === 199).length === 1);
  ok('and it does come out last',
    bd[bd.length - 1] === bracket[bracket.length - 1], `v=${bd[bd.length - 1].v}`);
  ok('and adding them back did not break the ordering',
    bd.every((p, i) => i === 0 || p.ms >= bd[i - 1].ms));
}

console.log(`\n${pass}/${pass + fail} passing`);
if (fail) process.exit(1);
