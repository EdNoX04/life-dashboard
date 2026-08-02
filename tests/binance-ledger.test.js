// tests/binance-ledger.test.js — the ledger maths behind the Binance sync.
//
// Ranked by what it costs to get wrong:
//
//   1. positionFor() must not let a SELL move the average cost. This is the bug
//      that flatters you: it makes the remaining position look more expensive
//      than it was, which makes your unrealised gain look smaller, which makes
//      you think you are being conservative. Everything about it feels safe and
//      all of it is wrong.
//   2. positionFor() must not treat a transfer IN as a free buy. A deposit
//      priced at zero drags the average toward zero and reports a gain that
//      never happened.
//   3. dedupeLedger() must actually dedupe. The worker re-fetches an overlapping
//      window every run on purpose, so a broken dedupe grows the position by the
//      overlap on every single sync — slowly, plausibly, forever.
//   4. normalizeP2P() must not swap `amount` and `totalPrice`. Swapped, the
//      price is out by roughly the price of the coin and still looks like money.
//
// Run: bun tests/binance-ledger.test.js

import {
  normalizeP2P, normalizeTrade, normalizeFlow, dedupeLedger, positionFor, positions,
} from '../scripts/lib/binance-ledger.mjs';

let pass = 0, fail = 0;
function ok(name, cond, got) {
  if (cond) { pass++; }
  else { fail++; console.log(`FAIL ${name}${got !== undefined ? `  — got ${got}` : ''}`); }
}
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

// ------------------------------------------------------------- normalizeP2P
{
  const buy = normalizeP2P({
    orderNumber: '2200123', tradeType: 'BUY', orderStatus: 'COMPLETED',
    asset: 'USDT', fiat: 'INR', amount: '100', totalPrice: '9150', unitPrice: '91.5',
    commission: '0', createTime: 1750000000000,
  });
  ok('a P2P buy keeps crypto in qty and rupees in fiatQty — not the other way round',
    buy.qty === 100 && buy.fiatQty === 9150, `qty=${buy?.qty} fiatQty=${buy?.fiatQty}`);
  ok('the P2P unit price is rupees per coin, not coins per rupee',
    near(buy.price, 91.5), buy.price);
  ok('a P2P buy is a buy', buy.kind === 'buy', buy.kind);
  ok('the asset is upper-cased', buy.asset === 'USDT', buy.asset);
  ok('the timestamp becomes an ISO string', typeof buy.at === 'string' && buy.at.startsWith('2025-'), buy.at);

  const sell = normalizeP2P({
    orderNumber: 'x', tradeType: 'SELL', orderStatus: 'COMPLETED',
    asset: 'USDT', fiat: 'INR', amount: '50', totalPrice: '4600', createTime: 1750000000000,
  });
  ok('a P2P sell is a sell', sell.kind === 'sell', sell.kind);

  // The must-nots. A counted cancellation is a coin that never arrives.
  ok('a CANCELLED P2P order is not a transaction',
    normalizeP2P({ orderNumber: 'c', tradeType: 'BUY', orderStatus: 'CANCELLED', asset: 'USDT', amount: '100', totalPrice: '9150' }) === null);
  ok('an order still in appeal is not a transaction',
    normalizeP2P({ orderNumber: 'c', tradeType: 'BUY', orderStatus: 'IN_APPEAL', asset: 'USDT', amount: '100', totalPrice: '9150' }) === null);
  ok('a zero-quantity order is discarded rather than divided by',
    normalizeP2P({ orderNumber: 'z', tradeType: 'BUY', orderStatus: 'COMPLETED', asset: 'USDT', amount: '0', totalPrice: '0' }) === null);
  ok('an unknown trade type is discarded, not guessed at',
    normalizeP2P({ orderNumber: 'q', tradeType: 'TRANSFER', orderStatus: 'COMPLETED', asset: 'USDT', amount: '1', totalPrice: '9' }) === null);
  ok('null in, null out', normalizeP2P(null) === null);

  // A partial fill: the advert said 92, the settlement says 91.5. The settlement
  // is what happened, so it wins.
  const partial = normalizeP2P({
    orderNumber: 'p', tradeType: 'BUY', orderStatus: 'COMPLETED',
    asset: 'USDT', amount: '100', totalPrice: '9150', unitPrice: '92', createTime: 1750000000000,
  });
  ok('the derived price beats the advertised unitPrice when they disagree',
    near(partial.price, 91.5), partial.price);

  // Missing orderStatus (some endpoints omit it on completed history) must not
  // throw the row away — that would silently drop a real trade.
  const noStatus = normalizeP2P({
    orderNumber: 'n', tradeType: 'BUY', asset: 'USDT', amount: '10', totalPrice: '915', createTime: 1750000000000,
  });
  ok('an order with no status field is kept, not discarded', noStatus !== null && noStatus.qty === 10);

  // Binance is consistent about millisecond timestamps on the endpoints used
  // here, so the seconds branch is insurance rather than a known case — but
  // insurance that is never exercised is just an untested branch, and the cost
  // of it being wrong is every affected order dated to 1970, which sorts to the
  // front of the ledger and therefore corrupts cost basis for everything after.
  const secs = normalizeP2P({
    orderNumber: 's', tradeType: 'BUY', asset: 'USDT', amount: '1', totalPrice: '91',
    createTime: 1750000000,
  });
  ok('a ten-digit (seconds) timestamp is read as seconds, not dated to 1970',
    secs.at.startsWith('2025-'), secs.at);
  ok('and lands on the same instant as the millisecond form',
    secs.at === buy.at, `${secs.at} vs ${buy.at}`);
}

// ----------------------------------------------------------- normalizeTrade
{
  const t = normalizeTrade({ symbol: 'BTCUSDT', id: 991, price: '60000', qty: '0.01', quoteQty: '600', commission: '0.6', commissionAsset: 'USDT', isBuyer: true, time: 1750000000000 }, 'BTC', 'USDT');
  ok('a spot buy carries the base asset, not the pair', t.asset === 'BTC', t.asset);
  ok('a spot buy quotes in the quote asset', t.fiat === 'USDT' && t.fiatQty === 600, `${t.fiat}/${t.fiatQty}`);
  ok('isBuyer false is a sell',
    normalizeTrade({ symbol: 'BTCUSDT', id: 2, price: '1', qty: '1', isBuyer: false, time: 1 }, 'BTC', 'USDT').kind === 'sell');
  // quoteQty is absent on some historical rows; falling back to qty*price keeps
  // the cost basis from silently becoming zero for those trades.
  const noQuote = normalizeTrade({ symbol: 'BTCUSDT', id: 3, price: '50', qty: '2', isBuyer: true, time: 1 }, 'BTC', 'USDT');
  ok('a missing quoteQty falls back to qty x price rather than to zero',
    noQuote.fiatQty === 100, noQuote.fiatQty);
  ok('trade ids are namespaced by symbol so two pairs cannot collide',
    t.id === 'trade:BTCUSDT:991', t.id);
}

// ------------------------------------------------------------ normalizeFlow
{
  const dep = normalizeFlow({ txId: 'abc', coin: 'usdt', amount: '25', status: 1, insertTime: 1750000000000 }, 'in');
  ok('a successful deposit is an in, with no price attached',
    dep.kind === 'in' && dep.price === 0 && dep.fiatQty === 0);
  ok('the deposit coin is upper-cased', dep.asset === 'USDT', dep.asset);
  ok('a PENDING deposit is not counted — a phantom balance never reconciles',
    normalizeFlow({ txId: 'p', coin: 'USDT', amount: '25', status: 0, insertTime: 1 }, 'in') === null);
  ok('a completed withdrawal (status 6) is an out',
    normalizeFlow({ id: 'w', coin: 'USDT', amount: '5', status: 6, applyTime: 1750000000000 }, 'out').kind === 'out');
  ok('a withdrawal still processing is not counted',
    normalizeFlow({ id: 'w2', coin: 'USDT', amount: '5', status: 2, applyTime: 1 }, 'out') === null);
  // A deposit's success code (1) is NOT a withdrawal's success code (6). Sharing
  // one number across both would count every failed withdrawal.
  ok('deposit status 1 does not make a withdrawal complete',
    normalizeFlow({ id: 'w3', coin: 'USDT', amount: '5', status: 1, applyTime: 1 }, 'out') === null);
}

// ------------------------------------------------------------ dedupeLedger
{
  const r = (id, at, asset = 'USDT') => ({ id, at, asset, kind: 'buy', qty: 1, fiatQty: 90 });
  {
    const out = dedupeLedger([r('a', '2026-01-01'), r('a', '2026-01-01'), r('b', '2026-01-02')]);
    ok('a repeated id appears once — the overlap window must not double-count',
      out.length === 2, out.length);
  }
  {
    const out = dedupeLedger([r('c', '2026-03-01'), r('a', '2026-01-01'), r('b', '2026-02-01')]);
    ok('rows come back oldest-first, because cost basis is order-dependent',
      out.map(x => x.id).join(',') === 'a,b,c', out.map(x => x.id).join(','));
  }
  {
    // Two different rows that both lost their order number would collide on the
    // id 'p2p:' and one would vanish. Dropping both is the lesser evil: a
    // missing row is visible in a reconciliation, a swallowed one is not.
    const out = dedupeLedger([{ id: 'p2p:', at: '2026-01-01', asset: 'USDT' }, r('ok', '2026-01-02')]);
    ok('a row with no order number is dropped rather than colliding',
      out.length === 1 && out[0].id === 'ok', out.map(x => x.id).join(','));
  }
  ok('a row with no asset is dropped', dedupeLedger([{ id: 'x', at: '2026-01-01' }]).length === 0);
  ok('null entries and a non-array input do not crash',
    dedupeLedger([null, undefined]).length === 0 && dedupeLedger(null).length === 0);
}

// ------------------------------------------------------------- positionFor
{
  const buy = (qty, fiatQty, at) => ({ id: `b${at}`, asset: 'USDT', kind: 'buy', qty, fiatQty, at });
  const sell = (qty, fiatQty, at) => ({ id: `s${at}`, asset: 'USDT', kind: 'sell', qty, fiatQty, at });

  {
    // 100 @ 90 then 100 @ 100 -> 200 @ 95. Hand-computed, not derived from the
    // implementation, so a change to the averaging rule cannot move the answer
    // with it.
    const p = positionFor([buy(100, 9000, '1'), buy(100, 10000, '2')], 'USDT');
    ok('two buys average by value, not by price', near(p.avgCost, 95), p.avgCost);
    ok('two buys sum quantity', p.qty === 200, p.qty);
    ok('invested is the gross rupees in', p.invested === 19000, p.invested);
  }
  {
    // THE ONE THAT MATTERS. Buy 200 at an average of 95, sell 100 at 120.
    // The remaining 100 still cost 95 each. Not 95-something, not 70 — 95.
    const p = positionFor([buy(100, 9000, '1'), buy(100, 10000, '2'), sell(100, 12000, '3')], 'USDT');
    ok('a SELL does not change the average cost of what remains',
      near(p.avgCost, 95), p.avgCost);
    ok('a sell reduces quantity', p.qty === 100, p.qty);
    ok('the remaining cost is qty x the unchanged average', near(p.cost, 9500), p.cost);
    ok('the realised gain is proceeds minus the average cost of the units sold',
      near(p.realised, 12000 - 9500), p.realised);
    ok('returned is the gross rupees out', p.returned === 12000, p.returned);
  }
  {
    // Selling everything must leave nothing behind. A tiny cost residue on a
    // zero position produces an infinite average the moment one coin comes back.
    const p = positionFor([buy(100, 9000, '1'), sell(100, 9500, '2')], 'USDT');
    ok('selling the whole position leaves zero quantity', p.qty === 0, p.qty);
    ok('selling the whole position leaves zero cost, not a rounding residue',
      p.cost === 0, p.cost);
    ok('a zero position reports a zero average rather than NaN or Infinity',
      p.avgCost === 0, p.avgCost);
    ok('the realised gain survives the position closing', near(p.realised, 500), p.realised);
  }
  {
    // A deposit is not a free buy. Buy 100 for 9000 (avg 90), then 100 arrive
    // from another wallet. You hold 200 having paid 9000, so the average is 45.
    // The number that would be wrong here is 90 (ignoring the deposit entirely)
    // or 0-adjacent nonsense (treating it as a buy at price zero).
    // The deposit row deliberately carries a NON-zero fiatQty. normalizeFlow
    // never emits one, but a fixture of zero cannot tell "the code ignores this
    // field" from "the field happened to be zero", and it is the first of those
    // two that is being asserted.
    const p = positionFor([buy(100, 9000, '1'), { id: 'd', asset: 'USDT', kind: 'in', qty: 100, fiatQty: 9999, at: '2' }], 'USDT');
    ok('a transfer IN raises quantity and leaves total cost alone',
      p.qty === 200 && near(p.cost, 9000), `${p.qty}/${p.cost}`);
    ok('which means the average halves — coins that arrived free did arrive free',
      near(p.avgCost, 45), p.avgCost);
    ok('a transfer IN is not counted as money invested', p.invested === 9000, p.invested);
  }
  {
    const p = positionFor([buy(100, 9000, '1'), { id: 'o', asset: 'USDT', kind: 'out', qty: 40, at: '2' }], 'USDT');
    ok('a transfer OUT reduces quantity', p.qty === 60, p.qty);
    ok('a transfer OUT books no realised gain — nothing was sold', p.realised === 0, p.realised);
  }
  {
    // Real and common: the sync window opens after the buy, so the ledger sees a
    // sell of coins it never saw arrive. It must not go negative.
    const p = positionFor([sell(50, 5000, '1')], 'USDT');
    ok('selling more than the ledger has seen does not produce a negative position',
      p.qty === 0, p.qty);
    ok('and does not produce a negative or NaN average', p.avgCost === 0, p.avgCost);
  }
  {
    const rows = [buy(1, 90, '1'), { id: 'x', asset: 'BTC', kind: 'buy', qty: 1, fiatQty: 6000000, at: '2' }];
    const p = positionFor(rows, 'USDT');
    ok('another asset in the ledger does not contaminate this one',
      p.qty === 1 && near(p.cost, 90), `${p.qty}/${p.cost}`);
    ok('asset matching is case-insensitive',
      positionFor([{ id: 'l', asset: 'usdt', kind: 'buy', qty: 2, fiatQty: 180, at: '1' }], 'USDT').qty === 2);
  }
  {
    ok('an empty ledger is a zero position, not a crash',
      positionFor([], 'USDT').qty === 0 && positionFor(null, 'BTC').avgCost === 0);
    ok('a zero-quantity row is skipped rather than dividing by it',
      positionFor([buy(0, 0, '1'), buy(10, 900, '2')], 'USDT').qty === 10);
  }
  {
    // Thirds. 0.1+0.1+0.1 is not 0.3 in binary floating point, so selling "all"
    // of it leaves a quantity of about -2.8e-17 and a cost of a similar size.
    // Without an epsilon clamp that residue survives as a closed position that
    // still claims to hold something, and the next coin to arrive divides a
    // real cost by a number near zero and reports an average in the trillions.
    const p = positionFor([
      { id: 'a', asset: 'BTC', kind: 'buy', qty: 0.1, fiatQty: 600000, at: '1' },
      { id: 'b', asset: 'BTC', kind: 'buy', qty: 0.1, fiatQty: 600000, at: '2' },
      { id: 'c', asset: 'BTC', kind: 'buy', qty: 0.1, fiatQty: 600000, at: '3' },
      { id: 'd', asset: 'BTC', kind: 'sell', qty: 0.3, fiatQty: 2000000, at: '4' },
    ], 'BTC');
    ok('a fractional position sold out lands on exactly zero, not a float residue',
      p.qty === 0 && p.cost === 0, `qty=${p.qty} cost=${p.cost}`);
  }
  {
    // Oversell with a real holding behind it. The clamp on qty hides most of
    // this, so the assertion that actually distinguishes the two behaviours is
    // the realised gain: you can only book the cost of coins you had.
    const p = positionFor([buy(10, 900, '1'), sell(50, 5000, '2')], 'USDT');
    ok('an oversell realises against the units actually held, not the units claimed',
      near(p.realised, 5000 - 900), p.realised);
    ok('an oversell still ends flat rather than negative', p.qty === 0 && p.cost === 0, `${p.qty}/${p.cost}`);
  }
  {
    // Same shape for transfers: a window that opens after the deposit shows a
    // withdrawal of more than it has seen arrive.
    const p = positionFor([buy(10, 900, '1'), { id: 'o', asset: 'USDT', kind: 'out', qty: 40, at: '2' }], 'USDT');
    ok('withdrawing more than the ledger has seen floors at zero, never negative',
      p.qty === 0, p.qty);
  }
  {
    // Order dependence is real, so state it: the same rows in the wrong order
    // give a different realised gain. This is why dedupeLedger sorts.
    const a = positionFor([buy(100, 9000, '1'), sell(100, 12000, '2')], 'USDT');
    const b = positionFor([sell(100, 12000, '2'), buy(100, 9000, '1')], 'USDT');
    ok('cost basis genuinely depends on order — the sort in dedupeLedger is load-bearing',
      !near(a.realised, b.realised), `${a.realised}/${b.realised}`);
  }
}

// --------------------------------------------------------------- positions
{
  const rows = [
    { id: '1', asset: 'USDT', kind: 'buy', qty: 100, fiatQty: 9000, at: '1' },
    { id: '2', asset: 'BTC', kind: 'buy', qty: 0.1, fiatQty: 600000, at: '2' },
    { id: '3', asset: 'USDT', kind: 'buy', qty: 100, fiatQty: 9500, at: '3' },
  ];
  const ps = positions(rows);
  ok('every asset in the ledger gets a position', ps.length === 2, ps.length);
  ok('positions are ordered by money at stake, largest first',
    ps[0].asset === 'BTC', ps.map(p => p.asset).join(','));
  ok('each position aggregates all of that asset\'s rows',
    ps.find(p => p.asset === 'USDT').qty === 200);
  ok('an empty ledger yields no positions', positions([]).length === 0 && positions(null).length === 0);
}

console.log(`${pass}/${pass + fail} passing`);
if (fail) process.exit(1);
