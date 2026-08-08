// Pins the currency arithmetic that the rest of the Money tab was getting
// wrong, plus the SIP-cadence and remittance-cost facts from the 2026-08-06
// broker scan. Every anchor here is a hand-typed literal rather than a value
// re-derived from the module, so the suite cannot agree with a broken module.

import {
  BASE, CURRENCIES, num, currencyOf, symbolOf, convert, splitByCurrency,
  nativeTotals, mixedTotals,
  SIP_FREQS, freqOf, SIP_STATES, sipStateOf, sipRunRate, sipDisagreement,
  remittanceCost, remittanceSummary, batchingGain, REMIT_NOTE, DISCLAIMER,
  DESKS, deskOf, splitSips, sipLoad, flatTaxWarning,
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
// The silent, large failure this guards: a row written before the currency field
// existed puts a 122-RUPEE holding into a dollar table at 122 DOLLARS.
eq(currencyOf({ ticker: 'GOLDBEES' }), 'INR', 'a known Indian ticker is INR even with no currency field');
eq(currencyOf({ ticker: 'goldbees' }), 'INR', 'case-insensitively');
eq(currencyOf({ ticker: 'NIFTYBEES' }), 'INR', 'and other Indian ETFs');
eq(currencyOf({ ticker: 'NVDA' }), 'USD', 'an unlisted ticker still defaults to USD');
// The row always wins over the list — the list is a fallback, not an override.
eq(currencyOf({ ticker: 'GOLDBEES', currency: 'USD' }), 'USD',
  'an explicit currency beats the known-ticker list');
eq(currencyOf({ sym: 'GOLDBEES' }), 'INR', 'the crypto-style `sym` field is read too');

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

// ------------------------------------------------------------ desk routing
// The reported bug: QQQ appeared on the India desk. Both US plans are funded in
// RUPEES, so funding currency cannot be what decides — the asset does.
const QQQ  = { ticker: 'QQQ',  amount: 500, currency: 'INR', asset_currency: 'USD', freq: 'weekly',  account: 'INDmoney US', status: 'active' };
const META = { ticker: 'META', amount: 500, currency: 'INR', asset_currency: 'USD', freq: 'monthly', account: 'INDmoney US', status: 'active' };
const GB   = { ticker: 'GOLDBEES', amount: 123, currency: 'INR', asset_currency: 'INR', freq: 'daily', account: 'INDstocks', status: '6th sip upcoming' };
const GBX  = { ...GB, status: 'Sip setup failed' };

eq(deskOf(QQQ).key, 'us', 'a rupee-funded SIP that buys US stock is a US SIP');
eq(deskOf(GB).key, 'india', 'a rupee-funded SIP that buys an Indian ETF is an Indian SIP');
eq(DESKS.us.label, 'INDmoney US', 'the US desk is named for the account');
// Funding currency is identical on both, so it cannot be the discriminator.
eq(QQQ.currency, GB.currency, 'both plans are funded in the same currency');
ok(deskOf(QQQ).key !== deskOf(GB).key, 'identical funding currency still routes to different desks');
// Account name is the fallback when the scan did not record an asset currency.
eq(deskOf({ account: 'INDmoney US' }).key, 'us', 'account name routes when asset currency is absent');
eq(deskOf({ account: 'INDstocks' }).key, 'india', 'INDstocks account routes to India');
// Each signal must be load-bearing on its own, so each is probed with the
// others deliberately pointing the wrong way.
eq(deskOf({ asset_currency: 'USD', account: 'INDstocks', currency: 'INR' }).key, 'us',
  'asset currency outranks an account name that says otherwise');
eq(deskOf({ asset_currency: 'INR', account: 'INDmoney US' }).key, 'india',
  'an INR asset stays Indian even in a US-named account');
eq(deskOf({ account: 'INDmoney US', currency: 'INR' }).key, 'us',
  'a US account outranks rupee funding when no asset currency is recorded');

// Last resort only: funding currency.
eq(deskOf({ currency: 'INR' }).key, 'india', 'with nothing else, rupee funding falls back to India');
eq(deskOf({}).key, 'us', 'a bare row falls back to the US book, matching currencyOf');

const sp = splitSips([QQQ, GB, META, GBX]);
eq(sp.us.length, 2, 'two US plans');
eq(sp.india.length, 2, 'two Indian plans (one of them failed)');
eq(sp.us[0].ticker, 'QQQ', 'QQQ lands on the US desk, not the Indian one');
ok(!sp.india.some(x => x.ticker === 'QQQ'), 'QQQ does NOT appear on the India desk');
eq(splitSips([]).us.length, 0, 'both desk keys exist even when empty');
eq(splitSips([]).india.length, 0, 'an empty split still has an India key');

// ---------------------------------------------------------------- sip load
const loadUs = sipLoad([QQQ, META]);
eq(loadUs.count, 2, 'both US plans counted');
eq(loadUs.runsPerYear, 64, 'weekly 52 plus monthly 12 is 64 debits');
near(loadUs.perYear, 32000, '500 x 52 plus 500 x 12 is 32000 a year');
near(loadUs.perMonth, 32000 / 12, 'per month is the year over twelve');
eq(loadUs.taxPerYear, null, 'with no per-transfer tax the annual tax is null, not zero');
eq(loadUs.taxPct, null, 'with no per-transfer tax the drag is null, not zero');
// A failed plan is not a live commitment.
eq(sipLoad([GB, GBX]).count, 1, 'a failed SIP is excluded from the load');
eq(sipLoad([GBX]), null, 'a list of only failed SIPs has no load');
eq(sipLoad([]), null, 'no SIPs means no load');
// `smallest` must be the smallest, so the plans have to differ in size for the
// assertion to mean anything.
const mixedLoad = sipLoad([{ ...QQQ, amount: 500 }, { ...META, amount: 4000 }]);
near(mixedLoad.perYear, 74000, '500 weekly plus 4000 monthly is 74000 a year');
const flatMixed = flatTaxWarning(sum, mixedLoad);
near(flatMixed.smallest, 500, 'the warning uses the smallest run, not the largest');
near(flatMixed.dragAtSmallest, 9, 'drag is computed against the smallest run');

// 45 per transfer across 64 debits.
const loadTaxed = sipLoad([QQQ, META], 45);
near(loadTaxed.taxPerYear, 2880, '45 across 64 debits is 2880 a year');
near(loadTaxed.taxPct, 9, '2880 on 32000 invested is 9 percent');

// ------------------------------------------------------- flat tax warning
const flat = flatTaxWarning(sum, loadUs);
near(flat.perTransferTax, 45, 'the observed per-transfer tax is 45');
near(flat.smallest, 500, 'the smallest SIP run is 500');
near(flat.dragAtSmallest, 9, '45 on a 500 debit is 9 percent');
near(flat.dragObserved, 2.8125, '45 on the observed 1600 transfer is 2.81 percent');
ok(flat.dragAtSmallest > flat.dragObserved, 'a flat charge hurts the small transfer more');
eq(flat.sampleSize, 2, 'the sample size is carried so the UI can hedge');
eq(flat.unconfirmed, false, 'two receipts is no longer a single-sample guess');
eq(flatTaxWarning(remittanceSummary([R], null), loadUs).unconfirmed, true,
  'one receipt is flagged unconfirmed');
// No warning when the SIP is not smaller than what was actually observed.
const bigSip = sipLoad([{ ...QQQ, amount: 5000 }]);
eq(flatTaxWarning(sum, bigSip), null, 'a SIP larger than the observed transfer raises no warning');
eq(flatTaxWarning(null, loadUs), null, 'no summary means no warning');
eq(flatTaxWarning(sum, null), null, 'no load means no warning');

ok(REMIT_NOTE.includes('no per-order brokerage'), 'the note states what is not charged');
ok(DISCLAIMER.length > 20 && !/advice/i.test(DISCLAIMER.replace(/not advice/i, '')), 'disclaimer disclaims');

console.log(`${pass}/${pass + fail} passing`);
if (fail) process.exit(1);
