// Net worth — everything, not just the brokerage account.
//
// The Money tab has forty views and no answer to "what am I worth". Every one
// of them is about the INVESTMENT BOOK: stocks, ETFs, dividends, factors. The
// bank balance, the fixed deposits, EPF, NPS, the mutual funds held outside
// the book, the gold, and anything owed are all absent — so the largest number
// in Neel's financial life was the one the app could not show.
//
// THE FAILURE THIS FILE IS BUILT AROUND
//
// A total that has quietly absorbed something it could not value looks exactly
// like a correct total. This app has already been bitten by it once: the daily
// brief summed qty × price across currencies with no conversion, and a GOLDBEES
// position worth about fifteen dollars entered the brief as one thousand four
// hundred and seventy-nine — then the brief sorted by that number and announced
// GOLDBEES as the second largest holding. Both the right answer and the wrong
// one were the same digits with a different symbol in front.
//
// So the rule here is absolute: A SLEEVE THAT CANNOT BE VALUED IS EXCLUDED AND
// NAMED. Never converted at 1.0, never treated as zero, never quietly dropped.
// `complete` says whether the total is the whole picture, and `excluded` says
// what is missing from it.
//
// WHAT THIS IS NOT
//
// Money is READ-ONLY across this system and this file does not change that. It
// values, it groups, it compares against a target NEEL SET. It does not
// recommend, does not rebalance, does not decide what a good allocation is, and
// contains no target of its own — a drift figure against a number this app
// invented would be advice wearing arithmetic's clothes. A test walks the
// output for the same words notify.js is held to.

import { num, convert, symbolOf } from './indiabook.js';

const str = v => String(v ?? '').trim();

/**
 * A number, or null — and the distinction is the entire point of this file.
 *
 * indiabook's `num` cannot be used here. It is right for its own job and wrong
 * for this one: `Number(null)` and `Number('')` are both 0, so a loan whose
 * amount was never filled in arrives as ZERO DEBT. A test caught exactly that,
 * in this file, which exists to stop unvalued things becoming numbers.
 *
 * An empty field is not an amount. It is a thing nobody has told us yet.
 */
const amt = v => {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * The sleeves. Ordered as a balance sheet reads — the liquid things first,
 * the long-dated ones after, debt last — rather than by size, so the shape of
 * the page does not change when the numbers do.
 */
export const SLEEVES = [
  { key: 'cash', label: 'Cash & bank', kind: 'asset', source: 'manual', color: 'var(--cyan)' },
  { key: 'equity', label: 'Stocks & ETFs', kind: 'asset', source: 'book', color: 'var(--green)' },
  { key: 'mf', label: 'Mutual funds', kind: 'asset', source: 'manual', color: 'var(--purple)' },
  { key: 'crypto', label: 'Crypto', kind: 'asset', source: 'binance', color: 'var(--yellow)' },
  { key: 'fd', label: 'Deposits', kind: 'asset', source: 'manual', color: 'var(--ink-2)' },
  { key: 'retirement', label: 'EPF & NPS', kind: 'asset', source: 'manual', color: 'var(--pink)' },
  { key: 'gold', label: 'Gold', kind: 'asset', source: 'manual', color: 'var(--orange)' },
  { key: 'other', label: 'Other', kind: 'asset', source: 'manual', color: 'var(--ink-3)' },
  { key: 'loans', label: 'Loans & debt', kind: 'liability', source: 'manual', color: 'var(--red)' },
];

export const sleeveOf = k => SLEEVES.find(s => s.key === k) || null;
export const SLEEVE_KEYS = SLEEVES.map(s => s.key);
export const isLiability = k => sleeveOf(k)?.kind === 'liability';

/** A hand-entered line. Everything optional except a sleeve and an amount. */
export function normaliseEntry(e = {}) {
  const sleeve = SLEEVE_KEYS.includes(e.sleeve) ? e.sleeve : 'other';
  const amount = amt(e.amount);
  return {
    id: str(e.id) || `w${Date.now()}`,
    sleeve,
    label: str(e.label).slice(0, 80) || sleeveOf(sleeve).label,
    // Stored as written. A negative loan and a positive loan mean the same
    // thing to a person and opposite things to a sum, so the sign is taken off
    // here and the sleeve decides the direction.
    amount: amount === null ? null : Math.abs(amount),
    currency: /^[A-Z]{3}$/.test(str(e.currency).toUpperCase()) ? str(e.currency).toUpperCase() : 'INR',
    // When this was last true. A bank balance typed in March is not a lie, but
    // it is not today's balance either, and the difference has to be visible.
    at: /^\d{4}-\d{2}-\d{2}$/.test(str(e.at)) ? str(e.at) : null,
    note: str(e.note).slice(0, 200),
  };
}

const AGE_STALE_DAYS = 45;

export function daysOld(at, today) {
  if (!at || !today) return null;
  const d = Math.round((Date.parse(`${today}T00:00:00`) - Date.parse(`${at}T00:00:00`)) / 86400000);
  return Number.isFinite(d) && d >= 0 ? d : null;
}

/**
 * One sleeve, valued in `base` — or refused, with the reason.
 *
 * `value: null` and a `why` is the whole safety property of this module. It is
 * never 0, because zero is a real amount a person can hold and "I could not
 * work this out" is not.
 */
function manualSleeve(key, entries, { base, fx, today }) {
  const mine = entries.filter(e => e.sleeve === key);
  if (!mine.length) return { key, value: null, why: 'nothing entered', entries: [], empty: true };

  let total = 0;
  const unconverted = [];
  for (const e of mine) {
    if (e.amount === null) { unconverted.push(`${e.label} has no amount`); continue; }
    if (e.currency === base) { total += e.amount; continue; }
    const c = convert(e.amount, e.currency, base, fx);
    // convert() with no rate must not silently pass the number through.
    if (!Number.isFinite(c) || (e.currency !== base && (num(fx) === null || num(fx) <= 0))) {
      unconverted.push(`${e.label} is in ${e.currency} and no rate has loaded`);
      continue;
    }
    total += c;
  }
  if (unconverted.length && !mine.some(e => e.amount !== null)) {
    return { key, value: null, why: unconverted[0], entries: mine };
  }
  const ages = mine.map(e => daysOld(e.at, today)).filter(d => d !== null);
  return {
    key, value: total, entries: mine,
    // Partial is stated rather than smoothed over: a sleeve that is MOSTLY
    // counted is not the same as one that is.
    partial: unconverted.length ? unconverted : null,
    oldestDays: ages.length ? Math.max(...ages) : null,
    stale: ages.length ? Math.max(...ages) > AGE_STALE_DAYS : false,
  };
}

/**
 * Every sleeve, valued.
 *
 * `book` is the investment total already computed by indiabook's mixedTotals —
 * passed in rather than recomputed, so this file cannot disagree with the
 * Portfolio view about what the book is worth.
 */
export function sleeves({
  book = null, crypto = null, entries = [], base = 'INR', fx = null, today = null,
} = {}) {
  const manual = (Array.isArray(entries) ? entries : []).map(normaliseEntry);
  const out = [];

  for (const s of SLEEVES) {
    if (s.source === 'book') {
      // mixedTotals already refuses to combine currencies without a rate, and
      // says so. That refusal is carried through rather than re-derived.
      if (!book || book.value == null) {
        out.push({ key: s.key, value: null, why: book?.note || 'the book has not priced yet' });
      } else {
        const v = book.base === base ? book.value : convert(book.value, book.base, base, fx);
        if (!Number.isFinite(v) || (book.base !== base && (num(fx) === null || num(fx) <= 0))) {
          out.push({ key: s.key, value: null, why: `the book is in ${book.base} and no ${book.base}→${base} rate has loaded` });
        } else out.push({ key: s.key, value: v, at: book.at || null });
      }
    } else if (s.source === 'binance') {
      // The crypto blob values itself in USDT and carries HIS OWN last P2P rate
      // — the rate he actually got, not a market quote. Using it here keeps the
      // Crypto view and this one telling the same story.
      const usdt = amt(crypto?.valueUsdt);
      const rate = amt(crypto?.inrPerUsdt);
      if (!crypto) out.push({ key: s.key, value: null, why: 'Binance has not synced' });
      else if (usdt === null || rate === null) {
        out.push({ key: s.key, value: null, why: 'holdings are known but not priced — the last sync could not value them' });
      } else if (base !== 'INR') {
        out.push({ key: s.key, value: null, why: `crypto is valued in rupees from your own P2P rate and no INR→${base} rate has loaded` });
      } else out.push({ key: s.key, value: usdt * rate, at: crypto.updated || null, rate });
    } else {
      out.push(manualSleeve(s.key, manual, { base, fx, today }));
    }
  }
  return out.map(r => ({ ...sleeveOf(r.key), ...r }));
}

/**
 * The number itself.
 *
 * Assets minus liabilities, over the sleeves that could actually be valued —
 * and `complete` is false the moment one could not. A net worth that silently
 * omits the loans is the single most flattering mistake this file could make,
 * so a missing LIABILITY is reported more loudly than a missing asset.
 */
export function netWorth(list) {
  const rows = Array.isArray(list) ? list : [];
  let assets = 0, liabilities = 0;
  const excluded = [];

  for (const r of rows) {
    if (r.value == null) {
      // A sleeve with nothing in it is not an exclusion — he does not own any,
      // and saying "incomplete" because he holds no gold would make the warning
      // permanent and therefore invisible.
      if (!r.empty) excluded.push({ key: r.key, label: r.label, why: r.why || 'not valued', liability: r.kind === 'liability' });
      continue;
    }
    if (r.kind === 'liability') liabilities += r.value; else assets += r.value;
  }

  const missingDebt = excluded.some(e => e.liability);
  return {
    assets, liabilities, net: assets - liabilities,
    excluded,
    complete: excluded.length === 0,
    // Said separately and first, because the direction of the error matters:
    // an unvalued asset makes you look poorer, an unvalued debt makes you look
    // richer, and only one of those is dangerous.
    missingDebt,
    stale: rows.filter(r => r.stale).map(r => r.label),
  };
}

/**
 * The spread, over what was actually valued.
 *
 * Percentages of a total that excluded something are percentages of a smaller
 * number, and saying so is the difference between a chart and a wrong chart.
 */
export function mix(list) {
  const rows = (Array.isArray(list) ? list : []).filter(r => r.kind === 'asset' && r.value != null && r.value > 0);
  const total = rows.reduce((t, r) => t + r.value, 0);
  return {
    total,
    rows: rows
      .map(r => ({ key: r.key, label: r.label, color: r.color, value: r.value, pct: total > 0 ? (r.value / total) * 100 : 0 }))
      .sort((a, b) => b.value - a.value),
    // Of the ASSETS, not of net worth — a debt is not a slice of a pie.
    basis: 'assets',
  };
}

/**
 * Distance from a target Neel set.
 *
 * There is NO default target in this file and there must never be one. A drift
 * figure against a number this app chose would be a recommendation with
 * arithmetic in front of it, and Money is read-only. With no target the answer
 * is that there is no target — not 60/40, not "balanced", not a suggestion.
 */
export function drift(mixed, target) {
  const t = target && typeof target === 'object' ? target : null;
  const set = t ? Object.entries(t).filter(([k, v]) => SLEEVE_KEYS.includes(k) && num(v) > 0) : [];
  if (!set.length) {
    return { known: false, why: 'No target set. This app does not have an opinion about how your money should be split — set one and it will show the distance from it.' };
  }
  const want = Object.fromEntries(set.map(([k, v]) => [k, num(v)]));
  const sum = Object.values(want).reduce((a, b) => a + b, 0);
  const have = Object.fromEntries((mixed?.rows || []).map(r => [r.key, r.pct]));
  const rows = Object.keys(want).map(k => {
    // Normalised so a target that adds to 90 or 110 still means what he meant
    // by the shape of it, rather than silently reporting everything as adrift.
    const targetPct = (want[k] / sum) * 100;
    const actual = have[k] || 0;
    return { key: k, label: sleeveOf(k)?.label || k, target: targetPct, actual, diff: actual - targetPct };
  }).sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  return { known: true, rows, sum, normalised: Math.abs(sum - 100) > 0.5 };
}

/** One line for the top of the card. Says the number and how sure it is. */
export function headline(nw, base = 'INR') {
  if (!nw) return '';
  const sym = symbolOf(base) || '₹';
  const n = `${sym}${Math.round(nw.net).toLocaleString('en-IN')}`;
  if (nw.complete) return `${n} net`;
  return `${n} net, from what could be valued — ${nw.excluded.length} sleeve(s) left out`;
}
