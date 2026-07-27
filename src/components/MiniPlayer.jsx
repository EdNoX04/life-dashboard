import React from 'react';
import * as radio from '../lib/radio.js';
import * as amb from '../lib/ambient.js';

// Small always-there transport that appears next to the XP card whenever something
// is playing. Audio lives outside React now, so this works from any tab.
export default function MiniPlayer() {
  const r = radio.useRadio();
  const a = amb.useAmbient();

  const radioOn = r.playing || r.loading;
  const ambOn = a.keys.length > 0;
  if (!radioOn && !ambOn) return null;

  const label = radioOn ? (r.station?.label || 'Radio') : `${a.keys.length} ambience`;
  const icons = a.keys.slice(0, 4).map(k => amb.SOUNDS[k]?.icon || '•').join(' ');

  return (
    <div className="mini-player">
      <div className="mp-row">
        <button className="mp-btn"
          onClick={() => (radioOn ? radio.pause() : ambOn ? amb.stopAll() : radio.play())}
          title={radioOn ? 'Pause radio' : 'Stop ambience'}>
          {r.loading ? '…' : radioOn ? '❚❚' : '■'}
        </button>
        <div className="mp-meta">
          <span className="mp-title">{label}</span>
          <span className="mp-sub">{radioOn ? (r.loading ? 'tuning in…' : 'on air') : icons}</span>
        </div>
        {radioOn && ambOn && (
          <button className="mp-btn mp-x" onClick={() => amb.stopAll()} title="Stop ambience">✕</button>
        )}
      </div>
      {radioOn && (
        <input className="mp-vol" type="range" min="0" max="100" value={r.vol}
          onChange={e => radio.setVolume(+e.target.value)} aria-label="Volume" />
      )}
    </div>
  );
}
