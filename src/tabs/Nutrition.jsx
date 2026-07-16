import React, { useMemo, useState } from 'react';
import { Card, Empty, StatTile } from '../components/ui.jsx';

// Body & Nutrition — water (functional scaffold), meals, meds, symptoms, and a
// synthesized body review + estimated biological age. SCAFFOLD: water tracker works
// locally; the rest are structured placeholders wired for the deep build.
const GLASS = 250; // ml per glass
const GOAL = 3000; // ml/day

export default function Nutrition() {
  const [ml, setMl] = useState(0);
  const pct = Math.min(100, Math.round((ml / GOAL) * 100));

  const macros = useMemo(() => ([
    ['Calories', '—', 'kcal', 'var(--orange)'],
    ['Protein', '—', 'g', 'var(--pink)'],
    ['Carbs', '—', 'g', 'var(--cyan)'],
    ['Fat', '—', 'g', 'var(--yellow)'],
  ]), []);

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
                <button className="btn btn-sm btn-cyan" onClick={() => setMl(v => Math.min(GOAL + GLASS, v + GLASS))}>+ Glass (250ml)</button>
                <button className="btn btn-sm" onClick={() => setMl(v => Math.max(0, v - GLASS))}>−</button>
              </div>
              <div className="small muted mt">Daily total resets each day once persistence is wired.</div>
            </div>
          </div>
        </Card>

        <Card title="Today's intake" color="var(--orange)">
          <div className="tile-row" style={{ marginBottom: 0 }}>
            {macros.map(([l, v, u, c]) => <StatTile key={l} label={l} value={`${v}${u === 'kcal' ? '' : ''}`} note={u} color={c} />)}
          </div>
          <div className="small muted mt">Log a meal below to fill these — plus a full micro panel (vitamins &amp; minerals).</div>
        </Card>
      </div>

      <Card title="Meals" color="var(--green)">
        <Empty icon="🍽" text="Add a meal: snap/attach a photo, search a food database for macros + micros (vitamins, minerals, fiber…), set the portion. A running day-log builds here." />
      </Card>

      <Card title="Micronutrients" color="var(--purple)">
        <Empty icon="✦" text="Vitamins (A, C, D, B-complex…), minerals (iron, magnesium, zinc…), fiber, sodium — with % of daily target, so you see gaps at a glance." />
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
