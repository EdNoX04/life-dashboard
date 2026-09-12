// Spotify, PKCE, and the failures that must each say their own name.
//
// An OAuth flow has roughly six ways to fail and they look identical from the
// outside — a page that says "Spotify playback failed" for all of them is a
// page you cannot fix anything from. So most of this file is about the
// difference between "you cancelled", "you are not Premium", "your redirect URI
// has a trailing slash", and "the token expired".
//
// The Premium one matters most: it is not a bug, not a setting, and no amount
// of retrying changes it. Anything that presents it as a transient error sends
// someone hunting for a problem that does not exist.

import {
  makeVerifier, base64url, challengeFor, authUrl, readCallback, redirectUri,
  tokenFrom, isExpired, mergeToken, missingScopes, explain, isPremium,
  normalizeTrack, normalizeTracks, normalizeState, fmtMs,
  SCOPES, REFRESH_EARLY_MS,
} from '../src/lib/spotify.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log('FAIL ' + n); } };
const eq = (a, b, n) => ok(Object.is(a, b), `${n} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

// ------------------------------------------------------------------- PKCE
{
  const v = makeVerifier();
  ok(v.length >= 43 && v.length <= 128, 'a verifier is 43-128 characters, per RFC 7636');
  ok(/^[A-Za-z0-9\-._~]+$/.test(v), 'and uses only the unreserved set — anything else is rejected with a message that never mentions encoding');
  eq(makeVerifier(10).length, 43, 'a length below the floor is raised to it rather than silently accepted');
  eq(makeVerifier(500).length, 128, 'and one above the ceiling is capped');
  ok(makeVerifier() !== makeVerifier(), 'two verifiers differ');

  eq(base64url(new Uint8Array([251, 255, 190]).buffer), '-_--', 'base64url swaps + and / for - and _');
  ok(!base64url(new Uint8Array([1]).buffer).includes('='), 'and drops the padding — a "=" in a challenge is refused');
}

// --------------------------------------------------------------- the auth URL
{
  const u = new URL(authUrl({ clientId: 'abc', redirect: 'https://x.app/', challenge: 'CH', state: 'ST' }));
  eq(u.searchParams.get('response_type'), 'code', 'the authorisation-code flow');
  eq(u.searchParams.get('code_challenge_method'), 'S256', 'with S256 — plain is not acceptable and Spotify rejects it anyway');
  eq(u.searchParams.get('code_challenge'), 'CH', 'carrying the challenge');
  eq(u.searchParams.get('state'), 'ST', 'and the state');
  ok(!u.searchParams.has('client_secret'), 'and NO secret anywhere — that is the whole point of PKCE for a browser app');
  for (const s of ['streaming', 'user-read-email', 'user-read-private']) {
    ok(u.searchParams.get('scope').includes(s), `${s} is requested — the SDK refuses to start without it`);
  }

  eq(redirectUri('https://x.app/', '/'), 'https://x.app/', 'the redirect is built from the running page');
  eq(redirectUri('https://x.app', '/music'), 'https://x.app/music', 'so it cannot disagree with itself');
}

// ---------------------------------------------------------------- the callback
{
  eq(readCallback('').kind, 'none', 'a page loaded normally is not a callback');
  eq(readCallback('?code=C&state=S', 'S').kind, 'code', 'a good callback yields the code');
  eq(readCallback('?code=C&state=S', 'S').code, 'C', 'the code itself');

  // Cancel is not an error to retry — retrying reopens the dialog he dismissed.
  const denied = readCallback('?error=access_denied&state=S', 'S');
  eq(denied.kind, 'denied', 'pressing Cancel on the consent screen is its OWN kind, not a failure');
  ok(/cancelled/i.test(explain(denied).fix), 'and is explained as a choice rather than a fault');

  eq(readCallback('?code=C&state=OTHER', 'S').kind, 'error', 'a state that does not match is dropped');
  eq(readCallback('?code=C&state=OTHER', 'S').error, 'state_mismatch', 'by name');
  eq(readCallback('?code=C&state=S', null).kind, 'code', 'and a caller with no expected state still works');
}

// ------------------------------------------------------------------- tokens
{
  const now = 1_000_000;
  const t = tokenFrom({ access_token: 'A', refresh_token: 'R', expires_in: 3600, scope: SCOPES.join(' ') }, now);
  eq(t.expiresAt, now + 3600000, 'expiry is computed from expires_in');
  eq(isExpired(t, now), false, 'a fresh token is not expired');
  eq(isExpired(t, now + 3600000 - REFRESH_EARLY_MS + 1), true,
     'but it counts as expired a minute EARLY — one that dies mid-request looks exactly like a revoked grant');
  eq(isExpired(null), true, 'and no token at all is expired');

  // Spotify omits refresh_token on some refreshes. Dropping it ends the session
  // in an hour.
  const refreshed = mergeToken(t, tokenFrom({ access_token: 'A2', expires_in: 3600 }, now));
  eq(refreshed.refreshToken, 'R', 'a refresh response with no refresh_token KEEPS the old one');
  eq(refreshed.accessToken, 'A2', 'while taking the new access token');
  eq(mergeToken(t, null).accessToken, 'A', 'and a failed refresh leaves the previous token alone');

  eq(missingScopes(t).length, 0, 'a full grant is missing nothing');
  ok(missingScopes({ scope: 'streaming' }).includes('user-library-read'),
     'and a partial one names what it lacks, rather than failing later on one call');
}

// =========================================================================
// THE FAILURES — each says its own name
// =========================================================================
{
  const kinds = new Set();
  const cases = [
    [{ kind: 'premium' }, 'premium', /Premium/],
    [{ kind: 'denied' }, 'denied', /cancelled/i],
    [{ reason: 'state_mismatch' }, 'state', /did not come from this page/],
    [{ reason: 'INVALID_CLIENT: Invalid redirect URI' }, 'redirect', /EXACTLY/],
    [{ status: 401 }, 'expired', /expired/],
    [{ status: 403 }, 'forbidden', /scope/],
    [{ status: 429 }, 'rate', /minute/],
    [{ status: 404, reason: 'no active device' }, 'nodevice', /press play here once/i],
    [{ reason: 'Failed to fetch' }, 'network', /connection/],
  ];
  for (const [input, kind, re] of cases) {
    const r = explain(input);
    eq(r.kind, kind, `${kind} is identified`);
    ok(re.test(r.fix), `and ${kind} says what to do about it`);
    kinds.add(r.kind);
  }
  eq(kinds.size, cases.length, 'every one of them is a DIFFERENT answer — a shared "playback failed" would hide all of them');

  // The one that is not a bug.
  ok(/Nothing here can change that/.test(explain({ kind: 'premium' }).fix),
     'Premium is stated as a rule of Spotify, not as something to retry or configure');
  ok(/rest of the tab still works/.test(explain({ kind: 'premium' }).fix),
     'and says what still works, so a free account is not left staring at a dead tab');

  eq(isPremium({ product: 'premium' }), true, 'Premium is read from /me');
  eq(isPremium({ product: 'free' }), false, 'so is free');
  eq(isPremium({}), null, 'and not knowing is NULL — never assumed free, which would hide the player for no reason');
}

// -------------------------------------------------------------- normalising
{
  const raw = {
    id: '1', uri: 'spotify:track:1', name: 'Song', duration_ms: 185000, explicit: true,
    artists: [{ name: 'A' }, { name: 'B' }],
    album: { name: 'Album', images: [{ url: 'big', width: 640 }, { url: 'mid', width: 300 }, { url: 'tiny', width: 64 }] },
  };
  const t = normalizeTrack(raw);
  eq(t.artist, 'A, B', 'artists are joined for display');
  eq(t.artists.length, 2, 'and kept apart for anything else');
  eq(t.art, 'mid', 'the smallest art at least 200px wide — not the 640px original in a 48px slot');
  eq(t.playable, true, 'a track with no is_playable is assumed playable');
  eq(normalizeTrack({ ...raw, is_playable: false }).playable, false,
     'and one Spotify says is unplayable says so, rather than silently skipping at play time');
  eq(normalizeTrack(null), null, 'rubbish is dropped');
  eq(normalizeTracks([raw, null, {}]).length, 1, 'and filtered out of a list');

  const art = normalizeTrack({ ...raw, album: { images: [{ url: 'only', width: 64 }] } }).art;
  eq(art, 'only', 'with nothing big enough, the largest available is used rather than none');

  const s = normalizeState({ paused: false, position: 1000, duration: 185000, shuffle: true, repeat_mode: 2,
    track_window: { current_track: raw, next_tracks: [raw, raw, raw, raw] } });
  eq(s.paused, false, 'playback state flattens');
  eq(s.next.length, 3, 'with a short lookahead rather than the whole queue');
  eq(s.reported, true, 'and is flagged REPORTED — the SDK never exposes the samples, so nothing about a Spotify stream is measured the way a local file is');
  eq(normalizeState(null), null, 'no state is null');

  eq(fmtMs(185000), '3:05', 'times read as minutes and seconds');
  eq(fmtMs(5000), '0:05', 'with a padded seconds field');
  eq(fmtMs(null), '0:00', 'and nothing is 0:00 rather than NaN:NaN');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
