// Pins the date-range brush arithmetic — the edges, which is where a range
// picker is actually judged. Hand-typed literals.

import {
  PRESETS, FUNDAMENTAL_PRESETS, presetOf, toDate, toISO, indexForDate, dateAt,
  clampRange, moveRange, rangeForPreset, presetForRange, sliceRange,
  xToIndex, indexToX, rangeCaption,
} from '../src/lib/range.js';

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; } else { fail++; console.log('FAIL ' + name); } };
const eq = (a, b, name) => ok(a === b, `${name} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

// A year of daily points, 2026-01-01 onwards, so index N is day N.
const DAY = 864e5;
const START = Date.parse('2026-01-01T00:00:00Z');
const S = Array.from({ length: 366 }, (_, i) => ({
  date: new Date(START + i * DAY).toISOString().slice(0, 10),
  v: i,
}));

// -------------------------------------------------------------- presets
eq(PRESETS.length, 9, 'nine price presets');
eq(presetOf('1y').days, 365, '1Y is 365 days');
eq(presetOf('all').days, Infinity, 'ALL is unbounded');
eq(presetOf('ytd').days, null, 'YTD is computed, not a fixed span');
eq(presetOf('nope'), null, 'an unknown preset is null');
// The fundamental strip is the shorter one — annual data has no 1D.
ok(!FUNDAMENTAL_PRESETS.some(p => p.key === '1d'), 'the fundamental strip has no 1D');
ok(FUNDAMENTAL_PRESETS.some(p => p.key === '3y'), 'the fundamental strip has 3Y');
eq(presetOf('3y').days, 1095, '3Y resolves through the fundamental list too');

// ---------------------------------------------------------------- dates
eq(toISO('2026-03-14'), '2026-03-14', 'a bare date round-trips');
eq(toISO(''), null, 'an empty string is not a date');
eq(toISO('rubbish'), null, 'unparseable input is null, not today');
eq(toISO(null), null, 'null is not a date');
eq(toDate(new Date('x')), null, 'an invalid Date object is rejected');
eq(dateAt(S, 0), '2026-01-01', 'index 0 is the first date');
eq(dateAt(S, 365), '2027-01-01', 'index 365 is the last date');

// Decision 1: a date the series does not contain resolves to the nearest point.
eq(indexForDate(S, '2026-01-01'), 0, 'an exact match resolves to itself');
eq(indexForDate(S, '2026-02-01'), 31, 'a mid-series date resolves by offset');
eq(indexForDate(S, '2020-01-01'), 0, 'a date before the series clamps to the start');
eq(indexForDate(S, '2030-01-01'), 365, 'a date after the series clamps to the end');
eq(indexForDate([], '2026-01-01'), null, 'an empty series has no index');
eq(indexForDate(S, 'rubbish'), null, 'an unparseable date has no index');
// Nearest, not floor: a timestamp closer to the next point picks the next point.
eq(indexForDate(S, '2026-01-02T20:00:00Z'), 2, 'nearest wins over earlier');

// ---------------------------------------------------------------- clamp
const full = clampRange(S, 0, 365);
eq(full.count, 366, 'the full range counts every point inclusively');
eq(clampRange(S, -50, 400).from, 0, 'an under-range start clamps to zero');
eq(clampRange(S, -50, 400).to, 365, 'an over-range end clamps to the last index');
// Decision 2: a backwards drag is a gesture, not an error.
const back = clampRange(S, 200, 100);
eq(back.from, 100, 'a backwards range swaps rather than refusing');
eq(back.to, 200, 'and keeps both boundaries');
eq(clampRange(S, 5, 5).count, 1, 'a single-point range counts one, not zero');
eq(clampRange([], 0, 1), null, 'an empty series has no range');
eq(clampRange(S, NaN, NaN).from, 0, 'NaN boundaries fall back to the whole series');
eq(clampRange(S, NaN, NaN).to, 365, 'and to the last index');

// ----------------------------------------------------------------- move
// Decision 2: the window keeps its width while it can, then stops.
const win = clampRange(S, 100, 130);   // 31 points wide
const moved = moveRange(S, win, 10);
eq(moved.from, 110, 'moving right shifts the start');
eq(moved.count, 31, 'and preserves the width');
const atEnd = moveRange(S, win, 10000);
eq(atEnd.to, 365, 'moving past the end stops at the end');
eq(atEnd.count, 31, 'and STILL preserves the width rather than shrinking');
const atStart = moveRange(S, win, -10000);
eq(atStart.from, 0, 'moving past the start stops at the start');
eq(atStart.count, 31, 'and preserves the width there too');
// A window as wide as the series cannot move at all.
eq(moveRange(S, full, 50).from, 0, 'a full-width window cannot be moved');
eq(moveRange(S, win, 0.4).from, 100, 'a sub-point delta rounds to no movement');
eq(moveRange([], win, 5), null, 'an empty series cannot be moved');

// --------------------------------------------------------------- presets
const y1 = rangeForPreset(S, '1y');
eq(y1.to, 365, '1Y ends at the last point');
eq(y1.from, 0, '1Y over 366 days of data starts at the first point');
eq(y1.truncated, false, '366 days of data satisfies a 1Y request');
// Decision 3: a preset longer than the data is the whole data, and SAYS SO.
const y5 = rangeForPreset(S, '5y');
eq(y5.from, 0, '5Y over one year of data starts at the beginning');
eq(y5.to, 365, 'and ends at the end');
eq(y5.truncated, true, 'and is explicitly flagged as truncated');
eq(rangeForPreset(S, 'all').truncated, false, 'ALL is never truncated');
eq(rangeForPreset(S, 'all').count, 366, 'ALL spans everything');
const m1 = rangeForPreset(S, '1m');
eq(m1.count, 31, '1M is 30 days back plus the endpoint');
eq(m1.truncated, false, 'a month fits inside a year of data');
eq(rangeForPreset(S, '1d').count, 2, '1D is the last point and the one before');
// YTD is computed from the LAST point's year, not from today.
const ytd = rangeForPreset(S, 'ytd');
eq(dateAt(S, ytd.from), '2027-01-01', 'YTD of a series ending 2027-01-01 starts that January');
eq(rangeForPreset([], '1y'), null, 'an empty series has no preset range');
eq(rangeForPreset(S, 'nope'), null, 'an unknown preset yields nothing');

eq(presetForRange(S, rangeForPreset(S, '1m')), '1m', 'a range matching a preset lights it');
eq(presetForRange(S, clampRange(S, 17, 191)), null, 'an arbitrary drag matches no preset');
eq(presetForRange(S, null), null, 'no range matches no preset');

eq(sliceRange(S, clampRange(S, 10, 12)).length, 3, 'slicing is inclusive at both ends');
eq(sliceRange(S, clampRange(S, 10, 12))[0].v, 10, 'the slice starts where asked');
eq(sliceRange(S, null).length, 366, 'no range slices everything');

// ------------------------------------------------------------ pixel math
// The off-by-one that stops a brush selecting its own last point.
eq(xToIndex(0, 300, 366), 0, 'the left edge is index 0');
eq(xToIndex(300, 300, 366), 365, 'the RIGHT EDGE reaches the last index');
eq(xToIndex(150, 300, 366), 183, 'the midpoint is the middle index, rounded');
eq(xToIndex(-40, 300, 366), 0, 'dragging left of the chart clamps');
eq(xToIndex(999, 300, 366), 365, 'dragging right of the chart clamps');
eq(xToIndex(50, 0, 366), 0, 'a zero-width chart has no meaningful index');
eq(xToIndex(50, 300, 1), 0, 'a single-point series is always index 0');
eq(indexToX(0, 300, 366), 0, 'index 0 sits at the left edge');
eq(indexToX(365, 300, 366), 300, 'the last index sits at the RIGHT edge');
eq(indexToX(400, 300, 366), 300, 'an out-of-range index clamps to the edge');
eq(indexToX(0, 300, 1), 0, 'a single point sits at the origin');
// A large series hides an off-by-one behind rounding — 366 points over 300px
// round identically whether you divide by n or n-1. A short series does not.
eq(xToIndex(50, 100, 5), 2, 'a five-point series maps the midpoint to index 2');
eq(xToIndex(100, 100, 5), 4, 'and the right edge to the last of five');
eq(xToIndex(25, 100, 5), 1, 'and a quarter across to index 1');
eq(indexToX(2, 100, 5), 50, 'index 2 of five sits at the midpoint');

// Ties must break EARLIER, so dragging a boundary left then right lands back
// where it started instead of creeping one point forward each pass.
eq(indexForDate(S, '2026-01-01T12:00:00Z'), 0, 'a date exactly between two points picks the earlier');
eq(indexForDate(S, '2026-01-02T12:00:00Z'), 1, 'and does so consistently further along');

// --------------------------------------------------------------- caption
const cap = rangeCaption(S, clampRange(S, 0, 365));
eq(cap.from, '2026-01-01', 'the caption names the start');
eq(cap.to, '2027-01-01', 'and the end');
eq(cap.days, 365, 'and the span in days');
eq(cap.points, 366, 'and the point count');
eq(cap.span, '1.0 years', 'a year-long span reads in years');
eq(rangeCaption(S, clampRange(S, 0, 10)).span, '10 days', 'a short span reads in days');
eq(rangeCaption(S, clampRange(S, 0, 90)).span, '3 months', 'a mid span reads in months');
eq(rangeCaption(S, clampRange(S, 5, 5)).span, 'single day', 'one point is a single day');
eq(rangeCaption([], null), null, 'nothing selected has no caption');
ok(rangeCaption(S, clampRange(S, 0, 10)).text.includes('11 points'), 'the caption states the point count');

console.log(`${pass}/${pass + fail} passing`);
if (fail) process.exit(1);
