import React, { useState } from 'react';
import { useCollection } from '../lib/hooks.js';
import { Card, Empty } from '../components/ui.jsx';
import * as db from '../lib/db.js';

const COLS = [
  ['pending', 'PENDING', 'var(--yellow)'],
  ['in_progress', 'IN PROGRESS', 'var(--cyan)'],
  ['done', 'DONE', 'var(--green)'],
  ['failed', 'FAILED', 'var(--red)'],
];

export default function Builds() {
  const { items, add, patch, del } = useCollection('builds');
  const [name, setName] = useState('');

  async function propose() {
    if (!name.trim()) return;
    const b = await add({ name: name.trim(), kind: 'APP', status: 'pending', notes: 'user-proposed' });
    if (db.isRemote()) await db.sendRequest('build', { build_id: b.id, name: b.name });
    setName('');
  }

  const age = c => {
    if (!c) return '';
    const d = Math.floor((Date.now() - new Date(c).getTime()) / 864e5);
    return d + 'd';
  };

  return (
    <>
      <h1 className="tab-title">BUILDS</h1>
      <p className="tab-sub">Mission Control — Cowork builds projects at midnight, reviews, pushes to GitHub.</p>

      <Card title="Propose a build" color="var(--yellow)">
        <div className="flex">
          <input placeholder="e.g. portfolio-site, expense-splitter…" value={name}
            onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && propose()} />
          <button className="btn btn-green" onClick={propose}>+ Queue</button>
        </div>
        <div className="small muted mt">Queued builds get a PRD from Cowork first — you approve, then the midnight run builds it.</div>
      </Card>

      <div className="kanban">
        {COLS.map(([key, label, color]) => {
          const cards = items.filter(b => b.status === key);
          return (
            <div className="px kanban-col" key={key}>
              <div className="kanban-head" style={{ color }}>{label} ({cards.length})</div>
              {cards.length === 0 && <div className="empty small" style={{ padding: 14 }}>—</div>}
              {cards.map(b => (
                <div className="kanban-card" key={b.id}>
                  <b>{b.name}</b>
                  <div className="flex mt" style={{ flexWrap: 'wrap', gap: 6 }}>
                    <span className="chip c-cyan">{b.kind || 'APP'}</span>
                    <span className="chip">{age(b.created_at)}</span>
                    {key !== 'done' && key !== 'failed' && (
                      <select style={{ width: 'auto', fontSize: 15, padding: '2px 4px' }} value={b.status} onChange={e => patch(b.id, { status: e.target.value })}>
                        {COLS.map(([k, l]) => <option key={k} value={k}>{l.toLowerCase()}</option>)}
                      </select>
                    )}
                    <button className="btn btn-sm" onClick={() => del(b.id)}>✕</button>
                  </div>
                  {b.notes && <div className="small muted mt">{b.notes}</div>}
                  {b.repo_url && <a className="small" style={{ color: 'var(--cyan)' }} href={b.repo_url} target="_blank" rel="noreferrer">↗ repo</a>}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </>
  );
}
