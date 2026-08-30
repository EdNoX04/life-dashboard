import React, { useState } from 'react';
import { Card } from './ui.jsx';
import { useCollection } from '../lib/hooks.js';
import * as db from '../lib/db.js';
import { COOKIE_KEY, parseCookie, cookieState, BOOKMARKLET } from '../lib/amizonecookie.js';

// Amizone session · Settings
//
// The sync itself is solved — it runs on GitHub Actions with no browser and no
// laptop. What is not solved is that Amizone's ticket expires after about a day,
// and a fresh one can only come from a real login on a residential IP, because
// Turnstile refuses datacenter addresses. That is a property of Amizone, not a
// bug in this app, and no amount of retrying changes it.
//
// So the goal here is not to pretend it is automatic. It is to make the manual
// step take five seconds instead of five minutes. It used to mean: open
// devtools, run copy(document.cookie), open GitHub, find Actions secrets, paste,
// re-run the workflow. Now it is: click a bookmark, paste here.
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

  async function save() {
    setErr(''); setMsg('');
    const p = parseCookie(paste);
    if (!p.ok) { setErr(p.reason); return; }
    setBusy(true);
    try {
      await db.upsertMemory(COOKIE_KEY, {
        value: p.cookie,
        // first_seen resets: this is a new ticket, and its age is what the sync
        // and the warning above are both reasoning about.
        first_seen: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      await refresh();
      setPaste('');
      setMsg('Saved. The next sync — within two hours, or run it now from the Actions tab — will use it.');
    } catch (e) {
      setErr(String(e.message || e));
    }
    setBusy(false);
  }

  const tone = { none: 'var(--red)', stale: 'var(--red)', warn: 'var(--yellow)', ok: 'var(--green)' }[state.tone];

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
        <li>Drag this to your bookmarks bar, once: <a href={BOOKMARKLET} className="chip c-cyan" onClick={e => e.preventDefault()}>Amizone ticket</a></li>
        <li>Open <b>s.amizone.net</b> and sign in as normal.</li>
        <li>Click the bookmark — it copies the ticket.</li>
        <li>Paste it below.</li>
      </ol>

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
        access to your Amizone pages until it expires, and cannot be used to change anything.
      </div>
    </Card>
  );
}
