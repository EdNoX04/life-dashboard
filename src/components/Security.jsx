import React, { useEffect, useState } from 'react';
import { Card } from './ui.jsx';
import { listFactors, enrollTotp, verifyFactor, unenrollFactor, sessionAal, currentEmail, signOut } from '../lib/auth.js';

// Security — enrolling the second factor.
//
// The awkward truth this screen has to communicate: enrolling here does NOT by
// itself protect anything. The protection is migration 004, which makes the
// database refuse a session that has not satisfied the factor. Enrolling first
// and migrating second is the only safe order, so the card says so plainly rather
// than leaving someone to discover it by locking themselves out.

export default function Security() {
  const [factors, setFactors] = useState(null);
  const [pending, setPending] = useState(null);   // { id, qr, secret }
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);

  const refresh = async () => {
    try { setFactors(await listFactors()); } catch (e) { setErr(e.message); setFactors([]); }
  };
  useEffect(() => { refresh(); }, []);

  const verified = (factors || []).filter(f => f.status === 'verified');
  // Half-finished enrollments. These are the ones that made the screen look
  // broken: created server-side, invisible client-side, and blocking a clean
  // second attempt. Shown so they can be finished or thrown away.
  const unverified = (factors || []).filter(f => f.status !== 'verified');

  async function start() {
    setBusy(true); setErr(''); setDone(false);
    try { setPending(await enrollTotp('PLAYER ONE')); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function confirm(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      await verifyFactor(pending.id, code);
      setPending(null); setCode(''); setDone(true);
      await refresh();
    } catch (e2) {
      setErr(e2.message);
    } finally { setBusy(false); }
  }

  async function remove(id) {
    setBusy(true); setErr('');
    // Deliberately no confirm() dialog and no undo: removing a factor while 004
    // is live locks you out at the next sign-in. The guard is the sentence above
    // the button, not a modal nobody reads.
    try { await unenrollFactor(id); await refresh(); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <Card title="Security" color={verified.length ? 'var(--green)' : 'var(--yellow)'}>
      <div className="small muted" style={{ lineHeight: 1.6 }}>
        Signed in as {currentEmail() || '—'}. This session is at{' '}
        <b>{sessionAal() || 'none'}</b>.
      </div>

      {verified.length === 0 && (
        <div className="small muted mt" style={{ lineHeight: 1.6 }}>
          Your password is currently the whole defence. Supabase rate-limits sign-in
          attempts, which is a speed bump rather than a wall — an authenticator code
          makes guessing the password irrelevant instead of merely slow.
        </div>
      )}

      {!pending && verified.length === 0 && (
        <button className="btn btn-green mt" onClick={start} disabled={busy}>
          {busy ? 'Working…' : unverified.length ? 'Start again' : 'Add authenticator'}
        </button>
      )}

      {!pending && unverified.length > 0 && (
        <div className="small mt" style={{ color: 'var(--yellow)', lineHeight: 1.6 }}>
          {unverified.length} unfinished enrolment{unverified.length === 1 ? '' : 's'} from a
          previous attempt. They protect nothing until a code is accepted, and they cannot be
          resumed once the QR is gone — clear them and start again.
          <div className="flex mt">
            {unverified.map(f => (
              <button key={f.id} className="btn" onClick={() => remove(f.id)} disabled={busy}>
                Discard {f.friendly_name || 'draft'}
              </button>
            ))}
          </div>
        </div>
      )}

      {pending && (
        <form onSubmit={confirm} className="mt">
          <div className="small muted" style={{ lineHeight: 1.6 }}>
            Scan this in Google Authenticator, 1Password, Raivo — anything that does TOTP.
            If you are enrolling on the phone that is showing this, type the key instead.
          </div>
          {pending.qr && (
            <div className="mt" style={{ background: '#fff', padding: 10, borderRadius: 10, width: 'fit-content' }}
                 dangerouslySetInnerHTML={{ __html: pending.qr }} />
          )}
          {pending.secret && (
            <div className="small mt" style={{ fontFamily: 'monospace', wordBreak: 'break-all', color: 'var(--ink-2)' }}>
              {pending.secret}
            </div>
          )}
          <label className="mt">Code from the app</label>
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
            placeholder="000000"
          />
          <div className="flex mt">
            <button className="btn btn-green" type="submit" disabled={busy || code.length < 6}>
              {busy ? 'Checking…' : 'Confirm'}
            </button>
            <button className="btn" type="button" onClick={() => { setPending(null); setCode(''); }}>Cancel</button>
          </div>
          <div className="small muted mt">
            Enrollment is not finished until a code is accepted. A factor left
            unverified is the worst of both worlds — it looks done and cannot be used.
          </div>
        </form>
      )}

      {verified.length === 0 && (
        <div className="small mt" style={{ color: 'var(--yellow)', lineHeight: 1.6 }}>
          Do not run migration 004 until this card says Verified. It makes the database
          demand a factor, and a factor that does not exist cannot be produced — which
          locks you out of your own rows until you re-run 003 from the Supabase SQL editor.
        </div>
      )}

      {done && (
        <div className="small mt" style={{ color: 'var(--green)', lineHeight: 1.6 }}>
          Verified. Now run <code>supabase/migrations/004-require-mfa.sql</code> in the
          Supabase SQL editor — that is the step that makes the database refuse a
          password-only session. Running it before this point would have locked you out.
        </div>
      )}

      {verified.map(f => (
        <div key={f.id} className="flex mt" style={{ alignItems: 'center', gap: 10 }}>
          <span className="chip c-green">{f.friendly_name || 'Authenticator'}</span>
          <span className="small muted">verified</span>
          <button className="btn" onClick={() => remove(f.id)} disabled={busy}>Remove</button>
        </div>
      ))}
      {verified.length > 0 && (
        <div className="small muted mt" style={{ lineHeight: 1.6 }}>
          Removing this while migration 004 is live locks you out at the next sign-in,
          because the database will ask for a factor that no longer exists. Re-run 003
          from the SQL editor first if you ever need to.
        </div>
      )}

      {err && <div className="small mt" style={{ color: 'var(--red)' }}>{err}</div>}

      {/* There was no way to sign out at all — the button existed in LoginGate and
          was never rendered anywhere. A session you cannot end is a session you
          cannot fix, and that is exactly the hole someone falls into when their
          token stops being able to read anything. */}
      <div className="flex mt" style={{ justifyContent: 'flex-end' }}>
        <button className="btn" onClick={() => signOut()}>Sign out</button>
      </div>
    </Card>
  );
}
