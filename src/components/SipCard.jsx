import React from 'react';
import { Card, Empty, StatTile } from './ui.jsx';
import { useCollection } from '../lib/hooks.js';
import { splitSips, sipRunRate, sipStateOf } from '../lib/indiabook.js';

// The US side of memory.sips.
//
// Two things were wrong here and they compounded. The card read every SIP in
// the blob, so the Indian GOLDBEES plan appeared on the US screen while QQQ
// appeared on the India one — each plan showing up on the wrong desk. And it
// read a legacy row shape (`amount_usd`, `fund`) that the current scan does not
// write, so every figure it did show came out as $NaN.
//
// Both are fixed by going through indiabook: `splitSips` decides the desk from
// the ASSET currency rather than the funding currency, and `sipRunRate` reads
// the amount the scan actually records.
//
// The amounts stay in rupees on purpose. INDmoney debits ₹500 and remits it —
// the dollar figure it buys is whatever the rate happens to be that morning, so
// printing a dollar amount here would invent a precision the plan does not have.
const fmtDate = iso => {
  try { return new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' }); }
  catch { return iso; }
};
const inr = n => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;

export default function SipCard() {
  const { items: mem } = useCollection('memory', { filter: 'key=eq.sips', order: 'key' });
  const all = mem?.[0]?.value?.list || [];
  const us = splitSips(all).us.filter(s => s.active !== false && sipStateOf(s.status).key !== 'failed');
  const rates = us.map(s => ({ sip: s, rate: sipRunRate(s) })).filter(x => x.rate);

  const perMonth = rates.reduce((n, x) => n + x.rate.perMonth, 0);
  const runsPerYear = rates.reduce((n, x) => n + x.rate.freq.runsPerYear, 0);

  return (
    <Card title="US SIPs" color="var(--cyan)"
      right={us.length ? <span className="chip c-cyan">{us.length} running</span> : null}>
      {us.length === 0 && (
        <Empty icon="↻" text="No US SIPs recorded. INDmoney's web UI has no SIP page for US stocks — these come from an app scan." />
      )}
      {us.length > 0 && (
        <>
          <div className="tile-row" style={{ marginBottom: 10 }}>
            <StatTile label="Per month" value={inr(perMonth)} note="across all plans" color="var(--cyan)" />
            <StatTile label="Debits a year" value={runsPerYear} note="separate transfers" color="var(--orange)" />
            <StatTile label="Plans" value={us.length} note="active" color="var(--pink)" />
          </div>
          {rates.map(({ sip: s, rate }) => (
            <div className="row" key={s.id || s.ticker}>
              <span className="chip c-cyan" style={{ minWidth: 52, textAlign: 'center' }}>{s.ticker}</span>
              <span style={{ flex: 1 }}>
                {s.name || s.ticker}
                <span className="muted small"> · {rate.freq.label.toLowerCase()}{s.next ? ` · next ${fmtDate(s.next)}` : ''}</span>
              </span>
              <span className="chip c-green">{inr(rate.perRun)}/run</span>
              <span className="chip">{inr(rate.perMonth)}/mo</span>
            </div>
          ))}
          {/* Every one of these debits is its own INR→USD remittance, which is
              where the entire cost of investing from India sits. The India desk
              carries the arithmetic; this is the pointer to it. */}
          <p className="muted small" style={{ marginTop: 8 }}>
            Each debit is a separate rupee transfer. What that costs is worked out
            under Money → India.
          </p>
        </>
      )}
    </Card>
  );
}
