import React, { useEffect, useRef, useState } from 'react';
import { Card } from '../components/ui.jsx';

// Handwriting notebook (pages, black/white board, full-screen, PDF export) +
// lecture recorder with LIVE transcription via the browser Web Speech API
// (free, no key). When an AI key is added, the transcript → summary lights up.
const W = 1600, H = 1000;
const PENS = [
  { c: '#e84191', n: 'pink' }, { c: '#4fd1ff', n: 'cyan' }, { c: '#2fd06b', n: 'green' },
  { c: '#ffd23f', n: 'yellow' }, { c: '#5b7a99', n: 'blue-grey' }, { c: '#ffffff', n: 'white' }, { c: '#14141c', n: 'black' },
];
const SIZES = [2, 4, 8];

function loadJsPdf() {
  return new Promise((res, rej) => {
    if (window.jspdf?.jsPDF) return res(window.jspdf.jsPDF);
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    s.onload = () => res(window.jspdf.jsPDF); s.onerror = () => rej(new Error('pdf lib'));
    document.head.appendChild(s);
  });
}
const loadImg = src => new Promise(r => { if (!src) return r(null); const i = new Image(); i.onload = () => r(i); i.onerror = () => r(null); i.src = src; });

export default function Notes() {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const [color, setColor] = useState('#4fd1ff');
  const [size, setSize] = useState(4);
  const [eraser, setEraser] = useState(false);
  const [board, setBoard] = useState('black'); // black | white
  const [full, setFull] = useState(false);
  const [pages, setPages] = useState(['']);
  const [pageIdx, setPageIdx] = useState(0);

  // recorder + live transcript
  const [recState, setRecState] = useState('idle'); // idle | recording | done
  const [audioUrl, setAudioUrl] = useState(null);
  const [secs, setSecs] = useState(0);
  const [transcript, setTranscript] = useState('');
  const [interim, setInterim] = useState('');
  const [srSupported, setSrSupported] = useState(true);
  const mediaRec = useRef(null), chunks = useRef([]), timer = useRef(null), recog = useRef(null), active = useRef(false);

  // ---- drawing ----
  useEffect(() => {
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext('2d'); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const pos = e => { const r = c.getBoundingClientRect(); const t = e.touches?.[0] || e; return [(t.clientX - r.left) * (c.width / r.width), (t.clientY - r.top) * (c.height / r.height)]; };
    const down = e => { drawing.current = true; const [x, y] = pos(e); ctx.beginPath(); ctx.moveTo(x, y); e.preventDefault(); };
    const move = e => {
      if (!drawing.current) return; const [x, y] = pos(e);
      if (eraser) { ctx.globalCompositeOperation = 'destination-out'; ctx.lineWidth = size * 9; }
      else { ctx.globalCompositeOperation = 'source-over'; ctx.strokeStyle = color; ctx.lineWidth = size; }
      ctx.lineTo(x, y); ctx.stroke(); e.preventDefault();
    };
    const up = () => { drawing.current = false; };
    c.addEventListener('pointerdown', down); c.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    return () => { c.removeEventListener('pointerdown', down); c.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [color, size, eraser]);

  // load the active page image when the page changes
  useEffect(() => {
    const c = canvasRef.current; if (!c) return; const ctx = c.getContext('2d');
    ctx.globalCompositeOperation = 'source-over'; ctx.clearRect(0, 0, W, H);
    const data = pages[pageIdx];
    if (data) { const img = new Image(); img.onload = () => ctx.drawImage(img, 0, 0, W, H); img.src = data; }
  }, [pageIdx]); // eslint-disable-line

  const snapshot = () => { const c = canvasRef.current; return c ? c.toDataURL('image/png') : ''; };
  const saveCurrent = () => { const url = snapshot(); setPages(p => { const n = [...p]; n[pageIdx] = url; return n; }); return url; };
  const goPage = idx => { saveCurrent(); setPageIdx(idx); };
  const addPage = () => { const url = snapshot(); setPages(p => { const n = [...p]; n[pageIdx] = url; n.push(''); return n; }); setPageIdx(pages.length); };
  const clearPage = () => { const c = canvasRef.current; const ctx = c.getContext('2d'); ctx.globalCompositeOperation = 'source-over'; ctx.clearRect(0, 0, W, H); setPages(p => { const n = [...p]; n[pageIdx] = ''; return n; }); };
  const toggleBoard = () => { setBoard(b => { const nb = b === 'black' ? 'white' : 'black'; setColor(c => nb === 'white' && (c === '#ffffff') ? '#14141c' : nb === 'black' && c === '#14141c' ? '#4fd1ff' : c); return nb; }); };

  async function exportPdf() {
    saveCurrent();
    const all = pages.map((d, i) => (i === pageIdx ? snapshot() : d));
    try {
      const JsPDF = await loadJsPdf();
      const pdf = new JsPDF({ orientation: 'landscape', unit: 'px', format: [W, H] });
      const bg = board === 'white' ? '#ffffff' : '#12091b';
      for (let i = 0; i < all.length; i++) {
        const img = await loadImg(all[i]);
        const tmp = document.createElement('canvas'); tmp.width = W; tmp.height = H;
        const tc = tmp.getContext('2d'); tc.fillStyle = bg; tc.fillRect(0, 0, W, H);
        if (img) tc.drawImage(img, 0, 0, W, H);
        if (i > 0) pdf.addPage([W, H], 'landscape');
        pdf.addImage(tmp.toDataURL('image/png'), 'PNG', 0, 0, W, H);
      }
      pdf.save('notes.pdf');
    } catch { alert('Could not build the PDF — check your connection.'); }
  }
  function exportPng() {
    const tmp = document.createElement('canvas'); tmp.width = W; tmp.height = H;
    const tc = tmp.getContext('2d'); tc.fillStyle = board === 'white' ? '#ffffff' : '#12091b'; tc.fillRect(0, 0, W, H);
    const c = canvasRef.current; tc.drawImage(c, 0, 0);
    const a = document.createElement('a'); a.href = tmp.toDataURL('image/png'); a.download = `note-${pageIdx + 1}.png`; a.click();
  }

  // ---- recorder + live transcription ----
  async function startRec() {
    setTranscript(''); setInterim('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunks.current = [];
      const mr = new MediaRecorder(stream); mediaRec.current = mr;
      mr.ondataavailable = e => chunks.current.push(e.data);
      mr.onstop = () => { setAudioUrl(URL.createObjectURL(new Blob(chunks.current, { type: 'audio/webm' }))); stream.getTracks().forEach(t => t.stop()); };
      mr.start(); setRecState('recording'); setSecs(0); active.current = true;
      timer.current = setInterval(() => setSecs(s => s + 1), 1000);
    } catch { setRecState('idle'); return; }
    // live transcript — Web Speech API (continuous + auto-restart on silence)
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setSrSupported(false); return; }
    const r = new SR(); recog.current = r; r.continuous = true; r.interimResults = true; r.lang = 'en-IN';
    r.onresult = e => {
      let fin = '', inte = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) fin += t + ' '; else inte += t;
      }
      if (fin) setTranscript(p => p + fin);
      setInterim(inte);
    };
    r.onend = () => { if (active.current) { try { r.start(); } catch {} } };
    try { r.start(); } catch {}
  }
  function stopRec() {
    active.current = false;
    mediaRec.current?.stop(); clearInterval(timer.current);
    try { recog.current?.stop(); } catch {}
    setInterim(''); setRecState('done');
  }

  const Board = (
    <div className={`note-wrap${full ? ' note-full' : ''}`}>
      <div className="note-toolbar">
        <span className="flex" style={{ gap: 6, flexWrap: 'wrap' }}>
          {PENS.map(p => (
            <button key={p.c} title={p.n} onClick={() => { setColor(p.c); setEraser(false); }}
              className={`note-pen${color === p.c && !eraser ? ' on' : ''}`} style={{ background: p.c }} />
          ))}
          <button className={`btn btn-sm${eraser ? ' btn-pink' : ''}`} onClick={() => setEraser(e => !e)}>⌫ erase</button>
          <span className="note-sizes">{SIZES.map(s => <button key={s} className={`note-size${size === s && !eraser ? ' on' : ''}`} onClick={() => { setSize(s); setEraser(false); }}><i style={{ width: s + 2, height: s + 2 }} /></button>)}</span>
        </span>
        <span className="flex" style={{ gap: 6, marginLeft: 'auto', flexWrap: 'wrap' }}>
          <button className="btn btn-sm" onClick={toggleBoard}>{board === 'black' ? '◻ white' : '◼ dark'}</button>
          <button className="btn btn-sm" onClick={() => setFull(f => !f)}>{full ? '✕ exit' : '⛶ full'}</button>
        </span>
      </div>
      <canvas ref={canvasRef} width={W} height={H} className={`note-canvas ${board}`} />
      <div className="note-pagebar">
        <button className="btn btn-sm" disabled={pageIdx === 0} onClick={() => goPage(pageIdx - 1)}>◀</button>
        <span className="note-pageno">Page {pageIdx + 1} / {pages.length}</span>
        <button className="btn btn-sm" disabled={pageIdx >= pages.length - 1} onClick={() => goPage(pageIdx + 1)}>▶</button>
        <button className="btn btn-sm btn-cyan" onClick={addPage}>+ page</button>
        <span style={{ flex: 1 }} />
        <button className="btn btn-sm" onClick={clearPage}>clear</button>
        <button className="btn btn-sm" onClick={exportPng}>PNG</button>
        <button className="btn btn-sm btn-green" onClick={exportPdf}>Export PDF</button>
      </div>
    </div>
  );

  return (
    <>
      <h1 className="tab-title">NOTES</h1>
      <p className="tab-sub">Write, record lectures, and turn them into study notes. ✍️🎙️</p>

      {full ? Board : <Card title="Handwriting" color="var(--cyan)">{Board}<div className="small muted mt">Write with Apple Pencil on iPad. Tap ⛶ full for max space; ◻/◼ toggles the board; multi-page + PDF export built in.</div></Card>}

      <Card title="Lecture recorder → notes" color="var(--pink)"
        right={recState === 'recording' ? <span className="rc-live"><span className="rc-dot" />REC {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}</span> : null}>
        <div className="flex" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {recState !== 'recording'
            ? <button className="btn btn-pink" onClick={startRec}>● Record</button>
            : <button className="btn" onClick={stopRec}>■ Stop</button>}
          {transcript && recState !== 'recording' && <button className="btn btn-sm" onClick={() => navigator.clipboard?.writeText(transcript)}>⧉ Copy transcript</button>}
        </div>
        {(transcript || interim) && (
          <div className="note-transcript">
            {transcript}<span className="muted">{interim}</span>
            {recState === 'recording' && <span className="note-caret">▌</span>}
          </div>
        )}
        {!srSupported && <div className="small mt" style={{ color: 'var(--yellow)' }}>Live transcription needs Chrome (or Safari 16+). The audio is still recorded and playable below.</div>}
        {audioUrl && <audio controls src={audioUrl} style={{ width: '100%', marginTop: 10 }} />}
        <div className="small muted mt">
          Live transcription runs on-device via your browser — no key needed. When you add an AI key in Settings, a
          "Summarize → study notes" button turns this transcript into key points linked to your Subjects.
        </div>
      </Card>

      <Card title="GoodNotes / iPad export" color="var(--yellow)">
        <div className="small" style={{ color: 'var(--ink-2)', lineHeight: 1.5 }}>
          GoodNotes has no public write API, so notes can't be pushed into it directly. Instead, <b>Export PDF</b>
          {' '}above and drop it into GoodNotes (or Files/Books) via the iOS Share sheet in one tap — pages and all.
        </div>
      </Card>
    </>
  );
}
