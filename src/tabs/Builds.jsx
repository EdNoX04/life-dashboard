import React, { useState } from 'react';
import { useCollection } from '../lib/hooks.js';
import { Card, Empty } from '../components/ui.jsx';
import * as db from '../lib/db.js';
import { byType, indexAge } from '../lib/brain.js';
import { buildsFrom } from '../lib/buildspec.js';
import { hermesHealth } from '../lib/hermes.js';

const COLS = [
  ['pending', 'PENDING', 'var(--yellow)'],
  ['in_progress', 'IN PROGRESS', 'var(--cyan)'],
  ['done', 'DONE', 'var(--green)'],
  ['failed', 'FAILED', 'var(--red)'],
];

export default function Builds() {
  const { items, add, patch, del } = useCollection('builds');
  // Specs live in the vault, not in this table. The plan's own words: intake,
  // plan, progress and retrospective are ONE FILE, so a spec Neel edited in
  // Obsidian on the train is the same object rendered here.
  const { items: brainMem } = useCollection('memory', { filter: 'key=eq.brain_index', order: 'key' });
  const index = brainMem?.[0]?.value || null;
  const specs = buildsFrom(byType(index, 'project', { limit: 100 }));
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

      <Card title="Build specs" color="var(--purple)"
        right={<span className="small muted">from the vault · projects/</span>}>
        {/* Same lie this codebase keeps running into: a month-old index showing
            two specs reads exactly like a current one showing two specs. */}
        {(() => {
          const h = indexAge(index);
          if (h == null || h < 48) return null;
          return <div className="small" style={{ color: 'var(--red)', marginBottom: 8 }}>
            Vault index last built {h < 168 ? `${Math.round(h / 24)} days` : `${Math.round(h / 168)} weeks`} ago — anything written since is not here.
          </div>;
        })()}
        {/* An agent that stopped mid-build. Same shape as every other silence
            in this codebase: it is not queued, so nothing picks it up, and not
            done, so nothing complains. */}
        {(() => {
          const h = hermesHealth(specs);
          if (!h.stale.length && !h.blocked.length) return null;
          return <div className="small" style={{ color: 'var(--red)', marginBottom: 8 }}>
            {h.stale.map(s => (
              <div key={`st-${s.path}`}>
                “{s.title}” has been building{s.hours ? ` for ${s.hours}h` : ' with nothing holding it'} — the agent stopped. It will not be picked up again until it is set back to queued.
              </div>
            ))}
            {h.blocked.map(s => <div key={`bl-${s.path}`}>“{s.title}” is blocked and needs you.</div>)}
          </div>;
        })()}
        {!specs.length && (
          <Empty icon="◷" text={index
            ? 'No build specs yet. Tell PLAYER TWO what you want built — it writes the spec here for you to correct.'
            : 'Waiting for the vault index.'} />
        )}
        {specs.map(b => (
          <div className="dec-item" key={b.path}>
            <div className="spread" style={{ gap: 8, flexWrap: 'wrap' }}>
              <span style={{ flex: 1, minWidth: 200 }}>
                <b>{b.title}</b>
                {b.why && <div className="small muted" style={{ marginTop: 3 }}>{b.why}</div>}
              </span>
              <span className="flex" style={{ gap: 5, alignItems: 'flex-start' }}>
                <span className={`chip ${b.status === 'done' ? 'c-green' : b.status === 'blocked' ? 'c-red' : b.status === 'building' ? 'c-cyan' : ''}`}>{b.status}</span>
                <span className="chip">{b.progress.done}/{b.progress.total}</span>
              </span>
            </div>
            {/* The plan, as sizes and a count. Never as a duration — a confident
                number with nothing behind it becomes the thing he plans around. */}
            <div className="small mt" style={{ color: 'var(--ink-3)' }}>{b.summary}</div>
            {b.steps.map((st, i) => (
              <div className="small" key={i} style={{ lineHeight: 1.6, opacity: st.done ? 0.5 : 1 }}>
                <span style={{ color: st.done ? 'var(--green)' : 'var(--ink-3)' }}>{st.done ? '✓' : '○'} </span>
                <span className="chip" style={{ marginRight: 6 }}>{st.size}</span>
                <span style={{ textDecoration: st.done ? 'line-through' : 'none' }}>{st.text}</span>
              </div>
            ))}
            {b.notes && (
              <div className="small mt" style={{ lineHeight: 1.55 }}>
                <span style={{ color: 'var(--cyan)' }}>Progress — </span>
                <span className="muted">{b.notes}</span>
              </div>
            )}
          </div>
        ))}
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
