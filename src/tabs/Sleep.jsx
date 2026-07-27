import React from 'react';
import { Card } from '../components/ui.jsx';
import LofiRadio from '../components/LofiRadio.jsx';
import * as amb from '../lib/ambient.js';
import * as radio from '../lib/radio.js';

// Wind-down room — sleep lofi (Lofi Girl "beats to sleep/chill to"), calming ambience,
// and a sleep timer that fades everything out so you can drift off.
// Lofi Girl live streams (audio only, played via YouTube IFrame API)
const SLEEP_STATIONS = [
  { id: 'JD-kMIpDfnY', label: 'Sleep' },
  { id: 'E2vONfzoyRI', label: 'Jazz' },
  { id: 'jfKfPfyJRdk', label: 'Lofi' },
];
const CALM = ['rain', 'thunder', 'waves', 'river', 'wind', 'fire', 'night']
  .map(k => ({ key: k, ...amb.SOUNDS[k] }));
const TIMERS = [15, 30, 45, 60];
const fmt = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export default function Sleep() {
  // ambience state is global (src/lib/ambient.js) so it keeps playing across tabs
  const { keys: ambKeys, vol: ambVol } = amb.useAmbient();
  const vol = Math.round(ambVol * 100);
  // the sleep timer lives in the radio module so it survives leaving this tab
  radio.useRadio();
  const left = radio.sleepLeft();

  const toggleAmb = k => amb.toggle(k);
  const setVolume = v => amb.setMasterVolume(v / 100);
  const setTimer = m => radio.setSleep(m);
  const cancelTimer = () => radio.cancelSleep();

  return (
    <>
      <h1 className="tab-title">SLEEP</h1>
      <p className="tab-sub">Dim the day down — soft beats, gentle rain, and a timer that tucks everything in. 🌙</p>

      <Card title="Sleep radio" color="var(--purple)">
        <LofiRadio stations={SLEEP_STATIONS} source="sleep" />
      </Card>

      <div className="grid2">
        <Card title="Calm ambience" color="var(--cyan)">
          <div className="amb-grid" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
            {CALM.map(a => (
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
        </Card>

        <Card title="Sleep timer" color="var(--pink)">
          {left > 0 ? (
            <div style={{ textAlign: 'center' }}>
              <div className="pomo-time" style={{ fontSize: 30, color: 'var(--pink)' }}>{fmt(left)}</div>
              <div className="small muted mt">Fading out when it hits zero…</div>
              <button className="btn mt" onClick={cancelTimer}>Cancel</button>
            </div>
          ) : (
            <>
              <div className="flex" style={{ gap: 6, flexWrap: 'wrap' }}>
                {TIMERS.map(m => <button key={m} className="btn btn-sm" onClick={() => setTimer(m)}>{m} min</button>)}
              </div>
              <div className="small muted mt">Pick a duration — the radio and ambience switch off automatically so you can fall asleep.</div>
            </>
          )}
        </Card>
      </div>
    </>
  );
}
