// The five briefing rules that need nothing typed.
//
// Every other rule in briefing.js waits on a figure Neel has to enter, which
// means the briefing is emptiest exactly when the app is newest — eleven of
// twenty rules abstaining, and a screen whose main content is a list of things
// it could not check. These five read the book itself.
//
// The thing under test is not really the arithmetic — xray.test.js covers that.
// It is that the rules FIRE: that the context the component builds has the
// fields the rules read, spelled the way they read them. That join has broken
// three times in this file's history (a plan read from a key nothing writes, a
// goal read from a field nothing writes, `start` passed where `startValue` was
// expected) and every time it failed silently, as an abstention, which looks
// identical to "nothing to report".

import { brief, RULES, ENABLE } from '../src/lib/briefing.js';
import { xrayFromBook } from '../src/lib/xray.js';

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; } else { fail++; console.log('FAIL ' + name); } };
const eq = (a, b, name) => ok(a === b, `${name} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const NEW = ['xray.top1', 'xray.spread', 'xray.overlap', 'data.currency', 'data.lookthrough'];

// Shaped like the real book: four overlapping US large-cap funds, several of
// their biggest names held directly on top, gold in rupees.
const BOOK = [
  { ticker: 'VOO', qty: 106, last_price: 714.84 },
  { ticker: 'SPMO', qty: 660, last_price: 153.04 },
  { ticker: 'QQQM', qty: 275, last_price: 301.55 },
  { ticker: 'QQQ', qty: 26, last_price: 610.00 },
  { ticker: 'SCHD', qty: 705, last_price: 34.39 },
  { ticker: 'MSFT', qty: 24, last_price: 430.00 },
  { ticker: 'GOOGL', qty: 42, last_price: 180.00 },
  { ticker: 'GOLDBEES', qty: 12, last_price: 122, currency: 'INR' },
];
const priceOf = h => h.last_price;

const ctxFor = (held, fx) => ({
  cur: '$', held, bookValue: 0,
  xray: xrayFromBook(held, { priceOf, fx }),
});

const runOf = (result, id) =>
  result.flags.find(r => r.id === id) || result.clear.find(r => r.id === id) || null;
const skippedOf = (result, id) => result.skipped.find(r => r.id === id) || null;

// ------------------------------------------------ they run with no input at all

const r = brief(ctxFor(BOOK, 88));
for (const id of NEW) {
  ok(runOf(r, id) != null, `${id} runs on a book alone, with nothing typed`);
}

// The whole point of batch two: the ratio moves without Neel entering anything.
ok(r.ran >= 5, 'at least five rules have data on a book with no saved figures at all');
eq(RULES.length, 25, 'and the rule count grew to 25');

// ------------------------------------------------------ they say the right thing

const top1 = runOf(r, 'xray.top1');
ok(/Microsoft|NVIDIA|Alphabet|Apple/.test(top1.headline),
  'xray.top1 names a real company, not a ticker from the shelf');
ok(top1.basis === 'convention', 'and cites the convention basis, same as conc.top1');
ok(/25%/.test(top1.detail), 'reusing the 25% single-position number rather than inventing one');

const spread = runOf(r, 'xray.spread');
ok(/compan/.test(spread.headline), 'xray.spread counts companies, not positions');
ok(/decomposed/.test(spread.detail), 'and states the coverage its effective count is measured across');

// Four large-cap US funds must trip the overlap rule. If this stops firing on
// this book the rule has broken, because QQQ and QQQM track the same index.
const ov = runOf(r, 'xray.overlap');
eq(ov.ok, false, 'xray.overlap fires: two of these funds are more than half identical');
ok(/QQQ/.test(ov.headline), 'naming the pair');
ok(/at least/.test(ov.headline), 'and phrasing it as a floor, never as the total');

// ------------------------------------------------------- the currency guard

// With a rate loaded, nothing is dropped.
eq(runOf(r, 'data.currency').ok, true, 'with an FX rate every position is in the total');

// Without one, the rupee position is excluded — and the rule says so rather
// than the total silently shrinking.
const noFx = brief(ctxFor(BOOK, null));
const cur = runOf(noFx, 'data.currency');
eq(cur.ok, false, 'with no FX rate the rupee position drops out and the rule fires');
ok(/GOLDBEES/.test(cur.headline), 'naming it, so the omission is visible');
ok(/understated/.test(cur.detail), 'and saying which direction the total is wrong in');

// ------------------------------------------------------- uncovered funds

eq(runOf(r, 'data.lookthrough').ok, true, 'every fund in this book has a composition on file');

const withArkk = brief(ctxFor([...BOOK, { ticker: 'ARKK', qty: 100, last_price: 60 }], 88));
const lt = runOf(withArkk, 'data.lookthrough');
eq(lt.ok, false, 'a held fund with no composition makes the look-through incomplete');
ok(/ARKK/.test(lt.headline), 'named, so you know what to go and add');
ok(!/spread/.test(lt.detail) || /rather than spread/.test(lt.detail),
  'and its money is never spread across the names we do know');

// ------------------------------------------------- they abstain honestly too

// An empty book has nothing to look through. The rules must SKIP, not pass —
// a briefing that reports five clear checks on no holdings is reporting on how
// little it measured, in the most reassuring possible voice.
const empty = brief(ctxFor([], 88));
for (const id of NEW) {
  ok(skippedOf(empty, id) != null, `${id} abstains on an empty book rather than passing`);
}

// A book with no funds at all: the overlap rule has no pair to compare and must
// abstain, while the others still run.
const noFunds = brief(ctxFor([{ ticker: 'MSFT', qty: 10, last_price: 430 }], 88));
ok(skippedOf(noFunds, 'xray.overlap') != null, 'with one stock and no funds, overlap abstains');
ok(runOf(noFunds, 'xray.top1') != null, 'but the single-name check still runs');
eq(runOf(noFunds, 'data.lookthrough')?.ok, true, 'and a book with no funds has nothing uncovered');

// ------------------------------------------------------------- the job list

// Every rule that can be enabled by typing something must name where. A skipped
// rule with no route is the wall-of-excuses failure the panel was rebuilt to fix.
const enabled = RULES.filter(rule => ENABLE[rule.id]);
ok(enabled.length >= 16, 'most rules name the one action that would let them run');
for (const [id, e] of Object.entries(ENABLE)) {
  ok(RULES.some(rule => rule.id === id), `ENABLE[${id}] points at a rule that exists`);
  ok(typeof e.action === 'string' && e.action.length > 10, `ENABLE[${id}] says what to do`);
  // Decision 3 of the library, extended: an action is record-keeping, never a
  // number. "Save a target on the Rebalance screen" is about operating the app;
  // "your target should be 60/40" would be advice, and no entry may contain one.
  ok(!/\d+%/.test(e.action), `ENABLE[${id}] names no number — that would be advice, not a setup step`);
}

// The five new rules need nothing typed, so none of them may appear in ENABLE.
for (const id of NEW) {
  ok(!ENABLE[id], `${id} has no enable entry, because there is nothing for you to enter`);
}

console.log(`${pass}/${pass + fail} passing`);
if (fail) process.exit(1);
