import React, { useEffect, useRef, useState } from 'react';

// Lofi Girl radio via the YouTube IFrame API. The live stream plays AUDIO ONLY —
// the video is rendered (so mobile allows playback) but sits behind the opaque
// vinyl graphic, so you never see it. Volume slider drives the player; the phone's
// hardware volume buttons control the system output while it plays.
// Each station is { id: <youtube live video id>, label }.
function loadYT() {
  return new Promise(res => {
    if (window.YT?.Player) return res(window.YT);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev && prev(); res(window.YT); };
    if (!document.getElementById('yt-iframe-api')) {
      const s = document.createElement('script'); s.id = 'yt-iframe-api';
      s.src = 'https://www.youtube.com/iframe_api'; document.head.appendChild(s);
    }
  });
}

export default function LofiRadio({ stations, stopKey = 0 }) {
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [station, setStation] = useState(0);
  const [vol, setVol] = useState(60);
  const [err, setErr] = useState('');
  const holder = useRef('yt-' + Math.random().toString(36).slice(2));
  const player = useRef(null);
  const cur = stations[station] || stations[0];

  async function ensure() {
    if (player.current) return player.current;
    const YT = await loadYT();
    return await new Promise((res, rej) => {
      const p = new YT.Player(holder.current, {
        width: '100%', height: '100%', videoId: cur.id,
        playerVars: { autoplay: 0, controls: 0, disablekb: 1, fs: 0, modestbranding: 1, playsinline: 1, rel: 0 },
        events: {
          onReady: () => { try { p.setVolume(vol); } catch {} res(p); },
          onStateChange: e => { setPlaying(e.data === 1); setLoading(e.data === 3); if (e.data === 1) setErr(''); },
          onError: () => { setErr('This stream is unavailable right now — try another.'); setLoading(false); setPlaying(false); },
        },
      });
      player.current = p;
      setTimeout(() => res(p), 4000); // safety if onReady is slow
    });
  }
  async function start(idx = station) {
    setErr(''); setLoading(true);
    try {
      const p = await ensure();
      p.loadVideoById(stations[idx].id);
      p.setVolume(vol);
      p.playVideo();
    } catch { setErr('Could not start the stream — tap play again.'); setLoading(false); }
  }
  function stop() { try { player.current?.pauseVideo(); } catch {} setPlaying(false); setLoading(false); }
  function pick(idx) { setStation(idx); if (playing || loading) start(idx); }
  function setVolume(v) { setVol(v); try { player.current?.setVolume(v); } catch {} }

  useEffect(() => { if (stopKey) stop(); }, [stopKey]); // eslint-disable-line
  useEffect(() => () => { try { player.current?.destroy(); } catch {} }, []);

  return (
    <div className="flex" style={{ gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <div className={`vinyl-player${playing ? ' playing' : ''}`} aria-hidden="true">
        <div className="vinyl-yt"><div id={holder.current} /></div>
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
          {stations.map((s, i) => (
            <button key={s.id + i} className={`btn btn-sm ${station === i ? 'btn-purple' : ''}`} onClick={() => pick(i)}>{s.label}</button>
          ))}
        </div>
        <div className="flex" style={{ gap: 10, alignItems: 'center' }}>
          <button className="btn btn-pink" style={{ minWidth: 54 }} onClick={() => (playing ? stop() : start())}>
            {loading ? '…' : playing ? '❚❚' : '▶'}
          </button>
          <span className="small muted">VOL</span>
          <input type="range" min="0" max="100" value={vol} onChange={e => setVolume(+e.target.value)} style={{ flex: 1 }} />
        </div>
        <div className="small muted mt">
          {err ? <span style={{ color: 'var(--red)' }}>{err}</span>
            : loading ? `Tuning in to ${cur.label}…`
            : playing ? `Now playing — ${cur.label} · Lofi Girl 🎧`
            : 'Hit play — Lofi Girl live, audio only.'}
        </div>
      </div>
    </div>
  );
}
