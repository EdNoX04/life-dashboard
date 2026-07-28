import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Card, StatTile, Empty } from '../ui.jsx';
import { memGet, memSet } from '../../lib/advisor.js';
import {
  CATEGORIES, catOf, EMPTY_EXPENSES, normaliseTxn, thisMonthKey, inMonth,
  totals, byCategory, monthlySeries, averages, runRate, fixedSplit,
  likelyRecurring, budgetStatus, plannerContribution,
} from '../../lib/expenses.js';

// Cashflow. The portfolio tabs answer "what do I have"; this one answers the
// question that actually moves the retirement date, which is "what is left over
// every month".
//
// Two rules the screen keeps: the month in progress is drawn differently from
// the months that finished — it is hatched, and its projection is always
// labelled a projection — and a savings rate with no income behind it is shown
// as unknown rather than as a number.

const KEY = 'expenses';

const fmt = (n, cur = '₹', dp = 0) =>
  n == null || !Number.isFinite(Number(n)) ? '—'
    : (n < 0 ? '-' : '') + cur + Math.abs(Number(n)).toLocaleString(undefined, {
      minimumFractionDigits: dp, maximumFractionDigits: dp,
    });
const compact = (n, cur = '₹') => {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const v = Number(n), a = Math.abs(v), s = v < 0 ? '-' : '';
  const f = (x, u) => s + cur + (x >= 100 ? Math.round(x) : x.toFixed(1)) + u;
  if (a >= 1e7) return f(a / 1e7, ' Cr');
  if (a >= 1e5) return f(a / 1e5, ' L');
  if (a >= 1e3) return f(a / 1e3, 'K');
  return s + cur + a.toFixed(0);
};
const pctTxt = (n, dp = 1) => (n == null || !Number.isFinite(n) ? '—' : `${n.toFixed(dp)}%`);
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// ---- in/out bars ---------------------------------------------------------
export function FlowBars({ series = [], cur = '₹', height = 180 }) {
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

  const show = series.slice(-14);
  const max = Math.max(...show.map(s => Math.max(s.income, s.spend)), 0);
  if (!show.length || !(max > 0)) {
    return <Empty icon="₹" text="Nothing logged yet — add a few transactions and the months fill in." />;
  }
  const W = cw || 640, H = height;
  const PAD = { l: 44, r: 6, t: 10, b: 22 };
  const iw = (W - PAD.l - PAD.r) / show.length;
  const bw = Math.max(3, (iw - 6) / 2);
  const base = H - PAD.b;
  const y = v => PAD.t + (1 - v / (max * 1.12)) * (H - PAD.t - PAD.b);

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} shapeRendering="crispEdges"
        style={{ imageRendering: 'pixelated', display: 'block' }} onMouseLeave={() => setHover(null)}>
        <defs>
          {/* The month in progress is hatched, not solid. It has not finished
              happening and must not be read as a short month. */}
          <pattern id="exp-hatch" width="4" height="4" patternUnits="userSpaceOnUse">
            <rect width="4" height="4" fill="transparent" />
            <path d="M0,4 l4,-4" stroke="var(--red)" strokeWidth="1" />
          </pattern>
        </defs>
        {[0, 0.5, 1].map(f => {
          const gy = PAD.t + f * (H - PAD.t - PAD.b);
          return (
            <g key={f}>
              <line x1={PAD.l} x2={W - PAD.r} y1={gy} y2={gy} stroke="rgba(255,255,255,0.06)" />
              <text x={PAD.l - 5} y={gy + 3} fontSize="9" textAnchor="end" fill="rgba(255,255,255,0.38)">
                {compact(max * 1.12 * (1 - f), cur)}
              </text>
            </g>
          );
        })}
        {show.map((s, i) => {
          const x0 = PAD.l + i * iw;
          const on = hover === i;
          return (
            <g key={s.key} onMouseEnter={() => setHover(i)}>
              <rect x={x0} y={PAD.t} width={iw} height={H - PAD.t - PAD.b}
                fill={on ? 'rgba(255,255,255,0.05)' : 'transparent'} />
              {s.income > 0 && (
                <rect x={x0 + iw / 2 - bw - 1} y={y(s.income)} width={bw} height={Math.max(1, base - y(s.income))}
                  fill="var(--green)" style={{ filter: 'drop-shadow(0 0 3px var(--green))' }} />
              )}
              {s.spend > 0 && (
                <rect x={x0 + iw / 2 + 1} y={y(s.spend)} width={bw} height={Math.max(1, base - y(s.spend))}
                  fill={s.partial ? 'url(#exp-hatch)' : 'var(--red)'}
                  stroke="var(--red)" strokeWidth={s.partial ? 1 : 0}
                  strokeDasharray={s.partial ? '2 2' : undefined} />
              )}
              <text x={x0 + iw / 2} y={H - 7} fontSize="8" textAnchor="middle"
                fill={on ? 'var(--ink)' : 'rgba(255,255,255,0.42)'}>{s.label}</text>
            </g>
          );
        })}
      </svg>
      {hover != null && show[hover] && (
        <div className="div-tip small">
          <div className="muted" style={{ fontSize: 10 }}>
            {show[hover].key}{show[hover].partial ? ' · in progress' : ''}
          </div>
          <div style={{ color: 'var(--green)' }}>in {fmt(show[hover].income, cur)}</div>
          <div style={{ color: 'var(--red)' }}>out {fmt(show[hover].spend, cur)}</div>
          <div>net {fmt(show[hover].net, cur)}</div>
          <div className="muted">
            saved {show[hover].savingsRate == null ? 'n/a — no income' : pctTxt(show[hover].savingsRate)}
          </div>
        </div>
      )}
    </div>
  );
}

// ---- main ----------------------------------------------------------------
export default function Expenses({ cur = '₹', onContribution }) {
  const [data, setData] = useState(EMPTY_EXPENSES);
  const [month, setMonth] = useState(() => thisMonthKey());
  const [form, setForm] = useState({ date: todayISO(), amount: '', kind: 'out', category: 'food', note: '', fixed: false });
  const [showAll, setShowAll] = useState(false);
  const [budgetEdit, setBudgetEdit] = useState(false);

  useEffect(() => {
    memGet(KEY).then(v => {
      if (!v || typeof v !== 'object') return;
      setData({
        txns: Array.isArray(v.txns) ? v.txns.map(normaliseTxn) : [],
        budgets: v.budgets && typeof v.budgets === 'object' ? v.budgets : {},
      });
    }).catch(() => {});
  }, []);

  const commit = next => { setData(next); memSet(KEY, next); };

  const txns = data.txns;
  const series = useMemo(() => monthlySeries(txns), [txns]);
  const avg = useMemo(() => averages(series), [series]);
  const rr = useMemo(() => runRate(txns), [txns]);
  const monthRows = useMemo(() => inMonth(txns, month), [txns, month]);
  const mt = useMemo(() => totals(monthRows), [monthRows]);
  const cats = useMemo(() => budgetStatus(byCategory(monthRows), data.budgets), [monthRows, data.budgets]);
  const split = useMemo(() => fixedSplit(monthRows), [monthRows]);
  const rec = useMemo(() => likelyRecurring(txns), [txns]);
  const contrib = useMemo(() => plannerContribution(series), [series]);

  const add = () => {
    if (!Number(form.amount)) return;
    const t = normaliseTxn({ ...form, id: `tx_${Date.now()}` });
    commit({ ...data, txns: [...txns, t] });
    setForm(f => ({ ...f, amount: '', note: '' }));
  };
  const drop = id => commit({ ...data, txns: txns.filter(t => t.id !== id) });
  const setBudget = (k, v) =>
    commit({ ...data, budgets: { ...data.budgets, [k]: Number(v) || 0 } });

  const isThis = month === thisMonthKey();
  const listed = showAll ? [...monthRows].reverse() : [...monthRows].reverse().slice(0, 12);

  return (
    <>
      <div className="tile-row">
        <StatTile label="SPENT THIS MONTH" color="var(--red)"
          value={compact(rr.spend, cur)}
          note={rr.partial ? `on track for ${compact(rr.projectedSpend, cur)} · projection` : 'month complete'} />
        <StatTile label="CAME IN" color="var(--green)"
          value={compact(rr.income, cur)}
          note={`day ${rr.elapsed} of ${rr.days}`} />
        <StatTile label="SAVINGS RATE" color="var(--cyan)"
          value={avg.savingsRate == null ? '—' : pctTxt(avg.savingsRate)}
          note={avg.months ? `over ${avg.months} complete month${avg.months === 1 ? '' : 's'}` : 'no complete months yet'} />
        <StatTile label="AVERAGE SPEND" color="var(--orange)"
          value={compact(avg.spend, cur)}
          note={avg.months ? 'complete months only' : 'nothing to average'} />
        <StatTile label="FIXED COSTS" color="var(--purple)"
          value={pctTxt(split.fixedPct)}
          note={split.fixedPct == null ? 'nothing spent' : `${compact(split.fixed, cur)} you cannot skip`} />
      </div>

      <Card title="Log it" color="var(--green)">
        <div className="flex" style={{ flexWrap: 'wrap', gap: 6 }}>
          <input style={{ width: 140 }} type="date" value={form.date}
            onChange={e => setForm({ ...form, date: e.target.value })} />
          <input style={{ width: 110 }} type="number" placeholder={`Amount ${cur}`} value={form.amount}
            onChange={e => setForm({ ...form, amount: e.target.value })}
            onKeyDown={e => e.key === 'Enter' && add()} />
          <select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })}>
            <option value="out">Spent</option>
            <option value="in">Received</option>
            <option value="transfer">Transfer</option>
          </select>
          {form.kind === 'out' && (
            <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
              {CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.icon} {c.label}</option>)}
            </select>
          )}
          <input style={{ width: 170 }} placeholder="Note (e.g. Spotify)" value={form.note}
            onChange={e => setForm({ ...form, note: e.target.value })}
            onKeyDown={e => e.key === 'Enter' && add()} />
          {form.kind === 'out' && (
            <label className="small flex" style={{ gap: 4, alignItems: 'center' }}>
              <input type="checkbox" checked={form.fixed} onChange={e => setForm({ ...form, fixed: e.target.checked })} />
              fixed
            </label>
          )}
          <button className="btn btn-sm btn-green" onClick={add}>+ Add</button>
        </div>
        <div className="small muted mt">
          Mark a transfer as a transfer and it stays out of both totals — moving your
          own money between accounts is not income, and counting it as such is the
          fastest way to a savings rate that means nothing.
        </div>
      </Card>

      <Card title="In and out, month by month" color="var(--cyan)"
        right={<span className="small muted">last {Math.min(series.length, 14)} months</span>}>
        <FlowBars series={series} cur={cur} />
        <div className="div-legend small mt">
          <span><i className="div-key solid" /> money in</span>
          <span><i className="exp-key out" /> money out</span>
          <span><i className="exp-key part" /> month still running</span>
        </div>
      </Card>

      <Card title="Where it went" color="var(--orange)"
        right={
          <span className="flex" style={{ gap: 6 }}>
            <select value={month} onChange={e => setMonth(e.target.value)}>
              {[...series].reverse().map(s => <option key={s.key} value={s.key}>{s.key}</option>)}
            </select>
            <button className={`btn btn-sm${budgetEdit ? ' btn-cyan' : ''}`} onClick={() => setBudgetEdit(b => !b)}>
              {budgetEdit ? 'Done' : 'Budgets'}
            </button>
          </span>
        }>
        {!cats.length && <Empty icon="₹" text="Nothing spent in this month." />}
        {cats.length > 0 && (
          <div className="exp-cats">
            {cats.map(c => (
              <div key={c.key} className={`exp-cat${c.over ? ' over' : ''}`}>
                <div className="exp-cat-top">
                  <span className="exp-icon" style={{ color: c.color }}>{c.icon}</span>
                  <b>{c.label}</b>
                  <span className="exp-cat-amt">{fmt(c.total, cur)}</span>
                </div>
                <div className="exp-bar">
                  <i style={{ width: `${Math.min(100, c.pct)}%`, background: c.color, color: c.color }} />
                  {/* The bar is drawn on the "share of this month's spend" scale, so
                      the budget marker has to be converted onto that same scale
                      before it means anything. A cap of 5,000 against a 20,000
                      month sits at 25%, wherever the fill happens to be. */}
                  {c.budget != null && c.total > 0 && (
                    <u style={{ left: `${Math.min(100, (c.budget / c.total) * c.pct)}%` }} />
                  )}
                </div>
                <div className="small muted">
                  {c.pct.toFixed(0)}% of spend · {c.count} item{c.count === 1 ? '' : 's'}
                  {c.budget != null && (
                    <> · <span style={{ color: c.over ? 'var(--red)' : 'var(--green)' }}>
                      {c.over ? `${fmt(-c.left, cur)} over` : `${fmt(c.left, cur)} left`}
                    </span></>
                  )}
                </div>
                {budgetEdit && (
                  <div className="flex" style={{ gap: 4, marginTop: 4 }}>
                    <input style={{ width: 92 }} type="number" placeholder="cap"
                      value={data.budgets[c.key] || ''}
                      onChange={e => setBudget(c.key, e.target.value)} />
                    <span className="small muted">monthly cap</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="flex mt" style={{ gap: 8, flexWrap: 'wrap' }}>
          <span className="chip c-red">out {fmt(mt.spend, cur)}</span>
          <span className="chip c-green">in {fmt(mt.income, cur)}</span>
          <span className={`chip ${mt.net >= 0 ? 'c-cyan' : 'c-red'}`}>net {fmt(mt.net, cur)}</span>
          {mt.transfers > 0 && <span className="chip">transfers {fmt(mt.transfers, cur)} · not counted</span>}
          {isThis && <span className="chip c-yellow">month still running</span>}
        </div>
      </Card>

      {rec.length > 0 && (
        <Card title="Looks like a subscription" color="var(--pink)"
          right={<span className="chip c-pink">{compact(rec.reduce((a, r) => a + r.annual, 0), cur)}/yr</span>}>
          <div className="scroll-x">
            <table className="ptable">
              <thead><tr><th>Charge</th><th style={{ textAlign: 'right' }}>Typical</th><th style={{ textAlign: 'right' }}>Months seen</th><th style={{ textAlign: 'right' }}>A year of it</th></tr></thead>
              <tbody>
                {rec.map(r => (
                  <tr key={r.key}>
                    <td><span className="exp-icon" style={{ color: catOf(r.category).color }}>{catOf(r.category).icon}</span> {r.note}</td>
                    <td style={{ textAlign: 'right' }}>{fmt(r.average, cur)}</td>
                    <td style={{ textAlign: 'right' }}>{r.months}</td>
                    <td style={{ textAlign: 'right', color: 'var(--pink)' }}><b>{fmt(r.annual, cur)}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="small muted mt">
            Spotted by finding the same note at roughly the same amount in three or
            more months. It is a pattern in your own log, not a bank feed — a charge
            you never wrote a note for will not show up here.
          </div>
        </Card>
      )}

      <Card title="What this leaves for investing" color="var(--yellow)">
        <div className="grid2">
          <div>
            <div className="plan-flabel">SUSTAINED MONTHLY SURPLUS</div>
            <div style={{ fontSize: 30, color: 'var(--green)', filter: 'drop-shadow(0 0 6px var(--green))' }}>
              {compact(contrib.monthly, cur)}
            </div>
            <div className="small muted">
              {contrib.months
                ? `average of ${contrib.months} complete month${contrib.months === 1 ? '' : 's'}`
                : 'no complete months logged yet'}
              {contrib.savingsRate != null && ` · ${pctTxt(contrib.savingsRate)} of income`}
            </div>
          </div>
          <div>
            <div className="small">
              {contrib.confident
                ? 'Six or more complete months is enough history to treat this as a rate you actually sustain.'
                : 'Fewer than six complete months. Treat this as an early read — one unusual month still moves it a lot.'}
            </div>
            {onContribution && contrib.monthly > 0 && (
              <button className="btn btn-sm btn-green mt" onClick={() => onContribution(Math.round(contrib.monthly))}>
                Use {compact(contrib.monthly, cur)}/mo in the plan
              </button>
            )}
          </div>
        </div>
        <div className="small muted mt">
          This is the number the Plan tab compounds. Everything on that tab is only
          as real as this one is — a projection built on a contribution you have not
          actually been making is a wish with a chart attached.
        </div>
      </Card>

      <Card title={`Transactions · ${month}`} color="var(--purple)"
        right={monthRows.length > 12 && (
          <button className="btn btn-sm" onClick={() => setShowAll(s => !s)}>
            {showAll ? 'Show recent' : `All ${monthRows.length}`}
          </button>
        )}>
        {!monthRows.length && <Empty icon="·" text="Nothing logged in this month." />}
        {monthRows.length > 0 && (
          <div className="scroll-x">
            <table className="ptable">
              <thead><tr><th>Date</th><th>What</th><th>Category</th><th style={{ textAlign: 'right' }}>Amount</th><th /></tr></thead>
              <tbody>
                {listed.map(t => (
                  <tr key={t.id}>
                    <td className="small muted">{t.date.slice(5)}</td>
                    <td>{t.note || <span className="muted">—</span>}{t.fixed && <span className="chip" style={{ marginLeft: 6 }}>fixed</span>}</td>
                    <td>
                      {t.kind === 'out'
                        ? <><span className="exp-icon" style={{ color: catOf(t.category).color }}>{catOf(t.category).icon}</span> {catOf(t.category).label}</>
                        : <span className="muted">{t.kind === 'in' ? 'income' : 'transfer'}</span>}
                    </td>
                    <td style={{
                      textAlign: 'right',
                      color: t.kind === 'in' ? 'var(--green)' : t.kind === 'transfer' ? 'var(--ink-3)' : 'var(--red)',
                    }}>
                      {t.kind === 'in' ? '+' : t.kind === 'transfer' ? '↔' : '−'}{fmt(t.amount, cur)}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn btn-sm" onClick={() => drop(t.id)}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
