// Tests for the ex-dividend / record-date arithmetic.
//
// These dates are the only ones on the dividend screen that are a DEADLINE
// rather than a diary entry, and they are off-by-one traps in both directions.
// Get the record date wrong and the calendar is cosmetically odd. Get the buy
// deadline wrong by one day and the user buys a share on the ex-date believing
// they are entitled to a payment they will not receive — a mistake that costs
// real money and produces no error anywhere.
//
// The settlement rule is also a moving target: India went T+1 in January 2023
// and the US in May 2024, and most explanations still in circulation describe
// T+3. So the relationship between ex and record is pinned here explicitly for
// each cycle rather than being left as whatever the code happens to do.
//
// Run: bun tests/exdiv.test.js
import {
  recordDateFor, lastBuyDate, paymentsForYear, exWatch, normaliseEntry, calendarForYear,
} from '../src/lib/dividends.js';

let pass = 0, fail = 0;
function ok(what, cond, got) {
  if (cond) { pass++; }
  else { fail++; console.log(`FAIL: ${what}${got !== undefined ? `  (got ${got})` : ''}`); }
}
const dow = s => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(`${s}T00:00:00`).getDay()];

// Anchors, hand-checked against a 2026 calendar rather than computed, so the
// suite cannot agree with a broken helper by using it to build its own fixture.
ok('2026-03-06 is a Friday', dow('2026-03-06') === 'Fri', dow('2026-03-06'));
ok('2026-03-09 is a Monday', dow('2026-03-09') === 'Mon', dow('2026-03-09'));

// ------------------------------------------------------------ recordDateFor
{
  // The headline rule. Under T+1 there is no gap at all — this is the one most
  // often written down wrongly, and it is a single equality.
  ok('T+1: the record date IS the ex-date',
    recordDateFor('2026-03-04', 1) === '2026-03-04', recordDateFor('2026-03-04', 1));
  ok('T+1: still true across a weekend boundary',
    recordDateFor('2026-03-06', 1) === '2026-03-06', recordDateFor('2026-03-06', 1));

  // T+2 adds exactly one TRADING day, which is not the same as one calendar day
  // for a third of the ex-dates in a year.
  ok('T+2: record is one trading day after ex, mid-week',
    recordDateFor('2026-03-04', 2) === '2026-03-05', recordDateFor('2026-03-04', 2));
  ok('T+2: a Friday ex-date pushes the record date to Monday, not Saturday',
    recordDateFor('2026-03-06', 2) === '2026-03-09', recordDateFor('2026-03-06', 2));
  ok('T+3: two trading days, so a Thursday ex-date lands on Monday',
    recordDateFor('2026-03-05', 3) === '2026-03-09', recordDateFor('2026-03-05', 3));

  // A record date should never be published on a day the register is not read.
  for (const ex of ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06']) {
    for (const c of [1, 2, 3]) {
      const r = recordDateFor(ex, c);
      ok(`T+${c} from ${ex} lands on a weekday`, dow(r) !== 'Sat' && dow(r) !== 'Sun', `${r} (${dow(r)})`);
      ok(`T+${c} from ${ex} is never before the ex-date`, r >= ex, r);
    }
  }

  // A weekend ex-date is a data-entry artefact; normalise forward rather than
  // returning a date the market is shut on.
  ok('a Saturday ex-date normalises forward to Monday',
    recordDateFor('2026-03-07', 1) === '2026-03-09', recordDateFor('2026-03-07', 1));

  ok('garbage in gives null, not an Invalid Date string', recordDateFor('', 1) === null);
  ok('and so does a nonsense date', recordDateFor('not-a-date', 1) === null);
  // The upper clamp belongs to normaliseEntry (asserted below), NOT here.
  // recordDateFor is plain arithmetic and stays honest for any cycle: T+5 was a
  // real settlement regime and a helper that silently answered T+3 for it would
  // be lying to the only caller who had a reason to ask. 2026-03-04 is a
  // Wednesday, so T+5 steps four trading days to the following Tuesday.
  ok('an out-of-range cycle is computed honestly, not clamped',
    recordDateFor('2026-03-04', 5) === '2026-03-10', recordDateFor('2026-03-04', 5));
  // Only the bottom is clamped, and it is clamped by the arithmetic itself:
  // settleDays-1 days of stepping cannot go negative.
  ok('a zero cycle is clamped up to T+1',
    recordDateFor('2026-03-04', 0) === '2026-03-04', recordDateFor('2026-03-04', 0));
}

// -------------------------------------------------------------- lastBuyDate
{
  ok('the last day to buy is the trading day before the ex-date',
    lastBuyDate('2026-03-04') === '2026-03-03', lastBuyDate('2026-03-04'));
  // The expensive one. A Monday ex-date means the deadline was FRIDAY, and
  // "ex minus one calendar day" would say Sunday — a day nobody can trade on,
  // which reads as "you still have until the weekend".
  ok('a Monday ex-date has its deadline on the previous Friday',
    lastBuyDate('2026-03-09') === '2026-03-06', lastBuyDate('2026-03-09'));
  ok('the deadline is always strictly before the ex-date',
    ['2026-03-02', '2026-03-04', '2026-03-09', '2026-01-01'].every(e => lastBuyDate(e) < e));
  ok('and never lands on a weekend',
    ['2026-03-02', '2026-03-04', '2026-03-09', '2026-06-15'].every(e => {
      const d = dow(lastBuyDate(e));
      return d !== 'Sat' && d !== 'Sun';
    }));
  ok('a bad date gives null', lastBuyDate(null) === null);
}

// -------------------------------------------------- the dates on a payment
const ENTRY = { perShare: 5, freq: 'quarterly', anchorMonth: 0, payDay: 20, exOffsetDays: 14, baseYear: 2026 };
{
  const pays = paymentsForYear('AAA', ENTRY, 100, 2026);
  ok('a quarterly schedule still produces four payments', pays.length === 4, pays.length);
  ok('every payment carries a record date', pays.every(p => !!p.record));
  ok('every payment carries a buy deadline', pays.every(p => !!p.lastBuy));

  // The ordering invariant, asserted over every generated payment rather than
  // one sample: this is the property the whole card depends on being true.
  ok('buy deadline < ex <= record <= pay, on every payment',
    pays.every(p => p.lastBuy < p.ex && p.ex <= p.record && p.record <= p.pay),
    JSON.stringify(pays.map(p => [p.lastBuy, p.ex, p.record, p.pay]).find(
      ([b, e, r, y]) => !(b < e && e <= r && r <= y))));
  ok('the default cycle is T+1, so record equals ex',
    pays.every(p => p.record === p.ex));

  const t2 = paymentsForYear('AAA', { ...ENTRY, settleDays: 2 }, 100, 2026);
  ok('under T+2 the record date moves off the ex-date on every payment',
    t2.every(p => p.record > p.ex), JSON.stringify(t2.map(p => [p.ex, p.record])));
  ok('and the ex-dates themselves are unchanged by the settlement cycle',
    t2.map(p => p.ex).join() === pays.map(p => p.ex).join());

  ok('normaliseEntry defaults settleDays to 1', normaliseEntry({}).settleDays === 1);
  ok('and clamps a silly value', normaliseEntry({ settleDays: 40 }).settleDays === 3);
}

// A declared payment may carry its own record date off the announcement, and
// that must beat the derived one — the point of a declaration is that it is not
// a guess.
{
  const declared = paymentsForYear('BBB', {
    ...ENTRY,
    declared: [{ pay: '2026-04-20', ex: '2026-04-06', record: '2026-04-08', perShare: 7 }],
  }, 100, 2026);
  const p = declared.find(x => x.month === 3);
  ok('a declared payment is marked declared', p.status === 'declared', p.status);
  ok('an announced record date is used verbatim, not recomputed',
    p.record === '2026-04-08', p.record);
  ok('while the buy deadline is still derived from the announced ex-date',
    p.lastBuy === '2026-04-03', p.lastBuy);
  ok('a declared payment without a record date falls back to the derivation',
    paymentsForYear('CCC', { ...ENTRY, declared: [{ pay: '2026-04-20', ex: '2026-04-06' }] }, 100, 2026)
      .find(x => x.month === 3).record === '2026-04-06');
  // Off-cycle specials go through a third code path in paymentsForYear, and it
  // is the one most likely to be forgotten when a field is added.
  const special = paymentsForYear('DDD', {
    ...ENTRY, declared: [{ pay: '2026-02-11', ex: '2026-02-02', perShare: 3 }],
  }, 100, 2026).find(x => x.special);
  ok('an off-cycle special payment also carries both dates',
    !!special && !!special.record && !!special.lastBuy, JSON.stringify(special));
}

// ------------------------------------------------------------------ exWatch
{
  const TODAY = new Date('2026-03-01T00:00:00');
  const pays = paymentsForYear('AAA', { ...ENTRY, anchorMonth: 2, payDay: 25 }, 100, 2026);
  const w = exWatch(pays, { today: TODAY, withinDays: 60 });

  ok('the watch returns only rows inside the window',
    w.every(r => r.daysToEx <= 60), JSON.stringify(w.map(r => r.daysToEx)));
  ok('and it is sorted by ex-date, not by payment date',
    w.every((r, i) => i === 0 || r.ex >= w[i - 1].ex), JSON.stringify(w.map(r => r.ex)));
  ok('every row reports days to each of the four dates',
    w.every(r => [r.daysToEx, r.daysToBuy, r.daysToRecord, r.daysToPay].every(Number.isFinite)));
  ok('days-to-buy is always fewer than days-to-ex',
    w.every(r => r.daysToBuy < r.daysToEx));

  // Phases. Each is constructed from a hand-written payment rather than fished
  // out of the generated set, so a change in the generator cannot quietly turn
  // one case into another and leave the assertion passing on the wrong row.
  const mk = (ex, pay) => ({ ticker: 'Z', month: 0, ex, pay, record: ex, lastBuy: lastBuyDate(ex), amount: 10, status: 'declared' });
  const phase = ex => exWatch([mk(ex, '2026-04-20')], { today: TODAY })[0]?.phase;
  ok('an ex-date comfortably ahead is open', phase('2026-03-20') === 'open', phase('2026-03-20'));
  ok('an ex-date whose buy deadline has passed is closing', phase('2026-03-02') === 'closing', phase('2026-03-02'));
  ok('an ex-date already gone through is entitled', phase('2026-02-27') === 'entitled', phase('2026-02-27'));

  // The boundary itself, stated separately: on the buy-by date you can still
  // buy. Off-by-one here is the expensive direction — it would grey out a row
  // on the one morning it was still actionable. 2026-03-05 is a Thursday and
  // 2026-03-06 a Friday, so lastBuy lands exactly on that Thursday.
  {
    const THU = new Date('2026-03-05T00:00:00');
    const row = exWatch([mk('2026-03-06', '2026-03-25')], { today: THU })[0];
    ok('the buy-by date itself is hand-checked as today', row.daysToBuy === 0, String(row.daysToBuy));
    ok('a deadline landing today is still open, not closing', row.phase === 'open', row.phase);
  }

  // The sort key, pinned against the case that is the entire reason the watch
  // exists: a payment months out whose buy deadline is this week must outrank a
  // payment arriving next week whose ex-date has already gone. Ordering by pay
  // date would invert exactly this pair, and the generated calendar above cannot
  // show it because there ex-order and pay-order happen to agree.
  // The tickers are chosen so alphabetical order OPPOSES the expected order:
  // otherwise a sort that had quietly collapsed to the ticker tie-break alone
  // would still produce the right answer here and the check would prove nothing.
  const crossed = exWatch([
    { ...mk('2026-03-25', '2026-03-28'), ticker: 'ACME' },   // pays first, ex last
    { ...mk('2026-03-04', '2026-06-30'), ticker: 'ZEBRA' },  // pays last, ex first
  ], { today: TODAY, withinDays: 60 });
  ok('a distant payment with an imminent ex-date sorts first',
    crossed.map(r => r.ticker).join() === 'ZEBRA,ACME', crossed.map(r => r.ticker).join());

  // The window edges, both of them, because "recently passed rows stay" is a
  // deliberate choice and an easy one to silently drop.
  ok('a payment just outside the forward window is excluded',
    exWatch([mk('2026-05-01', '2026-05-20')], { today: TODAY, withinDays: 30 }).length === 0);
  ok('a payment just inside it is included',
    exWatch([mk('2026-03-20', '2026-04-20')], { today: TODAY, withinDays: 30 }).length === 1);
  ok('an ex-date that passed within the grace period is kept',
    exWatch([mk('2026-02-27', '2026-03-20')], { today: TODAY, includePassed: 3 }).length === 1);
  ok('an ex-date long past is dropped',
    exWatch([mk('2026-02-01', '2026-02-20')], { today: TODAY, includePassed: 3 }).length === 0);
  ok('a payment with no ex-date is skipped rather than crashing',
    exWatch([{ ticker: 'Z', pay: '2026-03-10', amount: 1 }], { today: TODAY }).length === 0);
  ok('an empty book gives an empty watch', exWatch([], { today: TODAY }).length === 0);

  // Ordering across tickers has to be stable, or the list reshuffles on every
  // render for no visible reason.
  const two = exWatch([{ ...mk('2026-03-10', '2026-03-25'), ticker: 'ZZZ' }, { ...mk('2026-03-10', '2026-03-25'), ticker: 'AAA' }], { today: TODAY });
  ok('rows sharing an ex-date break the tie on ticker',
    two.map(r => r.ticker).join() === 'AAA,ZZZ', two.map(r => r.ticker).join());
}

// The January problem: a payment early in year N+1 has its buy deadline in
// December of year N, so a watch built only from the current year's calendar
// goes blank during precisely the week it should be shouting.
{
  const held = [{ ticker: 'JAN', qty: 100 }];
  const meta = { JAN: { perShare: 5, freq: 'annual', anchorMonth: 0, payDay: 20, exOffsetDays: 14, baseYear: 2026 } };
  const thisYear = calendarForYear(held, meta, 2026, {});
  const nextYear = calendarForYear(held, meta, 2027, {});
  const dec = new Date('2026-12-28T00:00:00');
  ok('the current year alone shows nothing in late December',
    exWatch(thisYear, { today: dec, withinDays: 60 }).length === 0);
  ok('but including next year surfaces the January ex-date',
    exWatch([...thisYear, ...nextYear], { today: dec, withinDays: 60 }).length === 1);
}

console.log(`\n${pass}/${pass + fail} passing`);
if (fail) process.exit(1);
