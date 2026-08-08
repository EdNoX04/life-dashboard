import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, Empty } from '../components/ui.jsx';
import { getConfig } from '../lib/db.js';
import {
  SOURCES, sourceOf, sourcesByQuality, TIERS, formatOf, qualityReport,
  queueNext, queuePrev, fmtTime,
} from '../lib/audio.js';

// The music tab.
//
// Four sources sit behind one player, and only one of them can actually play
// audio in a browser today: your own files. That is not a shortcoming of this
// build — Spotify needs a developer app you have to register, Apple Music needs
// a paid developer token, and neither will ever hand a web page lossless audio.
// The tab is built so those two slot in when their credentials exist, and says
// plainly what each is waiting for in the meantime.
//
// The quality readout is the part worth being careful about. It reports what is
// true (codec, sample rate, bit depth, whether the OS is resampling) and states
// separately that output is not bit-perfect, with the specific reason. A player
// that prints BIT PERFECT over a 256 kbps AAC stream is worse than one that
// prints nothing, because it teaches you to stop reading it.

function QualityPanel({ report }) {
  if (!report) return null;
  const t = report.tier;
  return (
    <div className="mu-q">
      <div className="mu-q-head">
        {t
          ? <span className="chip" style={{ color: t.color, borderColor: t.color }}>{t.label}</span>
          : <span className="chip">UNKNOWN</span>}
        {report.label && <span className="mu-q-spec">{report.label}</span>}
        {report.deviceRate && (
          <span className="mu-q-dev">
            device {(report.deviceRate / 1000).toFixed(1)} kHz
            {report.resampled === true && <span className="mu-q-warn"> · resampling</span>}
            {report.resampled === false && <span className="mu-q-ok"> · matched</span>}
          </span>
        )}
      </div>
      {/* Always present, never hedged away. */}
      <p className="mu-q-why"><strong>Not bit-perfect:</strong> {report.why}</p>
    </div>
  );
}

function SourceCard({ src, active, onPick, configured }) {
  const t = TIERS[src.tier];
  return (
    <button
      className={`mu-src ${active ? 'on' : ''}`}
      style={{ '--mu-c': src.color }}
      onClick={() => onPick(src.key)}
    >
      <span className="mu-src-top">
        <span className="mu-src-name">{src.label}</span>
        <span className="chip" style={{ color: t.color, borderColor: t.color }}>{t.label}</span>
      </span>
      <span className="mu-src-ceil">
        {src.ceiling ? `max ${src.ceiling} kbps` : 'limited only by your files'}
      </span>
      <span className={`mu-src-state ${configured ? 'ready' : ''}`}>
        {configured ? 'READY' : 'NOT CONNECTED'}
      </span>
    </button>
  );
}

export default function Music() {
  const cfg = getConfig();
  const [source, setSource] = useState('local');
  const [queue, setQueue] = useState([]);      // {name, url, format, size}
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);
  const [repeat, setRepeat] = useState('off'); // off | all | one
  const [volume, setVolume] = useState(1);
  const [ctxRate, setCtxRate] = useState(null);
  const [meta, setMeta] = useState({});        // sampleRate/bitDepth per queue index
  const audioRef = useRef(null);
  const fileRef = useRef(null);

  const src = sourceOf(source);
  const track = queue[index] || null;

  // Which sources have what they need. Local is ready as soon as you pick a
  // file; the streaming ones need credentials only Neel can supply.
  const configured = {
    local: true,
    spotify: !!(cfg.spotifyClientId || '').trim(),
    apple: !!(cfg.appleMusicToken || '').trim(),
    ytmusic: true,
  };

  // The AudioContext's sampleRate IS the output device rate the browser is
  // running at. Reading it is what makes the resampling claim a measurement
  // rather than an assumption.
  useEffect(() => {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    let ac;
    try { ac = new AC(); setCtxRate(ac.sampleRate); } catch { /* blocked until a gesture */ }
    return () => { try { ac && ac.close(); } catch { /* already closed */ } };
  }, []);

  // Decoding the file header gives the real sample rate rather than the one the
  // filename implies. Done once per track, off the playback path.
  const probe = useCallback(async (file, i) => {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC || !file) return;
    try {
      const buf = await file.arrayBuffer();
      const ac = new AC();
      const decoded = await ac.decodeAudioData(buf.slice(0));
      setMeta(m => ({ ...m, [i]: { sampleRate: decoded.sampleRate, channels: decoded.numberOfChannels, duration: decoded.duration } }));
      ac.close();
    } catch { /* an undecodable file still plays via <audio> if the OS knows it */ }
  }, []);

  function addFiles(list) {
    const files = [...list].filter(f => f.type.startsWith('audio') || formatOf(f.name));
    if (!files.length) return;
    const start = queue.length;
    const rows = files.map(f => ({
      name: f.name.replace(/\.[^.]+$/, ''),
      url: URL.createObjectURL(f),
      format: formatOf(f.name),
      size: f.size,
      file: f,
    }));
    setQueue(q => [...q, ...rows]);
    rows.forEach((r, k) => probe(r.file, start + k));
    if (!queue.length) setIndex(0);
  }

  function play(i = index) {
    setIndex(i);
    setPlaying(true);
    // The src swap has to land before play(), hence the deferral.
    setTimeout(() => { audioRef.current?.play().catch(() => setPlaying(false)); }, 0);
  }

  function toggle() {
    const a = audioRef.current;
    if (!a || !track) return;
    if (playing) { a.pause(); setPlaying(false); }
    else { a.play().then(() => setPlaying(true)).catch(() => {}); }
  }

  function next() {
    const n = queueNext(queue, index, { repeat });
    if (n === null) { setPlaying(false); return; }
    play(n);
  }

  function prev() {
    const p = queuePrev(queue, index, pos);
    if (p === null) return;
    if (p === index) { if (audioRef.current) audioRef.current.currentTime = 0; return; }
    play(p);
  }

  const report = useMemo(() => {
    if (source !== 'local') {
      return qualityReport({ source, bitrate: src?.ceiling ?? null, deviceRate: ctxRate });
    }
    if (!track) return null;
    const m = meta[index] || {};
    return qualityReport({
      source: 'local', format: track.format,
      sampleRate: m.sampleRate ?? null,
      bitDepth: null,           // browsers do not expose the file's word length
      deviceRate: ctxRate,
    });
  }, [source, track, meta, index, ctxRate, src]);

  useEffect(() => { if (audioRef.current) audioRef.current.volume = volume; }, [volume, index]);

  return (
    <>
      <div className="spread">
        <h1 className="tab-title">MUSIC</h1>
        <span className="chip c-cyan">{src?.label}</span>
      </div>
      <p className="tab-sub">A clean listening hour — your music, none of the doomscroll.</p>

      <Card title="Source" color="var(--cyan)">
        {/* Ordered best-first, so the option that can actually deliver lossless
            leads rather than being buried under the familiar logos. */}
        <div className="mu-srcs">
          {sourcesByQuality().map(s => (
            <SourceCard
              key={s.key} src={s} active={source === s.key}
              configured={configured[s.key]} onPick={setSource}
            />
          ))}
        </div>
        <p className="mu-note">{src?.note}</p>
      </Card>

      <Card title="Now playing" color="var(--pink)">
        <div className="player">
          <div className="player-art">{playing ? '♫' : '♪'}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="player-track">{track ? track.name : source === 'local' ? 'Nothing queued' : `${src?.name} not connected`}</div>
            <div className="player-artist small muted">
              {track ? (track.format?.label || 'unknown format') : (src?.needs || 'Add files below')}
            </div>
            <div
              className="player-bar mu-seek"
              onClick={e => {
                if (!audioRef.current || !dur) return;
                const r = e.currentTarget.getBoundingClientRect();
                audioRef.current.currentTime = ((e.clientX - r.left) / r.width) * dur;
              }}
            >
              <div style={{ width: dur ? `${(pos / dur) * 100}%` : '0%' }} />
            </div>
            <div className="flex" style={{ justifyContent: 'space-between' }}>
              <span className="small muted">{fmtTime(pos)}</span>
              <span className="small muted">{fmtTime(dur)}</span>
            </div>
          </div>
        </div>

        <div className="flex mu-controls">
          <button className="btn" onClick={prev} disabled={!track}>⏮</button>
          <button className="btn btn-pink" style={{ minWidth: 56 }} onClick={toggle} disabled={!track}>
            {playing ? '❚❚' : '▶'}
          </button>
          <button className="btn" onClick={next} disabled={!track}>⏭</button>
          <button
            className={`btn btn-sm ${repeat !== 'off' ? 'btn-cyan' : ''}`}
            onClick={() => setRepeat(repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off')}
            title="Repeat"
          >{repeat === 'one' ? '↻1' : '↻'}{repeat === 'all' ? ' ALL' : ''}</button>
          <input
            type="range" min="0" max="1" step="0.01" value={volume}
            onChange={e => setVolume(Number(e.target.value))}
            className="mu-vol" title="Volume"
          />
        </div>

        <QualityPanel report={report} />

        {track && (
          <audio
            ref={audioRef}
            src={track.url}
            onTimeUpdate={e => setPos(e.currentTarget.currentTime)}
            onLoadedMetadata={e => setDur(e.currentTarget.duration || 0)}
            onEnded={next}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
          />
        )}
      </Card>

      {source === 'local' && (
        <Card
          title={`Queue (${queue.length})`}
          color="var(--green)"
          right={<button className="btn btn-sm btn-green" onClick={() => fileRef.current?.click()}>+ FILES</button>}
        >
          <input
            ref={fileRef} type="file" accept="audio/*,.flac,.wav,.m4a,.aiff,.opus" multiple
            style={{ display: 'none' }}
            onChange={e => { addFiles(e.target.files); e.target.value = ''; }}
          />
          <div
            className="mu-drop"
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
          >
            {queue.length === 0
              ? <Empty icon="♪" text="Drop FLAC, WAV, ALAC or MP3 files here — or use + FILES. Nothing is uploaded; they play straight off your disk." />
              : queue.map((t, i) => {
                const m = meta[i] || {};
                return (
                  <div className={`mu-row ${i === index ? 'on' : ''}`} key={t.url}>
                    <button className="mu-play" onClick={() => play(i)}>{i === index && playing ? '❚❚' : '▶'}</button>
                    <span className="mu-row-name">{t.name}</span>
                    {t.format && (
                      <span
                        className="chip"
                        style={t.format.lossless === true
                          ? { color: 'var(--green)', borderColor: 'var(--green)' }
                          : t.format.lossless === false
                            ? { color: 'var(--orange)', borderColor: 'var(--orange)' }
                            : undefined}
                      >{t.format.label}</span>
                    )}
                    {m.sampleRate && <span className="chip c-cyan">{(m.sampleRate / 1000).toFixed(1)} kHz</span>}
                    <button className="btn btn-sm" onClick={() => {
                      URL.revokeObjectURL(t.url);
                      setQueue(q => q.filter((_, k) => k !== i));
                      if (i < index) setIndex(x => x - 1);
                    }}>✕</button>
                  </div>
                );
              })}
          </div>
        </Card>
      )}

      {source !== 'local' && (
        <Card title={`Connect ${src?.name}`} color={src?.color}>
          <Empty icon="🔗" text={src?.needs || ''} />
          {/* Said once, clearly, rather than discovered after setup. */}
          <p className="mu-note">
            Worth knowing before you set this up: {src?.note} If lossless matters
            for a particular album, the local-files source plays it properly.
          </p>
        </Card>
      )}
    </>
  );
}
