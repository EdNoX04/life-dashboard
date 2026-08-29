import React, { useEffect, useState } from 'react';
import { signIn, isLoggedIn, onAuthChange, currentEmail, signOut } from '../lib/auth.js';

// LoginGate — the door.
//
// Worth being precise about what this component is and is not. It is NOT the
// security boundary. A login screen in a static React app is decoration: the
// publishable key is in the bundle, and anyone can skip this component entirely
// by calling PostgREST with curl. The boundary is migration 003 — RLS on every
// table, no policy for `anon`.
//
// What this is, is the way to OBTAIN the thing the boundary asks for. Which
// means the failure mode to design against is not "someone bypasses the form",
// it is "the real user cannot get in and their data looks deleted".
//
// The TOTP step is gone (migration 006). It was a second door in front of the
// only door, and it failed in the worst possible place: a verified code that
// left `factor` set — because the branch cleared it only when sessionAal() had
// already flipped to aal2 — put the code screen straight back up with no error
// shown. Friction that works is worth arguing about; friction that silently
// re-asks after you got it right is not. The password still gates everything,
// and enrollment still exists in Settings → Security for whenever it is wanted
// back: re-enroll, verify, then re-run migration 004.
//
// Hence: errors are quoted from the server rather than flattened into "login
// failed"; a session that exists but has expired renders the form rather than an
// empty dashboard; and there is no signup path, because there is exactly one
// account and it was created by hand in the Supabase console.

// ---------------------------------------------------------------------------
// Local cool-down after failed attempts.
//
// Be clear about what this is: it is NOT brute-force protection. It lives in the
// browser, and anyone attacking this account would POST to Supabase's token
// endpoint directly and never load this component at all. Claiming otherwise
// would be worse than not having it.
//
// What it IS: a brake on the realistic case — someone (or something) hammering
// the real form on a real device. It makes a wrong password cost time, it makes
// a stuck caps-lock obvious, and it keeps this app from spending Supabase's
// per-IP request budget so fast that a legitimate retry gets rejected too.
//
// The actual boundary is elsewhere and stays there: RLS on every table, no anon
// policy, and Supabase's own server-side rate limits.
//
// Persisted, because a counter in React state resets on reload — which is the
// first thing anyone hammering a form does.
const FAILS_KEY = 'ldx_login_fails';

function readFails() {
  try {
    const v = JSON.parse(localStorage.getItem(FAILS_KEY)) || {};
    // Forget the streak after a quiet hour. Three fat-fingered attempts on
    // Monday should not still be shortening Neel's fuse on Tuesday.
    if (!v.at || Date.now() - v.at > 3600_000) return 0;
    return Number(v.n) || 0;
  } catch { return 0; }
}
function recordFail() {
  const n = readFails() + 1;
  try { localStorage.setItem(FAILS_KEY, JSON.stringify({ n, at: Date.now() })); } catch {}
  return n;
}
function clearFails() {
  try { localStorage.removeItem(FAILS_KEY); } catch {}
}
// The first two attempts are free — typos are normal and should not be punished.
// After that it climbs steeply enough to matter and caps, because a cool-down
// long enough to lock the real owner out is a self-inflicted outage.
function coolDownFor(n) {
  if (n <= 2) return 0;
  return Math.min(60, 2 ** (n - 2));   // 3rd:2s  4th:4s  5th:8s … capped at 60s
}

export default function LoginGate({ children }) {
  const [ok, setOk] = useState(isLoggedIn());
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [wait, setWait] = useState(0);   // seconds left on the local cool-down

  useEffect(() => onAuthChange(() => setOk(isLoggedIn())), []);

  // Count the cool-down down so the button can say how long is left. A disabled
  // button with no explanation is indistinguishable from a broken one.
  useEffect(() => {
    if (wait <= 0) return;
    const t = setInterval(() => setWait(w => (w <= 1 ? 0 : w - 1)), 1000);
    return () => clearInterval(t);
  }, [wait > 0]);

  // A token can expire while the tab sits open overnight. Without this the app
  // stays mounted, every request comes back empty, and the dashboard renders a
  // convincing picture of a life with nothing in it.
  useEffect(() => {
    const t = setInterval(() => setOk(isLoggedIn()), 30_000);
    const onFocus = () => setOk(isLoggedIn());
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(t); window.removeEventListener('focus', onFocus); };
  }, []);

  if (ok) return children;

  const submit = async (e) => {
    e.preventDefault();
    if (busy || wait > 0) return;
    setBusy(true); setErr('');
    try {
      await signIn(email.trim(), pw);
      setPw('');
      clearFails();
    } catch (e2) {
      setErr(e2.message || 'Sign-in failed');
      setWait(coolDownFor(recordFail()));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="login-title">PLAYER ONE</div>
        <div className="login-sub">INSERT CREDENTIALS TO CONTINUE</div>

        <label className="login-label" htmlFor="lg-email">EMAIL</label>
        <input
          id="lg-email"
          className="login-input"
          type="email"
          autoComplete="username"
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
          autoFocus
        />

        <label className="login-label" htmlFor="lg-pw">PASSWORD</label>
        <input
          id="lg-pw"
          className="login-input"
          type="password"
          autoComplete="current-password"
          value={pw}
          onChange={e => setPw(e.target.value)}
          required
        />

        {/* The server's own wording, not a summary of it. "Invalid login
            credentials" and "you can only request this after 27 seconds" call
            for different reactions from a person standing at the door. */}
        {err && <div className="login-err">{err}</div>}

        <button className="login-btn" type="submit" disabled={busy || wait > 0}>
          {busy ? 'CHECKING…' : wait > 0 ? `WAIT ${wait}s` : 'START'}
        </button>

        <div className="login-foot">
          One account. No signup. Reset the password from the Supabase console
          if you lose it.
        </div>
      </form>
    </div>
  );
}

// Small, and deliberately not inside the gate: the gate unmounts the moment you
// are in, so anything it rendered would vanish with it.
export function SignOutButton() {
  const [email, setEmail] = useState(currentEmail());
  useEffect(() => onAuthChange(() => setEmail(currentEmail())), []);
  if (!email) return null;
  return (
    <button className="signout-btn" onClick={() => signOut()} title={`Signed in as ${email}`}>
      SIGN OUT
    </button>
  );
}
