// FinBoy.
//
// The dangerous answer from a chatbot over your own money is not a rude one or a
// refused one. It is a fluent, confident paragraph containing a number that does
// not exist. Every other screen in the app can be checked against the thing it
// describes, because the thing is on the same screen. A sentence cannot.
//
// So the properties worth testing here are almost all negative ones: what it
// refuses, what it will not send, and what it flags after the model has spoken.
// The design says these are guarantees rather than requests made of a model. A
// guarantee that is not tested is a request.
//
// There was no test file for this until now, which is why the two bugs below
// survived: an index that only described the eight largest holdings, and a
// scorer that got LESS confident the more precisely you asked.

import {
  fact, tokenise, scoreFact, retrieve, classify, buildIndex, buildPrompt,
  composeContext, auditNumbers, estimateTokens, quoteAnswer,
  FLOOR, MAX_FACTS, SATURATE,
} from '../src/lib/finboy.js';

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; } else { fail++; console.log('FAIL ' + name); } };
const eq = (a, b, name) => ok(a === b, `${name} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

// --------------------------------------------------------------- fixtures

// Twenty holdings, because the bug this file was written for only appears past
// the eighth. GOLDBEES sits at the bottom on purpose: it is the position most
// likely to be asked about precisely BECAUSE it is small and odd.
const HELD = [
  { ticker: 'VOO',   name: 'Vanguard S&P 500',  qty: 10, avg_cost: 400, last_price: 500 },
  { ticker: 'QQQM',  name: 'Invesco Nasdaq 100', qty: 8, avg_cost: 150, last_price: 200 },
  { ticker: 'SPMO',  name: 'Invesco Momentum',  qty: 6, avg_cost: 80,  last_price: 100 },
  { ticker: 'SCHD',  name: 'Schwab Dividend',   qty: 5,  avg_cost: 70, last_price: 80 },
  { ticker: 'AAPL',  name: 'Apple',             qty: 4,  avg_cost: 150, last_price: 200 },
  { ticker: 'MSFT',  name: 'Microsoft',         qty: 3,  avg_cost: 300, last_price: 400 },
  { ticker: 'NVDA',  name: 'Nvidia',            qty: 2,  avg_cost: 400, last_price: 500 },
  { ticker: 'AMZN',  name: 'Amazon',            qty: 2,  avg_cost: 150, last_price: 180 },
  { ticker: 'GOOGL', name: 'Alphabet',          qty: 2,  avg_cost: 130, last_price: 160 },
  { ticker: 'META',  name: 'Meta',              qty: 1,  avg_cost: 300, last_price: 350 },
  { ticker: 'TSLA',  name: 'Tesla',             qty: 1,  avg_cost: 200, last_price: 250 },
  { ticker: 'GOLDBEES', name: 'Nippon Gold ETF', qty: 20, avg_cost: 60, last_price: 70 },
];

const IDX = buildIndex({ held: HELD, cur: '$', asOf: '2026-08-15' });

// --------------------------------------------------------------- coverage

// The bug: `ranked.slice(0, 8)` meant nine through twelve had no fact at all.
// Retrieval then returned nothing, `enough` was false, and FinBoy refused — which
// reads to a user as "it does not know my portfolio", when the truth was that it
// had never been told. Their own comment in buildIndex says a partial index is
// worse than a missing one, because the gaps are invisible from inside an answer.
for (const t of ['TSLA', 'GOLDBEES', 'META']) {
  ok(IDX.some(f => f.id === `pos.${t}`), `${t} has its own fact even though it is a small position`);
}
eq(IDX.filter(f => f.id.startsWith('pos.') && !['pos.count','pos.value','pos.cost','pos.largest'].includes(f.id)).length,
   HELD.length, 'every holding is described, not just the top eight');

const gold = retrieve(IDX, 'how much goldbees do I have');
ok(gold.enough, 'a question about the smallest holding clears the floor');
ok(gold.hits.some(f => f.id === 'pos.GOLDBEES'), 'and retrieves that holding');

// --------------------------------------------------------- scoring dilution

// The second bug, and the meaner one, because it punished asking well. The
// denominator was terms.length, so every extra word of precision lowered the
// score of every fact. A curt question was answered; the same question asked
// carefully was refused.
const SHORT = 'goldbees';
const LONG  = 'how much of my portfolio is really sitting in goldbees right now';

const sShort = retrieve(IDX, SHORT);
const sLong  = retrieve(IDX, LONG);
ok(sShort.enough, 'the curt question clears the floor');
ok(sLong.enough,  'the carefully worded question ALSO clears the floor');
ok(sLong.hits.some(f => f.id === 'pos.GOLDBEES'), 'and finds the same fact');

// Stated as a property rather than a pair of examples, because the pair is only
// evidence and the property is the thing that must not regress.
const f1 = fact('t.1', 'positions', 'GOLDBEES is worth $1,400.', { tags: ['goldbees'] });
const padded = ['goldbees', ...Array.from({ length: 12 }, (_, i) => `filler${i}`)];
ok(scoreFact(f1, padded) === scoreFact(f1, padded.slice(0, SATURATE)),
   'past the saturation point, extra words change nothing — that IS the fix');
ok(scoreFact(f1, padded) < scoreFact(f1, ['goldbees']),
   'a padded question still scores below the bare term, so precision is not free');
ok(scoreFact(f1, padded) >= FLOOR,
   'a single strong tag match survives a long question');
ok(scoreFact(f1, padded) <= 1, 'and no score exceeds 1, so FLOOR means one thing');

eq(scoreFact(f1, []), 0, 'no terms is no score, not a divide by zero');
eq(scoreFact(fact('t.2', 'x', 'nothing relevant', { tags: ['zzz'] }), ['goldbees']), 0,
   'a fact with nothing in common scores zero');

// ------------------------------------------------------------- the gate

// Decision 1: retrieval failure is a REFUSAL, not a smaller prompt. Handing a
// model an unrelated context and a question it cannot answer from it is exactly
// the condition under which it invents one.
const miss = retrieve(IDX, 'what is the capital of Mongolia');
eq(miss.enough, false, 'a question the data cannot answer does not clear the floor');
ok(FLOOR > 0, 'the floor is a real threshold, not zero');

// --------------------------------------------------------------- intent

// Decision 4: advice is refused locally, before the call. Asking the model to
// decline is a request; declining here is a guarantee.
for (const q of [
  'should I sell HDFC',
  'is Infosys a good buy',
  'is it a good time to enter',
  'what should I buy next',
  'recommend me a stock',
]) {
  eq(classify(q).kind, 'advice', `"${q}" is caught as advice before any network call`);
}

// The phrasing test that matters: the pattern must key on the judgement being
// asked for, not on the pronoun. "is it a good buy" and "is Infosys a good buy"
// are the same question and an intent test that catches only one catches the
// phrasing nobody uses.
eq(classify('is it a good buy').kind, 'advice', 'advice without a pronoun is still advice');

// Decision 5: off-topic questions never reach the network — a money assistant
// with your portfolio in its prompt answering general trivia is a different and
// worse product, and every stray question spends the key.
eq(classify('who won the world cup in 2011').kind, 'offtopic',
   'an off-topic question is not treated as a normal money question');
eq(classify('what is my net worth').kind, 'money', 'a plain money question is a normal ask');

// ---------------------------------------------------- the number audit

// Decision 3, and the load-bearing one: it is the only check here that does not
// depend on the model cooperating.
const ctx = composeContext(retrieve(IDX, 'what are my positions worth').hits);

const clean = auditNumbers('Your positions are worth $9,600 in total.', ctx);
const dirty = auditNumbers('Your positions are worth $412,900 in total.', ctx);
ok(Array.isArray(clean.unsupported), 'the audit returns a list of unsupported numbers');
ok(dirty.unsupported.length > 0, 'a number that appears nowhere in the context is flagged');
ok(!dirty.clean, 'and the audit does not report clean');

// A year or a percentage lifted straight from the context must not be flagged, or
// the warning becomes noise and stops being read — which is the same as not
// having it.
const quiet = auditNumbers('You hold 12 positions.', composeContext(retrieve(IDX, 'how many positions').hits));
eq(quiet.unsupported.length, 0, 'a figure taken straight from the context is not flagged');

// ------------------------------------------------------------- prompt

const hits = retrieve(IDX, 'what is my largest position').hits;
ok(hits.length <= MAX_FACTS, 'the prompt never carries more facts than the cap');
const prompt = buildPrompt('what is my largest position', hits);
ok(prompt.includes('largest'), 'the question survives into the prompt');
ok(/2026-08-15/.test(prompt), 'every fact carries its as-of stamp into the prompt');

// Decision 6: it answers without any key at all. Retrieval alone, quoted with
// stamps, has no fabrication risk because no model is involved.
const quoted = quoteAnswer(hits);
ok(quoted && Array.isArray(quoted.rows) && quoted.rows.length > 0,
   'there is a keyless answer path that quotes the matched facts verbatim');
ok(quoted.rows.every(r => r.text), 'and every quoted row carries its own text');
eq(quoteAnswer([]), null, 'with nothing matched there is nothing to quote — not an empty answer');
ok(estimateTokens('what is my largest position', hits) > 0, 'token cost is estimated before spending it');

console.log(`${pass}/${pass + fail} passing`);
if (fail) process.exit(1);
