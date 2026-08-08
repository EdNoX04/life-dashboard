// Pins the crypto book. The reported bug — BTC added twice showing as two
// different coins — is the first section; the rest is the arithmetic that makes
// merging correct rather than merely tidy.

import {
  num, normaliseSymbol, blendCost, addLot, dedupeBook, bookRows, bookTotals,
} from '../src/lib/cryptobook.js';

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; } else { fail++; console.log('FAIL ' + name); } };
const eq = (a, b, name) => ok(a === b, `${name} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
const near = (a, b, name, tol = 1e-9) =>
  ok(a != null && Math.abs(a - b) < tol, `${name} (got ${a}, want ~${b})`);

// --------------------------------------------------------------- symbols
eq(normaliseSymbol('btc'), 'BTC', 'symbols upper-case');
eq(normaliseSymbol(' BTC '), 'BTC', 'and trim');
eq(normaliseSymbol('BTCUSDT'), 'BTC', 'a trading pair reduces to its base coin');
eq(normaliseSymbol('BTC-USD'), 'BTC', 'punctuation and quote currency are stripped');
eq(normaliseSymbol('ETHUSDC'), 'ETH', 'other stablecoin pairs too');
eq(normaliseSymbol('SOLINR'), 'SOL', 'and rupee pairs');
// USDT is a coin you can hold, not a pair with an empty base.
eq(normaliseSymbol('USDT'), 'USDT', 'a bare stablecoin keeps its name');
eq(normaliseSymbol('USDC'), 'USDC', 'and so does USDC');
// FDUSD ends with USD. Stripping it would invent a coin called FD, which is the
// kind of bug that shows up months later as a mystery position.
eq(normaliseSymbol('FDUSD'), 'FDUSD', 'a stablecoin whose name ends in another is not stripped');
eq(normaliseSymbol('TUSD'), 'TUSD', 'nor is TUSD');
eq(normaliseSymbol('BUSD'), 'BUSD', 'nor BUSD');
// A one-character base is far likelier to be an unknown symbol than a coin.
eq(normaliseSymbol('XUSD'), 'XUSD', 'a one-character base is left alone rather than invented');
eq(normaliseSymbol(''), null, 'an empty symbol is null');
eq(normaliseSymbol(null), null, 'a null symbol is null');

// ------------------------------------------------------------ blend cost
near(blendCost(1, 100, 1, 200), 150, 'two equal lots average their prices');
// Weighted, not arithmetic: three cheap coins and one dear one is not 150.
near(blendCost(3, 100, 1, 200), 125, 'the average is weighted by quantity');
near(blendCost(1, 200, 3, 100), 125, 'and is symmetric in argument order');
eq(blendCost(1, null, 1, null), null, 'two unknown bases stay unknown');
// The case people get wrong.
eq(blendCost(1, 100, 1, null), null, 'a half-known basis is NOT the known half');
eq(blendCost(1, null, 1, 100), null, 'in either order');
// A zero-quantity lot contributes nothing and must not zero the other side.
near(blendCost(0, null, 2, 100), 100, 'an empty lot leaves the real one alone');
near(blendCost(2, 100, 0, null), 100, 'in either position');
eq(blendCost(0, null, 0, null), null, 'two empty lots have no basis');

// ------------------------------------------------------- THE REPORTED BUG
let book = [];
book = addLot(book, { sym: 'BTC', qty: 0.5, avg: 60000 }, () => 'id1').list;
eq(book.length, 1, 'the first BTC lot creates one row');
const second = addLot(book, { sym: 'BTC', qty: 0.5, avg: 80000 }, () => 'id2');
eq(second.list.length, 1, 'adding BTC again does NOT create a second coin');
eq(second.merged, true, 'and reports that it merged');
near(second.list[0].qty, 1, 'quantities add');
near(second.list[0].avg, 70000, 'and the cost basis is the weighted average');
eq(second.list[0].id, 'id1', 'the original row keeps its identity');

// The same coin under a pair name is still the same coin.
const viaPair = addLot(second.list, { sym: 'BTCUSDT', qty: 1, avg: 70000 }, () => 'id3');
eq(viaPair.list.length, 1, 'BTCUSDT merges into BTC rather than adding a row');
near(viaPair.list[0].qty, 2, 'and its quantity is added');

// A different coin is a different row.
const withEth = addLot(second.list, { sym: 'ETH', qty: 2, avg: 3000 }, () => 'id4');
eq(withEth.list.length, 2, 'a genuinely different coin adds a row');
eq(withEth.merged, false, 'and is not a merge');

// Merging into a lot with no basis loses the basis, and says so.
const noBasis = addLot([{ id: 'x', sym: 'SOL', qty: 1, avg: null }], { sym: 'SOL', qty: 1, avg: 200 });
eq(noBasis.list[0].avg, null, 'merging a priced lot into an unpriced one leaves the basis unknown');
ok(noBasis.reason && noBasis.reason.includes('unknown'), 'and explains why rather than silently blanking it');
near(noBasis.list[0].qty, 2, 'while the quantity is still correct');

// Junk input is refused rather than stored.
eq(addLot([], { sym: '', qty: 1 }).added, false, 'a coin with no symbol is refused');
eq(addLot([], { sym: 'BTC', qty: 0 }).added, false, 'a zero quantity is refused');
eq(addLot([], { sym: 'BTC', qty: -1 }).added, false, 'a negative quantity is refused');
eq(addLot([], { sym: 'BTC' }).added, false, 'a missing quantity is refused');
ok(addLot([], { sym: 'BTC', qty: 0 }).reason.length > 10, 'and the refusal says what was wrong');
eq(addLot([], { sym: 'BTC', qty: 0 }).list.length, 0, 'a refused lot changes nothing');

// ------------------------------------------------------------- dedupe
// Existing books were written by the old append-only path, so they need folding
// on load rather than a manual clean-up.
const MESSY = [
  { id: 'a', sym: 'BTC', qty: 0.5, avg: 60000 },
  { id: 'b', sym: 'ETH', qty: 2, avg: 3000 },
  { id: 'c', sym: 'btc', qty: 0.5, avg: 80000 },
  { id: 'd', sym: 'BTCUSDT', qty: 1, avg: 70000 },
];
const fixed = dedupeBook(MESSY);
eq(fixed.list.length, 2, 'three BTC rows fold into one, ETH stays');
eq(fixed.merges, 2, 'two merges happened');
const btc = fixed.list.find(c => c.sym === 'BTC');
near(btc.qty, 2, 'the folded quantity is the sum');
near(btc.avg, 70000, 'and the basis is the quantity-weighted average of all three');
eq(dedupeBook([]).list.length, 0, 'an empty book folds to nothing');
eq(dedupeBook([]).merges, 0, 'with no merges');
eq(dedupeBook([{ id: 'a', sym: 'BTC', qty: 1, avg: 1 }]).merges, 0, 'a clean book reports no merges');

// ------------------------------------------------------------- insights
const PRICES = {
  BTC: { price: 100000, changePct: 2 },
  ETH: { price: 4000, changePct: -1 },
  SOL: { price: 200, changePct: 0 },
};
const rows = bookRows([
  { id: 'a', sym: 'BTC', qty: 1, avg: 70000 },
  { id: 'b', sym: 'ETH', qty: 2, avg: 3000 },
  { id: 'c', sym: 'SOL', qty: 10, avg: null },
], PRICES);
eq(rows[0].sym, 'BTC', 'rows sort by value, largest first');
near(rows[0].value, 100000, 'value is quantity times price');
near(rows[0].pnl, 30000, 'and the gain is value less cost');
near(rows[0].pnlPct, 30000 / 70000 * 100, 'and the return is against cost');
near(rows[0].weight, 100000 / 110000 * 100, 'weight is a share of the book');
eq(rows[2].sym, 'SOL', 'the smallest position is last');
eq(rows[2].cost, null, 'a coin with no basis has no cost');
eq(rows[2].pnl, null, 'and no gain — not a gain of zero');
eq(rows[2].unknownCost, true, 'and is flagged');
// A day move in currency, derived from the percentage.
near(rows[0].dayGain, 100000 - 100000 / 1.02, "the day's gain is backed out of the percentage");
eq(rows[2].dayGain, 0, 'a flat coin gained nothing today');
// An unpriced coin has no value rather than a zero one.
const unpriced = bookRows([{ id: 'z', sym: 'XYZ', qty: 5, avg: 1 }], {});
eq(unpriced[0].value, null, 'a coin with no price has no value');
eq(unpriced[0].weight, null, 'and no weight');

const tot = bookTotals(rows);
near(tot.value, 100000 + 8000 + 2000, 'the total is every priced position');
// The return excludes the position whose basis is unknown, both sides.
near(tot.cost, 70000 + 6000, 'invested counts only positions with a basis');
near(tot.pnl, (100000 + 8000) - 76000, 'and the gain compares like with like');
eq(tot.missingCost.length, 1, 'the position without a basis is named');
eq(tot.missingCost[0], 'SOL', 'and it is the right one');
eq(tot.count, 3, 'all three positions are counted');
// A book with no bases at all reports no return rather than a zero one.
const noneCosted = bookTotals(bookRows([{ id: 'a', sym: 'BTC', qty: 1, avg: null }], PRICES));
eq(noneCosted.cost, null, 'no bases means no invested figure');
eq(noneCosted.pnl, null, 'and no gain');
near(noneCosted.value, 100000, 'though the value is still known');

eq(num(''), null, 'blank is not zero');
eq(num(null), null, 'null is not zero');

console.log(`${pass}/${pass + fail} passing`);
if (fail) process.exit(1);
