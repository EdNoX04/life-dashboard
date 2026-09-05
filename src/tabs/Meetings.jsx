import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, Empty } from '../components/ui.jsx';
import { useCollection, todayStr } from '../lib/hooks.js';
import * as db from '../lib/db.js';
import { accessToken } from '../lib/auth.js';
import {
  ACCOUNTS, accountById, availableAccounts, parseGuests, rejectedGuests,
  localIso, endFrom, DURATIONS, fmtRange, tzName, buildInvite,
  meetingStatus, minutesUntil, fmtCountdown,
  splitByTime, searchMeetings, groupByMonth, validateMeeting, createMeeting,
} from '../lib/meetings.js';

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));

// MEETINGS — create one, and every one you have made.
//
// Creating calls /api/meet, which talks to Google directly and comes back in a
// few seconds. The old path queued a request for a GitHub Actions cron and took
// minutes; that worker still runs, but now only to sync calendars and to heal
// any meeting whose Meet room was not ready in time.

export default function Meetings() {
  const { items: mem, refresh } = useCollection('memory', { filter: 'key=eq.meetings', order: 'key' });
  const list = useMemo(() => mem?.[0]?.value?.list || [], [mem]);
  const today = todayStr();

  const [connected, setConnected] = useState(null);   // null = server not asked yet
  const [setup, setSetup] = useState(null);            // what the server says it is missing
  const [form, setForm] = useState({
    account: 'personal', title: '', notes: '',
    date: today, time: '15:00', dur: 30, meet: true, guests: '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState('');
  const [q, setQ] = useState('');
  const [tab, setTab] = useState('upcoming');
  const [openId, setOpenId] = useState(null);

  // Which accounts the server actually holds a token for. Offering one it does
  // not would put the meeting on the wrong calendar — the exact complaint this
  // screen was built to fix — so the picker only shows what will work.
  useEffect(() => {
    let dead = false;
    fetch('/api/meet')
      .then(r => r.json())
      .then(j => {
        if (dead) return;
        if (Array.isArray(j.accounts)) setConnected(j.accounts.map(a => a.id));
        // Names only — the endpoint never sends values, and this never renders one.
        setSetup({ ready: Boolean(j.ready), missing: j.missing || [], optional: j.optional || [], where: j.where || '' });
      })
      .catch(() => {});
    return () => { dead = true; };
  }, []);

  const usable = useMemo(() => availableAccounts(connected), [connected]);
  useEffect(() => {
    // If the saved choice is not connected, move to one that is rather than
    // leaving a selected-but-broken account in the picker.
    if (usable.length && !usable.some(a => a.id === form.account)) {
      setForm(f => ({ ...f, account: usable[0].id }));
    }
  }, [usable]); // eslint-disable-line

  const save = useCallback(async next => {
    await db.upsertMemory('meetings', { list: next, updated: new Date().toISOString() }).catch(() => {});
    await refresh();
  }, [refresh]);

  async function create() {
    setErr('');
    setBusy(true);
    const mid = uid();

    // createMeeting is shared with the HQ widget and tested without a network.
    // Its contract: on any failure it falls back to the old queue rather than
    // losing what was typed.
    const res = await createMeeting({ ...form, tz: tzName() }, {
      id: mid,
      post: async payload => {
        // accessToken(), not getSession() — the latter is synchronous and
        // returns whatever is stored, including an expired token. A session
        // left open overnight would otherwise fail with a 401 nobody can read.
        const tok = await accessToken();
        const r = await fetch('/api/meet', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
          body: JSON.stringify(payload),
        });
        const j = await r.json().catch(() => ({}));
        return r.ok ? { ok: true, ...j } : { ok: false, error: j.error || `failed (${r.status})` };
      },
      queue: async m => {
        await db.sendRequest('meeting_add', {
          id: m.id, title: m.title, start: m.start, end: m.end,
          meet: m.wantMeet, tz: m.tz, attendees: m.attendees,
          account: m.account, notes: m.notes,
        }).catch(() => {});
      },
    });

    if (!res.ok) { setErr(res.why); setBusy(false); return; }

    await save([res.meeting, ...list]);
    setOpenId(res.meeting.id);
    if (res.via === 'queue') {
      setErr(`${res.why} — queued for the background worker instead, which takes a few minutes.`);
    } else {
      setForm(f => ({ ...f, title: '', notes: '', guests: '' }));
      if (res.linkPending) {
        setErr('Created, but Google has not returned the Meet room yet — the background sync will fill it in.');
      }
    }
    setBusy(false);
  }

  const del = id => save(list.filter(m => m.id !== id));

  function copy(text, tag) {
    try {
      navigator.clipboard.writeText(text);
      setCopied(tag);
      setTimeout(() => setCopied(''), 1600);
    } catch { setErr('Could not reach the clipboard — select the text and copy it.'); }
  }

  const filtered = useMemo(() => searchMeetings(list, q), [list, q]);
  const { upcoming, past } = useMemo(() => splitByTime(filtered), [filtered]);
  const shown = tab === 'upcoming' ? upcoming : past;
  const rejected = rejectedGuests(form.guests);

  return (
    <>
      <h1 className="tab-title">MEETINGS</h1>
      <p className="tab-sub">Create a Meet link in seconds, from whichever account it should come from. 📅</p>

      <Card title="New meeting" color="var(--cyan)">
        {/* ---- which account ---- */}
        <label className="mt-lbl">From</label>
        <div className="mt-accts">
          {usable.map(a => (
            <button key={a.id} type="button"
              className={`mt-acct${form.account === a.id ? ' on' : ''}`}
              style={form.account === a.id ? { borderColor: a.color, color: a.color } : undefined}
              onClick={() => setForm(f => ({ ...f, account: a.id }))}>
              {a.label}
            </button>
          ))}
          {connected && connected.length === 0 && (
            <span className="small" style={{ color: 'var(--yellow)' }}>
              No Google account is configured on this deployment.
            </span>
          )}
          {connected && connected.length > 0 && connected.length < ACCOUNTS.length && (
            <span className="small muted" style={{ alignSelf: 'center' }}>
              {ACCOUNTS.length - connected.length} more possible — add its refresh token in Vercel.
            </span>
          )}
        </div>

        {setup && !setup.ready && (
          /* THE POINT OF THIS PANEL.
             The old message was "No Google account is configured on the server
             yet" and nothing else — true, and a dead end. It did not say which
             server, which variables, or where they go, and the natural
             assumption is the wrong one: the refresh tokens ARE configured, in
             GitHub Secrets, which is where the calendar sync workflow reads
             them. /api/meet runs on Vercel and cannot see GitHub Secrets. Same
             variable names, two entirely separate stores. */
          <div className="mt-setup">
            <b>Meetings needs its own copy of the Google credentials.</b>
            <p>
              The calendar <i>sync</i> works because the GitHub Action reads these from
              GitHub Secrets. This page is different — it calls <code>/api/meet</code>,
              which runs on Vercel, and Vercel cannot read GitHub Secrets. The same
              values have to exist in both places.
            </p>
            <div className="mt-setup-list">
              <span className="small muted">Missing on Vercel:</span>
              {setup.missing.map(k => <code key={k} className="mt-env">{k}</code>)}
            </div>
            {setup.optional.length > 0 && (
              <div className="mt-setup-list">
                <span className="small muted">Optional — each adds an account to the picker:</span>
                {setup.optional.map(k => <code key={k} className="mt-env dim">{k}</code>)}
              </div>
            )}
            <p className="small muted">
              {setup.where}. Add them, redeploy, and this panel disappears. Values come from{' '}
              <code>scripts/get-google-token.mjs &lt;slot&gt;</code>, which prints them and writes nothing to disk.
            </p>
          </div>
        )}

        <label className="mt-lbl mt">Title</label>
        <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
          placeholder="Q3 planning sync" />

        {/* ---- the agenda ---- */}
        <label className="mt-lbl mt">
          Notes · what will be discussed
          <span className="mt-hint">goes into the calendar event and the text you paste</span>
        </label>
        <textarea rows={4} value={form.notes}
          onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
          placeholder={'Budget review\nLaunch timeline\nOpen questions'} />

        <div className="mt-row mt">
          <div>
            <label className="mt-lbl">Date</label>
            <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
          </div>
          <div>
            <label className="mt-lbl">Time</label>
            <input type="time" value={form.time} onChange={e => setForm(f => ({ ...f, time: e.target.value }))} />
          </div>
          <div>
            <label className="mt-lbl">Length</label>
            <select value={form.dur} onChange={e => setForm(f => ({ ...f, dur: +e.target.value }))}>
              {DURATIONS.map(d => <option key={d} value={d}>{d} min</option>)}
            </select>
          </div>
        </div>

        <label className="mt-lbl mt">Guests</label>
        <input value={form.guests} onChange={e => setForm(f => ({ ...f, guests: e.target.value }))}
          placeholder="someone@example.com, another@example.com" />
        {rejected.length > 0 && (
          // Said out loud. One malformed address makes Google reject the whole
          // insert, so these are dropped — but dropping them silently means a
          // guest simply never gets invited and nobody finds out.
          <div className="small mt" style={{ color: 'var(--yellow)' }}>
            Not a valid address, will be left out: {rejected.join(', ')}
          </div>
        )}

        <div className="flex mt" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <label className="flex small" style={{ gap: 6, alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={form.meet}
              onChange={e => setForm(f => ({ ...f, meet: e.target.checked }))} />
            Add a Google Meet link
          </label>
          <span style={{ flex: 1 }} />
          <button className="btn btn-cyan" onClick={create} disabled={busy || !usable.length}>
            {busy ? 'Creating…' : 'Create meeting'}
          </button>
        </div>

        {busy && (
          <div className="small muted mt">
            Talking to Google now — this takes a few seconds, not the few minutes the old queue did.
          </div>
        )}
        {err && <div className="small mt" style={{ color: 'var(--yellow)', lineHeight: 1.55 }}>{err}</div>}
      </Card>

      {/* ---- history ---- */}
      <Card title="Meeting history" color="var(--purple)"
        right={
          <span className="flex" style={{ gap: 6 }}>
            <button className={`btn btn-sm ${tab === 'upcoming' ? 'btn-cyan' : ''}`}
              onClick={() => setTab('upcoming')}>Upcoming {upcoming.length ? `(${upcoming.length})` : ''}</button>
            <button className={`btn btn-sm ${tab === 'past' ? 'btn-purple' : ''}`}
              onClick={() => setTab('past')}>Past {past.length ? `(${past.length})` : ''}</button>
          </span>
        }>
        <input className="mt-search" value={q} onChange={e => setQ(e.target.value)}
          placeholder="Search titles, notes and guests…" />

        {shown.length === 0 && (
          <Empty icon="📅" text={q
            ? `Nothing matches “${q}”.`
            : tab === 'upcoming' ? 'No meetings coming up.' : 'No past meetings yet.'} />
        )}

        {groupByMonth(shown).map(group => (
          <div key={group.key} className="mt-group">
            <div className="mt-month">{group.key}</div>
            {group.items.map(m => {
              const st = meetingStatus(m);
              const acct = accountById(m.account);
              const open = openId === m.id;
              const invite = buildInvite(m);
              return (
                <div key={m.id} className={`mt-item${open ? ' open' : ''}`}>
                  <button className="mt-head" onClick={() => setOpenId(open ? null : m.id)}>
                    <span className="mt-dot" style={{ background: acct.color }} title={acct.label} />
                    <span className="mt-title">{m.title || 'Untitled'}</span>
                    <span className="mt-when">{fmtRange(m.start, m.end)}</span>
                    {st.key !== 'past' && st.key !== 'ready' && (
                      <span className="mt-st" style={{ color: st.c, borderColor: st.c }}>{st.label}</span>
                    )}
                    {st.key === 'ready' && minutesUntil(m) != null && minutesUntil(m) < 1440 && (
                      <span className="mt-soon">{fmtCountdown(minutesUntil(m))}</span>
                    )}
                    <span className="mt-caret">{open ? '▲' : '▼'}</span>
                  </button>

                  {open && (
                    <div className="mt-body">
                      <div className="small muted">{acct.label} · {m.attendees?.length || 0} guest{m.attendees?.length === 1 ? '' : 's'}</div>
                      {m.notes && <pre className="mt-notes">{m.notes}</pre>}

                      {m.meet ? (
                        <div className="mt-link">
                          <a href={m.meet} target="_blank" rel="noreferrer" className="btn btn-sm btn-green">▶ Join</a>
                          <code className="mt-url">{m.meet}</code>
                        </div>
                      ) : m.wantMeet !== false ? (
                        <div className="small mt" style={{ color: 'var(--yellow)' }}>
                          {st.key === 'pending' || st.key === 'queued'
                            ? 'Still being created.'
                            : 'The event exists but Google has not returned a Meet room yet — the background sync will fill it in.'}
                        </div>
                      ) : null}

                      {/* The whole point of the notes field: one button that
                          copies title, time, agenda and link as one block. */}
                      <div className="flex mt" style={{ gap: 6, flexWrap: 'wrap' }}>
                        <button className={`btn btn-sm ${copied === `i${m.id}` ? 'btn-green' : 'btn-cyan'}`}
                          onClick={() => copy(invite, `i${m.id}`)}>
                          {copied === `i${m.id}` ? '✓ Copied' : '⧉ Copy invite'}
                        </button>
                        {m.meet && (
                          <button className={`btn btn-sm ${copied === `l${m.id}` ? 'btn-green' : ''}`}
                            onClick={() => copy(m.meet, `l${m.id}`)}>
                            {copied === `l${m.id}` ? '✓ Copied' : '⧉ Link only'}
                          </button>
                        )}
                        {m.htmlLink && (
                          <a className="btn btn-sm" href={m.htmlLink} target="_blank" rel="noreferrer">Calendar ↗</a>
                        )}
                        <button className="btn btn-sm" onClick={() => setForm(f => ({
                          ...f, title: m.title || '', notes: m.notes || '',
                          account: m.account || f.account,
                          guests: (m.attendees || []).join(', '),
                        }))}>⟳ Use as template</button>
                        <span style={{ flex: 1 }} />
                        <button className="btn btn-sm" onClick={() => del(m.id)}>✕ Remove</button>
                      </div>

                      <details className="mt-preview">
                        <summary className="small muted">Preview what gets pasted</summary>
                        <pre className="mt-invite">{invite}</pre>
                      </details>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </Card>

      <Card title="How this works" color="var(--ink-3)">
        <div className="small muted" style={{ lineHeight: 1.6 }}>
          Meetings are created by calling Google directly from this app, so the link comes back in a
          few seconds. They used to be queued for a background job on a five-minute cron — which,
          with GitHub&rsquo;s own scheduling delay on top, is where the several-minute wait came from.
          That job still runs: it syncs your calendars, and it repairs any meeting whose Meet room
          Google had not finished creating before the request had to return.
          {' '}Removing a meeting here removes it from this list only — delete it in Google Calendar
          to cancel it for the guests.
        </div>
      </Card>
    </>
  );
}
