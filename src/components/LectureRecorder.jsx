import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Card } from './ui.jsx';
import {
  CAPTURE_MODES, modeWarning, SAMPLE_EVERY_MS, slideDecision,
  fmtElapsed, estimateCost, lecturePath,
} from '../lib/recorder.js';
import { downsample, encodeWav, stitch, TARGET_RATE, CHUNK_SECONDS } from '../lib/wav.js';
import { accessToken } from '../lib/auth.js';

// The lecture recorder.
//
// Two things Neel asked for shape this, and both change the design rather than
// decorate it:
//
// 1. "Fix the audio problem while it's capturing screen." Chrome on macOS only
//    offers system audio for a shared TAB, so sharing the Teams window gives
//    slides and silence. The fix is not in the browser — it is a virtual audio
//    device (BlackHole) that makes system audio look like a microphone. So this
//    lets a SECOND input be chosen and mixes it in. That turns an impossibility
//    into a five-minute setup, once.
//
// 2. "I don't want the whole recording — just the notes." So there is no
//    recording. Audio is buffered a minute at a time, transcribed, and dropped.
//    Nothing is ever written to disk, which is a much easier promise to keep
//    than deleting something afterwards.
//
// What is kept: the transcript and the slides that changed. That is the
// "lossless" half — a summary that missed something can be re-run from them
// without re-attending the lecture.

const THUMB_W = 64, THUMB_H = 36;

function greyscale(canvas) {
  const { data } = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, THUMB_W, THUMB_H);
  const out = new Uint8Array(THUMB_W * THUMB_H);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    out[j] = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0;
  }
  return out;
}

export default function LectureRecorder() {
  const [mode, setMode] = useState('tab');
  const [devices, setDevices] = useState([]);
  const [micId, setMicId] = useState('');
  const [auxId, setAuxId] = useState('');       // BlackHole or similar
  const [state, setState] = useState('idle');   // idle | live | done
  const [secs, setSecs] = useState(0);
  const [slides, setSlides] = useState([]);
  const [parts, setParts] = useState([]);       // transcript chunks, in order
  const [pending, setPending] = useState(0);    // chunks in flight
  const [subject, setSubject] = useState('');
  const [err, setErr] = useState('');
  const [warn, setWarn] = useState('');

  const streams = useRef([]);
  const ctx = useRef(null);
  const node = useRef(null);
  const buf = useRef([]);        // Float32Array pieces at the graph's rate
  const bufLen = useRef(0);
  const video = useRef(null);
  const thumb = useRef(null);
  const lastKept = useRef(null);
  const lastSeen = useRef(null);
  const timers = useRef([]);
  const seq = useRef(0);

  // Device labels are hidden until the page has been granted the microphone
  // once — before that every entry reads "Audio input 2", which makes choosing
  // BlackHole impossible. So ask, then enumerate.
  const loadDevices = useCallback(async () => {
    try {
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
      probe.getTracks().forEach(t => t.stop());
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices(all.filter(d => d.kind === 'audioinput'));
    } catch (e) {
      setErr('The microphone permission is needed even to list audio devices.');
    }
  }, []);

  useEffect(() => () => teardown(), []);

  function teardown() {
    timers.current.forEach(clearInterval);
    timers.current = [];
    try { node.current?.disconnect(); } catch { /* already gone */ }
    node.current = null;
    streams.current.forEach(s => s.getTracks().forEach(t => t.stop()));
    streams.current = [];
    try { ctx.current?.close(); } catch { /* already closed */ }
    ctx.current = null;
  }

  async function sendChunk(float32, rate, index) {
    const wav = encodeWav(downsample(float32, rate, TARGET_RATE), TARGET_RATE);
    setPending(p => p + 1);
    try {
      const token = await accessToken();
      const r = await fetch('/api/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'audio/wav', Authorization: `Bearer ${token}` },
        body: wav,
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Transcription failed (${r.status})`);
      // Placed by index, not appended: chunks come back out of order under a
      // slow connection, and a lecture reassembled in arrival order is nonsense.
      setParts(prev => { const next = [...prev]; next[index] = j.text || ''; return next; });
    } catch (e) {
      setWarn(`A minute of audio could not be transcribed — ${String(e.message || e)}`);
      setParts(prev => { const next = [...prev]; next[index] = next[index] || ''; return next; });
    } finally {
      setPending(p => p - 1);
    }
  }

  function drain(force = false) {
    const rate = ctx.current?.sampleRate || 48000;
    const needed = CHUNK_SECONDS * rate;
    if (!force && bufLen.current < needed) return;
    if (!bufLen.current) return;
    const flat = new Float32Array(bufLen.current);
    let o = 0;
    for (const piece of buf.current) { flat.set(piece, o); o += piece.length; }
    buf.current = []; bufLen.current = 0;
    sendChunk(flat, rate, seq.current++);
  }

  async function start() {
    setErr(''); setWarn(''); setSlides([]); setParts([]); setSecs(0);
    buf.current = []; bufLen.current = 0; seq.current = 0;
    lastKept.current = null; lastSeen.current = null;
    const cfg = CAPTURE_MODES[mode];

    try {
      const ac = new AudioContext();
      ctx.current = ac;
      await ac.audioWorklet.addModule('/pcm-worklet.js');
      const dest = ac.createGain();     // a mixing point; nothing is played back

      const addInput = async (constraints) => {
        const s = await navigator.mediaDevices.getUserMedia({ audio: constraints });
        streams.current.push(s);
        ac.createMediaStreamSource(s).connect(dest);
        return s;
      };

      // The lecturer is across a room: the processing that flatters a video call
      // treats a distant voice as noise and removes it.
      const raw = { echoCancellation: false, noiseSuppression: false, autoGainControl: true };
      await addInput(micId ? { ...raw, deviceId: { exact: micId } } : raw);

      // The second input — BlackHole, or whatever is carrying system audio.
      let auxOk = false;
      if (auxId) {
        try { await addInput({ ...raw, deviceId: { exact: auxId } }); auxOk = true; }
        catch { setWarn('The second audio input could not be opened — recording with the microphone only.'); }
      }

      let shared = null;
      if (cfg.video) {
        shared = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 1 }, audio: cfg.audio });
        streams.current.push(shared);
        shared.getVideoTracks()[0]?.addEventListener('ended', () => stop());
        if (shared.getAudioTracks().length) {
          ac.createMediaStreamSource(new MediaStream(shared.getAudioTracks())).connect(dest);
        } else if (!auxOk) {
          setWarn('This share carries no audio — only your microphone is being heard. '
            + 'Pick a system-audio input below, or share the call as a browser tab.');
        }
      }

      const tap = new AudioWorkletNode(ac, 'pcm-tap');
      tap.port.onmessage = e => { buf.current.push(e.data); bufLen.current += e.data.length; };
      dest.connect(tap);
      // A worklet only runs while its output is connected to something. A zeroed
      // gain node keeps the graph alive without putting the lecture through the
      // speakers, which would feed straight back into the microphone.
      const mute = ac.createGain();
      mute.gain.value = 0;
      tap.connect(mute).connect(ac.destination);
      node.current = tap;

      if (shared) {
        const v = document.createElement('video');
        v.srcObject = new MediaStream(shared.getVideoTracks());
        v.muted = true;
        await v.play();
        video.current = v;
        const c = document.createElement('canvas');
        c.width = THUMB_W; c.height = THUMB_H;
        thumb.current = c;
        timers.current.push(setInterval(sampleSlide, SAMPLE_EVERY_MS));
      }

      timers.current.push(setInterval(() => setSecs(s => s + 1), 1000));
      timers.current.push(setInterval(() => drain(false), 5000));
      setState('live');
    } catch (e) {
      teardown();
      setErr(e?.name === 'NotAllowedError'
        ? 'Permission refused — the microphone is needed, and the share dialog needs a tab or window picked.'
        : String(e.message || e));
      setState('idle');
    }
  }

  function sampleSlide() {
    const v = video.current, c = thumb.current;
    if (!v || !c || !v.videoWidth) return;
    c.getContext('2d').drawImage(v, 0, 0, THUMB_W, THUMB_H);
    const now = greyscale(c);
    setSlides(prev => {
      const d = slideDecision({ current: now, lastKept: lastKept.current, lastSeen: lastSeen.current, keptCount: prev.length });
      lastSeen.current = now;
      if (!d.keep) return prev;
      lastKept.current = now;
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
    drain(true);                    // the last, short chunk still counts
    try { node.current?.disconnect(); } catch { /* already gone */ }
    streams.current.forEach(s => s.getTracks().forEach(t => t.stop()));
    streams.current = [];
    try { ctx.current?.close(); } catch { /* already closed */ }
    setState('done');
  }

  const transcript = stitch(parts);
  const cost = estimateCost({ minutes: secs / 60, slides: slides.length });

  return (
    <Card title="Lecture recorder" color="var(--pink)"
      right={state === 'live' ? <span className="rc-live"><span className="rc-dot" />REC {fmtElapsed(secs)}</span> : null}>

      {state === 'idle' && (
        <>
          <div className="flex" style={{ gap: 6, flexWrap: 'wrap' }}>
            {Object.entries(CAPTURE_MODES).map(([k, m]) => (
              <button key={k} className={`btn btn-sm${mode === k ? ' btn-pink' : ''}`} onClick={() => setMode(k)}>{m.label}</button>
            ))}
          </div>
          <div className="small muted mt">{CAPTURE_MODES[mode].hint}</div>

          {modeWarning(mode) && (
            <div className="small mt" style={{ color: 'var(--yellow)', lineHeight: 1.55 }}>
              ⚠ {modeWarning(mode)}
              {/* The actual fix, in the place where the problem is stated. */}
              <div className="mt" style={{ color: 'var(--ink-2)' }}>
                <b style={{ fontWeight: 'normal', color: 'var(--cyan)' }}>The fix, once:</b> install{' '}
                <a href="https://existential.audio/blackhole/" target="_blank" rel="noreferrer">BlackHole 2ch</a>,
                then in Audio MIDI Setup make a <i>Multi-Output Device</i> containing your speakers and BlackHole and
                select it as the system output. Pick BlackHole as the second input below and the lecturer is recorded
                even from the Teams desktop app — while you still hear the class normally.
              </div>
            </div>
          )}

          <div className="flex mt" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {devices.length === 0
              ? <button className="btn btn-sm" onClick={loadDevices}>choose audio inputs…</button>
              : (
                <>
                  <label className="small muted">mic
                    <select value={micId} onChange={e => setMicId(e.target.value)} style={{ marginLeft: 6 }}>
                      <option value="">default</option>
                      {devices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || 'input'}</option>)}
                    </select>
                  </label>
                  <label className="small muted">second input
                    <select value={auxId} onChange={e => setAuxId(e.target.value)} style={{ marginLeft: 6 }}>
                      <option value="">none</option>
                      {devices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || 'input'}</option>)}
                    </select>
                  </label>
                </>
              )}
          </div>

          <div className="flex mt" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input placeholder="Subject — e.g. IoT System Design" value={subject}
              onChange={e => setSubject(e.target.value)} style={{ flex: 1, minWidth: 180 }} />
            <button className="btn btn-pink" onClick={start}>● Record</button>
          </div>

          <div className="small muted mt" style={{ lineHeight: 1.55 }}>
            The audio is transcribed a minute at a time and thrown away — no recording is kept or stored.
            You are recording other people; the browser shows a sharing banner throughout.
          </div>
        </>
      )}

      {state === 'live' && (
        <>
          <div className="flex" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn" onClick={stop}>■ Stop</button>
            <span className="small muted">
              {slides.length} slide{slides.length === 1 ? '' : 's'} · {parts.filter(Boolean).length} min transcribed
              {pending ? ` · ${pending} in flight` : ''}
            </span>
          </div>
          {transcript && <div className="note-transcript">{transcript.slice(-600)}</div>}
        </>
      )}

      {state === 'done' && (
        <>
          <div className="small" style={{ lineHeight: 1.6 }}>
            {fmtElapsed(secs)} · {slides.length} slide{slides.length === 1 ? '' : 's'} ·{' '}
            {transcript.split(/\s+/).filter(Boolean).length} words · est. <b>${cost.toFixed(2)}</b> to write up
          </div>
          {transcript && <div className="note-transcript">{transcript}</div>}
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
            Writing this up into notes and filing it at <code>{lecturePath({ subject, date: new Date().toISOString() })}</code>{' '}
            is the next build — the transcript and slides above are what it will be written from.
          </div>
          <div className="flex mt" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-sm" onClick={() => navigator.clipboard?.writeText(transcript)} disabled={!transcript}>
              ⧉ copy transcript
            </button>
            <button className="btn btn-sm" onClick={() => { setState('idle'); setParts([]); setSlides([]); }}>new recording</button>
          </div>
        </>
      )}

      {warn && <div className="small mt" style={{ color: 'var(--yellow)' }}>{warn}</div>}
      {err && <div className="small mt" style={{ color: 'var(--red)' }}>{err}</div>}
    </Card>
  );
}
