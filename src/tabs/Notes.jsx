import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Card, Empty } from '../components/ui.jsx';
import { useCollection } from '../lib/hooks.js';
import * as db from '../lib/db.js';
import Board from '../components/Board.jsx';
import LectureRecorder from '../components/LectureRecorder.jsx';
import { boardTitle, defaultBoardName, sortBoards } from '../lib/boards.js';

// NOTES — a drawing surface that keeps what you draw.
//
// What this replaced: a hand-rolled <canvas> with pen colours, page buttons and
// a PDF export. It looked like a notebook and behaved like a whiteboard in a
// room nobody owns — there was no table, no memory row, not even localStorage,
// so switching tabs threw the drawing away. The page controls made that worse by
// implying the opposite.
//
// Excalidraw replaces the canvas: real pressure handling for the Apple Pencil,
// shapes, text, selection, infinite scroll, and an export nobody has to
// maintain. It is loaded lazily inside components/Board.jsx — the reason is
// there — and each board is a row in `boards`.
//
// Pages are gone on purpose. They existed because a fixed-size canvas has to end
// somewhere; an infinite canvas does not, and "page 3 of 7" is a worse way to
// find last Tuesday's lecture than naming the board after it.

function loadJsPdf() {
  if (window.jspdf?.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    s.onload = () => res(window.jspdf.jsPDF);
    s.onerror = () => rej(new Error('Could not load the PDF library.'));
    document.head.appendChild(s);
  });
}

export default function Notes() {
  const { items: rows, refresh } = useCollection('boards', { order: 'updated_at' });
  const boards = sortBoards(rows);

  const [activeId, setActiveId] = useState(null);
  const [full, setFull] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [renaming, setRenaming] = useState(null);
  const exportRef = useRef(null);

  // Open the most recent board on arrival. Landing on a board list is a click
  // between you and the thing you came here to do.
  useEffect(() => {
    if (!activeId && boards.length) setActiveId(boards[0].id);
  }, [boards, activeId]);

  const active = boards.find(b => b.id === activeId) || null;

  const newBoard = useCallback(async () => {
    setBusy(true); setErr('');
    try {
      const row = await db.insert('boards', { name: defaultBoardName(), scene: { elements: [], appState: {} } });
      await refresh();
      // db.insert returns the row on the remote path and may not locally, so
      // fall back to reopening the newest rather than landing on nothing.
      setActiveId(Array.isArray(row) ? row[0]?.id : row?.id || null);
    } catch (e) { setErr(String(e.message || e)); }
    setBusy(false);
  }, [refresh]);

  async function rename(id, name) {
    setRenaming(null);
    const clean = String(name || '').trim();
    if (!clean) return;
    try { await db.update('boards', id, { name: clean, updated_at: new Date().toISOString() }); await refresh(); }
    catch (e) { setErr(String(e.message || e)); }
  }

  async function remove(id) {
    // No confirm dialog and no delete of a drawn board without one would be
    // reckless in opposite directions — so: confirm, then delete.
    if (!window.confirm('Delete this board? The drawing goes with it.')) return;
    try {
      await db.remove('boards', id);
      await refresh();
      setActiveId(prev => (prev === id ? null : prev));
    } catch (e) { setErr(String(e.message || e)); }
  }

  // Export uses Excalidraw's own exporters rather than reading pixels off the
  // canvas: the old version screenshotted a fixed 1600×1000 box, so anything
  // drawn outside it simply was not in the PDF.
  async function exportImage(kind) {
    if (!active) return;
    setBusy(true); setErr('');
    try {
      const mod = await import('@excalidraw/excalidraw');
      const elements = active.scene?.elements || [];
      if (!elements.length) { setErr('Nothing drawn on this board yet.'); setBusy(false); return; }
      const blob = await mod.exportToBlob({
        elements,
        appState: { ...(active.scene?.appState || {}), exportWithDarkMode: kind === 'png-dark' },
        files: null,
        mimeType: 'image/png',
        exportPadding: 24,
      });
      if (kind === 'pdf') {
        const JsPDF = await loadJsPdf();
        const url = URL.createObjectURL(blob);
        const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
        // Page shaped to the drawing, so a wide sketch is not squeezed onto A4
        // portrait with three inches of white space under it.
        const pdf = new JsPDF({ orientation: img.width >= img.height ? 'l' : 'p', unit: 'px', format: [img.width, img.height] });
        pdf.addImage(img, 'PNG', 0, 0, img.width, img.height);
        pdf.save(`${boardTitle(active).replace(/[^\w\- ]+/g, '')}.pdf`);
        URL.revokeObjectURL(url);
      } else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${boardTitle(active).replace(/[^\w\- ]+/g, '')}.png`;
        a.click();
        URL.revokeObjectURL(a.href);
      }
    } catch (e) { setErr(String(e.message || e)); }
    setBusy(false);
  }

  const surface = (
    <div className={`note-wrap${full ? ' note-full' : ''}`} ref={exportRef}>
      <div className="note-toolbar">
        <span className="flex" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {renaming === active?.id
            ? <input
                className="board-rename" autoFocus defaultValue={boardTitle(active)}
                onBlur={e => rename(active.id, e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') rename(active.id, e.currentTarget.value); if (e.key === 'Escape') setRenaming(null); }}
              />
            : <button className="btn btn-sm" onClick={() => active && setRenaming(active.id)} title="Rename">
                {active ? boardTitle(active) : 'No board'}
              </button>}
        </span>
        <span className="flex" style={{ gap: 6, marginLeft: 'auto', flexWrap: 'wrap' }}>
          <button className="btn btn-sm" disabled={!active || busy} onClick={() => exportImage('png')}>PNG</button>
          <button className="btn btn-sm btn-green" disabled={!active || busy} onClick={() => exportImage('pdf')}>Export PDF</button>
          <button className="btn btn-sm" onClick={() => setFull(f => !f)}>{full ? '✕ exit' : '⛶ full'}</button>
        </span>
      </div>
      {active
        ? <Board boardId={active.id} initialScene={active.scene} onSaved={refresh} />
        : <div className="board-canvas"><Empty icon="✍️" text="No board open — make one below." /></div>}
    </div>
  );

  return (
    <>
      {!full && <h1 className="tab-title">NOTES</h1>}
      {!full && <p className="tab-sub">Draw, record lectures, and turn them into study notes. ✍️🎙️</p>}
      {err && !full && <div className="small" style={{ color: 'var(--red)' }}>{err}</div>}

      {full ? surface : (
        <Card title="Board" color="var(--cyan)"
          right={<button className="btn btn-sm btn-cyan" onClick={newBoard} disabled={busy}>+ board</button>}>
          {surface}
          <div className="small muted mt">
            Apple Pencil works as-is — pressure, palm rejection, the lot. The canvas is infinite, so there are no
            pages; name a board after its lecture instead. Everything saves a couple of seconds after you stop drawing.
          </div>
        </Card>
      )}

      {!full && (
        <Card title="Boards" color="var(--purple)">
          {boards.length === 0 && <Empty icon="✍️" text="No boards yet. Hit + board to start one." />}
          {boards.map(b => (
            <div className={`row board-row${b.id === activeId ? ' on' : ''}`} key={b.id}>
              <span style={{ flex: 1, cursor: 'pointer' }} onClick={() => setActiveId(b.id)}>
                {boardTitle(b)}
                <span className="small muted"> · {(b.scene?.elements?.length || 0)} marks</span>
              </span>
              <button className="btn btn-sm" onClick={() => { setActiveId(b.id); setRenaming(b.id); }}>rename</button>
              <button className="btn btn-sm" onClick={() => remove(b.id)}>delete</button>
            </div>
          ))}
        </Card>
      )}

      {!full && <LectureRecorder />}

      {!full && (
        <Card title="GoodNotes / iPad export" color="var(--yellow)">
          <div className="small" style={{ color: 'var(--ink-2)', lineHeight: 1.5 }}>
            GoodNotes has no public write API, so notes can’t be pushed into it directly. <b>Export PDF</b> above and
            drop it into GoodNotes (or Files/Books) via the iOS Share sheet — the PDF is now sized to the drawing
            rather than to a fixed box, so nothing gets cropped.
          </div>
        </Card>
      )}
    </>
  );
}
