import React, { useEffect, useRef, useState } from 'react';
import { Card, Empty } from '../components/ui.jsx';
import { useCollection } from '../lib/hooks.js';
import LofiRadio from '../components/LofiRadio.jsx';
import * as amb from '../lib/ambient.js';
import * as pomo from '../lib/pomodoro.js';

// Cozy study room: functional pomodoro, procedural ambience, a lofi radio (audio only),
// and your subject notes pulled in to revise while a timer runs.
const AMBIENT = ['rain', 'thunder', 'fire', 'wind', 'forest', 'waves', 'river', 'cafe', 'night', 'birds', 'noise']
  .map(k => ({ key: k, ...amb.SOUNDS[k] }));
// Lofi Girl live streams (audio only, played via YouTube IFrame API)
const STUDY_STATIONS = [
  { id: 'jfKfPfyJRdk', label: 'Lofi' },
  { id: '4xDzrJKXOOY', label: 'Synth' },
  { id: 'E2vONfzoyRI', label: 'Jazz' },
];
const DUR = pomo.DUR;
const fmt = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

export default function Study({ go }) {
  // The timer state lives in lib/pomodoro.js, at module scope, for the same
  // reason the ambience does: this component unmounts every time you look at
  // another tab, and a running timer must not care. `tick` below only forces a
  // repaint — it is not what makes time pass, so it can be missed, throttled or
  // stopped without the clock drifting.
  const [pomoState, setPomoState] = useState(pomo.get);
  const [, repaint] = useState(0);
  const { mode, rounds, running } = pomoState;
  const secs = pomo.remaining(pomoState);
  // ambience state is global (src/lib/ambient.js) so it keeps playing across tabs
  const { keys: ambKeys, vol: ambVol } = amb.useAmbient();
  const vol = Math.round(ambVol * 100);
  const tick = useRef(null);

  const { items: subjects } = useCollection('subjects', { order: 'name', asc: true });
  const withNotes = subjects.filter(s => s.notes_url);
  const [openNotes, setOpenNotes] = useState(null);

  // Any change made anywhere - including by a settle() on read after the tab was
  // closed - lands here.
  useEffect(() => pomo.subscribe(setPomoState), []);

  useEffect(() => {
    if (!running) { clearInterval(tick.current); return; }
    tick.current = setInterval(() => {
      // Re-read rather than decrement. If the browser throttled this to once a
      // minute the display jumps a minute, which is honest; the previous code
      // would have counted one second and quietly lost fifty-nine.
      const st = pomo.get();
      if (!st.running) return;          // settle() ended it; the subscription repaints
      repaint(n => n + 1);
    }, 1000);
    return () => clearInterval(tick.current);
  }, [running]);

  // Coming back to the tab: catch up immediately instead of waiting for the
  // next interval tick, which on a restored background tab can be a while.
  useEffect(() => {
    const wake = () => { pomo.get(); repaint(n => n + 1); };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    return () => {
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('focus', wake);
    };
  }, []);

  const setM = m => pomo.set(st => pomo.setMode(st, m));
  const pct = 100 - Math.round((secs / DUR[mode]) * 100);
  const ringColor = mode === 'focus' ? 'var(--pink)' : 'var(--green)';
  const toggleAmb = k => amb.toggle(k);
  const setVolume = v => amb.setMasterVolume(v / 100);

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
            <button className={`btn ${running ? '' : 'btn-green'}`}
              onClick={() => pomo.set(st => (st.running ? pomo.pause(st) : pomo.start(st)))}>
              {running ? '❚❚ Pause' : '▶ Start'}
            </button>
            <button className="btn" onClick={() => pomo.set(st => pomo.reset(st))}>↺ Reset</button>
          </div>
          <div className="small muted mt" style={{ textAlign: 'center' }}>🍅 {rounds} focus rounds</div>
          {/* A session that ran out while you were elsewhere. Said out loud,
              because the alternative is a timer that silently presents a fresh
              block as though the last one never happened. */}
          {pomoState.finished && !running && (
            <div className="small mt" style={{ textAlign: 'center', color: 'var(--green)' }}>
              {pomo.MODE_LABEL[pomoState.finished.mode]} finished
              {' '}{new Date(pomoState.finished.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
              {' '}— {pomo.MODE_LABEL[mode].toLowerCase()} is loaded and waiting.
            </div>
          )}
        </Card>

        <Card title="Ambience" color="var(--cyan)">
          <div className="amb-grid">
            {AMBIENT.map(a => (
              <button key={a.key} className={`amb-tile${ambKeys.includes(a.key) ? ' on' : ''}`} onClick={() => toggleAmb(a.key)}>
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
          <div className="small muted mt">Mix as many as you like — they keep playing when you switch tabs, with controls next to your XP bar.</div>
        </Card>
      </div>

      <Card title="Lofi radio" color="var(--purple)">
        <LofiRadio stations={STUDY_STATIONS} source="study" />
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
