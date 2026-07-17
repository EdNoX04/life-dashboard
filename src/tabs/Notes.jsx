import React, { useEffect, useRef, useState } from 'react';
import { Card, Empty } from '../components/ui.jsx';

// Notes: handwriting canvas + lecture recorder → notes. SCAFFOLD: canvas draws and
// exports PNG; recorder captures audio + plays back. Transcript→summary (STT + LLM)
// and GoodNotes sync are wired in the deep build (see honest note below).
export default function Notes() {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const [color, setColor] = useState('#e84191');

  // recorder
  const [recState, setRecState] = useState('idle'); // idle | recording | done
  const [audioUrl, setAudioUrl] = useState(null);
  const mediaRec = useRef(null);
  const chunks = useRef([]);
  const [secs, setSecs] = useState(0);
  const timer = useRef(null);

  useEffect(() => {
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext('2d');
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const pos = e => { const r = c.getBoundingClientRect(); const t = e.touches?.[0] || e; return [(t.clientX - r.left) * (c.width / r.width), (t.clientY - r.top) * (c.height / r.height)]; };
    const down = e => { drawing.current = true; const [x, y] = pos(e); ctx.beginPath(); ctx.moveTo(x, y); e.preventDefault(); };
    const move = e => { if (!drawing.current) return; const [x, y] = pos(e); ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.lineTo(x, y); ctx.stroke(); e.preventDefault(); };
    const up = () => { drawing.current = false; };
    c.addEventListener('pointerdown', down); c.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    return () => { c.removeEventListener('pointerdown', down); c.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [color]);

  const clearCanvas = () => { const c = canvasRef.current; c.getContext('2d').clearRect(0, 0, c.width, c.height); };
  const exportPng = () => { const a = document.createElement('a'); a.href = canvasRef.current.toDataURL('image/png'); a.download = 'note.png'; a.click(); };

  async function startRec() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunks.current = [];
      const mr = new MediaRecorder(stream); mediaRec.current = mr;
      mr.ondataavailable = e => chunks.current.push(e.data);
      mr.onstop = () => { setAudioUrl(URL.createObjectURL(new Blob(chunks.current, { type: 'audio/webm' }))); stream.getTracks().forEach(t => t.stop()); };
      mr.start(); setRecState('recording'); setSecs(0);
      timer.current = setInterval(() => setSecs(s => s + 1), 1000);
    } catch { setRecState('idle'); }
  }
  const stopRec = () => { mediaRec.current?.stop(); clearInterval(timer.current); setRecState('done'); };

  return (
    <>
      <h1 className="tab-title">NOTES</h1>
      <p className="tab-sub">Write, record lectures, and turn them into study notes. ✍️🎙️</p>

      <Card title="Handwriting" color="var(--cyan)" right={
        <span className="flex" style={{ gap: 6 }}>
          {['#e84191', '#4fd1ff', '#2fd06b', '#ffd23f', '#fff'].map(c => <button key={c} onClick={() => setColor(c)} style={{ width: 20, height: 20, background: c, border: color === c ? '2px solid #fff' : '2px solid var(--border)', cursor: 'pointer' }} />)}
        </span>}>
        <canvas ref={canvasRef} width={900} height={420} className="note-canvas" />
        <div className="flex mt" style={{ gap: 8 }}>
          <button className="btn btn-sm" onClick={clearCanvas}>Clear</button>
          <button className="btn btn-sm btn-green" onClick={exportPng}>Export PNG</button>
        </div>
        <div className="small muted mt">Write with Apple Pencil on iPad. Deep build: multi-page notebooks, save to your dashboard, and PDF export.</div>
      </Card>

      <Card title="Lecture recorder → notes" color="var(--pink)">
        <div className="flex" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {recState !== 'recording'
            ? <button className="btn btn-pink" onClick={startRec}>● Record</button>
            : <button className="btn" onClick={stopRec}>■ Stop ({Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')})</button>}
          {recState === 'recording' && <span className="rc-live"><span className="rc-dot" />REC</span>}
        </div>
        {audioUrl && <audio controls src={audioUrl} style={{ width: '100%', marginTop: 10 }} />}
        <Empty icon="✦" text="Deep build: the recording is transcribed (speech-to-text) and an AI condenses it into key points / a summary, saved as study notes and linked to your Subjects." />
      </Card>

      <Card title="GoodNotes / iPad sync" color="var(--yellow)">
        <div className="small" style={{ color: 'var(--ink-2)', lineHeight: 1.5 }}>
          Honest note: GoodNotes has <b>no public API</b> to write notes into it, and iCloud has no third-party
          write access — so true auto-save into GoodNotes isn't possible. What we <i>can</i> do: export your
          notes as PDF/image and drop them into GoodNotes via the iOS Share sheet (one tap), or keep notes here
          in the dashboard. We'll wire the cleanest export flow in the deep build.
        </div>
      </Card>
    </>
  );
}
