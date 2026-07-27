import React, { useEffect, useRef, useState } from 'react';
import { useCollection } from '../lib/hooks.js';
import { Card, Empty } from '../components/ui.jsx';
import * as db from '../lib/db.js';
import { extractText, ACCEPT } from '../lib/docextract.js';

export default function Subjects() {
  const { items, add, patch, del } = useCollection('subjects', { order: 'name', asc: true });
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [open, setOpen] = useState(null);

  // draft syllabus for whichever subject is open, so an uploaded file can fill it in
  const [draft, setDraft] = useState('');
  const [upload, setUpload] = useState({ busy: false, msg: '', err: '' });
  const fileRef = useRef(null);

  const openSubject = items.find(s => s.id === open);
  useEffect(() => {
    setDraft(openSubject?.syllabus || '');
    setUpload({ busy: false, msg: '', err: '' });
  }, [open]); // eslint-disable-line

  async function create() {
    if (!name.trim()) return;
    await add({ name: name.trim(), code: code.trim() || null, syllabus: '', attendance_pct: null, notes_url: null });
    setName(''); setCode('');
  }

  async function requestNotes(s) {
    await db.sendRequest('exam_notes', { subject_id: s.id, subject: s.name, syllabus: s.syllabus || '' });
    await patch(s.id, { notes_status: 'requested' });
  }

  async function onFile(e, s) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUpload({ busy: true, msg: `Reading ${file.name}…`, err: '' });
    try {
      const text = await extractText(file);
      if (!text) throw new Error('No readable text in that file — it may be a scan. Try a text PDF, or paste it below.');
      // append rather than overwrite, so an existing hand-typed syllabus isn't lost
      const merged = draft.trim() ? `${draft.trim()}\n\n— from ${file.name} —\n${text}` : text;
      setDraft(merged);
      await patch(s.id, { syllabus: merged });
      setUpload({ busy: false, msg: `Loaded ${file.name} · ${text.length.toLocaleString()} characters`, err: '' });
    } catch (err) {
      setUpload({ busy: false, msg: '', err: err.message || 'Could not read that file.' });
    }
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
              <div className="syl-drop">
                <input ref={fileRef} type="file" accept={ACCEPT} style={{ display: 'none' }} onChange={e => onFile(e, s)} />
                <button className="btn btn-purple" disabled={upload.busy} onClick={() => fileRef.current?.click()}>
                  {upload.busy ? '⏳ Reading…' : '⬆ Upload syllabus (PDF / Word)'}
                </button>
                <span className="small muted">
                  {upload.err
                    ? <span style={{ color: 'var(--red)' }}>{upload.err}</span>
                    : upload.msg || 'PDF, .docx or .txt — the text is pulled out on your device and dropped in below.'}
                </span>
              </div>

              <label className="mt">Syllabus (uploaded, pasted, or typed)</label>
              <textarea rows={7} value={draft}
                onChange={e => setDraft(e.target.value)}
                onBlur={e => patch(s.id, { syllabus: e.target.value })} />
              <div className="small muted mt">Auto-saves when you click away.</div>
            </>
          ) : (
            <div className="small" style={{ whiteSpace: 'pre-wrap', color: 'var(--ink-2)' }}>
              {(s.syllabus || '').slice(0, 220) || 'No syllabus yet — click Edit to upload or paste it.'}
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
