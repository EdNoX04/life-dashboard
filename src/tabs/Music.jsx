import React, { useState } from 'react';
import { Card, Empty } from '../components/ui.jsx';

// Retro music player — connect Spotify Premium / Apple Music and listen without the
// distracting app. SCAFFOLD: the player shell + connect flow; playback/library get
// wired via Spotify Web Playback SDK / MusicKit in the deep build.
export default function Music() {
  const [source, setSource] = useState(null); // 'spotify' | 'apple'

  return (
    <>
      <div className="spread">
        <h1 className="tab-title">MUSIC</h1>
        <span className="flex" style={{ gap: 6 }}>
          <button className={`btn btn-sm ${source === 'spotify' ? 'btn-green' : ''}`} onClick={() => setSource('spotify')}>Spotify</button>
          <button className={`btn btn-sm ${source === 'apple' ? 'btn-pink' : ''}`} onClick={() => setSource('apple')}>Apple Music</button>
        </span>
      </div>
      <p className="tab-sub">A clean listening hour — your music, none of the doomscroll.</p>

      <Card title="Now playing" color="var(--pink)">
        <div className="player">
          <div className="player-art">♪</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="player-track">Not connected</div>
            <div className="player-artist small muted">Connect a source to start</div>
            <div className="player-bar"><div style={{ width: '0%' }} /></div>
            <div className="flex" style={{ justifyContent: 'space-between' }}>
              <span className="small muted">0:00</span>
              <span className="chip c-cyan">— kbps · quality</span>
              <span className="small muted">0:00</span>
            </div>
          </div>
        </div>
        <div className="flex" style={{ justifyContent: 'center', gap: 14, marginTop: 12 }}>
          <button className="btn">⏮</button>
          <button className="btn btn-pink" style={{ minWidth: 56 }}>▶</button>
          <button className="btn">⏭</button>
        </div>
      </Card>

      <Card title={source ? `Connect ${source === 'spotify' ? 'Spotify Premium' : 'Apple Music'}` : 'Connect a source'} color="var(--green)">
        <Empty icon="🔗" text={source
          ? `Authorize ${source === 'spotify' ? 'Spotify (Premium needed for in-app playback via the Web Playback SDK)' : 'Apple Music (MusicKit)'} to stream here, pull your library, and show live audio quality. OAuth flow gets wired in the build pass.`
          : 'Pick Spotify or Apple Music above to begin.'} />
      </Card>

      <div className="grid2">
        <Card title="Your library" color="var(--cyan)">
          <Empty icon="≡" text="Playlists, saved albums and recently played land here once connected." />
        </Card>
        <Card title="Audio quality" color="var(--yellow)">
          <Empty icon="◈" text="Live bitrate / lossless indicator for the current track." />
        </Card>
      </div>
    </>
  );
}
