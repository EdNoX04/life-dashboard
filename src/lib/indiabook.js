// The Indian side of the book, and the currency arithmetic the rest of the tab
// has been quietly getting wrong.
//
// Until now every holding was summed as though it were dollars. That was true
// while the book was US-only, and it stopped being true the moment an INDstocks
// position appeared: GOLDBEES at an average cost of 117.62 rupees was being
// added to the portfolio total as $117.62, roughly eighty-eight times its real
// weight. The display toggle at the top of the tab does NOT fix this — it
// multiplies an already-wrong sum by the FX rate.
//
// Five decisions hold this together:
//
//   1. CURRENCY IS A PROPERTY OF THE HOLDING, NOT OF THE SCREEN. `currencyOf`
//      reads it off the row. The tab's ₹/$ toggle chooses how a TOTAL is
//      presented; it must never be used to decide what a native price means.
//      These are two different questions that happen to share two symbols.
//
//   2. A MIXED BOOK WITHOUT AN FX RATE DOES NOT GET SUMMED. `mixedTotals`
//      returns `value: null` and `missingFx: true` rather than falling back to
//      1.0 or to "just the USD part". A total that silently drops your Indian
//      holdings is worse than no total, because it looks like an answer.
//
//   3. NATIVE FIGURES STAY NATIVE. Conversion happens only when things are
//      added together. A per-holding row shows ₹117.62 because that is the
//      number on the broker's screen, and reconciling against the broker is the
//      only reason to look at a per-holding row.
//
//   4. SIP CADENCE IS WHAT THE BROKER REPORTS, NOT WHAT YOU REMEMBER. The
//      frequency is carried as data and `sipDisagreement` exists specifically to
//      surface the case where a recalled cadence and the reported one differ.
//      This is not a hypothetical: the 2026-08-06 scan found a SIP believed to
//      be weekly that the broker reports as daily.
//
//   5. THE COST OF A US TRADE MADE FROM INDIA IS ON THE REMITTANCE, NOT THE
//      TRADE. Every US order in the scanned ledger has a value equal to
//      qty x price to the cent, so per-order brokerage is genuinely zero and a
//      fee total built by summing order fees is structurally 0. `remittanceCost`
//      computes the real drag: GST plus the gap between the applied rate and
//      interbank.

export const BASE = 'USD';

export const CURRENCIES = {
  USD: { code: 'USD', symbol: '$', label: 'US Dollar' },
  INR: { code: 'INR', symbol: '₹', label: 'Indian Rupee' },
};

export const num = v => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// A row with no currency recorded is a US row. That is not a guess: every row
// written by the manual add form hard-codes 'USD', and the whole book predates
// the Indian account.
// Tickers that are Indian listings, used ONLY when the row itself does not say.
//
// This exists because the currency field is the single point of failure for the
// whole rupee/dollar split, and a row written before that field existed - or by
// a payload that has not been applied yet - carries nothing. The default is USD,
// which is right for the legacy book and catastrophically wrong for GOLDBEES: it
// puts a 122-rupee holding into a dollar table at 122 dollars.
//
// A short list of known Indian symbols is a stopgap, not a design. It is here
// because the failure it prevents is silent and large, and it costs nothing when
// the row IS labelled - the field always wins. Anything Indian that is not on
// this list still needs its currency set properly.
export const KNOWN_INR_TICKERS = new Set([
  'GOLDBEES', 'NIFTYBEES', 'BANKBEES', 'JUNIORBEES', 'LIQUIDBEES',
  'SILVERBEES', 'GOLDSHARE', 'SETFGOLD', 'HDFCGOLD', 'ICICIGOLD',
]);

export function currencyOf(row) {
  const c = String(row?.currency || '').toUpperCase();
  if (CURRENCIES[c]) return c;
  const t = String(row?.ticker || row?.sym || '').toUpperCase();
  if (KNOWN_INR_TICKERS.has(t)) return 'INR';
  return 'USD';
}

export function symbolOf(code) {
  return (CURRENCIES[String(code).toUpperCase()] || CURRENCIES.USD).symbol;
}

// fx is USD -> INR, the direction the tab already fetches. Returns null rather
// than throwing or defaulting, so callers are forced to decide what a missing
// rate means for them (decision 2).
export function convert(amount, from, to, fx) {
  const a = num(amount);
  if (a === null) return null;
  const f = String(from).toUpperCase(), t = String(to).toUpperCase();
  if (f === t) return a;
  const r = num(fx);
  if (r === null || r <= 0) return null;
  if (f === 'USD' && t === 'INR') return a * r;
  if (f === 'INR' && t === 'USD') return a / r;
  return null;
}

export function splitByCurrency(rows = []) {
  const out = {};
  rows.forEach(r => {
    const c = currencyOf(r);
    (out[c] || (out[c] = [])).push(r);
  });
  return out;
}

// Per-currency subtotals. These are always computable — no FX needed — which is
// why they are returned even when the combined total is not.
export function nativeTotals(rows = [], priceOf = () => 0) {
  const by = splitByCurrency(rows);
  return Object.keys(by).sort().map(code => {
    const list = by[code];
    let value = 0, cost = 0, costed = 0;
    list.forEach(h => {
      const qty = num(h.qty) || 0;
      value += qty * (num(priceOf(h)) || 0);
      const ac = num(h.avg_cost);
      if (ac !== null) { cost += qty * ac; costed += 1; }
    });
    // A cost basis that covers only some of the rows is not a cost basis for the
    // group, so the return is withheld rather than computed off a partial base.
    const full = costed === list.length && cost > 0;
    return {
      code,
      symbol: symbolOf(code),
      count: list.length,
      value,
      cost: full ? cost : null,
      unrealised: full ? value - cost : null,
      unrealisedPct: full ? ((value - cost) / cost) * 100 : null,
      rows: list,
    };
  });
}

export function mixedTotals(rows = [], priceOf = () => 0, { base = BASE, fx = null } = {}) {
  const groups = nativeTotals(rows, priceOf);
  const foreign = groups.filter(g => g.code !== base);
  const missingFx = foreign.length > 0 && (num(fx) === null || num(fx) <= 0);

  if (missingFx) {
    return {
      base, symbol: symbolOf(base), groups, missingFx: true,
      value: null, cost: null, unrealised: null, unrealisedPct: null,
      mixed: true,
      note: `Your book holds ${groups.length} currencies and the ${
        foreign.map(g => g.code).join('/')}→${base} rate has not loaded, so a combined total would be wrong. Per-currency figures below are exact.`,
    };
  }

  let value = 0, cost = 0, costOk = true;
  groups.forEach(g => {
    value += convert(g.value, g.code, base, fx);
    if (g.cost === null) costOk = false;
    else cost += convert(g.cost, g.code, base, fx);
  });

  return {
    base, symbol: symbolOf(base), groups, missingFx: false,
    mixed: groups.length > 1,
    value,
    cost: costOk ? cost : null,
    unrealised: costOk ? value - cost : null,
    unrealisedPct: costOk && cost > 0 ? ((value - cost) / cost) * 100 : null,
    note: groups.length > 1
      ? `Converted to ${base} at ${num(fx).toFixed(2)} to combine. Per-currency figures are unconverted.`
      : null,
  };
}

// ------------------------------------------------------------------- SIPs

// runsPerYear is what makes cadences comparable. It is the only honest way to
// answer "how much is this costing me a month" for a daily plan, and the daily
// figure uses 250 rather than 365 because a market SIP does not run on days the
// exchange is shut.
export const SIP_FREQS = [
  { key: 'daily', label: 'Daily', runsPerYear: 250 },
  { key: 'weekly', label: 'Weekly', runsPerYear: 52 },
  { key: 'fortnightly', label: 'Fortnightly', runsPerYear: 26 },
  { key: 'monthly', label: 'Monthly', runsPerYear: 12 },
  { key: 'quarterly', label: 'Quarterly', runsPerYear: 4 },
];

export function freqOf(key) {
  const k = String(key || '').toLowerCase();
  return SIP_FREQS.find(f => f.key === k) || null;
}

export const SIP_STATES = {
  running: { key: 'running', label: 'Running', color: 'var(--green)' },
  failed: { key: 'failed', label: 'Setup failed', color: 'var(--red)' },
  paused: { key: 'paused', label: 'Paused', color: 'var(--yellow)' },
  unknown: { key: 'unknown', label: 'Unknown', color: 'var(--ink-3)' },
};

// The broker writes free text ("6th sip upcoming", "Sip setup failed"), so the
// classifier reads it rather than requiring the scan to normalise it. Failure is
// checked before success because "sip setup failed" contains neither word
// exclusively and the failing case is the one that must not be missed.
export function sipStateOf(status) {
  const s = String(status || '').toLowerCase();
  if (!s) return SIP_STATES.unknown;
  if (s.includes('fail') || s.includes('reject')) return SIP_STATES.failed;
  if (s.includes('pause') || s.includes('stopp')) return SIP_STATES.paused;
  if (s.includes('upcoming') || s.includes('active') || s.includes('running')) return SIP_STATES.running;
  return SIP_STATES.unknown;
}

export function sipRunRate(sip) {
  const amt = num(sip?.amount);
  const f = freqOf(sip?.freq);
  if (amt === null || !f) return null;
  const perYear = amt * f.runsPerYear;
  return {
    freq: f,
    perRun: amt,
    perYear,
    perMonth: perYear / 12,
    perWeek: perYear / 52,
  };
}

// Decision 4. `believed` is what the user said out loud; `freq` is what the
// broker reports. Returning null when they agree keeps the caller from having to
// know which direction the comparison runs.
export function sipDisagreement(sip, believed) {
  const rep = freqOf(sip?.freq);
  const bel = freqOf(believed);
  if (!rep || !bel || rep.key === bel.key) return null;
  const ratio = rep.runsPerYear / bel.runsPerYear;
  return {
    reported: rep,
    believed: bel,
    ratio,
    text: `You described this as ${bel.label.toLowerCase()}, but ${
      sip.broker || 'the broker'} reports it as ${rep.label.toLowerCase()} — ${
      ratio > 1 ? `${ratio.toFixed(0)}x more often` : `${(1 / ratio).toFixed(0)}x less often`
    } than you think.`,
  };
}

// ---------------------------------------------------- which desk owns a SIP
//
// A SIP has two currencies and they are not the same thing. Both US plans debit
// RUPEES — INDmoney takes 500 rupees, remits it, and buys dollars of QQQ. So
// "the SIP is in rupees" is true of every plan here and tells you nothing about
// where it belongs. What decides the desk is the ASSET: QQQ is a US holding
// bought through the US account, and it belongs on the US screen next to the
// rest of the US book, however it was funded.
//
// Getting this wrong is what put QQQ on the India desk. The India screen was
// handed the whole `sips` blob and rendered all of it, on the unexamined
// assumption that a rupee SIP is an Indian SIP.
export const DESKS = {
  india: { key: 'india', label: 'INDstocks', currency: 'INR' },
  us: { key: 'us', label: 'INDmoney US', currency: 'USD' },
};

// asset_currency is the authority when the scan recorded it. Failing that the
// account name decides, and failing that we fall back to the funding currency —
// which is only ever right by luck, so it is last.
export function deskOf(sip) {
  const ac = String(sip?.asset_currency || '').toUpperCase();
  if (ac === 'USD') return DESKS.us;
  if (ac === 'INR') return DESKS.india;
  const acct = String(sip?.account || sip?.broker || '').toLowerCase();
  if (acct.includes('us')) return DESKS.us;
  if (acct.includes('indstocks')) return DESKS.india;
  return currencyOf(sip) === 'INR' ? DESKS.india : DESKS.us;
}

// Returns every desk's list, always both keys, so a caller never has to guard
// for an absent side.
export function splitSips(sips = []) {
  const out = { india: [], us: [] };
  for (const s of sips) out[deskOf(s).key].push(s);
  return out;
}

// Every SIP here is denominated in rupees, including the ones that buy US
// stock. That makes a SIP schedule a remittance schedule: if the per-transfer
// cost is flat rather than proportional then cadence, not amount, sets the
// annual fee bill.
export function sipLoad(sips = [], perTransferTax = null) {
  const live = sips.filter(s => sipStateOf(s.status).key !== 'failed');
  const rows = live.map(s => ({ sip: s, rate: sipRunRate(s) })).filter(x => x.rate);
  if (!rows.length) return null;
  const runsPerYear = rows.reduce((n, x) => n + x.rate.freq.runsPerYear, 0);
  const perYear = rows.reduce((n, x) => n + x.rate.perYear, 0);
  // Number(null) is 0, so num(null) is 0, not null — an absent per-transfer
  // tax would otherwise be reported as a confident zero annual fee bill. The
  // absence has to be preserved: "we do not know" and "it is free" are very
  // different answers here.
  const tax = perTransferTax == null || perTransferTax === '' ? null : num(perTransferTax);
  return {
    count: rows.length, rows, runsPerYear, perYear,
    perMonth: perYear / 12,
    taxPerYear: tax === null ? null : tax * runsPerYear,
    taxPct: tax === null ? null : ((tax * runsPerYear) / perYear) * 100,
  };
}

// A per-transfer cost that does not scale with the transfer is the single most
// consequential thing to establish here, and one receipt cannot establish it.
// The flag is explicit so the UI can say "if" rather than asserting it.
export function flatTaxWarning(summary, sipload) {
  if (!summary || !sipload || summary.count < 1) return null;
  const perTransferTax = summary.rows.reduce((s, x) => s + x.taxInr, 0) / summary.count;
  if (!(perTransferTax > 0)) return null;
  const smallest = Math.min(...sipload.rows.map(x => x.rate.perRun));
  if (!(smallest > 0) || smallest >= summary.avgTransfer) return null;
  return {
    perTransferTax, smallest,
    dragAtSmallest: (perTransferTax / smallest) * 100,
    observedAt: summary.avgTransfer,
    dragObserved: (perTransferTax / summary.avgTransfer) * 100,
    sampleSize: summary.count,
    unconfirmed: summary.count < 2,
  };
}

// ------------------------------------------------------- remittance costs

export const REMIT_NOTE =
  'INDmoney charges no per-order brokerage on US fractional trades — every order value in the scanned ledger equals qty x price exactly. The cost of investing from India sits entirely on the INR→USD remittance.';

// interbank is the true mid-market rate. Without it the spread cannot be
// separated from the rate, so spread fields come back null rather than 0 —
// a zero spread is a claim that the broker gave you the mid rate.
export function remittanceCost(r = {}, interbank = null) {
  const inr = num(r.inr), usd = num(r.usd), gst = num(r.gst) || 0, tcs = num(r.tcs) || 0;
  if (inr === null || inr <= 0 || usd === null || usd <= 0) return null;

  const appliedRate = (inr - gst - tcs) / usd;   // what you actually paid per dollar
  const ib = num(interbank);
  const hasIb = ib !== null && ib > 0;
  const spreadInr = hasIb ? (appliedRate - ib) * usd : null;
  const taxInr = gst + tcs;
  const totalInr = hasIb ? taxInr + spreadInr : taxInr;

  return {
    inr, usd, gst, tcs, taxInr,
    appliedRate,
    interbank: hasIb ? ib : null,
    spreadInr,
    spreadPct: hasIb ? (spreadInr / inr) * 100 : null,
    totalInr,
    // The headline drag. When interbank is unknown this is the tax-only floor,
    // and `floor` says so rather than letting it be read as the whole cost.
    dragPct: (totalInr / inr) * 100,
    floor: !hasIb,
  };
}

export function remittanceSummary(list = [], interbank = null) {
  const rows = list.map(r => remittanceCost(r, interbank)).filter(Boolean);
  if (!rows.length) return null;
  const inr = rows.reduce((s, x) => s + x.inr, 0);
  const usd = rows.reduce((s, x) => s + x.usd, 0);
  const total = rows.reduce((s, x) => s + x.totalInr, 0);
  return {
    count: rows.length,
    rows,
    inr, usd,
    totalInr: total,
    dragPct: (total / inr) * 100,
    avgTransfer: inr / rows.length,
    floor: rows.some(x => x.floor),
  };
}

// A flat per-transfer tax means the drag falls as the transfer grows. This is
// the actionable half of the fee finding, so it is arithmetic rather than prose.
export function batchingGain(summary, targetInr) {
  if (!summary || !summary.count) return null;
  const t = num(targetInr);
  if (t === null || t <= 0 || t <= summary.avgTransfer) return null;
  const perTransferTax = summary.rows.reduce((s, x) => s + x.taxInr, 0) / summary.count;
  const nowPct = (perTransferTax / summary.avgTransfer) * 100;
  const thenPct = (perTransferTax / t) * 100;
  return {
    targetInr: t,
    fromPct: nowPct,
    toPct: thenPct,
    savedPctPoints: nowPct - thenPct,
    perTransferTax,
  };
}

export const DISCLAIMER =
  'Scanned from your broker, not synced live — figures are correct as of the scan date and are a record, not advice.';
