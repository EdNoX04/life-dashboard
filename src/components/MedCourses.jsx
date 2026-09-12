import React, { useMemo, useState } from 'react';
import { Card, Empty } from './ui.jsx';
import { INDIAN_MEDS } from '../lib/healthdata.js';
import {
  normaliseCourse, dueToday, adherence, courseFlags, isActive, isPrn,
  lastDay, UNITS, DOSE_STATE,
} from '../lib/meds.js';

// Courses — what you were told to take, against what you took.
//
// The tab already logged a medicine. This is the other half: the prescription,
// so "did I finish the antibiotics" has an answer. Every rule about what counts
// as taken, pending or missed lives in lib/meds.js with its tests; this file
// only draws it.
//
// Two deliberate screen decisions:
//
//   * TODAY'S DOSES ARE THE TOP OF THE CARD, not the course list. The list is
//     reference; the doses are the thing you act on, and burying them under
//     three collapsed courses is how an adherence feature becomes decoration.
//   * A PRN course shows NO percentage. An as-needed painkiller cannot be
//     adhered to, and a 0% beside it would read as a failure that never
//     happened.

const z = n => String(n).padStart(2, '0');
const nowMinutes = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.round(performance.now()));
const blank = () => ({ name: '', salt: '', dose: '1', unit: 'tablet', kind: 'times', times: '09:00, 21:00', n: 2, from: '', to: '', reason: '' });

const STATE_CHIP = {
  [DOSE_STATE.TAKEN]: { c: 'c-green', t: '✓' },
  [DOSE_STATE.PENDING]: { c: 'c-cyan', t: '·' },
  [DOSE_STATE.MISSED]: { c: 'c-red', t: '✕' },
};

export default function MedCourses({ courses = [], medLog = {}, today, onSave, onTake, busy }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(blank());
  const nm = nowMinutes();

  const due = useMemo(() => dueToday(courses, medLog, today, nm), [courses, medLog, today, nm]);
  const live = courses.filter(c => isActive(normaliseCourse(c), today) || isPrn(normaliseCourse(c)));
  const past = courses.filter(c => !live.includes(c));

  function add() {
    if (!form.name.trim() || !form.from) return;
    const times = form.times.split(',').map(s => s.trim()).filter(Boolean);
    const c = normaliseCourse({
      id: uid(), name: form.name, salt: form.salt, dose: form.dose, unit: form.unit,
      schedule: { kind: form.kind, times, n: Number(form.n) || 1 },
      from: form.from, to: form.to || null, reason: form.reason,
    });
    onSave([...courses, c]);
    setForm(blank()); setOpen(false);
  }

  const stop = id => onSave(courses.map(c => (c.id === id ? { ...c, stopped: today } : c)));
  const drop = id => {
    // Deleting a course deletes the record of what you were told to take. The
    // usual way off one is Stop, which keeps the dates it covered.
    if (!window.confirm('Delete this course? Stopping it keeps the record; deleting removes it.')) return;
    onSave(courses.filter(c => c.id !== id));
  };

  return (
    <Card title="Courses" color="var(--pink)"
      right={<button className="btn btn-sm" onClick={() => setOpen(o => !o)}>{open ? 'Cancel' : '+ course'}</button>}>

      {open && (
        <div className="med-form">
          <input list="po-meds-c" placeholder="Medicine — e.g. Azithral 500" value={form.name}
            onChange={e => {
              const v = e.target.value;
              const known = INDIAN_MEDS.find(x => x.name.toLowerCase() === v.trim().toLowerCase());
              setForm(f => ({ ...f, name: v, salt: known ? known.salt : f.salt }));
            }} />
          <datalist id="po-meds-c">{INDIAN_MEDS.map(x => <option key={x.name} value={x.name}>{x.salt}</option>)}</datalist>
          <input placeholder="Salt / strength" value={form.salt} onChange={e => setForm(f => ({ ...f, salt: e.target.value }))} />
          <span className="flex" style={{ gap: 6 }}>
            <input style={{ width: 64 }} placeholder="Dose" value={form.dose} onChange={e => setForm(f => ({ ...f, dose: e.target.value }))} />
            <select value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}>
              {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
            <select value={form.kind} onChange={e => setForm(f => ({ ...f, kind: e.target.value }))}>
              <option value="times">Every day</option>
              <option value="everyN">Every N days</option>
              <option value="prn">As needed</option>
            </select>
          </span>
          {form.kind !== 'prn' && (
            <input placeholder="Times — 09:00, 21:00" value={form.times}
              onChange={e => setForm(f => ({ ...f, times: e.target.value }))} />
          )}
          {form.kind === 'everyN' && (
            <input type="number" min="1" value={form.n} onChange={e => setForm(f => ({ ...f, n: e.target.value }))} />
          )}
          <span className="flex" style={{ gap: 6 }}>
            <input type="date" value={form.from} onChange={e => setForm(f => ({ ...f, from: e.target.value }))} />
            {/* Left blank on purpose for something ongoing. An end date invented
                on your behalf is a course that stops expecting doses on a day
                nobody chose. */}
            <input type="date" value={form.to} placeholder="end (blank = ongoing)"
              onChange={e => setForm(f => ({ ...f, to: e.target.value }))} />
          </span>
          <input placeholder="What it's for (optional)" value={form.reason}
            onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} />
          <button className="btn btn-sm btn-green" disabled={busy || !form.name.trim() || !form.from} onClick={add}>Add course</button>
        </div>
      )}

      {/* ---- what is owed today ---- */}
      {due.length > 0 && (
        <div className="med-due">
          {due.map(d => {
            const chip = STATE_CHIP[d.state];
            return (
              <div className="row med-dose" key={d.key}>
                <span className={`chip ${chip.c}`} style={{ minWidth: 54, textAlign: 'center' }}>{d.time}</span>
                <span style={{ flex: 1 }}>
                  {d.course.name}
                  <i className="small" style={{ color: 'var(--ink-3)' }}> {d.course.dose} {d.course.unit}</i>
                </span>
                {d.state === DOSE_STATE.TAKEN
                  ? <span className="chip c-green">✓ taken</span>
                  : (
                    <button className="btn btn-sm btn-green" disabled={busy}
                      onClick={() => onTake(d.course)}>
                      {d.state === DOSE_STATE.MISSED ? 'Log late' : 'Take'}
                    </button>
                  )}
              </div>
            );
          })}
        </div>
      )}

      {live.length === 0 && due.length === 0 && (
        <Empty icon="℞" text="No courses yet."
          note="Add one and PLAYER ONE knows what you're meant to take and when — so a half-finished course of antibiotics is something you can see rather than something you remember." />
      )}

      {/* ---- the courses ---- */}
      {live.map(raw => {
        const c = normaliseCourse(raw);
        const a = adherence(c, medLog, { from: c.from, to: lastDay(c) || today, today, nowMin: nm });
        const flags = courseFlags(c, medLog, today);
        return (
          <div className="med-course" key={c.id}>
            <div className="row">
              <span style={{ flex: 1 }}>
                <b>{c.name}</b>
                {c.salt && <i className="small" style={{ color: 'var(--ink-3)' }}> · {c.salt}</i>}
                <div className="small" style={{ color: 'var(--ink-2)' }}>
                  {isPrn(c) ? 'As needed' : `${c.schedule.times.join(', ')}${c.schedule.kind === 'everyN' ? ` · every ${c.schedule.n} days` : ''}`}
                  {c.from ? ` · from ${c.from}` : ''}{lastDay(c) ? ` to ${lastDay(c)}` : ' · ongoing'}
                  {c.reason ? ` · for ${c.reason}` : ''}
                </div>
              </span>
              {/* No percentage for as-needed. Nothing was expected of it, so
                  there is nothing to be at 0% of. */}
              {a.pct == null
                ? <span className="chip" title="An as-needed medicine expects no doses, so it has no adherence figure">no target</span>
                : <span className={`chip ${a.pct >= 90 ? 'c-green' : a.pct >= 70 ? 'c-cyan' : 'c-red'}`}>{a.pct}%</span>}
              <button className="btn btn-sm" disabled={busy} onClick={() => stop(c.id)} title="Stop taking it — keeps the record">Stop</button>
              <button className="btn btn-sm" disabled={busy} onClick={() => drop(c.id)}>✕</button>
            </div>
            {a.pct != null && (
              <div className="small" style={{ color: 'var(--ink-3)' }}>
                {a.taken} of {a.expected - a.pending} doses so far
                {a.pending ? ` · ${a.pending} still to come today` : ''}
                {a.missed ? ` · ${a.missed} missed` : ''}
                {a.extra ? ` · ${a.extra} logged over the schedule` : ''}
              </div>
            )}
            {flags.map(f => (
              <div className="small" key={f.kind} style={{ color: f.kind === 'overrun' ? 'var(--orange)' : 'var(--yellow)' }}>
                {f.kind === 'overrun' ? '⚠ ' : ''}{f.text}
              </div>
            ))}
          </div>
        );
      })}

      {past.length > 0 && (
        <details className="med-past">
          <summary className="small">{past.length} finished course{past.length === 1 ? '' : 's'}</summary>
          {past.map(raw => {
            const c = normaliseCourse(raw);
            const a = adherence(c, medLog, { from: c.from, to: lastDay(c), today });
            return (
              <div className="row small" key={c.id}>
                <span style={{ flex: 1 }}>{c.name} <i style={{ color: 'var(--ink-3)' }}>{c.from} → {lastDay(c)}</i></span>
                {a.pct != null && <span className="chip">{a.pct}% · {a.taken}/{a.expected}</span>}
              </div>
            );
          })}
        </details>
      )}
    </Card>
  );
}
