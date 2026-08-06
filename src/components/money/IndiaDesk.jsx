// The Indian desk: the INDstocks account, its SIP, and the true cost of moving
// money to the US side.
//
// It is a separate screen rather than a filter on the portfolio screen because
// the two accounts do not answer the same question. The US book is where the
// money is; the Indian book is where the money enters, and almost everything
// interesting about it — the SIP cadence, the remittance drag, the wallet
// balance sitting idle — is about flow rather than about holdings. A ₹367
// position filtered out of a $6,178 portfolio would be a rounding error on the
// portfolio screen and would never be looked at again.
//
// Three rendering decisions:
//
//   1. THE CADENCE DISAGREEMENT IS THE FIRST THING ON THE SCREEN, above the
//      holdings and above the totals. It is the one fact here that contradicts
//      something the reader believes, and a correction placed after the numbers
//      arrives too late to change how the numbers were read.
//
//   2. NATIVE FIGURES ARE NEVER CONVERTED IN THE HOLDINGS TABLE. This screen is
//      what you hold next to the broker's screen when reconciling, so ₹117.62
//      has to read ₹117.62. The converted figure appears once, in the combined
//      total, and is labelled as converted.
//
//   3. THE FEE PANEL LEADS WITH WHAT IS NOT CHARGED. "No per-order brokerage"
//      is counter-intuitive enough that stating it first is what stops the
//      reader hunting the order ledger for a cost that is not in it.

import React, { useMemo, useState } from 'react';
import { Card, StatTile, Empty, useMoneyVisible, EyeBtn, money } from '../ui.jsx';
import {
  nativeTotals, mixedTotals, symbolOf, currencyOf, num,
  sipRunRate, sipStateOf, sipDisagreement,
  remittanceSummary, batchingGain, REMIT_NOTE, DISCLAIMER,
} from '../../lib/indiabook.js';

const pct = v => (v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`);
const gain = v => (v == null ? 'var(--ink-3)' : v >= 0 ? 'var(--green)' : 'var(--red)');
const inrFmt = n => (n == null ? '—' : `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);

// ------------------------------------------------------------- cadence flag

export function CadenceFlag({ dis, sip }) {
  if (!dis) return null;
  const rate = sipRunRate(sip);
  return (
    <div className="ind-flag">
      <span className="ind-flag-tag">⚠ CADENCE</span>
      <div className="ind-flag-body">
        <p className="ind-flag-txt">{dis.text}</p>
        {rate && (
          <p className="ind-flag-sub">
            At {inrFmt(rate.perRun)} a run that is {inrFmt(Math.round(rate.perMonth))}/month
            {' '}({inrFmt(Math.round(rate.perYear))}/year), not the{' '}
            {inrFmt(Math.round((rate.perRun * dis.believed.runsPerYear) / 12))}/month a{' '}
            {dis.believed.label.toLowerCase()} plan would be.
          </p>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------- SIP row

export function SipRow({ sip }) {
  const rate = sipRunRate(sip);
  const st = sipStateOf(sip.status);
  return (
    <div className="ind-sip" style={{ borderLeftColor: st.color }}>
      <span className="ind-sip-t">{sip.ticker}</span>
      <span className="ind-sip-mid">
        <span className="ind-sip-name">{sip.name || sip.ticker}</span>
        <span className="ind-sip-meta">
          {inrFmt(sip.amount)} · {rate ? rate.freq.label.toLowerCase() : String(sip.freq || '?')}
          {sip.next ? ` · next ${sip.next}` : ''}
        </span>
      </span>
      <span className="ind-sip-rate">
        {rate ? `${inrFmt(Math.round(rate.perMonth))}/mo` : '—'}
      </span>
      <span className="ind-sip-state" style={{ color: st.color, borderColor: st.color }}>{st.label}</span>
    </div>
  );
}

// ------------------------------------------------------------ fees panel

export function RemitPanel({ summary, gainAt }) {
  if (!summary) {
    return <Empty icon="₹" text="No remittances recorded yet. A scan of your deposit receipts lands here." />;
  }
  return (
    <>
      {/* Decision 3: the absence comes first. */}
      <p className="ind-remit-lead">{REMIT_NOTE}</p>
      <div className="tile-row">
        <StatTile
          label="Cost of investing" color={summary.dragPct > 2 ? 'var(--red)' : 'var(--yellow)'}
          value={`${summary.dragPct.toFixed(2)}%`}
          note={summary.floor ? 'tax only — spread unknown' : 'tax + FX spread'}
        />
        <StatTile label="Sent" value={inrFmt(summary.inr)} note={`${summary.count} transfer${summary.count === 1 ? '' : 's'}`} color="var(--cyan)" />
        <StatTile label="Paid in cost" value={inrFmt(Math.round(summary.totalInr))} note="not in your trade history" color="var(--orange)" />
        <StatTile label="Avg transfer" value={inrFmt(Math.round(summary.avgTransfer))} color="var(--ink-2)" />
      </div>

      <div className="ind-remit-rows">
        {summary.rows.map((r, i) => (
          <div className="ind-remit" key={r.txn || i}>
            <span className="ind-remit-d">{r.date || '—'}</span>
            <span className="ind-remit-a">{inrFmt(r.inr)} → ${r.usd.toFixed(2)}</span>
            <span className="ind-remit-r">@ {r.appliedRate.toFixed(2)}</span>
            <span className="ind-remit-g">GST {inrFmt(r.gst)}</span>
            <span className="ind-remit-p" style={{ color: r.dragPct > 2 ? 'var(--red)' : 'var(--yellow)' }}>
              {r.dragPct.toFixed(2)}%
            </span>
          </div>
        ))}
      </div>

      {gainAt && (
        <p className="ind-remit-fix">
          The tax is flat per transfer, so the drag shrinks as the transfer grows:
          batching to {inrFmt(gainAt.targetInr)} takes it from {gainAt.fromPct.toFixed(2)}%
          to {gainAt.toPct.toFixed(2)}% — {gainAt.savedPctPoints.toFixed(2)} points back,
          for nothing but doing it less often.
        </p>
      )}
    </>
  );
}

// ------------------------------------------------------------------ screen

export default function IndiaDesk({
  rows = [],
  priceOf = h => Number(h.last_price ?? h.avg_cost ?? 0),
  sips = [],
  remittances = [],
  wallet = null,
  believedFreq = null,
  interbank = null,
  fx = null,
  scanned = null,
}) {
  const [visible, toggleVisible] = useMoneyVisible();
  const [showAll, setShowAll] = useState(false);

  const indian = useMemo(() => rows.filter(r => currencyOf(r) === 'INR'), [rows]);
  const groups = useMemo(() => nativeTotals(indian, priceOf), [indian, priceOf]);
  const g = groups[0] || null;
  const combined = useMemo(() => mixedTotals(rows, priceOf, { fx }), [rows, priceOf, fx]);

  const remit = useMemo(() => remittanceSummary(remittances, interbank), [remittances, interbank]);
  const gainAt = useMemo(() => batchingGain(remit, 25000), [remit]);

  const live = sips.filter(s => sipStateOf(s.status).key !== 'failed');
  const shown = showAll ? sips : live;
  const dis = useMemo(() => {
    if (!believedFreq) return null;
    for (const s of live) {
      const d = sipDisagreement(s, believedFreq);
      if (d) return { d, sip: s };
    }
    return null;
  }, [live, believedFreq]);

  return (
    <div className="ind-wrap">
      <p className="ind-disclaimer">
        {DISCLAIMER}{scanned ? ` Scanned ${scanned}.` : ''}
      </p>

      {/* Decision 1: above everything. */}
      {dis && <CadenceFlag dis={dis.d} sip={dis.sip} />}

      <Card
        title="INDstocks — Indian holdings"
        color="var(--orange)"
        right={<EyeBtn visible={visible} onClick={toggleVisible} />}
      >
        {!g ? (
          <Empty icon="₹" text="No rupee-denominated holdings recorded yet." />
        ) : (
          <>
            <div className="tile-row">
              <StatTile label="Value" value={money(g.value, visible, '₹')} color="var(--cyan)" />
              <StatTile
                label="Invested" color="var(--ink-2)"
                value={g.cost == null ? '—' : money(g.cost, visible, '₹')}
                note={g.cost == null ? 'not recorded' : null}
              />
              <StatTile
                label="Unrealised" color={gain(g.unrealised)}
                value={g.unrealised == null ? '—' : money(g.unrealised, visible, '₹')}
                note={pct(g.unrealisedPct)}
              />
              <StatTile
                label="Wallet" color={num(wallet) ? 'var(--yellow)' : 'var(--ink-3)'}
                value={wallet == null ? '—' : money(wallet, visible, '₹')}
                note={num(wallet) ? 'idle cash' : null}
              />
            </div>

            {/* Decision 2: unconverted. */}
            <div className="ind-holds">
              <div className="ind-hold ind-hold-head">
                <span>Ticker</span><span>Qty</span><span>Avg</span><span>Price</span><span>Value</span><span>Ret</span>
              </div>
              {g.rows.map(h => {
                const q = num(h.qty) || 0;
                const p = num(priceOf(h)) || 0;
                const ac = num(h.avg_cost);
                const r = ac ? ((p - ac) / ac) * 100 : null;
                return (
                  <div className="ind-hold" key={h.ticker}>
                    <span className="ind-hold-t">{h.ticker}</span>
                    <span>{q}</span>
                    <span>{ac == null ? '—' : inrFmt(ac)}</span>
                    <span>{inrFmt(p)}</span>
                    <span>{money(q * p, visible, '₹')}</span>
                    <span style={{ color: gain(r) }}>{pct(r)}</span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </Card>

      <Card title="SIPs" color="var(--green)" right={
        sips.length ? <span className="chip c-green">{live.length} live</span> : null
      }>
        {sips.length === 0
          ? <Empty icon="↻" text="No SIPs recorded. A scan of your broker's SIP tab lands here." />
          : (
            <>
              {shown.map((s, i) => <SipRow key={s.id || s.ticker + i} sip={s} />)}
              {sips.length > live.length && (
                <button className="btn btn-sm" onClick={() => setShowAll(!showAll)}>
                  {showAll
                    ? 'HIDE FAILED'
                    : `SHOW ${sips.length - live.length} FAILED`}
                </button>
              )}
              {/* A US SIP set in the app is invisible to the web UI, so the
                  screen says so rather than letting an empty US section read as
                  "you have no US SIP". */}
              <p className="ind-sip-note">
                Only the Indian broker exposes a SIP schedule on the web. A US SIP
                set in the INDmoney app cannot be read from here — it shows up in
                the order ledger as recurring buys and nowhere else.
              </p>
            </>
          )}
      </Card>

      <Card title="What it costs to invest from India" color="var(--red)">
        <RemitPanel summary={remit} gainAt={gainAt} />
      </Card>

      <Card title="Combined book" color="var(--purple)">
        {combined.missingFx ? (
          <p className="ind-nofx">{combined.note}</p>
        ) : (
          <>
            <div className="tile-row">
              <StatTile label="Total value" value={money(combined.value, visible, '$')} color="var(--cyan)" />
              <StatTile
                label="Unrealised" color={gain(combined.unrealised)}
                value={combined.unrealised == null ? '—' : money(combined.unrealised, visible, '$')}
                note={pct(combined.unrealisedPct)}
              />
              {combined.groups.map(x => (
                <StatTile
                  key={x.code} label={x.code} color="var(--ink-2)"
                  value={money(x.value, visible, x.symbol)}
                  note={`${x.count} holding${x.count === 1 ? '' : 's'}`}
                />
              ))}
            </div>
            {combined.note && <p className="ind-conv">{combined.note}</p>}
          </>
        )}
      </Card>
    </div>
  );
}
