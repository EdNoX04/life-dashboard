import React, { useEffect, useRef, useState } from 'react';
import { Card, Empty } from '../components/ui.jsx';

// Cozy "Virtual Cottage" study room — pomodoro + ambience + lofi + your materials.
// SCAFFOLD: pomodoro is fully functional; ambience/lofi are wired as UI, audio sources
// get hooked up in the deep-build pass.
const AMBIENT = [
  { key: 'rain', label: 'Rain', icon: '🌧' },
  { key: 'fire', label: 'Fireplace', icon: '🔥' },
  { key: 'snow', label: 'Snowfall', icon: '❄' },
  { key: 'noise', label: 'White noise', icon: '📻' },
  { key: 'forest', label: 'Forest', icon: '🌲' },
  { key: 'cafe', label: 'Café', icon: '☕' },
  { key: 'waves', label: 'Ocean', icon: '🌊' },
  { key: 'night', label: 'Night', icon: '🦗' },
];
const DUR = { focus: 25 * 60, short: 5 * 60, long: 15 * 60 };
const fmt = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

export default function Study({ go }) {
  const [mode, setMode] = useState('focus'); // focus | short | long
  const [secs, setSecs] = useState(DUR.focus);
  const [running, setRunning] = useState(false);
  const [rounds, setRounds] = useState(0);
  const [ambient, setAmbient] = useState({}); // {key:true}
  const [vol, setVol] = useState(60);
  const tick = useRef(null);

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
  const toggleAmb = k => setAmbient(a => ({ ...a, [k]: !a[k] }));

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
            <input type="range" min="0" max="100" value={vol} onChange={e => setVol(+e.target.value)} style={{ flex: 1 }} />
            <span className="small">{vol}</span>
          </div>
          <div className="small muted mt">Mix as many as you like. (Audio loops get wired in the deep build.)</div>
        </Card>
      </div>

      <Card title="Lofi beats" color="var(--purple)">
        <Empty icon="♪" text="A lofi stream (music only — think lofi-girl radio) plays here. Play/skip controls + a tiny pixel visualizer coming in the build pass." />
      </Card>

      <Card title="Your study material" color="var(--yellow)" right={<button className="btn btn-sm" onClick={() => go('subjects')}>Subjects →</button>}>
        <div className="small" style={{ color: 'var(--ink-2)', lineHeight: 1.5 }}>
          Pull a subject's generated HTML notes right into this room so you can revise while a timer runs.
          This links to your Subjects tab (where uploads → notes already live).
        </div>
      </Card>
    </>
  );
}
