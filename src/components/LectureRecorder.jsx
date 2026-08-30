import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Card } from './ui.jsx';
import {
  CAPTURE_MODES, modeWarning, SAMPLE_EVERY_MS, slideDecision,
  fmtElapsed, estimateCost, lecturePath,
} from '../lib/recorder.js';

// The lecture recorder.
//
// What it replaced heard only the room Neel was sitting in and transcribed with
// the browser's speech API — Chrome-only, and it falls apart across an hour.
//
// This captures the microphone AND, when a call is shared, that tab's audio, and
// samples the slides while a professor is screen-sharing. The decisions live in
// lib/recorder.js where they can be tested; what is here is the media plumbing,
// which cannot be.
//
// TRANSCRIPTION IS NOT WIRED YET, deliberately. Anthropic has no speech-to-text,
// and NVIDIA's hosted ASR is a Riva microservice rather than a REST call on the
// key already in the proxy — picking one without being able to try it against
// the real key would be guessing. Everything up to that point is real: the audio
// and the slides are captured and kept, so nothing about the lecture is lost
// while that one call gets settled.

// Slides are compared at thumbnail size. At full resolution a cursor, a webcam
// tile or video noise all read as "new slide", and every false positive is an
// image paid for.
const THUMB_W = 64, THUMB_H = 36;

function greyscale(canvas) {
  const { data } = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, THUMB_W, THUMB_H);
  const out = new Uint8Array(THUMB_W * THUMB_H);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    out[j] = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0;
  }
  return out;
}

export default function LectureRecorder({ onFinished }) {
  const [mode, setMode] = useState('tab');
  const [state, setState] = useState('idle');     // idle | live | done
  const [secs, setSecs] = useState(0);
  const [slides, setSlides] = useState([]);       // [{ at, dataUrl }]
  const [audioUrl, setAudioUrl] = useState(null);
  const [err, setErr] = useState('');
  const [subject, setSubject] = useState('');
  const [heard, setHeard] = useState({ mic: false, shared: false });

  const rec = useRef(null);
  const chunks = useRef([]);
  const streams = useRef([]);
  const ctx = useRef(null);
  const video = useRef(null);
  const canvas = useRef(null);
  const lastKept = useRef(null);
  const lastSeen = useRef(null);
  const timers = useRef([]);

  const stopAll = useCallback(() => {
    timers.current.forEach(clearInterval);
    timers.current = [];
    try { rec.current?.state !== 'inactive' && rec.current?.stop(); } catch { /* already stopped */ }
    streams.current.forEach(s => s.getTracks().forEach(t => t.stop()));
    streams.current = [];
    try { ctx.current?.close(); } catch { /* already closed */ }
    ctx.current = null;
  }, []);

  useEffect(() => stopAll, [stopAll]);

  async function start() {
    setErr(''); setSlides([]); setAudioUrl(null); setSecs(0);
    lastKept.current = null; lastSeen.current = null; chunks.current = [];
    const cfg = CAPTURE_MODES[mode];

    try {
      const mic = await navigator.mediaDevices.getUserMedia({
        // The lecturer is across a room, so leave the aggressive processing off:
        // noise suppression tuned for a call treats a distant voice as noise.
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true },
      });
      streams.current.push(mic);

      let shared = null;
      if (cfg.video) {
        shared = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: 1 },        // slides, not video — 1fps is plenty
          audio: cfg.audio,
        });
        streams.current.push(shared);
        // Ending the share from the browser's own bar must end the recording,
        // or it keeps running against a dead track and writes silence.
        shared.getVideoTracks()[0]?.addEventListener('ended', () => stop());
      }

      // Both sources into one track. Two MediaRecorders would give two files
      // that drift apart, and nothing downstream could line them up again.
      const ac = new AudioContext();
      ctx.current = ac;
      const dest = ac.createMediaStreamDestination();
      ac.createMediaStreamSource(mic).connect(dest);
      const sharedAudio = shared?.getAudioTracks?.().length ? shared : null;
      if (sharedAudio) ac.createMediaStreamSource(new MediaStream(shared.getAudioTracks())).connect(dest);
      setHeard({ mic: true, shared: Boolean(sharedAudio) });

      const mr = new MediaRecorder(dest.stream, { mimeType: 'audio/webm' });
      rec.current = mr;
      mr.ondataavailable = e => { if (e.data?.size) chunks.current.push(e.data); };
      mr.onstop = () => {
        setAudioUrl(URL.createObjectURL(new Blob(chunks.current, { type: 'audio/webm' })));
        setState('done');
      };
      // A timeslice, so an hour is a list of chunks rather than one buffer that a
      // crashed tab takes with it.
      mr.start(15000);

      if (shared) {
        const v = document.createElement('video');
        v.srcObject = new MediaStream(shared.getVideoTracks());
        v.muted = true;
        await v.play();
        video.current = v;
        const c = document.createElement('canvas');
        c.width = THUMB_W; c.height = THUMB_H;
        canvas.current = c;
        timers.current.push(setInterval(sampleSlide, SAMPLE_EVERY_MS));
      }

      timers.current.push(setInterval(() => setSecs(s => s + 1), 1000));
      setState('live');
    } catch (e) {
      stopAll();
      setErr(e?.name === 'NotAllowedError'
        ? 'Permission refused — the browser needs the microphone, and the share dialog needs a tab or window picked.'
        : String(e.message || e));
      setState('idle');
    }
  }

  function sampleSlide() {
    const v = video.current, c = canvas.current;
    if (!v || !c || !v.videoWidth) return;
    c.getContext('2d').drawImage(v, 0, 0, THUMB_W, THUMB_H);
    const now = greyscale(c);
    setSlides(prev => {
      const d = slideDecision({ current: now, lastKept: lastKept.current, lastSeen: lastSeen.current, keptCount: prev.length });
      lastSeen.current = now;
      if (!d.keep) return prev;
      lastKept.current = now;
      // Only now is a full-resolution frame taken. Grabbing one every sample
      // just to throw it away would be the expensive part of a cheap check.
      const full = document.createElement('canvas');
      full.width = Math.min(v.videoWidth, 1280);
      full.height = Math.round(full.width * (v.videoHeight / v.videoWidth));
      full.getContext('2d').drawImage(v, 0, 0, full.width, full.height);
      return [...prev, { at: secs, dataUrl: full.toDataURL('image/jpeg', 0.72) }];
    });
  }

  function stop() {
    timers.current.forEach(clearInterval);
    timers.current = [];
    try { rec.current?.state !== 'inactive' && rec.current?.stop(); } catch { /* already stopped */ }
    streams.current.forEach(s => s.getTracks().forEach(t => t.stop()));
    streams.current = [];
    try { ctx.current?.close(); } catch { /* already closed */ }
  }

  const minutes = secs / 60;
  const cost = estimateCost({ minutes, slides: slides.length });

  return (
    <Card title="Lecture recorder" color="var(--pink)"
      right={state === 'live'
        ? <span className="rc-live"><span className="rc-dot" />REC {fmtElapsed(secs)}</span>
        : null}>

      {state === 'idle' && (
        <>
          <div className="flex" style={{ gap: 6, flexWrap: 'wrap' }}>
            {Object.entries(CAPTURE_MODES).map(([k, m]) => (
              <button key={k} className={`btn btn-sm${mode === k ? ' btn-pink' : ''}`} onClick={() => setMode(k)}>
                {m.label}
              </button>
            ))}
          </div>
          <div className="small muted mt">{CAPTURE_MODES[mode].hint}</div>
          {modeWarning(mode) && (
            // Said BEFORE the lecture. Finding out afterwards that only your own
            // voice was recorded is a wasted hour nobody gets back.
            <div className="small mt" style={{ color: 'var(--yellow)', lineHeight: 1.55 }}>⚠ {modeWarning(mode)}</div>
          )}
          <div className="flex mt" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input placeholder="Subject — e.g. IoT System Design" value={subject}
              onChange={e => setSubject(e.target.value)} style={{ flex: 1, minWidth: 180 }} />
            <button className="btn btn-pink" onClick={start}>● Record</button>
          </div>
          <div className="small muted mt" style={{ lineHeight: 1.55 }}>
            You are recording other people. The browser shows a sharing banner throughout, and nothing leaves this
            device until you press Save.
          </div>
        </>
      )}

      {state === 'live' && (
        <>
          <div className="flex" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn" onClick={stop}>■ Stop</button>
            <span className="small muted">
              hearing: {heard.mic ? 'mic' : '—'}{heard.shared ? ' + shared audio' : ''}
              {' · '}{slides.length} slide{slides.length === 1 ? '' : 's'} kept
            </span>
          </div>
          {!heard.shared && CAPTURE_MODES[mode].video && (
            <div className="small mt" style={{ color: 'var(--yellow)' }}>
              No audio from the share — the lecturer is only being picked up through your microphone.
            </div>
          )}
        </>
      )}

      {state === 'done' && (
        <>
          <div className="small" style={{ lineHeight: 1.6 }}>
            {fmtElapsed(secs)} recorded · {slides.length} slide{slides.length === 1 ? '' : 's'} kept
            {' · '}est. <b>${cost.toFixed(2)}</b> to turn into notes
          </div>
          {audioUrl && <audio controls src={audioUrl} style={{ width: '100%', marginTop: 10 }} />}
          {slides.length > 0 && (
            <div className="slide-strip">
              {slides.map((s, i) => (
                <figure key={i}>
                  <img src={s.dataUrl} alt={`Slide at ${fmtElapsed(s.at)}`} />
                  <figcaption className="small muted">{fmtElapsed(s.at)}</figcaption>
                </figure>
              ))}
            </div>
          )}
          <div className="small mt" style={{ color: 'var(--yellow)', lineHeight: 1.55 }}>
            Transcription is the one piece still to wire — Anthropic has no speech-to-text, and the right provider
            has to be tried against the real key rather than guessed at. The audio and slides are captured and here;
            nothing about this lecture is lost while that gets settled.
          </div>
          <div className="flex mt" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-sm" onClick={() => {
              const a = document.createElement('a');
              a.href = audioUrl; a.download = `${(subject || 'lecture').replace(/[^\w -]/g, '')}.webm`; a.click();
            }} disabled={!audioUrl}>⤓ audio</button>
            <button className="btn btn-sm" onClick={() => setState('idle')}>new recording</button>
          </div>
          <div className="small muted mt">
            Will land at <code>{lecturePath({ subject, date: new Date().toISOString() })}</code> once notes are generated.
          </div>
        </>
      )}

      {err && <div className="small mt" style={{ color: 'var(--red)' }}>{err}</div>}
    </Card>
  );
}
