import React, { useMemo, useState } from 'react';
import { Card, Empty, StatTile, useMoneyVisible, money } from '../ui.jsx';
import { useCollection } from '../../lib/hooks.js';

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

  if (!blob.updated && !status) {
    return (
      <Card title="Crypto · Binance" color="var(--yellow)">
        <Empty icon="◈" text="Binance is not connected yet." note="Create a READ-ONLY API key on Binance (Enable Reading only — leave Spot Trading and Withdrawals OFF), then add BINANCE_API_KEY and BINANCE_API_SECRET to the repo secrets. Nothing here can trade; the key is not permitted to." />
      </Card>
    );
  }

  return (
    <>
      {status && status.ok === false && (
        <div className="mail-problem" style={{ marginBottom: 10 }}>
          <strong>Binance sync:</strong> {status.reason}
        </div>
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

      {tab === 'holdings' && (
        <Card title="Holdings" color="var(--green)"
          right={<span className="small muted">{blob.updated ? `synced ${new Date(blob.updated).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}</span>}>
          {view.held.length === 0 && <Empty icon="◈" text="No balances returned. The account is empty, or the key cannot read it." />}
          {view.held.map(h => (
            <div className="row crypto-row" key={h.asset}>
              <span className="chip c-cyan">{h.asset}</span>
              <span className="crypto-qty">{fmtQty(h.qty)}</span>
              {h.staked > 0 && (
                <span className="chip c-purple" title="Locked or in Earn — still yours, just not immediately movable">
                  {fmtQty(h.staked)} locked
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
