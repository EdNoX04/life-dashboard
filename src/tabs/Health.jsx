import React, { useState } from 'react';
import { useCollection, todayStr } from '../lib/hooks.js';
import { Card, Empty, StatTile, RefreshButton } from '../components/ui.jsx';

export default function Health() {
  const { items: metrics, refresh } = useCollection('health_metrics', { order: 'date' });
  const { items: workouts, add: addWorkout, del } = useCollection('workouts', { order: 'date' });
  const [w, setW] = useState({ title: '', duration_min: '', date: todayStr() });

  const today = todayStr();
  const latest = name => metrics.find(m => m.metric === name);
  const steps = latest('steps'), sleep = latest('sleep_hours'), hr = latest('resting_hr'), energy = latest('active_energy');
  const thisWeek = workouts.filter(x => x.date >= todayStr(new Date(Date.now() - 6 * 864e5))).length;

  async function logWorkout() {
    if (!w.title.trim()) return;
    await addWorkout({ title: w.title.trim(), duration_min: Number(w.duration_min) || null, date: w.date, source: 'manual', exercises: [] });
    setW({ title: '', duration_min: '', date: todayStr() });
  }

  return (
    <>
      <div className="spread">
        <h1 className="tab-title">HEALTH</h1>
        <RefreshButton source="health" onLocalRefresh={refresh} label="Sync" />
      </div>
      <p className="tab-sub">Apple Health via Health Auto Export · workouts via Hevy · Bevel-style insights by Cowork.</p>

      <div className="tile-row">
        <StatTile label="Steps" value={steps ? Number(steps.value).toLocaleString() : '—'} note={steps?.date} color="var(--green)" />
        <StatTile label="Sleep" value={sleep ? `${sleep.value}h` : '—'} note={sleep?.date} color="var(--purple)" />
        <StatTile label="Resting HR" value={hr ? `${hr.value} bpm` : '—'} note={hr?.date} color="var(--pink)" />
        <StatTile label="Workouts (7d)" value={thisWeek} color="var(--cyan)" />
      </div>

      <Card title="Insights" color="var(--pink)">
        {metrics.filter(m => m.metric === 'insight').length === 0
          ? <Empty icon="♥" text="Once health data flows in, Cowork writes Bevel-style insights here (recovery, load, trends)." />
          : metrics.filter(m => m.metric === 'insight').slice(0, 3).map(m => (
            <div className="row" key={m.id}><span style={{ flex: 1 }}>{m.note || m.value}</span><span className="chip c-purple">{m.date}</span></div>
          ))}
      </Card>

      <Card title="Log workout (manual)" color="var(--yellow)">
        <div className="flex" style={{ flexWrap: 'wrap' }}>
          <input style={{ flex: 2, minWidth: 150 }} placeholder="e.g. Push day, 5k run" value={w.title} onChange={e => setW({ ...w, title: e.target.value })} />
          <input style={{ width: 110 }} type="number" placeholder="Minutes" value={w.duration_min} onChange={e => setW({ ...w, duration_min: e.target.value })} />
          <input style={{ width: 150 }} type="date" value={w.date} onChange={e => setW({ ...w, date: e.target.value })} />
          <button className="btn btn-green" onClick={logWorkout}>+ Log</button>
        </div>
      </Card>

      <Card title="Workout log" color="var(--cyan)">
        {workouts.length === 0 && <Empty icon="🏋" text="No workouts yet — log one above or connect Hevy." />}
        {workouts.map(x => (
          <div className="row" key={x.id}>
            <span className={`chip ${x.date === today ? 'c-green' : 'c-purple'}`}>{x.date}</span>
            <span style={{ flex: 1 }}>{x.title}</span>
            {x.duration_min && <span className="chip c-cyan">{x.duration_min} min</span>}
            <span className="chip">{x.source}</span>
            <button className="btn btn-sm" onClick={() => del(x.id)}>✕</button>
          </div>
        ))}
      </Card>
    </>
  );
}
