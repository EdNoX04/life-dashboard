import React, { useEffect, useMemo, useState } from 'react';
import { Card, Empty, StatTile, money, useMoneyVisible, EyeBtn } from '../ui.jsx';
import {
  STATUS, hasKey, loadCached, byYear, cagr, growthStreak, ttm,
  receivedHistory, receivedTotals, holdingPeriod, projectForward, runRate,
} from '../../lib/divdata.js';

// Payment history — the company's record, and yours.
//
// Those are two different things and the screen keeps them apart, because
// conflating them is the easiest way to be confidently wrong about income:
//
//   THE COMPANY'S RECORD is dividend per share by year. It is a fact about the
//   business and does not care what you own.
//
//   YOURS is every payment valued at the shares you actually held on its
//   EX-DATE — not today's holding. Using today's count credits you for shares
//   you had not bought yet, which is flattering and false. Payments that
//   predate your first purchase are shown as missed rather than as zeros,
//   because a zero here looks like the company skipped a payment.
//
// The forward section is estimates only and says so on every row. It projects
// the latest declared rate at the observed cadence onto your CURRENT holding,
// because the current count is the only one the future has.

const pct = (v, dp = 1) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(dp)}%`);
const tone = v => (v == null ? 'var(--ink-3)' : v > 0 ? 'var(--green)' : v < 0 ? 'var(--red)' : 'var(--ink-2)');

function YearBars({ years, cur, visible }) {
  const max = years.reduce((m, y) => Math.max(m, y.total), 0) || 1;
  return (
    <div className="ph-bars">
      {years.map(y => (
        <div className="ph-bar" key={y.year} title={`${y.year}: ${y.count} payment${y.count === 1 ? '' : 's'}`}>
          <span className="ph-bar-v">{y.total.toFixed(2)}</span>
          <span className="ph-bar-track">
            {/* A partial year is hatched, not shortened silently. The bar is
                honestly shorter because less was paid, and the hatching says
                the year is not over — without it, a company four payments into
                the year reads as having halved its dividend. */}
            <i
              style={{
                height: `${(y.total / max) * 100}%`,
                background: y.partial
                  ? 'repeating-linear-gradient(45deg, var(--ink-3) 0 3px, transparent 3px 6px)'
                  : 'var(--green)',
                borderTop: y.partial ? '1px solid var(--ink-3)' : 'none',
              }}
            />
          </span>
          <span className="ph-bar-y">{String(y.year).slice(2)}</span>
          <span className="ph-bar-yoy" style={{ color: tone(y.yoy) }}>
            {y.partial ? 'part' : pct(y.yoy, 0)}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function PaymentHistory({ held = [], orders = [], cur = '$' }) {
  const [store, setStore] = useState(null);
  const [ticker, setTicker] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [visible, toggleVisible] = useMoneyVisible();

  useEffect(() => {
    let dead = false;
    loadCached().then(s => { if (!dead) setStore(s || {}); });
    return () => { dead = true; };
  }, []);

  const payers = useMemo(() => {
    if (!store) return [];
    return held
      .map(h => String(h.ticker || '').toUpperCase())
      .filter(t => store[t]?.status === STATUS.ok && store[t].rows?.length)
      .sort();
  }, [held, store]);

  const active = ticker && payers.includes(ticker) ? ticker : payers[0] || '';
  const rows = store?.[active]?.rows || [];

  const years = useMemo(() => byYear(rows), [rows]);
  const c5 = useMemo(() => cagr(years, 5), [years]);
  const c10 = useMemo(() => cagr(years, 10), [years]);
  const streak = useMemo(() => growthStreak(years), [years]);
  const t = useMemo(() => ttm(rows), [rows]);
  const rate = useMemo(() => runRate(rows), [rows]);

  const holding = held.find(h => String(h.ticker).toUpperCase() === active);
  const shares = Number(holding?.qty) || 0;
  const period = useMemo(() => holdingPeriod(orders, active), [orders, active]);
  const received = useMemo(() => receivedHistory(rows, orders, active), [rows, orders, active]);
  const totals = useMemo(() => receivedTotals(received), [received]);
  const forward = useMemo(() => projectForward(rows, shares, { count: 4 }), [rows, shares]);

  if (store === null) {
    return <Card title="Payment history" color="var(--green)"><Empty icon="◷" text="Loading…" /></Card>;
  }
  if (!payers.length) {
    return (
      <Card title="Payment history" color="var(--green)">
        <Empty
          icon="%"
          text={hasKey()
            ? 'No dividend history fetched yet. Money → Income → Data fetches it for your holdings.'
            : 'No Financial Modeling Prep key saved. Add one in Settings and fetch on the Data screen.'}
        />
      </Card>
    );
  }

  const shown = showAll ? received : received.slice(0, 5);

  return (
    <>
      <div className="tile-row">
        <StatTile
          label="Received" color="var(--green)"
          value={money(totals.total, visible, cur)}
          note={`${totals.payments} payment${totals.payments === 1 ? '' : 's'}${totals.missed ? ` · ${totals.missed} before you owned it` : ''}`}
        />
        <StatTile
          label="Held for" color="var(--cyan)"
          value={period ? (period.years >= 1 ? `${period.years.toFixed(1)}y` : `${period.days}d`) : '—'}
          note={period ? `${period.open ? 'since' : 'from'} ${period.first}${period.open ? '' : ` to ${period.end}`}` : 'no orders on file'}
        />
        <StatTile
          label="5Y growth" color={tone(c5?.pct)}
          value={c5 ? pct(c5.pct) : '—'}
          // Says what it measured, not what was asked for.
          note={c5 ? `CAGR ${c5.from}–${c5.to}${c5.short ? ` · only ${c5.years}y on record` : ''}` : 'not enough complete years'}
        />
        <StatTile
          label="Raised" color={streak.years > 0 ? 'var(--green)' : 'var(--ink-3)'}
          value={streak.years ? `${streak.years}y` : '—'}
          note={streak.cut ? 'last complete year was a cut' : streak.years ? 'consecutive complete years' : 'no current streak'}
        />
      </div>

      <Card
        title="Payment history"
        color="var(--green)"
        right={
          <span className="flex" style={{ gap: 6 }}>
            <select value={active} onChange={e => setTicker(e.target.value)} style={{ width: 110 }}>
              {payers.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <EyeBtn visible={visible} onClick={toggleVisible} />
          </span>
        }
      >
        <p className="ph-lead">
          Dividend per share by year — the company&#39;s record, whatever you own.
          Hatched bars are years that are not over.
        </p>
        <YearBars years={years} cur={cur} visible={visible} />

        <div className="ph-facts">
          <span>TTM <b>{cur}{t.total.toFixed(2)}</b>{!t.complete && <i className="ph-part"> part-year</i>}</span>
          {rate?.perYear && <span>Forward <b>{cur}{rate.perYear.toFixed(2)}</b> <i>{rate.cadence}</i></span>}
          {c10 && <span>{c10.short ? `${c10.years}Y` : '10Y'} CAGR <b style={{ color: tone(c10.pct) }}>{pct(c10.pct)}</b></span>}
        </div>
      </Card>

      <Card
        title={`What you received — ${active}`}
        color="var(--cyan)"
        right={received.length > 5 && (
          <button className="btn btn-sm" onClick={() => setShowAll(!showAll)}>
            {showAll ? 'LATEST 5' : `ALL ${received.length}`}
          </button>
        )}
      >
        {/* The distinction the whole screen exists for. */}
        <p className="ph-lead">
          Each payment valued at the shares you held on its <b>ex-date</b> — not at
          today&#39;s holding, which would credit you for shares you had not bought
          yet. Payments before your first purchase are marked, not zeroed.
        </p>
        <div className="ph-rows">
          <div className="ph-row ph-head">
            <span>Ex-date</span><span>Paid</span><span>Per share</span><span>Shares</span><span>Received</span>
          </div>
          {shown.map(r => (
            <div className={`ph-row${r.held ? '' : ' ph-missed'}`} key={r.ex}>
              <span>{r.ex}</span>
              <span>
                {r.pay}
                {r.payEstimated && <i className="ph-est" title="Pay date not published — the ex-date is shown instead">est</i>}
              </span>
              <span>{cur}{r.amount.toFixed(4)}</span>
              <span>{r.held ? r.shares.toLocaleString(undefined, { maximumFractionDigits: 4 }) : '—'}</span>
              <span>
                {r.held
                  ? money(r.amount_received, visible, cur)
                  : <em className="ph-nope">not held yet</em>}
              </span>
            </div>
          ))}
        </div>
        {!showAll && received.length > 5 && (
          <p className="ph-foot">Latest 5 of {received.length}.</p>
        )}
      </Card>

      <Card title="What comes next" color="var(--purple)">
        {forward.length === 0 ? (
          <Empty icon="→" text="Not enough payment history to infer a schedule." />
        ) : (
          <>
            <p className="ph-lead">
              The declared rate repeated at the observed cadence, on the{' '}
              {shares.toLocaleString(undefined, { maximumFractionDigits: 4 })} share
              {shares === 1 ? '' : 's'} you hold now. Every row is an estimate — the
              company has not declared these.
            </p>
            <div className="ph-rows">
              <div className="ph-row ph-head">
                <span>Ex-date</span><span>Pay date</span><span>Per share</span><span>Shares</span><span>Estimated</span>
              </div>
              {forward.map(f => (
                <div className="ph-row ph-fwd" key={f.pay}>
                  <span>{f.ex}</span>
                  <span>{f.pay}</span>
                  <span>{cur}{f.perShare.toFixed(4)}</span>
                  <span>{f.shares.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>
                  <span>{money(f.amount, visible, cur)}<i className="ph-est">est</i></span>
                </div>
              ))}
            </div>
            <p className="ph-foot">
              Next twelve months at this rate:{' '}
              <b>{money(forward.reduce((s, f) => s + f.amount, 0), visible, cur)}</b>.
              A raise, a cut or a change of schedule all move it, and none of them
              announce themselves in advance.
            </p>
          </>
        )}
      </Card>
    </>
  );
}
