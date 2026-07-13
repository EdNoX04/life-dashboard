import React, { useMemo, useState } from 'react';
import { useCollection, todayStr } from '../lib/hooks.js';
import { Card, Empty } from '../components/ui.jsx';

const PRI = { 3: ['HIGH', 'c-red'], 2: ['MED', 'c-yellow'], 1: ['LOW', 'c-cyan'], 0: ['—', ''] };
const SMART = ['Today', 'Next 7 Days', 'Inbox', 'Done'];

export default function Todos() {
  const { items, add, patch, del } = useCollection('todos');
  const [view, setView] = useState('Today');
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [pri, setPri] = useState(0);
  const [listName, setListName] = useState('Inbox');

  const lists = useMemo(
    () => [...new Set(['Inbox', ...items.map(i => i.list || 'Inbox')])],
    [items]
  );

  const today = todayStr();
  const week = todayStr(new Date(Date.now() + 7 * 864e5));

  const shown = items.filter(t => {
    if (view === 'Done') return t.completed;
    if (t.completed) return false;
    if (view === 'Today') return t.due_date && t.due_date <= today;
    if (view === 'Next 7 Days') return t.due_date && t.due_date <= week;
    if (view === 'Inbox') return true;
    return (t.list || 'Inbox') === view;
  });

  async function quickAdd() {
    if (!title.trim()) return;
    await add({
      title: title.trim(),
      due_date: due || null,
      priority: pri,
      list: SMART.includes(view) ? listName : view,
      completed: false,
    });
    setTitle(''); setDue(''); setPri(0);
  }

  return (
    <>
      <h1 className="tab-title">TODO</h1>
      <p className="tab-sub">TickTick-style — smart lists, priorities, due dates.</p>

      <div className="flex" style={{ flexWrap: 'wrap', marginBottom: 14 }}>
        {[...SMART, ...lists.filter(l => l !== 'Inbox')].map(v => (
          <button key={v} className={`btn btn-sm ${view === v ? 'btn-pink' : ''}`} onClick={() => setView(v)}>{v}</button>
        ))}
      </div>

      <Card title="New quest" color="var(--yellow)">
        <div className="flex" style={{ flexWrap: 'wrap' }}>
          <input style={{ flex: 2, minWidth: 180 }} placeholder="What needs doing?" value={title}
            onChange={e => setTitle(e.target.value)} onKeyDown={e => e.key === 'Enter' && quickAdd()} />
          <input type="date" style={{ width: 150 }} value={due} onChange={e => setDue(e.target.value)} />
          <select style={{ width: 110 }} value={pri} onChange={e => setPri(Number(e.target.value))}>
            <option value={0}>No pri</option><option value={1}>Low</option>
            <option value={2}>Med</option><option value={3}>High</option>
          </select>
          <input style={{ width: 120 }} placeholder="List" value={listName} onChange={e => setListName(e.target.value)} />
          <button className="btn btn-green" onClick={quickAdd}>+ Add</button>
        </div>
      </Card>

      <Card title={`${view} (${shown.length})`}>
        {shown.length === 0 && <Empty icon="✓" text="Nothing here. Peaceful." />}
        {shown.map(t => (
          <div className="row" key={t.id}>
            <span className={`pcheck ${t.completed ? 'done' : ''}`}
              onClick={() => patch(t.id, { completed: !t.completed, completed_at: t.completed ? null : new Date().toISOString() })}>
              {t.completed ? '✕' : ''}
            </span>
            <span className={t.completed ? 'struck' : ''} style={{ flex: 1 }}>{t.title}</span>
            {t.priority > 0 && <span className={`chip ${PRI[t.priority][1]}`}>{PRI[t.priority][0]}</span>}
            {t.due_date && <span className={`chip ${t.due_date < today && !t.completed ? 'c-red' : 'c-purple'}`}>{t.due_date}</span>}
            <span className="chip">{t.list || 'Inbox'}</span>
            <button className="btn btn-sm" onClick={() => del(t.id)}>✕</button>
          </div>
        ))}
      </Card>
    </>
  );
}
