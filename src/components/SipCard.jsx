import React from 'react';
import { Card, Empty, StatTile } from './ui.jsx';
import { useCollection } from '../lib/hooks.js';

// Active SIPs (systematic investments). Stored in memory.sips — scanned from INDmoney.
const fmtDate = iso => { try { return new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' }); } catch { return iso; } };

export default function SipCard({ fx = 88 }) {
  const { items: mem } = useCollection('memory', { filter: 'key=eq.sips', order: 'key' });
  const list = (mem?.[0]?.value?.list || []).filter(s => s.active !== false);
  const monthlyUsd = list.reduce((s, x) => s + (x.freq === 'monthly' ? Number(x.amount_usd || 0) : 0), 0);
  const investedUsd = list.reduce((s, x) => s + Number(x.invested_usd || 0), 0);

  return (
    <Card title="Active SIPs" color="var(--cyan)"
      right={list.length ? <span className="chip c-cyan">{list.length} running</span> : null}>
      {list.length === 0 && <Empty icon="↻" text="No SIPs recorded yet. A scan of your INDmoney SIPs lands here." />}
      {list.length > 0 && (
        <>
          <div className="tile-row" style={{ marginBottom: 10 }}>
            <StatTile label="Monthly" value={`$${monthlyUsd.toFixed(0)}`} note={`≈ ₹${Math.round(monthlyUsd * fx)}/mo`} color="var(--cyan)" />
            <StatTile label="Invested via SIP" value={`$${investedUsd.toFixed(0)}`} note="so far" color="var(--green)" />
            <StatTile label="Plans" value={list.length} note="active" color="var(--pink)" />
          </div>
          {list.map(s => (
            <div className="row" key={s.id || s.ticker}>
              <span className="chip c-cyan" style={{ minWidth: 52, textAlign: 'center' }}>{s.ticker}</span>
              <span style={{ flex: 1 }}>{s.fund || s.ticker}<span className="muted small"> · {s.freq}{s.started ? ` · since ${fmtDate(s.started)}` : ''}</span></span>
              <span className="chip c-green">${Number(s.amount_usd).toFixed(0)}/mo</span>
              {s.last_exec && <span className="chip">last {fmtDate(s.last_exec)}</span>}
            </div>
          ))}
        </>
      )}
    </Card>
  );
}
