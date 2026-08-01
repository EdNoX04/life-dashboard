// Run: bun tests/earncal.test.js
//
// The earnings calendar is the first money screen where the danger is not
// missing data but a grid that quietly loses some. Five of its six decisions
// are about not dropping rows on the floor, and every one of them fails
// silently — a company in the wrong column, a cell truncated without saying so,
// a Saturday filer that simply never existed. None of those throw. None of them
// look wrong on screen. So they are checked here or they are not checked.
//
// The timezone one is the sharpest. `new Date('2026-08-01')` is midnight UTC,
// which is the 31st of July in Los Angeles and the 1st of August in Delhi, so a
// calendar built through local time puts companies in different columns
// depending on where it is opened. That is not a rounding error, it is a
// different week — and it would pass every test written on the machine that
// built it. So this suite runs the date block twice, once under a UTC-negative
// timezone and once under a UTC-positive one, and requires identical answers.

import fs from 'fs';
import path from 'path';

const here = new URL('.', import.meta.url).pathname;

import {
  num, ymd, parseISO, addDays, dowOf, isWeekend, mondayOf, isoWeek, dayLabel, DOW,
  weekWindow, monthWindow, inMonth,
  SESSIONS, sessionMeta, sessionOf,
  normalise, SCOPES, scopeMeta, inScope, filterRows,
  groupByDay, capCell, weekendRows, countIn,
  surpriseOf, fmtEps, fmtRev, fmtQuarter, EARN_DISCLAIMER,
} from '../src/lib/earncal.js';

let pass = 0, fail = 0;
const bad = [];
const ok = (name, cond, got) => {
  if (cond) pass++;
  else { fail++; bad.push(name); console.log('FAIL', name, got === undefined ? '' : `— ${got}`); }
};

// ---------------------------------------------------------------------------
// Decision 1 — dates. Run as a function so it can be executed under two
// timezones; a single run proves only that the machine it ran on agrees with
// itself.
// ---------------------------------------------------------------------------
function dateBlock(tag) {
  const t = s => `${s} [${tag}]`;

  ok(t('a valid date parses'), parseISO('2026-08-01') instanceof Date);
  ok(t('and round-trips through ymd'), ymd(parseISO('2026-08-01')) === '2026-08-01',
    ymd(parseISO('2026-08-01')));
  // The exact failure the decision is about: the first of a month, which is the
  // date most likely to land in the previous month under a negative offset.
  ok(t('the first of the month stays the first'), ymd(parseISO('2026-08-01')) === '2026-08-01');
  ok(t('the last of the month stays the last'), ymd(parseISO('2026-12-31')) === '2026-12-31');
  ok(t('midnight on new year stays on new year'), ymd(parseISO('2027-01-01')) === '2027-01-01');

  ok(t('rubbish parses to null, not to an Invalid Date'), parseISO('nonsense') === null);
  ok(t('an empty string parses to null'), parseISO('') === null);
  ok(t('undefined parses to null'), parseISO(undefined) === null);
  ok(t('a US-format date is refused rather than guessed at'), parseISO('08/01/2026') === null);
  ok(t('a timestamp is refused'), parseISO(1785600000000) === null);

  ok(t('adding days crosses a month boundary'), addDays('2026-07-31', 1) === '2026-08-01');
  ok(t('and a year boundary'), addDays('2026-12-31', 1) === '2027-01-01');
  ok(t('and goes backwards'), addDays('2026-08-01', -1) === '2026-07-31');
  ok(t('and handles a leap day'), addDays('2028-02-28', 1) === '2028-02-29');
  ok(t('and the day after it'), addDays('2028-02-29', 1) === '2028-03-01');
  ok(t('and a non-leap February'), addDays('2027-02-28', 1) === '2027-03-01');
  ok(t('adding to rubbish returns null'), addDays('nope', 1) === null);

  // Monday is 1 and Sunday is 7. getUTCDay() calls Sunday 0, which puts Sunday
  // at the START of the week in every arithmetic that uses it raw.
  ok(t('Monday is 1'), dowOf('2026-07-13') === 1, String(dowOf('2026-07-13')));
  ok(t('Sunday is 7, not 0'), dowOf('2026-07-19') === 7, String(dowOf('2026-07-19')));
  ok(t('Saturday is 6'), dowOf('2026-07-18') === 6);
  ok(t('Saturday is a weekend'), isWeekend('2026-07-18') === true);
  ok(t('Sunday is a weekend'), isWeekend('2026-07-19') === true);
  ok(t('Friday is not'), isWeekend('2026-07-17') === false);

  ok(t('the Monday of a Wednesday is that week’s Monday'), mondayOf('2026-07-15') === '2026-07-13');
  ok(t('the Monday of a Monday is itself'), mondayOf('2026-07-13') === '2026-07-13');
  // The off-by-a-week. If Sunday were day 0, this would return the NEXT day.
  ok(t('the Monday of a Sunday is six days earlier, not the next day'),
    mondayOf('2026-07-19') === '2026-07-13', mondayOf('2026-07-19'));
  ok(t('the Monday of a Saturday is five days earlier'), mondayOf('2026-07-18') === '2026-07-13');

  ok(t('day labels name the right weekday'), /^Mon /.test(dayLabel('2026-07-13')), dayLabel('2026-07-13'));
  ok(t('and the right day and month'), dayLabel('2026-07-13') === 'Mon 13 Jul', dayLabel('2026-07-13'));
  ok(t('a Sunday label is not off the end of the array'),
    dayLabel('2026-07-19') === 'Sun 19 Jul', dayLabel('2026-07-19'));
  ok(t('an unparseable date labels as empty rather than as NaN'), dayLabel('nope') === '');

  // Decision 6 — ISO weeks. The week containing a date is the week whose
  // THURSDAY shares that date's year, which is why this is not dayOfYear/7. The
  // three cases below are the ones every naive implementation gets wrong.
  ok(t('an ordinary week numbers correctly'), isoWeek('2026-07-13').week === 29,
    JSON.stringify(isoWeek('2026-07-13')));
  ok(t('1 Jan 2026 belongs to week 1 of 2026'),
    isoWeek('2026-01-01').year === 2026 && isoWeek('2026-01-01').week === 1,
    JSON.stringify(isoWeek('2026-01-01')));
  // 1 January 2027 is a Friday, so its week's Thursday is 31 Dec 2026 — that
  // week belongs to 2026, week 53.
  ok(t('1 Jan 2027 belongs to the last week of 2026'),
    isoWeek('2027-01-01').year === 2026 && isoWeek('2027-01-01').week === 53,
    JSON.stringify(isoWeek('2027-01-01')));
  // 31 December 2029 is a Monday; its Thursday is 3 Jan 2030, so it is week 1
  // of 2030 — the mirror of the case above.
  ok(t('31 Dec 2029 belongs to week 1 of 2030'),
    isoWeek('2029-12-31').year === 2030 && isoWeek('2029-12-31').week === 1,
    JSON.stringify(isoWeek('2029-12-31')));
  ok(t('every day of one week shares its week number'),
    new Set(Array.from({ length: 7 }, (_, i) => JSON.stringify(isoWeek(addDays('2026-07-13', i)))).values()).size === 1);
  ok(t('rubbish gives no week rather than week NaN'), isoWeek('nope') === null);

  // The windows, which are where a timezone error would actually surface.
  const w = weekWindow('2026-07-15');
  ok(t('a week window starts on Monday'), w.from === '2026-07-13', w.from);
  ok(t('and ends on Sunday'), w.to === '2026-07-19', w.to);
  ok(t('the grid is Monday to Friday'), w.grid.join() === '2026-07-13,2026-07-14,2026-07-15,2026-07-16,2026-07-17', w.grid.join());
  ok(t('the weekend is the two days the grid has no column for'),
    w.weekend.join() === '2026-07-18,2026-07-19', w.weekend.join());
  // Decision 4's precondition: the FETCH window must span seven days even
  // though the grid draws five, or there is nothing to count.
  ok(t('the fetch window spans seven days, not five'), w.days.length === 7, String(w.days.length));
  ok(t('so the weekend is inside the range that gets requested'),
    w.weekend.every(d => d >= w.from && d <= w.to));

  const next = weekWindow('2026-07-15', 1);
  ok(t('stepping a week forward moves exactly seven days'), next.from === '2026-07-20', next.from);
  ok(t('stepping back moves exactly seven days'), weekWindow('2026-07-15', -1).from === '2026-07-06');
  ok(t('stepping across a year boundary works'), weekWindow('2026-12-30', 1).from === '2027-01-04',
    weekWindow('2026-12-30', 1).from);
  ok(t('a window from rubbish is null, not a window of Invalid Dates'), weekWindow('nope') === null);

  const m = monthWindow('2026-08-15');
  ok(t('a month window names its month'), m.month === 7 && m.year === 2026, `${m.month}/${m.year}`);
  ok(t('and covers the whole calendar month'),
    m.monthFrom === '2026-08-01' && m.monthTo === '2026-08-31', `${m.monthFrom}..${m.monthTo}`);
  ok(t('and starts on a Monday'), dowOf(m.from) === 1, m.from);
  ok(t('and ends on a Sunday'), dowOf(m.to) === 7, m.to);
  ok(t('every row is a whole week'), m.weeks.every(r => r.length === 7));
  ok(t('the rows are contiguous'),
    m.weeks.every((r, i) => i === 0 || r[0] === addDays(m.weeks[i - 1][6], 1)));
  ok(t('the first of the month is inside the window'), m.weeks.flat().includes('2026-08-01'));
  ok(t('and so is the last'), m.weeks.flat().includes('2026-08-31'));
  // The window is deliberately wider than the month, so the screen can grey the
  // spill-over rather than pretend those days belong to August.
  ok(t('spill-over days are outside the month and say so'),
    inMonth('2026-08-01', m) && !inMonth('2026-07-31', m) && !inMonth('2026-09-01', m));
  ok(t('a February month window still works'),
    monthWindow('2028-02-10').monthTo === '2028-02-29', monthWindow('2028-02-10').monthTo);
  ok(t('stepping months forward crosses the year'),
    monthWindow('2026-12-05', 1).month === 0 && monthWindow('2026-12-05', 1).year === 2027);
  ok(t('and backward'), monthWindow('2026-01-05', -1).year === 2025);
  ok(t('a month window from rubbish is null'), monthWindow('nope') === null);
}

// The two-timezone run. Delhi is UTC+5:30 and Los Angeles is UTC−7/8; a date
// built through local time lands on different days in the two, so identical
// answers here is the actual proof the decision was kept.
{
  const before = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles';
  dateBlock('UTC−8');
  process.env.TZ = 'Asia/Kolkata';
  dateBlock('UTC+5:30');
  // And a direct check that nothing in the module reads local time at all: the
  // same window computed under both must be byte-identical.
  process.env.TZ = 'America/Los_Angeles';
  const a = JSON.stringify(weekWindow('2026-08-01'));
  process.env.TZ = 'Asia/Kolkata';
  const b = JSON.stringify(weekWindow('2026-08-01'));
  ok('the same week window is identical in Los Angeles and Delhi', a === b, `${a}\n${b}`);
  const ma = (process.env.TZ = 'America/Los_Angeles', JSON.stringify(monthWindow('2026-08-01')));
  const mb = (process.env.TZ = 'Asia/Kolkata', JSON.stringify(monthWindow('2026-08-01')));
  ok('and so is the same month window', ma === mb);
  if (before === undefined) delete process.env.TZ; else process.env.TZ = before;
}

// ---------------------------------------------------------------------------
// num — the fifth copy of the guard, and on this screen a coerced zero is an
// EPS estimate of zero dollars, which is a real and different claim from
// "no analyst estimate".
// ---------------------------------------------------------------------------
{
  ok('zero is a number', num(0) === 0);
  ok('and is not confused with absence', num(0) !== num(null));
  ok('null is null', num(null) === null);
  ok('undefined is null', num(undefined) === null);
  ok('an empty string is null, not zero', num('') === null);
  ok('whitespace is null, not zero', num('   ') === null);
  ok('false is null, not zero', num(false) === null);
  ok('true is null, not one', num(true) === null);
  ok('a numeric string is a number', num('1.25') === 1.25);
  ok('a negative EPS survives', num('-0.42') === -0.42);
  ok('NaN is null', num(NaN) === null);
  ok('Infinity is null', num(Infinity) === null);
  ok('a non-numeric string is null', num('n/a') === null);
}

// ---------------------------------------------------------------------------
// Decision 2 — four sessions, not two. The reference screen has two rows, so a
// build that copies it has to put 'dmh' somewhere, and either choice is a false
// statement about when a company reported. An empty string is worse: folding it
// into "before open" invents a fact the feed explicitly did not supply.
// ---------------------------------------------------------------------------
{
  ok('there are four sessions', SESSIONS.length === 4, String(SESSIONS.length));
  ok('every session has a key, a label and a note',
    SESSIONS.every(s => s.key && s.label && s.note && s.note.length > 20));
  ok('bmo is recognised', sessionOf({ hour: 'bmo' }) === 'bmo');
  ok('amc is recognised', sessionOf({ hour: 'amc' }) === 'amc');
  ok('during-hours gets its own bucket', sessionOf({ hour: 'dmh' }) === 'dmh');
  // The four ways the feed says "I do not know", none of which mean before open.
  for (const [name, v] of [['an empty string', ''], ['whitespace', '  '],
    ['a missing field', undefined], ['null', null], ['something unexpected', 'xyz']]) {
    ok(`${name} becomes 'unk', never 'bmo'`, sessionOf({ hour: v }) === 'unk', sessionOf({ hour: v }));
  }
  ok('a missing row entirely is unk, not a throw', sessionOf(undefined) === 'unk');
  ok('case does not matter', sessionOf({ hour: 'BMO' }) === 'bmo');
  ok('surrounding space does not matter', sessionOf({ hour: ' amc ' }) === 'amc');
  ok('the unknown session says outright it is not "before open"',
    /not the same as/i.test(sessionMeta('unk').note), sessionMeta('unk').note);
  ok('an unknown key falls back to the unknown session, not to bmo',
    sessionMeta('zzz').key === 'unk', sessionMeta('zzz').key);
  ok('sessionMeta survives no argument', sessionMeta().key === 'unk');
}

// ---------------------------------------------------------------------------
// normalise. Decision 5 lives here: an estimate and a result are different
// fields and are never merged into one "eps".
// ---------------------------------------------------------------------------
const RAW = [
  { symbol: 'msft', date: '2026-07-16', hour: 'amc', epsEstimate: 3.1, epsActual: 3.4, revenueEstimate: 64e9, revenueActual: 65.2e9, quarter: 4, year: 2026 },
  { symbol: 'AAPL', date: '2026-07-14', hour: 'bmo', epsEstimate: 1.55, epsActual: null, revenueEstimate: 89e9, quarter: 3, year: 2026 },
  { symbol: 'NVDA', date: '2026-07-14', hour: '', epsEstimate: 0, epsActual: 0.02 },
  { symbol: 'TSLA', date: '2026-07-18', hour: 'dmh', epsEstimate: 0.9 },       // a Saturday
  { symbol: 'AMD', date: '2026-07-15', hour: 'bmo', epsEstimate: -0.20, epsActual: -0.10 },
  { symbol: '', date: '2026-07-15', hour: 'bmo' },                              // no symbol
  { symbol: 'BAD', date: '15/07/2026', hour: 'bmo' },                           // unusable date
  { symbol: 'ALSOBAD', hour: 'bmo' },                                           // no date
  null,
];

{
  const rows = normalise(RAW);
  ok('unusable rows are dropped', rows.length === 5, String(rows.length));
  ok('a row with no symbol is dropped', !rows.some(r => r.symbol === ''));
  ok('a row with an unparseable date is dropped', !rows.some(r => r.symbol === 'BAD'));
  ok('a row with no date is dropped', !rows.some(r => r.symbol === 'ALSOBAD'));
  ok('a null row does not throw', true);
  ok('symbols are upper-cased', rows.some(r => r.symbol === 'MSFT'));
  ok('rows are sorted by date', rows.every((r, i) => i === 0 || rows[i - 1].date <= r.date),
    rows.map(r => r.date).join(' '));
  ok('and by symbol within a date',
    rows.filter(r => r.date === '2026-07-14').map(r => r.symbol).join() === 'AAPL,NVDA');

  // That assertion above cannot actually fail, and the reason is worth writing
  // down. AAPL already precedes NVDA in RAW, and Array.prototype.sort is stable,
  // so deleting the symbol tiebreak entirely leaves the input order intact and
  // the line still passes. It asserts a coincidence, not a property \u2014 the same
  // trap as ranking on a rounded figure and never checking the sort key.
  //
  // The property matters because the feed does not promise an order. The same
  // week fetched twice can hand back a day's companies in different sequence,
  // and without a tiebreak the tickers inside a cell would silently reshuffle
  // on every refresh \u2014 a screen that looks broken while being arithmetically
  // correct. So the tie is fed in DESCENDING order here, where only a real
  // comparator can put it right.
  const tied = normalise([
    { symbol: 'ZS', date: '2026-07-20', hour: 'bmo' },
    { symbol: 'MSFT', date: '2026-07-20', hour: 'bmo' },
    { symbol: 'aapl', date: '2026-07-20', hour: 'amc' },
  ]);
  ok('a same-day tie is ordered by symbol even when fed in reverse',
    tied.map(r => r.symbol).join() === 'AAPL,MSFT,ZS', tied.map(r => r.symbol).join());
  ok('and the tie really was fed out of order, so that proved a comparator',
    ['ZS', 'MSFT', 'AAPL'].join() !== tied.map(r => r.symbol).join());
  // Ordering across days still beats ordering within one.
  const mixed = normalise([
    { symbol: 'ZS', date: '2026-07-19', hour: 'bmo' },
    { symbol: 'AAPL', date: '2026-07-20', hour: 'bmo' },
  ]);
  ok('the date is the primary key and the symbol only breaks ties',
    mixed.map(r => r.symbol).join() === 'ZS,AAPL', mixed.map(r => r.symbol).join());

  const aapl = rows.find(r => r.symbol === 'AAPL');
  ok('an estimate and a result are separate fields',
    'epsEst' in aapl && 'epsAct' in aapl && !('eps' in aapl), Object.keys(aapl).join(','));
  ok('a not-yet-reported result is null, not the estimate',
    aapl.epsAct === null && aapl.epsEst === 1.55, `${aapl.epsAct}/${aapl.epsEst}`);
  ok('revenue is likewise two fields',
    'revEst' in aapl && 'revAct' in aapl && !('rev' in aapl));
  const msft = rows.find(r => r.symbol === 'MSFT');
  ok('a reported row carries both figures', msft.epsEst === 3.1 && msft.epsAct === 3.4);
  const nvda = rows.find(r => r.symbol === 'NVDA');
  ok('an estimate of exactly zero survives as zero, not as absent', nvda.epsEst === 0);
  ok('and a blank session becomes unk', nvda.session === 'unk');
  ok('a missing quarter is null rather than zero', nvda.quarter === null);

  ok('normalise survives no argument', normalise().length === 0);
  ok('and an empty array', normalise([]).length === 0);
  ok('and an array of nothing but rubbish', normalise([null, undefined, 0, '', {}]).length === 0);
}

// ---------------------------------------------------------------------------
// Scopes. The failure here is quiet: a case-mismatched ticker means a company
// the user holds silently drops out of "My portfolio".
// ---------------------------------------------------------------------------
{
  const rows = normalise(RAW);
  ok('there are three scopes', SCOPES.length === 3);
  ok('each explains itself', SCOPES.every(s => s.note && s.note.length > 15));
  ok('the all-stocks note warns that cells are capped', /capped/.test(scopeMeta('all').note));
  ok('an unknown scope falls back to portfolio, the narrowest',
    scopeMeta('zzz').key === 'port', scopeMeta('zzz').key);

  ok('all-stocks keeps everything', filterRows(rows, 'all', [], []).length === rows.length);
  ok('portfolio keeps only what is held',
    filterRows(rows, 'port', ['AAPL', 'MSFT'], []).map(r => r.symbol).join() === 'AAPL,MSFT');
  ok('watchlist keeps only what is watched',
    filterRows(rows, 'watch', [], ['NVDA']).map(r => r.symbol).join() === 'NVDA');
  // The quiet one.
  ok('a lower-case holding still matches',
    filterRows(rows, 'port', ['aapl'], []).length === 1,
    String(filterRows(rows, 'port', ['aapl'], []).length));
  ok('a holding with surrounding rubbish does not throw',
    filterRows(rows, 'port', [null, undefined, ''], []).length === 0);
  ok('an empty portfolio yields nothing rather than everything',
    filterRows(rows, 'port', [], []).length === 0);
  ok('filterRows survives no arguments', filterRows().length === 0);
}

// ---------------------------------------------------------------------------
// Grouping, and decision 3 — an overflow count is a promise about what is
// behind it. `hidden` is the ROWS, not just how many, so a caller that only
// prints the count cannot accidentally lose them.
// ---------------------------------------------------------------------------
{
  const rows = normalise(RAW);
  const g = groupByDay(rows);
  ok('every date in the data has a bucket', Object.keys(g).length === 4, Object.keys(g).join(' '));
  ok('every bucket has all four sessions',
    Object.values(g).every(d => d.bmo && d.amc && d.dmh && d.unk));
  ok('and a count', Object.values(g).every(d => Number.isInteger(d.n)));
  ok('the counts sum to the row count',
    Object.values(g).reduce((s, d) => s + d.n, 0) === rows.length);
  ok('no row is lost between the sessions',
    Object.values(g).reduce((s, d) => s + d.bmo.length + d.amc.length + d.dmh.length + d.unk.length, 0)
      === rows.length);
  ok('a during-hours row lands in its own bucket, not folded elsewhere',
    g['2026-07-18'].dmh.length === 1 && g['2026-07-18'].bmo.length === 0);
  ok('an unstated session lands in unk', g['2026-07-14'].unk.some(r => r.symbol === 'NVDA'));
  ok('groupByDay survives no argument', Object.keys(groupByDay()).length === 0);

  const many = Array.from({ length: 150 }, (_, i) => ({ symbol: `S${i}` }));
  const c = capCell(many, 6);
  ok('a capped cell shows the cap', c.shown.length === 6, String(c.shown.length));
  ok('and reports the total', c.total === 150, String(c.total));
  ok('and reports how many more', c.more === 144, String(c.more));
  // The whole decision: the hidden ROWS come back, so no caller can truncate
  // without receiving what it truncated.
  ok('and returns the hidden rows themselves, not just the count',
    Array.isArray(c.hidden) && c.hidden.length === 144, String(c.hidden.length));
  ok('shown plus hidden reconstructs the input exactly',
    [...c.shown, ...c.hidden].map(r => r.symbol).join() === many.map(r => r.symbol).join());
  ok('the count and the hidden rows agree', c.more === c.hidden.length);

  const small = capCell([{ symbol: 'A' }, { symbol: 'B' }], 6);
  ok('an uncapped cell reports zero more', small.more === 0);
  ok('and an empty hidden array rather than null', Array.isArray(small.hidden) && small.hidden.length === 0);
  ok('a cell exactly at the cap is not truncated', capCell(many.slice(0, 6), 6).more === 0);
  ok('one over the cap reports exactly one more', capCell(many.slice(0, 7), 6).more === 1);
  ok('capCell survives no argument', capCell().total === 0);
  ok('and an empty list', capCell([]).shown.length === 0);

  // The page size is stated TWICE \u2014 once as capCell's own `cap = 6` and once
  // as Cell's `cap = 6` in EarningsCal.jsx \u2014 and every assertion above passes
  // 6 explicitly, so the 6 in this file was a transcription of the source
  // rather than a check on it. Raising capCell's default to 60 changed nothing
  // and no test noticed, which is the definition of an untested default.
  //
  // Two things are worth pinning. First, that the default truncates at all:
  // every <Cell> in the week grid omits the prop, so a default that stops
  // capping puts a hundred and fifty tickers in one square. Second, that the
  // two defaults agree \u2014 they are in different files and nothing forces them
  // to move together, so a reader of either one can currently infer the wrong
  // page size for the other.
  const dflt = capCell(many);
  ok('the default cap truncates rather than showing everything',
    dflt.shown.length < many.length, `${dflt.shown.length} of ${many.length}`);
  ok('and it is the same page size the grid asks for explicitly',
    dflt.shown.length === 6, String(dflt.shown.length));
  ok('the default still hands back what it hid',
    dflt.hidden.length === many.length - dflt.shown.length && dflt.more === dflt.hidden.length,
    String(dflt.hidden.length));

  const CELLSRC = fs.readFileSync(path.join(here, '../src/components/money/EarningsCal.jsx'), 'utf8');
  const cellDefault = /export function Cell\(\{ list, cap = (\d+)/.exec(CELLSRC);
  ok('the grid cell states a default page size', cellDefault != null,
    cellDefault && cellDefault[0]);
  ok('and it agrees with the one capCell would have used',
    cellDefault && Number(cellDefault[1]) === dflt.shown.length,
    cellDefault && `Cell ${cellDefault[1]} vs capCell ${dflt.shown.length}`);
  // And the reason that agreement matters: the grid renders Cell without the
  // prop, so this really is the path a first-open takes.
  ok('the week grid does render cells without an explicit cap',
    /<Cell list=\{d\.bmo\} pick=/.test(CELLSRC));
}

// ---------------------------------------------------------------------------
// Decision 4 — a weekend row is COUNTED even though there is no column for it.
// Companies do occasionally file on a Saturday, and the honest version of
// "nowhere to draw them" is a line under the grid, not a filter that makes them
// never have existed.
// ---------------------------------------------------------------------------
{
  const rows = normalise(RAW);
  const w = weekWindow('2026-07-15');
  const wk = weekendRows(rows, w);
  ok('a Saturday filer is found', wk.length === 1 && wk[0].symbol === 'TSLA',
    wk.map(r => r.symbol).join());
  ok('and is NOT in the Monday–Friday grid', countIn(rows, w.grid) === 4,
    String(countIn(rows, w.grid)));
  // The arithmetic that proves nothing was dropped: grid + weekend = the week.
  ok('grid plus weekend accounts for every row in the week',
    countIn(rows, w.grid) + wk.length === countIn(rows, w.days),
    `${countIn(rows, w.grid)} + ${wk.length} vs ${countIn(rows, w.days)}`);
  ok('a month window has no weekend list, because it draws all seven days',
    weekendRows(rows, monthWindow('2026-07-15')).length === 0);
  ok('weekendRows survives no window', weekendRows(rows, null).length === 0);
  ok('and no rows', weekendRows(null, w).length === 0);
  ok('countIn survives no arguments', countIn() === 0);
  ok('and counts nothing for an empty day list', countIn(rows, []) === 0);
}

// ---------------------------------------------------------------------------
// Decision 5 again — the surprise is computed only when BOTH figures exist. A
// tile that shows whichever one is present is a tile whose meaning changes
// silently on the morning of the report.
// ---------------------------------------------------------------------------
{
  ok('no result yet means not reported',
    surpriseOf({ epsEst: 1.5, epsAct: null }).state === 'not_reported');
  ok('and carries no percentage to print',
    surpriseOf({ epsEst: 1.5, epsAct: null }).pct === undefined);
  ok('a result with no estimate says so rather than computing against zero',
    surpriseOf({ epsEst: null, epsAct: 1.2 }).state === 'no_estimate');
  ok('and still reports the actual', surpriseOf({ epsEst: null, epsAct: 1.2 }).actual === 1.2);

  const beat = surpriseOf({ epsEst: 3.1, epsAct: 3.4 });
  ok('a beat is a beat', beat.state === 'ok' && beat.beat === true);
  ok('the absolute surprise is the difference', Math.abs(beat.abs - 0.3) < 1e-9, String(beat.abs));
  ok('and the percentage is against the estimate',
    Math.abs(beat.pct - (0.3 / 3.1) * 100) < 1e-9, String(beat.pct));

  const miss = surpriseOf({ epsEst: 3.1, epsAct: 2.9 });
  ok('a miss is a miss', miss.beat === false && miss.pct < 0);
  ok('meeting exactly counts as a beat, not a miss',
    surpriseOf({ epsEst: 3, epsAct: 3 }).beat === true);

  // The absolute-base divide. A company expected to lose $1 that lost $0.50 BEAT
  // the estimate; dividing by −1 prints that beat as a negative surprise.
  const neg = surpriseOf({ epsEst: -1, epsAct: -0.5 });
  ok('a smaller-than-expected loss is a beat', neg.beat === true);
  ok('and its percentage is positive', neg.pct > 0, String(neg.pct));
  ok('and equals the difference over the absolute estimate',
    Math.abs(neg.pct - 50) < 1e-9, String(neg.pct));
  const worse = surpriseOf({ epsEst: -1, epsAct: -1.5 });
  ok('a larger-than-expected loss is a miss', worse.beat === false && worse.pct < 0, String(worse.pct));

  // A zero estimate has no percentage — the division is undefined and printing
  // Infinity% would be worse than printing nothing.
  const zero = surpriseOf({ epsEst: 0, epsAct: 0.02 });
  ok('a zero estimate is its own state', zero.state === 'base_zero', zero.state);
  ok('and reports the absolute difference', Math.abs(zero.abs - 0.02) < 1e-9);
  ok('and no percentage at all', zero.pct === undefined, String(zero.pct));
  ok('surpriseOf survives no argument', surpriseOf().state === 'not_reported');
  ok('and a row of nulls', surpriseOf({ epsEst: null, epsAct: null }).state === 'not_reported');
  ok('no state ever produces NaN',
    [{ epsEst: 0, epsAct: 0 }, { epsEst: NaN, epsAct: 1 }, { epsEst: 1, epsAct: NaN }]
      .every(r => { const s = surpriseOf(r); return !Object.values(s).some(v => typeof v === 'number' && Number.isNaN(v)); }));
}

// ---------------------------------------------------------------------------
// Formatting. Two feeds, two units — revenue arrives here in RAW currency units
// while the financials screen gets millions, and this is one of the two places
// that conversion is written down.
// ---------------------------------------------------------------------------
{
  ok('an absent EPS is a dash, not zero', fmtEps(null) === '—');
  ok('an empty string is a dash', fmtEps('') === '—');
  ok('zero prints as zero', fmtEps(0) === '$0.00', fmtEps(0));
  ok('two decimals always', fmtEps(1.5) === '$1.50', fmtEps(1.5));
  ok('a negative uses a real minus sign before the symbol',
    fmtEps(-0.42) === '−$0.42', fmtEps(-0.42));
  ok('the currency is injectable', fmtEps(1.5, '₹') === '₹1.50', fmtEps(1.5, '₹'));

  ok('an absent revenue is a dash', fmtRev(null) === '—');
  ok('trillions', fmtRev(1.234e12) === '$1.23T', fmtRev(1.234e12));
  ok('billions', fmtRev(65.2e9) === '$65.20B', fmtRev(65.2e9));
  ok('millions', fmtRev(4.5e6) === '$4.5M', fmtRev(4.5e6));
  ok('thousands', fmtRev(4500) === '$4.5K', fmtRev(4500));
  ok('and raw units below that', fmtRev(999) === '$999', fmtRev(999));
  ok('a negative revenue keeps its sign', fmtRev(-1e9) === '−$1.00B', fmtRev(-1e9));
  ok('zero revenue prints as zero, not as a dash', fmtRev(0) === '$0', fmtRev(0));
  // The unit trap: this feed sends raw units, so 65200 is sixty-five thousand,
  // NOT sixty-five billion. If someone applies the financials screen's millions
  // convention here, this is the assertion that catches it.
  ok('raw units are read as raw units, not as millions',
    fmtRev(65200) === '$65.2K', fmtRev(65200));

  ok('a quarter prints when both parts are known', fmtQuarter({ quarter: 4, year: 2026 }) === 'Q4 2026');
  ok('and is empty when either is missing', fmtQuarter({ quarter: 4 }) === '' && fmtQuarter({ year: 2026 }) === '');
  ok('and survives no argument', fmtQuarter() === '');
}

// ---------------------------------------------------------------------------
// The disclaimer. It has one job the tests can check: to say that a company
// missing from a day is missing from the FEED, not necessarily silent — which
// is the specific wrong inference this screen invites.
// ---------------------------------------------------------------------------
{
  ok('the disclaimer names the provider as the source', /provider/i.test(EARN_DISCLAIMER));
  ok('and says a missing company may not be a silent one',
    /not\s+necessarily silent/i.test(EARN_DISCLAIMER.replace(/\s+/g, ' ')), EARN_DISCLAIMER);
  ok('and that estimates are analysts’, not forecasts made here',
    /analysts/i.test(EARN_DISCLAIMER) && /not forecasts made here/i.test(EARN_DISCLAIMER));
  ok('and that nothing here is advice', /not.*investment advice|nothing.*is investment advice/i.test(EARN_DISCLAIMER));
}

// ---------------------------------------------------------------------------
// The end-to-end property, and the one that would catch a dropped row anywhere
// in the chain: for any window, every normalised row inside it is reachable
// through the grid, the weekend list, or an overflow's hidden rows.
// ---------------------------------------------------------------------------
{
  const bulk = normalise(Array.from({ length: 400 }, (_, i) => ({
    symbol: `S${i}`,
    date: addDays('2026-07-13', i % 7),
    hour: ['bmo', 'amc', 'dmh', ''][i % 4],
    epsEstimate: (i % 5) - 2,
    epsActual: i % 3 === 0 ? (i % 5) - 1 : null,
  })));
  const w = weekWindow('2026-07-15');
  const g = groupByDay(bulk);

  let reached = 0;
  for (const day of w.grid) {
    const cell = g[day];
    if (!cell) continue;
    for (const s of ['bmo', 'amc', 'dmh', 'unk']) {
      const c = capCell(cell[s], 6);
      reached += c.shown.length + c.hidden.length;
    }
  }
  reached += weekendRows(bulk, w).length;
  ok('every row in the week is reachable through the grid, the caps, or the weekend line',
    reached === bulk.length, `${reached} of ${bulk.length}`);
  ok('and the caps really did truncate something, so this proved a real path',
    w.grid.some(d => g[d] && ['bmo', 'amc', 'dmh', 'unk'].some(s => capCell(g[d][s], 6).more > 0)));
  ok('and the weekend line really did catch something',
    weekendRows(bulk, w).length > 0, String(weekendRows(bulk, w).length));
}

console.log(`\n${pass}/${pass + fail} passing`);
if (fail) { console.log('\nfailing:\n  ' + bad.join('\n  ')); process.exit(1); }
