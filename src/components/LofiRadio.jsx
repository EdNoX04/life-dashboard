import React, { useEffect } from 'react';
import * as radio from '../lib/radio.js';

// Control surface for the global radio (src/lib/radio.js). The actual player lives
// outside React, so leaving this tab no longer stops the music — the mini player in
// the sidebar takes over.
export default function LofiRadio({ stations, stopKey = 0, source = 'study' }) {
  const r = radio.useRadio();

  useEffect(() => { radio.setStations(stations, source); }, [stations, source]);
  useEffect(() => { if (stopKey) radio.pause(); }, [stopKey]);

  const list = r.stations.length ? r.stations : stations;
  const cur = r.station || list[0] || { label: '' };
  const busy = r.playing || r.loading;

  return (
    <div className="flex" style={{ gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <div className={`vinyl-player${r.playing ? ' playing' : ''}`} aria-hidden="true">
        <div className="vinyl-scrim" />
        <div className="vinyl-disc">
          <div className="vinyl-label"><span>♪</span></div>
          <div className="vinyl-spindle" />
        </div>
        <div className="vinyl-arm">
          <span className="vinyl-arm-rod" />
          <span className="vinyl-arm-head" />
          <span className="vinyl-arm-pivot" />
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 190 }}>
        <div className="flex" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {list.map((s, i) => (
            <button key={s.id + i} className={`btn btn-sm ${r.idx === i ? 'btn-purple' : ''}`} onClick={() => radio.pick(i)}>{s.label}</button>
          ))}
        </div>
        <div className="flex" style={{ gap: 10, alignItems: 'center' }}>
          <button className="btn btn-pink" style={{ minWidth: 54 }} onClick={() => radio.toggle()}>
            {r.loading ? '…' : r.playing ? '❚❚' : '▶'}
          </button>
          <span className="small muted">VOL</span>
          <input type="range" min="0" max="100" value={r.vol} onChange={e => radio.setVolume(+e.target.value)} style={{ flex: 1 }} />
        </div>
        <div className="small muted mt">
          {r.err ? <span style={{ color: 'var(--red)' }}>{r.err}</span>
            : r.loading ? `Tuning in to ${cur.label}…`
            : r.playing ? `Now playing — ${cur.label} · Lofi Girl 🎧`
            : 'Hit play — Lofi Girl live, audio only.'}
        </div>
        {busy && <div className="small muted mt">Keeps playing when you switch tabs — controls sit next to your XP bar.</div>}
      </div>
    </div>
  );
}
