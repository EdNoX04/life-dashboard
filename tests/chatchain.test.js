// Pins the free-tier model chain.
//
// This exists because one model id was a single point of failure: NVIDIA retired
// z-ai/glm-5.2 on 2026-08-21 and every non-sensitive question in the app failed
// for nine days with nobody told. The chain is the fix; these assertions are
// about it advancing for the right reason and NOT for the wrong ones.

import { nvidiaChainFrom, runChain } from '../api/chat.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log('FAIL ' + n); } };
const is = (a, b, n) => ok(Object.is(a, b), `${n} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const GONE = "The model 'x' has reached its end of life on 2026-08-21T09:00:00Z and is no longer available.";
const gone = () => { throw new Error(GONE); };
const boom = () => { throw new Error('NVIDIA 500 upstream'); };
const limit = () => { throw Object.assign(new Error('rate limit exceeded'), { code: 429 }); };
const okFn = tag => async () => ({ text: tag });

// ---------------------------------------------------------------- the order
const chain = nvidiaChainFrom('');
is(chain[0], 'nvidia/nemotron-3.5-lightning-30b-a3b', 'the fastest model leads — latency is what this tier is for');
is(chain[chain.length - 1], 'nvidia/nemotron-3-ultra-550b-a55b', 'the 550B is last: a parachute, not the aspiration');
is(new Set(chain).size, chain.length, 'no duplicates');
is(nvidiaChainFrom('moonshotai/kimi-k3')[0], 'moonshotai/kimi-k3', 'an explicit request is honoured first');
is(nvidiaChainFrom('moonshotai/kimi-k3').length, chain.length, 'and the rest still follow it');
is(nvidiaChainFrom('z-ai/glm-5.2')[0], chain[0], 'a retired id falls back to the default rather than being tried');

const run = (nv, an, canRetry = () => true) =>
  runChain('nvidia', '', {}, { canRetry, nvidia: nv, anthropic: an });

// ---------------------------------------------------------------- happy path
let r = await run(okFn('first'), okFn('paid'));
is(r.model, chain[0], 'a healthy first model is used');
is(r.fellBack, undefined, 'and nothing is reported as a fallback');

// ---------------------------------------------------------------- advancing
let calls = 0;
r = await run(async m => { calls++; if (m === chain[0]) gone(); return { text: m }; }, okFn('paid'));
is(r.model, chain[1], 'a retired model advances to the next in the chain');
is(calls, 2, 'and only one extra call is made');
ok(r.fellBack && r.fellBack.from === chain[0], 'the fallback names what died');
ok(/end of life/.test(r.fellBack.reason), 'and why');

// The whole free tier gone → the paid path, rather than an error.
r = await run(gone, okFn('paid'));
is(r.provider, 'anthropic', 'with every free model gone it crosses to the paid path');
is(r.model, 'claude-haiku-4-5', 'on Haiku — the cheap tier having a bad day, not a promotion');
is(r.fellBack.tried, chain.length, 'having actually tried them all');

// ---------------------------------------------------------------- NOT advancing
// The important half. Walking four models and then onto a paid tier because of
// one blip turns a transient failure into a bill.
let threw = '';
try { await run(boom, okFn('paid')); } catch (e) { threw = e.message; }
ok(/500/.test(threw), 'a 500 propagates instead of walking the chain');
threw = '';
try { await run(limit, okFn('paid')); } catch (e) { threw = e.message; }
ok(/rate limit/.test(threw), 'and so does a rate limit');

// Mid-stream, the status line is spent and the model cannot be swapped under
// the reader — so the chain must not advance once bytes have gone out.
threw = '';
try { await run(gone, okFn('paid'), () => false); } catch (e) { threw = e.message; }
ok(/end of life/.test(threw), 'a retirement discovered mid-stream is reported, not silently retried');

// ---------------------------------------------------------------- routing
// Anthropic never falls back to the free tier: that direction would move
// personal data onto a training endpoint.
r = await runChain('anthropic', 'claude-sonnet-5', {}, { canRetry: () => true, nvidia: gone, anthropic: okFn('paid') });
is(r.provider, 'anthropic', 'a sensitive request stays on the paid path');
is(r.model, 'claude-sonnet-5', 'with the model it asked for');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
