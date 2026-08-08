import React, { useEffect, useState } from 'react';
import { Card, StatTile, money } from './ui.jsx';
import { useCollection } from '../lib/hooks.js';
import { memGet } from '../lib/advisor.js';
import { remittanceSummary, REMIT_NOTE } from '../lib/indiabook.js';

// What investing from India actually costs.
//
// This card used to be built on a hand-maintained `money_fees` blob whose
// figures were typed in once from a trade report, and on the assumption that
// brokerage is the main cost. Two things are wrong with that, and together they
// made the app's headline fee number not merely stale but structurally wrong:
//
//   1. INDMONEY CHARGES NO PER-ORDER BROKERAGE ON US FRACTIONAL TRADES. Every
//      order value in the scanned ledger equals qty x price exactly. So summing
//      `o.fee` over the order tape yields zero, and a "total fees" of zero is
//      not a small error — it is the confident opposite of the truth.
//
//   2. THE REAL COST IS THE REMITTANCE. Converting rupees to dollars costs GST
//      plus whatever sits between the applied rate and the interbank rate. The
//      verified 06-Aug receipt was Rs 45 on Rs 1,600 — 2.81% — and that is a
//      floor, because the spread is not in it.
//
// So the card now reads the receipts in `stock_fees.remittances` and computes
// from them, falling back to the old blob only when no receipts exist, and
// saying which of the two it is using. A figure derived from documents and a
// figure typed in months ago should never look identical on screen.
//
// The markup stays UNKNOWN rather than estimated at "about 1%". Without a
// mid-market rate for the day of each transfer, the spread cannot be separated
// from the rate, and a plausible-looking guess in a cost readout is worse than
// an admission — you would plan around it.

export default function FeesCard({ orders, investedUsd, fx, visible, cur }) {
  const { items: mem } = useCollection('memory', { filter: 'key=eq.money_fees', order: 'key' });
  const mf = mem?.[0]?.value || {};
  const [remits, setRemits] = useState(null);
  const [interbank, setInterbank] = useState(null);
  const rate = fx || 96.5;

  useEffect(() => {
    let dead = false;
    Promise.all([
      memGet('stock_fees').catch(() => null),
      memGet('ind_meta').catch(() => null),
    ]).then(([sf, im]) => {
      if (dead) return;
      setRemits(Array.isArray(sf?.remittances) ? sf.remittances : []);
      setInterbank(im?.interbank ?? null);
    });
    return () => { dead = true; };
  }, []);

  const summary = remits && remits.length ? remittanceSummary(remits, interbank) : null;

  const brokerageUsd = (orders || []).reduce((s, o) => s + Number(o.fee || 0), 0);
  const brokerageInr = brokerageUsd * rate;

  // Real receipts win. The old blob is a fallback, and is labelled as one.
  const grounded = !!summary;
  const gstInr = grounded ? summary.rows.reduce((s, r) => s + r.taxInr, 0) : (mf.forex_gst_inr || 0);
  const markupInr = grounded
    ? (summary.floor ? null : summary.rows.reduce((s, r) => s + (r.spreadInr || 0), 0))
    : (mf.forex_markup_inr || 0);
  const remittedInr = grounded ? summary.inr : (mf.inr_invested || investedUsd * rate);
  const investedInr = mf.inr_invested || investedUsd * rate;

  const totalInr = brokerageInr + gstInr + (markupInr || 0);
  // The denominator is what was actually REMITTED when we have receipts, not
  // the whole book: a drag figure computed against money that never went
  // through a transfer understates it, sometimes by a lot.
  const base = grounded ? remittedInr : investedInr;
  const pct = base ? (totalInr / base) * 100 : 0;

  const inr = cur === 'inr';
  const D = v => (v == null ? '—' : money(inr ? v : v / rate, visible, inr ? '₹' : '$'));

  const floor = grounded && summary.floor;

  return (
    <Card
      title="Fees & forex — your real cost of investing"
      color="var(--red)"
      right={
        <span
          className="chip"
          style={{ color: pct > 2 ? 'var(--red)' : 'var(--yellow)', borderColor: pct > 2 ? 'var(--red)' : 'var(--yellow)' }}
          title={floor ? 'A floor — the exchange-rate spread is not included' : undefined}
        >
          {floor ? '≥ ' : ''}{pct.toFixed(2)}% drag
        </span>
      }
    >
      <div className="fees-hero">
        <div className="fees-hero-main">
          <span className="fees-hero-val">{floor ? '≥ ' : ''}{D(totalInr)}</span>
          <span className="fees-hero-sub">
            {grounded
              ? `on ${D(remittedInr)} remitted across ${summary.count} transfer${summary.count === 1 ? '' : 's'}`
              : `all-in cost on ${D(investedInr)} invested${mf.deposits ? ` · ${mf.deposits} deposits` : ''}`}
          </span>
        </div>
        <div className="fees-bar">
          <span className="fees-seg" style={{ flex: Math.max(brokerageInr, 1), background: 'var(--cyan)' }} title="Brokerage" />
          <span className="fees-seg" style={{ flex: Math.max(gstInr, 1), background: 'var(--orange)' }} title="Forex tax" />
          <span
            className="fees-seg"
            style={{
              flex: Math.max(markupInr || 1, 1),
              // Hatched rather than solid when unknown: the segment still has to
              // occupy space so the bar is not read as complete, but it must not
              // look like a measured quantity.
              background: markupInr == null
                ? 'repeating-linear-gradient(45deg, var(--ink-3) 0 3px, transparent 3px 6px)'
                : 'var(--pink)',
            }}
            title={markupInr == null ? 'FX spread — not known without a mid-market rate' : 'FX spread'}
          />
        </div>
      </div>

      <div className="tile-row" style={{ marginBottom: 10 }}>
        <StatTile
          label="Brokerage" value={D(brokerageInr)}
          note={brokerageUsd === 0 ? 'none charged on US fractional trades' : 'from the order tape'}
          color="var(--cyan)"
        />
        <StatTile
          label="Forex tax" value={D(gstInr)}
          note={grounded ? `exact · ${summary.count} receipt${summary.count === 1 ? '' : 's'}` : 'from the saved estimate'}
          color="var(--orange)"
        />
        <StatTile
          label="FX spread"
          value={markupInr == null ? '—' : D(markupInr)}
          note={markupInr == null ? 'not known — no mid-market rate saved' : 'measured against interbank'}
          color={markupInr == null ? 'var(--ink-3)' : 'var(--pink)'}
        />
      </div>

      <div className="small" style={{ color: 'var(--ink-2)', lineHeight: 1.55 }}>
        {grounded ? (
          <>
            {REMIT_NOTE}{' '}
            {summary.count === 1
              ? 'One receipt has been read so far, so this is what that transfer cost rather than a pattern.'
              : `Across ${summary.count} transfers the average was ${D(summary.avgTransfer)}.`}
            {floor && (
              <>
                {' '}The figure is a <b style={{ fontWeight: 'normal', color: 'var(--orange)' }}>floor</b>: it
                counts the tax you were charged but not the gap between the rate you
                got and the mid-market rate, which is not recorded anywhere yet. Save
                an interbank rate in <code>ind_meta</code> and the spread stops being
                a blank.
              </>
            )}
            {' '}Because the charge is levied per transfer, fewer and larger
            transfers cost proportionally less — the arithmetic for that sits on
            the India screen.
          </>
        ) : (
          <>
            No deposit receipts have been saved yet, so these figures come from the
            estimate stored in <code>money_fees</code> rather than from documents.
            Scan a wallet deposit into <code>stock_fees.remittances</code> and this
            card recomputes from the real numbers.
          </>
        )}
      </div>
    </Card>
  );
}
