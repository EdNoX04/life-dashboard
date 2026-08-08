// Pins the account seeding and scoping. The seeding matters because it is the
// only thing standing between "accounts exist as a feature" and "accounts are
// used", and a wrong guess here silently mis-attributes money.

import {
  SEED_ACCOUNTS, currencyOfRow, suggestFromCurrency, UNASSIGNED,
  filterRows, scopeLabel, scopeNote, groupRows, normaliseAccount, assign,
} from '../src/lib/accounts.js';

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; } else { fail++; console.log('FAIL ' + name); } };
const eq = (a, b, name) => ok(a === b, `${name} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

// ------------------------------------------------------------- currency
eq(currencyOfRow({ currency: 'INR' }), 'INR', 'a rupee row reads as INR');
eq(currencyOfRow({ currency: 'inr' }), 'INR', 'case-insensitively');
eq(currencyOfRow({ currency: 'USD' }), 'USD', 'a dollar row reads as USD');
// The legacy default: the whole book predates the Indian account.
eq(currencyOfRow({}), 'USD', 'a row with no currency is a dollar row');
eq(currencyOfRow({ currency: 'EUR' }), 'USD', 'an unsupported currency falls back to USD');
// Built rows carry the original under `raw`.
eq(currencyOfRow({ raw: { currency: 'INR' } }), 'INR', 'the currency is found on the raw row too');
eq(currencyOfRow(null), 'USD', 'a null row does not crash');

eq(SEED_ACCOUNTS.length, 2, 'two seed accounts');
eq(SEED_ACCOUNTS[0].currency, 'INR', 'the first seed is the rupee account');
eq(SEED_ACCOUNTS[1].id, 'indmoney-us', 'the second is the US account');

// ------------------------------------------------------------- suggesting
const MIXED = [
  { ticker: 'NVDA', currency: 'USD' },
  { ticker: 'VOO', currency: 'USD' },
  { ticker: 'GOLDBEES', currency: 'INR' },
];
const sug = suggestFromCurrency(MIXED);
eq(sug.accounts.length, 2, 'a mixed book proposes both accounts');
eq(sug.map.GOLDBEES, 'indstocks', 'the rupee holding goes to INDstocks');
eq(sug.map.NVDA, 'indmoney-us', 'the dollar holding goes to the US account');
eq(sug.counts.INR, 1, 'one rupee holding counted');
eq(sug.counts.USD, 2, 'two dollar holdings counted');
ok(sug.reason.includes('currency'), 'the suggestion carries its reasoning');
ok(sug.reason.includes('editable'), 'and says it can be changed');

// An empty account is clutter, not helpfulness.
const usOnly = suggestFromCurrency([{ ticker: 'NVDA', currency: 'USD' }]);
eq(usOnly.accounts.length, 1, 'a dollar-only book proposes only the US account');
eq(usOnly.accounts[0].id, 'indmoney-us', 'and it is the right one');
eq(usOnly.counts.INR, 0, 'with no rupee holdings');
const inOnly = suggestFromCurrency([{ ticker: 'GOLDBEES', currency: 'INR' }]);
eq(inOnly.accounts.length, 1, 'a rupee-only book proposes only INDstocks');
eq(inOnly.accounts[0].id, 'indstocks', 'and it is the right one');

// Nothing to suggest for an empty book.
eq(suggestFromCurrency([]), null, 'an empty book suggests nothing');

// An account that already exists is not proposed again, but its holdings are
// still assigned — otherwise re-running the seed after adding a holding would
// leave the new one unassigned.
const existing = [normaliseAccount({ id: 'indstocks', label: 'INDstocks', kind: 'broker' })];
const again = suggestFromCurrency(MIXED, existing);
eq(again.accounts.length, 1, 'an existing account is not proposed twice');
eq(again.accounts[0].id, 'indmoney-us', 'only the missing one is proposed');
eq(again.map.GOLDBEES, 'indstocks', 'but its holdings are still assigned');

// The proposal must never assign to an account it did not also propose or find.
const proposedIds = new Set([...again.accounts.map(a => a.id), ...existing.map(a => a.id)]);
ok(Object.values(again.map).every(id => proposedIds.has(id)),
  'every assignment points at an account that exists');

// -------------------------------------------------------------- scoping
const ROWS = [
  { ticker: 'NVDA', marketValue: 100 },
  { ticker: 'GOLDBEES', marketValue: 4 },
  { ticker: 'LOOSE', marketValue: 7 },
];
const MAP = { NVDA: 'indmoney-us', GOLDBEES: 'indstocks' };
eq(filterRows(ROWS, MAP, 'all').length, 3, 'the all scope filters nothing');
eq(filterRows(ROWS, MAP, 'indstocks').length, 1, 'an account scope keeps its own holdings');
eq(filterRows(ROWS, MAP, 'indstocks')[0].ticker, 'GOLDBEES', 'and the right one');
eq(filterRows(ROWS, MAP, UNASSIGNED).length, 1, 'the unassigned scope finds the loose holding');
eq(filterRows(ROWS, MAP, UNASSIGNED)[0].ticker, 'LOOSE', 'and it is the unmapped one');
eq(filterRows(ROWS, MAP, 'ghost').length, 0, 'a scope with no holdings is empty, not everything');

const ACCTS = [
  normaliseAccount({ id: 'indstocks', label: 'INDstocks', kind: 'broker' }),
  normaliseAccount({ id: 'indmoney-us', label: 'INDmoney US', kind: 'broker' }),
];
eq(scopeLabel(ACCTS, 'all'), 'All accounts', 'the all scope is named');
eq(scopeLabel(ACCTS, 'indstocks'), 'INDstocks', 'an account scope uses its label');
eq(scopeLabel(ACCTS, UNASSIGNED), 'Unassigned only', 'the unassigned scope is named');
eq(scopeLabel(ACCTS, 'ghost'), 'Unknown account', 'a dangling scope says so rather than pretending');
// The note only appears when the screen is NOT showing everything — a warning
// that is always on is a warning nobody reads.
eq(scopeNote(ACCTS, 'all'), null, 'showing everything needs no caveat');
ok(scopeNote(ACCTS, 'indstocks', { count: 1 }).includes('not your whole portfolio'),
  'a scoped screen says its figures are partial');

// Grouping must lose nothing: every row lands in a bucket or in loose.
const g = groupRows(ROWS, MAP, ACCTS);
const bucketed = [...g.buckets.values()].reduce((n, b) => n + b.length, 0);
eq(bucketed + g.loose.length, ROWS.length, 'grouping accounts for every row');
eq(g.loose.length, 1, 'the unmapped row is loose');
// An assignment pointing at a non-existent account must fall to loose, not
// vanish — a holding in the book that appears in no tab is the worst outcome.
const gg = groupRows(ROWS, { ...MAP, LOOSE: 'ghost' }, ACCTS);
eq([...gg.buckets.values()].reduce((n, b) => n + b.length, 0) + gg.loose.length, 3,
  'a dangling assignment still lands somewhere');
eq(gg.loose.length, 1, 'and that somewhere is loose');

// assign() is pure and must not mutate the caller's map.
const before = { ...MAP };
assign(MAP, 'LOOSE', 'indstocks');
eq(JSON.stringify(MAP), JSON.stringify(before), 'assign leaves the input map alone');

console.log(`${pass}/${pass + fail} passing`);
if (fail) process.exit(1);
