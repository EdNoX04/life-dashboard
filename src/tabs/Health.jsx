import React, { useMemo, useState } from 'react';
import { useCollection, todayStr } from '../lib/hooks.js';
import { Card, Empty, RefreshButton } from '../components/ui.jsx';
import Sparkline from '../components/Sparkline.jsx';

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;

export default function Health() {
  const { items: metrics, refresh } = useCollection('health_metrics', { order: 'date', asc: true });
  const { items: workouts, add: addWorkout, del } = useCollection('workouts', { order: 'date' });
  const { items: mem } = useCollection('memory', { filter: 'key=eq.health_last_sync', order: 'key' });
  const [w, setW] = useState({ title: '', duration_min: '', date: todayStr() });

  const lastSync = mem?.[0]?.value?.at;

  // series per metric (chronological values)
  const series = useMemo(() => {
    const m = {};
    for (const r of metrics) { const v = num(r.value); if (v == null) continue; (m[r.metric] ||= []).push({ date: r.date, v }); }
    for (const k of Object.keys(m)) m[k].sort((a, b) => a.date.localeCompare(b.date));
    return m;
  }, [metrics]);

  const latest = k => series[k]?.length ? series[k][series[k].length - 1].v : null;
  const vals = (k, n = 14) => (series[k] || []).slice(-n).map(x => x.v);
  const has = Object.keys(series).length > 0;

  // ---- Bevel-style readiness score ----
  const readiness = useMemo(() => {
    if (!has) return null;
    let score = 68; const notes = [];
    const hrv = latest('hrv'), hrvBase = avg(vals('hrv', 14).slice(0, -1));
    const rhr = latest('resting_hr'), rhrBase = avg(vals('resting_hr', 14).slice(0, -1));
    const sleep = latest('sleep_hours');
    if (hrv != null && hrvBase) { const d = (hrv - hrvBase) / hrvBase; score += Math.max(-14, Math.min(16, d * 60)); notes.push(d >= 0 ? 'HRV above baseline' : 'HRV below baseline'); }
    if (rhr != null && rhrBase) { const d = (rhrBase - rhr) / rhrBase; score += Math.max(-12, Math.min(12, d * 60)); notes.push(rhr <= rhrBase ? 'Resting HR steady/low' : 'Resting HR elevated'); }
    if (sleep != null) { score += sleep >= 7 ? 8 : sleep >= 6 ? 0 : -12; notes.push(sleep >= 7 ? 'Slept well' : sleep >= 6 ? 'Slept OK' : 'Short sleep'); }
    score = Math.max(1, Math.min(99, Math.round(score)));
    const band = score >= 82 ? ['PRIME', 'var(--green)'] : score >= 66 ? ['GOOD', 'var(--cyan)'] : score >= 50 ? ['FAIR', 'var(--yellow)'] : ['RECOVER', 'var(--red)'];
    return { score, band: band[0], color: band[1], notes: notes.slice(0, 3) };
  }, [series, has]);

  const TILES = [
    ['sleep_hours', 'Sleep', 'h', 'var(--purple)', '#9a63e8'],
    ['steps', 'Steps', '', 'var(--green)', '#2fa848'],
    ['resting_hr', 'Resting HR', ' bpm', 'var(--pink)', '#e84191'],
    ['hrv', 'HRV', ' ms', 'var(--cyan)', '#1f9ecf'],
    ['active_energy', 'Active kcal', '', 'var(--orange)', '#d96a1f'],
    ['exercise_min', 'Exercise', ' min', 'var(--yellow)', '#b3860a'],
  ];

  async function logWorkout() {
    if (!w.title.trim()) return;
    await addWorkout({ title: w.title.trim(), duration_min: Number(w.duration_min) || null, date: w.date, source: 'manual', exercises: [] });
    setW({ title: '', duration_min: '', date: todayStr() });
  }
  const insights = metrics.filter(m => m.metric === 'insight').slice(-3).reverse();
  const thisWeek = workouts.filter(x => x.date >= todayStr(new Date(Date.now() - 6 * 864e5))).length;

  return (
    <>
      <div className="spread">
        <h1 className="tab-title">HEALTH</h1>
        <RefreshButton source="health" onLocalRefresh={refresh} label="Sync" />
      </div>
      <p className="tab-sub">Bevel-style insights · Apple Health via Health Auto Export{lastSync ? ` · synced ${new Date(lastSync).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}</p>

      {!has && (
        <Card color="var(--red)">
          <Empty icon="♥" text="No health data yet. Set up Health Auto Export on your iPhone (steps below) and it flows in automatically — no Mac needed." />
        </Card>
      )}

      {readiness && (
        <Card title="Readiness" color={readiness.color}>
          <div className="flex" style={{ gap: 20, flexWrap: 'wrap' }}>
            <div className="ready-ring" style={{ '--c': readiness.color, '--p': readiness.score }}>
              <div className="ready-inner">
                <div className="ready-score" style={{ color: readiness.color }}>{readiness.score}</div>
                <div className="ready-band">{readiness.band}</div>
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 180 }}>
              {readiness.notes.map((n, i) => <div className="row" key={i}><span className="chip c-cyan">•</span><span>{n}</span></div>)}
            </div>
          </div>
        </Card>
      )}

      {has && (
        <div className="tile-row">
          {TILES.map(([key, label, unit, col, spark]) => {
            const v = latest(key);
            if (v == null && !(series[key]?.length)) return null;
            return (
              <div className="px stat-tile" key={key}>
                <div className="stat-label" style={{ color: col }}>{label}</div>
                <div className="stat-value" style={{ fontSize: 17 }}>{v != null ? (Number.isInteger(v) ? v.toLocaleString() : v.toFixed(1)) + unit : '—'}</div>
                <div style={{ marginTop: 8 }}><Sparkline data={vals(key, 14)} color={spark} w={140} h={28} /></div>
              </div>
            );
          })}
        </div>
      )}

      <Card title="Insights" color="var(--pink)">
        {insights.length === 0
          ? <Empty icon="✦" text="Once data flows in, the daily run writes Bevel-style insights here (recovery, load, sleep debt, trends)." />
          : insights.map(m => <div className="row" key={m.id}><span style={{ flex: 1 }}>{m.note || m.value}</span><span className="chip c-purple">{m.date}</span></div>)}
      </Card>

      <Card title="Log workout (manual)" color="var(--yellow)">
        <div className="flex" style={{ flexWrap: 'wrap' }}>
          <input style={{ flex: 2, minWidth: 150 }} placeholder="e.g. Push day, 5k run" value={w.title} onChange={e => setW({ ...w, title: e.target.value })} />
          <input style={{ width: 110 }} type="number" placeholder="Minutes" value={w.duration_min} onChange={e => setW({ ...w, duration_min: e.target.value })} />
          <input style={{ width: 150 }} type="date" value={w.date} onChange={e => setW({ ...w, date: e.target.value })} />
          <button className="btn btn-green" onClick={logWorkout}>+ Log</button>
        </div>
        <div className="small muted mt">Hevy auto-sync coming next — for now, manual + Apple Health workouts.</div>
      </Card>

      <Card title={`Workouts (${thisWeek} this week)`} color="var(--cyan)">
        {workouts.length === 0 && <Empty icon="🏋" text="No workouts yet." />}
        {workouts.slice(0, 20).map(x => (
          <div className="row" key={x.id}>
            <span className="chip c-purple">{x.date}</span>
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
