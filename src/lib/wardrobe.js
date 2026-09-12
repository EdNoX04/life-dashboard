// What he owns — clothes now, watches on the same bones.
//
// Two collections, one model, because they are the same shape: a thing
// acquired on a date for a price, kept in some condition, eventually retired
// but never deleted. Building the wardrobe without room for the second one
// would mean writing all of this twice, and the second copy is always the one
// that drifts.
//
// THE FEATURE IS THE DEDUPE, AND THE DEDUPE IS DELICATE
//
// "so that same cloth is not repeated" is the whole point of the collection.
// It is also the one thing that can quietly do damage:
//
//   too shy  — the same black tee goes in twice and the collection stops being
//              a record of what he owns, which is all it is for.
//   too eager— two DIFFERENT black tees fold into one, and an item he owns
//              silently does not exist. That is worse, and it is worse in the
//              same way the calendar fold is worse when it over-folds: the
//              missing thing leaves no trace to notice.
//
// So identity is brand + category + colour, deliberately NOT the product name
// (marketing names differ across two of the same shirt) and NOT the price (the
// same tee on sale is the same tee).
//
// AND AN ARCHIVED ITEM IS NOT A DUPLICATE. Replacing something he wore out is
// exactly the thing a person does, and a wardrobe that says "you already have
// this" about a shirt that fell apart in March is a wardrobe arguing with
// reality.
//
// No verdicts anywhere. The monthly ceiling is his, the spend is reported
// against it, and nothing here says "you overspent" — same rule the food work
// holds, for the same reason.

const str = v => String(v ?? '').trim();
const norm = s => str(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
/** A number, or null. Never 0 for "unknown" — an empty price is not free. */
const amt = v => {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const isDate = d => /^\d{4}-\d{2}-\d{2}$/.test(str(d)) && !Number.isNaN(Date.parse(str(d)));

export const KINDS = [
  { key: 'garment', label: 'Clothing', plural: 'clothes' },
  { key: 'watch', label: 'Watch', plural: 'watches' },
];
export const kindOf = k => KINDS.find(x => x.key === k) || KINDS[0];

export const CATEGORIES = [
  'tee', 'shirt', 'polo', 'hoodie', 'sweatshirt', 'jacket', 'overshirt',
  'jeans', 'trousers', 'shorts', 'joggers', 'kurta', 'suit',
  'shoes', 'sneakers', 'sandals', 'belt', 'bag', 'cap', 'other',
];

// Where a thing came from. `shop` exists so something bought in person is a
// first-class entry rather than an awkward "other" — half a wardrobe is bought
// standing up.
export const SOURCES = ['souled', 'snitch', 'myntra', 'amazon', 'ajio', 'shop', 'gift', 'other'];

/**
 * Condition, worst-last. `retired` is the end state and it ARCHIVES rather
 * than deletes: the record of what he wore out is the part that says what he
 * actually wears, and deleting it throws away the only honest signal in the
 * collection.
 */
export const CONDITIONS = [
  { key: 'new', label: 'New', rank: 0 },
  { key: 'good', label: 'Good', rank: 1 },
  { key: 'worn', label: 'Worn', rank: 2 },
  { key: 'retired', label: 'Retired', rank: 3 },
];
export const conditionOf = k => CONDITIONS.find(c => c.key === k) || CONDITIONS[1];
export const isArchived = i => i?.condition === 'retired';

export function normaliseItem(raw = {}) {
  const kind = KINDS.some(k => k.key === raw.kind) ? raw.kind : 'garment';
  const condition = CONDITIONS.some(c => c.key === raw.condition) ? raw.condition : 'new';
  return {
    // Date.now() alone collides: two items added in the same millisecond — a
    // paste of an order email with three shirts in it — got the SAME id, and
    // the dedupe then excluded a real match as "itself". A random tail costs
    // nothing and removes the whole class.
    id: str(raw.id) || `i${Date.now()}${Math.random().toString(36).slice(2, 8)}`,
    kind,
    brand: str(raw.brand).slice(0, 60),
    name: str(raw.name).slice(0, 120),
    category: CATEGORIES.includes(raw.category) ? raw.category : (kind === 'watch' ? 'other' : 'other'),
    colour: str(raw.colour).slice(0, 40),
    size: str(raw.size).slice(0, 20),
    price: amt(raw.price),
    boughtAt: isDate(raw.boughtAt) ? str(raw.boughtAt) : null,
    source: SOURCES.includes(raw.source) ? raw.source : 'other',
    url: str(raw.url).slice(0, 500),
    image: str(raw.image).slice(0, 500),
    condition,
    // Set when it reaches `retired`. Kept separate from boughtAt so "how long
    // did it last" is answerable, which is the only question the archive
    // exists to answer.
    retiredAt: isDate(raw.retiredAt) ? str(raw.retiredAt) : null,
    note: str(raw.note).slice(0, 300),
    // --- watch-only, ignored for a garment -------------------------------
    reference: str(raw.reference).slice(0, 60),
    movement: str(raw.movement).slice(0, 60),
    serviceMonths: amt(raw.serviceMonths),
    lastService: isDate(raw.lastService) ? str(raw.lastService) : null,
  };
}

// ------------------------------------------------------------------- dedupe

/**
 * What makes two things the same thing.
 *
 * A watch is identified by its REFERENCE when it has one — two Seiko SKX007s
 * are the same watch and a reference says so exactly, where brand+category
 * would fold a whole collection of Seikos into one entry.
 */
export function identityOf(item) {
  const i = normaliseItem(item || {});
  if (i.kind === 'watch') {
    return ['watch', norm(i.brand), norm(i.reference) || norm(i.name)].join('|');
  }
  return ['garment', norm(i.brand), norm(i.category), norm(i.colour)].join('|');
}

/**
 * Enough of an identity to be worth comparing.
 *
 * `other` does not count. It is the fallback category, so a candidate with a
 * brand and nothing else normalises to brand + "other" — two filled parts by
 * the letter of the rule, and an identity that would match every unclassified
 * thing of that brand. Defaults must not be able to stand in for information.
 */
export const identifiable = item => {
  const parts = identityOf(item).split('|').slice(1)
    .filter(p => p && p !== 'other');
  return parts.length >= 2;
};

/**
 * The item he already owns that this would duplicate, or null.
 *
 * ARCHIVED ITEMS ARE SKIPPED. Replacing something worn out is the normal case,
 * and refusing it would make the feature something to fight.
 */
export function findDuplicate(items, candidate) {
  if (!identifiable(candidate)) return null;
  const id = identityOf(candidate);
  const mine = Array.isArray(items) ? items : [];
  return mine
    .map(normaliseItem)
    .find(i => !isArchived(i) && i.id !== str(candidate?.id) && identityOf(i) === id) || null;
}

/**
 * Adding something.
 *
 * A duplicate is REPORTED, not refused. He might genuinely want two of the
 * same tee, and a collection that overrules him about what he owns is wrong in
 * a way that cannot be argued with. The caller shows the warning and he
 * decides.
 */
export function addItem(items, draft) {
  const list = Array.isArray(items) ? items.map(normaliseItem) : [];
  const item = normaliseItem(draft);
  const dup = findDuplicate(list, item);
  return { list: [...list, item], item, duplicate: dup };
}

/** Condition changes. Retiring stamps the date; un-retiring clears it. */
export function setCondition(items, id, condition, today = null) {
  return (Array.isArray(items) ? items : []).map(normaliseItem).map(i => {
    if (i.id !== str(id)) return i;
    const next = conditionOf(condition).key;
    return {
      ...i,
      condition: next,
      retiredAt: next === 'retired' ? (isDate(today) ? today : i.retiredAt) : null,
    };
  });
}

/** How long something lasted, in days. Null unless both ends are known. */
export function lifespanDays(item) {
  const i = normaliseItem(item || {});
  if (!i.boughtAt || !i.retiredAt) return null;
  const d = Math.round((Date.parse(`${i.retiredAt}T00:00:00`) - Date.parse(`${i.boughtAt}T00:00:00`)) / 86400000);
  return Number.isFinite(d) && d >= 0 ? d : null;
}

// -------------------------------------------------------------------- views

export function split(items, kind = null) {
  const all = (Array.isArray(items) ? items : []).map(normaliseItem)
    .filter(i => !kind || i.kind === kind);
  return {
    active: all.filter(i => !isArchived(i)),
    archived: all.filter(isArchived),
  };
}

/** Counts by category, biggest first — "what do I actually own". */
export function byCategory(items) {
  const m = new Map();
  for (const i of (Array.isArray(items) ? items : []).map(normaliseItem)) {
    if (isArchived(i)) continue;
    m.set(i.category, (m.get(i.category) || 0) + 1);
  }
  return [...m.entries()].map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
}

// -------------------------------------------------------------------- spend

/**
 * What a month cost, against a ceiling HE set.
 *
 * `spent` counts only items with a price — an item with no price recorded is
 * counted SEPARATELY rather than as free, because a month that looks under
 * budget because three prices are missing is the same failure as a net worth
 * that quietly dropped a sleeve.
 *
 * No verdict. `over` is a fact about two numbers; nothing here calls it a
 * problem, suggests a cut, or keeps a streak.
 */
export function monthSpend(items, monthISO, ceiling = null) {
  const m = str(monthISO);
  const mine = (Array.isArray(items) ? items : []).map(normaliseItem)
    .filter(i => i.boughtAt && i.boughtAt.slice(0, 7) === m);
  const priced = mine.filter(i => i.price !== null);
  const spent = priced.reduce((t, i) => t + i.price, 0);
  const cap = amt(ceiling);
  return {
    month: m,
    items: mine.length,
    spent,
    unpriced: mine.length - priced.length,
    ceiling: cap,
    // null, not false: with no ceiling there is nothing to be over.
    over: cap === null ? null : spent > cap,
    left: cap === null ? null : cap - spent,
  };
}

/** The last N months of spend, oldest first — a shape, not a score. */
export function spendSeries(items, months = 6, today = new Date()) {
  const out = [];
  const d = new Date(today);
  d.setDate(1);
  for (let k = months - 1; k >= 0; k--) {
    const m = new Date(d);
    m.setMonth(m.getMonth() - k);
    const key = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`;
    out.push(monthSpend(items, key));
  }
  return out;
}

// ------------------------------------------------------------------ watches

/**
 * When a watch is next due a service. Null when nothing was ever entered —
 * a made-up interval would put a date on something nobody has decided.
 */
export function serviceDue(item, today = null) {
  const i = normaliseItem(item || {});
  if (i.kind !== 'watch' || !i.lastService || !i.serviceMonths) return null;
  const d = new Date(`${i.lastService}T00:00:00`);
  d.setMonth(d.getMonth() + i.serviceMonths);
  const due = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (!isDate(today)) return { due, overdue: null };
  return { due, overdue: today > due };
}
