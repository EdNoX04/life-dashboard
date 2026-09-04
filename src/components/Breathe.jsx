import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as br from '../lib/breathe.js';
import * as alarm from '../lib/alarm.js';

// Guided breathing.
//
// The arithmetic all lives in lib/breathe.js, tested against exact boundaries.
// What is here is the part that has to feel right rather than be right:
//
// THE RING IS THE INSTRUCTION. No text tells you to slow down at the turn —
// the ring does, because it is cosine-eased and therefore slowest at the top
// and bottom of the breath. Follow its edge and you are breathing correctly.
//
// THE CUES ARE SCHEDULED, NOT POLLED. Every note for the whole session goes onto
// the audio clock the moment you press start (see alarm.scheduleTones). That is
// what makes this usable with your eyes shut and the screen off: a page's own
// timers are throttled or stopped outright in a background tab, but a note
// scheduled on the audio clock plays when it said it would.
//
// SO THE VISUAL LOOP IS ALLOWED TO BE LAZY. requestAnimationFrame stops in a
// background tab, and that is fine — nobody is looking at it. When you come
// back it recomputes from elapsed time and is instantly correct again, because
// nothing about the session's state lives in the animation.

const KEY = 'p1_breathe';

/**
 * `suggest` is only a default for someone who has never chosen.
 *
 * The Sleep tab suggests 4-7-8 and the Study tab suggests box, because the long
 * exhale is for getting to sleep and the even count is for settling before
 * work. But once a choice has been made it is honoured everywhere — a setting
 * that silently reverts depending on which screen you opened is worse than one
 * that is occasionally not what this screen would have picked.
 */
function load(suggest) {
  const fallback = br.patternById(suggest).id;
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    const p = raw ? JSON.parse(raw) : {};
    return {
      pattern: typeof p.pattern === 'string' ? p.pattern : fallback,
      minutes: br.DURATIONS.includes(p.minutes) ? p.minutes : br.DEFAULT_MINUTES,
      sound: p.sound !== false,
    };
  } catch {
    return { pattern: fallback, minutes: br.DEFAULT_MINUTES, sound: true };
  }
}

function save(prefs) {
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify(prefs)); } catch { /* private mode */ }
}

export default function Breathe({ rows = [], onFinish, suggest }) {
  const [prefs, setPrefs] = useState(() => load(suggest));
  const [startedAt, setStartedAt] = useState(0);      // ms; 0 means idle
  const [, repaint] = useState(0);

  const cancelCues = useRef(() => {});
  const cancelEnd = useRef(() => {});
  const raf = useRef(0);

  const pattern = br.patternById(prefs.pattern);
  const total = br.plannedSeconds(pattern, prefs.minutes);
  const running = startedAt > 0;

  const elapsed = running ? Math.min(total, (Date.now() - startedAt) / 1000) : 0;
  const ph = br.phaseAt(pattern, elapsed);
  // Idle sits at half rather than empty: a ring collapsed to its smallest
  // reads as something that has stopped working, not something waiting.
  const scale = running && ph ? br.scaleAt(ph.kind, ph.progress) : 0.5;
  const done = br.stats(rows);

  const update = next => { const p = { ...prefs, ...next }; setPrefs(p); save(p); };

  const stop = useCallback(() => {
    cancelCues.current(); cancelCues.current = () => {};
    cancelEnd.current(); cancelEnd.current = () => {};
    cancelAnimationFrame(raf.current);
    setStartedAt(0);
  }, []);

  // Everything is torn down on unmount. Without this, leaving the tab mid-session
  // leaves several minutes of scheduled notes playing to an empty room.
  useEffect(() => stop, [stop]);

  const start = () => {
    if (running) { stop(); return; }
    // Touching the audio context here matters: browsers start it suspended until
    // a gesture, and this click is the gesture. Scheduling from anywhere else
    // would silently produce a session with no cues at all.
    const seconds = br.plannedSeconds(pattern, prefs.minutes);
    if (prefs.sound) {
      cancelCues.current = alarm.scheduleTones(br.cueSchedule(pattern, prefs.minutes));
    }
    const at = Date.now();
    // One long timeout rather than watching the clock tick past the end — the
    // same reason the pomodoro uses it, and it survives a backgrounded tab.
    cancelEnd.current = alarm.armAt(at + seconds * 1000, () => finish(seconds, at));
    setStartedAt(at);
  };

  const finish = (seconds, at) => {
    cancelCues.current(); cancelCues.current = () => {};
    setStartedAt(0);
    if (prefs.sound) alarm.blip({ hz: 523.25, len: 0.9, peak: 0.35 });
    onFinish?.({
      mode: br.MODE,
      label: br.sessionLabel(pattern),
      // Rounded up: a 128-second session is two minutes of your evening, and
      // recording it as 2 rather than 2.13 is the honest granularity here.
      minutes: Math.max(1, Math.round(seconds / 60)),
      endedAt: at + seconds * 1000,
    });
  };

  // The visual loop. Deliberately the only thing that stops in a background tab.
  useEffect(() => {
    if (!running) return undefined;
    const tick = () => { repaint(n => n + 1); raf.current = requestAnimationFrame(tick); };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [running]);

  const left = running ? Math.max(0, total - elapsed) : total;
  const cycles = br.cyclesFor(pattern, prefs.minutes);

  return (
    <div className="breathe">
      {/* Faded, not unmounted. Removing the controls while a session runs would
          shrink the card by about a hundred and forty pixels and yank everything
          below it up the page — a layout jump at the exact moment the thing is
          asking you to settle. Reserving the space costs nothing. */}
      <div className="breathe-setup" aria-hidden={running}
        style={{ opacity: running ? 0 : 1, pointerEvents: running ? 'none' : 'auto' }}>
        <>
          <div className="flex" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            {br.PATTERNS.map(p => (
              <button key={p.id}
                className={`btn btn-sm ${prefs.pattern === p.id ? 'btn-cyan' : ''}`}
                onClick={() => update({ pattern: p.id })}>
                {p.label} <span className="muted">{p.rhythm}</span>
              </button>
            ))}
          </div>
          {/* The note is the honest part: what this one is actually for, rather
              than a claim about what it will do to you. */}
          <div className="small muted" style={{ lineHeight: 1.5, marginBottom: 10 }}>
            {pattern.note}
          </div>

          <div className="flex" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {br.DURATIONS.map(m => (
              <button key={m}
                className={`btn btn-sm ${prefs.minutes === m ? 'btn-green' : ''}`}
                onClick={() => update({ minutes: m })}>
                {m}m
              </button>
            ))}
            <button className={`btn btn-sm ${prefs.sound ? 'btn-green' : ''}`}
              aria-pressed={prefs.sound}
              onClick={() => update({ sound: !prefs.sound })}
              title="A note at the start of each phase, so you can follow it with your eyes shut">
              {prefs.sound ? '🔊' : '🔇'} cues
            </button>
          </div>
        </>
      </div>

      <div className="breathe-stage">
        <div className="breathe-ring"
          style={{
            // 0.42 rather than 0 at the bottom: a ring that collapses to a point
            // reads as the exercise having stopped.
            transform: `scale(${0.42 + 0.58 * scale})`,
            borderColor: running ? 'var(--cyan)' : 'var(--border)',
          }} />
        <div className="breathe-face">
          {running ? (
            <>
              <div className="breathe-cue">{br.LABEL[ph.kind]}</div>
              <div className="breathe-count">{br.countdown(ph)}</div>
            </>
          ) : (
            <>
              <div className="breathe-cue muted">{pattern.label}</div>
              <div className="breathe-rhythm">{pattern.rhythm}</div>
            </>
          )}
        </div>
      </div>

      <div className="flex" style={{ justifyContent: 'center', gap: 8, marginTop: 10 }}>
        <button className={`btn ${running ? '' : 'btn-cyan'}`} onClick={start}>
          {running ? '■ Stop' : '▶ Begin'}
        </button>
      </div>

      {/* min-height in CSS rather than a shorter sentence: the idle line wraps to
          three lines and the running line is one, and letting the card resize
          between them puts the same layout jump back that fading the controls
          just removed. */}
      <div className="small muted mt breathe-foot" style={{ textAlign: 'center', lineHeight: 1.6 }}>
        {running ? (
          <>
            {br.fmtClock(left)} left · breath {(ph?.cycle ?? 0) + 1} of {cycles}
          </>
        ) : (
          <>
            {cycles} breaths · {br.fmtClock(total)}
            {/* Said plainly, because a "2 minute" button that runs for 2:08 and
                does not admit it is a small lie repeated every time. */}
            {total !== prefs.minutes * 60 && (
              <span> — whole breaths, so a little over {prefs.minutes}m</span>
            )}
          </>
        )}
        {!running && done.week > 0 && (
          <div style={{ marginTop: 4 }}>
            <b style={{ color: 'var(--cyan)' }}>{done.today} today</b> · {done.week} this week
          </div>
        )}
      </div>
    </div>
  );
}
