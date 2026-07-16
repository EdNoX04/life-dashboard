import React, { useEffect, useRef, useState } from 'react';

// Robust lofi player: swaps the iframe src imperatively inside the click gesture
// (so autoplay-with-sound is always allowed) and controls volume via postMessage.
// Video stays hidden behind the cover — audio only. Streams are Lofi Girl lives.
export default function LofiRadio({ stations, stopKey = 0 }) {
  const [playing, setPlaying] = useState(false);
  const [station, setStation] = useState(stations[0].id);
  const ref = useRef(null);
  const [vol, setVol] = useState(55);

  const post = (func, args = []) => {
    try { ref.current?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args }), '*'); } catch {}
  };
  const load = id => { if (ref.current) ref.current.src = `https://www.youtube.com/embed/${id}?autoplay=1&enablejsapi=1&controls=0&playsinline=1&rel=0`; };
  const play = () => { load(station); setPlaying(true); };
  const stop = () => { if (ref.current) ref.current.src = 'about:blank'; setPlaying(false); };
  const pick = id => { setStation(id); if (playing) load(id); };
  const setV = v => { setVol(v); post('setVolume', [v]); };

  useEffect(() => { if (stopKey) stop(); }, [stopKey]); // eslint-disable-line

  return (
    <div className="flex" style={{ gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <div className="lofi-art">
        <div className="lofi-yt">
          <iframe ref={ref} title="lofi radio" src="about:blank" allow="autoplay" frameBorder="0"
            onLoad={() => { if (playing) post('setVolume', [vol]); }} />
        </div>
        <div className={`lofi-cover${playing ? ' playing' : ''}`}>
          <div className="lofi-viz">{[...Array(5)].map((_, i) => <span key={i} />)}</div>
          <span className="lofi-note">♪</span>
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 190 }}>
        <div className="flex" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {stations.map(s => <button key={s.id} className={`btn btn-sm ${station === s.id ? 'btn-purple' : ''}`} onClick={() => pick(s.id)}>{s.label}</button>)}
        </div>
        <div className="flex" style={{ gap: 10, alignItems: 'center' }}>
          <button className="btn btn-pink" style={{ minWidth: 54 }} onClick={() => (playing ? stop() : play())}>{playing ? '❚❚' : '▶'}</button>
          <span className="small muted">VOL</span>
          <input type="range" min="0" max="100" value={vol} onChange={e => setV(+e.target.value)} style={{ flex: 1 }} />
        </div>
        <div className="small muted mt">{playing ? 'Now playing — video hidden, just the beats. 🎧' : 'Hit play for lofi (Lofi Girl live).'}</div>
      </div>
    </div>
  );
}
