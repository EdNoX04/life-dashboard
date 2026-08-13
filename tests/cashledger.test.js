// The cash screen's people ledger, and the categories under it.
//
// Written against Neel's real first 65 entries, because the design came from
// them: 28 autos filed under one Transport bucket that also held a car wash,
// six money-in rows whose categories were whatever the form last had selected,
// and half a dozen people's names typed into the note field in brackets
// because there was nowhere else to put them.
//
// THE ASSERTION THIS FILE IS FOR: lending is not spending and repayment is not
// income. Five thousand lent leaves your pocket exactly like five thousand
// spent, and the two are nothing alike — one is gone, the other is still yours.
// Counted as spending it makes one month look ruinous and the month you are
// repaid look like a windfall: two wrong numbers that cancel over a year, which
// is the worst kind, because the annual total looks right and every single
// month is wrong.

import {
  normaliseTxn, totals, byCategory, CATEGORY, CATEGORIES,
  isLedger, ledgerDelta, LEDGER, isInvest, INVEST_CATEGORY,
  addPerson, removePerson, personId, normalisePerson,
  peopleBalances, ledgerSummary, detectPeople,
  suggestCategory, suggestRecategorise, applyRecategorise,
  EMPTY_EXPENSES,
} from '../src/lib/expenses.js';

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; } else { fail++; console.log('FAIL ' + name); } };
const eq = (a, b, name) => ok(a === b, `${name} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
const near = (a, b, name, tol = 0.01) => ok(a != null && Math.abs(a - b) < tol, `${name} (got ${a}, want ${b})`);

const T = rows => rows.map(normaliseTxn);

// ------------------------------------------------------------ categories

ok(CATEGORY.auto && CATEGORY.cab, 'auto and cab are their own categories');
eq(CATEGORY.auto.label, 'Auto', 'auto is called what he calls it');
ok(CATEGORY.transport, 'a general transport bucket still exists for the rest');
ok(CATEGORIES.findIndex(c => c.key === 'auto') < CATEGORIES.findIndex(c => c.key === 'transport'),
  'and auto comes first, because it is where nearly every entry goes');

// ------------------------------------------- lending is not spending

const book = T([
  { kind: 'out', amount: 150, category: 'auto', note: 'Auto', cur: 'INR' },
  { kind: 'out', amount: 5000, category: 'health', note: 'GYM', person: 'dunu', ledger: 'lend', cur: 'INR' },
  { kind: 'in', amount: 2000, note: 'DUNU', person: 'dunu', ledger: 'settle', cur: 'INR' },
  { kind: 'in', amount: 2000, note: 'DUNU', person: 'dunu', ledger: 'settle', cur: 'INR' },
  { kind: 'in', amount: 1000, note: 'Dane', person: 'dane', ledger: 'borrow', cur: 'INR' },
  { kind: 'transfer', amount: 10000, note: 'Father', person: 'father', cur: 'INR' },
]);
const t = totals(book);

eq(t.spend, 150, 'the only spending is the auto — the ₹5,000 lent is not spending');
eq(t.income, 0, 'and none of the money coming back is income');
eq(t.transfers, 10000, 'family money is a transfer, exactly as chosen');
eq(t.lent, 5000, 'the loan is reported on its own line');
eq(t.repaidIn, 4000, 'and so are the repayments');
eq(t.borrowed, 1000, 'and money borrowed');
// The savings rate must not be computable from lending activity.
eq(t.savingsRate, null, 'with no real income there is no savings rate — not 0%, not -3233%');
// But the cash really did move, and that is a different question.
eq(t.cashOut, 5150, 'cash out counts the lending, because the money did leave');
eq(t.cashIn, 15000, 'and cash in counts the repayments, the borrowing and the transfer');

// The counterfactual, stated so the bug cannot come back quietly: if these rows
// were ordinary spending, the month would read as a catastrophe.
{
  const naive = totals(T([
    { kind: 'out', amount: 150, category: 'auto', cur: 'INR' },
    { kind: 'out', amount: 5000, category: 'health', cur: 'INR' },
    { kind: 'in', amount: 4000, cur: 'INR' },
  ]));
  ok(naive.spend > t.spend * 30, 'mislabelled, one loan makes spending thirty times larger');
  ok(naive.income > 0 && t.income === 0, 'and turns a repayment into income out of nowhere');
}

// A ledger row is never a spending category either — it would swamp the chart.
const cats = byCategory(book);
ok(!cats.some(c => c.key === 'health'), 'the ₹5,000 loan does not appear as health spending');
eq(cats.length, 1, 'only the auto is categorised spending');
eq(cats[0].key, 'auto', 'and it is an auto');

// ------------------------------------------------------- the sign rule

eq(ledgerDelta({ kind: 'out', amount: 500, ledger: 'lend' }), 500, 'money out means they owe you more');
eq(ledgerDelta({ kind: 'in', amount: 500, ledger: 'settle' }), -500, 'money in reduces what they owe');
eq(ledgerDelta({ kind: 'in', amount: 500, ledger: 'borrow' }), -500, 'borrowing puts you in their debt');
eq(ledgerDelta({ kind: 'out', amount: 500, ledger: 'settle' }), 500, 'paying them back clears it');
eq(ledgerDelta({ kind: 'out', amount: 500 }), 0, 'an ordinary expense moves no balance');
eq(ledgerDelta({}), 0, 'and neither does an empty row');
eq(isLedger({ ledger: 'lend' }), true, 'lend is a ledger row');
eq(isLedger({ ledger: 'nonsense' }), false, 'an unknown ledger value is not');
eq(normaliseTxn({ ledger: 'nonsense' }).ledger, null, 'and is dropped on the way in');

// -------------------------------------------------------- the balances

const people = [{ id: 'dunu', name: 'Dunu' }, { id: 'dane', name: 'Dane' }];
const bal = peopleBalances(book, people);
const dunu = bal.find(b => b.id === 'dunu');
const dane = bal.find(b => b.id === 'dane');

near(dunu.balance, 1000, 'Dunu was lent 5,000 and has paid back 4,000, so 1,000 is still owed');
eq(dunu.direction, 'owes-you', 'and the direction says which way');
near(dane.balance, -1000, 'Dane lent YOU 1,000');
eq(dane.direction, 'you-owe', 'which is the other direction, not a negative version of the same one');
eq(dunu.count, 3, 'every row that touched the balance is kept with it');

const sum = ledgerSummary(bal);
near(sum.owedToYou, 1000, 'one thousand is owed to you');
near(sum.youOwe, 1000, 'and one thousand is owed by you');
// The reason both figures survive rather than being netted into one.
near(sum.net, 0, 'the net is zero');
eq(sum.open, 2, 'but TWO balances are open — netting to zero is not the same as owing nobody');

// A settled person stays on the list.
{
  const square = peopleBalances(T([
    { kind: 'out', amount: 500, person: 'ravi', ledger: 'lend', cur: 'INR' },
    { kind: 'in', amount: 500, person: 'ravi', ledger: 'settle', cur: 'INR' },
  ]), [{ id: 'ravi', name: 'Ravi' }]);
  eq(square[0].settledUp, true, 'a squared-up person is marked settled');
  eq(square[0].direction, 'square', 'with its own direction');
  eq(square.length, 1, 'and is NOT dropped — "settled" is an answer you will want again');
}

// A person you have created but never transacted with is listed at zero, so the
// name you just typed does not appear to have been swallowed.
{
  const fresh = peopleBalances([], [{ id: 'new', name: 'New' }]);
  eq(fresh.length, 1, 'a newly created person appears immediately');
  eq(fresh[0].balance, 0, 'at zero');
}

// ------------------------------------------------------------ people

eq(personId('Mami Dida'), 'mami-dida', 'names become stable ids');
eq(personId('  DUNU  '), 'dunu', 'case and padding do not create a second person');
eq(addPerson([], 'Dunu').length, 1, 'a person can be added');
eq(addPerson(addPerson([], 'Dunu'), 'dunu').length, 1, 'and adding the same name twice does not duplicate them');
eq(addPerson([], '   ').length, 0, 'a blank name creates nobody');
eq(removePerson(addPerson([], 'Dunu'), 'dunu').length, 0, 'and a person can be removed');
ok(Array.isArray(EMPTY_EXPENSES.people), 'a fresh blob has a people list');

// ------------------------------------------------ reading the old notes

// The real notes, verbatim.
const OLD = T([
  { kind: 'out', amount: 5000, category: 'health', note: 'GYM ( Dunu )', cur: 'INR' },
  { kind: 'out', amount: 494, category: 'fun', note: 'Popcorn ( Mansi ) ', cur: 'INR' },
  { kind: 'out', amount: 343, category: 'fun', note: 'Aman ( Social )', cur: 'INR' },
  { kind: 'out', amount: 2000, category: 'other', note: 'Mami Dida', cur: 'INR' },
  { kind: 'out', amount: 150, category: 'transport', note: 'Auto', cur: 'INR' },
  { kind: 'out', amount: 800, category: 'other', note: 'Car Wash', cur: 'INR' },
  { kind: 'out', amount: 59, category: 'subs', note: 'Apple Music', cur: 'INR' },
]);
const detected = detectPeople(OLD);
const ids = detected.map(d => d.id);
ok(ids.includes('dunu'), 'Dunu is found inside "GYM ( Dunu )"');
ok(ids.includes('mansi'), 'and Mansi inside "Popcorn ( Mansi )", trailing space and all');
ok(ids.includes('mami-dida'), 'and a two-word name with no brackets');
ok(!ids.includes('social'), '"Social" is not offered as a person');
ok(!ids.includes('auto'), 'and neither is "Auto"');
ok(!ids.includes('car-wash'), 'nor "Car Wash"');
ok(!ids.includes('apple-music'), 'nor "Apple Music"');
eq(detectPeople(OLD, [{ id: 'dunu', name: 'Dunu' }]).some(d => d.id === 'dunu'), false,
  'someone already created is not offered again');
ok(detected[0].seen.length > 0, 'each suggestion carries the rows it came from, so it can be checked');

// It suggests and never rewrites. Whether "Mami Dida" is a person you lent to
// or a shop you paid is not a thing a regular expression knows.
ok(OLD.every(t2 => !t2.person), 'detection changes nothing on its own');

// ------------------------------------------------- category clean-up

eq(suggestCategory('Auto', 'transport'), 'auto', 'an "Auto" note belongs in Auto');
eq(suggestCategory('Uber to campus', 'transport'), 'cab', 'and an Uber in Cab');
eq(suggestCategory('Ola', 'transport'), 'cab', 'and an Ola');
eq(suggestCategory('Rapido', 'transport'), 'cab', 'and a Rapido');
eq(suggestCategory('Car Wash', 'other'), null, 'a car wash is neither and is left alone');
eq(suggestCategory('Automatic transfer', 'other'), null, 'and "Automatic" is not an auto — the match is on whole words');
eq(suggestCategory('Auto', 'auto'), null, 'a row already filed correctly is not touched');
eq(suggestCategory('Auto', 'cab'), null, 'and neither is one you filed yourself, even differently');

const changes = suggestRecategorise(OLD);
eq(changes.length, 1, 'exactly one of these seven rows would move');
eq(changes[0].to, 'auto', 'to auto');
eq(changes[0].from, 'transport', 'from the general bucket');
const applied = applyRecategorise(OLD, changes);
eq(applied.find(x => x.note === 'Auto').category, 'auto', 'applying it moves that row');
eq(applied.find(x => x.note === 'Car Wash').category, 'other', 'and leaves every other row exactly as it was');
eq(OLD.find(x => x.note === 'Auto').category, 'transport', 'the original array is not mutated');

// -------------------------------------------------- money-in categories

// Six real rows, ₹27,000, filed under Fun, Transport and College because the
// form demanded a category and validation only ever checked spending.
eq(normaliseTxn({ kind: 'in', amount: 10000, category: 'fun', note: 'Father' }).category, '',
  'money in carries no category rather than a misleading one');
eq(normaliseTxn({ kind: 'transfer', amount: 10000, category: 'college' }).category, '',
  'and neither does a transfer');
eq(normaliseTxn({ kind: 'out', amount: 10, category: 'nonsense' }).category, 'other',
  'while an unknown spending category still falls back to other');
eq(normaliseTxn({ kind: 'out', amount: 10, category: 'auto' }).category, 'auto',
  'and a real one survives');

// ------------------------------------------ investing is not spending either

// Fifteen real rows, ₹5,578, noted "QQQ", "Gold", "IND Money" — money that is
// sitting on the next tab of this app with a price against it, and was being
// counted here as though it had been eaten.
{
  const inv = T([
    { kind: 'out', amount: 500, category: 'invest', note: 'QQQ', cur: 'INR' },
    { kind: 'out', amount: 123, category: 'invest', note: 'Gold', cur: 'INR' },
    { kind: 'out', amount: 150, category: 'auto', note: 'Auto', cur: 'INR' },
    { kind: 'in', amount: 5000, note: 'stipend', cur: 'INR' },
  ]);
  const ti = totals(inv);

  eq(ti.spend, 150, 'only the auto is spending — the ₹623 invested is not');
  eq(ti.invested, 623, 'investing gets its own line');
  eq(ti.net, 4850, 'and lands in net, because it is money you kept');
  eq(ti.cashOut, 773, 'while cash out still counts it, because the money did leave the account');

  // The double count, stated as arithmetic. This is the number that was wrong.
  const wrong = (5000 - 773) / 5000 * 100;      // invest treated as spending
  const right = ti.savingsRate;
  ok(right > wrong + 10,
    'counted as spending, the savings rate was lower by exactly the amount saved');
  near(right, 97, 'the true rate is 97%, not 84.5%');

  // And it must not appear in the spending breakdown, where it would read as
  // a category of consumption.
  const ci = byCategory(inv);
  ok(!ci.some(c => c.key === 'invest'), 'investing is not a spending category');
  eq(ci.length, 1, 'the chart shows only what was actually spent');

  near(ti.investedShare, 12.85, 'and the share of what you kept that went somewhere is reported');
  eq(totals(T([{ kind: 'out', amount: 100, category: 'invest', cur: 'INR' }])).investedShare, null,
    'with nothing kept there is no share to quote — null, not 0%');
}

eq(isInvest({ kind: 'out', category: 'invest' }), true, 'an outgoing invest row is investing');
eq(isInvest({ kind: 'in', category: 'invest' }), false, 'money coming IN is not — that is a sale, not a purchase');
eq(isInvest({ kind: 'out', category: 'food' }), false, 'and dinner is not investing');
// A row that is both marked invest and marked as a loan is a loan. Lending
// somebody money to invest is still lending.
eq(isInvest({ kind: 'out', category: 'invest', ledger: 'lend' }), false,
  'a loan tagged invest is still a loan, and is not counted twice');
eq(INVEST_CATEGORY, 'invest', 'the category key is what the existing rows already use');

// ------------------------------------------------------------ hostile

{
  const CASES = [
    ['nothing', [], []],
    ['null rows', [null, undefined], []],
    ['ledger row with no person', T([{ kind: 'out', amount: 100, ledger: 'lend', cur: 'INR' }]), []],
    ['person with no rows', [], [{ id: 'x', name: 'X' }]],
    ['NaN amount', T([{ kind: 'out', amount: NaN, ledger: 'lend', person: 'x', cur: 'INR' }]), [{ id: 'x', name: 'X' }]],
    ['negative amount', T([{ kind: 'out', amount: -500, ledger: 'lend', person: 'x', cur: 'INR' }]), [{ id: 'x', name: 'X' }]],
  ];
  for (const [name, rows, ppl] of CASES) {
    let threw = null, b = null;
    try { b = peopleBalances(rows.filter(Boolean), ppl); ledgerSummary(b); detectPeople(rows.filter(Boolean), ppl); }
    catch (e) { threw = e; }
    ok(threw == null, `the ledger survives ${name}${threw ? `: ${threw.message}` : ''}`);
    if (b) ok(b.every(r => !Number.isNaN(r.balance)), `${name} produces no NaN balance`);
  }
  // A ledger row with no person cannot land in anyone's balance.
  eq(peopleBalances(T([{ kind: 'out', amount: 100, ledger: 'lend', cur: 'INR' }]), []).length, 0,
    'a loan with nobody attached belongs to no balance');
  // Amounts are absolute: a negative amount must not silently flip a direction.
  const neg = peopleBalances(T([{ kind: 'out', amount: -500, ledger: 'lend', person: 'x', cur: 'INR' }]), [{ id: 'x', name: 'X' }]);
  eq(neg[0].direction, 'owes-you', 'a negative amount on an outgoing loan still means they owe you');
}

console.log(`${pass}/${pass + fail} passing`);
if (fail) process.exit(1);
