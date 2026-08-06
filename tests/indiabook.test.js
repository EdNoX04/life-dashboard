// Pins the currency arithmetic that the rest of the Money tab was getting
// wrong, plus the SIP-cadence and remittance-cost facts from the 2026-08-06
// broker scan. Every anchor here is a hand-typed literal rather than a value
// re-derived from the module, so the suite cannot agree with a broken module.

import {
  BASE, CURRENCIES, num, currencyOf, symbolOf, convert, splitByCurrency,
  nativeTotals, mixedTotals,
  SIP_FREQS, freqOf, SIP_STATES, sipStateOf, sipRunRate, sipDisagreement,
  remittanceCost, remittanceSummary, batchingGain, REMIT_NOTE, DISCLAIMER,
} from '../src/lib/indiabook.js';

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; } else { fail++; console.log('FAIL ' + name); } };
const eq = (a, b, name) => ok(a === b, `${name} (got ${a}, want ${b})`);
const near = (a, b, name, tol = 1e-6) =>
  ok(a != null && Math.abs(a - b) < tol, `${name} (got ${a}, want ~${b})`);

// ---------------------------------------------------------------- basics
eq(BASE, 'USD', 'base is USD');
eq(symbolOf('INR'), '₹', 'INR symbol');
eq(symbolOf('USD'), '$', 'USD symbol');
eq(symbolOf('ZZZ'), '$', 'unknown currency falls back to $');
eq(num('x'), null, 'num rejects non-numeric');
eq(num('3.5'), 3.5, 'num parses numeric strings');

// A row with no currency is a US row — the whole legacy book depends on this.
eq(currencyOf({ ticker: 'NVDA' }), 'USD', 'missing currency reads as USD');
eq(currencyOf({ currency: 'inr' }), 'INR', 'currency is case-insensitive');
eq(currencyOf({ currency: 'EUR' }), 'USD', 'unsupported currency falls back to USD');

// -------------------------------------------------------------- convert
eq(convert(100, 'USD', 'USD', null), 100, 'same-currency needs no rate');
near(convert(1, 'USD', 'INR', 96.33), 96.33, 'USD to INR multiplies');
near(convert(96.33, 'INR', 'USD', 96.33), 1, 'INR to USD divides');
eq(convert(100, 'USD', 'INR', null), null, 'no rate returns null, not the input');
eq(convert(100, 'USD', 'INR', 0), null, 'a zero rate is refused');
eq(convert(100, 'USD', 'INR', -5), null, 'a negative rate is refused');
eq(convert('x', 'USD', 'USD', 1), null, 'non-numeric amount returns null');

// ------------------------------------------------------- the actual book
// The real scanned position. GOLDBEES was landing as $367 before this existed.
const BOOK = [
  { ticker: 'NVDA', qty: 2, avg_cost: 100, currency: 'USD' },
  { ticker: 'GOLDBEES', qty: 3, avg_cost: 117.62, currency: 'INR' },
];
const price = h => (h.ticker === 'GOLDBEES' ? 122.48 : 110);

const split = splitByCurrency(BOOK);
eq(split.USD.length, 1, 'split isolates USD');
eq(split.INR.length, 1, 'split isolates INR');

const nat = nativeTotals(BOOK, price);
eq(nat.length, 2, 'two currency groups');
eq(nat[0].code, 'INR', 'groups sort by code, INR first');
near(nat[0].value, 367.44, 'INR group value is 3 x 122.48 in rupees');
near(nat[0].cost, 352.86, 'INR group cost is 3 x 117.62 in rupees');
near(nat[0].unrealisedPct, 4.131950348580169, 'INR group return', 1e-6);
near(nat[1].value, 220, 'USD group value stays in dollars');

const mix = mixedTotals(BOOK, price, { fx: 96.33 });
ok(mix.mixed === true, 'book is flagged mixed');
ok(mix.missingFx === false, 'fx present');
// 220 + 367.44/96.33 = 220 + 3.8143... The pre-fix bug gave 587.44.
near(mix.value, 223.8143879, 'combined value converts INR at the rate', 1e-5);
ok(mix.value < 224, 'combined value is NOT the naive 587.44 sum');
near(mix.cost, 203.6630333, 'combined cost converts too', 1e-5);
ok(mix.note.includes('96.33'), 'note states the rate used');

// Decision 2: refuse to sum rather than sum wrong.
const noFx = mixedTotals(BOOK, price, { fx: null });
eq(noFx.value, null, 'no rate means no combined value');
eq(noFx.unrealised, null, 'no rate means no combined return');
ok(noFx.missingFx === true, 'missingFx is flagged');
eq(noFx.groups.length, 2, 'per-currency groups survive a missing rate');
near(noFx.groups[0].value, 367.44, 'per-currency figures are still exact');
ok(/rate has not loaded/.test(noFx.note), 'note explains the refusal');

// A single-currency book needs no rate at all — the old behaviour must survive.
const usOnly = mixedTotals([BOOK[0]], price, { fx: null });
eq(usOnly.missingFx, false, 'US-only book does not need a rate');
near(usOnly.value, 220, 'US-only total is unchanged');
eq(usOnly.mixed, false, 'US-only book is not mixed');
eq(usOnly.note, null, 'US-only book carries no conversion note');

// Partial cost basis withholds the return rather than computing off part of it.
const partial = nativeTotals(
  [{ ticker: 'A', qty: 1, avg_cost: 10, currency: 'USD' },
   { ticker: 'B', qty: 1, currency: 'USD' }], () => 20);
eq(partial[0].cost, null, 'partial cost basis yields no group cost');
eq(partial[0].unrealisedPct, null, 'partial cost basis yields no return');
near(partial[0].value, 40, 'value is still summed when cost is not');

// ------------------------------------------------------------------ SIPs
eq(SIP_FREQS.length, 5, 'five cadences');
eq(freqOf('daily').runsPerYear, 250, 'daily is 250 trading days, not 365');
eq(freqOf('weekly').runsPerYear, 52, 'weekly runs 52');
eq(freqOf('monthly').runsPerYear, 12, 'monthly runs 12');
eq(freqOf('DAILY').key, 'daily', 'freq lookup is case-insensitive');
eq(freqOf('hourly'), null, 'unknown cadence is null, not a default');

eq(sipStateOf('6th sip upcoming').key, 'running', 'upcoming reads as running');
eq(sipStateOf('Sip setup failed').key, 'failed', 'setup failed reads as failed');
eq(sipStateOf('').key, 'unknown', 'empty status is unknown');
eq(sipStateOf('paused by user').key, 'paused', 'paused reads as paused');
eq(SIP_STATES.failed.color, 'var(--red)', 'failure is red');

// The scanned SIP.
const SIP = { ticker: 'GOLDBEES', amount: 123, freq: 'daily', broker: 'INDstocks', status: '6th sip upcoming' };
const rate = sipRunRate(SIP);
near(rate.perYear, 30750, 'daily 123 is 30750/yr');
near(rate.perMonth, 2562.5, 'daily 123 is 2562.50/mo');
eq(sipRunRate({ amount: 123 }), null, 'a SIP with no cadence has no run rate');
eq(sipRunRate({ freq: 'daily' }), null, 'a SIP with no amount has no run rate');

// Decision 4 — the fact that prompted this whole screen.
const dis = sipDisagreement(SIP, 'weekly');
ok(dis !== null, 'daily vs believed-weekly disagrees');
eq(dis.reported.key, 'daily', 'reported cadence is the broker-s');
eq(dis.believed.key, 'weekly', 'believed cadence is the user-s');
near(dis.ratio, 250 / 52, 'ratio is reported over believed');
ok(dis.text.includes('more often'), 'disagreement text names the direction');
eq(sipDisagreement(SIP, 'daily'), null, 'agreement returns null');
eq(sipDisagreement(SIP, null), null, 'no belief means no disagreement');
// Direction must invert, not just report a ratio below 1.
const inv = sipDisagreement({ freq: 'monthly' }, 'daily');
ok(inv.text.includes('less often'), 'a slower reported cadence reads as less often');

// ----------------------------------------------------------- remittance
// The verified 06-Aug receipt: 1600 in, 45 GST, 0 TCS, 16.14 out.
const R = { date: '2026-08-06', inr: 1600, usd: 16.14, gst: 45, tcs: 0, txn: '10652273' };
const rc = remittanceCost(R, null);
near(rc.appliedRate, (1600 - 45) / 16.14, 'applied rate nets tax off before dividing', 1e-9);
eq(rc.spreadInr, null, 'without interbank the spread is unknown, not zero');
eq(rc.floor, true, 'a tax-only figure is flagged as a floor');
near(rc.taxInr, 45, 'tax is GST plus TCS');
near(rc.dragPct, 2.8125, 'tax-only drag on 1600 is 2.81%');

const rc2 = remittanceCost(R, 94);
eq(rc2.floor, false, 'with interbank it is not a floor');
ok(rc2.spreadInr > 0, 'the applied rate is worse than interbank');
ok(rc2.dragPct > rc.dragPct, 'including spread raises the drag');
eq(remittanceCost({ inr: 0, usd: 1 }), null, 'a zero transfer is not a remittance');
eq(remittanceCost({ inr: 1600 }), null, 'a transfer with no USD leg is refused');

const sum = remittanceSummary([R, { ...R, inr: 1600, usd: 16.14 }], null);
eq(sum.count, 2, 'two remittances');
near(sum.inr, 3200, 'totals sum the rupees');
near(sum.avgTransfer, 1600, 'average transfer');
eq(sum.floor, true, 'floor propagates to the summary');
eq(remittanceSummary([], null), null, 'no remittances means no summary');

const bg = batchingGain(sum, 25000);
near(bg.fromPct, 2.8125, 'batching starts from the current drag');
near(bg.toPct, 0.18, 'a 25000 transfer pays 45 tax = 0.18%');
ok(bg.savedPctPoints > 2.6, 'batching recovers most of the drag');
eq(batchingGain(sum, 1000), null, 'a smaller target is not a gain');
eq(batchingGain(null, 25000), null, 'no summary means no gain');

ok(REMIT_NOTE.includes('no per-order brokerage'), 'the note states what is not charged');
ok(DISCLAIMER.length > 20 && !/advice/i.test(DISCLAIMER.replace(/not advice/i, '')), 'disclaimer disclaims');

console.log(`${pass}/${pass + fail} passing`);
if (fail) process.exit(1);
