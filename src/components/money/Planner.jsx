import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Card, StatTile } from '../ui.jsx';
import { memGet, memSet } from '../../lib/advisor.js';
import {
  DEFAULT_PLAN, SCENARIOS, projectAll, summarise, sourceSplit,
  fireNumber, coastNumber, goalProgress, EMPTY_GOALS,
} from '../../lib/plan.js';

// The long game: FIRE number, goals, and the dividend snowball.
//
// This screen is arithmetic wearing an arcade cabinet. Every number on it is a
// consequence of the assumptions in the top card and nothing else — there is no
// model, no market data, no opinion. Change 8% to 6% and the whole board moves,
// which is precisely the point: the value of a projection is not its answer but
// how violently the answer swings when you nudge an input.
//
// Two rules the UI keeps to:
//   · Nothing is presented as a forecast. The wording is "if" throughout.
//   · Real terms sit next to nominal wherever a far-future value is shown,
//     because thirty years of 5% inflation cuts a number down by three quarters
//     and a screen that hides that is lying by omission.

const PLAN_KEY = 'money_plan';
const GOALS_KEY = 'goals_money';

// ---- formatting ----------------------------------------------------------
// Big numbers need to be legible at a glance, and "legible" is different in
// India: 1.2 Cr reads instantly where 12,000,000 does not.
function compact(n, cur = '₹') {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const v = Number(n);
  const sign = v < 0 ? '-' : '';
  const a = Math.abs(v);
  const f = (x, s) => sign + cur + (x >= 100 ? Math.round(x) : x.toFixed(x >= 10 ? 1 : 2)) + s;
  if (cur === '₹') {
    if (a >= 1e7) return f(a / 1e7, ' Cr');
    if (a >= 1e5) return f(a / 1e5, ' L');
    if (a >= 1e3) return f(a / 1e3, 'K');
  } else {
    if (a >= 1e9) return f(a / 1e9, 'B');
    if (a >= 1e6) return f(a / 1e6, 'M');
    if (a >= 1e3) return f(a / 1e3, 'K');
  }
  return sign + cur + a.toFixed(a < 10 ? 2 : 0);
}

const pct = n => (n == null || !Number.isFinite(n) ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`);
const THIS_YEAR = () => new Date().getFullYear();

// ---- little pixel input --------------------------------------------------
function Num({ label, value, onChange, suffix, step = 1, min, hint }) {
  return (
    <label className="plan-field">
      <span className="plan-flabel">{label}</span>
      <span className="plan-fin">
        <input
          type="number" value={value ?? ''} step={step} min={min}
          onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))}
        />
        {suffix && <span className="plan-fsuffix">{suffix}</span>}
      </span>
      {hint && <span className="plan-fhint">{hint}</span>}
    </label>
  );
}

// ---- the snowball chart --------------------------------------------------
// Four scenario lines on one grid, drawn by hand. The dashed rail is the goal;
// where a line crosses it is the only genuinely interesting pixel on the chart.
function Snowball({ series = [], goal = null, cur = '₹', height = 250, yearsShown = 30 }) {
  const wrapRef = useRef(null);
  const [cw, setCw] = useState(0);
  const [hover, setHover] = useState(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(es => { const w = es[0]?.contentRect?.width; if (w) setCw(Math.round(w)); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const W = cw || 660;
  const H = height;
  const PAD = { l: 44, r: 8, t: 12, b: 20 };

  const geom = useMemo(() => {
    const pts = series.flatMap(s => s.points || []);
    if (pts.length < 2) return null;
    const vals = pts.map(p => p.v).filter(Number.isFinite);
    if (!vals.length) return null;
    let max = Math.max(...vals, goal || 0);
    const min = 0; // money charts start at zero or they flatter the shape
    if (!(max > 0)) return null;
    max *= 1.06;
    const n = Math.max(...series.map(s => (s.points || []).length));
    const x = i => PAD.l + (i / Math.max(1, n - 1)) * (W - PAD.l - PAD.r);
    const y = v => PAD.t + (1 - (v - min) / (max - min)) * (H - PAD.t - PAD.b);
    return { x, y, min, max, n };
  }, [series, goal, W, H]);

  if (!geom) {
    return <div className="muted small" style={{ padding: 16, textAlign: 'center' }}>
      Set a starting value and a growth rate and the curve draws itself.
    </div>;
  }
  const { x, y, max, n } = geom;

  const onMove = e => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.max(0, Math.min(n - 1, Math.round(((px - PAD.l) / (W - PAD.l - PAD.r)) * (n - 1))));
    setHover(i);
  };

  const ticks = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} shapeRendering="crispEdges"
        style={{ imageRendering: 'pixelated', display: 'block', touchAction: 'pan-y' }}
        onMouseMove={onMove} onMouseLeave={() => setHover(null)}
        onTouchMove={e => { const t = e.touches[0]; if (t) onMove({ clientX: t.clientX, currentTarget: e.currentTarget }); }}
        onTouchEnd={() => setHover(null)}>
        {ticks.map(f => {
          const gy = PAD.t + f * (H - PAD.t - PAD.b);
          const val = max * (1 - f);
          return (
            <g key={f}>
              <line x1={PAD.l} x2={W - PAD.r} y1={gy} y2={gy} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
              <text x={PAD.l - 5} y={gy + 3} fontSize="9" textAnchor="end" fill="rgba(255,255,255,0.38)">
                {compact(val, cur)}
              </text>
            </g>
          );
        })}

        {goal > 0 && goal < max && (
          <>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(goal)} y2={y(goal)}
              stroke="var(--yellow)" strokeWidth="1" strokeDasharray="4 4" opacity="0.75" />
            <text x={W - PAD.r - 2} y={y(goal) - 4} fontSize="9" textAnchor="end" fill="var(--yellow)">
              GOAL {compact(goal, cur)}
            </text>
          </>
        )}

        {series.map(s => {
          const pts = s.points || [];
          if (pts.length < 2) return null;
          const d = pts.map((p, i) => `${i ? 'L' : 'M'} ${x(i).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ');
          return (
            <path key={s.key} d={d} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="miter"
              strokeLinecap="square" style={{ filter: `drop-shadow(0 0 3px ${s.color})` }} />
          );
        })}

        {series.map(s => {
          const pts = s.points || [];
          const last = pts[pts.length - 1];
          if (!last) return null;
          return <rect key={s.key} x={x(pts.length - 1) - 3} y={y(last.v) - 3} width="6" height="6" fill={s.color} />;
        })}

        {hover != null && (
          <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} stroke="rgba(255,255,255,0.28)" strokeWidth="1" />
        )}

        <text x={PAD.l} y={H - 5} fontSize="9" fill="rgba(255,255,255,0.4)">NOW</text>
        <text x={W - PAD.r} y={H - 5} fontSize="9" textAnchor="end" fill="rgba(255,255,255,0.4)">
          +{yearsShown}Y · {THIS_YEAR() + yearsShown}
        </text>
      </svg>

      {hover != null && (
        <div className="plan-tip small">
          <div className="muted" style={{ fontSize: 10 }}>YEAR {hover} · {THIS_YEAR() + hover}</div>
          {series.map(s => (
            <div key={s.key} style={{ color: s.color }}>
              {s.label} {compact((s.points || [])[hover]?.v, cur)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- main ----------------------------------------------------------------
export default function Planner({ currentValue = 0, cur = '₹', annualIncomeNow = 0, seedMonthly = null }) {
  const [plan, setPlan] = useState(DEFAULT_PLAN);
  const [loaded, setLoaded] = useState(false);
  const [goals, setGoals] = useState(EMPTY_GOALS);
  const [mode, setMode] = useState('value');      // value | income
  const [range, setRange] = useState('all');      // 5 | 10 | all
  const [scen, setScen] = useState('contrib');    // which scenario the year table shows
  const [draft, setDraft] = useState({ label: '', target: '', by: '' });

  useEffect(() => {
    let dead = false;
    (async () => {
      const [p, g] = await Promise.all([memGet(PLAN_KEY), memGet(GOALS_KEY)]);
      if (dead) return;
      if (p && typeof p === 'object') setPlan({ ...DEFAULT_PLAN, ...p });
      if (g && Array.isArray(g.goals)) setGoals(g);
      setLoaded(true);
    })();
    return () => { dead = true; };
  }, []);

  // Persist quietly — the plan is a scratchpad, not a form to submit.
  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => memSet(PLAN_KEY, plan), 700);
    return () => clearTimeout(t);
  }, [plan, loaded]);

  // The Cash tab can hand over the surplus it has actually observed. It arrives
  // as a seed, not a lock — the field stays editable, because a plan you cannot
  // argue with is not a plan.
  useEffect(() => {
    if (seedMonthly == null || !loaded) return;
    const v = Number(seedMonthly);
    if (!Number.isFinite(v)) return;
    setPlan(p => (Number(p.monthly) === v ? p : { ...p, monthly: v }));
  }, [seedMonthly, loaded]);

  const set = (k, v) => setPlan(p => ({ ...p, [k]: v }));

  // The starting balance defaults to the live book, but stays overridable —
  // "what if I had 5 lakh" is a legitimate question to ask of a planner.
  const start = plan.startValue == null ? Number(currentValue) || 0 : Number(plan.startValue);
  const effective = useMemo(() => ({ ...plan, startValue: start }), [plan, start]);

  const all = useMemo(() => projectAll(effective), [effective]);
  const y0 = THIS_YEAR();
  const sums = useMemo(() => {
    const o = {};
    for (const s of SCENARIOS) o[s.key] = summarise(all[s.key], { valueGoal: plan.valueGoal, incomeGoal: plan.incomeGoal, thisYear: y0 });
    return o;
  }, [all, plan.valueGoal, plan.incomeGoal, y0]);

  const fire = fireNumber(plan);
  const coast = coastNumber({ ...plan, years: plan.years });
  const fireRows = all.contrib || [];
  const fireYear = useMemo(() => {
    if (!fire) return null;
    const hit = fireRows.find(r => r.value >= fire);
    return hit ? hit.year : null;
  }, [fireRows, fire]);

  const yearsShown = range === 'all' ? plan.years : Math.min(Number(range), plan.years);
  const field = mode === 'income' ? 'monthlyIncome' : 'value';
  const chartSeries = useMemo(() => SCENARIOS.map(s => ({
    key: s.key, label: s.label, color: s.color,
    points: (all[s.key] || []).filter(r => r.year <= yearsShown).map(r => ({ v: r[field] })),
  })), [all, yearsShown, field]);

  const chartGoal = mode === 'income' ? Number(plan.incomeGoal) / 12 : Number(plan.valueGoal);

  const head = all.contrib?.[Math.min(yearsShown, (all.contrib?.length || 1) - 1)] || {};
  const headNow = all.contrib?.[0] || {};
  const headVal = mode === 'income' ? head.monthlyIncome : head.value;
  const headStart = mode === 'income' ? headNow.monthlyIncome : headNow.value;
  const headDelta = (headVal ?? 0) - (headStart ?? 0);
  const headPct = headStart > 0 ? (headDelta / headStart) * 100 : null;

  const split = useMemo(() => sourceSplit(all.contrib || []), [all]);
  const rows = all[scen] || [];

  // ---- goals ----
  const saveGoals = next => { setGoals(next); memSet(GOALS_KEY, next); };
  const addGoal = () => {
    const target = Number(draft.target);
    if (!draft.label.trim() || !(target > 0)) return;
    saveGoals({ goals: [...goals.goals, { id: `g${Date.now()}`, label: draft.label.trim(), target, by: draft.by || '' }] });
    setDraft({ label: '', target: '', by: '' });
  };
  const dropGoal = id => saveGoals({ goals: goals.goals.filter(g => g.id !== id) });

  return (
    <>
      <div className="tile-row">
        <StatTile label="FIRE NUMBER" color="var(--green)"
          value={compact(fire, cur)}
          note={fire ? `${plan.annualExpenses ? compact(plan.annualExpenses, cur) : '—'}/yr at ${plan.swrPct}% withdrawal` : 'set annual expenses'} />
        <StatTile label="COAST NUMBER" color="var(--cyan)"
          value={compact(coast, cur)}
          note={coast ? `enough at ${plan.growthPct}% to coast ${plan.years}y` : '—'} />
        <StatTile label={`IN ${plan.years} YEARS`} color="var(--pink)"
          value={compact(sums.contrib?.finalValue, cur)}
          note={`${compact(sums.contrib?.finalReal, cur)} in today's money`} />
        <StatTile label="PASSIVE INCOME" color="var(--orange)"
          value={`${compact(sums.contrib?.finalMonthlyIncome, cur)}/mo`}
          note={fireYear != null ? `FIRE around ${y0 + fireYear}` : 'FIRE not reached on this plan'} />
      </div>

      <Card title="Assumptions" color="var(--cyan)"
        right={<span className="small muted">stored, not submitted</span>}>
        <div className="plan-grid">
          <Num label="Starting value" value={plan.startValue} onChange={v => set('startValue', v)} step={1000}
            hint={plan.startValue == null ? `live book · ${compact(start, cur)}` : 'override — clear to use live book'} />
          <Num label="Monthly contribution" value={plan.monthly} onChange={v => set('monthly', v)} step={500} min={0} />
          <Num label="Contribution step-up" value={plan.contribGrowthPct} onChange={v => set('contribGrowthPct', v)} suffix="%/yr" step={0.5}
            hint="raises, SIP top-ups" />
          <Num label="Price growth" value={plan.growthPct} onChange={v => set('growthPct', v)} suffix="%/yr" step={0.5} />
          <Num label="Dividend yield" value={plan.divYieldPct} onChange={v => set('divYieldPct', v)} suffix="%" step={0.1}
            hint={annualIncomeNow > 0 ? `book pays ~${compact(annualIncomeNow, cur)}/yr` : 'on current value'} />
          <Num label="Dividend growth" value={plan.divGrowthPct} onChange={v => set('divGrowthPct', v)} suffix="%/yr" step={0.5} />
          <Num label="Inflation" value={plan.inflationPct} onChange={v => set('inflationPct', v)} suffix="%/yr" step={0.25}
            hint="for the real-terms twin" />
          <Num label="Horizon" value={plan.years} onChange={v => set('years', v)} suffix="yrs" step={1} min={1} />
          <Num label="Value goal" value={plan.valueGoal} onChange={v => set('valueGoal', v)} step={100000} min={0} />
          <Num label="Income goal" value={plan.incomeGoal} onChange={v => set('incomeGoal', v)} suffix="/yr" step={10000} min={0}
            hint={plan.incomeGoal ? `${compact(Number(plan.incomeGoal) / 12, cur)}/mo` : ''} />
          <Num label="Annual expenses" value={plan.annualExpenses} onChange={v => set('annualExpenses', v)} step={10000} min={0} />
          <Num label="Withdrawal rate" value={plan.swrPct} onChange={v => set('swrPct', v)} suffix="%" step={0.25} min={0}
            hint="4% is the old rule; 3–3.5% is the cautious one" />
        </div>
        <label className="flex small mt" style={{ gap: 8, alignItems: 'center', cursor: 'pointer' }}>
          <input type="checkbox" checked={!!plan.drip} onChange={e => set('drip', e.target.checked)} />
          <span>Reinvest dividends (DRIP)</span>
          <span className="muted">— off means income is paid out and stops compounding</span>
        </label>
        <div className="small muted mt">
          Everything below follows from these twelve numbers. Nothing here is a forecast:
          change one input and watch how far the answer moves — that spread is the
          honest content of any projection.
        </div>
      </Card>

      <Card title="Scenarios" color="var(--purple)"
        right={<span className="small muted">at year {plan.years} · {y0 + Number(plan.years)}</span>}>
        <div className="scroll-x">
          <table className="ptable">
            <thead>
              <tr>
                <th>Scenario</th>
                <th style={{ textAlign: 'right' }}>Final value</th>
                <th style={{ textAlign: 'right' }}>Today's money</th>
                <th style={{ textAlign: 'right' }}>Annual income</th>
                <th style={{ textAlign: 'right' }}>Monthly income</th>
                <th style={{ textAlign: 'right' }}>Income goal</th>
                <th style={{ textAlign: 'right' }}>Value goal</th>
              </tr>
            </thead>
            <tbody>
              {SCENARIOS.map(s => {
                const u = sums[s.key] || {};
                return (
                  <tr key={s.key}>
                    <td>
                      <span className="sq" style={{ background: s.color, marginRight: 6 }} />
                      <b style={{ color: s.color }}>{s.label}</b>
                      <div className="small muted">
                        {(Number(plan.growthPct) * s.growthMul).toFixed(1)}% growth
                        {s.contrib ? ` · ${compact(plan.monthly, cur)}/mo` : ' · no contributions'}
                      </div>
                    </td>
                    <td style={{ textAlign: 'right' }}><b>{compact(u.finalValue, cur)}</b></td>
                    <td style={{ textAlign: 'right', color: 'var(--ink-3)' }}>{compact(u.finalReal, cur)}</td>
                    <td style={{ textAlign: 'right' }}>{compact(u.finalAnnualIncome, cur)}</td>
                    <td style={{ textAlign: 'right' }}>{compact(u.finalMonthlyIncome, cur)}</td>
                    <td style={{ textAlign: 'right' }}>
                      {u.incomeGoalYear == null
                        ? <span className="chip c-red">not on this plan</span>
                        : <span className="chip c-green">Yr {u.incomeGoalYear} · {u.incomeGoalAt}</span>}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {u.valueGoalYear == null
                        ? <span className="chip c-red">not on this plan</span>
                        : <span className="chip c-green">Yr {u.valueGoalYear} · {u.valueGoalAt}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="small muted mt">
          Bear and bull are not probabilities — they are two other guesses, drawn so the
          base case is never mistaken for a prediction. "Not on this plan" means the goal
          is never crossed inside the horizon, which is a different answer from "late".
        </div>
      </Card>

      <Card title="Dividend snowball" color="var(--green)"
        right={
          <span className="flex" style={{ gap: 6 }}>
            <span className="seg">
              <button className={`seg-btn${mode === 'value' ? ' on' : ''}`} onClick={() => setMode('value')}>Value</button>
              <button className={`seg-btn${mode === 'income' ? ' on' : ''}`} onClick={() => setMode('income')}>Income/mo</button>
            </span>
            <span className="seg">
              {['5', '10', 'all'].map(r => (
                <button key={r} className={`seg-btn${range === r ? ' on' : ''}`} onClick={() => setRange(r)}>
                  {r === 'all' ? 'All' : `${r}Y`}
                </button>
              ))}
            </span>
          </span>
        }>
        <div className="flex" style={{ gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <b style={{ fontSize: 22, color: 'var(--green)' }}>{compact(headVal, cur)}{mode === 'income' ? '/mo' : ''}</b>
          <span className={`chip ${headDelta >= 0 ? 'c-green' : 'c-red'}`}>
            {headDelta >= 0 ? '▲' : '▼'} {compact(Math.abs(headDelta), cur)} {headPct == null ? '' : `(${pct(headPct)})`}
          </span>
          <span className="small muted">over the next {yearsShown} years · base + contributions</span>
        </div>
        <Snowball series={chartSeries} goal={chartGoal} cur={cur} yearsShown={yearsShown} />
        <div className="flex small mt" style={{ gap: 12, flexWrap: 'wrap' }}>
          {SCENARIOS.map(s => (
            <span key={s.key} className="flex" style={{ gap: 5, alignItems: 'center' }}>
              <span style={{ width: 10, height: 10, background: s.color, display: 'inline-block' }} />
              <span style={{ color: s.color }}>{s.label}</span>
            </span>
          ))}
          <span className="muted">— dashed rail is your {mode === 'income' ? 'income' : 'value'} goal</span>
        </div>
      </Card>

      {split && (
        <Card title="Where the money comes from" color="var(--orange)">
          <div className="plan-split">
            {[
              { k: 'seed', label: 'Already invested', v: split.seed, p: split.seedPct, c: 'var(--cyan)' },
              { k: 'contrib', label: 'Money you add', v: split.contributed, p: split.contribPct, c: 'var(--green)' },
              { k: 'earned', label: 'Growth + dividends', v: split.earned, p: split.earnedPct, c: 'var(--yellow)' },
            ].map(s => (
              <div key={s.k} className="plan-split-seg" style={{ width: `${Math.max(0, s.p)}%`, background: s.c }} title={s.label} />
            ))}
          </div>
          <div className="flex small mt" style={{ gap: 16, flexWrap: 'wrap' }}>
            <span><span className="sq" style={{ background: 'var(--cyan)' }} /> Already invested <b>{compact(split.seed, cur)}</b> ({split.seedPct.toFixed(0)}%)</span>
            <span><span className="sq" style={{ background: 'var(--green)' }} /> You add <b>{compact(split.contributed, cur)}</b> ({split.contribPct.toFixed(0)}%)</span>
            <span><span className="sq" style={{ background: 'var(--yellow)' }} /> Market earns <b>{compact(split.earned, cur)}</b> ({split.earnedPct.toFixed(0)}%)</span>
          </div>
          <div className="small muted mt">
            {split.earnedPct > split.contribPct
              ? 'Over this horizon the compounding does more work than the saving. Shorten the horizon and that reverses — which is why the first years feel like nothing is happening.'
              : 'Over this horizon your contributions do more work than the compounding. That is normal early on; the crossover comes later, and it comes suddenly.'}
          </div>
        </Card>
      )}

      <Card title="Year by year" color="var(--pink)"
        right={
          <span className="seg">
            {SCENARIOS.map(s => (
              <button key={s.key} className={`seg-btn${scen === s.key ? ' on' : ''}`} onClick={() => setScen(s.key)}>
                {s.label.split(' ')[0]}
              </button>
            ))}
          </span>
        }>
        <div className="scroll-x" style={{ maxHeight: 340, overflowY: 'auto' }}>
          <table className="ptable">
            <thead>
              <tr>
                <th>Year</th>
                <th style={{ textAlign: 'right' }}>Value</th>
                <th style={{ textAlign: 'right' }}>Today's money</th>
                <th style={{ textAlign: 'right' }}>Contributed</th>
                <th style={{ textAlign: 'right' }}>Income/yr</th>
                <th style={{ textAlign: 'right' }}>Income/mo</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const hitV = plan.valueGoal > 0 && r.value >= plan.valueGoal;
                return (
                  <tr key={r.year}>
                    <td>
                      {y0 + r.year} <span className="muted small">·{r.year}</span>
                      {hitV && r.year > 0 && rows[r.year - 1] && rows[r.year - 1].value < plan.valueGoal &&
                        <span className="chip c-yellow" style={{ marginLeft: 6 }}>goal</span>}
                    </td>
                    <td style={{ textAlign: 'right' }}><b>{compact(r.value, cur)}</b></td>
                    <td style={{ textAlign: 'right', color: 'var(--ink-3)' }}>{compact(r.real, cur)}</td>
                    <td style={{ textAlign: 'right', color: 'var(--ink-3)' }}>{compact(r.contributed, cur)}</td>
                    <td style={{ textAlign: 'right', color: 'var(--green)' }}>{compact(r.annualIncome, cur)}</td>
                    <td style={{ textAlign: 'right', color: 'var(--green)' }}>{compact(r.monthlyIncome, cur)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Goals" color="var(--yellow)">
        <div className="flex" style={{ gap: 6, flexWrap: 'wrap' }}>
          <input placeholder="What for? (bike, MSc, flat…)" value={draft.label}
            onChange={e => setDraft(d => ({ ...d, label: e.target.value }))} style={{ flex: '2 1 180px' }} />
          <input type="number" placeholder="Target" value={draft.target}
            onChange={e => setDraft(d => ({ ...d, target: e.target.value }))} style={{ flex: '1 1 110px' }} />
          <input type="number" placeholder="By year" value={draft.by}
            onChange={e => setDraft(d => ({ ...d, by: e.target.value }))} style={{ flex: '1 1 100px' }} />
          <button className="btn btn-green" onClick={addGoal}>+ Add</button>
        </div>

        {!goals.goals.length && (
          <div className="small muted mt">
            No goals yet. A goal is just a number and a date — progress is measured
            against the live book, and the projection above says whether the plan gets
            there in time.
          </div>
        )}

        {goals.goals.map(g => {
          const p = goalProgress(g, { value: start, rows: all.contrib || [], thisYear: y0 });
          if (!p) return null;
          const w = Math.min(100, p.pct);
          return (
            <div key={g.id} className="plan-goal mt">
              <div className="spread">
                <b>{g.label}</b>
                <span className="flex" style={{ gap: 6 }}>
                  {p.onTrack === true && <span className="chip c-green">on track</span>}
                  {p.onTrack === false && <span className="chip c-red">short {compact(p.shortfall, cur)}</span>}
                  {p.horizon != null && p.horizon < 0 && <span className="chip c-orange">past due</span>}
                  <button className="btn btn-sm" onClick={() => dropGoal(g.id)}>✕</button>
                </span>
              </div>
              <div className="plan-goal-bar">
                <div className="plan-goal-fill" style={{ width: `${w}%`, background: p.onTrack === false ? 'var(--orange)' : 'var(--green)' }} />
              </div>
              <div className="small muted">
                {compact(p.now, cur)} of {compact(p.target, cur)} · {p.pct.toFixed(1)}%
                {p.byYear ? ` · by ${p.byYear}` : ''}
                {p.projected != null ? ` · plan says ${compact(p.projected, cur)} by then` : ''}
              </div>
            </div>
          );
        })}
      </Card>

      <div className="small muted" style={{ padding: '4px 2px 12px' }}>
        These are projections, not advice or a forecast. Real returns arrive in a
        jagged order that no smooth curve captures, and a plan that clears its goal
        on paper can still miss it in life. Nothing here is a recommendation to buy,
        sell or hold anything.
      </div>
    </>
  );
}
