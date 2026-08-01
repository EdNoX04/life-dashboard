// Earnings calendar — the screen half.
//
// The reference is a Mon–Fri grid with a Before Open / After Close split, an
// overflow tile reading "+143", scope tabs, a Week/Month toggle and week arrows.
// earncal.js already refuses the three ways that screen can lie (a session it
// cannot name, a cell it truncates silently, a weekend it filters away). This
// file's job is to make those refusals visible rather than quietly correct.
//
// Four screen-level decisions.
//
// A. THE TWO EXTRA SESSION ROWS APPEAR ONLY WHEN SOMETHING IS IN THEM, AND THE
//    ROW LABEL IS NEVER "OTHER". Decision 2 in the library gives four buckets
//    where the reference has two. Rendering all four always would put two empty
//    rows under every column for the ninety-odd percent of weeks where nothing
//    reports during hours — which trains the eye to skip them, which is the
//    same as not having them. Rendering them only when occupied means the row's
//    presence is itself the information: if "During hours" is on screen, some
//    company on it reported while the market was open. What they are NOT is
//    collapsed into a bucket called "Other", because "we know it was during
//    trading" and "the feed did not say" are the two facts decision 2 exists to
//    keep apart, and one label over both destroys exactly that distinction.
//
// B. AN EMPTY GRID MUST SAY WHY IT IS EMPTY, AND THERE ARE FOUR DIFFERENT WHYS.
//    No key, plan does not include the calendar, the request failed, and the
//    feed genuinely returned nothing for this window are four different states
//    that a naive build renders as one blank week. Worse, three of them are
//    fixable by Neel and the fourth is not, so collapsing them removes the only
//    information that would tell him whether to act. The status line is printed
//    above the grid in all four cases, including the good one.
//
// C. A CAPPED CELL EXPANDS IN PLACE AND THE COUNT IS A BUTTON, NOT A LABEL.
//    The reference's "+143" is a dead badge. Since capCell hands back the rows
//    it hid, the honest version is a control: press it and the cell grows. A
//    number that names hidden things and cannot show them is a worse promise
//    than no number at all.
//
// D. A TILE SHOWS THE ESTIMATE UNTIL THERE IS A RESULT, AND SAYS WHICH IT IS
//    EVERY TIME. Decision 5 keeps the two fields apart in the data; this is the
//    same rule at the pixel level. Every EPS figure on this screen is preceded
//    by the word "est" or "act". A bare number that silently changes meaning on
//    the morning of the report is the exact failure the library refuses, and it
//    would be reintroduced here by a tile that just prints whichever field is
//    non-null.

import React, { useEffect, useMemo, useState } from 'react';
import * as C from '../../lib/earncal.js';
import { fetchEarningsCalendar, calendarCachedAt, hasKey } from '../../lib/fundamentals.js';
import { todayStr } from '../../lib/hooks.js';
import { Card, Empty } from '../ui.jsx';

// The anchor is the ONE date on this screen that is deliberately local rather
// than UTC. Every date the feed supplies is compared and bucketed in UTC per
// decision 1, but "which week am I looking at" is a question about where Neel is
// standing, not about where the exchange is. Getting this backwards would open
// the app on Monday morning in Delhi showing last week.
const anchorToday = () => todayStr();

export function StatusNote({ status, n, at, from, to }) {
  // Decision B: four states, four sentences, and the good one is printed too.
  if (status === 'nokey') {
    return (
      <p className="ec-status ec-status-warn">
        No data key is set, so nothing has been requested. Add a Finnhub key in Settings and this fills in.
      </p>
    );
  }
  if (status === 'blocked') {
    return (
      <p className="ec-status ec-status-warn">
        The calendar endpoint refused this key — on the free tier it is usually not included in the plan.
        This is not the same as an empty week: no companies were ruled out, none were ever asked for.
      </p>
    );
  }
  if (status === 'error') {
    return (
      <p className="ec-status ec-status-bad">
        The request for {from} → {to} did not come back. Nothing below is from this window.
      </p>
    );
  }
  if (status === 'ok' && !n) {
    return (
      <p className="ec-status">
        The feed answered for {from} → {to} and listed no companies. That is the feed's answer, not a claim
        that no company on earth reports this week.
      </p>
    );
  }
  return (
    <p className="ec-status ec-status-ok">
      {n} {n === 1 ? 'company' : 'companies'} in the feed for {from} → {to}
      {at ? <span className="ec-at"> · fetched {new Date(at).toLocaleTimeString()}</span> : null}
    </p>
  );
}

export function RowTile({ row, on, onPick, cur }) {
  const s = C.surpriseOf(row);
  const reported = s.state !== 'not_reported';
  return (
    <button
      className={`ec-tile${on ? ' on' : ''}${reported ? (s.beat === false ? ' ec-miss' : ' ec-beat') : ''}`}
      onClick={() => onPick(row)}
      title={`${row.symbol} · ${C.sessionMeta(row.session).label}`}
    >
      <span className="ec-sym">{row.symbol}</span>
      {/* Decision D: the label is not optional and never says just a number. */}
      <span className="ec-eps">
        {reported
          ? <>act {C.fmtEps(row.epsAct, cur)}</>
          : (row.epsEst !== null ? <>est {C.fmtEps(row.epsEst, cur)}</> : <span className="ec-none">no est</span>)}
      </span>
    </button>
  );
}

export function Cell({ list, cap = 6, pick, onPick, cur }) {
  const [open, setOpen] = useState(false);
  const c = C.capCell(list, cap);
  if (!c.total) return <div className="ec-cell ec-cell-empty">–</div>;
  const show = open ? [...c.shown, ...c.hidden] : c.shown;
  return (
    <div className="ec-cell">
      {show.map(r => (
        <RowTile key={r.symbol + r.date} row={r} cur={cur} on={pick && pick.symbol === r.symbol && pick.date === r.date} onPick={onPick} />
      ))}
      {/* Decision C: the count is a control, because capCell handed us what it hid. */}
      {c.more > 0 && (
        <button className="ec-more" onClick={() => setOpen(o => !o)}>
          {open ? `hide ${c.more}` : `+${c.more}`}
        </button>
      )}
    </div>
  );
}

export function DayColumn({ iso, day, today, pick, onPick, cur, showDmh, showUnk }) {
  const d = day || { bmo: [], amc: [], dmh: [], unk: [], n: 0 };
  return (
    <div className={`ec-col${iso === today ? ' ec-today' : ''}`}>
      <div className="ec-colhead">
        <span className="ec-colday">{C.dayLabel(iso)}</span>
        <span className="ec-coln">{d.n || 0}</span>
      </div>
      <div className="ec-sess">
        <span className="ec-sesslab">Before open</span>
        <Cell list={d.bmo} pick={pick} onPick={onPick} cur={cur} />
      </div>
      <div className="ec-sess">
        <span className="ec-sesslab">After close</span>
        <Cell list={d.amc} pick={pick} onPick={onPick} cur={cur} />
      </div>
      {/* Decision A: present only when occupied somewhere in the week, and named
          for what they actually are. */}
      {showDmh && (
        <div className="ec-sess ec-sess-x">
          <span className="ec-sesslab">During hours</span>
          <Cell list={d.dmh} pick={pick} onPick={onPick} cur={cur} />
        </div>
      )}
      {showUnk && (
        <div className="ec-sess ec-sess-x">
          <span className="ec-sesslab">Time not stated</span>
          <Cell list={d.unk} pick={pick} onPick={onPick} cur={cur} />
        </div>
      )}
    </div>
  );
}

export function WeekendNote({ rows }) {
  if (!rows || !rows.length) return null;
  // Decision 4 made visible: the grid has no column for these, so they get a line.
  return (
    <p className="ec-weekend">
      <b>{rows.length}</b> {rows.length === 1 ? 'company reports' : 'companies report'} on the weekend, which this
      Mon–Fri grid has no column for: {rows.map(r => `${r.symbol} (${C.DOW[C.dowOf(r.date) - 1]})`).join(', ')}
    </p>
  );
}

export function MonthGrid({ win, byDay, today, onDay }) {
  return (
    <div className="ec-month">
      <div className="ec-mhead">
        {C.DOW.map(d => <span key={d} className="ec-mdow">{d}</span>)}
      </div>
      {win.weeks.map(week => (
        <div key={week[0]} className="ec-mrow">
          {week.map(iso => {
            const d = byDay[iso];
            const out = !C.inMonth(iso, win);
            return (
              <button
                key={iso}
                className={`ec-mcell${out ? ' ec-out' : ''}${iso === today ? ' ec-today' : ''}${d ? ' ec-has' : ''}`}
                onClick={() => onDay(iso)}
                title={C.dayLabel(iso)}
              >
                <span className="ec-mnum">{Number(iso.slice(8, 10))}</span>
                {d ? <span className="ec-mn">{d.n}</span> : null}
                {d ? (
                  <span className="ec-msyms">
                    {C.capCell(
                      [...d.bmo, ...d.amc, ...d.dmh, ...d.unk], 3
                    ).shown.map(r => <i key={r.symbol}>{r.symbol}</i>)}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function DetailPanel({ row, cur }) {
  if (!row) {
    return <p className="ec-detail-none">Pick a company above to see what was estimated and what came in.</p>;
  }
  const s = C.surpriseOf(row);
  // The bar is scaled against the estimate, not against the other companies on
  // screen — a surprise is a statement about one company's own expectation and
  // means nothing normalised across a week of unrelated businesses.
  const mag = s.state === 'ok' ? Math.min(100, Math.abs(s.pct)) : 0;
  return (
    <div className="ec-detail">
      <div className="ec-dhead">
        <b className="ec-dsym">{row.symbol}</b>
        <span className="ec-dq">{C.fmtQuarter(row)}</span>
        <span className="ec-dwhen">{C.dayLabel(row.date)} · {C.sessionMeta(row.session).label}</span>
      </div>
      <p className="ec-dnote">{C.sessionMeta(row.session).note}</p>
      <div className="ec-drow">
        {/* Decision D again: two columns, always both, never one that changes meaning. */}
        <div className="ec-dcol">
          <span className="ec-dlab">EPS estimate</span>
          <b className="ec-dv">{C.fmtEps(row.epsEst, cur)}</b>
        </div>
        <div className="ec-dcol">
          <span className="ec-dlab">EPS actual</span>
          <b className={`ec-dv${s.state === 'not_reported' ? ' ec-dv-none' : ''}`}>
            {s.state === 'not_reported' ? 'not reported yet' : C.fmtEps(row.epsAct, cur)}
          </b>
        </div>
        <div className="ec-dcol">
          <span className="ec-dlab">Revenue estimate</span>
          <b className="ec-dv">{C.fmtRev(row.revEst, cur)}</b>
        </div>
        <div className="ec-dcol">
          <span className="ec-dlab">Revenue actual</span>
          <b className={`ec-dv${row.revAct === null ? ' ec-dv-none' : ''}`}>
            {row.revAct === null ? 'not reported yet' : C.fmtRev(row.revAct, cur)}
          </b>
        </div>
      </div>
      <div className="ec-surp">
        {s.state === 'ok' ? (
          <>
            <span className={`ec-schip ${s.beat ? 'ec-up' : 'ec-down'}`}>
              {s.beat ? 'BEAT' : 'MISS'} {s.pct >= 0 ? '+' : '−'}{Math.abs(s.pct).toFixed(1)}%
            </span>
            <svg className="ec-sbar" viewBox="0 0 200 8" preserveAspectRatio="none" shapeRendering="crispEdges">
              <rect x="0" y="0" width="200" height="8" fill="var(--panel-2)" />
              <rect
                x={s.beat ? 100 : 100 - mag}
                y="0"
                width={mag}
                height="8"
                fill={s.beat ? 'var(--ok)' : 'var(--bad)'}
              />
              <line x1="100" x2="100" y1="0" y2="8" stroke="var(--ink-3)" strokeWidth="1" />
            </svg>
            <span className="ec-swork">
              {C.fmtEps(row.epsAct, cur)} against {C.fmtEps(row.epsEst, cur)} · {s.abs >= 0 ? '+' : '−'}{cur}{Math.abs(s.abs).toFixed(2)} a share
            </span>
          </>
        ) : (
          <span className="ec-sx">
            {s.state === 'not_reported' && 'No result has come in for this date, so there is no surprise to work out.'}
            {s.state === 'no_estimate' && 'No analyst estimate came back for this company, so the result cannot be compared to one.'}
            {s.state === 'base_zero' && `The estimate was exactly zero, so a percentage surprise has no meaning here. The absolute difference was ${cur}${Math.abs(s.abs).toFixed(2)} a share.`}
          </span>
        )}
      </div>
    </div>
  );
}

export default function EarningsCal({ held = [], watch = [], cur = '$' }) {
  const [scope, setScope] = useState('port');
  const [mode, setMode] = useState('week');
  const [off, setOff] = useState(0);
  const [raw, setRaw] = useState(null);
  const [status, setStatus] = useState(hasKey() ? 'load' : 'nokey');
  const [pick, setPick] = useState(null);

  const today = anchorToday();
  const port = useMemo(() => held.map(h => h.ticker).filter(Boolean), [held]);
  const wl = useMemo(() => watch.map(h => h.ticker || h).filter(Boolean), [watch]);

  const win = useMemo(
    () => (mode === 'week' ? C.weekWindow(today, off) : C.monthWindow(today, off)),
    [mode, off, today],
  );

  // Same reasoning as the financials screen: this is Finnhub's budget, not Twelve
  // Data's eight-a-minute price budget, and it is one call for the whole window
  // regardless of how many companies come back. So it may run on open, and
  // changing the scope costs nothing at all because scoping is done below.
  useEffect(() => {
    if (!win) return undefined;
    let dead = false;
    setStatus('load');
    fetchEarningsCalendar(win.from, win.to)
      .then(v => {
        if (dead) return;
        setRaw(v?.rows || []);
        setStatus(v?.status || 'error');
      })
      .catch(() => { if (!dead) { setRaw([]); setStatus('error'); } });
    return () => { dead = true; };
  }, [win?.from, win?.to]);

  const rows = useMemo(() => C.normalise(raw), [raw]);
  const scoped = useMemo(() => C.filterRows(rows, scope, port, wl), [rows, scope, port, wl]);
  const byDay = useMemo(() => C.groupByDay(scoped), [scoped]);

  // Decision A: the extra rows exist for the whole week if any day in it has one,
  // so the five columns keep the same shape and the eye can scan across.
  const showDmh = useMemo(() => scoped.some(r => r.session === 'dmh'), [scoped]);
  const showUnk = useMemo(() => scoped.some(r => r.session === 'unk'), [scoped]);

  const weekend = useMemo(() => C.weekendRows(scoped, win), [scoped, win]);
  const at = win ? calendarCachedAt(win.from, win.to) : null;

  if (!win) return <Card title="EARNINGS CALENDAR" color="cyan"><Empty icon="◷" text="No window." /></Card>;

  return (
    <Card
      title="EARNINGS CALENDAR"
      color="cyan"
      right={
        <div className="ec-mode">
          <button className={`ec-mode-btn${mode === 'week' ? ' on' : ''}`} onClick={() => { setMode('week'); setOff(0); }}>Week</button>
          <button className={`ec-mode-btn${mode === 'month' ? ' on' : ''}`} onClick={() => { setMode('month'); setOff(0); }}>Month</button>
        </div>
      }
    >
      <div className="ec-bar">
        <div className="ec-scope">
          {C.SCOPES.map(s => (
            <button
              key={s.key}
              className={`ec-scope-btn${scope === s.key ? ' on' : ''}`}
              onClick={() => setScope(s.key)}
              title={s.note}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="ec-nav">
          <button className="ec-arrow" onClick={() => setOff(o => o - 1)}>◄</button>
          <span className="ec-win">
            <b>{win.kind === 'week' ? `Week ${win.week}` : win.label}</b>
            <span className="ec-winsub">{win.kind === 'week' ? win.label : `${win.monthFrom} → ${win.monthTo}`}</span>
          </span>
          <button className="ec-arrow" onClick={() => setOff(o => o + 1)}>►</button>
          {off !== 0 && <button className="ec-now" onClick={() => setOff(0)}>today</button>}
        </div>
      </div>

      {status === 'load'
        ? <p className="ec-status">Asking the calendar for {win.from} → {win.to}…</p>
        : <StatusNote status={status} n={scoped.length} at={at} from={win.from} to={win.to} />}

      {scope !== 'all' && rows.length > 0 && scoped.length === 0 && (
        <p className="ec-scopenote">
          The feed listed {rows.length} {rows.length === 1 ? 'company' : 'companies'} in this window, none of them
          in your {C.scopeMeta(scope).label.toLowerCase()}. Switch to All stocks to see the rest.
        </p>
      )}

      {win.kind === 'week' ? (
        <>
          <div className="ec-grid">
            {win.grid.map(iso => (
              <DayColumn
                key={iso}
                iso={iso}
                day={byDay[iso]}
                today={today}
                pick={pick}
                onPick={setPick}
                cur={cur}
                showDmh={showDmh}
                showUnk={showUnk}
              />
            ))}
          </div>
          <WeekendNote rows={weekend} />
        </>
      ) : (
        <MonthGrid win={win} byDay={byDay} today={today} onDay={iso => {
          const d = byDay[iso];
          const all = d ? [...d.bmo, ...d.amc, ...d.dmh, ...d.unk] : [];
          if (all.length) setPick(all[0]);
        }} />
      )}

      <DetailPanel row={pick} cur={cur} />

      <p className="ec-disc">{C.EARN_DISCLAIMER}</p>
    </Card>
  );
}
