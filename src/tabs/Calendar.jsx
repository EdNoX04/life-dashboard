import React, { useMemo, useState } from 'react';
import { useCollection, todayStr } from '../lib/hooks.js';
import { Card, RefreshButton } from '../components/ui.jsx';
import * as db from '../lib/db.js';
import { buildICS, downloadICS } from '../lib/ics.js';
import { normaliseTask, fmtTime as fmtT, fmtDuration, isScheduled, layoutDay } from '../lib/todos.js';

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DOW_S = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const z = n => String(n).padStart(2, '0');
const dayKey = d => `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
const fmtTime = iso => { try { return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };

export default function Calendar() {
  const { items: mem, refresh: rMem } = useCollection('memory', { filter: 'key=eq.calendar_events', order: 'key' });
  const { items: timetable } = useCollection('timetable', { order: 'start_time', asc: true });
  const { items: rawTodos } = useCollection('todos');
  // Normalised through the same model the Todos tab uses, so a task cannot mean
  // one thing on one screen and another here.
  const todos = useMemo(() => (rawTodos || []).map(normaliseTask), [rawTodos]);
  const today = new Date();
  const todayK = dayKey(today);
  const [cursor, setCursor] = useState({ y: today.getFullYear(), m: today.getMonth() });
  const [selected, setSelected] = useState(null); // date key string
  const [form, setForm] = useState({ summary: '', start: '10:00', end: '11:00' });

  const gEvents = mem?.[0]?.value?.events || [];
  const lastSync = mem?.[0]?.value?.updated;

  // merged items (recurring college classes + google events) for one date
  const itemsFor = (key, weekday) => {
    const items = [];
    timetable.filter(t => t.day === weekday).forEach(t => items.push({
      type: 'class', time: t.start_time, endTime: t.end_time, title: t.subject, sub: t.room, sortT: t.start_time || '00:00',
    }));
    gEvents.forEach(e => {
      const s = e.start ? new Date(e.start) : null;
      if (s && dayKey(s) === key) items.push({
        type: 'gcal', time: e.allDay ? 'All day' : fmtTime(e.start), title: e.summary || '(no title)',
        // Location is the useful subtitle when there is one; when there is not,
        // the account the event came from is the next most useful thing to know
        // — "is this a work thing or a me thing" is the question you ask of an
        // unfamiliar entry, and it is answered here without a click.
        sub: e.location || (e.accountLabel && e.accountLabel !== 'Personal' ? e.accountLabel : ''),
        id: e.id,
        account: e.account || '', accountLabel: e.accountLabel || '',
        color: e.color || '', meet: e.meet || '', alsoOn: e.alsoOn || [],
        sortT: e.allDay ? '00:00' : `${z(s.getHours())}:${z(s.getMinutes())}`,
      });
    });
    // Tasks. A task WITH a time sorts into the day among the classes and the
    // meetings, because at that point it is a commitment like any other. A task
    // with only a date sorts to the top as a deadline — it is a thing owed by
    // the end of the day, not a thing happening at midnight, and the label says
    // so rather than showing 12:00 am.
    todos.filter(t => t.due_date === key).forEach(t => items.push({
      type: 'task',
      time: isScheduled(t) ? fmtT(t.due_time) : 'Due',
      title: t.title,
      sub: [fmtDuration(t.duration_min), t.list && t.list !== 'Inbox' ? t.list : '']
        .filter(Boolean).join(' · '),
      id: t.id,
      done: t.completed,
      // Completed tasks stay on the day they were done. A calendar is a record
      // as well as a plan, and deleting the evidence the moment something is
      // finished makes a busy week look empty in hindsight.
      sortT: isScheduled(t) ? t.due_time : '00:00',
    }));

    items.sort((a, b) => (a.sortT || '').localeCompare(b.sortT || ''));
    return items;
  };

  // 6-week grid starting on the Sunday on/before the 1st of the month
  const weeks = useMemo(() => {
    const first = new Date(cursor.y, cursor.m, 1);
    const start = new Date(first);
    start.setDate(1 - first.getDay());
    const out = [];
    for (let w = 0; w < 6; w++) {
      const row = [];
      for (let d = 0; d < 7; d++) {
        const date = new Date(start);
        date.setDate(start.getDate() + w * 7 + d);
        const key = dayKey(date);
        row.push({
          key, day: date.getDate(),
          inMonth: date.getMonth() === cursor.m,
          isToday: key === todayK,
          items: itemsFor(key, DOW[date.getDay()]),
        });
      }
      out.push(row);
    }
    return out;
  }, [cursor, gEvents, timetable]); // eslint-disable-line

  const selDate = selected ? new Date(selected + 'T00:00:00') : null;
  const selItems = selected ? itemsFor(selected, DOW[selDate.getDay()]) : [];

  async function addEvent() {
    if (!form.summary.trim() || !selected) return;
    await db.sendRequest('calendar_add', {
      summary: form.summary.trim(), start: `${selected}T${form.start}:00`, end: `${selected}T${form.end}:00`, timeZone: 'Asia/Kolkata',
    });
    setForm({ ...form, summary: '' });
  }
  async function delEvent(id, title) { await db.sendRequest('calendar_delete', { eventId: id, title }); }

  const move = delta => setCursor(c => { const d = new Date(c.y, c.m + delta, 1); return { y: d.getFullYear(), m: d.getMonth() }; });

  return (
    <>
      <div className="spread">
        <h1 className="tab-title">CALENDAR</h1>
        <span className="flex" style={{ gap: 6 }}>
          <button className="btn btn-sm btn-green"
            onClick={() => downloadICS(buildICS({ timetable, events: gEvents, todos }), 'player-one.ics')}
            title="Download all classes, events & due tasks as a calendar file">↧ Export .ics</button>
          <RefreshButton source="calendar" onLocalRefresh={rMem} label="Sync GCal" />
        </span>
      </div>
      <p className="tab-sub">Google Calendar + college classes, merged. {lastSync ? `Synced ${new Date(lastSync).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : 'Not synced yet — hit Sync GCal.'}</p>

      <Card title="Sync to your phone calendar" color="var(--green)">
        <div className="small" style={{ color: 'var(--ink-2)', lineHeight: 1.5 }}>
          Hit <b>Export .ics</b> to download your whole schedule — weekly classes (repeating), college events and due tasks — as one calendar file. Open it on your iPhone/Mac to drop everything into Apple or Google Calendar in one tap. Re-export whenever the timetable changes and it updates. Adding an event below still pushes to Google Calendar on the next sync.
        </div>
      </Card>

      <Card color="var(--purple)">
        <div className="cal-head">
          <button className="btn btn-sm" onClick={() => move(-1)}>◀</button>
          <div className="cal-title">{MONTHS[cursor.m]} {cursor.y}</div>
          <span className="flex" style={{ gap: 6 }}>
            <button className="btn btn-sm btn-cyan" onClick={() => setCursor({ y: today.getFullYear(), m: today.getMonth() })}>Today</button>
            <button className="btn btn-sm" onClick={() => move(1)}>▶</button>
          </span>
        </div>

        <div className="cal-grid cal-dow">
          {DOW_S.map((d, i) => <div key={i} className="cal-dow-cell">{d}</div>)}
        </div>

        {weeks.map((row, wi) => (
          <div className="cal-grid" key={wi} style={{ marginTop: 5 }}>
            {row.map(cell => (
              <button
                key={cell.key}
                className={`cal-cell${cell.inMonth ? '' : ' out'}${cell.isToday ? ' today' : ''}${selected === cell.key ? ' sel' : ''}`}
                onClick={() => { setSelected(cell.key); setForm(f => ({ ...f, summary: '' })); }}>
                <span className="cal-num">{cell.day}</span>
                <span className="cal-dots">
                  {cell.items.slice(0, 3).map((it, i) => (
                    <span key={i} className={`cal-dot ${it.type === 'class' ? 'd-class' : it.type === 'task' ? 'd-task' : 'd-gcal'}`} />
                  ))}
                  {cell.items.length > 3 && <span className="cal-more">+{cell.items.length - 3}</span>}
                </span>
              </button>
            ))}
          </div>
        ))}

        <div className="cal-legend small muted">
          <span><span className="cal-dot d-class" /> class</span>
          <span><span className="cal-dot d-gcal" /> event</span>
          <span>tap a day for details</span>
        </div>
      </Card>

      {selected && (
        <div className="modal-overlay" onClick={() => setSelected(null)}>
          <div className="px modal-panel" onClick={e => e.stopPropagation()}>
            <div className="spread" style={{ marginBottom: 10 }}>
              <div className="card-title" style={{ margin: 0 }}>
                <span className="sq" style={{ background: 'var(--cyan)' }} />
                {selDate.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
              </div>
              <button className="btn btn-sm btn-pink" onClick={() => setSelected(null)}>✕</button>
            </div>

            {/* The same layout the Todos day grid draws, so the two screens
                cannot disagree about whether an afternoon is full. Clashes are
                named here too — a double-booking found on the calendar is
                exactly where you want to find one. */}
            {(() => {
              const d = layoutDay(todos, selected);
              if (!d.blocks.length && !d.unscheduled.length) return null;
              return (
                <div className="cal-load">
                  {fmtDuration(d.plannedMin) || 'no time'} of tasks booked
                  {d.unplacedMin > 0 && <i> · {fmtDuration(d.unplacedMin)} estimated with no time yet</i>}
                  {d.clashes.length > 0 && (
                    <b className="cal-clash" title={d.clashes.map(c => `${c.a.title} × ${c.b.title}`).join('\n')}>
                      {' '}· ⚠ {d.clashes.length} overlap{d.clashes.length === 1 ? '' : 's'}
                    </b>
                  )}
                </div>
              );
            })()}

            {selItems.length === 0 && <div className="muted small" style={{ padding: '4px 2px' }}>— nothing scheduled —</div>}
            {selItems.map((it, i) => (
              <div className={`row${it.type === 'task' && it.done ? ' cal-donerow' : ''}`} key={i}>
                <span className={`chip ${it.type === 'class' ? 'c-purple' : it.type === 'task' ? 'c-green' : 'c-cyan'}`}
                  style={{ minWidth: 66, textAlign: 'center' }}>{it.time}{it.endTime ? `–${it.endTime}` : ''}</span>
                <span style={{ flex: 1 }}>
                  <span className={it.type === 'task' && it.done ? 'struck' : ''}>{it.title}</span>
                  {it.sub ? <span className="muted small"> · {it.sub}</span> : ''}
                </span>
                {it.meet && (
                  <a className="btn btn-sm btn-green" href={it.meet} target="_blank" rel="noreferrer"
                     title="Join the Google Meet for this event">JOIN</a>
                )}
                <span
                  className={`chip ${it.type === 'class' ? 'c-purple' : it.type === 'task' ? 'c-green' : 'c-cyan'}`}
                  // A work event and a personal event are both "GCAL", which is
                  // the least interesting thing about either of them. The chip
                  // takes the account colour so the day reads at a glance.
                  style={it.type === 'gcal' && it.color ? { color: it.color, borderColor: it.color } : undefined}
                  title={it.alsoOn?.length ? `Also on: ${it.alsoOn.join(', ')}` : undefined}
                >
                  {it.type === 'class' ? 'CLASS'
                    : it.type === 'task' ? (it.done ? 'DONE' : 'TASK')
                      : (it.accountLabel || 'GCAL').toUpperCase()}
                </span>
                {it.type === 'gcal' && it.id && <button className="btn btn-sm" onClick={() => delEvent(it.id, it.title)}>✕</button>}
              </div>
            ))}

            <div className="card-title mt" style={{ fontSize: 12 }}><span className="sq" style={{ background: 'var(--yellow)' }} />Add event</div>
            <div className="flex" style={{ flexWrap: 'wrap', gap: 6 }}>
              <input style={{ flex: 2, minWidth: 140 }} placeholder="Event title" value={form.summary} onChange={e => setForm({ ...form, summary: e.target.value })} onKeyDown={e => e.key === 'Enter' && addEvent()} />
              <input type="time" style={{ width: 100 }} value={form.start} onChange={e => setForm({ ...form, start: e.target.value })} />
              <input type="time" style={{ width: 100 }} value={form.end} onChange={e => setForm({ ...form, end: e.target.value })} />
              <button className="btn btn-green" onClick={addEvent}>+ Add</button>
            </div>
            <div className="small muted mt">Adds to Google Calendar on the next Cowork sync.</div>
          </div>
        </div>
      )}
    </>
  );
}
