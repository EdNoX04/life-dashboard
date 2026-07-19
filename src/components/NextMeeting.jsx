import React, { useState } from 'react';
import { Card, Empty } from './ui.jsx';
import { useCollection, todayStr } from '../lib/hooks.js';
import * as db from '../lib/db.js';

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
const isoLocal = d => { const z = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}:00`; };
const fmtT = s => { try { return new Date(s).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
const fmtCountdown = mins => {
  if (mins < 0) return 'live now';
  if (mins < 60) return `in ${mins}m`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return `in ${h}h${m ? ' ' + m + 'm' : ''}`;
};

// Dashboard meeting hub: shows your next meeting with a ready Meet link (copy /
// open), and lets you add one. Adding queues a request that Cowork fulfils by
// creating the Google Calendar event + Meet link and writing it back here.
export default function NextMeeting() {
  const { items: mem, refresh } = useCollection('memory', { filter: 'key=eq.meetings', order: 'key' });
  const list = mem?.[0]?.value?.list || [];
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const today = todayStr();
  const [form, setForm] = useState({ title: '', date: today, time: '15:00', dur: 30, meet: true });

  const now = Date.now();
  const upcoming = list
    .filter(m => new Date(m.end || m.start).getTime() > now - 30 * 60000)
    .sort((a, b) => String(a.start).localeCompare(String(b.start)));
  const next = upcoming[0];

  async function save(nextList) {
    setBusy(true);
    try { await db.upsertMemory('meetings', { list: nextList, updated: new Date().toISOString() }); await refresh(); } catch {}
    setBusy(false);
  }
  async function add() {
    if (!form.title.trim()) return;
    const start = `${form.date}T${form.time}:00`;
    const end = isoLocal(new Date(new Date(start).getTime() + Number(form.dur) * 60000));
    const m = { id: uid(), title: form.title.trim(), start, end, meet: '', gcal_id: '', wantMeet: form.meet, status: 'pending', created: new Date().toISOString() };
    await save([m, ...list]);
    const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return 'Asia/Kolkata'; } })();
    db.sendRequest('meeting_add', { id: m.id, title: m.title, start, end, meet: form.meet, tz }).catch(() => {});
    setForm({ title: '', date: today, time: '15:00', dur: 30, meet: true });
    setOpen(false);
  }
  const del = id => save(list.filter(m => m.id !== id));
  function copy(link) { try { navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {} }

  const mins = next ? Math.round((new Date(next.start).getTime() - now) / 60000) : null;

  return (
    <Card title="Meetings" color="var(--pink)" right={<button className="btn btn-sm btn-pink" onClick={() => setOpen(o => !o)}>{open ? '✕' : '+ meeting'}</button>}>
      {open && (
        <div className="meet-form">
          <input placeholder="Meeting title" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
          <div className="flex mt" style={{ flexWrap: 'wrap', gap: 6 }}>
            <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
            <input type="time" value={form.time} onChange={e => setForm({ ...form, time: e.target.value })} />
            <select value={form.dur} onChange={e => setForm({ ...form, dur: e.target.value })}>
              <option value={15}>15 min</option><option value={30}>30 min</option><option value={45}>45 min</option><option value={60}>1 hr</option>
            </select>
            <label className="small flex" style={{ gap: 4, alignItems: 'center' }}>
              <input type="checkbox" checked={form.meet} onChange={e => setForm({ ...form, meet: e.target.checked })} /> Meet link
            </label>
            <button className="btn btn-sm btn-green" onClick={add} disabled={busy}>Add</button>
          </div>
          <div className="small muted mt">Adds to Google Calendar + generates a Meet link on the next Cowork sync.</div>
        </div>
      )}

      {!next && !open && <Empty icon="◷" text="No upcoming meetings. Hit + meeting to add one." />}

      {next && (
        <div className={`meet-next ${mins <= 0 ? 'live' : ''}`}>
          <div className="spread" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 160 }}>
              <div className="meet-title">{next.title}</div>
              <div className="small muted">{new Date(next.start).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })} · {fmtT(next.start)}{next.end ? `–${fmtT(next.end)}` : ''}</div>
            </div>
            <span className={`chip ${mins <= 0 ? 'c-green' : 'c-pink'}`}>{fmtCountdown(mins)}</span>
          </div>
          {next.meet ? (
            <div className="flex mt" style={{ gap: 6, flexWrap: 'wrap' }}>
              <a className="btn btn-sm btn-green" href={next.meet} target="_blank" rel="noreferrer">▶ Join Meet</a>
              <button className="btn btn-sm" onClick={() => copy(next.meet)}>{copied ? 'Copied ✓' : '⧉ Copy link'}</button>
              <span className="meet-link small muted">{next.meet.replace('https://', '')}</span>
            </div>
          ) : (
            <div className="small muted mt">🔗 Meet link generating on the next sync…</div>
          )}
        </div>
      )}

      {upcoming.length > 1 && (
        <div className="mt">
          {upcoming.slice(1, 4).map(m => (
            <div className="row" key={m.id}>
              <span className="chip c-pink">{fmtT(m.start)}</span>
              <span style={{ flex: 1 }} className="small">{m.title}</span>
              {m.meet && <a className="btn btn-sm" href={m.meet} target="_blank" rel="noreferrer">join</a>}
              <button className="btn btn-sm" onClick={() => del(m.id)}>✕</button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
