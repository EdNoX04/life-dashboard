// The allocation ring, on two axes.
//
// The ring that was there refused to draw, and it was right to: 99.6% of this
// book is one asset class, and a circle at 100% is the same picture as a
// portfolio spread perfectly evenly. So the fix was never a prettier chart —
// it was finding a question the ring can actually answer.
//
// Most of what is tested here is the difference between a category and a kind
// of not-knowing. A sector ring built the obvious way puts two-thirds of this
// book in one wedge labelled "Miscellaneous" — which is what INDmoney's own
// sector field does, because it cannot see inside an ETF — and a reader takes
// that as a fact about the portfolio rather than a fact about the data.

import {
  sectorAllocation, roleAllocation, foldTop, sectorOf, SECTORS, SECTOR_COLOR,
  FOLDED_SECTORS, addRole, removeRole, roleId, suggestRoles, UNASSIGNED_ROLE,
  REST, NON_EQUITY, UNCLASSIFIED,
} from '../src/lib/allocation.js';

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; } else { fail++; console.log('FAIL ' + name); } };
const eq = (a, b, name) => ok(a === b, `${name} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
const near = (a, b, name, tol = 0.05) => ok(a != null && Math.abs(a - b) < tol, `${name} (got ${a}, want ${b})`);

const BOOK = [
  { ticker: 'VOO', qty: 106, last_price: 714.84 },
  { ticker: 'SPMO', qty: 660, last_price: 153.04 },
  { ticker: 'QQQM', qty: 275, last_price: 301.55 },
  { ticker: 'SCHD', qty: 705, last_price: 34.39 },
  { ticker: 'MSFT', qty: 24, last_price: 430 },
  { ticker: 'GOOGL', qty: 42, last_price: 180 },
  { ticker: 'GOLDBEES', qty: 12, last_price: 122, currency: 'INR' },
];
const px = h => h.last_price;

// ------------------------------------------------------------- the palette

// Five hues, and they were picked by a validator rather than by eye. Nine theme
// colours failed for red-green colourblind readers — yellow against green at
// ΔE 3.8, green against orange at 4.9 — which means those wedges are the same
// wedge to that reader and the ring is decoration.
eq(SECTORS.length, 5, 'five sector hues, because five is what this palette can tell apart');
ok(!SECTORS.some(s => s.color === 'var(--green)'), 'no green — it fails against orange for deuteranopes');
ok(!SECTORS.some(s => s.color === 'var(--yellow)'), 'and no yellow — it fails against green for protanopes');
eq(new Set(SECTORS.map(s => s.color)).size, 5, 'every hue is used once — never cycled');
ok(FOLDED_SECTORS.length > 0, 'the sectors with no hue are named rather than silently coloured anyway');
ok(!FOLDED_SECTORS.some(s => SECTOR_COLOR[s]), 'and none of them secretly has one');

eq(sectorOf('MSFT'), 'Technology', 'Microsoft is technology');
eq(sectorOf('GOOGL'), 'Communication', 'Alphabet is communication services, not tech');
eq(sectorOf('GOOG'), 'Communication', 'and so is its other share class');
eq(sectorOf('V'), 'Financials', 'Visa is financials — it moved in the 2023 GICS revision');
eq(sectorOf('ADP'), 'Industrials', 'and ADP is industrials, for the same reason');
eq(sectorOf('BRK.B'), 'Financials', 'punctuation does not lose a company');
eq(sectorOf('NOSUCH'), null, 'an unknown ticker has no sector rather than a default one');

// ------------------------------------------------------------ the sectors

const s = sectorAllocation(BOOK, { priceOf: px, fx: 88 });
ok(s.slices.length >= 2, 'the ring draws');
eq(s.slices[0].label, 'Technology', 'technology leads this book');
ok(s.slices[0].pct > 30, 'at well over a third once the funds are unpacked');

// The headline claim: this beats the raw sector field, which cannot see inside
// a fund and reports two-thirds of the book as one bucket.
ok(s.resolved > 60, 'more than 60% of the book lands in a NAMED sector');
ok(s.resolved < 100, 'and the rest is reported rather than assumed');

// Every rupee is in exactly one wedge.
near(s.slices.reduce((a, x) => a + x.pct, 0), 100, 'the wedges sum to the whole book', 0.01);
near(s.slices.reduce((a, x) => a + x.value, 0), s.total, 'and so do the values', 1);

// The neutral wedge is ONE wedge that names its parts, not four grey wedges
// that look like four categories.
const other = s.slices.find(x => x.other);
ok(other, 'there is a single neutral wedge');
ok(other.members.length > 1, 'holding several different kinds of not-a-coloured-sector');
ok(other.members.some(m => m.label === REST), 'including the unenumerated remainder of the funds');
ok(other.members.some(m => m.label === NON_EQUITY), 'and the gold, which has no sector to be in');
ok(s.slices.filter(x => x.color === 'var(--ink-3)').length === 1,
  'and there is exactly one grey wedge, so grey never reads as a category');

// Gold is not a sector and not a data gap.
ok(!s.slices.some(x => x.label === 'GOLDBEES'), 'bullion is never drawn as a company');

// Day move is absent on this axis, on purpose.
eq(s.dayPct, null, 'the sector ring reports no day move');

// A book with no equities at all has nothing to decompose.
eq(sectorAllocation([], { priceOf: px }), null, 'an empty book draws nothing');
eq(sectorAllocation([{ ticker: 'X', qty: 0, last_price: 5 }], { priceOf: px }), null,
  'and neither does a book of zero-quantity rows');

// ------------------------------------------------------------- the roles

eq(roleId('Core ETFs'), 'core-etfs', 'a role name becomes a stable id');
eq(addRole([], 'Tech').length, 1, 'a role can be added');
eq(addRole(addRole([], 'Tech'), 'tech').length, 1, 'and the same name twice does not duplicate it');
eq(addRole([], '  ').length, 0, 'a blank name creates nothing');
eq(removeRole(addRole([], 'Tech'), 'tech').length, 0, 'and a role can be removed');

const sug = suggestRoles(BOOK);
ok(sug.roles.length >= 3, 'a starting set is suggested from what the holdings already are');
ok(sug.reason.length > 60, 'with its reasoning attached');
ok(sug.assigned > 0 && sug.assigned <= sug.total, 'assigning some or all of the book');
// It suggests and never applies — the whole point of roles is that the
// judgement is his.
ok(BOOK.every(h => !h.role), 'suggesting changes nothing');

const r = roleAllocation(BOOK, {
  priceOf: px, fx: 88, roles: sug.roles, map: sug.map,
  quotes: { MSFT: { prevClose: 425 } },
});
near(r.slices.reduce((a, x) => a + x.pct, 0), 100, 'role wedges sum to the whole book', 0.01);
ok(r.slices.some(x => x.label === 'Core ETFs'), 'the index funds are grouped');

// An unassigned holding is its own wedge, never dropped. A ring that silently
// omits what you have not filed yet gets more flattering the less you do.
{
  const partial = roleAllocation(BOOK, {
    priceOf: px, fx: 88,
    roles: [{ id: 'core', label: 'Core ETFs', color: 'var(--cyan)' }],
    map: { VOO: 'core' },
  });
  const un = partial.slices.find(x => x.unassigned || x.label === UNASSIGNED_ROLE
    || (x.members || []).some(m => m.label === UNASSIGNED_ROLE));
  ok(un, 'everything not filed yet still appears');
  near(partial.slices.reduce((a, x) => a + x.pct, 0), 100, 'and the ring still sums to the book', 0.01);
}

// Day move IS computable here, because a role holds whole positions you own —
// but only from the ones that actually reported a previous close.
{
  const two = [
    { ticker: 'MSFT', qty: 10, last_price: 430 },
    { ticker: 'AAPL', qty: 10, last_price: 200 },
  ];
  const roles = [{ id: 'tech', label: 'Tech', color: 'var(--cyan)' }];
  const map = { MSFT: 'tech', AAPL: 'tech' };
  const withOne = roleAllocation(two, { priceOf: px, roles, map, quotes: { MSFT: { prevClose: 400 } } });
  const t = withOne.slices[0];
  near(t.dayPct, 7.5, 'the move is measured against the quoted part only');
  eq(t.unquoted, 1, 'and the position with no quote is counted, not averaged in');
  const none = roleAllocation(two, { priceOf: px, roles, map, quotes: {} });
  eq(none.slices[0].dayPct, null, 'with nothing quoted there is no move to report — null, not 0%');
}

// One currency or excluded and named — the same rule as everywhere else.
{
  const noFx = roleAllocation(BOOK, {
    priceOf: px, fx: null, roles: sug.roles, map: sug.map,
    currencyOf: h => (h.currency === 'INR' ? 'INR' : 'USD'),
  });
  ok(noFx.excluded.some(e => e.ticker === 'GOLDBEES'),
    'with no rate the rupee holding is excluded and named, never converted at par');
}

// ---------------------------------------------------------------- folding

{
  const many = [5, 4, 3, 2, 1].map((v, i) => ({ key: `S${i}`, label: `S${i}`, value: v, pct: v * 100 / 15 }));
  const f = foldTop(many, 3);
  eq(f.slices.length, 4, 'top three plus one folded wedge');
  eq(f.folded, 2, 'with the folded count reported');
  near(f.slices[3].value, 3, 'the fold carries the value it stands for');
  eq(f.slices[3].members.length, 2, 'and names what is inside it');
  near(f.slices.reduce((a, x) => a + x.pct, 0), 100, 'folding never loses a percent', 0.01);
  eq(foldTop(many, 10).folded, 0, 'nothing folds when everything fits');
  eq(foldTop([], 4).slices.length, 0, 'and an empty list folds to nothing');
}

// ---------------------------------------------------------------- hostile

for (const [name, book] of [
  ['null rows', [null, undefined]],
  ['rows with no fields', [{}, {}]],
  ['NaN price', [{ ticker: 'MSFT', qty: 5, last_price: NaN }]],
  ['negative qty', [{ ticker: 'MSFT', qty: -5, last_price: 430 }]],
  ['no ticker', [{ qty: 5, last_price: 430 }]],
]) {
  let threw = null;
  try {
    sectorAllocation(book.filter(Boolean), { priceOf: px, fx: 88 });
    roleAllocation(book.filter(Boolean), { priceOf: px, fx: 88, roles: [], map: {} });
    suggestRoles(book.filter(Boolean));
  } catch (e) { threw = e; }
  ok(threw == null, `the ring survives ${name}${threw ? `: ${threw.message}` : ''}`);
}

console.log(`${pass}/${pass + fail} passing`);
if (fail) process.exit(1);
