import React, { useState } from 'react';
import { useCollection } from '../lib/hooks.js';
import { Card, Empty } from '../components/ui.jsx';
import * as db from '../lib/db.js';

export default function Subjects() {
  const { items, add, patch, del } = useCollection('subjects', { order: 'name', asc: true });
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [open, setOpen] = useState(null);

  async function create() {
    if (!name.trim()) return;
    await add({ name: name.trim(), code: code.trim() || null, syllabus: '', attendance_pct: null, notes_url: null });
    setName(''); setCode('');
  }

  async function requestNotes(s) {
    await db.sendRequest('exam_notes', { subject_id: s.id, subject: s.name, syllabus: s.syllabus || '' });
    await patch(s.id, { notes_status: 'requested' });
  }

  return (
    <>
      <h1 className="tab-title">SUBJECTS</h1>
      <p className="tab-sub">Syllabus in → detailed HTML exam notes out (built by Cowork).</p>

      <Card title="Add subject" color="var(--yellow)">
        <div className="flex" style={{ flexWrap: 'wrap' }}>
          <input style={{ flex: 2, minWidth: 160 }} placeholder="Subject name" value={name} onChange={e => setName(e.target.value)} />
          <input style={{ width: 130 }} placeholder="Code" value={code} onChange={e => setCode(e.target.value)} />
          <button className="btn btn-green" onClick={create}>+ Add</button>
        </div>
      </Card>

      {items.length === 0 && <Card><Empty icon="📚" text="No subjects yet — add manually or sync from Amizone (College tab)." /></Card>}

      {items.map(s => (
        <Card key={s.id} title={`${s.name}${s.code ? ' · ' + s.code : ''}`} color="var(--cyan)"
          right={
            <span className="flex">
              {s.attendance_pct != null && <span className={`chip ${Number(s.attendance_pct) < 75 ? 'c-red' : 'c-green'}`}>{s.attendance_pct}%</span>}
              <button className="btn btn-sm" onClick={() => setOpen(open === s.id ? null : s.id)}>{open === s.id ? 'Close' : 'Edit'}</button>
              <button className="btn btn-sm" onClick={() => del(s.id)}>✕</button>
            </span>
          }>
          {open === s.id ? (
            <>
              <label>Syllabus (paste from college site or type)</label>
              <textarea rows={5} defaultValue={s.syllabus || ''} onBlur={e => patch(s.id, { syllabus: e.target.value })} />
              <div className="small muted mt">Auto-saves when you click away.</div>
            </>
          ) : (
            <div className="small" style={{ whiteSpace: 'pre-wrap', color: 'var(--ink-2)' }}>
              {(s.syllabus || '').slice(0, 220) || 'No syllabus yet — click Edit to paste it.'}
              {(s.syllabus || '').length > 220 && '…'}
            </div>
          )}
          <div className="flex mt">
            <button className="btn btn-sm btn-pink" onClick={() => requestNotes(s)} disabled={!s.syllabus}>
              ⚑ Request exam notes
            </button>
            {s.notes_status === 'requested' && <span className="chip c-yellow">notes: queued</span>}
            {s.notes_url && <a className="btn btn-sm btn-green" href={s.notes_url} target="_blank" rel="noreferrer">↓ Open notes</a>}
          </div>
        </Card>
      ))}
    </>
  );
}
