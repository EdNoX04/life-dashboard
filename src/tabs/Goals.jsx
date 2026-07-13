import React, { useState } from 'react';
import { useCollection } from '../lib/hooks.js';
import { Card, Empty } from '../components/ui.jsx';
import * as db from '../lib/db.js';

const HORIZONS = [
  ['short', 'SHORT TERM', 'var(--cyan)', 'c-cyan'],
  ['long', 'LONG TERM', 'var(--purple)', 'c-purple'],
  ['lifelong', 'LIFELONG', 'var(--pink)', 'c-pink'],
];

export default function Goals() {
  const { items, add, patch, del } = useCollection('goals');
  const [title, setTitle] = useState('');
  const [horizon, setHorizon] = useState('short');

  async function create() {
    if (!title.trim()) return;
    const g = await add({ title: title.trim(), horizon, status: 'active', progress: 0, roadmap: [] });
    // ask the brain for a roadmap
    if (db.isRemote()) await db.sendRequest('roadmap', { goal_id: g.id, goal: g.title, horizon });
    setTitle('');
  }

  function toggleStep(goal, idx) {
    const rm = [...(goal.roadmap || [])];
    rm[idx] = { ...rm[idx], done: !rm[idx].done };
    const progress = rm.length ? Math.round((rm.filter(s => s.done).length / rm.length) * 100) : goal.progress;
    patch(goal.id, { roadmap: rm, progress });
  }

  return (
    <>
      <h1 className="tab-title">GOALS</h1>
      <p className="tab-sub">Short, long & lifelong — Cowork writes the roadmap for every goal you add.</p>

      <Card title="New goal" color="var(--yellow)">
        <div className="flex" style={{ flexWrap: 'wrap' }}>
          <input style={{ flex: 2, minWidth: 180 }} placeholder="e.g. Crack a SDE internship by Dec" value={title}
            onChange={e => setTitle(e.target.value)} onKeyDown={e => e.key === 'Enter' && create()} />
          <select style={{ width: 150 }} value={horizon} onChange={e => setHorizon(e.target.value)}>
            <option value="short">Short term</option>
            <option value="long">Long term</option>
            <option value="lifelong">Lifelong</option>
          </select>
          <button className="btn btn-green" onClick={create}>+ Add</button>
        </div>
        <div className="small muted mt">On save, a roadmap request is queued — Cowork fills in exact steps on its next run.</div>
      </Card>

      {HORIZONS.map(([key, label, color, chip]) => {
        const goals = items.filter(g => g.horizon === key);
        return (
          <Card key={key} title={label} color={color}>
            {goals.length === 0 && <Empty icon="★" text="No goals here yet." />}
            {goals.map(g => (
              <div key={g.id} style={{ marginBottom: 14 }}>
                <div className="spread">
                  <b style={{ fontSize: 19 }}>{g.title}</b>
                  <span className="flex">
                    <span className={`chip ${chip}`}>{g.status}</span>
                    <button className="btn btn-sm" onClick={() => del(g.id)}>✕</button>
                  </span>
                </div>
                <div className="pbar mt" title={`${g.progress || 0}%`}><div style={{ width: `${g.progress || 0}%` }} /></div>
                {(g.roadmap || []).length > 0 ? (
                  <div className="mt">
                    {g.roadmap.map((s, i) => (
                      <div className="row" key={i}>
                        <span className={`pcheck ${s.done ? 'done' : ''}`} onClick={() => toggleStep(g, i)}>{s.done ? '✕' : ''}</span>
                        <span className={s.done ? 'struck' : ''} style={{ flex: 1 }}>{s.step}</span>
                        {s.eta && <span className="chip c-purple">{s.eta}</span>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="small muted mt">Roadmap pending — Cowork will draft it on the next run.</div>
                )}
              </div>
            ))}
          </Card>
        );
      })}
    </>
  );
}
