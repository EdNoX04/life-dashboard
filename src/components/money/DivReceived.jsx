import React, { useEffect, useMemo, useState } from 'react';
import { Card, Empty, StatTile } from '../ui.jsx';
import { memGet } from '../../lib/advisor.js';

// What was actually received.
//
// Every other dividend screen in this app projects: it takes a rate, multiplies
// by a frequency, and tells you what a year would look like if nothing changed.
// That is useful and it is not the same question as "what has this portfolio
// actually paid me", which until now had no answer anywhere.
//
// The figures come from INDmoney's own Tax Centre rather than from a market-data
// API, and the difference matters more than it sounds. A generic per-share
// history would have to be multiplied by the share count held on each ex-date —
// and this portfolio's share count changed with every weekly SIP run. Getting
// that reconstruction slightly wrong produces a number that looks precise and
// is not. The broker already knows the answer exactly, because it credited the
// money.
//
// Two things are stated rather than smoothed over:
//
//   GROSS, NOT NET. The US withholds 25% on dividends paid to Indian residents.
//   Showing gross alone overstates what reached the account; showing net alone
//   hides a tax you can partly reclaim under the DTAA. Both are shown, and the
//   withheld figure is labelled as the thing it is.
//
//   ANNUAL TOTALS, NOT A LEDGER. INDmoney holds the payment-by-payment detail
//   one click deeper per security. This screen answers "how much" precisely and
//   "when" not at all, and says so instead of implying a calendar it does not
//   have.

const inr = n => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function DivReceived({ fx = null }) {
  const [data, setData] = useState(undefined);
  const [showClosed, setShowClosed] = useState(false);

  useEffect(() => {
    let dead = false;
    memGet('div_received')
      .then(v => { if (!dead) setData(v && v.rows ? v : null); })
      .catch(() => { if (!dead) setData(null); });
    return () => { dead = true; };
  }, []);

  const rows = useMemo(() => {
    if (!data?.rows) return [];
    return data.rows.filter(r => showClosed || r.still_held);
  }, [data, showClosed]);

  const closedCount = data?.rows?.filter(r => !r.still_held).length || 0;
  const shownTotal = rows.reduce((s, r) => s + Number(r.gross_inr || 0), 0);

  if (data === undefined) {
    return <Card title="Dividends received" color="var(--green)"><Empty icon="◷" text="Loading…" /></Card>;
  }
  if (!data) {
    return (
      <Card title="Dividends received" color="var(--green)">
        <Empty
          icon="₹"
          text="Nothing recorded yet. This screen reads what INDmoney's Tax Centre says was actually credited — apply payloads/dividends-received-*.json and it fills in."
        />
      </Card>
    );
  }

  const withheld = data.total_gross_inr - data.net_inr;

  return (
    <>
      <div className="tile-row">
        <StatTile
          label="Received (gross)" value={inr(data.total_gross_inr)}
          note={fx > 0 ? `≈ $${(data.total_gross_inr / fx).toFixed(2)}` : 'before US tax'}
          color="var(--green)"
        />
        <StatTile
          label="US tax withheld" value={inr(withheld)}
          note={`${data.withholding_pct}% — partly reclaimable under the DTAA`}
          color="var(--red)"
        />
        <StatTile
          label="Reached the account" value={inr(data.net_inr)}
          note="what actually landed" color="var(--cyan)"
        />
        <StatTile
          label="Paying holdings" value={data.rows.filter(r => r.still_held).length}
          note={closedCount ? `${closedCount} more since sold` : 'all still held'}
          color="var(--pink)"
        />
      </div>

      <Card
        title="Dividends received"
        color="var(--green)"
        right={closedCount > 0 && (
          <button className="btn btn-sm" onClick={() => setShowClosed(s => !s)}>
            {showClosed ? 'HELD ONLY' : `+ ${closedCount} SOLD`}
          </button>
        )}
      >
        <p className="dr-lead">
          What this portfolio has actually paid you, from INDmoney&#39;s Tax Centre —
          not a projection. Figures are <strong>gross</strong>, in rupees, before the{' '}
          {data.withholding_pct}% US withholding.
        </p>

        <div className="dr-rows">
          <div className="dr-row dr-head">
            <span>Security</span><span>Total</span>
            {Object.keys(data.years || {}).map(y => <span key={y}>{y}</span>)}
          </div>
          {rows.map(r => (
            <div className={`dr-row${r.still_held ? '' : ' dr-sold'}`} key={r.ticker}>
              <span className="dr-t">
                {r.ticker}
                <i className="dr-name">{r.name}</i>
              </span>
              <span className="dr-amt">
                {inr(r.gross_inr)}
                {/* Share of the total, so the two names carrying most of the
                    income are visible without adding a column. */}
                <i className="dr-share">
                  {((r.gross_inr / data.total_gross_inr) * 100).toFixed(1)}%
                </i>
              </span>
              {Object.keys(data.years || {}).map(y => (
                <span key={y} className="dr-year">
                  {r.by_year?.[y] ? inr(r.by_year[y]) : <span className="muted">—</span>}
                </span>
              ))}
            </div>
          ))}
          <div className="dr-row dr-total">
            <span>{showClosed ? 'TOTAL' : 'SHOWN'}</span>
            <span className="dr-amt">{inr(shownTotal)}</span>
            {Object.entries(data.years || {}).map(([y, v]) => (
              <span key={y} className="dr-year">{showClosed ? inr(v) : ''}</span>
            ))}
          </div>
        </div>

        {/* The limit of this data, stated where it is relevant rather than in a
            footnote nobody reads. */}
        <p className="dr-caveat">{data.caveat}</p>
        <p className="dr-src">
          {data.source}. {data.closed_positions}
        </p>
      </Card>
    </>
  );
}
