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
// Hence: errors are quoted from the server rather than flattened into "login
// failed"; a session that exists but has expired renders the form rather than an
// empty dashboard; and there is no signup path, because there is exactly one
// account and it was created by hand in the Supabase console.

export default function LoginGate({ children }) {
  const [ok, setOk] = useState(isLoggedIn());
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => onAuthChange(() => setOk(isLoggedIn())), []);

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
    if (busy) return;
    setBusy(true); setErr('');
    try {
      await signIn(email.trim(), pw);
      setPw('');
    } catch (e2) {
      setErr(e2.message || 'Sign-in failed');
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

        <button className="login-btn" type="submit" disabled={busy}>
          {busy ? 'CHECKING…' : 'START'}
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
