// Reading a Binance failure correctly.
//
// This module exists because the wrong diagnosis was expensive. The Crypto tab
// said "the account is empty, or the key cannot read it" while the real answer
// was HTTP 451 — Binance refusing to serve the account from that IP at all.
// Acting on the wrong message, Neel added credentials to Vercel, which cannot
// possibly help: nothing there calls Binance and Vercel's default regions are
// American too.
//
// So the assertions are mostly about the message being RIGHT, and about the
// distinction that matters: an empty account and a failed run that wrote its
// emptiness down look identical on screen.

import { explain, isGeoBlocked, isAuthProblem, ledgerState } from '../src/lib/binance.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log('FAIL ' + n); } };
const eq = (a, b, n) => ok(Object.is(a, b), `${n} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

// The real string, from memory.sync_status.binance on 2026-08-08.
const REAL_451 = `balances: balances 451: {\n  "code": 0,\n  "msg": "Service unavailable from a restricted location according to 'b. Eligibility' in https://www.binance.com/en/terms. Please contact customer service`;

// ---------------------------------------------------------------- 451 is not auth
{
  ok(isGeoBlocked(REAL_451), 'the live failure string is recognised as a geo block');
  ok(isGeoBlocked('something 451 something'), 'by status code alone');
  ok(isGeoBlocked('restricted location'), 'or by wording alone, since the two arrive separately');
  ok(!isGeoBlocked('401 invalid API-key'), 'and an auth failure is not mistaken for one');
  ok(isAuthProblem('401 invalid API-key, IP, or permissions'), 'an auth failure is recognised');
  ok(!isAuthProblem(REAL_451), 'and 451 is NOT an auth failure — that is the confusion this whole file exists to end');

  const e = explain({ ok: false, reason: REAL_451 });
  eq(e.kind, 'geo', 'the explanation knows what kind of failure it is');
  ok(/where it came from/.test(e.headline), 'and leads with the location, not the key');
  ok(/not the key/.test(e.what), 'saying outright that the key is not the problem');
  ok(/MacBook/.test(e.fix), 'the fix is to ask from an eligible connection');
  ok(/binance-local\.sh/.test(e.fix), 'and names the script that already exists for it');
  ok(/Vercel/.test(e.notThis) && /GitHub Secrets/.test(e.notThis),
     'and names the two wrong turns explicitly — one of which was actually taken');
}

// ---------------------------------------------------------------- the other cases
{
  const a = explain({ ok: false, reason: '401 invalid API-key' });
  eq(a.kind, 'auth', 'an auth failure explains differently');
  ok(/Enable Reading/.test(a.fix), 'and points at a read-only key');
  ok(!/MacBook/.test(a.fix), 'without sending him to run it locally, which would not help');

  eq(explain({ ok: false, reason: 'ECONNRESET' }).kind, 'other', 'anything else is honest about being unclassified');
  eq(explain({ ok: true }), null, 'a healthy sync explains NOTHING — a reassuring box is a box nobody reads');
  eq(explain(null), null, 'and no status at all is silent');
}

// ---------------------------------------------------------------- empty vs failed-empty
//
// The distinction the old empty state got wrong. "You own no crypto" and "the
// request was refused" render identically as a blank panel.
{
  const now = new Date('2026-09-09T12:00:00Z');
  const ago = h => new Date(now.getTime() - h * 3600000).toISOString();
  const failing = { ok: false, reason: REAL_451 };

  eq(ledgerState({ updated: ago(1), balances: [], rows: [] }, failing, now).state, 'blank-because-failed',
     'no balances WITH a failing sync is the failure, never "you own nothing"');
  eq(ledgerState({ updated: ago(1), balances: [], rows: [] }, { ok: true }, now).state, 'empty',
     'no balances with a HEALTHY sync really is an empty account');
  eq(ledgerState({ updated: ago(1), balances: [{ asset: 'BTC' }] }, failing, now).state, 'stale',
     'balances plus a failing sync means the numbers are real but old');
  eq(ledgerState({ updated: ago(100), balances: [{ asset: 'BTC' }] }, { ok: true }, now).state, 'old',
     'and a healthy sync that has not run for days is still worth saying');
  eq(ledgerState({ updated: ago(2), balances: [{ asset: 'BTC' }] }, { ok: true }, now).state, 'ok',
     'a recent healthy sync is simply fine');
  eq(ledgerState({}, null, now).state, 'never', 'nothing at all has never been connected');

  eq(Math.round(ledgerState({ updated: ago(30), balances: [] }, { ok: true }, now).ageH), 30, 'the age is reported');
  eq(ledgerState({ balances: [] }, { ok: true }, now).ageH, null, 'and is null when there is no timestamp to read');
  eq(ledgerState(null, null, now).state, 'never', 'null blob does not throw');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
