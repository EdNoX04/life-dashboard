import React, { useMemo, useState } from 'react';
import { useCollection, todayStr } from '../lib/hooks.js';
import { Card, Empty, RefreshButton } from '../components/ui.jsx';
import Sparkline from '../components/Sparkline.jsx';
import WorkoutLogger from '../components/WorkoutLogger.jsx';

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return todayStr(d); };
const WD = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function Health() {
  const { items: metrics, refresh } = useCollection('health_metrics', { order: 'date', asc: true });
  const { items: workouts, del, refresh: refreshW } = useCollection('workouts', { order: 'date' });
  const { items: mem } = useCollection('memory', { filter: 'key=eq.health_last_sync', order: 'key' });
  const { items: prMem, refresh: refreshPR } = useCollection('memory', { filter: 'key=eq.workout_prs', order: 'key' });
  const [openW, setOpenW] = useState(null);
  const [sel, setSel] = useState(null); // selected date (null → latest with data)

  const lastSync = mem?.[0]?.value?.at;
  const prs = prMem?.[0]?.value || {};

  // chronological series per metric + a date→metrics map for day view
  const { series, byDate, dates } = useMemo(() => {
    const s = {}, bd = {};
    for (const r of metrics) {
      const v = num(r.value); if (v == null) continue;
      (s[r.metric] ||= []).push({ date: r.date, v });
      (bd[r.date] ||= {})[r.metric] = v;
    }
    for (const k of Object.keys(s)) s[k].sort((a, b) => a.date.localeCompare(b.date));
    return { series: s, byDate: bd, dates: Object.keys(bd).sort() };
  }, [metrics]);

  const has = dates.length > 0;
  const today = todayStr();
  const selDate = sel || (dates.length ? dates[dates.length - 1] : today);
  const isToday = selDate === today;

  // value of a metric on the selected day; series values up to that day for sparkline
  const dayVal = k => byDate[selDate]?.[k] ?? null;
  const upto = (k, n = 14) => (series[k] || []).filter(x => x.date <= selDate).slice(-n).map(x => x.v);

  // ---- Bevel-style readiness for the SELECTED day ----
  const readiness = useMemo(() => {
    if (!has || !byDate[selDate]) return null;
    let score = 68; const notes = [];
    const hv = upto('hrv'), rv = upto('resting_hr');
    const hrv = dayVal('hrv'), hrvBase = avg(hv.slice(0, -1));
    const rhr = dayVal('resting_hr'), rhrBase = avg(rv.slice(0, -1));
    const sleep = dayVal('sleep_hours');
    if (hrv != null && hrvBase) { const d = (hrv - hrvBase) / hrvBase; score += Math.max(-14, Math.min(16, d * 60)); notes.push(d >= 0 ? 'HRV above baseline' : 'HRV below baseline'); }
    if (rhr != null && rhrBase) { const d = (rhrBase - rhr) / rhrBase; score += Math.max(-12, Math.min(12, d * 60)); notes.push(rhr <= rhrBase ? 'Resting HR steady/low' : 'Resting HR elevated'); }
    if (sleep != null) { score += sleep >= 7 ? 8 : sleep >= 6 ? 0 : -12; notes.push(sleep >= 7 ? 'Slept well' : sleep >= 6 ? 'Slept OK' : 'Short sleep'); }
    score = Math.max(1, Math.min(99, Math.round(score)));
    const band = score >= 82 ? ['PRIME', 'var(--green)'] : score >= 66 ? ['GOOD', 'var(--cyan)'] : score >= 50 ? ['FAIR', 'var(--yellow)'] : ['RECOVER', 'var(--red)'];
    return { score, band: band[0], color: band[1], notes: notes.slice(0, 3) };
  }, [selDate, byDate, series, has]);

  const TILES = [
    ['sleep_hours', 'Sleep', 'h', 'var(--purple)', '#9a63e8'],
    ['steps', 'Steps', '', 'var(--green)', '#2fa848'],
    ['resting_hr', 'Resting HR', ' bpm', 'var(--pink)', '#e84191'],
    ['hrv', 'HRV', ' ms', 'var(--cyan)', '#1f9ecf'],
    ['heart_rate', 'Heart rate', ' bpm', 'var(--red)', '#e84191'],
    ['active_energy', 'Active kcal', '', 'var(--orange)', '#d96a1f'],
    ['exercise_min', 'Exercise', ' min', 'var(--yellow)', '#b3860a'],
    ['spo2', 'SpO₂', '%', 'var(--cyan)', '#1f9ecf'],
    ['resp_rate', 'Respiration', ' bpm', 'var(--purple)', '#9a63e8'],
    ['distance_km', 'Distance', ' km', 'var(--green)', '#2fa848'],
    ['vo2max', 'VO₂ max', '', 'var(--orange)', '#d96a1f'],
    ['weight', 'Weight', ' kg', 'var(--pink)', '#e84191'],
  ];

  const todayHr = dayVal('heart_rate') || dayVal('resting_hr');
  const insights = metrics.filter(m => m.metric === 'insight' && m.date === selDate).slice(-3).reverse();
  const thisWeek = workouts.filter(x => x.date >= todayStr(new Date(Date.now() - 6 * 864e5))).length;
  const selIdx = dates.indexOf(selDate);
  const dayWorkouts = workouts.filter(x => x.date === selDate);

  return (
    <>
      <div className="spread">
        <h1 className="tab-title">HEALTH</h1>
        <RefreshButton source="health" onLocalRefresh={refresh} label="Sync" />
      </div>
      <p className="tab-sub">Apple Health via an iOS Shortcut automation{lastSync ? ` · synced ${new Date(lastSync).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}</p>

      {!has && (
        <Card title="Set up hands-free health sync" color="var(--red)">
          <Empty icon="♥" text="No health data yet. Build the 'Sync Health' iOS Shortcut (guide in automation/health) — the first run backfills your full history, then it auto-syncs every 30 min including sleep. No refresh button." />
        </Card>
      )}

      {has && (
        <Card color="var(--cyan)" className="day-nav-card">
          <div className="day-nav">
            <button className="btn btn-sm" onClick={() => setSel(addDays(selDate, -1))} title="Previous day">◀</button>
            <div className="day-nav-mid">
              <input type="date" className="day-date" value={selDate} min={dates[0]} max={today}
                onChange={e => setSel(e.target.value || null)} />
              <span className="small muted">{isToday ? 'Today' : WD[new Date(selDate + 'T00:00:00').getDay()]}
                {selIdx >= 0 ? ` · day ${selIdx + 1}/${dates.length}` : ' · no data logged'}</span>
            </div>
            <button className="btn btn-sm" onClick={() => setSel(selDate >= today ? today : addDays(selDate, 1))} disabled={selDate >= today} title="Next day">▶</button>
            {!isToday && <button className="btn btn-sm btn-cyan" onClick={() => setSel(null)}>Today</button>}
          </div>
        </Card>
      )}

      {readiness && (
        <Card title={`Readiness · ${isToday ? 'today' : selDate}`} color={readiness.color}>
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
        <>
          {!byDate[selDate] && <Card color="var(--yellow)"><Empty icon="◔" text={`Nothing logged for ${selDate}. Pick another day, or this day predates your history backfill.`} /></Card>}
          <div className="tile-row">
            {TILES.map(([key, label, unit, col, spark]) => {
              if (!series[key]?.length) return null;
              const v = dayVal(key);
              return (
                <div className="px stat-tile" key={key}>
                  <div className="stat-label" style={{ color: col }}>{label}</div>
                  <div className="stat-value" style={{ fontSize: 17 }}>{v != null ? (Number.isInteger(v) ? v.toLocaleString() : v.toFixed(1)) + unit : '—'}</div>
                  <div style={{ marginTop: 8 }}><Sparkline data={upto(key, 14)} color={spark} w={140} h={28} /></div>
                </div>
              );
            })}
          </div>
        </>
      )}

      <Card title={`Insights${isToday ? '' : ' · ' + selDate}`} color="var(--pink)">
        {insights.length === 0
          ? <Empty icon="✦" text="Once data flows in, the daily run writes Bevel-style insights here (recovery, load, sleep debt, trends)." />
          : insights.map(m => <div className="row" key={m.id}><span style={{ flex: 1 }}>{m.note || m.value}</span><span className="chip c-purple">{m.date}</span></div>)}
      </Card>

      {!isToday && dayWorkouts.length > 0 && (
        <Card title={`Workouts on ${selDate}`} color="var(--cyan)">
          {dayWorkouts.map(x => (
            <div className="row" key={x.id}>
              <span style={{ flex: 1 }}><b style={{ fontWeight: 'normal' }}>{x.title}</b></span>
              {x.volume_kg ? <span className="chip c-green">{x.volume_kg.toLocaleString()} kg</span> : null}
              {x.duration_min ? <span className="chip c-cyan">{x.duration_min} min</span> : null}
            </div>
          ))}
        </Card>
      )}

      <WorkoutLogger prs={prs} todayHr={todayHr} onSaved={() => { refreshW(); refreshPR(); }} />

      {Object.keys(prs).length > 0 && (
        <Card title="Personal records 🏆" color="var(--yellow)">
          {Object.entries(prs).sort((a, b) => (b[1].est1rm || 0) - (a[1].est1rm || 0)).slice(0, 10).map(([name, p]) => (
            <div className="row" key={name}>
              <span style={{ flex: 1 }}>{name}</span>
              <span className="chip c-yellow">{p.weight}kg × {p.reps}</span>
              <span className="chip">~{Math.round(p.est1rm)}kg 1RM</span>
              <span className="chip c-purple">{p.date}</span>
            </div>
          ))}
        </Card>
      )}

      <Card title={`Workouts (${thisWeek} this week)`} color="var(--cyan)">
        {workouts.length === 0 && <Empty icon="🏋" text="No workouts yet — hit Start workout above." />}
        {workouts.slice(0, 20).map(x => {
          const exs = Array.isArray(x.exercises) ? x.exercises : [];
          return (
            <div key={x.id} style={{ borderBottom: '2px dashed var(--border)', padding: '8px 0' }}>
              <div className="row" style={{ borderBottom: 'none' }} onClick={() => setOpenW(openW === x.id ? null : x.id)}>
                <span className="chip c-purple">{x.date}</span>
                <span style={{ flex: 1, cursor: exs.length ? 'pointer' : 'default' }}><b style={{ fontWeight: 'normal' }}>{x.title}</b>{exs.length ? <span className="muted small"> · {exs.length} exercises</span> : ''}</span>
                {x.volume_kg ? <span className="chip c-green">{x.volume_kg.toLocaleString()} kg vol</span> : null}
                {x.avg_hr ? <span className="chip c-red">{x.avg_hr} bpm</span> : (x.duration_min ? <span className="chip c-cyan">{x.duration_min} min</span> : null)}
                <span className="chip">{x.source}</span>
                <button className="btn btn-sm" onClick={e => { e.stopPropagation(); del(x.id); }}>✕</button>
              </div>
              {openW === x.id && exs.length > 0 && (
                <div style={{ paddingLeft: 8, marginTop: 4 }}>
                  {exs.map((e, i) => (
                    <div key={i} className="small" style={{ padding: '2px 0' }}>
                      <span style={{ color: 'var(--cyan)' }}>{e.name}</span>: <span className="muted">{(e.sets || []).map(s => `${s.weight || '–'}×${s.reps}`).join(', ')}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </Card>
    </>
  );
}
