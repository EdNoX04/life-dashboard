import React, { useEffect, useRef, useState } from 'react';

// Native-audio lofi radio. Uses real HTTPS streams (SomaFM) in an <audio> element,
// which plays reliably on mobile + desktop and keeps going in the background —
// unlike the old hidden-YouTube embed that never started on phones.
// Each station is { url, label }.
export default function LofiRadio({ stations, stopKey = 0 }) {
  const [playing, setPlaying] = useState(false);
  const [station, setStation] = useState(0);
  const [vol, setVol] = useState(55);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const audioRef = useRef(null);

  const cur = stations[station] || stations[0];

  useEffect(() => { if (audioRef.current) audioRef.current.volume = vol / 100; }, [vol]);

  async function start(idx = station) {
    const a = audioRef.current;
    if (!a) return;
    setErr('');
    setLoading(true);
    a.src = stations[idx].url;
    a.volume = vol / 100;
    try {
      await a.play();          // must be inside the click gesture on mobile
      setPlaying(true);
    } catch (e) {
      setErr('Could not start the stream — tap play again, or check your connection.');
      setPlaying(false);
    }
    setLoading(false);
  }
  function stop() {
    const a = audioRef.current;
    if (a) { a.pause(); a.removeAttribute('src'); a.load(); }
    setPlaying(false);
    setLoading(false);
  }
  function pick(idx) {
    setStation(idx);
    if (playing || loading) start(idx);
  }

  useEffect(() => { if (stopKey) stop(); }, [stopKey]); // eslint-disable-line

  return (
    <div className="flex" style={{ gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <audio
        ref={audioRef}
        playsInline
        preload="none"
        onPlaying={() => { setPlaying(true); setLoading(false); }}
        onWaiting={() => setLoading(true)}
        onError={() => { if (playing || loading) setErr('Stream error — tap play to retry.'); setLoading(false); setPlaying(false); }}
      />
      <div className="lofi-art">
        <div className={`lofi-cover${playing ? ' playing' : ''}`}>
          <div className="lofi-viz">{[...Array(5)].map((_, i) => <span key={i} />)}</div>
          <span className="lofi-note">♪</span>
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 190 }}>
        <div className="flex" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {stations.map((s, i) => (
            <button key={s.url} className={`btn btn-sm ${station === i ? 'btn-purple' : ''}`} onClick={() => pick(i)}>{s.label}</button>
          ))}
        </div>
        <div className="flex" style={{ gap: 10, alignItems: 'center' }}>
          <button className="btn btn-pink" style={{ minWidth: 54 }} onClick={() => (playing ? stop() : start())}>
            {loading ? '…' : playing ? '❚❚' : '▶'}
          </button>
          <span className="small muted">VOL</span>
          <input type="range" min="0" max="100" value={vol} onChange={e => setVol(+e.target.value)} style={{ flex: 1 }} />
        </div>
        <div className="small muted mt">
          {err ? <span style={{ color: 'var(--red)' }}>{err}</span>
            : loading ? `Tuning in to ${cur.label}…`
            : playing ? `Now playing — ${cur.label}. 🎧`
            : 'Hit play for a chilled stream.'}
        </div>
      </div>
    </div>
  );
}
