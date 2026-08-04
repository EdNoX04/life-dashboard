import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Card, StatTile, Empty } from '../ui.jsx';
import { memGet, memSet } from '../../lib/advisor.js';
import {
  FREQS, MONTH_NAMES, EMPTY_DIVS, normaliseEntry, calendarForYear, monthlyTotals,
  incomeSummary, upcoming, perHolding, coverage, bookYield, incomeLadder, annualPerShare, exWatch,
} from '../../lib/dividends.js';

// The income side of the book: what it pays, when, and how much of that is a
// promise versus a guess.
//
// The visual grammar is fixed and load-bearing, so it is stated once here and
// obeyed everywhere below:
//
//     SOLID  = declared. A board has resolved to pay this.
//     DASHED = estimated. Extrapolated from the schedule on file. It can be cut.
//
// A screen that renders those two identically is not a dividend tracker, it is a
// wish list. The same rule governs the headline tiles: they carry the share of
// the total that is actually declared, so a number built almost entirely of
// guesses cannot masquerade as income.

const META_KEY = 'div_meta';

function compact(n, cur = '$') {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const v = Number(n), a = Math.abs(v), sign = v < 0 ? '-' : '';
  const f = (x, s) => sign + cur + (x >= 100 ? Math.round(x) : x.toFixed(x >= 10 ? 1 : 2)) + s;
  if (cur === '₹') {
    if (a >= 1e7) return f(a / 1e7, ' Cr');
    if (a >= 1e5) return f(a / 1e5, ' L');
    if (a >= 1e3) return f(a / 1e3, 'K');
  } else if (a >= 1e6) return f(a / 1e6, 'M');
  else if (a >= 1e4) return f(a / 1e3, 'K');
  return sign + cur + a.toFixed(a < 100 ? 2 : 0);
}
const exact = (n, cur = '$') =>
  n == null || !Number.isFinite(Number(n)) ? '—'
    : cur + Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });

const dayOf = isoStr => Number(String(isoStr).slice(8, 10));

// ---- month-by-month bars -------------------------------------------------
export function IncomeBars({ rows = [], cur = '$', height = 190 }) {
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

  const W = cw || 640, H = height;
  const PAD = { l: 42, r: 6, t: 10, b: 20 };
  const max = Math.max(...rows.map(r => r.total), 0);
  if (!(max > 0)) {
    return <Empty icon="₹" text="No dividend schedule on file yet — add one below and the year fills in." />;
  }
  const iw = (W - PAD.l - PAD.r) / 12;
  const bw = Math.max(6, iw * 0.62);
  const y = v => PAD.t + (1 - v / (max * 1.1)) * (H - PAD.t - PAD.b);
  const base = H - PAD.b;

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} shapeRendering="crispEdges"
        style={{ imageRendering: 'pixelated', display: 'block' }}
        onMouseLeave={() => setHover(null)}>
        {[0, 0.5, 1].map(f => {
          const gy = PAD.t + f * (H - PAD.t - PAD.b);
          return (
            <g key={f}>
              <line x1={PAD.l} x2={W - PAD.r} y1={gy} y2={gy} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
              <text x={PAD.l - 5} y={gy + 3} fontSize="9" textAnchor="end" fill="rgba(255,255,255,0.38)">
                {compact(max * 1.1 * (1 - f), cur)}
              </text>
            </g>
          );
        })}
        {rows.map(r => {
          const x = PAD.l + r.month * iw + (iw - bw) / 2;
          const hD = base - y(r.declared);
          const hE = base - y(r.estimated);
          const on = hover === r.month;
          return (
            <g key={r.month} onMouseEnter={() => setHover(r.month)}>
              <rect x={PAD.l + r.month * iw} y={PAD.t} width={iw} height={H - PAD.t - PAD.b}
                fill={on ? 'rgba(255,255,255,0.05)' : 'transparent'} />
              {r.estimated > 0 && (
                <rect x={x} y={base - hE - hD} width={bw} height={Math.max(1, hE)}
                  fill="var(--cyan)" fillOpacity="0.28" stroke="var(--cyan)" strokeWidth="1" strokeDasharray="3 2" />
              )}
              {r.declared > 0 && (
                <rect x={x} y={base - hD} width={bw} height={Math.max(1, hD)}
                  fill="var(--green)" style={{ filter: 'drop-shadow(0 0 4px var(--green))' }} />
              )}
              <text x={x + bw / 2} y={H - 6} fontSize="9" textAnchor="middle"
                fill={on ? 'var(--ink)' : 'rgba(255,255,255,0.45)'}>{r.label}</text>
            </g>
          );
        })}
      </svg>
      {hover != null && rows[hover] && (
        <div className="div-tip small">
          <div className="muted" style={{ fontSize: 10 }}>{rows[hover].label} · {exact(rows[hover].total, cur)}</div>
          {rows[hover].items.slice(0, 8).map((p, i) => (
            <div key={i} className={p.status === 'declared' ? '' : 'muted'}>
              {p.status === 'declared' ? '■' : '□'} {p.ticker} {exact(p.amount, cur)}
            </div>
          ))}
          {!rows[hover].items.length && <div className="muted">nothing scheduled</div>}
        </div>
      )}
    </div>
  );
}

// ---- calendar ------------------------------------------------------------
export function MonthGrid({ year, month, payments = [], cur = '$', compactMode = false }) {
  const first = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  const byDay = new Map();
  for (const p of payments) {
    const d = dayOf(p.pay);
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push({ ...p, kind: 'pay' });
  }
  const exByDay = new Map();
  for (const p of payments) {
    const d = new Date(p.ex);
    if (d.getFullYear() !== year || d.getMonth() !== month) continue;
    const k = d.getDate();
    if (!exByDay.has(k)) exByDay.set(k, []);
    exByDay.get(k).push(p);
  }

  const cells = [];
  for (let i = 0; i < first; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(d);

  return (
    <div className={`div-month${compactMode ? ' mini' : ''}`}>
      <div className="div-month-name">{MONTH_NAMES[month]}</div>
      <div className="div-dow">{['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <span key={i}>{d}</span>)}</div>
      <div className="div-days">
        {cells.map((d, i) => {
          if (d == null) return <span key={i} className="div-day empty" />;
          const pays = byDay.get(d) || [];
          const exs = exByDay.get(d) || [];
          return (
            <span key={i} className={`div-day${pays.length ? ' has' : ''}`}
              title={pays.map(p => `${p.ticker} ${exact(p.amount, cur)} (${p.status})`).join('\n')}>
              <b>{d}</b>
              {pays.map((p, k) => (
                <i key={k} className={`div-chip ${p.status === 'declared' ? 'solid' : 'est'}`}>
                  {compactMode ? '' : p.ticker}
                </i>
              ))}
              {!pays.length && exs.map((p, k) => (
                <i key={`e${k}`} className="div-chip ex">{compactMode ? '' : `Ex ${p.ticker}`}</i>
              ))}
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ---- per-holding editor --------------------------------------------------
function HoldingEditor({ ticker, entry, onSave, onClear, cur }) {
  const [e, setE] = useState(() => normaliseEntry(entry || {}));
  const set = (k, v) => setE(p => ({ ...p, [k]: v }));
  const aps = annualPerShare(e);
  return (
    <div className="div-editor">
      <div className="plan-grid">
        <label className="plan-field">
          <span className="plan-flabel">Per payment</span>
          <span className="plan-fin">
            <input type="number" step="0.01" value={e.perShare ?? ''}
              onChange={ev => set('perShare', ev.target.value === '' ? null : Number(ev.target.value))} />
            <span className="plan-fsuffix">/sh</span>
          </span>
          <span className="plan-fhint">{aps == null ? 'unknown — leave blank if you do not know' : `${exact(aps, cur)}/sh a year`}</span>
        </label>
        <label className="plan-field">
          <span className="plan-flabel">Frequency</span>
          <span className="plan-fin">
            <select value={e.freq} onChange={ev => set('freq', ev.target.value)}>
              {FREQS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
          </span>
        </label>
        <label className="plan-field">
          <span className="plan-flabel">First pay month</span>
          <span className="plan-fin">
            <select value={e.anchorMonth} onChange={ev => set('anchorMonth', Number(ev.target.value))}>
              {MONTH_NAMES.map((m, i) => <option key={m} value={i}>{m}</option>)}
            </select>
          </span>
        </label>
        <label className="plan-field">
          <span className="plan-flabel">Pay day</span>
          <span className="plan-fin">
            <input type="number" min="1" max="28" value={e.payDay} onChange={ev => set('payDay', Number(ev.target.value))} />
          </span>
        </label>
        <label className="plan-field">
          <span className="plan-flabel">Ex-div lead</span>
          <span className="plan-fin">
            <input type="number" min="0" value={e.exOffsetDays} onChange={ev => set('exOffsetDays', Number(ev.target.value))} />
            <span className="plan-fsuffix">days</span>
          </span>
          <span className="plan-fhint">buy before this to receive it</span>
        </label>
        <label className="plan-field">
          <span className="plan-flabel">Payout growth</span>
          <span className="plan-fin">
            <input type="number" step="0.5" value={e.growthPct} onChange={ev => set('growthPct', Number(ev.target.value))} />
            <span className="plan-fsuffix">%/yr</span>
          </span>
        </label>
      </div>
      <div className="flex mt" style={{ gap: 6 }}>
        <button className="btn btn-green btn-sm" onClick={() => onSave(e)}>Save {ticker}</button>
        <button className="btn btn-sm" onClick={onClear}>Clear</button>
        <span className="small muted">Saved schedules are drawn dashed — estimates, not promises.</span>
      </div>
    </div>
  );
}

// ---- main ----------------------------------------------------------------
export default function DividendDesk({
  held = [], priceOf, costOf, cur = '$', fx = 1, inr = false,
}) {
  const [meta, setMeta] = useState(EMPTY_DIVS.rows);
  const [loaded, setLoaded] = useState(false);
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [calMode, setCalMode] = useState('year');  // year | month
  const [month, setMonth] = useState(() => new Date().getMonth());
  const [editing, setEditing] = useState(null);

  useEffect(() => {
    let dead = false;
    (async () => {
      const m = await memGet(META_KEY);
      if (dead) return;
      if (m && typeof m === 'object') setMeta(m.rows && typeof m.rows === 'object' ? m.rows : m);
      setLoaded(true);
    })();
    return () => { dead = true; };
  }, []);

  const rate = inr && fx ? fx : 1;
  const sharesOf = h => Number(h.qty ?? h.shares ?? 0);
  const px = priceOf || (h => Number(h.last_price ?? h.price ?? 0));
  const cx = costOf || (h => Number(h.avg_cost ?? h.cost ?? 0));

  const payments = useMemo(
    () => calendarForYear(held, meta, year, { sharesOf, fx: rate }),
    [held, meta, year, rate],
  );
  const rows = useMemo(() => monthlyTotals(payments), [payments]);
  const sum = useMemo(() => incomeSummary(payments), [payments]);
  const lines = useMemo(
    () => perHolding(held, meta, { sharesOf, priceOf: px, costOf: cx, year, fx: rate }),
    [held, meta, year, rate],
  );
  const cov = useMemo(() => coverage(lines), [lines]);
  const by = useMemo(() => bookYield(lines), [lines]);
  const ladder = useMemo(() => incomeLadder(lines, 10), [lines]);
  const next = useMemo(() => upcoming(payments, { limit: 6 }), [payments]);
  // Deliberately built off THIS year's payments plus next year's, because an
  // ex-date in the first days of January has its buy deadline in December and
  // a year-scoped calendar would hide it during exactly the week it mattered.
  const watch = useMemo(() => {
    const spill = calendarForYear(held, meta, new Date().getFullYear() + 1, { sharesOf, fx: rate });
    return exWatch([...payments, ...spill], { withinDays: 60 });
  }, [payments, held, meta, rate]);

  const save = (ticker, entry) => {
    const nextMeta = { ...meta, [ticker]: entry };
    setMeta(nextMeta);
    memSet(META_KEY, { rows: nextMeta });
    setEditing(null);
  };
  const clear = ticker => {
    const nextMeta = { ...meta };
    delete nextMeta[ticker];
    setMeta(nextMeta);
    memSet(META_KEY, { rows: nextMeta });
    setEditing(null);
  };

  const paying = lines.filter(l => !l.unknown && l.income > 0);

  return (
    <>
      <div className="tile-row">
        <StatTile label="PROJECTED ANNUAL" color="var(--green)"
          value={compact(sum.annual, cur)}
          note={sum.declaredShare > 0 ? `${sum.declaredShare.toFixed(0)}% declared` : 'all estimated'} />
        <StatTile label="AVERAGE MONTHLY" color="var(--cyan)"
          value={compact(sum.averageMonthly, cur)}
          note={`${sum.payingMonths}/12 months pay`} />
        <StatTile label={`${sum.thisMonthLabel.toUpperCase()} — THIS MONTH`} color="var(--pink)"
          value={compact(sum.thisMonth, cur)}
          note={sum.lean ? `leanest ${sum.lean.label} · ${compact(sum.lean.total, cur)}` : '—'} />
        <StatTile label="PEAK MONTH" color="var(--orange)"
          value={sum.peak ? `${sum.peak.label}` : '—'}
          note={sum.peak ? compact(sum.peak.total, cur) : 'nothing scheduled'} />
        <StatTile label="YIELD ON COST" color="var(--yellow)"
          value={by.onCost == null ? '—' : `${by.onCost.toFixed(2)}%`}
          note={by.onValue == null ? '—' : `${by.onValue.toFixed(2)}% on today's value`} />
      </div>

      {/* An empty book has no coverage gap to report — "0% covered" with nothing
          held would be a complaint about a portfolio that does not exist. */}
      {lines.length > 0 && !cov.complete && (
        <div className="div-cover">
          <b>{cov.pct.toFixed(0)}% of the book has a dividend schedule on file.</b>{' '}
          No data for {cov.missing.slice(0, 8).join(', ')}{cov.missing.length > 8 ? ` +${cov.missing.length - 8}` : ''} —
          those are counted as <i>unknown</i>, not as zero. The totals above cover only what is known.
        </div>
      )}

      <Card title="Projected income, month by month" color="var(--green)"
        right={
          <span className="flex" style={{ gap: 6 }}>
            <button className="btn btn-sm" onClick={() => setYear(y => y - 1)}>◀</button>
            <span className="chip c-cyan">{year}</span>
            <button className="btn btn-sm" onClick={() => setYear(y => y + 1)}>▶</button>
          </span>
        }>
        <IncomeBars rows={rows} cur={cur} />
        <div className="div-legend small mt">
          <span><i className="div-key solid" /> solid = declared or already paid</span>
          <span><i className="div-key est" /> dashed = estimated from the schedule on file</span>
          <span><i className="div-key ex" /> Ex = ex-dividend date</span>
        </div>
      </Card>

      {/* Above "Coming up" on purpose. Everything else on this screen tells you
          what will arrive; this is the only part with a deadline on it, and a
          deadline below a diary gets read second. */}
      {watch.length > 0 && (
        <Card title="Ex-dividend watch" color="var(--orange)"
          right={<span className="small muted">next 60 days</span>}>
          <div className="exw">
            {watch.map((w, i) => (
              <div key={i} className={`exw-row ${w.phase}`}>
                <span className="exw-days">
                  {w.phase === 'entitled'
                    ? <b className="c-green">HELD</b>
                    : <><b>{w.daysToEx}</b><i>d</i></>}
                </span>
                <span className="exw-main">
                  <b>{w.ticker}</b>
                  <span className={`chip ${w.status === 'declared' ? 'c-green' : 'c-cyan'}`}>
                    {w.status === 'declared' ? 'declared' : 'estimated'}
                  </span>
                  {w.special && <span className="chip c-pink">special</span>}
                </span>
                <span className="exw-dates small">
                  <span title="Last day to buy and still be paid">
                    buy by <b className={w.phase === 'open' ? 'c-orange' : 'muted'}>{w.lastBuy?.slice(5) || '—'}</b>
                  </span>
                  <span title="First day the share trades without the dividend">ex <b>{w.ex.slice(5)}</b></span>
                  <span title="The day the register is read">rec <b>{w.record?.slice(5) || '—'}</b></span>
                  <span title="Payment date">pay <b>{w.pay.slice(5)}</b></span>
                </span>
                <b className="exw-amt">{exact(w.amount, cur)}</b>
              </div>
            ))}
          </div>
          {/* Stated once, here, rather than trusted to be common knowledge: the
              buy deadline is the number people get wrong, and they get it wrong
              by one day in the expensive direction. */}
          <div className="small muted mt">
            Buy on or before the <b>buy by</b> date to receive the payment — a purchase on the ex-date
            settles too late to be on the register. Under T+1 the record date <i>is</i> the ex-date.
            Weekends are handled; exchange holidays are not, so treat a deadline that falls next to one
            as a day earlier than shown.
          </div>
        </Card>
      )}

      {next.length > 0 && (
        <Card title="Coming up" color="var(--cyan)">
          <div className="div-next">
            {next.map((p, i) => (
              <div key={i} className={`div-next-row ${p.status}`}>
                <span className="div-next-date">{p.pay.slice(5)}</span>
                <b>{p.ticker}</b>
                <span className="muted small">{p.shares} sh × {exact(p.perShare, '')}</span>
                <span className="muted small">ex {p.ex.slice(5)} · rec {p.record?.slice(5) || '—'}</span>
                <span className={`chip ${p.status === 'declared' ? 'c-green' : 'c-cyan'}`}>
                  {p.status === 'declared' ? 'declared' : 'estimated'}
                </span>
                <b style={{ marginLeft: 'auto', color: 'var(--green)' }}>{exact(p.amount, cur)}</b>
              </div>
            ))}
          </div>
          <div className="small muted mt">
            Ex-dates run {lines.find(l => l.entry)?.entry?.exOffsetDays ?? 14} days ahead of payment by default
            where no declaration is on file. Selling before the ex-date hands the payment to the buyer;
            selling on or after it does not, so you can sell an ex-dividend share and still be paid.
          </div>
        </Card>
      )}

      <Card title="Dividend calendar" color="var(--purple)"
        right={
          <span className="seg">
            <button className={`seg-btn${calMode === 'year' ? ' on' : ''}`} onClick={() => setCalMode('year')}>Year</button>
            <button className={`seg-btn${calMode === 'month' ? ' on' : ''}`} onClick={() => setCalMode('month')}>Month</button>
          </span>
        }>
        {calMode === 'month' ? (
          <>
            <div className="flex" style={{ gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
              {MONTH_NAMES.map((m, i) => (
                <button key={m} className={`btn btn-sm${month === i ? ' btn-cyan' : ''}`} onClick={() => setMonth(i)}>{m}</button>
              ))}
            </div>
            <MonthGrid year={year} month={month} cur={cur}
              payments={payments.filter(p => p.month === month)} />
          </>
        ) : (
          <div className="div-year">
            {MONTH_NAMES.map((m, i) => (
              <MonthGrid key={m} year={year} month={i} cur={cur} compactMode
                payments={payments.filter(p => p.month === i)} />
            ))}
          </div>
        )}
        <div className="div-legend small mt">
          <span><i className="div-key solid" /> declared</span>
          <span><i className="div-key est" /> estimated</span>
          <span><i className="div-key ex" /> ex-dividend</span>
        </div>
      </Card>

      <Card title="What each holding pays" color="var(--orange)"
        right={<span className="small muted">{paying.length} of {lines.length} pay</span>}>
        {!lines.length && <Empty icon="₹" text="No holdings yet." />}
        {lines.length > 0 && (
          <div className="scroll-x">
            <table className="ptable">
              <thead>
                <tr>
                  <th>Holding</th>
                  <th style={{ textAlign: 'right' }}>Shares</th>
                  <th style={{ textAlign: 'right' }}>Per share/yr</th>
                  <th style={{ textAlign: 'right' }}>Income/yr</th>
                  <th style={{ textAlign: 'right' }}>Yield</th>
                  <th style={{ textAlign: 'right' }}>On cost</th>
                  <th>Next</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lines.map(l => (
                  <React.Fragment key={l.ticker}>
                    <tr className={l.unknown ? 'div-unknown' : ''}>
                      <td>
                        <b>{l.ticker}</b>
                        {l.declared && <span className="chip c-green" style={{ marginLeft: 6 }}>declared</span>}
                        {l.unknown && <span className="chip" style={{ marginLeft: 6 }}>no data</span>}
                      </td>
                      <td style={{ textAlign: 'right' }}>{l.shares}</td>
                      <td style={{ textAlign: 'right' }}>{l.annualPerShare == null ? '—' : exact(l.annualPerShare, '')}</td>
                      <td style={{ textAlign: 'right', color: l.income ? 'var(--green)' : 'var(--ink-3)' }}>
                        {l.income == null ? 'unknown' : exact(l.income, cur)}
                      </td>
                      <td style={{ textAlign: 'right' }}>{l.currentYield == null ? '—' : `${l.currentYield.toFixed(2)}%`}</td>
                      <td style={{ textAlign: 'right', color: 'var(--yellow)' }}>
                        {l.yieldOnCost == null ? '—' : `${l.yieldOnCost.toFixed(2)}%`}
                      </td>
                      <td className="small muted">{l.next ? `${l.next.pay.slice(5)} · ${exact(l.next.amount, cur)}` : '—'}</td>
                      <td style={{ textAlign: 'right' }}>
                        <button className="btn btn-sm" onClick={() => setEditing(editing === l.ticker ? null : l.ticker)}>
                          {editing === l.ticker ? 'Close' : l.unknown ? '+ Add' : 'Edit'}
                        </button>
                      </td>
                    </tr>
                    {editing === l.ticker && (
                      <tr>
                        <td colSpan={8} style={{ padding: 0 }}>
                          <HoldingEditor ticker={l.ticker} entry={meta[l.ticker]} cur={cur}
                            onSave={e => save(l.ticker, e)} onClear={() => clear(l.ticker)} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td><b>TOTAL</b></td>
                  <td />
                  <td />
                  <td style={{ textAlign: 'right', color: 'var(--green)' }}><b>{exact(by.income, cur)}</b></td>
                  <td style={{ textAlign: 'right' }}>{by.onValue == null ? '—' : `${by.onValue.toFixed(2)}%`}</td>
                  <td style={{ textAlign: 'right', color: 'var(--yellow)' }}>{by.onCost == null ? '—' : `${by.onCost.toFixed(2)}%`}</td>
                  <td colSpan={2} className="small muted">on the {cov.pct.toFixed(0)}% we have data for</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <div className="small muted mt">
          Yield on cost is what your original purchase price now yields — it rises as
          payouts grow and never falls when the share price does, which is why it
          flatters. Current yield is the honest one for deciding what to buy next.
        </div>
      </Card>

      {by.income > 0 && (
        <Card title="If the payouts keep growing" color="var(--yellow)">
          <div className="scroll-x">
            <table className="ptable">
              <thead>
                <tr>
                  <th>Year</th>
                  <th style={{ textAlign: 'right' }}>Annual income</th>
                  <th style={{ textAlign: 'right' }}>Monthly</th>
                  <th style={{ textAlign: 'right' }}>vs today</th>
                </tr>
              </thead>
              <tbody>
                {ladder.filter(r => r.offset % 2 === 0).map(r => (
                  <tr key={r.year}>
                    <td>{r.year} <span className="muted small">·{r.offset}</span></td>
                    <td style={{ textAlign: 'right', color: 'var(--green)' }}><b>{exact(r.income, cur)}</b></td>
                    <td style={{ textAlign: 'right' }}>{exact(r.monthly, cur)}</td>
                    <td style={{ textAlign: 'right', color: 'var(--ink-3)' }}>
                      {ladder[0].income > 0 ? `${((r.income / ladder[0].income - 1) * 100).toFixed(0)}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="small muted mt">
            Same shares, no new buying — only the per-share payout growing at the rate
            on each holding's schedule. It assumes no cuts, and dividends do get cut.
          </div>
        </Card>
      )}

      <div className="small muted" style={{ padding: '4px 2px 12px' }}>
        Estimated payments are extrapolations from the schedule you entered, not
        commitments by any company. Boards cut and suspend dividends without notice.
        Nothing here is advice or a recommendation to buy, sell or hold anything.
      </div>
    </>
  );
}
