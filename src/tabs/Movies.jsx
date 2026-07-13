import React, { useState } from 'react';
import { useCollection } from '../lib/hooks.js';
import { Card, Empty } from '../components/ui.jsx';
import { getConfig } from '../lib/db.js';

const STATUSES = [
  ['watchlist', 'PLAN TO WATCH', 'c-cyan'],
  ['watching', 'WATCHING', 'c-yellow'],
  ['completed', 'COMPLETED', 'c-green'],
  ['dropped', 'DROPPED', 'c-red'],
];

export default function Movies() {
  const { items, add, patch, del } = useCollection('movies');
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const tmdbKey = getConfig().tmdbKey;

  async function search() {
    if (!q.trim()) return;
    if (!tmdbKey) { // manual add fallback
      await add({ title: q.trim(), type: 'movie', status: 'watchlist', rating: null, poster_url: null });
      setQ('');
      return;
    }
    setBusy(true);
    try {
      const r = await fetch(`https://api.themoviedb.org/3/search/multi?query=${encodeURIComponent(q)}&api_key=${tmdbKey}`);
      const j = await r.json();
      setResults((j.results || []).filter(x => x.media_type !== 'person').slice(0, 6));
    } finally { setBusy(false); }
  }

  async function addFrom(r) {
    await add({
      title: r.title || r.name,
      type: r.media_type === 'tv' ? 'tv' : 'movie',
      status: 'watchlist',
      tmdb_id: r.id,
      poster_url: r.poster_path ? `https://image.tmdb.org/t/p/w185${r.poster_path}` : null,
      rating: null,
    });
    setResults([]); setQ('');
  }

  return (
    <>
      <h1 className="tab-title">MEDIA</h1>
      <p className="tab-sub">Your own Letterboxd — movies & TV, tracked.</p>

      <Card title="Add title" color="var(--yellow)">
        <div className="flex">
          <input placeholder={tmdbKey ? 'Search TMDB…' : 'Title (add TMDB key in Settings for posters/search)'}
            value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && search()} />
          <button className="btn btn-green" onClick={search} disabled={busy}>{busy ? '...' : tmdbKey ? 'Search' : '+ Add'}</button>
        </div>
        {results.length > 0 && (
          <div className="mt">
            {results.map(r => (
              <div className="row" key={r.id}>
                {r.poster_path && <img src={`https://image.tmdb.org/t/p/w92${r.poster_path}`} alt="" style={{ width: 32, border: '2px solid var(--border)' }} />}
                <span style={{ flex: 1 }}>{r.title || r.name} <span className="muted small">({(r.release_date || r.first_air_date || '').slice(0, 4)})</span></span>
                <span className="chip c-purple">{r.media_type}</span>
                <button className="btn btn-sm btn-green" onClick={() => addFrom(r)}>+ Add</button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {STATUSES.map(([key, label, chip]) => {
        const rows = items.filter(m => m.status === key);
        return (
          <Card key={key} title={`${label} (${rows.length})`} color="var(--purple)">
            {rows.length === 0 && <Empty icon="▶" text="Empty shelf." />}
            {rows.map(m => (
              <div className="row" key={m.id}>
                {m.poster_url && <img src={m.poster_url} alt="" style={{ width: 34, border: '2px solid var(--border)' }} />}
                <span style={{ flex: 1 }}>{m.title}</span>
                <span className="chip">{m.type}</span>
                {key === 'completed' && (
                  <select style={{ width: 90 }} value={m.rating || ''} onChange={e => patch(m.id, { rating: Number(e.target.value) || null })}>
                    <option value="">rate</option>
                    {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{'★'.repeat(n)}</option>)}
                  </select>
                )}
                {m.rating && key === 'completed' && <span className="chip c-yellow">{'★'.repeat(m.rating)}</span>}
                <select style={{ width: 130 }} value={m.status} onChange={e => patch(m.id, { status: e.target.value })}>
                  {STATUSES.map(([k, l]) => <option key={k} value={k}>{l.toLowerCase()}</option>)}
                </select>
                <button className="btn btn-sm" onClick={() => del(m.id)}>✕</button>
              </div>
            ))}
          </Card>
        );
      })}
    </>
  );
}
