import React, { useEffect, useState } from 'react';
import { Card, StatTile, money } from './ui.jsx';
import { useCollection } from '../lib/hooks.js';
import * as db from '../lib/db.js';

// Fees & forex breakdown. Brokerage is EXACT (summed from the order ledger, per
// INDmoney's 0.25%+GST policy). Forex has two parts: a flat ₹45 GST per deposit
// (verified) and a ~1% exchange-rate markup. Deposit count is editable so GST is
// exact the moment you confirm it.
export default function FeesCard({ orders, investedUsd, fx, visible, cur }) {
  const { items: mem, refresh } = useCollection('memory', { filter: 'key=eq.money_fees', order: 'key' });
  const cfg = mem?.[0]?.value || {};
  const [deposits, setDeposits] = useState('');
  const [markup, setMarkup] = useState('');
  useEffect(() => { if (cfg.deposits != null && deposits === '') setDeposits(String(cfg.deposits)); if (cfg.markup_pct != null && markup === '') setMarkup(String(cfg.markup_pct)); }, [mem]); // eslint-disable-line

  const rate = fx || 96;
  const depN = Number(deposits) || cfg.deposits || 100;
  const mkPct = Number(markup) || cfg.markup_pct || 1;

  // brokerage from ledger (buys + sells), already in USD
  const brokerageUsd = (orders || []).reduce((s, o) => s + Number(o.fee || 0), 0);
  const buyBrokUsd = (orders || []).reduce((s, o) => s + (o.side !== 'S' ? Number(o.fee || 0) : 0), 0);
  const gstUsd = (depN * 45) / rate;            // ₹45 per deposit → USD
  const markupUsd = investedUsd * (mkPct / 100); // % of invested
  const forexUsd = gstUsd + markupUsd;
  const totalUsd = brokerageUsd + forexUsd;
  const pct = investedUsd ? (totalUsd / investedUsd) * 100 : 0;

  const inr = cur === 'inr' && fx;
  const D = u => money(inr ? u * rate : u, visible, inr ? '₹' : '$');

  async function save() {
    await db.upsertMemory('money_fees', { deposits: depN, markup_pct: mkPct, ind_rate: rate, brokerage_usd: Math.round(brokerageUsd * 100) / 100, updated: new Date().toISOString() });
    refresh();
  }

  return (
    <Card title="Fees & forex — what investing actually costs you" color="var(--red)"
      right={<span className="chip" style={{ color: pct > 2 ? 'var(--red)' : 'var(--yellow)', borderColor: pct > 2 ? 'var(--red)' : 'var(--yellow)' }}>{pct.toFixed(1)}% of invested</span>}>
      <div className="tile-row" style={{ marginBottom: 10 }}>
        <StatTile label="Brokerage" value={D(brokerageUsd)} note="exact · 0.25%+GST" color="var(--cyan)" />
        <StatTile label="Forex GST" value={D(gstUsd)} note={`₹45 × ${depN} deposits`} color="var(--orange)" />
        <StatTile label="FX markup" value={D(markupUsd)} note={`~${mkPct}% on wallet loads`} color="var(--pink)" />
        <StatTile label="Total drag" value={D(totalUsd)} note="all-in cost" color="var(--red)" />
      </div>

      <div className="small" style={{ color: 'var(--ink-2)', lineHeight: 1.55 }}>
        Brokerage is exact (${brokerageUsd.toFixed(2)} across your {(orders || []).length} orders; ${buyBrokUsd.toFixed(2)} on buys). The bigger drain is <b style={{ fontWeight: 'normal', color: 'var(--orange)' }}>forex</b>: a flat <b style={{ fontWeight: 'normal' }}>₹45 GST on every deposit</b> regardless of size, plus ~{mkPct}% baked into INDmoney's exchange rate. Because you fund in tiny amounts, that flat GST dominates — <b style={{ fontWeight: 'normal', color: 'var(--green)' }}>batching bigger deposits</b> (₹15–20k instead of ₹1.6k) is the single biggest saving.
      </div>

      <div className="flex mt" style={{ flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <label className="small muted">Deposits since Jan 2025</label>
        <input style={{ width: 80 }} type="number" placeholder="~100" value={deposits} onChange={e => setDeposits(e.target.value)} />
        <label className="small muted">FX markup %</label>
        <input style={{ width: 70 }} type="number" step="0.1" placeholder="1" value={markup} onChange={e => setMarkup(e.target.value)} />
        <button className="btn btn-sm btn-green" onClick={save}>Save</button>
        <span className="small muted">Enter your exact deposit count → GST becomes exact.</span>
      </div>
    </Card>
  );
}
