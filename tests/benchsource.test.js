// The vs-benchmark chart drew nothing and said only "no index data yet".
//
// The cause was that BOTH providers fail for an index, always, and neither
// failure is transient. Index levels are licensed and absent from Twelve Data's
// free tier; Stooq serves the closes but sends no CORS header, so a browser
// discards a response it already received. Nothing about that improves by
// retrying, which is why the chart had been empty rather than intermittently
// empty.
//
// The fix substitutes a tracking fund, and the substitution is the thing that
// needs guarding. Two failure modes are worse than the empty chart was:
//
//   1. Merging a fund's prices into cached index levels. NIFTY is near 24,000
//      and INDA near 50 — a union on date produces one series that steps by a
//      factor of ~500 where the source changed, and every return crossing that
//      step is garbage that looks like a crash or a moonshot.
//   2. Labelling a fund's line as the index. A tracker's return is close to the
//      index's and not equal to it, and INDA's carries the rupee-dollar move on
//      top. Drawn unlabelled, the reader compares against something they were
//      never told about.

import { BENCHMARKS, benchmarkOf, mergeSeries, sourceNote, whyEmpty } from '../src/lib/india.js';

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; } else { fail++; console.log('FAIL ' + name); } };
const eq = (a, b, name) => ok(a === b, `${name} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

// ------------------------------------------------------------ the ETF column

// Every index that claims a proxy must also carry the sentence describing it,
// because the note is the only thing standing between a stand-in and a lie.
for (const b of BENCHMARKS) {
  if (b.etf) {
    ok(typeof b.etfNote === 'string' && b.etfNote.length > 0,
      `${b.key} names what its ${b.etf} proxy is`);
  }
}

eq(benchmarkOf('SPX').etf, 'SPY', 'the S&P is tracked by SPY');
eq(benchmarkOf('NDX').etf, 'QQQ', 'the Nasdaq 100 is tracked by QQQ');
eq(benchmarkOf('DJI').etf, 'DIA', 'the Dow is tracked by DIA');

// Deliberately absent. A close-enough fund does not exist from a US listing for
// either, and inventing one would silently benchmark against the wrong market.
eq(benchmarkOf('SENSEX').etf, undefined, 'the SENSEX gets no stand-in');
eq(benchmarkOf('NIFTYBANK').etf, undefined, 'NIFTY Bank gets no stand-in');

// INDA is a proxy AND a currency change, so its note has to say so — this is
// the one substitution a reader could be materially misled by.
ok(/₹|rupee|dollar|\$/.test(benchmarkOf('NIFTY50').etfNote),
  'the INDA note discloses the currency effect');

// --------------------------------------------------------------- source note

ok(/SPY/.test(sourceNote('SPX', 'etf:SPY')), 'a fund-sourced line says which fund');
eq(sourceNote('SPX', 'twelvedata'), null, 'a real index level needs no apology');
eq(sourceNote('SPX', null), null, 'no source, no note');

// -------------------------------------------------------------- why it failed

eq(whyEmpty([]), null, 'nothing tried, nothing to explain');
eq(whyEmpty(null), null, 'a missing list is not an error message');
eq(
  whyEmpty([{ provider: 'twelvedata', error: 'NO_KEY' }, { provider: 'stooq', error: 'Failed to fetch' }]),
  'twelvedata: NO_KEY · stooq: Failed to fetch',
  'both refusals are reported, with which provider said what',
);

// -------------------------------------------------- the scale-jump this avoids

// mergeSeries itself is source-blind by design — it is a set union on date, and
// that is the right primitive. The guard lives in fetchBenchmark, which only
// hands it points from the SAME provider. This asserts what would happen
// WITHOUT that guard, so the reason for it stays visible: the union is
// silently, catastrophically wrong.
const indexPts = [{ d: '2024-01-01', v: 21000 }, { d: '2024-01-02', v: 21100 }];
const etfPts = [{ d: '2024-01-03', v: 48.5 }, { d: '2024-01-04', v: 48.9 }];
const bad = mergeSeries(indexPts, etfPts);
eq(bad.length, 4, 'a blind union keeps all four points');
ok(bad[2].v / bad[1].v < 0.01,
  'and produces a 99.8% single-day "loss" — which is why the sources are never mixed');

// Same provider, which is the case the guard permits: an overlapping top-up
// extends the history and the newer value wins on a shared date.
const same = mergeSeries(
  [{ d: '2024-01-01', v: 100 }, { d: '2024-01-02', v: 101 }],
  [{ d: '2024-01-02', v: 101.5 }, { d: '2024-01-03', v: 102 }],
);
eq(same.length, 3, 'an overlapping top-up does not duplicate the shared day');
eq(same[1].v, 101.5, 'and the fresher close wins on it');
eq(same[2].d, '2024-01-03', 'the series stays sorted by date');

console.log(`${pass}/${pass + fail} passing`);
if (fail) process.exit(1);
