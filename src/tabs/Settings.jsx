import React, { useState } from 'react';
import { Card } from '../components/ui.jsx';
import { getConfig, setConfig, isRemote } from '../lib/db.js';
import { useCollection } from '../lib/hooks.js';

export default function Settings() {
  const [cfg, setCfg] = useState(getConfig());
  const [saved, setSaved] = useState(false);
  const { items: requests } = useCollection('requests');

  function save() {
    setConfig(cfg);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }

  const upd = k => e => setCfg({ ...cfg, [k]: e.target.value.trim() });

  return (
    <>
      <h1 className="tab-title">SETTINGS</h1>
      <p className="tab-sub">Connect the brain. Keys live only in this browser.</p>

      <Card title={`Data mode: ${isRemote() ? 'SUPABASE (live)' : 'LOCAL (this device only)'}`} color={isRemote() ? 'var(--green)' : 'var(--yellow)'}>
        <label>Supabase URL</label>
        <input placeholder="https://xxxx.supabase.co" defaultValue={cfg.supabaseUrl || ''} onChange={upd('supabaseUrl')} />
        <label className="mt">Supabase anon key</label>
        <input placeholder="eyJhbGciOi…" defaultValue={cfg.supabaseKey || ''} onChange={upd('supabaseKey')} />
        <label className="mt">TMDB API key (movie search & posters — free)</label>
        <input placeholder="optional" defaultValue={cfg.tmdbKey || ''} onChange={upd('tmdbKey')} />
        <div className="flex mt">
          <button className="btn btn-green" onClick={save}>{saved ? 'Saved ✓' : 'Save'}</button>
          <span className="small muted">After saving, reload the page. Local data stays as a fallback.</span>
        </div>
      </Card>

      <Card title="Request queue (Cowork inbox)" color="var(--purple)">
        {requests.length === 0 && <div className="muted small">No requests yet. Refresh buttons and Ask-Cowork land here.</div>}
        {requests.slice(0, 10).map(r => (
          <div className="row" key={r.id}>
            <span className="chip c-cyan">{r.kind}</span>
            <span style={{ flex: 1 }} className="small">{JSON.stringify(r.payload).slice(0, 80)}</span>
            <span className={`chip ${r.status === 'done' ? 'c-green' : r.status === 'pending' ? 'c-yellow' : 'c-purple'}`}>{r.status}</span>
          </div>
        ))}
      </Card>

      <Card title="How this stays live" color="var(--cyan)">
        <div className="small" style={{ color: 'var(--ink-2)', lineHeight: 1.5 }}>
          Dashboard ⇄ Supabase (instant reads/writes, 45s polling for new data).<br />
          Cowork's scheduled cloud runs fill Supabase: Amizone sync, prices, news, morning brief, roadmaps, exam notes, midnight builds.<br />
          Manual refresh buttons queue a request so the next run re-pulls that source.
        </div>
      </Card>
    </>
  );
}
