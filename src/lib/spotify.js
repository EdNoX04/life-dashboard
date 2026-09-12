// Spotify — Authorization Code with PKCE, and the Web Playback SDK.
//
// WHY THE CLIENT ID SITS IN BROWSER CONFIG WHEN EVERY API KEY WAS MOVED OUT.
//
// db.js deleted claudeKey/openaiKey/geminiKey from the synced config on the
// principle that a paid key in a browser is a paid key that leaks with the
// browser. A Spotify client ID is a different kind of thing: PKCE exists
// precisely so a public client can authenticate WITHOUT a secret. The id
// identifies the app, the code verifier proves the request came from the same
// page that started the flow, and there is no secret anywhere in the exchange.
// Anyone who reads the id can do nothing with it except start a login that
// lands back on a redirect URI they do not control.
//
// WHAT THIS CANNOT DO, said here so nobody builds on a wrong assumption:
//
//   * Premium only. The Web Playback SDK refuses a free account outright. That
//     is Spotify's rule, not a setting, and `explain()` names it rather than
//     letting it surface as a generic playback failure.
//   * Lossy, always. 160 kbps on a free account, up to 320 on Premium, Ogg
//     Vorbis, no raw stream exposed. The SOURCES entry in audio.js already says
//     this and it stays true whatever is configured.
//   * No audio analysis. The SDK hands back position and metadata; the samples
//     never reach the page, so the quality panel cannot measure a Spotify
//     stream the way it measures a local file. It must say "reported", not
//     "measured".

const str = v => String(v ?? '').trim();

export const SCOPES = [
  'streaming',                    // the Web Playback SDK itself
  'user-read-email',              // required alongside streaming
  'user-read-private',            // required alongside streaming; also gives `product`
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'user-library-read',
  'playlist-read-private',
];

export const AUTH_URL = 'https://accounts.spotify.com/authorize';
export const TOKEN_URL = 'https://accounts.spotify.com/api/token';
export const API = 'https://api.spotify.com/v1';

// The redirect URI must match what is registered on the Spotify dashboard
// EXACTLY — scheme, host, port, path, trailing slash. It is the single most
// common reason a first attempt fails, so it is derived from the running page
// rather than typed twice.
export const redirectUri = (origin, path = '/') =>
  `${str(origin).replace(/\/$/, '')}${path}`;

// ------------------------------------------------------------------- PKCE

const VERIFIER_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';

/** A code verifier: 43-128 chars from the unreserved set, per RFC 7636. */
export function makeVerifier(len = 96, rnd = null) {
  const n = Math.max(43, Math.min(128, len));
  const bytes = new Uint8Array(n);
  if (rnd) rnd(bytes); else crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < n; i++) out += VERIFIER_CHARS[bytes[i] % VERIFIER_CHARS.length];
  return out;
}

export const base64url = buf => {
  const b = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  // btoa then URL-safe, with the padding dropped — a '+' or '/' in a challenge
  // is rejected by Spotify with a message that does not mention encoding.
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export async function challengeFor(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(digest);
}

export function authUrl({ clientId, redirect, challenge, state, scopes = SCOPES }) {
  const p = new URLSearchParams({
    client_id: str(clientId),
    response_type: 'code',
    redirect_uri: str(redirect),
    code_challenge_method: 'S256',
    code_challenge: str(challenge),
    state: str(state),
    scope: scopes.join(' '),
  });
  return `${AUTH_URL}?${p}`;
}

/**
 * Read the callback Spotify sent us back to.
 *
 * A DENIED login is not an error to retry — he pressed Cancel — so it is
 * reported as its own kind. Retrying it would just reopen the dialog he
 * dismissed, which is how a consent screen becomes a loop.
 */
export function readCallback(search, expectedState) {
  const q = new URLSearchParams(str(search).replace(/^\?/, ''));
  const err = q.get('error');
  const code = q.get('code');
  const state = q.get('state');
  if (!err && !code) return { kind: 'none' };
  if (err) return { kind: err === 'access_denied' ? 'denied' : 'error', error: err };
  // State mismatch means this callback did not come from the flow this page
  // started. It is dropped rather than exchanged.
  if (expectedState != null && state !== expectedState) {
    return { kind: 'error', error: 'state_mismatch' };
  }
  return { kind: 'code', code };
}

// ------------------------------------------------------------------ tokens

// Refresh a minute early. A token that expires mid-request fails in a way that
// looks like a revoked grant, and re-authorising is a much worse experience
// than refreshing sixty seconds sooner than strictly necessary.
export const REFRESH_EARLY_MS = 60000;

export function tokenFrom(res, now = Date.now()) {
  if (!res?.access_token) return null;
  return {
    accessToken: res.access_token,
    // Spotify only returns a refresh token on the first exchange and on SOME
    // refreshes. Keeping the old one when a response omits it is the
    // difference between a session that lasts and one that dies in an hour.
    refreshToken: res.refresh_token || null,
    expiresAt: now + (Number(res.expires_in) || 3600) * 1000,
    scope: res.scope || '',
  };
}

export const isExpired = (tok, now = Date.now()) =>
  !tok?.accessToken || (tok.expiresAt || 0) - REFRESH_EARLY_MS <= now;

export const mergeToken = (prev, next) => (!next ? prev : {
  ...next,
  refreshToken: next.refreshToken || prev?.refreshToken || null,
});

/** Does this token carry everything the SDK and the library views need? */
export function missingScopes(tok, want = SCOPES) {
  const have = new Set(str(tok?.scope).split(/\s+/).filter(Boolean));
  return want.filter(s => !have.has(s));
}

// ------------------------------------------------------------------ errors

/**
 * Turn a failure into the one sentence that says what to do about it.
 *
 * Every one of these has a distinct fix, and a shared "Spotify playback failed"
 * would hide all of them. The premium case especially: it is not a bug, not a
 * setting, and no amount of retrying changes it.
 */
export function explain(e = {}) {
  const status = Number(e.status) || 0;
  const reason = str(e.reason || e.message);

  if (/premium/i.test(reason) || e.kind === 'premium') {
    return { kind: 'premium', fix: 'Spotify only allows the Web Playback SDK on Premium accounts. Nothing here can change that — the rest of the tab still works, and a free account can still search and see what is playing elsewhere.' };
  }
  if (e.kind === 'denied') {
    return { kind: 'denied', fix: 'You cancelled the Spotify login. Nothing was connected — press Connect again when you want to.' };
  }
  if (/state_mismatch/.test(reason)) {
    return { kind: 'state', fix: 'That login did not come from this page, so it was dropped. Start it again from the Connect button.' };
  }
  if (/redirect_uri|INVALID_CLIENT/i.test(reason)) {
    return { kind: 'redirect', fix: 'Spotify rejected the redirect. The URI in your app settings has to match this page EXACTLY — scheme, host, port and trailing slash included.' };
  }
  if (status === 401) {
    return { kind: 'expired', fix: 'The Spotify session expired and could not be refreshed. Reconnecting fixes it.' };
  }
  if (status === 403) {
    return { kind: 'forbidden', fix: 'Spotify refused that — usually a scope the connection was not granted. Disconnect and connect again to re-approve.' };
  }
  if (status === 429) {
    return { kind: 'rate', fix: 'Too many requests to Spotify just now. It clears on its own in a minute.' };
  }
  if (status === 404 && /device/i.test(reason)) {
    return { kind: 'nodevice', fix: 'No active Spotify device. Press play here once to make this tab the device.' };
  }
  if (!status && /fetch|network/i.test(reason)) {
    return { kind: 'network', fix: 'Could not reach Spotify. That is almost always the connection rather than the account.' };
  }
  return { kind: 'unknown', fix: reason || 'Spotify returned something unexpected.' };
}

/** Free vs Premium, from /v1/me. `null` when we have not been told. */
export const isPremium = me => (me?.product == null ? null : me.product === 'premium');

// ------------------------------------------------------------- normalising

const artistsOf = t => (Array.isArray(t?.artists) ? t.artists.map(a => str(a?.name)).filter(Boolean) : []);
const artOf = imgs => (Array.isArray(imgs) && imgs.length
  // Smallest image at least 200px wide, else the smallest there is. The 640px
  // original in a 48px slot is a needless megabyte per row.
  ? ([...imgs].sort((a, b) => (a.width || 0) - (b.width || 0)).find(i => (i.width || 0) >= 200) || imgs[imgs.length - 1]).url
  : '');

export function normalizeTrack(t) {
  if (!t?.id && !t?.uri) return null;
  return {
    id: str(t.id), uri: str(t.uri),
    name: str(t.name) || 'Unknown track',
    artists: artistsOf(t),
    artist: artistsOf(t).join(', '),
    album: str(t.album?.name),
    art: artOf(t.album?.images),
    durationMs: Number(t.duration_ms) || 0,
    // Spotify's own word for "this track is not playable in your country /
    // was removed". Surfaced rather than discovered when it silently skips.
    playable: t.is_playable !== false,
    explicit: !!t.explicit,
  };
}

export const normalizeTracks = list =>
  (Array.isArray(list) ? list : []).map(normalizeTrack).filter(Boolean);

/**
 * The SDK's player_state_changed payload, flattened.
 *
 * `quality` is deliberately the word "reported": the SDK never exposes the
 * decoded samples, so nothing here is measured the way a local file is. The
 * quality panel must not claim otherwise.
 */
export function normalizeState(s) {
  if (!s) return null;
  const cur = s.track_window?.current_track;
  return {
    paused: !!s.paused,
    positionMs: Number(s.position) || 0,
    durationMs: Number(s.duration) || Number(cur?.duration_ms) || 0,
    track: normalizeTrack(cur),
    next: normalizeTracks(s.track_window?.next_tracks || []).slice(0, 3),
    shuffle: !!s.shuffle,
    repeat: Number(s.repeat_mode) || 0,
    reported: true,
  };
}

export const fmtMs = ms => {
  const t = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};
