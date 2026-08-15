// The allocation ring, on two axes.
//
// The dashboard already had one, and on this book it correctly refused to draw:
// 99.6% of the money is Global Equity, and a ring at 100% is the same picture as
// a portfolio spread perfectly evenly. The fix is not a prettier ring — it is a
// question the ring can actually answer.
//
// TWO AXES, BECAUSE THEY ANSWER DIFFERENT QUESTIONS AND ONE IS NOT MY BUSINESS
//
//   SECTORS  are derivable. A company is in Information Technology whether or
//            not anyone has an opinion about it, so this axis needs nothing
//            from Neel and cannot be my editorial.
//   ROLES    are not derivable. "Ballast", "Frontier", "Core" are judgements
//            about what a holding is FOR, and that judgement is his. So roles
//            are a list he creates and assigns, exactly like accounts. Nothing
//            here invents one.
//
// WHY SECTORS GO THROUGH THE LOOK-THROUGH
//
// INDmoney's own sector field puts 67% of this book in "Miscellaneous", because
// it cannot see inside VOO, SPMO, QQQM, QQQ or SCHD. That is not INDmoney being
// wrong — it is a fund being a fund. But a ring that is two-thirds one grey
// wedge tells you nothing, so the sectors here are computed from the decomposed
// exposures the X-ray already produces, and the share that could NOT be
// decomposed is reported rather than hidden inside a total.
//
// DAY MOVE IS ON ROLES AND NOT ON SECTORS, ON PURPOSE
//
// A role bucket holds whole positions you own, each with a live quote, so its
// move today is arithmetic. A sector bucket holds slivers of companies you do
// NOT hold — there is no quote for Micron here, because you have never bought
// Micron. Attributing a fund's move to the sectors inside it pro-rata would
// produce a number that looks like a measurement and is an assumption. So the
// sector view says it cannot say, which is shorter and true.

import { xrayFromBook, isNonEquity } from './xray.js';
import { normSym } from './etfdata.js';

const num = v => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// ------------------------------------------------------------------ sectors

// GICS sectors for every company that appears in the fund compositions this app
// ships, plus everything held directly. Static because it IS static: a company
// changes sector roughly never, and when one does the fix is a line here.
//
// Two that moved in the 2023 GICS revision and are commonly mis-filed: Visa is
// Financials, not Information Technology; ADP is Industrials, not IT.
export const SECTOR_OF = {
  // Information Technology
  NVDA: 'Technology', AAPL: 'Technology', MSFT: 'Technology', AVGO: 'Technology',
  MU: 'Technology', AMD: 'Technology', INTC: 'Technology', AMAT: 'Technology',
  LRCX: 'Technology', CSCO: 'Technology', TXN: 'Technology', KLAC: 'Technology',
  APH: 'Technology', ACN: 'Technology', QCOM: 'Technology', CRWD: 'Technology',
  PANW: 'Technology', STX: 'Technology', WDC: 'Technology', SNDK: 'Technology',
  NET: 'Technology', PLTR: 'Technology', TSM: 'Technology',
  // Communication Services
  GOOGL: 'Communication', META: 'Communication', NFLX: 'Communication',
  VZ: 'Communication', CMCSA: 'Communication', SPOT: 'Communication',
  // Consumer Discretionary
  AMZN: 'Consumer', TSLA: 'Consumer', HD: 'Consumer', TGT: 'Consumer',
  // Consumer Staples
  WMT: 'Staples', COST: 'Staples', KO: 'Staples', PEP: 'Staples',
  PG: 'Staples', MO: 'Staples', PM: 'Staples',
  // Health Care
  LLY: 'Healthcare', JNJ: 'Healthcare', ABBV: 'Healthcare', ABT: 'Healthcare',
  AMGN: 'Healthcare', MRK: 'Healthcare', UNH: 'Healthcare', BMY: 'Healthcare',
  // Financials
  BRKB: 'Financials', JPM: 'Financials', V: 'Financials', GS: 'Financials',
  BX: 'Financials', SOFI: 'Financials',
  // Industrials
  CAT: 'Industrials', GE: 'Industrials', RTX: 'Industrials', GEV: 'Industrials',
  LMT: 'Industrials', ADP: 'Industrials', UPS: 'Industrials', FAST: 'Industrials',
  SPCX: 'Industrials',
  // Energy
  XOM: 'Energy', CVX: 'Energy', COP: 'Energy', SLB: 'Energy', EOG: 'Energy',
  // Materials
  LIN: 'Materials',
};

// FIVE HUES, AND THEY WERE CHOSEN BY A VALIDATOR RATHER THAN BY EYE.
//
// The obvious assignment — one theme colour per sector, nine of them — fails
// for red-green colourblind readers, and not marginally. Run against the
// dark surface these were the worst adjacent pairs:
//
//   yellow vs green   ΔE 3.8 (protan)   Industrials vs Financials
//   green  vs orange  ΔE 4.9 (deutan)   Financials  vs Healthcare
//   s1     vs pink    ΔE 7.1 (normal)   two pinks a full-colour reader
//                                       cannot tell apart either
//
// Below about 8 the wedges are the same wedge to that reader, so the ring is
// decoration. This set clears it — worst pair ΔE 10.2 protan, 8.2 tritan,
// 15.2 with normal vision — which is why there is no green and no yellow in a
// chart on a screen that otherwise uses both.
//
// The lightness check still objects: these are neon colours on a dark
// surface, which is the whole visual language of this app and not something
// one chart should quietly opt out of. That trade is deliberate; the
// colourblind one was not up for trading.
//
// Colour follows the SECTOR, never its rank. A ring whose wedges change colour
// when the ordering changes cannot be compared with the one you saw yesterday.
export const SECTORS = [
  { key: 'Technology', color: 'var(--cyan)' },
  { key: 'Communication', color: 'var(--purple)' },
  { key: 'Consumer', color: 'var(--pink)' },
  { key: 'Healthcare', color: 'var(--orange)' },
  { key: 'Financials', color: 'var(--s3)' },
];

// Sectors with no hue of their own. They are not less important — there are
// simply only five hues this palette can tell apart, and inventing a sixth is
// how a chart starts lying to a tenth of its readers. These fold into the one
// neutral wedge, which names them in its legend row.
export const FOLDED_SECTORS = ['Industrials', 'Staples', 'Energy', 'Materials'];
export const SECTOR_COLOR = Object.fromEntries(SECTORS.map(s => [s.key, s.color]));
export const UNCLASSIFIED = 'Unclassified';
export const REST = 'Rest of funds';
export const NON_EQUITY = 'Gold & cash';

export const sectorOf = sym => SECTOR_OF[normSym(sym)] || null;

/**
 * Fold a slice list to the biggest `n` plus one "Other" wedge.
 *
 * Folded, never dropped: the ring has to keep summing to the whole thing, and a
 * legend that quietly omits four small holdings is a legend claiming the book is
 * simpler than it is.
 */
export function foldTop(slices = [], n = 4, otherLabel = 'Everything else') {
  const sorted = [...slices].sort((a, b) => b.value - a.value);
  if (sorted.length <= n + 1) return { slices: sorted, folded: 0 };
  const head = sorted.slice(0, n);
  const tail = sorted.slice(n);
  const value = tail.reduce((s, x) => s + x.value, 0);
  const pct = tail.reduce((s, x) => s + (x.pct || 0), 0);
  return {
    slices: [...head, {
      key: otherLabel, label: otherLabel, value, pct,
      color: 'var(--ink-3)', other: true, count: tail.length,
      members: tail.map(x => x.label || x.key),
    }],
    folded: tail.length,
  };
}

/**
 * Sector allocation, after decomposing every fund.
 *
 * Three buckets exist alongside the real sectors and each is a different fact:
 *   REST         money inside your funds below their published top-25 lists.
 *                Real companies, simply not enumerated.
 *   UNCLASSIFIED a company we resolved but have no sector for.
 *   NON_EQUITY   gold and cash, which have no sector to be in.
 * Merging any of them into "Other" would make three different kinds of
 * not-knowing look like one kind of knowing.
 */
export function sectorAllocation(held = [], { priceOf, fx = null, top = 4 } = {}) {
  const x = xrayFromBook(held, { priceOf, fx });
  if (!x || !x.total) return null;

  const buckets = new Map();
  const add = (key, value, color) => {
    if (!(value > 0)) return;
    const row = buckets.get(key) || { key, label: key, value: 0, color };
    row.value += value;
    buckets.set(key, row);
  };

  let classified = 0;
  // Everything without a hue of its own goes into ONE neutral wedge, and the
  // parts are kept so the legend can say what is in it. Four different kinds of
  // not-a-coloured-sector — an uncoloured sector, the unenumerated remainder of
  // a fund, an unclassified company, and bullion — would otherwise become four
  // grey wedges that look like four categories.
  const restParts = [];
  const intoRest = (label, value) => { if (value > 0) restParts.push({ label, value }); };

  const other = new Map();
  for (const e of x.exposures) {
    const s = sectorOf(e.sym);
    if (s && SECTOR_COLOR[s]) { add(s, e.value, SECTOR_COLOR[s]); classified += e.value; continue; }
    if (s) { other.set(s, (other.get(s) || 0) + e.value); classified += e.value; continue; }
    other.set(UNCLASSIFIED, (other.get(UNCLASSIFIED) || 0) + e.value);
  }
  for (const [label, value] of other) intoRest(label, value);
  intoRest(REST, x.rest?.value || 0);
  intoRest(NON_EQUITY, x.nonEquity?.value || 0);
  intoRest(UNCLASSIFIED, x.unknown?.value || 0);

  const total = x.total;
  const coloured = [...buckets.values()].map(r => ({ ...r, pct: total ? (r.value / total) * 100 : 0 }))
    .sort((a, b) => b.value - a.value);

  const restValue = restParts.reduce((s2, p2) => s2 + p2.value, 0);
  const slices = restValue > 0
    ? [...coloured, {
      key: 'Everything else', label: 'Everything else', value: restValue,
      pct: total ? (restValue / total) * 100 : 0, color: 'var(--ink-3)', other: true,
      members: restParts.sort((a, b) => b.value - a.value),
      count: restParts.length,
    }]
    : coloured;

  return {
    axis: 'sector',
    slices, folded: restParts.length, total,
    // How much of the ring is a named sector rather than one of the kinds of
    // not-knowing. On screen, because without it the wedges look definitive.
    resolved: total ? (classified / total) * 100 : 0,
    excluded: x.excluded || [],
    // Day move is deliberately absent here — see the header.
    dayPct: null,
  };
}

// -------------------------------------------------------------------- roles

export const EMPTY_ROLES = { roles: [], map: {} };

export const roleId = label =>
  String(label || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 32);

export const ROLE_COLORS = [
  'var(--purple)', 'var(--cyan)', 'var(--green)', 'var(--yellow)',
  'var(--pink)', 'var(--orange)', 'var(--s2)', 'var(--s3)',
];

export function addRole(roles = [], label) {
  const id = roleId(label);
  const name = String(label || '').trim().slice(0, 32);
  if (!id || !name || roles.some(r => r.id === id)) return roles;
  return [...roles, { id, label: name, color: ROLE_COLORS[roles.length % ROLE_COLORS.length] }];
}
export const removeRole = (roles = [], id) => roles.filter(r => r.id !== id);

/**
 * Role allocation — whole positions in buckets Neel named.
 *
 * Every holding not assigned to a role lands in an explicit UNASSIGNED bucket
 * rather than being left out. A ring that silently omits what you have not
 * filed yet is a ring that gets more flattering the less work you do.
 */
export const UNASSIGNED_ROLE = 'Unassigned';

export function roleAllocation(held = [], {
  priceOf, fx = null, roles = [], map = {}, quotes = {}, currencyOf = () => 'USD', top = 4,
} = {}) {
  const buckets = new Map();
  const excluded = [];
  let total = 0, prevTotal = 0;

  for (const h of held) {
    const qty = num(h?.qty) || 0;
    const px = num(priceOf ? priceOf(h) : h?.last_price) || 0;
    const gross = qty * px;
    if (gross <= 0) continue;

    const rate = currencyOf(h) === 'USD' ? 1 : (fx || null);
    if (!rate) { excluded.push({ ticker: h.ticker }); continue; }
    const value = gross / rate;
    total += value;

    const t = normSym(h.ticker);
    const id = map[t] || map[h.ticker] || null;
    const role = roles.find(r => r.id === id);
    const key = role ? role.label : UNASSIGNED_ROLE;
    const row = buckets.get(key) || {
      key, label: key, value: 0, prev: 0, quoted: 0, unquoted: 0,
      color: role ? role.color : 'var(--ink-3)', unassigned: !role,
    };
    row.value += value;

    // Day move, but only from positions that actually came back with a previous
    // close. A holding with no quote contributes to the bucket's VALUE and not
    // to its MOVE, and the count of those travels with the number.
    const q = quotes[t] || quotes[h.ticker] || {};
    const prev = num(q.prevClose);
    if (prev != null && prev > 0) {
      const prevVal = (qty * prev) / rate;
      row.prev += prevVal;
      row.quoted += value;
      prevTotal += prevVal;
    } else {
      row.unquoted += 1;
    }
    buckets.set(key, row);
  }

  if (!total) return null;

  const all = [...buckets.values()].map(r => ({
    ...r,
    pct: (r.value / total) * 100,
    // Measured against the quoted part of the bucket only. Using the whole
    // bucket would spread a real move across positions that did not report one
    // and quietly shrink it.
    dayPct: r.prev > 0 ? ((r.quoted - r.prev) / r.prev) * 100 : null,
  }));
  const { slices, folded } = foldTop(all, top);

  return {
    axis: 'role',
    slices, folded, total, excluded,
    assigned: all.filter(r => !r.unassigned).reduce((s, r) => s + r.value, 0),
    unassignedValue: all.find(r => r.unassigned)?.value || 0,
    dayPct: prevTotal > 0 ? ((total - prevTotal) / prevTotal) * 100 : null,
  };
}

/**
 * A starting set of roles, OFFERED and never applied.
 *
 * Derived from what the holdings already are — a broad index fund is a core
 * holding, gold is ballast — so the suggestion is defensible rather than
 * decorative. It is still a suggestion: what a holding is FOR is Neel's call,
 * and an app that files his money by purpose and then reports on it by purpose
 * has made the argument before he did.
 */
export const ROLE_SEED = [
  { id: 'core', label: 'Core ETFs', match: t => ['VOO', 'SPMO', 'QQQM', 'QQQ', 'SCHD', 'IVV', 'VTI', 'SPY'].includes(t) },
  { id: 'ballast', label: 'Ballast', match: t => isNonEquity(t) || ['BRKB', 'JNJ', 'KO', 'PG'].includes(t) },
  { id: 'tech', label: 'Tech', match: t => sectorOf(t) === 'Technology' || sectorOf(t) === 'Communication' },
  { id: 'frontier', label: 'Frontier', match: t => ['PLTR', 'SOFI', 'NET', 'SPOT', 'TSLA'].includes(t) },
];

export function suggestRoles(held = []) {
  const map = {};
  const counts = {};
  for (const h of held) {
    const t = normSym(h.ticker);
    if (!t) continue;
    const hit = ROLE_SEED.find(r => r.match(t));
    if (!hit) continue;
    map[t] = hit.id;
    counts[hit.id] = (counts[hit.id] || 0) + 1;
  }
  const roles = ROLE_SEED
    .filter(r => counts[r.id])
    .map((r, i) => ({ id: r.id, label: r.label, color: ROLE_COLORS[i % ROLE_COLORS.length] }));
  return {
    roles, map, counts,
    assigned: Object.keys(map).length,
    total: held.length,
    reason: 'Index funds are grouped as core, gold and defensives as ballast, technology and communication names as tech, and the smaller high-variance positions as frontier. Every one is editable, and nothing is applied until you press the button.',
  };
}
