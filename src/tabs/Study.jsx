import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Card, Empty } from '../components/ui.jsx';
import { useCollection, todayStr } from '../lib/hooks.js';
import LofiRadio from '../components/LofiRadio.jsx';
import * as amb from '../lib/ambient.js';
import * as pomo from '../lib/pomodoro.js';
import {
  SUBJECTS, EXAM_WINDOW, FBL_MODULES, FBL_RULE,
  examCountdown, fblStatus, revisionPlan, todayPlan, schedule, guideUrl, fmtDay, fmtTime,
} from '../lib/exams.js';

// The study room, now with an exam in it.
//
// Order on the page follows urgency rather than tidiness: how long is left,
// what to do today, then the material, then the timer. In the last week before
// a paper the first two are the only things worth looking at, and they should
// not be below a fold.

const AMBIENT = ['rain', 'thunder', 'fire', 'wind', 'forest', 'waves', 'river', 'cafe', 'night', 'birds', 'noise']
  .map(k => ({ key: k, ...amb.SOUNDS[k] }));
const STUDY_STATIONS = [
  { id: 'jfKfPfyJRdk', label: 'Lofi' },
  { id: '4xDzrJKXOOY', label: 'Synth' },
  { id: 'E2vONfzoyRI', label: 'Jazz' },
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
  const fbl = useMemo(() => fblStatus(today), [today]);

  const [openGuide, setOpenGuide] = useState(null);
  const [showAll, setShowAll] = useState(false);

  const cdColor = cd.state === 'during' ? 'var(--red)'
    : cd.days <= 3 ? 'var(--red)' : cd.days <= 7 ? 'var(--yellow)' : 'var(--purple)';

  // ---- pomodoro / ambience (unchanged) ----------------------------------
  const [pomoState, setPomoState] = useState(pomo.get);
  const [, repaint] = useState(0);
  const { mode, rounds, running } = pomoState;
  const secs = pomo.remaining(pomoState);
  const { keys: ambKeys, vol: ambVol } = amb.useAmbient();
  const vol = Math.round(ambVol * 100);
  const tick = useRef(null);

  const { items: subjects } = useCollection('subjects', { order: 'name', asc: true });
  const withNotes = subjects.filter(s => s.notes_url);
  const [openNotes, setOpenNotes] = useState(null);

  useEffect(() => pomo.subscribe(setPomoState), []);

  useEffect(() => {
    if (!running) { clearInterval(tick.current); return; }
    tick.current = setInterval(() => {
      const st = pomo.get();
      if (!st.running) return;
      repaint(n => n + 1);
    }, 1000);
    return () => clearInterval(tick.current);
  }, [running]);

  useEffect(() => {
    const wake = () => { pomo.get(); repaint(n => n + 1); };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    return () => {
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('focus', wake);
    };
  }, []);

  const setM = m => pomo.set(st => pomo.setMode(st, m));
  const pct = 100 - Math.round((secs / DUR[mode]) * 100);
  const ringColor = mode === 'focus' ? 'var(--pink)' : 'var(--green)';
  const toggleAmb = k => amb.toggle(k);
  const setVolume = v => amb.setMasterVolume(v / 100);

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
        <div className="fbl-list">
          {FBL_MODULES.map(m => {
            const open = today >= m.from && today <= m.to;
            const done = today > m.to;
            return (
              <div key={m.n} className={`fbl-row${open ? ' fbl-open' : ''}${done ? ' fbl-done' : ''}`}>
                <span className="fbl-label">{m.label}</span>
                <span className="fbl-span">{fmtDay(m.from)} → {fmtDay(m.to)}</span>
                <span className="fbl-state">
                  {open ? 'OPEN NOW' : done ? 'closed' : 'upcoming'}
                </span>
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
        <Card title="Pomodoro" color={ringColor}>
          <div className="flex" style={{ gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
            {[['focus', 'Focus'], ['short', 'Short break'], ['long', 'Long break']].map(([m, l]) => (
              <button key={m} className={`btn btn-sm ${mode === m ? 'btn-pink' : ''}`} onClick={() => setM(m)}>{l}</button>
            ))}
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
          <div className="small muted mt" style={{ textAlign: 'center' }}>🍅 {rounds} focus rounds</div>
          {pomoState.finished && !running && (
            <div className="small mt" style={{ textAlign: 'center', color: 'var(--green)' }}>
              {pomo.MODE_LABEL[pomoState.finished.mode]} finished
              {' '}{new Date(pomoState.finished.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
              {' '}— {pomo.MODE_LABEL[mode].toLowerCase()} is loaded and waiting.
            </div>
          )}
        </Card>

        <Card title="Ambience" color="var(--cyan)">
          <div className="amb-grid">
            {AMBIENT.map(a => (
              <button key={a.key} className={`amb-tile${ambKeys.includes(a.key) ? ' on' : ''}`} onClick={() => toggleAmb(a.key)}>
                <span className="amb-ico">{a.icon}</span>
                <span className="amb-lbl">{a.label}</span>
              </button>
            ))}
          </div>
          <div className="flex mt" style={{ gap: 8, alignItems: 'center' }}>
            <span className="small muted">VOL</span>
            <input type="range" min="0" max="100" value={vol} onChange={e => setVolume(+e.target.value)} style={{ flex: 1 }} />
            <span className="small">{vol}</span>
          </div>
          <div className="small muted mt">Mix as many as you like — they keep playing when you switch tabs, with controls next to your XP bar.</div>
        </Card>
      </div>

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
