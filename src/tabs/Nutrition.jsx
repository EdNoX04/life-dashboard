import React, { useState, useEffect } from 'react';
import { Card, Empty, StatTile } from '../components/ui.jsx';
import { useCollection, todayStr } from '../lib/hooks.js';
import * as db from '../lib/db.js';
import { MICROS, INDIAN_MEDS } from '../lib/healthdata.js';
import { lookupBarcode, searchFood, searchConditions } from '../lib/foodapi.js';
import BarcodeScanner from '../components/BarcodeScanner.jsx';

const GLASS = 250, GOAL = 3000;
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.round(performance.now()));
const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const r0 = n => Math.round(n);
const z = n => String(n).padStart(2, '0');
const nowHM = () => { const d = new Date(); return `${z(d.getHours())}:${z(d.getMinutes())}`; };
const blankMeal = () => ({ name: '', kcal: '', protein: '', carbs: '', fat: '', fiber: '', micros: {} });

export default function Nutrition() {
  const today = todayStr();
  const { items: waterMem, refresh: rW } = useCollection('memory', { filter: 'key=eq.water_log', order: 'key' });
  const { items: mealMem, refresh: rM } = useCollection('memory', { filter: 'key=eq.meals_log', order: 'key' });
  const { items: medMem, refresh: rMed } = useCollection('memory', { filter: 'key=eq.meds_log', order: 'key' });
  const { items: symMem, refresh: rSym } = useCollection('memory', { filter: 'key=eq.symptoms_log', order: 'key' });
  const waterLog = waterMem?.[0]?.value || {};
  const mealLog = mealMem?.[0]?.value || {};
  const medLog = medMem?.[0]?.value || {};
  const symLog = symMem?.[0]?.value || { list: [] };

  const ml = Number(waterLog[today] || 0);
  const meals = Array.isArray(mealLog[today]) ? mealLog[today] : [];
  const meds = Array.isArray(medLog[today]) ? medLog[today] : [];
  const symptoms = Array.isArray(symLog.list) ? symLog.list : [];
  const pct = Math.min(100, Math.round((ml / GOAL) * 100));

  const [busy, setBusy] = useState(false);
  const [meal, setMeal] = useState(blankMeal());
  const [scanning, setScanning] = useState(false);
  const [searching, setSearching] = useState(false);

  const sum = k => meals.reduce((s, m) => s + num(m[k]), 0);
  const intake = { kcal: sum('kcal'), protein: sum('protein'), carbs: sum('carbs'), fat: sum('fat') };
  const logged = meals.length > 0;

  // ---- micronutrient totals: meals + medicines/supplements ----
  const microTotals = {};
  MICROS.forEach(m => (microTotals[m.key] = 0));
  meals.forEach(mm => { const mic = mm.micros || {}; MICROS.forEach(m => { let v = mic[m.key]; if (m.key === 'fiber' && v == null) v = mm.fiber; microTotals[m.key] += num(v); }); });
  meds.forEach(md => { const mic = md.micros || {}; MICROS.forEach(m => { microTotals[m.key] += num(mic[m.key]); }); });
  const microsShown = MICROS.filter(m => microTotals[m.key] > 0);

  async function save(key, value, refresh) {
    setBusy(true);
    try { await db.upsertMemory(key, value); await refresh(); }
    catch (e) { console.error(key, e); alert('Could not save — check connection.'); }
    setBusy(false);
  }
  const setWater = next => save('water_log', { ...waterLog, [today]: Math.max(0, Math.min(GOAL + GLASS, next)) }, rW);

  function applyItem(it) {
    setMeal({ name: it.name, kcal: String(it.kcal || ''), protein: String(it.protein || ''), carbs: String(it.carbs || ''), fat: String(it.fat || ''), fiber: String(it.micros?.fiber || ''), micros: it.micros || {} });
  }
  async function onBarcode(code) {
    setScanning(false); setBusy(true);
    try { const it = await lookupBarcode(code); if (it) applyItem(it); else alert(`No product found for ${code}. You can log it manually.`); }
    catch (e) { alert('Lookup failed — check connection, or log manually.'); }
    setBusy(false);
  }
  async function addMeal() {
    if (!meal.name.trim() && !meal.kcal) return;
    const micros = { ...(meal.micros || {}) };
    if (meal.fiber !== '') micros.fiber = num(meal.fiber);
    const row = { id: uid(), name: meal.name.trim() || 'Meal', kcal: num(meal.kcal), protein: num(meal.protein), carbs: num(meal.carbs), fat: num(meal.fat), micros, ts: new Date().toISOString() };
    await save('meals_log', { ...mealLog, [today]: [...meals, row] }, rM);
    setMeal(blankMeal());
  }
  const delMeal = id => save('meals_log', { ...mealLog, [today]: meals.filter(m => m.id !== id) }, rM);
  const setM = (k, v) => setMeal(f => ({ ...f, [k]: v }));

  // ---- medicine ----
  const [medForm, setMedForm] = useState({ name: '', salt: '', dose: '', time: nowHM() });
  function medName(v) {
    const known = INDIAN_MEDS.find(x => x.name.toLowerCase() === v.trim().toLowerCase());
    setMedForm(f => ({ ...f, name: v, salt: known ? known.salt : f.salt }));
  }
  async function addMed() {
    if (!medForm.name.trim()) return;
    const known = INDIAN_MEDS.find(x => x.name.toLowerCase() === medForm.name.trim().toLowerCase());
    const entry = { id: uid(), name: medForm.name.trim(), salt: medForm.salt || known?.salt || '', dose: medForm.dose || '', time: medForm.time || nowHM(), micros: known?.micros || null, ts: new Date().toISOString() };
    await save('meds_log', { ...medLog, [today]: [...meds, entry] }, rMed);
    setMedForm({ name: '', salt: '', dose: '', time: nowHM() });
  }
  const delMed = id => save('meds_log', { ...medLog, [today]: meds.filter(m => m.id !== id) }, rMed);

  // ---- symptoms / conditions ----
  const [symQ, setSymQ] = useState('');
  const [symRes, setSymRes] = useState([]);
  const [symForm, setSymForm] = useState({ name: '', from: today, to: '', note: '' });
  useEffect(() => {
    if (symQ.trim().length < 2 || symQ === symForm.name) { setSymRes([]); return; }
    let live = true; const id = setTimeout(async () => {
      try { const r = await searchConditions(symQ.trim()); if (live) setSymRes(r); } catch { if (live) setSymRes([]); }
    }, 280);
    return () => { live = false; clearTimeout(id); };
  }, [symQ]); // eslint-disable-line
  async function addSymptom() {
    if (!symForm.name.trim()) return;
    const entry = { id: uid(), name: symForm.name.trim(), from: symForm.from || today, to: symForm.to || '', note: symForm.note.trim(), created: new Date().toISOString() };
    await save('symptoms_log', { list: [entry, ...symptoms] }, rSym);
    setSymForm({ name: '', from: today, to: '', note: '' }); setSymQ('');
  }
  const delSymptom = id => save('symptoms_log', { list: symptoms.filter(s => s.id !== id) }, rSym);
  const activeSym = symptoms.filter(s => !s.to || s.to >= today);
  const pastSym = symptoms.filter(s => s.to && s.to < today);

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
                <div className="bottle-fill" style={{ height: `${pct}%` }}><div className="bottle-wave" /></div>
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
          <div className="small muted mt">{logged ? `${meals.length} meal${meals.length > 1 ? 's' : ''} logged today.` : 'Scan a barcode or log a meal to fill these.'}</div>
        </Card>
      </div>

      <Card title="Meals" color="var(--green)"
        right={<span className="flex" style={{ gap: 6 }}>
          <button className="btn btn-sm btn-cyan" onClick={() => setScanning(true)} disabled={busy}>⌷ Scan</button>
          <button className="btn btn-sm" onClick={() => setSearching(true)} disabled={busy}>🔍 Search</button>
        </span>}>
        <div className="meal-form">
          <input placeholder="Meal — scan, search, or type (e.g. 2 eggs + toast)" value={meal.name}
            onChange={e => setM('name', e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addMeal(); }} />
          <div className="meal-macros">
            <input type="number" inputMode="decimal" placeholder="kcal" value={meal.kcal} onChange={e => setM('kcal', e.target.value)} />
            <input type="number" inputMode="decimal" placeholder="protein" value={meal.protein} onChange={e => setM('protein', e.target.value)} />
            <input type="number" inputMode="decimal" placeholder="carbs" value={meal.carbs} onChange={e => setM('carbs', e.target.value)} />
            <input type="number" inputMode="decimal" placeholder="fat" value={meal.fat} onChange={e => setM('fat', e.target.value)} />
            <input type="number" inputMode="decimal" placeholder="fiber" value={meal.fiber} onChange={e => setM('fiber', e.target.value)} />
            <button className="btn btn-sm btn-green" onClick={addMeal} disabled={busy}>+ Add</button>
          </div>
          {Object.keys(meal.micros || {}).some(k => meal.micros[k]) && <div className="small muted mt">✦ micros captured from the food database — they roll into the panel below.</div>}
        </div>

        {meals.length === 0 && <Empty icon="🍽" text="No meals yet. Scan a packaged food's barcode, search by name, or type one." />}
        {meals.map(m => (
          <div className="row meal-row" key={m.id}>
            <span style={{ flex: 1 }}>{m.name}{m.micros && Object.keys(m.micros).some(k => m.micros[k]) ? <span className="tt2-gcal" title="has micronutrient data"> ✦</span> : null}</span>
            <span className="chip c-orange">{r0(m.kcal)} kcal</span>
            {m.protein ? <span className="chip c-pink">{r0(m.protein)}p</span> : null}
            {m.carbs ? <span className="chip c-cyan">{r0(m.carbs)}c</span> : null}
            {m.fat ? <span className="chip c-yellow">{r0(m.fat)}f</span> : null}
            <button className="btn btn-sm" onClick={() => delMeal(m.id)} disabled={busy}>✕</button>
          </div>
        ))}
      </Card>

      <Card title="Micronutrients" color="var(--purple)">
        {microsShown.length === 0 && <Empty icon="✦" text="Vitamins, minerals & fiber appear here — scan foods or log a supplement and they roll up with % of your daily target." />}
        {microsShown.length > 0 && (
          <div className="micro-grid">
            {microsShown.map(m => {
              const val = microTotals[m.key];
              const p = Math.min(100, Math.round((val / m.target) * 100));
              const c = m.over ? (p > 100 ? 'var(--red)' : 'var(--yellow)') : (p >= 70 ? 'var(--green)' : 'var(--cyan)');
              return (
                <div className="micro-cell" key={m.key}>
                  <div className="micro-top"><span>{m.label}</span><span className="micro-val">{val >= 100 ? r0(val) : Math.round(val * 10) / 10}{m.unit}</span></div>
                  <div className="micro-bar"><span style={{ width: `${p}%`, background: c }} /></div>
                  <div className="micro-tgt">{p}% of {m.target}{m.unit}{m.over ? ' cap' : ''}</div>
                </div>
              );
            })}
          </div>
        )}
        <div className="small muted mt">Rolled up from your logged meals (scanned foods carry full micros) and any supplements in Medication.</div>
      </Card>

      <Card title="Medication" color="var(--pink)"
        right={meds.length ? <span className="chip c-pink">{meds.length} today</span> : null}>
        <div className="meal-form">
          <input list="po-meds" placeholder="Medicine — e.g. Dolo 650, Zincovit…" value={medForm.name}
            onChange={e => medName(e.target.value)} onKeyDown={e => e.key === 'Enter' && addMed()} />
          <datalist id="po-meds">{INDIAN_MEDS.map(x => <option key={x.name} value={x.name}>{x.salt}</option>)}</datalist>
          <div className="meal-macros">
            <input style={{ flex: '2 1 160px' }} placeholder="Salt / composition" value={medForm.salt} onChange={e => setMedForm({ ...medForm, salt: e.target.value })} />
            <input placeholder="Dose (e.g. 1 tab)" value={medForm.dose} onChange={e => setMedForm({ ...medForm, dose: e.target.value })} />
            <input type="time" value={medForm.time} onChange={e => setMedForm({ ...medForm, time: e.target.value })} />
            <button className="btn btn-sm btn-green" onClick={addMed} disabled={busy}>+ Log</button>
          </div>
        </div>
        {meds.length === 0 && <Empty icon="💊" text="Log a medicine (Indian brands autocomplete). Supplements like Shelcal or Zincovit also feed your micronutrients." />}
        {meds.map(m => (
          <div className="row meal-row" key={m.id}>
            <span style={{ flex: 1 }}>{m.name}{m.salt ? <span className="muted small"> · {m.salt}</span> : ''}</span>
            {m.dose && <span className="chip">{m.dose}</span>}
            {m.micros && <span className="chip c-purple" title="feeds micronutrients">✦ supp</span>}
            <span className="chip c-cyan">{m.time}</span>
            <button className="btn btn-sm" onClick={() => delMed(m.id)} disabled={busy}>✕</button>
          </div>
        ))}
      </Card>

      <Card title="Symptoms & conditions" color="var(--red)">
        <div className="meal-form" style={{ position: 'relative' }}>
          <input placeholder="Search a symptom or condition — e.g. fever, migraine, gastritis…" value={symQ}
            onChange={e => { setSymQ(e.target.value); setSymForm(f => ({ ...f, name: e.target.value })); }} />
          {symRes.length > 0 && (
            <div className="sym-drop">
              {symRes.map(s => <button key={s} className="sym-opt" onClick={() => { setSymForm(f => ({ ...f, name: s })); setSymQ(s); setSymRes([]); }}>{s}</button>)}
            </div>
          )}
          <div className="meal-macros">
            <label className="small muted" style={{ margin: 0, alignSelf: 'center' }}>From</label>
            <input type="date" value={symForm.from} onChange={e => setSymForm({ ...symForm, from: e.target.value })} />
            <label className="small muted" style={{ margin: 0, alignSelf: 'center' }}>To</label>
            <input type="date" value={symForm.to} onChange={e => setSymForm({ ...symForm, to: e.target.value })} />
            <input style={{ flex: '2 1 160px' }} placeholder="Note (optional)" value={symForm.note} onChange={e => setSymForm({ ...symForm, note: e.target.value })} />
            <button className="btn btn-sm btn-green" onClick={addSymptom} disabled={busy}>+ Add</button>
          </div>
        </div>
        {symptoms.length === 0 && <Empty icon="🌡" text="Search from thousands of conditions and log yours with a date range — build a history you can look back on." />}
        {activeSym.length > 0 && <div className="card-title mt" style={{ fontSize: 11 }}><span className="sq" style={{ background: 'var(--red)' }} />Active</div>}
        {activeSym.map(s => (
          <div className="row meal-row" key={s.id}>
            <span style={{ flex: 1 }}>{s.name}{s.note ? <span className="muted small"> · {s.note}</span> : ''}</span>
            <span className="chip c-red">since {s.from}</span>
            <button className="btn btn-sm" onClick={() => delSymptom(s.id)} disabled={busy}>✕</button>
          </div>
        ))}
        {pastSym.length > 0 && <div className="card-title mt" style={{ fontSize: 11 }}><span className="sq" style={{ background: 'var(--ink-3)' }} />Past</div>}
        {pastSym.map(s => (
          <div className="row meal-row" key={s.id}>
            <span style={{ flex: 1 }} className="muted">{s.name}</span>
            <span className="chip">{s.from} → {s.to}</span>
            <button className="btn btn-sm" onClick={() => delSymptom(s.id)} disabled={busy}>✕</button>
          </div>
        ))}
      </Card>

      <Card title="Body review" color="var(--cyan)">
        <div className="flex" style={{ gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="bio-age"><div className="bio-num">—</div><div className="bio-lbl">EST. BIO AGE</div></div>
          <div style={{ flex: 1, minWidth: 200 }} className="small">
            <div style={{ color: 'var(--ink-2)', lineHeight: 1.5 }}>
              Everything above — plus HRV, resting HR, sleep, VO₂max, activity and weight from Health — folds into one
              plain-English read on how your body is doing, with an estimated biological age vs your real age.
            </div>
          </div>
        </div>
      </Card>

      {scanning && <BarcodeScanner onDetect={onBarcode} onClose={() => setScanning(false)} />}
      {searching && <FoodSearch onPick={it => { applyItem(it); setSearching(false); }} onClose={() => setSearching(false)} />}
    </>
  );
}

// ---- food name search modal (Open Food Facts) ----
function FoodSearch({ onPick, onClose }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState([]);
  const [state, setState] = useState('idle');
  useEffect(() => {
    if (q.trim().length < 2) { setRes([]); setState('idle'); return; }
    let live = true; setState('loading');
    const id = setTimeout(async () => {
      try { const r = await searchFood(q.trim()); if (live) { setRes(r); setState('done'); } }
      catch { if (live) { setRes([]); setState('error'); } }
    }, 350);
    return () => { live = false; clearTimeout(id); };
  }, [q]);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="px scan-modal" onClick={e => e.stopPropagation()}>
        <div className="spread" style={{ marginBottom: 10 }}>
          <span className="card-title" style={{ margin: 0 }}><span className="sq" style={{ background: 'var(--green)' }} />Search food</span>
          <button className="btn btn-sm btn-pink" onClick={onClose}>✕</button>
        </div>
        <input autoFocus placeholder="Search a food — e.g. Maggi, Amul, banana…" value={q} onChange={e => setQ(e.target.value)} style={{ width: '100%' }} />
        <div className="food-results">
          {state === 'loading' && <div className="small muted" style={{ padding: 8 }}>Searching…</div>}
          {state === 'error' && <div className="small" style={{ padding: 8, color: 'var(--red)' }}>Search failed — check your connection.</div>}
          {state === 'done' && res.length === 0 && <div className="small muted" style={{ padding: 8 }}>No matches. Try another name or scan the barcode.</div>}
          {res.map(it => (
            <button key={it.code} className="food-opt" onClick={() => onPick(it)}>
              <span className="food-name">{it.name}</span>
              <span className="food-macro">{it.kcal} kcal · {it.protein}p / {it.carbs}c / {it.fat}f <span className="muted">/{it.per}</span></span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
