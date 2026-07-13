import React, { useRef, useState } from 'react';
import { useCollection } from '../lib/hooks.js';
import { Card, Empty } from '../components/ui.jsx';

const MOODS = ['😄', '🙂', '😐', '😔', '😤'];

export default function Journal() {
  const { items, add, del } = useCollection('journal');
  const [text, setText] = useState('');
  const [mood, setMood] = useState('🙂');
  const [listening, setListening] = useState(false);
  const recRef = useRef(null);

  const canVoice = typeof window !== 'undefined' &&
    (window.SpeechRecognition || window.webkitSpeechRecognition);

  function toggleVoice() {
    if (listening) { recRef.current?.stop(); return; }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();
    rec.lang = 'en-IN';
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = e => {
      let chunk = '';
      for (let i = e.resultIndex; i < e.results.length; i++)
        if (e.results[i].isFinal) chunk += e.results[i][0].transcript + ' ';
      if (chunk) setText(t => (t ? t + ' ' : '') + chunk.trim());
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    rec.start();
    setListening(true);
  }

  async function save() {
    if (!text.trim()) return;
    await add({ content: text.trim(), mood });
    setText('');
  }

  return (
    <>
      <h1 className="tab-title">JOURNAL</h1>
      <p className="tab-sub">Speak or type — logged as text, forever searchable.</p>

      <Card title="New entry" color="var(--pink)">
        <textarea rows={4} placeholder="What's on your mind?" value={text} onChange={e => setText(e.target.value)} />
        <div className="flex mt" style={{ flexWrap: 'wrap' }}>
          <span className="flex" style={{ gap: 6 }}>
            {MOODS.map(m => (
              <button key={m} className={`btn btn-sm ${mood === m ? 'btn-pink' : ''}`} onClick={() => setMood(m)} style={{ fontSize: 14 }}>{m}</button>
            ))}
          </span>
          <span style={{ flex: 1 }} />
          {canVoice ? (
            <button className={`btn ${listening ? 'btn-pink' : 'btn-cyan'}`} onClick={toggleVoice}>
              {listening ? '■ Stop mic' : '🎙 Voice'}
            </button>
          ) : (
            <span className="chip">voice: use Safari/Chrome</span>
          )}
          <button className="btn btn-green" onClick={save}>Save</button>
        </div>
      </Card>

      <Card title={`Entries (${items.length})`}>
        {items.length === 0 && <Empty icon="✎" text="No entries yet. Day one starts now." />}
        {items.map(e => (
          <div className="row" key={e.id} style={{ alignItems: 'flex-start' }}>
            <span style={{ fontSize: 22 }}>{e.mood || '·'}</span>
            <span style={{ flex: 1, whiteSpace: 'pre-wrap' }}>{e.content}</span>
            <span className="chip c-purple">{(e.created_at || '').slice(0, 10)}</span>
            <button className="btn btn-sm" onClick={() => del(e.id)}>✕</button>
          </div>
        ))}
      </Card>
    </>
  );
}
