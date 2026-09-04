import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, Empty } from '../components/ui.jsx';
import { useCollection, todayStr } from '../lib/hooks.js';
import LofiRadio from '../components/LofiRadio.jsx';
import Ambience from '../components/Ambience.jsx';
import Breathe from '../components/Breathe.jsx';
import * as pomo from '../lib/pomodoro.js';
import {
  SUBJECTS, EXAM_WINDOW, FBL_MODULES, FBL_RULE,
  examCountdown, fblStatus, revisionPlan, todayPlan, schedule, guideUrl, fmtDay, fmtTime,
} from '../lib/exams.js';
import { useReminderDone } from '../lib/useReminderDone.js';
import * as focus from '../lib/focus.js';
import * as alarm from '../lib/alarm.js';
import * as breathe from '../lib/breathe.js';
import * as db from '../lib/db.js';

// The study room, now with an exam in it.
//
// Order on the page follows urgency rather than tidiness: how long is left,
// what to do today, then the material, then the timer. In the last week before
// a paper the first two are the only things worth looking at, and they should
// not be below a fold.

// Stations are LISTS OF SOURCES, tried in order until one plays.
//
// Lofi Girl's streams come first because they are what Neel actually wants —
// her catalogue is the point. One of her ids (the main study stream) returned
// YouTube error 150, "embedding disabled by the owner", while Synth and Jazz
// played fine the whole time; I wrongly generalised that one refusal into
// "YouTube is dead" and removed the lot. It is not the transport that fails, it
// is individual videos, unpredictably and without warning.
//
// So each station carries her streams first and a direct Icecast mount last.
// If an id is refused the radio marks it dead for the session and moves to the
// next source silently — Neel hears music, not an error.
const STUDY_STATIONS = [
  { label: 'Lofi', sources: [
    { kind: 'yt', id: 'jfKfPfyJRdk' },                       // lofi hip hop radio — beats to relax/study to
    { kind: 'yt', id: 'rUxyKA_-grg' },                       // lofi hip hop radio — beats to sleep/chill to
    { kind: 'yt', id: 'DWcJFNfaw9c' },                       // older Lofi Girl lofi stream
    { kind: 'stream', url: 'https://ice1.somafm.com/fluid-128-mp3' },
  ]},
  { label: 'Synth', sources: [
    { kind: 'yt', id: '4xDzrJKXOOY' },                       // synthwave radio — confirmed playing
    { kind: 'stream', url: 'https://ice1.somafm.com/spacestation-128-mp3' },
  ]},
  { label: 'Jazz', sources: [
    { kind: 'yt', id: 'E2vONfzoyRI' },                       // jazz lofi radio — confirmed playing
    { kind: 'stream', url: 'https://ice1.somafm.com/sonicuniverse-128-mp3' },
  ]},
  { label: 'Chill', sources: [
    { kind: 'yt', id: '5yx6BWlEVcY' },                       // Chillhop Radio
    { kind: 'stream', url: 'https://ice1.somafm.com/groovesalad-128-mp3' },
  ]},
];
const DUR = pomo.DUR;
const fmt = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

export default function Study({ go }) {
  const today = todayStr();

  // ---- exam block -------------------------------------------------------
  // The timetable is now confirmed (with times) and lives in EXAM_SCHEDULE, so
  // there is nothing for the user to assign — the plan reads the real dates,
  // including the double-paper day (3 Sept: Network Security 10 AM, IoT 4 PM).
  const exams = useMemo(() => schedule(), []);

  const cd = useMemo(() => examCountdown(today), [today]);
  const plan = useMemo(() => revisionPlan(today), [today]);
  const mine = useMemo(() => todayPlan(today), [today]);
  // Same source of truth as the HQ reminder: tick a module on either screen and
  // both agree. Before this, Study derived "done" from the calendar alone, so a
  // module Neel had actually finished still read as OPEN NOW for the fortnight.
  const { doneMap, setDone, busy: doneBusy, err: doneErr } = useReminderDone();
  const fbl = useMemo(() => fblStatus(today, doneMap), [today, doneMap]);

  const [openGuide, setOpenGuide] = useState(null);
  const [showAll, setShowAll] = useState(false);

  const cdColor = cd.state === 'during' ? 'var(--red)'
    : cd.days <= 3 ? 'var(--red)' : cd.days <= 7 ? 'var(--yellow)' : 'var(--purple)';

  // ---- pomodoro / ambience (unchanged) ----------------------------------
  const [pomoState, setPomoState] = useState(pomo.get);
  // The duration editor is closed by default. A timer you have to configure
  // before you can press start is a worse timer; 25/5/15 stays one click away.
  const [pomoEdit, setPomoEdit] = useState(false);
  const [, repaint] = useState(0);
  const { mode, rounds, running } = pomoState;
  const secs = pomo.remaining(pomoState);
  const tick = useRef(null);

  const { items: subjects } = useCollection('subjects', { order: 'name', asc: true });
  const withNotes = subjects.filter(s => s.notes_url);
  const [openNotes, setOpenNotes] = useState(null);

  // ---- what the timer is FOR ---------------------------------------------
  // A pomodoro with no name produces a number that means nothing a week later.
  // The picker offers open todos first, because most focused work is already on
  // the list, and free text second, because some of it never will be.
  const { items: todos, patch: patchTodo } = useCollection('todos', { order: 'due_date', asc: true });
  const { items: sessions, add: addSession, refresh: refreshSessions } =
    useCollection('focus_sessions', { order: 'ended_at', asc: false });
  const [pickTask, setPickTask] = useState(false);
  const [taskDraft, setTaskDraft] = useState('');
  const [histOpen, setHistOpen] = useState(false);
  const [logErr, setLogErr] = useState('');

  const openTodos = useMemo(() => focus.pickableTodos(todos), [todos]);
  const totals = useMemo(() => focus.totalsByLabel(sessions), [sessions]);
  const todayMins = useMemo(() => focus.minutesOn(sessions, focus.todayKey()), [sessions]);
  const weekMins = useMemo(() => focus.minutesSince(sessions, 7), [sessions]);
  const dayStreak = useMemo(() => focus.streak(sessions), [sessions]);

  function chooseTodo(t) {
    pomo.set(st => pomo.setTask(st, { label: t.title, todoId: t.id }));
    setPickTask(false); setTaskDraft('');
  }
  function chooseFree() {
    const label = focus.cleanLabel(taskDraft, '');
    if (!label) return;
    pomo.set(st => pomo.setTask(st, { label, todoId: null }));
    setPickTask(false); setTaskDraft('');
  }

  useEffect(() => pomo.subscribe(setPomoState), []);

  // ---- the end-of-block alarm ----
  const [alerts, setAlerts] = useState(alarm.prefs);
  const [notifPerm, setNotifPerm] = useState(alarm.notifyPermission);
  useEffect(() => alarm.subscribe(() => setAlerts(alarm.prefs())), []);

  // Ring when a block ends.
  //
  // `announce` is idempotent per deadline, which is what makes it safe to call
  // from two places: this effect (which fires whenever anything reads the timer)
  // and the scheduled timeout below. Neither one alone is enough — the effect
  // depends on something re-rendering, and a backgrounded tab has its repeating
  // timers throttled to about once a minute — so both exist and exactly one
  // rings.
  useEffect(() => {
    const f = pomoState.finished;
    if (!f) return;
    alarm.announce({
      mode: f.mode, at: f.at, label: f.label, minutes: f.minutes,
      next: pomo.MODE_LABEL[pomo.get().mode],
    });
  }, [pomoState.finished]);

  // One long timeout aimed at the deadline itself. Browsers are far kinder to a
  // single distant timeout than to a 1-second interval in a hidden tab, so this
  // is what actually gets you off the sofa.
  useEffect(() => {
    if (!pomoState.running || !pomoState.endsAt) return undefined;
    return alarm.armAt(pomoState.endsAt, () => {
      const st = pomo.poll();
      const f = st.finished;
      if (f) {
        alarm.announce({
          mode: f.mode, at: f.at, label: f.label, minutes: f.minutes,
          next: pomo.MODE_LABEL[st.mode],
        });
      }
    });
  }, [pomoState.running, pomoState.endsAt]);

  // Write a completed block to history, exactly once.
  //
  // `markLogged` is what makes it exactly once: this effect runs on every change
  // to pomoState, and React's StrictMode double-invokes effects in development,
  // so without the flag every session would be recorded two or three times and
  // the totals would quietly be wrong rather than visibly broken.
  //
  // Only FOCUS blocks are recorded. A break is not time you spent on the task,
  // and counting it would make the history flattering and useless.
  useEffect(() => {
    const f = pomoState.finished;
    if (!f || f.logged || f.mode !== 'focus') return;
    pomo.set(pomo.markLogged);
    let alive = true;
    (async () => {
      try {
        const todo = f.todoId ? todos.find(t => t.id === f.todoId) : null;
        await addSession(focus.sessionRow({
          mode: f.mode, label: f.label, todo, minutes: f.minutes, endedAt: f.at,
        }));
        // Keep the task's own record of effort honest too — `actual_min` already
        // existed on todos as an estimate nobody filled in.
        if (todo) {
          const before = Number(todo.actual_min) || 0;
          await patchTodo(todo.id, { actual_min: before + f.minutes });
        }
        if (alive) setLogErr('');
      } catch (e) {
        // A failed write must not be silent: the whole value of this feature is
        // that the number is trustworthy.
        if (alive) setLogErr(String(e.message || e));
      }
    })();
    return () => { alive = false; };
  }, [pomoState.finished, todos, addSession, patchTodo]);

  useEffect(() => {
    if (!running) { clearInterval(tick.current); return; }
    tick.current = setInterval(() => {
      // poll(), not get(): get() settles silently, so the second the block ended
      // the subscribed state still said "running" and the ring froze at 00:00
      // without ever showing that it was over. That was the actual reason the
      // end of a pomodoro was easy to miss.
      const st = pomo.poll();
      repaint(n => n + 1);
      if (!st.running) clearInterval(tick.current);
    }, 1000);
    return () => clearInterval(tick.current);
  }, [running]);

  useEffect(() => {
    const wake = () => { pomo.poll(); repaint(n => n + 1); };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    return () => {
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('focus', wake);
    };
  }, []);

  // A finished breathing session is recorded in the same table as focus blocks
  // but under its own mode, so it is never counted as study time — focus.js
  // filters on mode === 'focus'. Winding down is worth a record and is not work.
  const logBreath = useCallback(async ({ label, minutes, endedAt }) => {
    try {
      await addSession(focus.sessionRow({ mode: breathe.MODE, label, minutes, endedAt }));
      setLogErr('');
    } catch (e) {
      setLogErr(String(e.message || e));
    }
  }, [addSession]);

  const setM = m => pomo.set(st => pomo.setMode(st, m));
  const cfg = pomo.normalizeConfig(pomoState.cfg);
  const preset = pomo.presetOf(pomoState);
  const pct = 100 - Math.round((secs / DUR[mode]) * 100);
  const ringColor = mode === 'focus' ? 'var(--pink)' : 'var(--green)';

  const shownDays = showAll ? plan.days : plan.days.slice(0, 6);

  return (
    <>
      <h1 className="tab-title">STUDY ROOM</h1>
      <p className="tab-sub">Minor exams · {EXAM_WINDOW.label} · three papers. 🏡</p>

      {/* ---------------- countdown ---------------- */}
      <Card title="Minor exams" color={cdColor}
        right={<span className="chip" style={{ borderColor: cdColor, color: cdColor }}>{cd.text}</span>}>
        <div className="exam-days">
          {exams.map((e) => {
            const past = e.date < today;
            const isToday = e.date === today;
            return (
              <div key={e.slug} className={`exam-day${past ? ' exam-past' : ''}`}
                style={{ borderColor: e.color }}>
                <div className="exam-date">
                  {fmtDay(e.date)}{isToday ? ' · today' : ''}
                </div>
                <div className="exam-pick" style={{ color: e.color, fontWeight: 600 }}>
                  {e.short}
                </div>
                <div className="small muted" style={{ marginTop: 2 }}>
                  {fmtTime(e.start)}–{fmtTime(e.end)} · {e.code}
                </div>
              </div>
            );
          })}
        </div>
        <div className="small mt muted" style={{ lineHeight: 1.55 }}>
          3 Sept is a double — {' '}
          <b style={{ color: 'var(--cyan)' }}>Network Security 10 AM</b> then{' '}
          <b style={{ color: 'var(--green)' }}>IoT 4 PM</b>. The plan below reserves each
          evening for the next paper and keeps the 11 AM–4 PM gap on the 3rd for IoT.
        </div>
      </Card>

      {/* ---------------- today ---------------- */}
      {mine && (
        <Card title={`Today — ${mine.label}`} color={mine.color || 'var(--green)'}
          right={mine.kind === 'exam' ? <span className="chip c-red">exam day</span>
            : mine.kind === 'eve' ? <span className="chip c-yellow">night before</span> : null}>
          <div style={{ fontSize: 14, color: 'var(--ink)', marginBottom: 8 }}>{mine.title}</div>
          <ul className="plan-list">
            {mine.items.map((it, i) => <li key={i}>{it}</li>)}
          </ul>
        </Card>
      )}

      {/* ---------------- the guides ---------------- */}
      <Card title="Exam guides" color="var(--cyan)">
        <div className="small muted" style={{ marginBottom: 10, lineHeight: 1.55 }}>
          One file per subject — the whole syllabus, module by module, with the sub-topic depth that earns
          the extra marks, the traps examiners actually set, and a self-test section. Each opens here, works
          with no internet, and downloads as a single file you can keep on your phone.
        </div>
        <div className="guide-row">
          {SUBJECTS.map(s => (
            <div key={s.slug} className="guide-card" style={{ borderColor: s.color }}>
              <div className="guide-code" style={{ color: s.color }}>{s.code}</div>
              <div className="guide-name">{s.name}</div>
              <div className="guide-mods">{s.modules.length} modules</div>
              <div className="flex" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                <button className={`btn btn-sm ${openGuide === s.slug ? 'btn-cyan' : ''}`}
                  onClick={() => setOpenGuide(openGuide === s.slug ? null : s.slug)}>
                  {openGuide === s.slug ? 'Close' : 'Open'}
                </button>
                {/* download rather than navigate: this is the copy that has to
                    survive a dead campus wifi on the morning of the paper. */}
                <a className="btn btn-sm" href={guideUrl(s.slug)} download={`${s.slug}.html`}>↓ Save</a>
                <a className="btn btn-sm" href={guideUrl(s.slug)} target="_blank" rel="noreferrer">↗ Tab</a>
              </div>
            </div>
          ))}
        </div>
        {openGuide && (
          <div className="notes-frame mt">
            <iframe title="study guide" src={guideUrl(openGuide)}
              style={{ width: '100%', height: 620, border: '1px solid var(--border-bright)', borderRadius: 8, background: '#080a12' }} />
          </div>
        )}
      </Card>

      {/* ---------------- the schedule ---------------- */}
      <Card title="Revision schedule" color="var(--purple)"
        right={plan.days.length > 6 && (
          <button className="btn btn-sm" onClick={() => setShowAll(v => !v)}>
            {showAll ? 'Show less' : `All ${plan.days.length} days`}
          </button>
        )}>
        {plan.days.length === 0
          ? <Empty icon="✓" text={plan.note} />
          : (
            <>
              <div className="small muted" style={{ marginBottom: 10, lineHeight: 1.55 }}>{plan.note}</div>
              <div className="plan-days">
                {shownDays.map(d => (
                  <div key={d.date} className={`plan-day plan-${d.kind}${d.date === today ? ' plan-now' : ''}`}
                    style={{ borderLeftColor: d.color || 'var(--border-bright)' }}>
                    <div className="plan-head">
                      <span className="plan-date">{d.label}</span>
                      <span className="plan-title" style={{ color: d.color || 'var(--ink)' }}>{d.title}</span>
                      {d.kind === 'exam' && <span className="chip c-red">PAPER</span>}
                      {d.kind === 'eve' && <span className="chip c-yellow">eve</span>}
                    </div>
                    <ul className="plan-list">
                      {d.items.map((it, i) => <li key={i}>{it}</li>)}
                    </ul>
                  </div>
                ))}
              </div>
            </>
          )}
      </Card>

      {/* ---------------- Spanish FBL ---------------- */}
      <Card title="Spanish · FBL modules"
        color={fbl.urgency === 'now' ? 'var(--red)' : fbl.urgency === 'soon' ? 'var(--yellow)' : 'var(--cyan)'}
        right={<span className="chip" style={{
          borderColor: fbl.urgency === 'now' ? 'var(--red)' : 'var(--cyan)',
          color: fbl.urgency === 'now' ? 'var(--red)' : 'var(--cyan)',
        }}>{fbl.text}</span>}>
        {/* The rule, first and in red, because it is the whole reason this card
            exists: there is no catch-up. A missed window is simply gone. */}
        <div className="small" style={{ color: 'var(--red)', marginBottom: 10, lineHeight: 1.55 }}>
          ⚠ {FBL_RULE}
        </div>
        {doneErr && <div className="small" style={{ color: 'var(--red)' }}>Could not save that: {doneErr}</div>}
        <div className="fbl-list">
          {/* `closed` (the window has passed) and `done` (Neel finished it) were
              the same variable here, both spelled "done". They are not the same
              thing: a module can close unfinished, which is the failure this
              card exists to prevent, and one he finished early is not closed. */}
          {(fbl.modules || FBL_MODULES).map(m => {
            const closed = m.closed ?? today > m.to;
            const inWindow = today >= m.from && today <= m.to;
            const open = inWindow && !m.done;
            const state = m.done ? 'DONE' : inWindow ? 'OPEN NOW' : closed ? 'missed' : 'upcoming';
            return (
              <div key={m.n} className={`fbl-row${open ? ' fbl-open' : ''}${(closed || m.done) ? ' fbl-done' : ''}`}>
                <span className="fbl-label">{m.label}</span>
                <span className="fbl-span">{fmtDay(m.from)} → {fmtDay(m.to)}</span>
                <span className="fbl-state" style={m.done ? { color: 'var(--green)' } : undefined}>{state}</span>
                {/* Only a module whose window is open can be ticked. An upcoming
                    one has nothing to finish yet, and a closed one cannot be
                    attempted late — that is the rule in red above this list. */}
                {(inWindow || m.done) && (
                  <button
                    className="btn btn-sm"
                    title={m.done ? 'Mark not done' : 'Mark done'}
                    aria-label={`${m.done ? 'Unmark' : 'Mark'} ${m.label} as done`}
                    disabled={doneBusy === m.key}
                    onClick={() => setDone(m.key, !m.done)}
                  >
                    {doneBusy === m.key ? '·' : m.done ? '↺' : '✓'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {/* Module 2 opens the day before the exams start. Worth pointing at,
            because it is exactly the week it would be forgotten. */}
        <div className="small muted mt" style={{ lineHeight: 1.55 }}>
          Module 2 runs 29 Aug – 11 Sept, straight across the exam block. Do it before 1 September or
          immediately after the last paper — the window closes either way.
        </div>
      </Card>

      {/* ---------------- timer & ambience ---------------- */}
      <div className="grid2">
        <Card title="Pomodoro" color={ringColor}
          right={
            <button className={`btn btn-sm ${pomoEdit ? 'btn-pink' : ''}`}
              onClick={() => setPomoEdit(v => !v)}
              aria-expanded={pomoEdit}
              title="Customise the lengths">
              {pomoEdit ? 'done' : '⚙ lengths'}
            </button>
          }>
          <div className="flex" style={{ gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
            {[['focus', 'Focus'], ['short', 'Short break'], ['long', 'Long break']].map(([m, l]) => (
              <button key={m} className={`btn btn-sm ${mode === m ? 'btn-pink' : ''}`} onClick={() => setM(m)}>
                {l} <span className="muted">{cfg[m]}m</span>
              </button>
            ))}
          </div>

          {pomoEdit && (
            <div className="pomo-cfg">
              <div className="flex" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                {pomo.PRESETS.map(p => (
                  <button key={p.id}
                    className={`btn btn-sm ${preset === p.id ? 'btn-green' : ''}`}
                    onClick={() => pomo.set(st => pomo.applyPreset(st, p.id))}>
                    {p.label} <span className="muted">{p.focus}/{p.short}</span>
                  </button>
                ))}
                {preset === null && <span className="chip c-yellow">custom</span>}
              </div>
              <div className="pomo-cfg-grid">
                {[['focus', 'Focus'], ['short', 'Short break'], ['long', 'Long break']].map(([k, label]) => (
                  <label key={k}>
                    <span className="small muted">{label}</span>
                    <span className="pomo-num">
                      <input type="number" inputMode="numeric"
                        min={pomo.MIN_MINUTES} max={pomo.MAX_MINUTES}
                        value={cfg[k]}
                        onChange={e => pomo.set(st => pomo.setConfig(st, { [k]: e.target.value }))} />
                      <b>min</b>
                    </span>
                  </label>
                ))}
                <label>
                  <span className="small muted">Long break after</span>
                  <span className="pomo-num">
                    <input type="number" inputMode="numeric"
                      min={pomo.MIN_ROUNDS} max={pomo.MAX_ROUNDS}
                      value={cfg.perLong}
                      onChange={e => pomo.set(st => pomo.setConfig(st, { perLong: e.target.value }))} />
                    <b>focus</b>
                  </span>
                </label>
              </div>
              <div className="small muted mt" style={{ lineHeight: 1.5 }}>
                {running
                  ? 'A running block keeps the length it started with — the new one applies from the next session.'
                  : `${pomo.MIN_MINUTES}–${pomo.MAX_MINUTES} minutes. Saved on this device and used by the timer everywhere.`}
              </div>
            </div>
          )}
          {/* ---- what this block is for ---- */}
          <div className="pomo-task">
            {pomoState.label ? (
              <div className="flex" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="pomo-task-on">
                  {pomoState.todoId ? '☑' : '◆'} {pomoState.label}
                </span>
                <button className="btn btn-sm" onClick={() => { setPickTask(v => !v); setTaskDraft(pomoState.label); }}>change</button>
                <button className="btn btn-sm" onClick={() => pomo.set(pomo.clearTask)}>clear</button>
              </div>
            ) : (
              <button className="btn btn-sm btn-cyan" onClick={() => setPickTask(v => !v)}>
                ＋ what are you working on?
              </button>
            )}

            {pickTask && (
              <div className="pomo-pick">
                {openTodos.length > 0 && (
                  <>
                    <div className="small muted" style={{ marginBottom: 6 }}>From your todo list</div>
                    <div className="pomo-pick-list">
                      {openTodos.map(t => (
                        <button key={t.id} className="btn btn-sm" onClick={() => chooseTodo(t)} title={t.title}>
                          {t.title.length > 34 ? t.title.slice(0, 33) + '…' : t.title}
                          {Number(t.actual_min) > 0 && <span className="muted"> · {focus.fmtMinutes(t.actual_min)}</span>}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                <div className="flex mt" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <input
                    style={{ flex: 1, minWidth: 160 }}
                    placeholder="…or type a goal — e.g. revise Module 2"
                    value={taskDraft}
                    onChange={e => setTaskDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') chooseFree(); if (e.key === 'Escape') setPickTask(false); }}
                    autoFocus
                  />
                  <button className="btn btn-green" onClick={chooseFree} disabled={!taskDraft.trim()}>set</button>
                </div>
              </div>
            )}
          </div>

          <div className="flex" style={{ justifyContent: 'center' }}>
            <div className="pomo-ring" style={{ '--c': ringColor, '--p': pct }}>
              <div className="pomo-inner">
                <div className="pomo-time">{fmt(secs)}</div>
                <div className="pomo-mode">{mode === 'focus' ? 'FOCUS' : 'BREAK'}</div>
              </div>
            </div>
          </div>
          <div className="flex" style={{ justifyContent: 'center', gap: 8, marginTop: 12 }}>
            <button className={`btn ${running ? '' : 'btn-green'}`}
              onClick={() => pomo.set(st => (st.running ? pomo.pause(st) : pomo.start(st)))}>
              {running ? '❚❚ Pause' : '▶ Start'}
            </button>
            <button className="btn" onClick={() => pomo.set(st => pomo.reset(st))}>↺ Reset</button>
          </div>
          <div className="small muted mt" style={{ textAlign: 'center' }}>
            🍅 {rounds} rounds this session · long break every {cfg.perLong}
            {todayMins > 0 && <> · <b style={{ color: 'var(--green)' }}>{focus.fmtMinutes(todayMins)} focused today</b></>}
          </div>
          {/* ---- how you find out it is over ---- */}
          <div className="pomo-alerts">
            <button className={`btn btn-sm ${alerts.sound ? 'btn-green' : ''}`}
              aria-pressed={alerts.sound}
              onClick={() => alarm.setPrefs({ sound: !alerts.sound })}
              title="Play a chime when the block ends">
              {alerts.sound ? '🔊' : '🔇'} chime
            </button>
            <button className="btn btn-sm" onClick={() => alarm.preview(mode)} title="Hear it now">
              test
            </button>

            {notifPerm === 'granted' ? (
              <button className={`btn btn-sm ${alerts.notify ? 'btn-green' : ''}`}
                aria-pressed={alerts.notify}
                onClick={() => alarm.setPrefs({ notify: !alerts.notify })}
                title="Show a desktop notification when the block ends">
                {alerts.notify ? '🔔' : '🔕'} popup
              </button>
            ) : notifPerm === 'denied' ? (
              // Worth saying plainly: once Chrome has been told no, the page can
              // never ask again — only the padlock in the address bar can undo it.
              <span className="small muted" title="Unblock notifications for this site in your browser's site settings">
                🔕 popups blocked in browser settings
              </span>
            ) : notifPerm === 'unsupported' ? (
              <span className="small muted">🔕 popups unavailable here</span>
            ) : (
              // Asked from a click, never on load: a page that prompts on load
              // gets the origin permanently blocked in Chrome.
              <button className="btn btn-sm btn-cyan"
                onClick={async () => setNotifPerm(await alarm.askNotify())}>
                🔔 enable popups
              </button>
            )}
          </div>
          {logErr && (
            <div className="small mt" style={{ textAlign: 'center', color: 'var(--red)' }}>
              Session finished but could not be saved to history — {logErr}
            </div>
          )}
          {pomoState.finished && !running && (
            <div className="small mt" style={{ textAlign: 'center', color: 'var(--green)' }}>
              {pomo.MODE_LABEL[pomoState.finished.mode]} finished
              {' '}{new Date(pomoState.finished.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
              {' '}— {pomo.MODE_LABEL[mode].toLowerCase()} is loaded and waiting.
            </div>
          )}
        </Card>

        <Card title="Breathing" color="var(--cyan)">
          <Breathe rows={sessions} onFinish={logBreath} />
        </Card>

        <Card title="Ambience" color="var(--cyan)">
          <Ambience />
        </Card>
      </div>

      <Card title="Focus history" color="var(--green)"
        right={
          <div className="flex" style={{ gap: 6 }}>
            <span className="chip c-green">{focus.fmtMinutes(weekMins)} · 7d</span>
            {dayStreak > 1 && <span className="chip c-yellow">{dayStreak}-day streak</span>}
          </div>
        }>
        {totals.length === 0 ? (
          <div className="small muted">
            Nothing recorded yet. Name what you are working on above, finish a focus block, and it lands here —
            only completed blocks count, so an abandoned timer never flatters the number.
          </div>
        ) : (
          <>
            {/* ---- last 14 days, as bars ---- */}
            <div className="focus-spark" role="img" aria-label="Focus minutes per day, last 14 days">
              {focus.dailySeries(sessions, 14).map(d => {
                const peak = Math.max(30, ...focus.dailySeries(sessions, 14).map(x => x.minutes));
                return (
                  <span key={d.day} className="focus-bar" title={`${d.day} · ${focus.fmtMinutes(d.minutes)}`}>
                    <i style={{ height: `${Math.round((d.minutes / peak) * 100)}%` }} />
                  </span>
                );
              })}
            </div>

            {/* ---- time per task ---- */}
            <div className="focus-list mt">
              {(histOpen ? totals : totals.slice(0, 6)).map(t => (
                <div key={t.label} className="focus-row">
                  <span className="focus-row-name" title={t.label}>
                    {t.todo_id ? '☑' : '◆'} {t.label}
                  </span>
                  <span className="focus-row-bar">
                    <i style={{ width: `${Math.round((t.minutes / totals[0].minutes) * 100)}%` }} />
                  </span>
                  <span className="focus-row-val">{focus.fmtMinutes(t.minutes)}</span>
                  <span className="focus-row-meta">{t.sessions}× · {focus.ago(new Date(t.last).toISOString())}</span>
                </div>
              ))}
            </div>
            {totals.length > 6 && (
              <button className="btn btn-sm mt" onClick={() => setHistOpen(v => !v)}>
                {histOpen ? 'show less' : `show all ${totals.length}`}
              </button>
            )}
            <button className="btn btn-sm mt" style={{ marginLeft: 8 }} onClick={() => refreshSessions()}>refresh</button>
          </>
        )}
      </Card>

      <Card title="Lofi radio" color="var(--purple)">
        <LofiRadio stations={STUDY_STATIONS} source="study" />
      </Card>

      <Card title="Other subject notes" color="var(--yellow)" right={<button className="btn btn-sm" onClick={() => go('subjects')}>Subjects →</button>}>
        {withNotes.length === 0
          ? <Empty icon="✎" text="Notes generated from the Subjects tab show up here. The three exam guides above are separate and always available." />
          : (
            <>
              <div className="flex" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                {withNotes.map(s => (
                  <button key={s.id} className={`btn btn-sm ${openNotes === s.id ? 'btn-yellow' : ''}`} onClick={() => setOpenNotes(openNotes === s.id ? null : s.id)}>{s.name}</button>
                ))}
              </div>
              {openNotes && (
                <div className="notes-frame">
                  <iframe title="notes" src={withNotes.find(s => s.id === openNotes)?.notes_url} style={{ width: '100%', height: 460, border: 'none', background: '#fff' }} loading="lazy" />
                </div>
              )}
            </>
          )}
      </Card>
    </>
  );
}
