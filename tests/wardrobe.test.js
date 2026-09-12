// The collection — clothes and watches on one set of bones.
//
// Almost all of this is about the dedupe, because that is the feature ("so
// that same cloth is not repeated") and it is the part that can do damage.
// Too shy and the collection stops being a record of what he owns. Too eager
// and an item he DOES own silently is not there — which is worse, and worse in
// the same way an over-eager calendar fold is worse: the missing thing leaves
// no trace to notice.

import {
  KINDS, CATEGORIES, CONDITIONS, SOURCES, normaliseItem, identityOf, identifiable,
  findDuplicate, addItem, setCondition, isArchived, lifespanDays, split,
  byCategory, monthSpend, spendSeries, serviceDue,
} from '../src/lib/wardrobe.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log('FAIL ' + n); } };
const eq = (a, b, n) => ok(Object.is(a, b), `${n} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const tee = (over = {}) => ({ kind: 'garment', brand: 'Souled Store', name: 'Classic Tee', category: 'tee', colour: 'Black', price: 799, boughtAt: '2026-09-02', source: 'souled', ...over });

// ------------------------------------------------------------------ the model
{
  eq(normaliseItem({}).kind, 'garment', 'an item is a garment unless it says otherwise');
  eq(normaliseItem({ condition: 'shredded' }).condition, 'new', 'an unknown condition falls back rather than being stored');
  eq(normaliseItem({ category: 'spaceship' }).category, 'other', 'so does an unknown category');
  eq(normaliseItem({ source: 'ebay' }).source, 'other', 'and an unknown source');
  eq(normaliseItem({ price: '' }).price, null, 'an empty price is NULL — an item with no price is not a free item');
  eq(normaliseItem({ price: 0 }).price, 0, 'while a real zero survives — a gift cost nothing');
  eq(normaliseItem({ boughtAt: 'last month' }).boughtAt, null, 'and a date that is not a date is null');
  ok(SOURCES.includes('shop'), 'buying something standing up in a shop is a first-class source, not "other"');
}

// =========================================================================
// THE DEDUPE
// =========================================================================
{
  const list = [normaliseItem(tee())];

  ok(findDuplicate(list, tee()), 'the same black Souled Store tee is caught the second time');
  ok(findDuplicate(list, tee({ name: 'Essential Tee', price: 499 })),
     'and is still caught when the product NAME and the price differ — two of the same shirt rarely share a marketing name, and a sale price does not make it a different shirt');

  // The dangerous direction.
  ok(!findDuplicate(list, tee({ colour: 'White' })), 'a white one is a DIFFERENT tee');
  ok(!findDuplicate(list, tee({ category: 'polo' })), 'a polo is not a tee');
  ok(!findDuplicate(list, tee({ brand: 'Snitch' })), 'and another brand is another shirt');

  // The rule that stops this being something to fight.
  const worn = setCondition(list, list[0].id, 'retired', '2026-09-10');
  ok(!findDuplicate(worn, tee()),
     'an ARCHIVED item is never a duplicate — replacing something you wore out is the normal case, and a wardrobe that argues about it is wrong');

  eq(findDuplicate(list, { kind: 'garment', brand: 'Souled Store' }), null,
     'a candidate with almost nothing filled in matches NOTHING — a blank identity that matched everything would fold the whole collection');
  ok(!identifiable({ brand: 'x' }), 'one field is not an identity');
  ok(identifiable(tee()), 'brand plus category plus colour is');
  eq(findDuplicate(null, tee()), null, 'no list is no duplicate, not a throw');
}

// ---------------------------------------------------- a duplicate is reported
{
  const first = addItem([], tee());
  eq(first.duplicate, null, 'the first one is not a duplicate of anything');
  const second = addItem(first.list, tee());
  eq(second.list.length, 2, 'the second one IS still added — he may genuinely want two');
  ok(second.duplicate, 'but the existing one is handed back so the screen can say so');
  eq(second.duplicate.id, first.item.id, 'naming which');
}

// ---------------------------------------------------------- condition & archive
{
  const list = addItem([], tee()).list;
  const id = list[0].id;
  const gone = setCondition(list, id, 'retired', '2027-03-01');
  ok(isArchived(gone[0]), 'retiring archives it');
  eq(gone[0].retiredAt, '2027-03-01', 'with the date it happened');
  eq(gone.length, 1, 'and NOTHING is deleted — the record of what he wore out is the only honest signal about what he actually wears');
  eq(lifespanDays(gone[0]), 180, 'so "how long did it last" is answerable');

  const back = setCondition(gone, id, 'good');
  eq(back[0].retiredAt, null, 'un-retiring clears the date rather than leaving a stale one');
  eq(lifespanDays(back[0]), null, 'and the lifespan goes with it');

  const s = split(gone);
  eq(s.active.length, 0, 'the archive is out of the active list');
  eq(s.archived.length, 1, 'and viewable on its own');
}

// ------------------------------------------------------------------ the shelf
{
  const list = [tee(), tee({ colour: 'White' }), tee({ category: 'jeans', colour: 'Blue' })].reduce((l, t) => addItem(l, t).list, []);
  const cats = byCategory(list);
  eq(cats[0].category, 'tee', 'the biggest pile leads');
  eq(cats[0].count, 2, 'counted');
  const withArchived = setCondition(list, list[0].id, 'retired', '2026-09-20');
  eq(byCategory(withArchived)[0].count, 1, 'and a retired item is not something he owns any more');
}

// =========================================================================
// SPEND — a number, never a verdict
// =========================================================================
{
  const list = [
    tee({ price: 799, boughtAt: '2026-09-02' }),
    tee({ colour: 'White', price: 1200, boughtAt: '2026-09-20' }),
    tee({ colour: 'Navy', price: null, boughtAt: '2026-09-21' }),
    tee({ colour: 'Grey', price: 999, boughtAt: '2026-08-15' }),
  ].reduce((l, t) => addItem(l, t).list, []);

  const m = monthSpend(list, '2026-09', 3000);
  eq(m.spent, 1999, 'only this month counts');
  eq(m.items, 3, 'including the one with no price');
  eq(m.unpriced, 1, 'which is counted SEPARATELY — a month that looks under budget because a price is missing is the same failure as a net worth that dropped a sleeve');
  eq(m.over, false, 'under the ceiling he set');
  eq(m.left, 1001, 'with the remainder stated');

  eq(monthSpend(list, '2026-09').over, null,
     'with NO ceiling there is nothing to be over — null, not false, because "fine" and "no target" are different answers');

  const words = JSON.stringify(monthSpend(list, '2026-09', 1000)).toLowerCase();
  ok(!/(overspent|too much|should|cut back|bad|guilt|splurge)\b/.test(words),
     'and going past the ceiling produces no verdict anywhere — the ceiling is his, the number is a fact');

  const series = spendSeries(list, 3, new Date('2026-09-15T00:00:00'));
  eq(series.length, 3, 'a short history is available');
  eq(series[2].month, '2026-09', 'ending with the current month');
  eq(series[1].spent, 999, 'and the month before is its own number');
}

// =========================================================================
// WATCHES — the same bones, and the reason they are the same bones
// =========================================================================
{
  const skx = { kind: 'watch', brand: 'Seiko', name: 'SKX007', reference: 'SKX007J1', movement: '7S26', price: 32000, boughtAt: '2025-06-01', serviceMonths: 60, lastService: '2025-06-01' };
  const list = addItem([], skx).list;

  ok(findDuplicate(list, { ...skx, name: 'Seiko Diver' }), 'a watch is identified by its REFERENCE, so the same piece is caught under another name');
  ok(!findDuplicate(list, { ...skx, reference: 'SKX009J1' }),
     'and a different reference is a different watch — identifying watches by brand alone would fold a whole collection of Seikos into one');

  const due = serviceDue(list[0], '2026-09-13');
  eq(due.due, '2030-06-01', 'the next service is the interval from the last one');
  eq(due.overdue, false, 'and it is not due yet');
  eq(serviceDue({ ...skx, lastService: '2019-01-01' }, '2026-09-13').overdue, true, 'an old one is overdue');
  eq(serviceDue({ ...skx, serviceMonths: null }), null,
     'with no interval entered there is NO due date — an invented interval puts a date on something nobody decided');
  eq(serviceDue(tee()), null, 'and a t-shirt has no service interval');

  // The point of one model.
  eq(split(addItem(list, tee()).list, 'watch').active.length, 1, 'the two collections filter apart');
  eq(split(addItem(list, tee()).list, 'garment').active.length, 1, 'each seeing only its own');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
