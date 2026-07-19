import React from 'react';
import { Card, StatTile, money } from './ui.jsx';
import { useCollection } from '../lib/hooks.js';

// Fees & forex — now grounded in real documents:
//   Brokerage: EXACT, summed from your INDmoney trade report ($18.40).
//   Forex GST: EXACT, computed from your actual Federal Bank deposit amounts.
//   Rate markup: ~1% (the one remaining estimate).
export default function FeesCard({ orders, investedUsd, fx, visible, cur }) {
  const { items: mem } = useCollection('memory', { filter: 'key=eq.money_fees', order: 'key' });
  const mf = mem?.[0]?.value || {};
  const rate = fx || 96.5;

  const brokerageUsd = (orders || []).reduce((s, o) => s + Number(o.fee || 0), 0) || (mf.brokerage_usd || 0);
  const buyBrokUsd = (orders || []).reduce((s, o) => s + (o.side !== 'S' ? Number(o.fee || 0) : 0), 0) || (mf.brokerage_buys_usd || 0);

  // everything in INR internally (forex figures are INR-native)
  const brokerageInr = brokerageUsd * rate;
  const gstInr = mf.forex_gst_inr || 0;
  const markupInr = mf.forex_markup_inr || 0;
  const investedInr = mf.inr_invested || investedUsd * rate;
  const totalInr = brokerageInr + gstInr + markupInr;
  const pct = investedInr ? (totalInr / investedInr) * 100 : 0;
  const deposits = mf.deposits;

  // D() shows an INR amount in the currently-selected currency
  const inr = cur === 'inr';
  const D = v => money(inr ? v : v / rate, visible, inr ? '₹' : '$');

  return (
    <Card title="Fees & forex — your real cost of investing" color="var(--red)"
      right={<span className="chip" style={{ color: pct > 2 ? 'var(--red)' : 'var(--yellow)', borderColor: pct > 2 ? 'var(--red)' : 'var(--yellow)' }}>{pct.toFixed(2)}% drag</span>}>

      <div className="fees-hero">
        <div className="fees-hero-main">
          <span className="fees-hero-val">{D(totalInr)}</span>
          <span className="fees-hero-sub">all-in cost on {D(investedInr)} invested{deposits ? ` · ${deposits} deposits` : ''}</span>
        </div>
        <div className="fees-bar">
          <span className="fees-seg" style={{ flex: Math.max(brokerageInr, 1), background: 'var(--cyan)' }} title="Brokerage" />
          <span className="fees-seg" style={{ flex: Math.max(gstInr, 1), background: 'var(--orange)' }} title="Forex GST" />
          <span className="fees-seg" style={{ flex: Math.max(markupInr, 1), background: 'var(--pink)' }} title="FX markup" />
        </div>
      </div>

      <div className="tile-row" style={{ marginBottom: 10 }}>
        <StatTile label="Brokerage" value={D(brokerageInr)} note="EXACT · trade report" color="var(--cyan)" />
        <StatTile label="Forex GST" value={D(gstInr)} note="EXACT · from deposits" color="var(--orange)" />
        <StatTile label="FX markup" value={D(markupInr)} note="est · ~1% on wallet loads" color="var(--pink)" />
      </div>

      <div className="small" style={{ color: 'var(--ink-2)', lineHeight: 1.55 }}>
        Two of three are now <b style={{ fontWeight: 'normal', color: 'var(--cyan)' }}>exact from your documents</b>: brokerage ({D(brokerageInr)}, {D(buyBrokUsd * rate)} on buys) from your INDmoney trade report, and forex GST ({D(gstInr)}) computed from your real Federal Bank deposit amounts. Only the ~1% rate markup is still estimated. Your big lump-sum deposits (₹99k, ₹73k, ₹60k) were far more forex-efficient than the small ones — <b style={{ fontWeight: 'normal', color: 'var(--green)' }}>fewer, bigger deposits</b> is exactly how you keep this ~1.5% drag from creeping up.
      </div>
    </Card>
  );
}
