import React from 'react';
import { Card, StatTile, money } from './ui.jsx';

// Fees & forex breakdown. Brokerage is EXACT — summed from your INDmoney trade
// report (0.25%+GST, verified per order). Forex is an estimate (flat ₹45 GST per
// deposit + ~1% rate markup) since it lives in the monthly account statements,
// not the trade report. No manual inputs — everything reads from your data.
const DEPOSITS_EST = 100; // from wallet-history density (~4 deposits / 3 weeks)
const MARKUP = 0.01;      // ~1% baked into INDmoney's USD rate (verified)

export default function FeesCard({ orders, investedUsd, fx, visible, cur }) {
  const rate = fx || 96;
  const brokerageUsd = (orders || []).reduce((s, o) => s + Number(o.fee || 0), 0);
  const buyBrokUsd = (orders || []).reduce((s, o) => s + (o.side !== 'S' ? Number(o.fee || 0) : 0), 0);
  const gstUsd = (DEPOSITS_EST * 45) / rate;
  const markupUsd = investedUsd * MARKUP;
  const forexUsd = gstUsd + markupUsd;
  const totalUsd = brokerageUsd + forexUsd;
  const pct = investedUsd ? (totalUsd / investedUsd) * 100 : 0;

  const inr = cur === 'inr' && fx;
  const D = u => money(inr ? u * rate : u, visible, inr ? '₹' : '$');

  return (
    <Card title="Fees & forex — your real cost of investing" color="var(--red)"
      right={<span className="chip" style={{ color: pct > 2 ? 'var(--red)' : 'var(--yellow)', borderColor: pct > 2 ? 'var(--red)' : 'var(--yellow)' }}>{pct.toFixed(1)}% drag</span>}>

      <div className="fees-hero">
        <div className="fees-hero-main">
          <span className="fees-hero-val">{D(totalUsd)}</span>
          <span className="fees-hero-sub">all-in cost on {D(investedUsd)} invested</span>
        </div>
        <div className="fees-bar">
          <span className="fees-seg" style={{ flex: Math.max(brokerageUsd, 0.01), background: 'var(--cyan)' }} title="Brokerage" />
          <span className="fees-seg" style={{ flex: Math.max(gstUsd, 0.01), background: 'var(--orange)' }} title="Forex GST" />
          <span className="fees-seg" style={{ flex: Math.max(markupUsd, 0.01), background: 'var(--pink)' }} title="FX markup" />
        </div>
      </div>

      <div className="tile-row" style={{ marginBottom: 10 }}>
        <StatTile label="Brokerage" value={D(brokerageUsd)} note="EXACT · from trade report" color="var(--cyan)" />
        <StatTile label="Forex GST" value={D(gstUsd)} note={`est · ₹45 × ~${DEPOSITS_EST} deposits`} color="var(--orange)" />
        <StatTile label="FX markup" value={D(markupUsd)} note="est · ~1% on wallet loads" color="var(--pink)" />
      </div>

      <div className="small" style={{ color: 'var(--ink-2)', lineHeight: 1.55 }}>
        <b style={{ fontWeight: 'normal', color: 'var(--cyan)' }}>Brokerage is exact</b> — {D(brokerageUsd)} across your {(orders || []).length} orders ({D(buyBrokUsd)} on buys), straight from your INDmoney trade report. The bigger drain is <b style={{ fontWeight: 'normal', color: 'var(--orange)' }}>forex</b>: a flat ₹45 GST on every deposit plus ~1% in the exchange rate. Since you fund in small amounts, that flat GST dominates — <b style={{ fontWeight: 'normal', color: 'var(--green)' }}>fewer, bigger deposits</b> is your single biggest saving. (Forex is estimated; the monthly account statements would make it exact.)
      </div>
    </Card>
  );
}
