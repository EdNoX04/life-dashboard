// Pins the manual half of the Amizone sync.
//
// The automatic half works: GitHub Actions, no browser, no laptop. What cannot
// be automated is the LOGIN — Cloudflare will not issue a Turnstile token to a
// datacenter IP, so a fresh ticket has to come from a real browser on a real
// connection. The measured lifetime is about a day.
//
// So this is not a workaround for a bug. It is the one step that has to stay
// manual, made to cost five seconds instead of five minutes.

import {
  parseCookie, ageHours, cookieState, COOKIE_KEY, BOOKMARKLET,
  parseHandoff, scrubHash, takeHandoff, pendingHandoff, clearHandoff, bookmarkletFor,
} from '../src/lib/amizonecookie.js';

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

// ---------------------------------------------------------------- the handoff
// The one channel that survives crossing from s.amizone.net to this app is the
// URL fragment. What matters is that it is read correctly, refused when it is
// junk, and taken back out of the address bar immediately.
const HTICKET = 'B'.repeat(80);

is(parseHandoff(`#amizone=${encodeURIComponent(`.ASPXAUTH=${HTICKET}`)}`), `.ASPXAUTH=${HTICKET}`,
   'a ticket in the fragment is read back');
is(parseHandoff(`amizone=${encodeURIComponent(`.ASPXAUTH=${HTICKET}`)}`), `.ASPXAUTH=${HTICKET}`,
   'with or without the leading hash');
is(parseHandoff(`#tab=study&amizone=${encodeURIComponent(`.ASPXAUTH=${HTICKET}`)}`), `.ASPXAUTH=${HTICKET}`,
   'and alongside other fragment keys');
is(parseHandoff(''), null, 'an empty fragment yields nothing');
is(parseHandoff('#tab=study'), null, 'and so does an unrelated one');
// The same refusal as the paste box: a truncated ticket must not overwrite a
// working one. A bookmarklet fires without a human reading the result, so this
// is the only thing standing between a bad copy and a dead sync.
is(parseHandoff('#amizone=short'), null, 'a truncated ticket is refused, not stored');
// A key whose name merely ENDS in the handoff key is a different key.
is(parseHandoff(`#notamizone=${encodeURIComponent(`.ASPXAUTH=${HTICKET}`)}`), null,
   'a lookalike key name is not mistaken for it');

is(scrubHash(`#amizone=${HTICKET}`), '', 'scrubbing leaves nothing when the ticket was all there was');
is(scrubHash(`#tab=study&amizone=${HTICKET}`), '#tab=study', 'and keeps whatever else was in the fragment');
is(scrubHash('#tab=study'), '#tab=study', 'a fragment without a ticket is left alone');

// takeHandoff against fakes: it must both hold the value AND rewrite the URL.
// Leaving a session ticket in the address bar is the whole risk of this design,
// so the scrub is not a nicety.
{
  const loc = { hash: `#amizone=${encodeURIComponent(`.ASPXAUTH=${HTICKET}`)}`, pathname: '/', search: '' };
  let replacedWith = null;
  const hist = { replaceState: (_a, _b, url) => { replacedWith = url; } };
  const got = takeHandoff(loc, hist);
  is(got, `.ASPXAUTH=${HTICKET}`, 'takeHandoff returns the ticket');
  is(pendingHandoff(), `.ASPXAUTH=${HTICKET}`, 'and holds it for the card to file');
  is(replacedWith, '/', 'and scrubs the fragment out of the address bar at once');
  ok(!String(replacedWith).includes(HTICKET), 'the rewritten URL carries no ticket');
  clearHandoff();
  is(pendingHandoff(), null, 'clearing it means a remount does not re-file it');
}
{
  // A browser that refuses replaceState must not cost him the ticket.
  const loc = { hash: `#amizone=${encodeURIComponent(`.ASPXAUTH=${HTICKET}`)}`, pathname: '/', search: '' };
  const hist = { replaceState: () => { throw new Error('nope'); } };
  is(takeHandoff(loc, hist), `.ASPXAUTH=${HTICKET}`, 'a refused replaceState still yields the ticket');
  clearHandoff();
}
is(takeHandoff({ hash: '', pathname: '/', search: '' }, { replaceState: () => {} }), null,
   'an ordinary page load takes nothing');

// ---------------------------------------------------------------- the posting bookmarklet
const BM = bookmarkletFor('https://life-dashboard-mu-green.vercel.app/');
ok(BM.startsWith('javascript:'), 'the posting bookmarklet is a bookmarklet');
// The URL is assembled at runtime, so the origin and the fragment key are two
// literals in the source rather than one.
ok(BM.includes('"https://life-dashboard-mu-green.vercel.app"'), 'it points at this app');
ok(BM.includes('"/#amizone="'), 'and puts the ticket in the fragment');
ok(!BM.includes('vercel.app/"'), 'the trailing slash on the origin is not doubled');
ok(/encodeURIComponent/.test(BM), 'the value is encoded on the way in');
ok(/clipboard/.test(BM), 'with the clipboard as the fallback when a popup is blocked');
// Still the important omission. A bookmarklet lives in browser sync, on every
// signed-in device, and in whatever text file it gets pasted into on the way.
ok(!/supabase|apikey|Bearer|service_role/i.test(BM), 'it holds no credential');
ok(!/fetch\(|XMLHttpRequest/i.test(BM), 'and posts to nothing — it only opens a tab');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
