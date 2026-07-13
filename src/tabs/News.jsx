import React, { useState } from 'react';
import { useCollection } from '../lib/hooks.js';
import { Card, Empty, RefreshButton } from '../components/ui.jsx';

const CATS = [['all', 'ALL'], ['stocks', 'MY STOCKS'], ['finance', 'FINANCE'], ['tech', 'TECH']];

export default function News() {
  const { items, refresh } = useCollection('news', { order: 'published_at' });
  const [cat, setCat] = useState('all');
  const shown = items.filter(n => cat === 'all' || n.category === cat);

  return (
    <>
      <div className="spread">
        <h1 className="tab-title">NEWS</h1>
        <RefreshButton source="news" onLocalRefresh={refresh} />
      </div>
      <p className="tab-sub">Finance + tech + your holdings — curated by Cowork on schedule.</p>

      <div className="flex" style={{ marginBottom: 14 }}>
        {CATS.map(([k, l]) => (
          <button key={k} className={`btn btn-sm ${cat === k ? 'btn-pink' : ''}`} onClick={() => setCat(k)}>{l}</button>
        ))}
      </div>

      <Card title={`Headlines (${shown.length})`} color="var(--cyan)">
        {shown.length === 0 && <Empty icon="※" text="No headlines yet — they arrive with the morning brief once Supabase is connected." />}
        {shown.map(n => (
          <div className="row" key={n.id} style={{ alignItems: 'flex-start' }}>
            <span style={{ flex: 1 }}>
              <a href={n.url} target="_blank" rel="noreferrer" style={{ color: 'var(--ink)' }}>{n.title}</a>
              {n.summary && <div className="small muted">{n.summary}</div>}
            </span>
            <span className="chip c-purple">{n.category}</span>
            <span className="chip c-cyan">{n.source}</span>
          </div>
        ))}
      </Card>
    </>
  );
}
