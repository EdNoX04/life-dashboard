import React, { useCallback, useEffect, useState } from 'react';
import { Card } from './ui.jsx';
import { useCollection } from '../lib/hooks.js';
import * as db from '../lib/db.js';
import {
  COOKIE_KEY, parseCookie, cookieState, bookmarkletFor,
  pendingHandoff, clearHandoff,
} from '../lib/amizonecookie.js';

// Amizone session · Settings
//
// The sync itself is solved — it runs on GitHub Actions with no browser and no
// laptop. What is not solved is that Amizone's ticket expires after about a day,
// and a fresh one can only come from a real login on a residential IP, because
// Turnstile refuses datacenter addresses. That is a property of Amizone, not a
// bug in this app, and no amount of retrying changes it.
//
// So the goal here is not to pretend it is automatic. It is to make the manual
// step take one click. Click the bookmarklet on the Amizone tab; it opens this
// app with the ticket in the fragment; startup takes it out of the URL and this
// card files it. The paste box stays, because a popup blocker or a locked-down
// browser should not leave him stranded.
//
// The value is written with Neel's own session. Nothing here needs — or has —
// the service key, which is why this can live in a browser at all.

export default function AmizoneCookie() {
  const { items, refresh } = useCollection('memory', { filter: `key=eq.${COOKIE_KEY}`, order: 'key' });
  const row = items?.[0]?.value || null;
  const state = cookieState(row);

  const [paste, setPaste] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const store = useCallback(async (cookie, how) => {
    setBusy(true); setErr(''); setMsg('');
    try {
      await db.upsertMemory(COOKIE_KEY, {
        value: cookie,
        // first_seen resets: this is a new ticket, and its age is what the sync
        // and the warning above are both reasoning about.
        first_seen: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      await refresh();
      setMsg(how === 'handoff'
        ? 'Ticket received from the bookmarklet and stored. The next sync — within two hours, or run it now from the Actions tab — will use it.'
        : 'Saved. The next sync — within two hours, or run it now from the Actions tab — will use it.');
      return true;
    } catch (e) {
      setErr(String(e.message || e));
      return false;
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  // A ticket that arrived by bookmarklet. Filed without asking: he already made
  // the decision when he clicked the bookmark, and a confirmation step here
  // would just be the paste again under another name.
  useEffect(() => {
    const handoff = pendingHandoff();
    if (!handoff) return;
    let alive = true;
    (async () => {
      const ok = await store(handoff, 'handoff');
      // Cleared either way: a failed write should not be retried silently on
      // every remount, and the reason is on screen.
      if (alive) clearHandoff();
      if (!ok && alive) setErr(e => e || 'Could not store the ticket — try the paste box below.');
    })();
    return () => { alive = false; };
  }, [store]);

  async function save() {
    setErr(''); setMsg('');
    const p = parseCookie(paste);
    if (!p.ok) { setErr(p.reason); return; }
    if (await store(p.cookie, 'paste')) setPaste('');
  }

  const tone = { none: 'var(--red)', stale: 'var(--red)', warn: 'var(--yellow)', ok: 'var(--green)' }[state.tone];
  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  return (
    <Card title="Amizone session" color="var(--cyan)"
      right={<span className="chip" style={{ color: tone, borderColor: tone }}>{state.tone === 'ok' ? 'LIVE' : state.tone.toUpperCase()}</span>}>

      <div className="small" style={{ color: tone }}>{state.text}</div>

      <div className="small muted mt" style={{ lineHeight: 1.6 }}>
        Amizone's ticket lasts about a day and can only be renewed by signing in from a real browser on your own
        connection — Cloudflare refuses to issue one to a datacenter, which is why the sync itself cannot do it.
        Everything else is automatic; this is the one step that is not.
      </div>

      <ol className="small mt" style={{ lineHeight: 1.7, paddingLeft: '1.1rem', color: 'var(--ink-2)' }}>
        <li>Drag this to your bookmarks bar, once: <a href={bookmarkletFor(origin)} className="chip c-cyan" onClick={e => e.preventDefault()}>Amizone ticket</a></li>
        <li>Open <b>s.amizone.net</b> and sign in as normal.</li>
        <li>Click the bookmark. It opens this page and files the ticket itself.</li>
      </ol>

      <div className="small muted mt" style={{ lineHeight: 1.55 }}>
        If your browser blocks the popup, the bookmark copies the ticket instead — paste it here.
      </div>

      <div className="flex mt" style={{ gap: 8, flexWrap: 'wrap' }}>
        <input
          style={{ flex: 1, minWidth: 200 }}
          type="password"
          placeholder=".ASPXAUTH=…"
          value={paste}
          onChange={e => setPaste(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') save(); }}
          autoComplete="off"
        />
        <button className="btn btn-green" onClick={save} disabled={busy || !paste.trim()}>
          {busy ? 'saving…' : 'save ticket'}
        </button>
      </div>

      {msg && <div className="small mt" style={{ color: 'var(--green)' }}>{msg}</div>}
      {err && <div className="small mt" style={{ color: 'var(--red)' }}>{err}</div>}

      <div className="small muted mt" style={{ lineHeight: 1.55 }}>
        {/* Being plain about what this is. A session ticket is not a password —
            it cannot change anything and it expires by itself — but it does read
            attendance, so it is worth knowing where it goes. */}
        The ticket is stored in your own database and used only by the sync. It is not a password: it grants read
        access to your Amizone pages until it expires, and cannot be used to change anything. It travels in the URL
        fragment, which browsers never send to any server, and is taken out of the address bar before this page draws.
      </div>
    </Card>
  );
}
