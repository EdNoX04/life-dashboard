// Curated dividend lists.
//
// The five decisions in src/lib/divlists.js are all decisions about NOT lying,
// and each one has a specific lie it prevents. This suite is organised around
// those lies rather than around the functions: a list that contains a King but
// not the same name as an Aristocrat; a streak silently aged forward; a yield
// presented as live when its numerator is a year old; a "not held" list that
// has quietly become a buy list; a missing rate rendered as 0.0%.
//
// Table-driven walks over MEMBERS are paired with hand-typed anchors throughout,
// because a walk that derives its expectation from the same table it is checking
// agrees with any table.

import {
  AS_OF, STALE_AFTER_DAYS, LISTS, MEMBERS,
  snapshotAge, yieldOf, buildList, sortList, listSummary, gaps, sectorMix, allTickers,
} from '../src/lib/divlists.js';
import { readFileSync } from 'fs';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass += 1; } else { fail += 1; console.log(`FAIL: ${name}${extra ? ` — ${extra}` : ''}`); }
};

const QUOTES = { KO: { price: 70 }, PG: { price: 160 }, O: { price: 56 }, MO: { price: 52 }, TR: { price: 30 } };
const TODAY = new Date('2026-08-04T00:00:00');
const BOOK = [{ ticker: 'KO', qty: 10 }, { ticker: 'ZZZZ', qty: 5 }];

// --------------------------------------------------- decision 1: one table
{
  // Hand-typed anchors first. If these are wrong every derived check below is
  // measuring the table against itself.
  const byKey = Object.fromEntries(LISTS.map(l => [l.key, l]));
  ok('Kings is 50 years', byKey.kings.minStreak === 50, String(byKey.kings?.minStreak));
  ok('Aristocrats is 25 years', byKey.aristocrats.minStreak === 25, String(byKey.aristocrats?.minStreak));
  ok('Achievers is 10 years', byKey.achievers.minStreak === 10, String(byKey.achievers?.minStreak));
  ok('the yield list has no streak floor', byKey.highyield.minStreak === 0);
  ok('and it does have a yield floor', byKey.highyield.minYield === 3.5, String(byKey.highyield?.minYield));

  const opts = { quotes: QUOTES, holdings: BOOK, today: TODAY };
  const k = buildList('kings', opts).map(r => r.ticker);
  const a = buildList('aristocrats', opts).map(r => r.ticker);
  const ac = buildList('achievers', opts).map(r => r.ticker);

  // THE containment property. This is the whole reason the lists are queries.
  ok('every King is also an Aristocrat', k.every(t => a.includes(t)),
    k.filter(t => !a.includes(t)).join());
  ok('every Aristocrat is also an Achiever', a.every(t => ac.includes(t)),
    a.filter(t => !ac.includes(t)).join());
  ok('and the nesting is strict, not accidental equality', k.length < a.length && a.length < ac.length,
    `${k.length}/${a.length}/${ac.length}`);

  // Hand-typed membership anchors: KO's streak is 63 in the table, so it is a
  // King; PM's is 17, so it is an Achiever and nothing more.
  ok('KO makes Kings', k.includes('KO'));
  ok('PM makes Achievers', ac.includes('PM'));
  ok('but PM is not an Aristocrat', !a.includes('PM'));
  ok('and PM is certainly not a King', !k.includes('PM'));

  // A streak reset by a spin-off falls out of every streak list on its own,
  // without a special case anywhere.
  ok('a spin-off reset drops the name from Achievers', !ac.includes('MMM'));
  ok('and from Aristocrats', !a.includes('MMM'));
  ok('but the name stays in the table rather than being deleted',
    MEMBERS.some(m => m.t === 'MMM'));
  ok('and it carries a reason for the zero',
    /spin-off/i.test(MEMBERS.find(m => m.t === 'MMM').note || ''));

  // Every threshold list is genuinely a filter on streak — no row sneaks in.
  for (const l of LISTS.filter(x => x.minStreak > 0)) {
    const rows = buildList(l.key, opts);
    ok(`${l.key} admits nothing below its floor`,
      rows.every(r => r.streak >= l.minStreak),
      rows.filter(r => r.streak < l.minStreak).map(r => r.ticker).join());
    ok(`${l.key} admits everything above it`,
      MEMBERS.filter(m => m.streak >= l.minStreak).length === rows.length,
      `${MEMBERS.filter(m => m.streak >= l.minStreak).length} vs ${rows.length}`);
  }

  ok('no ticker appears twice in the table',
    new Set(MEMBERS.map(m => m.t)).size === MEMBERS.length);
  ok('every member has a streak, a name and a sector',
    MEMBERS.every(m => m.t && m.n && m.s && Number.isFinite(m.streak)));
  ok('allTickers is deduped and sorted',
    allTickers().join() === [...new Set(MEMBERS.map(m => m.t))].sort().join());
}

// ------------------------------------------- decision 2: no extrapolation
{
  const rows = buildList('kings', { quotes: QUOTES, today: TODAY });
  const ko = rows.find(r => r.ticker === 'KO');
  const table = MEMBERS.find(m => m.t === 'KO');

  // The snapshot is 2025 and "today" here is 2026. A streak that had crept up
  // would read 64. It must read exactly what the table says.
  ok('the streak is the snapshot value, unchanged by the passage of a year',
    ko.streak === table.streak, `${ko.streak} vs ${table.streak}`);
  ok('and the anchor is hand-checked as 63', table.streak === 63, String(table.streak));
  ok('the year the streak was true travels with it', ko.streakAsOf === 2025, String(ko.streakAsOf));

  // The same row read two years later must still say 63 (2025).
  const later = buildList('kings', { quotes: QUOTES, today: new Date('2028-01-01T00:00:00') })
    .find(r => r.ticker === 'KO');
  ok('two years on the streak is still the snapshot value', later.streak === 63, String(later.streak));
  ok('and still stamped with the snapshot year', later.streakAsOf === 2025, String(later.streakAsOf));
}

// ------------------------------------------- decision 3: half-live yields
{
  ok('the snapshot date is a real date', /^\d{4}-\d{2}-\d{2}$/.test(AS_OF), AS_OF);
  ok('the staleness threshold is a full year', STALE_AFTER_DAYS === 365, String(STALE_AFTER_DAYS));

  // Hand-computed: 2025-05-01 to 2026-08-04 is 460 days (245 left in 2025, 215
  // into 2026 — 2026 is not a leap year).
  const age = snapshotAge(TODAY);
  ok('the snapshot age is computed, not guessed', age.days === 460, String(age.days));
  ok('and 460 days past a 365-day threshold is stale', age.stale === true);
  ok('the as-of year is exposed for the UI', age.asOfYear === 2025, String(age.asOfYear));

  const fresh = snapshotAge(new Date('2025-06-01T00:00:00'));
  ok('a month-old snapshot is not stale', fresh.stale === false, String(fresh.days));
  // The boundary in both directions, because "stale" is a banner that either
  // appears or does not and an off-by-one hides it for a day.
  ok('exactly at the threshold is not yet stale',
    snapshotAge(new Date('2026-05-01T00:00:00')).stale === false,
    String(snapshotAge(new Date('2026-05-01T00:00:00')).days));
  ok('one day past it is', snapshotAge(new Date('2026-05-02T00:00:00')).stale === true);
  ok('garbage dates do not fabricate an age', snapshotAge('nonsense').days === null);

  // The yield itself. KO pays 1.94 on the snapshot; at 70 that is 2.7714…%.
  ok('yield is rate over price', Math.abs(yieldOf(1.94, 70) - 2.771428) < 1e-4, String(yieldOf(1.94, 70)));
  const ko = buildList('kings', { quotes: QUOTES, today: TODAY }).find(r => r.ticker === 'KO');
  ok('and the row computes the same figure', Math.abs(ko.yieldPct - 2.771428) < 1e-4, String(ko.yieldPct));
  ok('the row carries the rate date so the yield can be caveated', ko.rateAsOf === AS_OF, ko.rateAsOf);
  ok('and carries the staleness verdict with it', ko.rateStale === true);
  const koFresh = buildList('kings', { quotes: QUOTES, today: new Date('2025-06-01T00:00:00') })
    .find(r => r.ticker === 'KO');
  ok('a fresh read marks the same row not-stale', koFresh.rateStale === false);
}

// ------------------------------------- decision 5: a blank is not a zero
{
  ok('no price means no yield', yieldOf(1.94, null) === null);
  ok('no rate means no yield', yieldOf(null, 70) === null);
  ok('a zero price means no yield, not infinity', yieldOf(1.94, 0) === null);
  ok('a negative price means no yield', yieldOf(1.94, -5) === null);
  ok('a garbage rate means no yield', yieldOf('abc', 70) === null);
  ok('a boolean is not a rate', yieldOf(true, 70) === null);
  // A zero rate IS a real figure — a suspended dividend — and must survive as 0
  // rather than being swallowed with the missing ones.
  ok('a genuine zero rate yields zero, which is different from unknown', yieldOf(0, 70) === 0);

  // An unquoted name still appears on a streak list; it simply has no yield.
  const rows = buildList('kings', { quotes: QUOTES, today: TODAY });
  const unquoted = rows.filter(r => r.price == null);
  ok('unquoted names still make the streak list', unquoted.length > 0, String(unquoted.length));
  ok('and every one of them has a null yield, never 0',
    unquoted.every(r => r.yieldPct === null),
    unquoted.filter(r => r.yieldPct !== null).map(r => r.ticker).join());

  // The yield list is the one place a missing yield must EXCLUDE rather than
  // default, and it must exclude rather than admit at zero.
  const hy = buildList('highyield', { quotes: QUOTES, today: TODAY });
  ok('the yield screen admits only rows that actually have a yield',
    hy.every(r => r.yieldPct != null && r.yieldPct >= 3.5),
    hy.map(r => `${r.ticker}:${r.yieldPct}`).join());
  // Hand-checked: MO 4.08/52 = 7.846%, O 3.22/56 = 5.75%. PG 4.03/160 = 2.52%
  // is quoted and below the floor; TR 0.40/30 = 1.33% likewise.
  ok('MO clears the floor', hy.some(r => r.ticker === 'MO'));
  ok('O clears the floor', hy.some(r => r.ticker === 'O'));
  ok('a quoted name below the floor is excluded', !hy.some(r => r.ticker === 'PG'));
  ok('so is a quoted low-yielder', !hy.some(r => r.ticker === 'TR'));
  ok('and an unquoted name is excluded rather than defaulted in',
    !hy.some(r => r.price == null));
}

// ------------------------------------------------- holdings and sorting
{
  const opts = { quotes: QUOTES, holdings: BOOK, today: TODAY };
  const rows = buildList('kings', opts);
  const ko = rows.find(r => r.ticker === 'KO');
  ok('a held name is marked held', ko.held === true);
  ok('and carries its quantity', ko.qty === 10, String(ko.qty));
  ok('annual income is rate times quantity', Math.abs(ko.annualIncome - 19.4) < 1e-9, String(ko.annualIncome));
  ok('an unheld name has no income figure', rows.find(r => r.ticker === 'PG').annualIncome === null);
  ok('a holding not on the list does not conjure a row', !rows.some(r => r.ticker === 'ZZZZ'));
  ok('a book entry with no ticker is ignored rather than crashing',
    buildList('kings', { quotes: QUOTES, holdings: [{ qty: 5 }], today: TODAY }).length === rows.length);
  ok('lowercase tickers in the book still match',
    buildList('kings', { quotes: QUOTES, holdings: [{ ticker: 'ko', qty: 3 }], today: TODAY })
      .find(r => r.ticker === 'KO').held === true);

  // Sorting. A streak list ranks by streak; the yield list ranks by yield.
  const ks = sortList(rows, 'kings');
  ok('a streak list is ordered by streak, descending',
    ks.every((r, i) => i === 0 || ks[i - 1].streak >= r.streak),
    ks.slice(0, 5).map(r => r.streak).join());
  const hs = sortList(buildList('highyield', opts), 'highyield');
  ok('the yield list is ordered by yield, descending',
    hs.every((r, i) => i === 0 || hs[i - 1].yieldPct >= r.yieldPct),
    hs.map(r => r.yieldPct?.toFixed(2)).join());
  // The real high-yield list happens to rank MO first on either column, so it
  // cannot show that the yield list sorts by yield. A hand-built pair whose two
  // columns point OPPOSITE ways can: LONGSTREAK has the better record and the
  // worse yield, so a sort that had collapsed to streak would lead with it.
  const opposed = sortList([
    { ticker: 'LONGSTREAK', streak: 60, yieldPct: 1 },
    { ticker: 'BIGYIELD', streak: 12, yieldPct: 9 },
  ], 'highyield');
  ok('the yield list leads with the better yield, not the longer streak',
    opposed[0].ticker === 'BIGYIELD', opposed[0].ticker);
  ok('and the same pair on a streak list leads with the longer streak',
    sortList([
      { ticker: 'LONGSTREAK', streak: 60, yieldPct: 1 },
      { ticker: 'BIGYIELD', streak: 12, yieldPct: 9 },
    ], 'kings')[0].ticker === 'LONGSTREAK');

  // Ties break on ticker so the table does not reshuffle between renders. The
  // fixture is hand-built so the tie is guaranteed and the alphabetical answer
  // opposes the input order.
  const tie = sortList([
    { ticker: 'ZED', streak: 60, yieldPct: 1 },
    { ticker: 'ACE', streak: 60, yieldPct: 1 },
  ], 'kings');
  ok('equal streaks break the tie on ticker', tie.map(r => r.ticker).join() === 'ACE,ZED',
    tie.map(r => r.ticker).join());

  // A missing sort value must sink whichever column is in use.
  const sunk = sortList([
    { ticker: 'AAA', yieldPct: null, streak: null },
    { ticker: 'BBB', yieldPct: 2, streak: 2 },
  ], 'highyield');
  ok('a row with no yield sinks rather than leading', sunk[0].ticker === 'BBB', sunk[0].ticker);
}

// ------------------------------------------------------------- summary
{
  const rows = buildList('kings', { quotes: QUOTES, holdings: BOOK, today: TODAY });
  const s = listSummary(rows);
  ok('the count is the list length', s.count === rows.length);
  ok('held count is counted, not assumed', s.heldCount === 1, String(s.heldCount));
  ok('income sums only held rows', Math.abs(s.income - 19.4) < 1e-9, String(s.income));
  ok('the priced count is reported so a thin median can be spotted',
    s.withYield === rows.filter(r => r.yieldPct != null).length);
  ok('and it is genuinely smaller than the list here', s.withYield < s.count,
    `${s.withYield}/${s.count}`);

  // Median, not mean — the whole point is that one outlier must not move it.
  // Hand-built fixture: 1, 2, 3, 100. Mean is 26.5; median is 2.5.
  const med = listSummary([
    { yieldPct: 1, held: false }, { yieldPct: 2, held: false },
    { yieldPct: 3, held: false }, { yieldPct: 100, held: false },
  ]);
  ok('an even count medians the middle pair', Math.abs(med.medianYield - 2.5) < 1e-9, String(med.medianYield));
  ok('and an outlier does not drag it the way a mean would', med.medianYield < 10);
  const odd = listSummary([
    { yieldPct: 1, held: false }, { yieldPct: 7, held: false }, { yieldPct: 9, held: false },
  ]);
  ok('an odd count takes the middle value', odd.medianYield === 7, String(odd.medianYield));
  ok('an empty list has no median rather than a zero one', listSummary([]).medianYield === null);
  ok('and no income rather than a zero one', listSummary([]).income === null);
}

// ------------------------------------------ decision 4: gaps are not picks
{
  const rows = buildList('highyield', { quotes: QUOTES, holdings: [{ ticker: 'MO', qty: 1 }], today: TODAY });
  const g = gaps(rows);
  ok('a held name is absent from the gaps', !g.some(r => r.ticker === 'MO'));
  ok('an unheld name is present', g.some(r => r.ticker === 'O'));
  ok('gaps carry no score of any kind',
    g.every(r => !('score' in r) && !('rating' in r) && !('signal' in r) && !('rank' in r)),
    Object.keys(g[0] || {}).join());
  ok('the limit is honoured', gaps(rows, 1).length === 1);
  ok('and zero means no limit', gaps(rows, 0).length === g.length);

  // A null yield must sort last in the gaps, not first — a blank ranked top of
  // a yield-ordered list would read as the highest yielder on it.
  const mixed = gaps([
    { ticker: 'NUL', yieldPct: null, held: false },
    { ticker: 'LOW', yieldPct: 1, held: false },
  ]);
  ok('an unpriced gap sorts below a priced one', mixed[0].ticker === 'LOW', mixed[0].ticker);
}

// ------------------------------------------------------------ sector mix
{
  const mix = sectorMix(buildList('kings', { quotes: QUOTES, today: TODAY }));
  ok('the mix covers every row exactly once',
    mix.reduce((s, m) => s + m.n, 0) === buildList('kings', { quotes: QUOTES, today: TODAY }).length);
  ok('percentages sum to 100', Math.abs(mix.reduce((s, m) => s + m.pct, 0) - 100) < 1e-6);
  ok('it is ordered biggest first', mix.every((m, i) => i === 0 || mix[i - 1].n >= m.n));
  ok('an empty list gives an empty mix', sectorMix([]).length === 0);
  // Hand-built, so the tie-break is not read off the real table.
  const tie = sectorMix([{ sector: 'Z' }, { sector: 'A' }]);
  ok('sectors of equal size break on name', tie.map(m => m.sector).join() === 'A,Z',
    tie.map(m => m.sector).join());
}

// --------------------------------------------------------- the UI's honesty
{
  const jsx = readFileSync(new URL('../src/components/money/DivLists.jsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/arcade.css', import.meta.url), 'utf8')
    + readFileSync(new URL('../src/theme.css', import.meta.url), 'utf8');

  // The banner is the single element that makes every number below it honest.
  ok('the stale banner is rendered off the computed age, not a constant',
    /age\.stale\s*&&/.test(jsx));
  ok('and it names the snapshot date on screen', /age\.asOf/.test(jsx));
  ok('and says how old it is', /age\.days/.test(jsx));
  // Comments are stripped first: this file's own commentary says the banner is
  // not dismissible, and searching the raw source for "dismiss" therefore finds
  // the promise rather than a breach of it.
  const code = jsx.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\/[^\n]*/g, '');
  ok('the banner has no dismiss control', !/dismiss|onClose|setHidden|\u00d7/i.test(code));
  ok('the streak is printed with its year beside it', /streakAsOf/.test(jsx));
  ok('the gaps card disclaims itself in words, not just in a comment',
    /not a suggestion|Nothing here is scored/.test(jsx));

  // Every class the component emits must actually exist in a stylesheet,
  // checked by extracting them rather than by listing them here — a hand-typed
  // list of class names drifts the moment the component changes.
  const used = new Set();
  for (const m of jsx.matchAll(/className="([^"{]+)"/g)) m[1].split(/\s+/).forEach(c => c && used.add(c));
  for (const m of jsx.matchAll(/className=\{`([^`]+)`\}/g)) {
    m[1].replace(/\$\{[^}]*\}/g, ' ').split(/\s+/).forEach(c => c && used.add(c));
  }
  const missing = [...used].filter(c => !new RegExp(`\\.${c.replace(/[-.]/g, '\\$&')}[\\s,.:{>+~]`).test(css));
  ok('every class the component uses is defined in a stylesheet', missing.length === 0, missing.join());

  // Retro idiom, per the standing rule for anything new on this dashboard.
  ok('the sector bar is pixel-rendered like the rest of the arcade',
    /\.dvl-mixbar[\s\S]{0,220}image-rendering:\s*pixelated/.test(css));
  ok('the streak figure carries the neon glow',
    /\.dvl-streak b[^{]*\{[^}]*text-shadow:\s*0 0 \d+px/.test(css));
  ok('the stale banner is dashed rather than solid, per the estimated idiom',
    /\.dvl-stale[^{]*\{[^}]*border:\s*2px dashed/.test(css));
  ok('held rows use a left rail rather than a fill',
    /\.dvl-row\.mine[^{]*\{[^}]*border-left:\s*4px solid/.test(css));
  ok('the table collapses columns on a narrow screen',
    /@media[^{]*max-width:\s*700px[\s\S]{0,600}?\.dvl-row[\s\S]{0,80}?grid-template-columns/.test(css));
}

console.log(`\n${pass}/${pass + fail} passing`);
if (fail) process.exit(1);
