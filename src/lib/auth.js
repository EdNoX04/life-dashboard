// ---- Session ----
//
// The dashboard had no login, and that was defensible only for as long as the
// database had no lock. It had none: RLS was off, the publishable key ships in
// the bundle, and a fetch from any browser returned memory.app_config in full —
// every synced API key, readable by anyone who knew the URL.
//
// Migration 003 turns RLS on. That demotes the publishable key from a credential
// to a routing token: it says which project you are talking to and grants
// nothing. This file supplies the thing that does grant access.
//
// No @supabase/supabase-js. The rest of the data layer talks to PostgREST with
// plain fetch and this matches it — Supabase's auth endpoints are ordinary REST,
// the whole surface used here is three of them, and adding a 60KB dependency to
// call three endpoints would be the only heavyweight thing in the project.

import { getConfig } from './db.js';

const KEY = 'ldx_session';

// Refresh this far before the token actually dies. A token that expires
// mid-request is indistinguishable to the user from being logged out at random,
// and on a phone that has been in a pocket for an hour it is the common case.
const SKEW_MS = 60_000;

let refreshing = null;   // in-flight refresh, shared so ten parallel reads cause one

export function getSession() {
  try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; }
}

function putSession(s) {
  if (!s) localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, JSON.stringify(s));
  notify();
  return s;
}

// expires_at is seconds since epoch, and it comes from the server. Trusting the
// device clock here would log out anyone whose phone clock has drifted.
function expired(s, skew = SKEW_MS) {
  if (!s?.expires_at) return true;
  return Date.now() + skew >= s.expires_at * 1000;
}

export function isLoggedIn() {
  const s = getSession();
  return Boolean(s?.access_token) && !expired(s, 0);
}

export function currentEmail() { return getSession()?.user?.email || null; }

// ---- subscribers, so the app can re-render when the session changes ----
const subs = new Set();
export function onAuthChange(fn) { subs.add(fn); return () => subs.delete(fn); }
function notify() { for (const fn of subs) { try { fn(getSession()); } catch {} } }

function authBase() {
  const c = getConfig();
  return `${String(c.supabaseUrl || '').replace(/\/$/, '')}/auth/v1`;
}

async function tokenCall(body, grant) {
  const c = getConfig();
  const r = await fetch(`${authBase()}/token?grant_type=${grant}`, {
    method: 'POST',
    headers: { apikey: c.supabaseKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    // Supabase returns 400 with error_description for a wrong password and the
    // same shape for a rate-limited one. Passing the server's own words through
    // matters: "Invalid login credentials" and "For security purposes, you can
    // only request this after N seconds" need different reactions from a person,
    // and collapsing both into "login failed" hides which one happened.
    throw new Error(j.error_description || j.msg || j.message || `Sign-in failed (${r.status})`);
  }
  return j;
}

export async function signIn(email, password) {
  const j = await tokenCall({ email, password }, 'password');
  return putSession(j);
}

export async function signOut() {
  const s = getSession();
  // Best-effort server-side revoke. If it fails the local session still goes —
  // a sign-out that leaves you signed in because the network blipped is worse
  // than a refresh token that outlives its usefulness on the server.
  try {
    const c = getConfig();
    await fetch(`${authBase()}/logout`, {
      method: 'POST',
      headers: { apikey: c.supabaseKey, Authorization: `Bearer ${s?.access_token}` },
    });
  } catch {}
  putSession(null);
}

// Returns a valid access token, refreshing if needed. Null means "not logged in"
// — callers treat that as a state, not an error, because it is the normal
// condition of a browser that has never signed in.
export async function accessToken() {
  const s = getSession();
  if (!s?.access_token) return null;
  if (!expired(s)) return s.access_token;
  if (!s.refresh_token) { putSession(null); return null; }

  // One refresh at a time. Without this, a tab that loads eight collections at
  // once fires eight refreshes; Supabase rotates the refresh token on use, so
  // seven of them race against a token that has already been replaced and the
  // session dies on load. That failure looks exactly like "it logs me out for
  // no reason", which is the hardest kind of bug to be told about.
  if (!refreshing) {
    refreshing = tokenCall({ refresh_token: s.refresh_token }, 'refresh_token')
      .then(j => putSession(j))
      .catch(() => putSession(null))
      .finally(() => { refreshing = null; });
  }
  const next = await refreshing;
  return next?.access_token || null;
}

// ---- the one fetch the data layer should use ----
// Adds the session token, and retries exactly once on a 401 with a forced
// refresh. Once, not in a loop: if the second attempt is also rejected the
// session is genuinely gone and retrying is just a slower way to fail.
export async function authedFetch(url, init = {}) {
  const c = getConfig();
  const token = await accessToken();
  const headers = {
    apikey: c.supabaseKey,
    Authorization: `Bearer ${token || c.supabaseKey}`,
    'Content-Type': 'application/json',
    ...(init.headers || {}),
  };
  let r = await fetch(url, { ...init, headers });
  if (r.status === 401 && token) {
    const s = getSession();
    if (s?.refresh_token) {
      refreshing = null;
      const fresh = await accessToken();
      if (fresh && fresh !== token) {
        r = await fetch(url, { ...init, headers: { ...headers, Authorization: `Bearer ${fresh}` } });
      }
    }
  }
  return r;
}

// ---------------------------------------------------------------------------
// TOTP.
//
// The password was the whole defence, and Supabase's own rate limit is 1800
// requests an hour per IP on the token endpoint — a real speed bump, and nothing
// like enough on its own against an attacker who rotates IPs. A second factor
// makes guessing the password irrelevant rather than merely slow, which is a
// different kind of protection and the one worth having.
//
// Supabase calls the levels aal1 and aal2: signed in with a password, and signed
// in having also proved the factor. Migration 004 requires aal2 in the RLS
// policies, so a stolen password stops being enough to read a single row —
// enforced by the database rather than by this file, which is the only place
// enforcement means anything.
//
// ORDER MATTERS AND IS EASY TO GET WRONG: enroll the factor FIRST, verify it,
// and only then run 004. Tightening the policies against an account with no
// factor locks the account out of its own data.

async function authFetch(path, init = {}) {
  const c = getConfig();
  const token = await accessToken();
  const r = await fetch(`${authBase()}${path}`, {
    ...init,
    headers: {
      apikey: c.supabaseKey,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error_description || j.msg || j.message || `${path} failed (${r.status})`);
  return j;
}

// Factors live on the user record. There is no GET /factors — the previous
// version called one, got a 404, swallowed it, and rendered "you have no
// factors". So an enrolled-but-unverified factor was invisible: the UI offered
// to enroll a fresh one, the old one stayed behind unverified, and a refresh
// looked like the whole thing had vanished. Unverified factors are returned here
// deliberately, so the screen can show them and offer to finish or delete them.
export async function listFactors() {
  const j = await authFetch('/user');
  const all = j?.factors || [];
  return Array.isArray(all) ? all : [];
}

// Returns the QR and the secret. The secret is shown alongside the QR on purpose:
// enrolling from the same phone that displays the QR is common, and a code you
// cannot photograph is a code you cannot enter.
export async function enrollTotp(friendlyName = 'PLAYER ONE') {
  const j = await authFetch('/factors', {
    method: 'POST',
    body: JSON.stringify({ factor_type: 'totp', friendly_name: friendlyName }),
  });
  return { id: j.id, qr: j.totp?.qr_code || '', secret: j.totp?.secret || '', uri: j.totp?.uri || '' };
}

// Enrollment is not finished until a code from the app is accepted. A factor
// left unverified is the worst of both worlds — it exists, so it looks done, and
// it cannot be used to sign in.
export async function verifyFactor(factorId, code) {
  const ch = await authFetch(`/factors/${factorId}/challenge`, { method: 'POST' });
  const j = await authFetch(`/factors/${factorId}/verify`, {
    method: 'POST',
    body: JSON.stringify({ challenge_id: ch.id, code: String(code).replace(/\s/g, '') }),
  });
  // Verifying returns a fresh session already at aal2 — storing it here is what
  // stops the UI from asking for a second code immediately after the first.
  if (j?.access_token) putSession(j);
  return j;
}

export async function unenrollFactor(factorId) {
  return authFetch(`/factors/${factorId}`, { method: 'DELETE' });
}

// Which level the CURRENT session actually holds. Read from the token rather than
// from what we remember doing, because "I verified earlier" and "this token says
// aal2" are different claims and only the second one opens the database.
export function sessionAal() {
  const s = getSession();
  if (!s?.access_token) return null;
  try {
    const payload = JSON.parse(atob(s.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.aal || 'aal1';
  } catch { return 'aal1'; }
}

// True when the account has a verified factor that this session has not satisfied
// — the exact state where the login form must ask for a code rather than let the
// user through to a dashboard that will render empty.
export async function needsSecondFactor() {
  if (!getSession()?.access_token) return false;
  if (sessionAal() === 'aal2') return false;
  try {
    const verified = (await listFactors()).filter(f => f.status === 'verified');
    return verified.length > 0 ? verified[0] : false;
  } catch { return false; }
}
