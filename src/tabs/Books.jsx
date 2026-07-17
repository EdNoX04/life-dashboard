import React, { useEffect, useRef, useState } from 'react';
import { Card, Empty } from '../components/ui.jsx';

// Speechify-style listen-to-your-books. SCAFFOLD: text-to-speech is FUNCTIONAL for
// pasted/.txt text (browser voices + speed). epub/pdf parsing and premium neural
// voices (ElevenLabs-style) are wired in the deep build.
export default function Books() {
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [voices, setVoices] = useState([]);
  const [voiceIdx, setVoiceIdx] = useState(0);
  const [rate, setRate] = useState(1);
  const [pitch, setPitch] = useState(1);
  const [state, setState] = useState('idle'); // idle | playing | paused
  const fileRef = useRef(null);

  useEffect(() => {
    const load = () => setVoices(window.speechSynthesis ? window.speechSynthesis.getVoices() : []);
    load();
    if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = load;
    return () => window.speechSynthesis && window.speechSynthesis.cancel();
  }, []);

  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  function onFile(e) {
    const f = e.target.files?.[0]; if (!f) return;
    setTitle(f.name.replace(/\.[^.]+$/, ''));
    if (f.name.endsWith('.txt')) { const r = new FileReader(); r.onload = () => setText(String(r.result).slice(0, 200000)); r.readAsText(f); }
    else setText(`[${f.name}] — ${f.name.endsWith('.epub') ? 'EPUB' : 'PDF'} parsing lands in the deep build (epub.js / pdf.js). For now paste text below to listen.`);
  }
  function play() {
    if (!supported || !text.trim()) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (voices[voiceIdx]) u.voice = voices[voiceIdx];
    u.rate = rate; u.pitch = pitch;
    u.onend = () => setState('idle');
    window.speechSynthesis.speak(u); setState('playing');
  }
  const pause = () => { window.speechSynthesis.pause(); setState('paused'); };
  const resume = () => { window.speechSynthesis.resume(); setState('playing'); };
  const stop = () => { window.speechSynthesis.cancel(); setState('idle'); };

  return (
    <>
      <h1 className="tab-title">BOOKS</h1>
      <p className="tab-sub">Turn any book into audio — listen instead of read. 🎧📖</p>

      <Card title="Library" color="var(--pink)" right={<button className="btn btn-sm btn-pink" onClick={() => fileRef.current?.click()}>+ Upload</button>}>
        <input ref={fileRef} type="file" accept=".epub,.pdf,.txt" style={{ display: 'none' }} onChange={onFile} />
        <Empty icon="📚" text="Upload an EPUB, PDF or TXT. Your shelf of books lives here — full epub/pdf parsing + resume-where-you-left-off come in the deep build." />
      </Card>

      <Card title={title ? `Now: ${title}` : 'Listen'} color="var(--purple)">
        {!supported && <div className="small" style={{ color: 'var(--red)' }}>This browser has no text-to-speech. Try Chrome/Safari.</div>}
        <textarea className="book-text" placeholder="Paste text (or upload a .txt) to listen…" value={text} onChange={e => setText(e.target.value)} />
        <div className="flex mt" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <select className="sel" value={voiceIdx} onChange={e => setVoiceIdx(+e.target.value)}>
            {voices.length === 0 && <option>Default voice</option>}
            {voices.map((v, i) => <option key={i} value={i}>{v.name} ({v.lang})</option>)}
          </select>
          <label className="small muted">Speed {rate.toFixed(1)}×<input type="range" min="0.5" max="2" step="0.1" value={rate} onChange={e => setRate(+e.target.value)} /></label>
          <label className="small muted">Pitch<input type="range" min="0" max="2" step="0.1" value={pitch} onChange={e => setPitch(+e.target.value)} /></label>
        </div>
        <div className="flex mt" style={{ gap: 8 }}>
          {state !== 'playing' && <button className="btn btn-green" onClick={state === 'paused' ? resume : play} disabled={!text.trim()}>▶ {state === 'paused' ? 'Resume' : 'Listen'}</button>}
          {state === 'playing' && <button className="btn" onClick={pause}>❚❚ Pause</button>}
          <button className="btn" onClick={stop} disabled={state === 'idle'}>■ Stop</button>
        </div>
        <div className="small muted mt">Uses your device's voices now. Premium natural voices + expression (Speechify-grade) come via a TTS API in the deep build.</div>
      </Card>
    </>
  );
}
