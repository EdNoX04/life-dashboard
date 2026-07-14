import React, { useMemo, useState } from 'react';
import { useCollection, todayStr } from '../lib/hooks.js';
import { Card, Empty, RefreshButton } from '../components/ui.jsx';
import * as db from '../lib/db.js';

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const fmtTime = iso => {
  try { return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }); } catch { return ''; }
};
const dayKey = d => { const z = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`; };

export default function Calendar() {
  const { items: mem, refresh: rMem } = useCollection('memory', { filter: 'key=eq.calendar_events', order: 'key' });
  const { items: timetable } = useCollection('timetable', { order: 'start_time', asc: true });
  const [days, setDays] = useState(10);
  const [form, setForm] = useState({ summary: '', date: todayStr(), start: '10:00', end: '11:00' });

  const gEvents = mem?.[0]?.value?.events || [];
  const lastSync = mem?.[0]?.value?.updated;

  // build a day-by-day agenda for the next `days` days: google events + recurring college classes
  const agenda = useMemo(() => {
    const out = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(); d.setDate(d.getDate() + i);
      const key = dayKey(d);
      const weekday = DOW[d.getDay()];
      const items = [];
      // college classes for this weekday
      timetable.filter(t => t.day === weekday).forEach(t => items.push({
        type: 'class', time: t.start_time, endTime: t.end_time, title: t.subject, sub: t.room, sortT: t.start_time || '00:00',
      }));
      // google events on this date
      gEvents.forEach(e => {
        const s = e.start ? new Date(e.start) : null;
        if (s && dayKey(s) === key) items.push({
          type: 'gcal', time: e.allDay ? 'All day' : fmtTime(e.start), title: e.summary || '(no title)', sub: e.location || '', id: e.id,
          sortT: e.allDay ? '00:00' : (s.getHours() + ':' + String(s.getMinutes()).padStart(2, '0')),
        });
      });
      items.sort((a, b) => (a.sortT || '').localeCompare(b.sortT || ''));
      out.push({ key, label: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : `${weekday}, ${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`, items });
    }
    return out;
  }, [gEvents, timetable, days]);

  async function addEvent() {
    if (!form.summary.trim()) return;
    const startISO = `${form.date}T${form.start}:00`;
    const endISO = `${form.date}T${form.end}:00`;
    await db.sendRequest('calendar_add', { summary: form.summary.trim(), start: startISO, end: endISO, timeZone: 'Asia/Kolkata' });
    setForm({ ...form, summary: '' });
  }
  async function delEvent(id, title) {
    await db.sendRequest('calendar_delete', { eventId: id, title });
  }

  return (
    <>
      <div className="spread">
        <h1 className="tab-title">CALENDAR</h1>
        <RefreshButton source="calendar" onLocalRefresh={rMem} label="Sync GCal" />
      </div>
      <p className="tab-sub">Google Calendar + college classes, merged. {lastSync ? `Synced ${new Date(lastSync).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : 'Not synced yet — hit Sync GCal.'}</p>

      <Card title="Add event" color="var(--yellow)">
        <div className="flex" style={{ flexWrap: 'wrap' }}>
          <input style={{ flex: 2, minWidth: 160 }} placeholder="Event title" value={form.summary} onChange={e => setForm({ ...form, summary: e.target.value })} onKeyDown={e => e.key === 'Enter' && addEvent()} />
          <input type="date" style={{ width: 150 }} value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
          <input type="time" style={{ width: 110 }} value={form.start} onChange={e => setForm({ ...form, start: e.target.value })} />
          <input type="time" style={{ width: 110 }} value={form.end} onChange={e => setForm({ ...form, end: e.target.value })} />
          <button className="btn btn-green" onClick={addEvent}>+ Add</button>
        </div>
        <div className="small muted mt">Adds to Google Calendar on the next Cowork sync (or ask "sync my calendar").</div>
      </Card>

      {agenda.map(day => (
        <Card key={day.key} title={day.label} color={day.items.length ? 'var(--cyan)' : 'var(--border)'}>
          {day.items.length === 0 && <div className="muted small" style={{ padding: '4px 2px' }}>— nothing scheduled —</div>}
          {day.items.map((it, i) => (
            <div className="row" key={i}>
              <span className={`chip ${it.type === 'class' ? 'c-purple' : 'c-cyan'}`} style={{ minWidth: 70, textAlign: 'center' }}>{it.time}{it.endTime ? `–${it.endTime}` : ''}</span>
              <span style={{ flex: 1 }}>{it.title}{it.sub ? <span className="muted small"> · {it.sub}</span> : ''}</span>
              <span className={`chip ${it.type === 'class' ? 'c-purple' : 'c-cyan'}`}>{it.type === 'class' ? 'CLASS' : 'GCAL'}</span>
              {it.type === 'gcal' && it.id && <button className="btn btn-sm" onClick={() => delEvent(it.id, it.title)}>✕</button>}
            </div>
          ))}
        </Card>
      ))}

      <div className="flex" style={{ justifyContent: 'center', marginTop: 8 }}>
        <button className="btn btn-sm" onClick={() => setDays(d => d + 7)}>Show more days</button>
      </div>
    </>
  );
}
