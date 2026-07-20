import React, { useEffect, useRef, useState } from 'react';
import { Card, Empty } from '../components/ui.jsx';
import { useCollection } from '../lib/hooks.js';
import LofiRadio from '../components/LofiRadio.jsx';
import * as amb from '../lib/ambient.js';

// Cozy study room: functional pomodoro, procedural ambience, a lofi radio (audio only),
// and your subject notes pulled in to revise while a timer runs.
const AMBIENT = ['rain', 'thunder', 'fire', 'wind', 'forest', 'waves', 'river', 'cafe', 'night', 'birds', 'noise']
  .map(k => ({ key: k, ...amb.SOUNDS[k] }));
const STUDY_STATIONS = [
  { url: 'https://ice1.somafm.com/fluid-128-mp3', label: 'Lofi beats' },
  { url: 'https://ice1.somafm.com/groovesalad-128-mp3', label: 'Groove' },
  { url: 'https://ice1.somafm.com/beatblender-128-mp3', label: 'Beats' },
];
const DUR = { focus: 25 * 60, short: 5 * 60, long: 15 * 60 };
const fmt = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

export default function Study({ go }) {
  const [mode, setMode] = useState('focus');
  const [secs, setSecs] = useState(DUR.focus);
  const [running, setRunning] = useState(false);
  const [rounds, setRounds] = useState(0);
  const [ambient, setAmbient] = useState({});
  const [vol, setVol] = useState(60);
  const tick = useRef(null);

  const { items: subjects } = useCollection('subjects', { order: 'name', asc: true });
  const withNotes = subjects.filter(s => s.notes_url);
  const [openNotes, setOpenNotes] = useState(null);

  useEffect(() => () => amb.stopAll(), []);

  useEffect(() => {
    if (!running) { clearInterval(tick.current); return; }
    tick.current = setInterval(() => setSecs(s => {
      if (s <= 1) {
        const next = mode === 'focus' ? ((rounds + 1) % 4 === 0 ? 'long' : 'short') : 'focus';
        if (mode === 'focus') setRounds(r => r + 1);
        setMode(next); return DUR[next];
      }
      return s - 1;
    }), 1000);
    return () => clearInterval(tick.current);
  }, [running, mode, rounds]);

  const setM = m => { setMode(m); setSecs(DUR[m]); setRunning(false); };
  const pct = 100 - Math.round((secs / DUR[mode]) * 100);
  const ringColor = mode === 'focus' ? 'var(--pink)' : 'var(--green)';
  const toggleAmb = k => { const on = amb.toggle(k); setAmbient(a => ({ ...a, [k]: on })); };
  const setVolume = v => { setVol(v); amb.setMasterVolume(v / 100); };

  return (
    <>
      <h1 className="tab-title">STUDY ROOM</h1>
      <p className="tab-sub">A quiet corner — set a timer, pick your rain, open your notes. 🏡</p>

      <div className="grid2">
        <Card title="Pomodoro" color={ringColor}>
          <div className="flex" style={{ gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
            {[['focus', 'Focus'], ['short', 'Short break'], ['long', 'Long break']].map(([m, l]) => (
              <button key={m} className={`btn btn-sm ${mode === m ? 'btn-pink' : ''}`} onClick={() => setM(m)}>{l}</button>
            ))}
          </div>
          <div className="flex" style={{ justifyContent: 'center' }}>
            <div className="pomo-ring" style={{ '--c': ringColor, '--p': pct }}>
              <div className="pomo-inner">
                <div className="pomo-time">{fmt(secs)}</div>
                <div className="pomo-mode">{mode === 'focus' ? 'FOCUS' : 'BREAK'}</div>
              </div>
            </div>
          </div>
          <div className="flex" style={{ justifyContent: 'center', gap: 8, marginTop: 12 }}>
            <button className={`btn ${running ? '' : 'btn-green'}`} onClick={() => setRunning(r => !r)}>{running ? '❚❚ Pause' : '▶ Start'}</button>
            <button className="btn" onClick={() => { setSecs(DUR[mode]); setRunning(false); }}>↺ Reset</button>
          </div>
          <div className="small muted mt" style={{ textAlign: 'center' }}>🍅 {rounds} focus rounds today</div>
        </Card>

        <Card title="Ambience" color="var(--cyan)">
          <div className="amb-grid">
            {AMBIENT.map(a => (
              <button key={a.key} className={`amb-tile${ambient[a.key] ? ' on' : ''}`} onClick={() => toggleAmb(a.key)}>
                <span className="amb-ico">{a.icon}</span>
                <span className="amb-lbl">{a.label}</span>
              </button>
            ))}
          </div>
          <div className="flex mt" style={{ gap: 8, alignItems: 'center' }}>
            <span className="small muted">VOL</span>
            <input type="range" min="0" max="100" value={vol} onChange={e => setVolume(+e.target.value)} style={{ flex: 1 }} />
            <span className="small">{vol}</span>
          </div>
          <div className="small muted mt">Mix as many as you like — all synthesized live, so it works offline.</div>
        </Card>
      </div>

      <Card title="Lofi radio" color="var(--purple)">
        <LofiRadio stations={STUDY_STATIONS} />
      </Card>

      <Card title="Your study material" color="var(--yellow)" right={<button className="btn btn-sm" onClick={() => go('subjects')}>Subjects →</button>}>
        {withNotes.length === 0
          ? <Empty icon="✎" text="Generate HTML notes for a subject in the Subjects tab and they'll show up here to revise while your timer runs." />
          : (
            <>
              <div className="flex" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                {withNotes.map(s => (
                  <button key={s.id} className={`btn btn-sm ${openNotes === s.id ? 'btn-yellow' : ''}`} onClick={() => setOpenNotes(openNotes === s.id ? null : s.id)}>{s.name}</button>
                ))}
              </div>
              {openNotes && (
                <div className="notes-frame">
                  <iframe title="notes" src={withNotes.find(s => s.id === openNotes)?.notes_url} style={{ width: '100%', height: 460, border: 'none', background: '#fff' }} loading="lazy" />
                </div>
              )}
            </>
          )}
      </Card>
    </>
  );
}
