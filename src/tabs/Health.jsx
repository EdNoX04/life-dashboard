import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { useCollection, todayStr } from '../lib/hooks.js';
import { Card, Empty, RefreshButton } from '../components/ui.jsx';
import Sparkline from '../components/Sparkline.jsx';
import ScoreDial from '../components/ScoreDial.jsx';
import WorkoutLogger from '../components/WorkoutLogger.jsx';
import LiveStatus from '../components/LiveStatus.jsx';
import {
  SCORES, METRIC_GROUPS, recoveryFor, loadBand, LOAD_BANDS,
  sleepBank, sleepDebtPct, bioAgeDelta,
} from '../lib/healthscores.js';
import * as db from '../lib/db.js';

// The Health tab reads what PlayerOneSync writes.
//
// The division of labour is worth stating, because it explains why this file is
// mostly presentation. The phone computes the five scores — recovery, strain,
// sleep, stress, body energy — from raw HealthKit samples it has access to and
// the browser does not: overnight HRV series, per-second heart rate, sleep stage
// boundaries. Those land in `health_metrics` as ordinary daily rows. This tab
// does not recompute them and should not try; the one piece of scoring left here
// is `recoveryFor`'s fallback, which exists only so that history from before the
// app was installed still shows something, and which labels itself as an
// estimate rather than passing for the real thing.

// health_metrics can be thousands of rows (full Apple Health history) — page past
// the 1000-row cap so every day is available to the date scrubber.
function useAllHealth() {
  const [metrics, setMetrics] = useState([]);
  const refresh = useCallback(async () => { try { setMetrics(await db.listAll('health_metrics', { order: 'date', asc: true })); } catch { /* offline */ } }, []);
  useEffect(() => { refresh(); const t = setInterval(refresh, 60000); return () => clearInterval(t); }, [refresh]);
  return { metrics, refresh };
}

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return todayStr(d); };
const WD = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const fmt = (v, unit) => v == null ? '—'
  : (Number.isInteger(v) ? v.toLocaleString('en-IN') : v.toFixed(v < 10 ? 1 : 0)) + unit;

export default function Health() {
  const { metrics, refresh } = useAllHealth();
  const { items: workouts, del, refresh: refreshW } = useCollection('workouts', { order: 'date' });
  const { items: mem } = useCollection('memory', { filter: 'key=eq.health_last_sync', order: 'key' });
  const { items: prMem, refresh: refreshPR } = useCollection('memory', { filter: 'key=eq.workout_prs', order: 'key' });
  const { items: detMem } = useCollection('memory', { filter: 'key=eq.workouts_detail', order: 'key' });
  const [openW, setOpenW] = useState(null);
  const [sel, setSel] = useState(null); // selected date (null → latest with data)
  const [birthYear, setBirthYear] = useState(() => db.getConfig().birthYear || '');

  const lastSync = mem?.[0]?.value?.at;
  const prs = prMem?.[0]?.value || {};
  const detail = detMem?.[0]?.value || {};

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

  const day = byDate[selDate] || {};
  const dayVal = k => day[k] ?? null;
  const upto = (k, n = 14) => (series[k] || []).filter(x => x.date <= selDate).slice(-n).map(x => x.v);

  // Recovery, real if the phone computed one and an explicitly-flagged estimate
  // if not. `upto` is passed rather than the whole series so the baseline is
  // built from days up to the selected one — scrubbing back through history must
  // not let tomorrow's HRV inform yesterday's readiness.
  const recovery = useMemo(
    () => (has && byDate[selDate] ? recoveryFor(day, k => upto(k, 14)) : null),
    [selDate, byDate, series, has], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const load = useMemo(() => {
    const ratio = dayVal('cardio_load_ratio');
    return {
      acute: dayVal('cardio_load_acute'),
      chronic: dayVal('cardio_load_chronic'),
      ratio,
      band: loadBand(ratio),
    };
  }, [day]); // eslint-disable-line react-hooks/exhaustive-deps

  const bank = sleepBank(dayVal('sleep_bank'));
  const slept = dayVal('sleep_hours');
  const needed = dayVal('sleep_needed');
  const debtPct = sleepDebtPct(slept, needed);

  const bioAge = dayVal('biological_age');
  const actualAge = birthYear ? new Date().getFullYear() - Number(birthYear) : null;
  const bioDelta = bioAgeDelta(bioAge, actualAge);

  const todayHr = dayVal('heart_rate') || dayVal('resting_hr');
  const insights = metrics.filter(m => m.metric === 'insight' && m.date === selDate).slice(-3).reverse();
  const thisWeek = workouts.filter(x => x.date >= todayStr(new Date(Date.now() - 6 * 864e5))).length;
  const selIdx = dates.indexOf(selDate);
  const daySessions = Array.isArray(detail[selDate]) ? detail[selDate] : [];
  const dayWorkouts = workouts.filter(x => x.date === selDate);

  // The dial for a score reads the stored value, except recovery, which falls
  // back to the estimate so the row is not missing its first tile on every day
  // that predates the app.
  const dialValue = (key) => (key === 'recovery_score' && recovery ? recovery.score : dayVal(key));

  const saveBirthYear = (v) => {
    setBirthYear(v);
    if (!v || (Number(v) >= 1900 && Number(v) <= new Date().getFullYear())) db.setConfig({ birthYear: v });
  };

  return (
    <>
      <div className="spread">
        <h1 className="tab-title">HEALTH</h1>
        <RefreshButton source="health" onLocalRefresh={refresh} label="Sync" />
      </div>
      <p className="tab-sub">
        Apple Health via PlayerOneSync on iPhone
        {lastSync ? ` · synced ${new Date(lastSync).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}
      </p>

      <LiveStatus className="health-live" />

      {!has && (
        <Card title="Set up health sync" color="var(--red)">
          <Empty icon="♥" text="No health data yet. Install PlayerOneSync on your iPhone and grant it HealthKit read access — the first run backfills your full history, then it syncs in the background. Informational only; not a medical device." />
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

      {has && (
        <Card title={`Scores · ${isToday ? 'today' : selDate}`} color="var(--green)"
          right={recovery?.estimated ? <span className="est-chip" title="No recovery score was recorded for this day, so it is estimated from HRV, resting HR and sleep. Computed differently from the phone's — do not read a step between the two as a change in you.">recovery estimated</span> : null}>
          <div className="dial-row">
            {SCORES.map(s => (
              <ScoreDial key={s.key} scoreKey={s.key} value={dialValue(s.key)} sub={s.short} />
            ))}
          </div>
          {recovery?.notes?.length > 0 && (
            <div className="mt">
              {recovery.notes.slice(0, 3).map((n, i) => (
                <div className="row" key={i}><span className="chip c-cyan">•</span><span>{n}</span></div>
              ))}
            </div>
          )}
        </Card>
      )}

      {has && load.ratio != null && (
        <Card title="Cardio load" color={load.band?.color || 'var(--cyan)'}
          right={<span className="chip" style={{ color: load.band?.color, borderColor: load.band?.color }}>{load.band?.label}</span>}>
          <div className="row">
            <span className="chip c-cyan">7-day</span><span>{fmt(load.acute, '')}</span>
            <span className="chip c-purple">28-day</span><span>{fmt(load.chronic, '')}</span>
            <span style={{ flex: 1 }} />
            <span className="chip" style={{ color: load.band?.color, borderColor: load.band?.color }}>
              ratio {load.ratio.toFixed(2)}
            </span>
          </div>

          {/* The scale runs 0 → 2 with the bands drawn behind it, so the marker's
              position carries the reading and the colour only confirms it. Both
              ends are unwanted, which is why the good zone sits in the middle
              rather than at the right-hand end where a progress bar would put it. */}
          <div className="load-scale">
            {LOAD_BANDS.map((b, i) => {
              const lo = Math.max(0, b.min === -Infinity ? 0 : b.min);
              const hi = i === 0 ? 2 : Math.min(2, LOAD_BANDS[i - 1].min);
              if (hi <= lo) return null;
              return <span key={b.label} className="load-zone"
                style={{ left: `${(lo / 2) * 100}%`, width: `${((hi - lo) / 2) * 100}%`, background: b.color }} />;
            })}
            <span className="load-mark" style={{ left: `${Math.max(0, Math.min(100, (load.ratio / 2) * 100))}%` }} />
          </div>
          <div className="load-ticks"><span>0</span><span>0.8</span><span>1.3</span><span>2.0+</span></div>
          {load.band?.note && <div className="small muted mt">{load.band.note}</div>}
        </Card>
      )}

      {has && (bank || needed != null) && (
        <Card title="Sleep" color="var(--purple)"
          right={bank ? <span className="chip" style={{ color: bank.color, borderColor: bank.color }}>{bank.label}</span> : null}>
          <div className="row">
            <span className="chip c-purple">Slept</span><span>{fmt(slept, ' h')}</span>
            <span className="chip c-yellow">Needed</span><span>{fmt(needed, ' h')}</span>
            {debtPct != null && (
              <>
                <span style={{ flex: 1 }} />
                <span className="chip" style={{ color: debtPct >= 95 ? 'var(--green)' : debtPct >= 80 ? 'var(--yellow)' : 'var(--orange)' }}>
                  {debtPct}% of need
                </span>
              </>
            )}
          </div>
          {bank && (
            <div className="row">
              <span className="chip c-cyan">Bank</span>
              {/* The sign is spelled out. A "-3.2h" that the eye reads as "3.2h"
                  inverts the meaning of the only number on the line. */}
              <span style={{ color: bank.color }}>{bank.text}</span>
              <span className="small muted">
                {bank.sign < 0 ? 'accumulated shortfall against your own need' : bank.sign > 0 ? 'ahead of your own need' : 'roughly even'}
              </span>
            </div>
          )}
          {series.sleep_hours?.length > 1 && (
            <div className="mt"><Sparkline data={upto('sleep_hours', 21)} color="#9a63e8" w={280} h={36} /></div>
          )}
        </Card>
      )}

      {has && bioAge != null && (
        <Card title="Fitness age" color={bioDelta?.color || 'var(--yellow)'}>
          <div className="row">
            <span className="stat-value" style={{ fontSize: 22, color: bioDelta?.color || 'var(--yellow)' }}>{bioAge.toFixed(1)} yr</span>
            {bioDelta ? (
              <span className="chip" style={{ color: bioDelta.color, borderColor: bioDelta.color }}>
                {bioDelta.label}{Math.abs(bioDelta.delta) >= 1 ? ` · ${bioDelta.delta > 0 ? '+' : ''}${bioDelta.delta.toFixed(1)} yr` : ''}
              </span>
            ) : (
              <span className="row" style={{ borderBottom: 'none', gap: 6 }}>
                <span className="small muted">Born</span>
                <input className="day-date" style={{ width: 88 }} inputMode="numeric" placeholder="YYYY"
                  value={birthYear} onChange={e => saveBirthYear(e.target.value.replace(/\D/g, '').slice(0, 4))} />
                <span className="small muted">to compare against your actual age</span>
              </span>
            )}
          </div>
          <div className="small muted mt">
            Estimated by the phone from VO₂ max, resting HRV, resting heart rate and body composition.
            It is a fitness proxy, not a clinical measurement, and nothing here is medical advice.
          </div>
        </Card>
      )}

      {has && (
        <>
          {!byDate[selDate] && <Card color="var(--yellow)"><Empty icon="◔" text={`Nothing logged for ${selDate}. Pick another day, or this day predates your history backfill.`} /></Card>}
          {/* Grouped rather than one flat run of tiles. Forty-odd metrics in a
              single row put weight between flights climbed and water intake, and
              nothing could be found twice. The groups mirror the phone's own
              catalogue sections so a metric added there has an obvious home. */}
          {METRIC_GROUPS.map(g => {
            const live = g.metrics.filter(([key]) => series[key]?.length);
            if (!live.length) return null;
            return (
              <div key={g.id}>
                <div className="health-group-head" style={{ color: g.color }}>{g.label}</div>
                <div className="tile-row">
                  {live.map(([key, label, unit, col, spark]) => {
                    const v = dayVal(key);
                    return (
                      <div className="px stat-tile" key={key}>
                        <div className="stat-label" style={{ color: col }}>{label}</div>
                        <div className="stat-value" style={{ fontSize: 17 }}>{fmt(v, unit)}</div>
                        <div style={{ marginTop: 8 }}><Sparkline data={upto(key, 14)} color={spark} w={140} h={28} /></div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </>
      )}

      {daySessions.length > 0 && (
        <Card title={`Sessions on ${selDate}`} color="var(--orange)">
          {daySessions.map((s, i) => (
            <div className="row" key={`${s.start || i}`}>
              <span className="chip c-orange">{s.activity || 'Workout'}</span>
              <span>{s.minutes != null ? `${Math.round(s.minutes)} min` : ''}</span>
              {s.km != null && <span className="chip c-green">{Number(s.km).toFixed(2)} km</span>}
              <span style={{ flex: 1 }} />
              {s.kcal != null && <span className="chip c-yellow">{s.kcal} kcal</span>}
              {s.avg_hr != null && <span className="chip c-pink">{s.avg_hr} avg</span>}
              {s.max_hr != null && <span className="chip c-red">{s.max_hr} max</span>}
              {s.source && <span className="chip">{s.source}</span>}
            </div>
          ))}
        </Card>
      )}

      <Card title={`Insights${isToday ? '' : ' · ' + selDate}`} color="var(--pink)">
        {insights.length === 0
          ? <Empty icon="✦" text="Once data flows in, the daily run writes insights here (recovery, load, sleep debt, trends)." />
          : insights.map(m => <div className="row" key={m.id}><span style={{ flex: 1 }}>{m.note || m.value}</span><span className="chip c-purple">{m.date}</span></div>)}
      </Card>

      {!isToday && dayWorkouts.length > 0 && daySessions.length === 0 && (
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
