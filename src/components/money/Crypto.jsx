import React, { useMemo, useState } from 'react';
import { Card, Empty, StatTile, useMoneyVisible, money } from '../ui.jsx';
import { useCollection } from '../../lib/hooks.js';
import { explain, ledgerState } from '../../lib/binance.js';

// Crypto — the Binance side of the portfolio.
//
// Everything here is read-only, and that is a property of the whole chain, not
// just of this file: the worker behind it holds a key created with "Enable
// Reading" only and makes no request that could move a coin. So there is no buy
// button, no sell button and no transfer form, and there will not be one. The
// dashboard's job is to tell you the truth about what you own; a dashboard that
// can also trade is a different piece of software with a licence behind it.
//
// Two numbers are shown per asset and they answer different questions, which is
// why neither is dropped in favour of the other:
//
//   HELD      — what Binance says is in the account right now. Ground truth,
//               and it includes staked and locked balances, because a coin in
//               Earn is still a coin you own.
//   AVG COST  — what the ledger says you paid, in rupees, weighted by size.
//
// When those two disagree about quantity, the ledger is the one that is wrong,
// and it says so rather than quietly reconciling: the lookback window only
// reaches back so far, and a position opened before it began will show a held
// quantity with no cost behind it. Silently inventing a basis for those coins
// would produce a gain figure that looks authoritative and is fiction.

function fmtQty(n) {
  const v = Number(n) || 0;
  if (v === 0) return '0';
  // Eight decimals is BTC's smallest unit and unreadable for a stablecoin; two
  // is unreadable for BTC. Scale the precision to the magnitude instead.
  if (v >= 1000) return v.toFixed(2);
  if (v >= 1) return v.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  return v.toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
}

const SOURCE_LABEL = { p2p: 'P2P', spot: 'SPOT', deposit: 'IN', withdrawal: 'OUT' };
const KIND_COLOR = { buy: 'var(--green)', sell: 'var(--red)', in: 'var(--cyan)', out: 'var(--orange)' };

export default function Crypto() {
  const { items } = useCollection('memory', { filter: 'key=eq.binance_ledger', order: 'key' });
  const { items: sync } = useCollection('memory', { filter: 'key=eq.sync_status', order: 'key' });
  const blob = items?.[0]?.value || {};
  const status = sync?.[0]?.value?.binance || null;
  const [moneyVis, toggleMoney] = useMoneyVisible();
  const [showAll, setShowAll] = useState(false);
  const [tab, setTab] = useState('holdings');

  const balances = Array.isArray(blob.balances) ? blob.balances : [];
  const rows = Array.isArray(blob.rows) ? blob.rows : [];
  const positions = Array.isArray(blob.positions) ? blob.positions : [];

  const view = useMemo(() => {
    const posBy = new Map(positions.map(p => [p.asset, p]));
    // Held balances lead, because those are the coins that exist. A position in
    // the ledger with nothing held is a closed trade and belongs in history,
    // not in a holdings list.
    const held = balances.map(b => {
      const p = posBy.get(b.asset);
      return {
        asset: b.asset,
        qty: b.total,
        free: b.free,
        staked: b.staked,
        avgCost: p?.avgCost || 0,
        cost: p ? p.avgCost * b.total : 0,
        realised: p?.realised || 0,
        // The ledger saw fewer coins than the account holds — almost always a
        // position that predates the lookback window.
        unbacked: !p || p.qty + 1e-8 < b.total,
        ledgerQty: p?.qty || 0,
      };
    });
    const investedTotal = held.reduce((s, h) => s + (h.unbacked ? 0 : h.cost), 0);
    const realisedTotal = positions.reduce((s, p) => s + (Number(p.realised) || 0), 0);
    const closed = positions.filter(p => p.qty <= 1e-12 && p.realised !== 0);
    return { held, investedTotal, realisedTotal, closed };
  }, [balances, positions]);

  const ledger = useMemo(
    () => [...rows].sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? ''))),
    [rows],
  );

  const why = explain(status);
  const state = ledgerState(blob, status);

  if (state.state === 'never') {
    return (
      <Card title="Crypto · Binance" color="var(--yellow)">
        {/* The old note here said to put the key in the REPO SECRETS. That
            instruction outlived the workflow it belonged to — the GitHub job was
            removed because Binance answers 451 to American IPs — and following
            it leads to a key sitting somewhere nothing reads. */}
        <Empty icon="◈" text="Binance is not connected yet."
          note="Create a READ-ONLY key on Binance (Enable Reading only; Spot Trading and Withdrawals OFF), put it in scripts/.binance.env on your Mac, and run scripts/binance-local.sh. It has to run from your own connection — Binance refuses American IPs, so GitHub Actions and Vercel cannot do it. Nothing here can trade; the key is not permitted to." />
      </Card>
    );
  }

  return (
    <>
      {/* The raw reason used to be dumped here — two hundred characters of JSON
          with the real answer buried in the middle of it. What matters is which
          KIND of failure it is, because the fixes have nothing in common. */}
      {why && (
        <div className="mail-problem" style={{ marginBottom: 10 }}>
          <strong>{why.headline}</strong>
          <div className="small" style={{ marginTop: 4 }}>{why.what}</div>
          <div className="small" style={{ marginTop: 4, color: 'var(--yellow)' }}>{why.fix}</div>
          {why.notThis && <div className="small" style={{ marginTop: 4, color: 'var(--ink-3)' }}>{why.notThis}</div>}
        </div>
      )}

      {/* SINCE INCEPTION — the only question that can be answered honestly across
          the whole account. Per-asset cost basis breaks the moment a Convert is
          involved (USDT→BTC has no rupee leg), but "did I make money" does not
          need it: rupees in and rupees out are both directly observed, and
          today's value is a live price. */}
      {blob.summary && (
        <Card title="Since you started" color="var(--purple)"
          right={<span className="small muted">
            {blob.summary.firstAt ? `first movement ${String(blob.summary.firstAt).slice(0, 10)}` : ''}
          </span>}>
          <div className="tile-row">
            <StatTile label="Put in" value={money(blob.summary.in, moneyVis, '₹')} note="P2P buys and deposits" color="var(--yellow)" />
            <StatTile label="Taken out" value={money(blob.summary.out, moneyVis, '₹')} note="sells and withdrawals" color="var(--cyan)" />
            <StatTile label="Worth now"
              value={blob.summary.valued ? money(blob.summary.valueNow, moneyVis, '₹') : '—'}
              note={blob.summary.valued ? 'at live prices' : 'not priced this run'} color="var(--ink)" />
            <StatTile label="Gain / loss"
              value={blob.summary.valued ? money(blob.summary.net, moneyVis, '₹') : '—'}
              note={blob.summary.valued && blob.summary.pct != null ? `${blob.summary.pct >= 0 ? '+' : ''}${blob.summary.pct.toFixed(1)}%` : 'needs a price'}
              color={!blob.summary.valued ? 'var(--ink-3)' : blob.summary.net >= 0 ? 'var(--green)' : 'var(--red)'} />
          </div>
          {/* Said plainly, because it is not a live FX quote and should never be
              mistaken for one. It is the rate he actually paid. */}
          {blob.inrPerUsdt ? (
            <div className="small muted" style={{ marginTop: 6 }}>
              Valued at ₹{Number(blob.inrPerUsdt).toFixed(2)} per USDT — the rate on your own last P2P buy, not a market quote.
              {blob.valueUsdt ? ` Holdings are ${Number(blob.valueUsdt).toFixed(2)} USDT.` : ''}
            </div>
          ) : (
            <div className="small muted" style={{ marginTop: 6 }}>
              No P2P buy in the ledger to take a rupee rate from, so the position is not valued in rupees.
            </div>
          )}
          {blob.summary.counts && (
            <div className="small muted" style={{ marginTop: 4 }}>
              {blob.summary.counts.p2pBuys} P2P buy(s) · {blob.summary.counts.converts} convert(s) ·
              {' '}{blob.summary.counts.deposits} deposit(s) · {blob.summary.counts.withdrawals} withdrawal(s)
            </div>
          )}
        </Card>
      )}

      <div className="tile-row">
        <StatTile label="Assets held" value={view.held.length} note="on Binance" color="var(--cyan)" />
        <StatTile label="Invested" value={money(view.investedTotal, moneyVis, '₹')}
          note={<span onClick={toggleMoney} style={{ cursor: 'pointer' }}>{moneyVis ? 'hide' : 'tap'} · cost basis</span>}
          color="var(--yellow)" />
        <StatTile label="Realised" value={money(view.realisedTotal, moneyVis, '₹')}
          note="booked on sells" color={view.realisedTotal >= 0 ? 'var(--green)' : 'var(--red)'} />
        <StatTile label="Ledger" value={rows.length} note="transactions" color="var(--purple)" />
      </div>

      <span className="seg" style={{ marginBottom: 10 }}>
        <button className={`seg-btn${tab === 'holdings' ? ' on' : ''}`} onClick={() => setTab('holdings')}>Holdings</button>
        <button className={`seg-btn${tab === 'ledger' ? ' on' : ''}`} onClick={() => setTab('ledger')}>Ledger</button>
      </span>

      {/* A balance list that quietly under-reports is worse than one that says
          which parts it could not see. getUserAsset gives Earn and staked;
          /api/v3/account, the fallback, cannot see either. */}
      {blob.balancesComplete === false && (
        <div className="small" style={{ color: 'var(--yellow)', marginBottom: 8 }}>
          Spot balances only — anything in Earn or staked is not counted here.
        </div>
      )}
      {blob.balancesStale && (
        <div className="small" style={{ color: 'var(--orange)', marginBottom: 8 }}>
          These balances are from an earlier run — the latest sync could not read them.
        </div>
      )}
      {tab === 'holdings' && (
        <Card title="Holdings" color="var(--green)"
          right={<span className="small muted">{blob.updated ? `synced ${new Date(blob.updated).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}</span>}>
          {/* "The account is empty, or the key cannot read it" was wrong on both
              counts and sent the search in the wrong direction for a month. An
              empty result from a FAILED run is the failure, not a finding. */}
          {view.held.length === 0 && (state.state === 'blank-because-failed'
            ? <Empty icon="⚠" text="Nothing was read — the sync above failed."
                note="This is not a statement about what you own. The last successful read was before that failure began." />
            : <Empty icon="◈" text="No balances returned — the account really is empty." />)}
          {view.held.map(h => (
            <div className="row crypto-row" key={h.asset}>
              <span className="chip c-cyan">{h.asset}</span>
              <span className="crypto-qty">{fmtQty(h.qty)}</span>
              {h.staked > 0 && (
                <span className="chip c-purple" title="Locked or in Earn — still yours, just not immediately movable">
                  {fmtQty(h.staked)} locked
                </span>
              )}
              {blob.prices?.[h.asset] > 0 && (
                <span className="small muted">
                  {(h.qty * blob.prices[h.asset]).toFixed(2)} USDT
                </span>
              )}
              <span style={{ flex: 1 }} />
              {h.unbacked ? (
                // Stated rather than hidden. An asterisk here is worth more than
                // a confident number that was never true.
                <span className="chip c-yellow" title={`The ledger only accounts for ${fmtQty(h.ledgerQty)} ${h.asset}. The rest was acquired before the sync window opened, so there is no cost basis for it.`}>
                  no basis
                </span>
              ) : (
                <span className="crypto-avg">avg <span className="rupee">₹</span>{moneyVis ? h.avgCost.toFixed(2) : '••••'}</span>
              )}
            </div>
          ))}
          <div className="small muted mt" style={{ lineHeight: 1.5 }}>
            Read-only. This view can show what you hold and what it cost; it cannot buy,
            sell, transfer or withdraw anything, and the API key behind it is not permitted to either.
          </div>
        </Card>
      )}

      {tab === 'ledger' && (
        <Card title={`Ledger · ${ledger.length} transaction${ledger.length === 1 ? '' : 's'}`} color="var(--purple)">
          {ledger.length === 0 && <Empty icon="≡" text="No transactions in the sync window yet." />}
          {(showAll ? ledger : ledger.slice(0, 30)).map(r => (
            <div className="row crypto-row" key={r.id}>
              <span className="chip" style={{ color: KIND_COLOR[r.kind], borderColor: KIND_COLOR[r.kind] }}>
                {SOURCE_LABEL[r.source] || String(r.source || '').toUpperCase()}
              </span>
              <span className="crypto-kind" style={{ color: KIND_COLOR[r.kind] }}>
                {r.kind === 'buy' ? '+' : r.kind === 'in' ? '↓' : r.kind === 'out' ? '↑' : '−'}
              </span>
              <span className="crypto-qty">{fmtQty(r.qty)} {r.asset}</span>
              <span style={{ flex: 1 }} />
              {r.fiatQty > 0 && (
                <span className="crypto-fiat">
                  {r.fiat === 'INR' ? <span className="rupee">₹</span> : `${r.fiat} `}
                  {moneyVis ? Number(r.fiatQty).toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '••••'}
                </span>
              )}
              <span className="crypto-when">{r.at ? new Date(r.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' }) : '—'}</span>
            </div>
          ))}
          {ledger.length > 30 && (
            <button className="btn btn-sm mt" onClick={() => setShowAll(v => !v)}>
              {showAll ? '▲ show less' : `▼ ${ledger.length - 30} more`}
            </button>
          )}
        </Card>
      )}
    </>
  );
}
