import React, { useMemo, useState } from 'react';
import { useCollection } from '../lib/hooks.js';
import { Card } from './ui.jsx';

const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const WD = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const z = n => String(n).padStart(2, '0');
const dkey = d => `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;

// Compact month calendar for the dashboard. Dots: cyan = class day, pink = event,
// yellow = task due. Tap opens the full Calendar tab.
export default function MiniCalendar({ go }) {
  const { items: mem } = useCollection('memory', { filter: 'key=eq.calendar_events', order: 'key' });
  const { items: timetable } = useCollection('timetable');
  const { items: todos } = useCollection('todos');
  const gEvents = mem?.[0]?.value?.events || [];
  const today = new Date();
  const tk = dkey(today);
  const [cur, setCur] = useState({ y: today.getFullYear(), m: today.getMonth() });

  const classDays = useMemo(() => new Set(timetable.map(t => t.day)), [timetable]);
  const eventDays = useMemo(() => {
    const s = new Set();
    gEvents.forEach(e => { if (e.start) s.add(dkey(new Date(e.start))); });
    return s;
  }, [gEvents]);
  const todoDays = useMemo(() => {
    const s = new Set();
    todos.forEach(t => { if (!t.completed && t.due_date) s.add(t.due_date); });
    return s;
  }, [todos]);

  const weeks = useMemo(() => {
    const first = new Date(cur.y, cur.m, 1);
    const start = new Date(first); start.setDate(1 - first.getDay());
    const out = [];
    for (let w = 0; w < 6; w++) {
      const row = [];
      for (let d = 0; d < 7; d++) {
        const date = new Date(start); date.setDate(start.getDate() + w * 7 + d);
        const k = dkey(date);
        row.push({
          k, day: date.getDate(), inMonth: date.getMonth() === cur.m, isToday: k === tk,
          cls: classDays.has(WD[date.getDay()]), ev: eventDays.has(k), td: todoDays.has(k),
        });
      }
      out.push(row);
    }
    return out;
  }, [cur, classDays, eventDays, todoDays]); // eslint-disable-line

  const move = d => setCur(c => { const x = new Date(c.y, c.m + d, 1); return { y: x.getFullYear(), m: x.getMonth() }; });

  return (
    <Card title="Calendar" color="var(--cyan)" right={<button className="btn btn-sm" onClick={() => go('calendar')}>open →</button>}>
      <div className="mc-head">
        <button className="btn btn-sm" onClick={() => move(-1)}>◀</button>
        <span className="mc-title">{MONTHS[cur.m]} {cur.y}</span>
        <button className="btn btn-sm" onClick={() => move(1)}>▶</button>
      </div>
      <div className="mc-grid mc-dow">{DOW.map((d, i) => <span key={i} className="mc-dowc">{d}</span>)}</div>
      {weeks.map((row, wi) => (
        <div className="mc-grid" key={wi}>
          {row.map(c => (
            <button key={c.k} className={`mc-cell${c.inMonth ? '' : ' out'}${c.isToday ? ' today' : ''}`} onClick={() => go('calendar')}>
              <span>{c.day}</span>
              <span className="mc-dots">
                {c.cls && <i className="mc-dot" style={{ background: 'var(--cyan)' }} />}
                {c.ev && <i className="mc-dot" style={{ background: 'var(--pink)' }} />}
                {c.td && <i className="mc-dot" style={{ background: 'var(--yellow)' }} />}
              </span>
            </button>
          ))}
        </div>
      ))}
      <div className="mc-legend small muted">
        <span><i className="mc-dot" style={{ background: 'var(--cyan)' }} /> class</span>
        <span><i className="mc-dot" style={{ background: 'var(--pink)' }} /> event</span>
        <span><i className="mc-dot" style={{ background: 'var(--yellow)' }} /> task</span>
      </div>
    </Card>
  );
}
