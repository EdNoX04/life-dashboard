// Pins the manual half of the Amizone sync.
//
// The automatic half works: GitHub Actions, no browser, no laptop. What cannot
// be automated is the LOGIN — Cloudflare will not issue a Turnstile token to a
// datacenter IP, so a fresh ticket has to come from a real browser on a real
// connection. The measured lifetime is about a day.
//
// So this is not a workaround for a bug. It is the one step that has to stay
// manual, made to cost five seconds instead of five minutes.

import { parseCookie, ageHours, cookieState, COOKIE_KEY, BOOKMARKLET } from '../src/lib/amizonecookie.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log('FAIL ' + n); } };
const is = (a, b, n) => ok(Object.is(a, b), `${n} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
const TICKET = 'A'.repeat(64);

// ---------------------------------------------------------------- what gets pasted
// All three of these are things a person plausibly has on the clipboard.
is(parseCookie(`.ASPXAUTH=${TICKET}`).cookie, `.ASPXAUTH=${TICKET}`, 'the name=value pair');
is(parseCookie(`foo=1; .ASPXAUTH=${TICKET}; bar=2`).cookie, `.ASPXAUTH=${TICKET}`, 'a whole document.cookie string');
is(parseCookie(TICKET).cookie, `.ASPXAUTH=${TICKET}`, 'just the value, with the name added back');
is(parseCookie(`  .ASPXAUTH=${TICKET}  `).cookie, `.ASPXAUTH=${TICKET}`, 'and surrounding whitespace is trimmed');

// ---------------------------------------------------------------- what gets refused
ok(!parseCookie('').ok, 'nothing pasted');
ok(!parseCookie('   ').ok, 'whitespace only');
ok(!parseCookie('hello there').ok, 'prose');
ok(!parseCookie('.ASPXAUTH=short').ok, 'a truncated ticket is refused');
// This one matters: a half-copied ticket would REPLACE a working session with a
// broken one, which is worse than doing nothing at all.
ok(/truncated/.test(parseCookie('.ASPXAUTH=short').reason), 'and says it looks truncated');
ok(/ASPXAUTH/.test(parseCookie('random text').reason), 'a wrong paste is told what to look for');

// ---------------------------------------------------------------- age and state
const hoursAgo = h => new Date(Date.now() - h * 3.6e6).toISOString();
is(ageHours({ first_seen: hoursAgo(3) }), 3, 'age comes from first_seen');
is(ageHours({ updated_at: hoursAgo(5) }), 5, 'falling back to updated_at');
is(ageHours({}), null, 'no timestamp, no age');
is(ageHours({ first_seen: 'not a date' }), null, 'and a broken one is not a number');

is(cookieState(null).tone, 'none', 'no ticket at all is called out');
is(cookieState({ value: 'x', first_seen: hoursAgo(2) }).tone, 'ok', 'a fresh ticket is fine');
is(cookieState({ value: 'x', first_seen: hoursAgo(20) }).tone, 'warn', 'approaching a day, it warns');
is(cookieState({ value: 'x', first_seen: hoursAgo(26) }).tone, 'stale', 'past a day, it says refresh');
// The threshold is a guess from one observation. It is stated as such in the
// source rather than presented as a known constant.
ok(/about a day/.test(cookieState({ value: 'x', first_seen: hoursAgo(20) }).text), 'and says what that is based on');

// ---------------------------------------------------------------- the bookmarklet
ok(BOOKMARKLET.startsWith('javascript:'), 'it is a bookmarklet');
ok(/ASPXAUTH/.test(BOOKMARKLET), 'it looks for the right cookie');
ok(/clipboard/.test(BOOKMARKLET), 'and copies it');
// The important omission: it must not contain a credential or post anywhere. A
// bookmarklet with a key in it is a key in browser sync, on every signed-in
// device, and in whatever text file it gets pasted into on the way there.
ok(!/supabase|apikey|Bearer|fetch\(/i.test(BOOKMARKLET), 'it holds no credential and posts nowhere');
is(COOKIE_KEY, 'amizone_cookie', 'the key matches what the sync reads');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
