import React, { useMemo, useState } from 'react';
import { useCollection, todayStr } from '../lib/hooks.js';
import { Card, Empty, StatTile, PCheck } from '../components/ui.jsx';

function lastNDays(n) {
  return Array.from({ length: n }, (_, i) => todayStr(new Date(Date.now() - (n - 1 - i) * 864e5)));
}

function streakOf(dates) {
  const set = new Set(dates);
  let s = 0;
  for (let i = 0; ; i++) {
    const d = todayStr(new Date(Date.now() - i * 864e5));
    if (set.has(d)) s++;
    else if (i === 0) continue; // today not done yet doesn't break streak
    else break;
  }
  return s;
}

export default function Habits() {
  const { items: habits, add: addHabit, patch, del } = useCollection('habits');
  const { items: logs, add: addLog, del: delLog } = useCollection('habit_logs');
  const [name, setName] = useState('');
  const [cat, setCat] = useState('');

  const today = todayStr();
  const days = lastNDays(14);
  const live = habits.filter(h => !h.archived);

  const byHabit = useMemo(() => {
    const m = {};
    for (const l of logs) (m[l.habit_id] ||= []).push(l);
    return m;
  }, [logs]);

  const cats = [...new Set(live.map(h => h.category || 'General'))];
  const doneToday = live.filter(h => (byHabit[h.id] || []).some(l => l.date === today)).length;
  const bestStreak = Math.max(0, ...live.map(h => streakOf((byHabit[h.id] || []).map(l => l.date))));

  async function toggle(habit) {
    const log = (byHabit[habit.id] || []).find(l => l.date === today);
    if (log) await delLog(log.id);
    else await addLog({ habit_id: habit.id, date: today });
  }

  return (
    <>
      <h1 className="tab-title">HABITS</h1>
      <p className="tab-sub">Check the box. Keep the streak. Level up.</p>

      <div className="tile-row">
        <StatTile label="Done today" value={`${doneToday}/${live.length}`} color="var(--green)" />
        <StatTile label="Best streak" value={`${bestStreak}d`} note="don't break the chain" color="var(--yellow)" />
        <StatTile label="Habits" value={live.length} color="var(--pink)" />
      </div>

      <Card title="New habit" color="var(--yellow)">
        <div className="flex" style={{ flexWrap: 'wrap' }}>
          <input style={{ flex: 2, minWidth: 160 }} placeholder="Habit (e.g. Gym, Read 20 min)" value={name}
            onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && name.trim() && (addHabit({ name: name.trim(), category: cat.trim() || 'General', archived: false }), setName(''))} />
          <input style={{ width: 160 }} placeholder="Category" value={cat} onChange={e => setCat(e.target.value)} />
          <button className="btn btn-green" onClick={() => name.trim() && (addHabit({ name: name.trim(), category: cat.trim() || 'General', archived: false }), setName(''))}>+ Add</button>
        </div>
      </Card>

      {live.length === 0 && <Card><Empty icon="♥" text="No habits yet — add your first one above." /></Card>}

      {cats.map(c => (
        <Card key={c} title={c} color="var(--purple)">
          {live.filter(h => (h.category || 'General') === c).map(h => {
            const hl = byHabit[h.id] || [];
            const dates = new Set(hl.map(l => l.date));
            const done = dates.has(today);
            const streak = streakOf([...dates]);
            return (
              <div className="row" key={h.id}>
                <PCheck done={done} xp={5} onToggle={() => toggle(h)} />
                <span className={done ? 'struck' : ''} style={{ flex: 1 }}>{h.name}</span>
                <span className="streak-cells" title="last 14 days">
                  {days.map(d => <span key={d} className={`scell ${dates.has(d) ? 'on' : ''}`} />)}
                </span>
                <span className="chip c-yellow">{streak}d 🔥</span>
                <span className="chip c-cyan">{hl.length} total</span>
                <button className="btn btn-sm" onClick={() => del(h.id)}>✕</button>
              </div>
            );
          })}
        </Card>
      ))}
    </>
  );
}
