import React, { useCallback } from 'react';
import { Card } from '../components/ui.jsx';
import LofiRadio from '../components/LofiRadio.jsx';
import Ambience from '../components/Ambience.jsx';
import Breathe from '../components/Breathe.jsx';
import * as radio from '../lib/radio.js';
import { useCollection } from '../lib/hooks.js';
import * as focus from '../lib/focus.js';
import * as breathe from '../lib/breathe.js';

// Wind-down room — ambient/downtempo radio, calming ambience,
// and a sleep timer that fades everything out so you can drift off.
// Same multi-source shape as Study — Lofi Girl's sleep streams first, an
// ambient Icecast mount as the fallback. Ordered slowest-first; this is the
// wind-down room.
const SLEEP_STATIONS = [
  { label: 'Sleep', sources: [
    { kind: 'yt', id: 'JD-kMIpDfnY' },                       // lofi hip hop — beats to sleep/chill to
    { kind: 'yt', id: '28KRPhVzCus' },
    { kind: 'stream', url: 'https://ice1.somafm.com/dronezone-128-mp3' },
  ]},
  { label: 'Lofi', sources: [
    { kind: 'yt', id: 'rUxyKA_-grg' },
    { kind: 'yt', id: 'jfKfPfyJRdk' },
    { kind: 'stream', url: 'https://ice1.somafm.com/fluid-128-mp3' },
  ]},
  { label: 'Deep', sources: [
    { kind: 'yt', id: 'S_MOd40zlYU' },                       // dark ambient radio
    { kind: 'stream', url: 'https://ice1.somafm.com/deepspaceone-128-mp3' },
  ]},
  { label: 'Lush', sources: [
    { kind: 'stream', url: 'https://ice1.somafm.com/lush-128-mp3' },
  ]},
];
// The wind-down subset: nothing percussive, nothing with speech in it.
const CALM_KEYS = ['rain', 'storm', 'thunder', 'wind', 'waves', 'river', 'night', 'fire', 'noise', 'pink'];
const TIMERS = [15, 30, 45, 60];
const fmt = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export default function Sleep() {
  // ambience state is global (src/lib/ambient.js) so it keeps playing across tabs
  // the sleep timer lives in the radio module so it survives leaving this tab
  radio.useRadio();
  const left = radio.sleepLeft();

  // Same table and same rule as the Study tab: recorded under breathe.MODE, so
  // a session before bed never counts toward how long you studied.
  const { items: sessions, add: addSession } =
    useCollection('focus_sessions', { order: 'ended_at', asc: false });

  const logBreath = useCallback(async ({ label, minutes, endedAt }) => {
    try {
      await addSession(focus.sessionRow({ mode: breathe.MODE, label, minutes, endedAt }));
    } catch { /* the exercise happened either way; a failed write must not interrupt it */ }
  }, [addSession]);

  const setTimer = m => radio.setSleep(m);
  const cancelTimer = () => radio.cancelSleep();

  return (
    <>
      <h1 className="tab-title">SLEEP</h1>
      <p className="tab-sub">Dim the day down — soft beats, gentle rain, and a timer that tucks everything in. 🌙</p>

      <Card title="Sleep radio" color="var(--purple)">
        <LofiRadio stations={SLEEP_STATIONS} source="sleep" />
      </Card>

      {/* Above the ambience and the timer on purpose: this is the thing most
          likely to actually get someone to sleep, and it should not be the card
          you scroll past to reach the volume sliders. */}
      <Card title="Breathing" color="var(--cyan)">
        <Breathe rows={sessions} onFinish={logBreath} suggest="478" />
      </Card>

      <div className="grid2">
        <Card title="Calm ambience" color="var(--cyan)">
          <Ambience keys={CALM_KEYS} />
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
