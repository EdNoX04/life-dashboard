import React, { useMemo, useState } from 'react';
import { Card, Empty, StatTile } from './ui.jsx';
import { suppByKey } from '../lib/healthdata.js';
import PixelIcon from './PixelIcon.jsx';

// Looking back.
//
// Every log in this tab was already stored keyed by date — water_log, meals_log,
// meds_log and supps_log are all { 'YYYY-MM-DD': ... } blobs. The history was
// therefore never missing, only unrendered: the tab read today's key and threw the
// rest away. This reads the whole blob instead, so days logged months ago show up
// the moment this ships, with no migration and nothing to backfill.

const RANGES = [['7D', 7], ['30D', 30], ['90D', 90], ['ALL', null]];
const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const r0 = n => Math.round(n);
const isDay = k => /^\d{4}-\d{2}-\d{2}$/.test(k);

// Built from local date parts, never toISOString(). Every key in these logs is
// written by todayStr(), which is local — and in IST toISOString() rolls the date
// back, so mixing the two silently shifts the whole history by a day and quietly
// breaks the streak. Matching todayStr() exactly is the whole point.
const shiftDays = (iso, n) => {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  const z = v => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
};

const pretty = iso => {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
};

export default function BodyHistory({
  waterLog = {}, mealLog = {}, medLog = {}, suppLog = {}, goal = 3000, today,
}) {
  const [range, setRange] = useState(30);
  const [open, setOpen] = useState(null);

  const days = useMemo(() => {
    const keys = new Set([
      ...Object.keys(waterLog), ...Object.keys(mealLog),
      ...Object.keys(medLog), ...Object.keys(suppLog),
    ].filter(isDay));

    const rows = [...keys].sort().reverse().map(date => {
      const meals = Array.isArray(mealLog[date]) ? mealLog[date] : [];
      const supps = Array.isArray(suppLog[date]) ? suppLog[date] : [];
      const meds = Array.isArray(medLog[date]) ? medLog[date] : [];
      const sum = k => meals.reduce((s, m) => s + num(m[k]), 0)
        + supps.reduce((s, x) => s + num(x.macros?.[k]), 0);
      return {
        date, meals, supps, meds,
        ml: num(waterLog[date]),
        kcal: sum('kcal'), protein: sum('protein'), carbs: sum('carbs'), fat: sum('fat'),
      };
    // A day only counts as logged if something is actually on it. Water sitting at
    // zero is an empty day, not a day you drank nothing.
    }).filter(d => d.ml > 0 || d.meals.length || d.supps.length || d.meds.length);

    if (range == null) return rows;
    const cut = shiftDays(today, -(range - 1));
    return rows.filter(d => d.date >= cut);
  }, [waterLog, mealLog, medLog, suppLog, range, today]);

  const stats = useMemo(() => {
    if (!days.length) return null;
    const withWater = days.filter(d => d.ml > 0);
    const withFood = days.filter(d => d.meals.length || d.supps.length);
    const avg = (arr, k) => (arr.length ? arr.reduce((s, d) => s + d[k], 0) / arr.length : null);
    const hit = withWater.filter(d => d.ml >= goal).length;

    // Streak runs back from today, and tolerates today itself being empty — the day
    // is not over yet, so an unlogged today shouldn't read as a broken streak.
    const have = new Set(days.map(d => d.date));
    let streak = 0;
    let cursor = have.has(today) ? today : shiftDays(today, -1);
    while (have.has(cursor)) { streak++; cursor = shiftDays(cursor, -1); }

    return {
      days: days.length,
      water: avg(withWater, 'ml'),
      kcal: avg(withFood, 'kcal'),
      protein: avg(withFood, 'protein'),
      hitRate: withWater.length ? (hit / withWater.length) * 100 : null,
      streak,
    };
  }, [days, goal, today]);

  const maxKcal = Math.max(1, ...days.map(d => d.kcal));

  return (
    <Card title="History" color="var(--purple)"
      right={
        <span className="seg">
          {RANGES.map(([lbl, n]) => (
            <button key={lbl} className={`seg-btn${range === n ? ' on' : ''}`} onClick={() => setRange(n)}>{lbl}</button>
          ))}
        </span>
      }>

      {!days.length && (
        <Empty icon="🗓" text="Nothing logged in this window yet. Log water, a meal or a supplement and the days start stacking up here." />
      )}

      {stats && (
        <>
          <div className="tile-row">
            <StatTile label="Days logged" value={stats.days} note={range ? `of last ${range}` : 'all time'} color="var(--purple)" />
            <StatTile label="Avg water" value={stats.water ? `${(stats.water / 1000).toFixed(1)}L` : '—'} note="on logged days" color="var(--cyan)" />
            <StatTile label="Avg calories" value={stats.kcal ? r0(stats.kcal) : '—'} note="kcal / day" color="var(--orange)" />
            <StatTile label="Avg protein" value={stats.protein ? `${r0(stats.protein)}g` : '—'} note="per day" color="var(--pink)" />
            <StatTile label="Streak" value={stats.streak} note={stats.streak === 1 ? 'day' : 'days running'} color="var(--green)" />
          </div>

          {stats.hitRate != null && (
            <div className="small muted" style={{ marginTop: -4, marginBottom: 10 }}>
              Water goal hit on {Math.round(stats.hitRate)}% of the days you logged.
            </div>
          )}

          {/* Calories per day, drawn as chunky bars. Deliberately unlabelled on the
              x-axis — it's a shape to scan, and the exact numbers are in the rows below. */}
          <div className="hist-bars">
            {[...days].reverse().map(d => (
              <div key={d.date} className="hist-bar" title={`${pretty(d.date)} · ${r0(d.kcal)} kcal · ${(d.ml / 1000).toFixed(2)}L`}
                onClick={() => setOpen(open === d.date ? null : d.date)}>
                <span className="hist-bar-fill" style={{
                  height: `${Math.max(3, (d.kcal / maxKcal) * 100)}%`,
                  background: d.date === today ? 'var(--green)' : 'var(--orange)',
                }} />
                <span className="hist-bar-water" style={{ height: `${Math.min(100, (d.ml / goal) * 100) * 0.28}%` }} />
              </div>
            ))}
          </div>
          <div className="small muted hist-legend">
            <span><i style={{ background: 'var(--orange)' }} /> calories</span>
            <span><i style={{ background: 'var(--cyan)' }} /> water vs goal</span>
            <span className="muted">tap a bar or a row to open the day</span>
          </div>
        </>
      )}

      {days.map(d => {
        const isOpen = open === d.date;
        const wpct = Math.min(100, Math.round((d.ml / goal) * 100));
        return (
          <div key={d.date} className={`hist-day${isOpen ? ' open' : ''}`}>
            <div className="row hist-head" onClick={() => setOpen(isOpen ? null : d.date)}>
              <span style={{ flex: 1, minWidth: 0 }}>
                {pretty(d.date)}
                {d.date === today && <span className="chip c-green" style={{ marginLeft: 6 }}>today</span>}
              </span>
              {d.ml > 0 && <span className={`chip ${wpct >= 100 ? 'c-green' : 'c-cyan'}`}>{(d.ml / 1000).toFixed(2)}L</span>}
              {d.kcal > 0 && <span className="chip c-orange">{r0(d.kcal)} kcal</span>}
              {d.protein > 0 && <span className="chip c-pink">{r0(d.protein)}p</span>}
              {d.supps.length > 0 && <span className="chip c-purple">✦ {d.supps.length}</span>}
              <span className="muted small" style={{ width: 12, textAlign: 'center' }}>{isOpen ? '▾' : '▸'}</span>
            </div>

            {isOpen && (
              <div className="hist-body">
                {d.meals.length > 0 && (
                  <table className="ptable">
                    <thead><tr><th>Meal</th><th>kcal</th><th>P</th><th>C</th><th>F</th></tr></thead>
                    <tbody>
                      {d.meals.map(m => (
                        <tr key={m.id}>
                          <td>{m.name}</td>
                          <td style={{ color: 'var(--orange)' }}>{r0(num(m.kcal))}</td>
                          <td style={{ color: 'var(--pink)' }}>{r0(num(m.protein))}</td>
                          <td style={{ color: 'var(--cyan)' }}>{r0(num(m.carbs))}</td>
                          <td style={{ color: 'var(--yellow)' }}>{r0(num(m.fat))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {d.supps.length > 0 && (
                  <div className="flex hist-supps">
                    {d.supps.map(s => (
                      <span key={s.id} className="hist-supp" title={`${s.name} · ${s.serving || ''} · ${s.time || ''}`}>
                        <PixelIcon name={suppByKey(s.key).icon} size={22} />
                        <span className="small">{s.name}</span>
                      </span>
                    ))}
                  </div>
                )}

                {d.meds.length > 0 && (
                  <div className="small mt" style={{ color: 'var(--ink-2)' }}>
                    💊 {d.meds.map(m => `${m.name}${m.dose ? ` (${m.dose})` : ''}`).join(' · ')}
                  </div>
                )}

                {!d.meals.length && !d.supps.length && !d.meds.length && (
                  <div className="small muted">Only water logged this day.</div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </Card>
  );
}
