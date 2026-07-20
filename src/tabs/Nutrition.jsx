import React, { useState } from 'react';
import { Card, Empty, StatTile } from '../components/ui.jsx';
import { useCollection, todayStr } from '../lib/hooks.js';
import * as db from '../lib/db.js';

// Body & Nutrition. Water + meals now persist to Supabase (memory store, keyed by
// day so the total is per-day and resets automatically each morning).
const GLASS = 250; // ml per glass
const GOAL = 3000; // ml/day
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.round(performance.now()));
const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const r0 = n => Math.round(n);

export default function Nutrition() {
  const today = todayStr();
  const { items: waterMem, refresh: rW } = useCollection('memory', { filter: 'key=eq.water_log', order: 'key' });
  const { items: mealMem, refresh: rM } = useCollection('memory', { filter: 'key=eq.meals_log', order: 'key' });
  const waterLog = waterMem?.[0]?.value || {};
  const mealLog = mealMem?.[0]?.value || {};

  const ml = Number(waterLog[today] || 0);
  const meals = Array.isArray(mealLog[today]) ? mealLog[today] : [];
  const pct = Math.min(100, Math.round((ml / GOAL) * 100));

  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: '', kcal: '', protein: '', carbs: '', fat: '', fiber: '' });

  const sum = k => meals.reduce((s, m) => s + num(m[k]), 0);
  const intake = { kcal: sum('kcal'), protein: sum('protein'), carbs: sum('carbs'), fat: sum('fat'), fiber: sum('fiber') };
  const logged = meals.length > 0;

  async function setWater(next) {
    const v = Math.max(0, Math.min(GOAL + GLASS, next));
    setBusy(true);
    try { await db.upsertMemory('water_log', { ...waterLog, [today]: v }); await rW(); }
    catch (e) { console.error('water save', e); alert('Could not save water — check connection.'); }
    setBusy(false);
  }

  async function addMeal() {
    if (!form.name.trim() && !form.kcal) return;
    const meal = {
      id: uid(), name: form.name.trim() || 'Meal',
      kcal: num(form.kcal), protein: num(form.protein), carbs: num(form.carbs), fat: num(form.fat), fiber: num(form.fiber),
      ts: new Date().toISOString(),
    };
    setBusy(true);
    try {
      await db.upsertMemory('meals_log', { ...mealLog, [today]: [...meals, meal] });
      await rM();
      setForm({ name: '', kcal: '', protein: '', carbs: '', fat: '', fiber: '' });
    } catch (e) { console.error('meal save', e); alert('Could not save meal — check connection.'); }
    setBusy(false);
  }

  async function delMeal(id) {
    setBusy(true);
    try { await db.upsertMemory('meals_log', { ...mealLog, [today]: meals.filter(m => m.id !== id) }); await rM(); }
    catch (e) { console.error('meal delete', e); }
    setBusy(false);
  }

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <>
      <h1 className="tab-title">BODY</h1>
      <p className="tab-sub">Fuel, water, meds and how you feel — all feeding one honest read on your health.</p>

      <div className="grid2">
        <Card title="Water" color="var(--cyan)">
          <div className="flex" style={{ gap: 18, alignItems: 'center' }}>
            <div className="bottle" title={`${ml} / ${GOAL} ml`}>
              <div className="bottle-cap" />
              <div className="bottle-body">
                <div className="bottle-fill" style={{ height: `${pct}%` }}>
                  <div className="bottle-wave" />
                </div>
                <div className="bottle-ml">{(ml / 1000).toFixed(2)}L</div>
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <div className="stat-value" style={{ fontSize: 20 }}>{pct}%</div>
              <div className="stat-note">{ml} / {GOAL} ml today</div>
              <div className="flex mt" style={{ gap: 6, flexWrap: 'wrap' }}>
                <button className="btn btn-sm btn-cyan" onClick={() => setWater(ml + GLASS)} disabled={busy}>+ Glass (250ml)</button>
                <button className="btn btn-sm" onClick={() => setWater(ml - GLASS)} disabled={busy || ml === 0}>−</button>
                {ml > 0 && <button className="btn btn-sm" onClick={() => setWater(0)} disabled={busy}>reset</button>}
              </div>
              <div className="small muted mt">Saved to your dashboard — resets on its own each day.</div>
            </div>
          </div>
        </Card>

        <Card title="Today's intake" color="var(--orange)">
          <div className="tile-row" style={{ marginBottom: 0 }}>
            <StatTile label="Calories" value={logged ? r0(intake.kcal) : '—'} note="kcal" color="var(--orange)" />
            <StatTile label="Protein" value={logged ? r0(intake.protein) : '—'} note="g" color="var(--pink)" />
            <StatTile label="Carbs" value={logged ? r0(intake.carbs) : '—'} note="g" color="var(--cyan)" />
            <StatTile label="Fat" value={logged ? r0(intake.fat) : '—'} note="g" color="var(--yellow)" />
          </div>
          <div className="small muted mt">{logged ? `${meals.length} meal${meals.length > 1 ? 's' : ''} logged today.` : 'Log a meal below to fill these.'}</div>
        </Card>
      </div>

      <Card title="Meals" color="var(--green)">
        <div className="meal-form">
          <input placeholder="Meal — e.g. 2 eggs + toast" value={form.name} onChange={e => set('name', e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addMeal(); }} />
          <div className="meal-macros">
            <input type="number" inputMode="decimal" placeholder="kcal" value={form.kcal} onChange={e => set('kcal', e.target.value)} />
            <input type="number" inputMode="decimal" placeholder="protein" value={form.protein} onChange={e => set('protein', e.target.value)} />
            <input type="number" inputMode="decimal" placeholder="carbs" value={form.carbs} onChange={e => set('carbs', e.target.value)} />
            <input type="number" inputMode="decimal" placeholder="fat" value={form.fat} onChange={e => set('fat', e.target.value)} />
            <input type="number" inputMode="decimal" placeholder="fiber" value={form.fiber} onChange={e => set('fiber', e.target.value)} />
            <button className="btn btn-sm btn-green" onClick={addMeal} disabled={busy}>+ Add</button>
          </div>
        </div>

        {meals.length === 0 && <Empty icon="🍽" text="No meals logged yet today. Add one above — macros roll up into Today's intake." />}
        {meals.map(m => (
          <div className="row meal-row" key={m.id}>
            <span style={{ flex: 1 }}>{m.name}</span>
            <span className="chip c-orange">{r0(m.kcal)} kcal</span>
            {m.protein ? <span className="chip c-pink">{r0(m.protein)}p</span> : null}
            {m.carbs ? <span className="chip c-cyan">{r0(m.carbs)}c</span> : null}
            {m.fat ? <span className="chip c-yellow">{r0(m.fat)}f</span> : null}
            <button className="btn btn-sm" onClick={() => delMeal(m.id)} disabled={busy}>✕</button>
          </div>
        ))}
      </Card>

      <Card title="Micronutrients" color="var(--purple)">
        {logged ? (
          <>
            <div className="row"><span style={{ flex: 1 }}>Fiber</span><span className="chip c-green">{r0(intake.fiber)} g</span><span className="small muted">/ ~30 g</span></div>
            <div className="small muted mt">Full vitamin &amp; mineral panel (A, C, D, B-complex, iron, magnesium, zinc…) comes with food-database lookup — for now, fiber rolls up from your logged meals.</div>
          </>
        ) : (
          <Empty icon="✦" text="Vitamins (A, C, D, B-complex…), minerals (iron, magnesium, zinc…), fiber, sodium — with % of daily target, so you see gaps at a glance." />
        )}
      </Card>

      <Card title="Medication" color="var(--pink)">
        <Empty icon="💊" text="Search any medicine by name (global drug database), add it to your list, and log doses with time. Reminders + an adherence streak come next." />
      </Card>

      <Card title="Symptoms & conditions" color="var(--red)">
        <Empty icon="🌡" text="Log a condition (e.g. fever) over a date range and the meds you took during it — building a personal history you can look back on." />
      </Card>

      <Card title="Body review" color="var(--cyan)">
        <div className="flex" style={{ gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="bio-age">
            <div className="bio-num">—</div>
            <div className="bio-lbl">EST. BIO AGE</div>
          </div>
          <div style={{ flex: 1, minWidth: 200 }} className="small" >
            <div style={{ color: 'var(--ink-2)', lineHeight: 1.5 }}>
              Everything above — plus HRV, resting HR, sleep, VO₂max, activity and weight from Health — folds into
              one plain-English read on how your body is doing, with an estimated biological age vs your real age.
              (Transparent formula first; a written review later.)
            </div>
          </div>
        </div>
      </Card>
    </>
  );
}
