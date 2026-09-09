// Pure ledger maths for the Binance sync.
//
// Same reasoning as calendar-fold.mjs: this file holds the parts of the Binance
// worker that can be wrong without anything going red. A failed API call throws
// and shows up in the Actions log inside a minute. A wrong *cost basis* renders
// as a perfectly plausible number — you will read "+34%" and believe it, and the
// only way you find out it was wrong is by doing the arithmetic yourself, which
// is the thing the dashboard exists to stop you having to do.
//
// So the maths lives here, exported, and tests/binance-ledger.test.js walks it.
//
// NOTHING IN THIS FILE TALKS TO THE NETWORK. It takes already-fetched rows and
// turns them into a ledger and a position. That separation is deliberate: it is
// what makes the risky half testable without an API key.

// ---------------------------------------------------------------------------
// Normalisation
//
// Binance hands back five different shapes for what are, economically, the same
// three events: crypto came in, crypto went out, crypto changed hands for fiat.
// Spot trades, P2P orders, deposits, withdrawals and Convert each have their own
// field names, their own idea of which side is "amount", and their own units.
// Everything downstream works on ONE row shape so the maths is written once.
//
//   { id, source, kind, asset, qty, fiat, fiatQty, price, fee, feeAsset, at, note }
//
// kind is one of: 'buy' | 'sell' | 'in' | 'out'
//   buy/sell — crypto traded against fiat or a quote asset; affects cost basis.
//   in/out   — crypto moved without a price being established (a transfer, an
//              airdrop, an earn payout). Affects quantity, never average cost.
//
// That distinction is the single most important thing in this file. A transfer
// in, treated as a buy at zero, drags your average cost to nothing and reports a
// gain you never made.

const num = (v) => {
  // Binance returns numbers as strings, sometimes with trailing zeros, and
  // occasionally as null for a field that does not apply to that order type.
  // Number('') is 0, which would silently turn "no fee recorded" into "zero fee"
  // — true by luck here, but the same coercion turns a missing quantity into a
  // real zero, so it is rejected explicitly rather than relied upon.
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : 0;
};

const ms = (v) => {
  const n = num(v);
  if (!n) return null;
  // Binance timestamps are milliseconds. A ten-digit value is seconds and would
  // otherwise date every P2P order to 1970, which sorts the whole ledger wrong.
  return new Date(n < 1e12 ? n * 1000 : n).toISOString();
};

/**
 * A completed P2P (C2C) order.
 *
 * This is the one Neel actually uses to get INR in and out, so it is the one
 * that matters most and the one with the most treacherous field names. Binance
 * calls the crypto quantity `amount` and the rupee total `totalPrice`, which is
 * the opposite of what both words suggest to a reader. Getting them the wrong
 * way round produces a cost basis off by a factor of roughly the BTC price, and
 * the resulting number still looks like money.
 *
 * Only COMPLETED orders count. A cancelled or in-appeal order has not moved any
 * coins, and counting one inflates the position by an amount that never arrives.
 */
export function normalizeP2P(o) {
  if (!o) return null;
  const status = String(o.orderStatus ?? '').toUpperCase();
  if (status && status !== 'COMPLETED') return null;

  const side = String(o.tradeType ?? '').toUpperCase();
  if (side !== 'BUY' && side !== 'SELL') return null;

  const qty = num(o.amount);          // crypto
  const fiatQty = num(o.totalPrice);  // rupees
  if (qty <= 0) return null;

  return {
    id: `p2p:${o.orderNumber ?? o.advNo ?? ''}`,
    source: 'p2p',
    kind: side === 'BUY' ? 'buy' : 'sell',
    asset: String(o.asset ?? '').toUpperCase(),
    qty,
    fiat: String(o.fiat ?? 'INR').toUpperCase(),
    fiatQty,
    // Trust the derived price over Binance's `unitPrice` when both exist and
    // disagree: totalPrice and amount are what actually settled, unitPrice is
    // what the advert said, and partial fills make them differ.
    price: qty ? fiatQty / qty : num(o.unitPrice),
    fee: num(o.commission),
    feeAsset: String(o.asset ?? '').toUpperCase(),
    at: ms(o.createTime),
    note: `P2P ${side.toLowerCase()}`,
  };
}

/**
 * A spot trade. `symbol` is the pair (BTCUSDT); `base`/`quote` must be supplied
 * by the caller, because the API does not split them and "BTCUSDT" cannot be
 * split by string rules alone — BTCUSDT and ETHBTC both end in a three-letter
 * asset, and a naive slice gets one of them wrong.
 */
export function normalizeTrade(t, base, quote) {
  if (!t) return null;
  const qty = num(t.qty);
  if (qty <= 0) return null;
  const price = num(t.price);
  return {
    id: `trade:${t.symbol ?? ''}:${t.id ?? ''}`,
    source: 'spot',
    kind: t.isBuyer ? 'buy' : 'sell',
    asset: String(base ?? '').toUpperCase(),
    qty,
    fiat: String(quote ?? '').toUpperCase(),
    fiatQty: num(t.quoteQty) || qty * price,
    price,
    fee: num(t.commission),
    feeAsset: String(t.commissionAsset ?? '').toUpperCase(),
    at: ms(t.time),
    note: `Spot ${t.isBuyer ? 'buy' : 'sell'} ${t.symbol ?? ''}`,
  };
}

/**
 * A deposit or a withdrawal. No price is established by either, so these are
 * 'in'/'out' and are deliberately incapable of moving the average cost.
 *
 * Only settled rows count. Binance's deposit status 1 is "success"; withdrawal
 * status 6 is "completed". A pending deposit that is counted and then fails
 * leaves a phantom balance that no reconciliation will ever explain.
 */
export function normalizeFlow(r, kind) {
  if (!r) return null;
  const qty = num(r.amount);
  if (qty <= 0) return null;
  const st = num(r.status);
  if (kind === 'in' && st !== 1) return null;
  if (kind === 'out' && st !== 6) return null;
  return {
    id: `${kind === 'in' ? 'dep' : 'wd'}:${r.txId ?? r.id ?? ''}`,
    source: kind === 'in' ? 'deposit' : 'withdrawal',
    kind,
    asset: String(r.coin ?? '').toUpperCase(),
    qty,
    fiat: '',
    fiatQty: 0,
    price: 0,
    fee: num(r.transactionFee),
    feeAsset: String(r.coin ?? '').toUpperCase(),
    at: ms(r.insertTime ?? r.applyTime ?? r.completeTime),
    note: kind === 'in' ? 'Deposit' : 'Withdrawal',
  };
}

/**
 * Drop rows we already have, and rows that carry no usable identity.
 *
 * Every sync re-fetches an overlapping window on purpose — a job that only asked
 * for "since last run" loses everything that happened during a failed run, and
 * failed runs are exactly when you are not watching. Overlap plus dedupe is the
 * cheap way to be crash-safe. Which makes this function load-bearing: without
 * it, every sync double-counts the overlap and the position grows on its own.
 */
export function dedupeLedger(rows) {
  const seen = new Set();
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    // An id ending in ':' means Binance gave us no order number for that row.
    // Keeping it would collide with every other id-less row of the same source
    // and silently swallow real transactions, so it is dropped and counted.
    if (!r || !r.id || String(r.id).endsWith(':') || !r.asset) continue;
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  // Oldest first. Cost basis is order-dependent, so this sort is not cosmetic —
  // it is a precondition of positionFor() being correct at all.
  return out.sort((a, b) => String(a.at ?? '').localeCompare(String(b.at ?? '')));
}

/**
 * Weighted-average cost basis for one asset, walked oldest to newest.
 *
 * WAC rather than FIFO, and the choice is worth stating: FIFO is what Indian
 * capital-gains rules want for a realised-gain filing, WAC is what answers "am I
 * up on this coin", and this dashboard is answering the second question. The
 * ledger keeps every row, so a FIFO pass can be added later over the same data
 * without a re-sync.
 *
 * The rule that matters: a SELL reduces quantity and realises a gain, but does
 * NOT change the average cost of what is left. Selling half a position at a
 * profit does not make the remaining half more expensive. Getting this wrong is
 * the classic portfolio-maths bug and it flatters you every single time, which
 * is why it survives so long unnoticed.
 */
export function positionFor(rows, asset) {
  const A = String(asset ?? '').toUpperCase();
  let qty = 0;        // units held
  let cost = 0;       // total fiat paid for the units currently held
  let realised = 0;   // fiat gain/loss booked by sells
  let invested = 0;   // gross fiat ever put in
  let returned = 0;   // gross fiat ever taken out

  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || String(r.asset ?? '').toUpperCase() !== A) continue;
    const q = num(r.qty);
    if (q <= 0) continue;

    if (r.kind === 'buy') {
      qty += q;
      cost += num(r.fiatQty);
      invested += num(r.fiatQty);
    } else if (r.kind === 'sell') {
      // Cannot sell more than the ledger says is held. This happens for real —
      // a window that starts after the buy — and clamping keeps the average
      // sane instead of producing a negative position and a nonsense basis.
      const sold = Math.min(q, qty);
      const avg = qty > 0 ? cost / qty : 0;
      realised += num(r.fiatQty) - sold * avg;
      returned += num(r.fiatQty);
      cost -= sold * avg;   // average untouched: cost and qty fall together
      qty -= sold;
      if (qty <= 1e-12) { qty = 0; cost = 0; }  // fully out: no residue
    } else if (r.kind === 'in') {
      // Quantity up, cost unchanged — which mathematically LOWERS the average.
      // That is correct and not a bug: coins that arrived free did arrive free.
      qty += q;
    } else if (r.kind === 'out') {
      qty = Math.max(0, qty - q);
      if (qty === 0) cost = 0;
    }
  }

  return {
    asset: A,
    qty,
    cost,
    avgCost: qty > 0 ? cost / qty : 0,
    realised,
    invested,
    returned,
  };
}

/** Every asset the ledger mentions, each with its position. */
export function positions(rows) {
  const assets = [...new Set((Array.isArray(rows) ? rows : [])
    .map(r => String(r?.asset ?? '').toUpperCase()).filter(Boolean))];
  return assets
    .map(a => positionFor(rows, a))
    .sort((a, b) => b.cost - a.cost || a.asset.localeCompare(b.asset));
}

/**
 * A Binance Convert — the "swap USDT for BTC" flow, not a spot trade.
 *
 * This is how the account actually acquired everything it holds: one P2P buy of
 * USDT, then converts into BTC, SOL and SXT. The sync never read them, which is
 * why three assets show a held quantity and no cost behind it.
 *
 * A convert is two movements and is recorded as two rows, because that is what
 * happened: the from-asset left and the to-asset arrived.
 *
 * WHAT IT DELIBERATELY DOES NOT DO IS INVENT A RUPEE PRICE.
 *
 * A convert has no fiat leg. USDT→BTC is priced in USDT, and turning that into
 * rupees means choosing a USDT/INR rate — and any rate chosen here would be a
 * guess dressed as a measurement, which is the one thing this ledger refuses to
 * do anywhere else (see avgCost null for a position with no basis). So the legs
 * carry `quoteAsset` and `quoteQty`, and the rupee question is answered further
 * up by whoever knows the rate that was actually paid.
 */
export function normalizeConvert(c) {
  if (!c) return null;
  const status = String(c.orderStatus ?? '').toUpperCase();
  if (status && status !== 'SUCCESS') return null;

  const from = String(c.fromAsset ?? '').toUpperCase();
  const to = String(c.toAsset ?? '').toUpperCase();
  const fromQty = num(c.fromAmount);
  const toQty = num(c.toAmount);
  if (!from || !to || fromQty <= 0 || toQty <= 0) return null;

  const at = ms(c.createTime);
  const id = String(c.orderId ?? c.quoteId ?? `${from}${to}${c.createTime ?? ''}`);
  const base = { source: 'convert', fiat: '', fiatQty: 0, price: 0, fee: 0, feeAsset: '', at };

  return [
    // `out`/`in` rather than sell/buy: positionFor treats those as quantity
    // movements that do not claim a fiat value, which is exactly the truth here.
    { ...base, id: `convert:${id}:out`, kind: 'out', asset: from, qty: fromQty,
      quoteAsset: to, quoteQty: toQty, note: `Converted to ${to}` },
    { ...base, id: `convert:${id}:in`, kind: 'in', asset: to, qty: toQty,
      quoteAsset: from, quoteQty: fromQty, note: `Converted from ${from}` },
  ];
}

/**
 * The only question that can be answered honestly across a whole account:
 * how much money went in, how much came out, and what is it worth now.
 *
 * Per-asset cost basis breaks down the moment a convert is involved, because
 * the chain USDT→BTC has no rupee leg. But "did I make money" does not need it:
 * rupees in and rupees out are both directly observed — P2P orders and fiat
 * deposits and withdrawals — and today's value is a live price.
 *
 *   net = valueNow + out - in
 *
 * `valueNow` is supplied by the caller because pricing is a network call and
 * this file is pure. When it is unknown the totals are still returned with
 * `valued: false`, so the caller shows what it knows rather than a zero.
 */
export function sinceInception(rows, { valueNow = null } = {}) {
  let inFiat = 0, outFiat = 0, firstAt = null, lastAt = null;
  let p2pBuys = 0, p2pSells = 0, deposits = 0, withdrawals = 0, converts = 0;

  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r) continue;
    // `at` is an ISO STRING here — ms() converts on the way in, so every other
    // row in this file carries a string. Reading it as a number gave 0 for every
    // row and reported the whole account as undated. ISO strings sort correctly
    // as strings, which is the reason that format was chosen.
    // Tolerant of a raw epoch too. Every row that comes through a normalizer is
    // already ISO, but a row assembled by hand somewhere else should not silently
    // drop out of the date range.
    const at = typeof r.at === 'string' ? r.at
      : (Number.isFinite(r.at) && r.at > 0 ? new Date(r.at).toISOString() : null);
    if (at) {
      if (firstAt == null || at < firstAt) firstAt = at;
      if (lastAt == null || at > lastAt) lastAt = at;
    }
    if (r.source === 'convert') { if (r.kind === 'in') converts++; continue; }

    const fiatQty = num(r.fiatQty);
    // Only rows with a REAL fiat leg move these totals. A convert has none, and
    // counting one at zero would quietly say money moved and it was free.
    if (!fiatQty) continue;

    if (r.kind === 'buy') { inFiat += fiatQty; if (r.source === 'p2p') p2pBuys++; }
    else if (r.kind === 'sell') { outFiat += fiatQty; if (r.source === 'p2p') p2pSells++; }
    else if (r.kind === 'in') { inFiat += fiatQty; deposits++; }
    else if (r.kind === 'out') { outFiat += fiatQty; withdrawals++; }
  }

  const valued = typeof valueNow === 'number' && Number.isFinite(valueNow);
  const net = valued ? valueNow + outFiat - inFiat : null;
  return {
    in: inFiat,
    out: outFiat,
    valueNow: valued ? valueNow : null,
    net,
    pct: valued && inFiat > 0 ? (net / inFiat) * 100 : null,
    valued,
    firstAt,
    lastAt,
    counts: { p2pBuys, p2pSells, deposits, withdrawals, converts },
  };
}

/**
 * A fiat ORDER — money moving between a bank account and Binance in rupees.
 *
 * /sapi/v1/fiat/orders, transactionType 0 = deposit, 1 = withdrawal.
 *
 * This is the on-ramp that existed before P2P, and for an account opened in
 * 2021 or 2022 it is where the money actually went in. Nothing was reading it,
 * so "put in" counted only P2P buys — which for an older account is close to
 * counting none of it.
 */
export function normalizeFiatOrder(o, kind) {
  if (!o) return null;
  // "Successful" is the completed state here; anything else has not settled and
  // counting it would report money that never arrived.
  const status = String(o.status ?? '').toLowerCase();
  if (status && !['successful', 'finished', 'completed'].includes(status)) return null;
  const amount = num(o.indicatedAmount ?? o.amount);
  if (amount <= 0) return null;
  return {
    id: `fiat:${kind}:${o.orderNo ?? ''}`,
    source: kind === 'in' ? 'fiat-deposit' : 'fiat-withdrawal',
    kind,
    // The ASSET is the fiat currency itself: this row is rupees arriving, not
    // crypto. It carries a fiatQty so the money totals see it, and a qty so the
    // row is well-formed, and those are the same number.
    asset: String(o.fiatCurrency ?? 'INR').toUpperCase(),
    qty: amount,
    fiat: String(o.fiatCurrency ?? 'INR').toUpperCase(),
    fiatQty: amount,
    price: 1,
    fee: num(o.totalFee),
    feeAsset: String(o.fiatCurrency ?? 'INR').toUpperCase(),
    at: ms(o.createTime ?? o.updateTime),
    note: kind === 'in' ? 'Bank deposit' : 'Bank withdrawal',
  };
}

/**
 * A fiat PAYMENT — buying or selling crypto directly with rupees (card, bank).
 *
 * /sapi/v1/fiat/payments, transactionType 0 = buy, 1 = sell.
 *
 * Unlike a convert, this one HAS a real fiat leg, so it is a proper buy or sell
 * and carries a rupee price. It is the cleanest cost basis there is: rupees on
 * one side, coins on the other, both stated by Binance.
 */
export function normalizeFiatPayment(p, kind) {
  if (!p) return null;
  const status = String(p.status ?? '').toLowerCase();
  if (status && !['completed', 'successful', 'finished'].includes(status)) return null;
  const qty = num(p.obtainAmount);        // crypto received (or sold)
  const fiatQty = num(p.sourceAmount);    // rupees paid (or received)
  if (qty <= 0 || fiatQty <= 0) return null;
  return {
    id: `fiatpay:${kind}:${p.orderNo ?? ''}`,
    source: 'fiat-payment',
    kind: kind === 'buy' ? 'buy' : 'sell',
    asset: String(p.cryptoCurrency ?? '').toUpperCase(),
    qty,
    fiat: String(p.fiatCurrency ?? 'INR').toUpperCase(),
    fiatQty,
    price: qty ? fiatQty / qty : num(p.price),
    fee: num(p.totalFee),
    feeAsset: String(p.fiatCurrency ?? 'INR').toUpperCase(),
    at: ms(p.createTime ?? p.updateTime),
    note: kind === 'buy' ? 'Bought with INR' : 'Sold for INR',
  };
}

/**
 * LD-prefixed tokens are not coins — they are a Simple Earn receipt.
 *
 * Measured on this account: /api/v3/account returned LDBTC, LDSOL and LDSXT and
 * nothing else, which is the BTC/SOL/SXT sitting in Flexible Earn. Left alone
 * they price at zero (there is no LDBTCUSDT pair) and never reconcile against a
 * ledger that records converts into BTC.
 *
 * The `{2,}` matters: LDO is Lido DAO, a real token, and stripping two letters
 * from it would invent a holding in something called "O".
 */
export const unwrapLD = asset => {
  const a = String(asset || '').toUpperCase();
  return /^LD[A-Z0-9]{2,}$/.test(a) ? a.slice(2) : a;
};

export const isLDReceipt = asset => unwrapLD(asset) !== String(asset || '').toUpperCase();
