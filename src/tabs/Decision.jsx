import React, { useState } from 'react';
import { Card, Empty, StatTile } from '../components/ui.jsx';
import { useCollection } from '../lib/hooks.js';
import * as db from '../lib/db.js';

// Decision engine with growing memory. SCAFFOLD: logging decisions + outcomes is
// FUNCTIONAL (saved to Supabase memory). The similar-situation matching + success/fail
// prediction + notifications are the deep build (needs the AI layer).
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));

export default function Decision() {
  const { items: mem, refresh } = useCollection('memory', { filter: 'key=eq.decisions_log', order: 'key' });
  const log = mem?.[0]?.value?.list || [];
  const [form, setForm] = useState({ situation: '', options: '', chosen: '', note: '' });
  const [busy, setBusy] = useState(false);

  const decided = log.filter(d => d.outcome && d.outcome !== 'pending');
  const wins = decided.filter(d => d.outcome === 'success').length;
  const winRate = decided.length ? Math.round((wins / decided.length) * 100) : null;

  async function save(next) {
    setBusy(true);
    try { await db.upsertMemory('decisions_log', { list: next, updated: new Date().toISOString() }); await refresh(); } catch {}
    setBusy(false);
  }
  async function add() {
    if (!form.situation.trim() || !form.chosen.trim()) return;
    const d = { id: uid(), at: new Date().toISOString().slice(0, 10), situation: form.situation.trim(), options: form.options.split(',').map(s => s.trim()).filter(Boolean), chosen: form.chosen.trim(), note: form.note.trim(), outcome: 'pending', result: '' };
    await save([d, ...log]);
    setForm({ situation: '', options: '', chosen: '', note: '' });
  }
  const setOutcome = (id, outcome) => save(log.map(d => d.id === id ? { ...d, outcome } : d));

  return (
    <>
      <h1 className="tab-title">DECISION</h1>
      <p className="tab-sub">Every choice, its outcome, and what it taught you — a memory that gets wiser over time. 🧭</p>

      <div className="tile-row">
        <StatTile label="Decisions logged" value={log.length} color="var(--cyan)" />
        <StatTile label="Resolved" value={decided.length} color="var(--purple)" />
        <StatTile label="Success rate" value={winRate != null ? `${winRate}%` : '—'} note={`${wins}/${decided.length}`} color="var(--green)" />
      </div>

      <Card title="Log a decision" color="var(--yellow)">
        <input placeholder="The situation / what you're deciding" value={form.situation} onChange={e => setForm({ ...form, situation: e.target.value })} />
        <input className="mt" placeholder="Options (comma-separated) — e.g. Accept offer, Wait, Negotiate" value={form.options} onChange={e => setForm({ ...form, options: e.target.value })} />
        <div className="flex mt" style={{ flexWrap: 'wrap' }}>
          <input style={{ flex: 1, minWidth: 160 }} placeholder="What you chose" value={form.chosen} onChange={e => setForm({ ...form, chosen: e.target.value })} />
          <input style={{ flex: 2, minWidth: 180 }} placeholder="Why (reasoning)" value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} />
          <button className="btn btn-green" onClick={add} disabled={busy}>+ Log</button>
        </div>
      </Card>

      <Card title="Similar-situation engine" color="var(--pink)">
        <Empty icon="🔮" text="Deep build: when you log a new decision, this scans your history for similar past ones and shows the option's success/failure odds — and pings you if a choice previously went badly. Never-ending memory, learning from every outcome." />
      </Card>

      <Card title="Decision history" color="var(--purple)">
        {log.length === 0 && <Empty icon="🧭" text="No decisions yet — log one above and mark how it turned out later." />}
        {log.map(d => (
          <div className="dec-item" key={d.id}>
            <div className="spread" style={{ gap: 8, flexWrap: 'wrap' }}>
              <span style={{ flex: 1, minWidth: 160 }}><b style={{ fontWeight: 'normal' }}>{d.situation}</b><div className="small muted">chose: <span style={{ color: 'var(--cyan)' }}>{d.chosen}</span>{d.note ? ` · ${d.note}` : ''}</div></span>
              <span className="flex" style={{ gap: 5 }}>
                <span className="chip">{d.at}</span>
                {d.outcome === 'pending'
                  ? <><button className="btn btn-sm btn-green" onClick={() => setOutcome(d.id, 'success')}>✓ worked</button><button className="btn btn-sm" onClick={() => setOutcome(d.id, 'fail')}>✗ didn't</button></>
                  : <span className={`chip ${d.outcome === 'success' ? 'c-green' : 'c-red'}`}>{d.outcome === 'success' ? '✓ worked' : '✗ didn\'t'}</span>}
              </span>
            </div>
          </div>
        ))}
      </Card>
    </>
  );
}
