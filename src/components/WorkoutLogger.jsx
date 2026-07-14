import React, { useEffect, useMemo, useState } from 'react';
import { loadExercises, exImg, est1RM } from '../lib/exercises.js';
import { todayStr } from '../lib/hooks.js';
import * as db from '../lib/db.js';

const MUSCLES = ['all', 'chest', 'back', 'shoulders', 'biceps', 'triceps', 'quadriceps', 'hamstrings', 'glutes', 'abdominals', 'calves', 'forearms'];

// two-frame animated demo (start ↔ end) — makes the static photos move like a GIF
function Demo({ images }) {
  const [f, setF] = useState(0);
  useEffect(() => { if (!images || images.length < 2) return; const t = setInterval(() => setF(x => 1 - x), 900); return () => clearInterval(t); }, [images]);
  if (!images || !images.length) return <div className="demo-box muted small">no image</div>;
  return <img className="demo-box" src={exImg(images[Math.min(f, images.length - 1)])} alt="" loading="lazy" />;
}

export default function WorkoutLogger({ onSaved, prs = {}, todayHr = null }) {
  const [active, setActive] = useState(false);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(todayStr());
  const [avgHr, setAvgHr] = useState('');
  const [exercises, setExercises] = useState([]); // {name, primaryMuscles, images, instructions, sets:[{weight,reps,done}]}
  const [picker, setPicker] = useState(false);
  const [lib, setLib] = useState([]);
  const [q, setQ] = useState('');
  const [muscle, setMuscle] = useState('all');
  const [openInstr, setOpenInstr] = useState(null);
  const [saving, setSaving] = useState(false);
  const [prMsg, setPrMsg] = useState(null);

  useEffect(() => { if (picker && !lib.length) loadExercises().then(setLib).catch(() => {}); }, [picker, lib.length]);
  useEffect(() => { if (active && todayHr && !avgHr) setAvgHr(String(todayHr)); }, [active, todayHr]); // eslint-disable-line

  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    return lib.filter(e => (muscle === 'all' || (e.primaryMuscles || []).includes(muscle)) && (!s || e.name.toLowerCase().includes(s))).slice(0, 40);
  }, [lib, q, muscle]);

  function start() { setActive(true); setTitle(''); setExercises([]); setAvgHr(''); setDate(todayStr()); setPrMsg(null); }
  function addExercise(e) {
    setExercises(x => [...x, { name: e.name, primaryMuscles: e.primaryMuscles, images: e.images, instructions: e.instructions, sets: [{ weight: '', reps: '', done: false }] }]);
    setPicker(false); setQ('');
  }
  const upd = (ei, fn) => setExercises(xs => xs.map((e, i) => i === ei ? fn(e) : e));
  const addSet = ei => upd(ei, e => ({ ...e, sets: [...e.sets, { weight: e.sets.at(-1)?.weight || '', reps: '', done: false }] }));
  const setField = (ei, si, k, v) => upd(ei, e => ({ ...e, sets: e.sets.map((s, i) => i === si ? { ...s, [k]: v } : s) }));
  const rmSet = (ei, si) => upd(ei, e => ({ ...e, sets: e.sets.filter((_, i) => i !== si) }));
  const rmExercise = ei => setExercises(xs => xs.filter((_, i) => i !== ei));

  // is this set a PR vs stored best for the exercise?
  function setIsPR(name, w, r) {
    const best = prs[name]?.est1rm || 0;
    return est1RM(w, r) > best && (Number(w) > 0);
  }

  async function finish() {
    const clean = exercises.map(e => ({
      name: e.name, muscle: (e.primaryMuscles || [])[0], images: e.images?.slice(0, 2),
      sets: e.sets.filter(s => s.reps || s.weight).map(s => ({ weight: Number(s.weight) || 0, reps: Number(s.reps) || 0 })),
    })).filter(e => e.sets.length);
    if (!clean.length && !title.trim()) { setActive(false); return; }
    setSaving(true);
    // volume + PRs
    let volume = 0; const newPRs = { ...prs }; const hitPRs = [];
    for (const e of clean) {
      for (const s of e.sets) volume += s.weight * s.reps;
      const best = e.sets.reduce((b, s) => Math.max(b, est1RM(s.weight, s.reps)), 0);
      const bestSet = e.sets.reduce((b, s) => est1RM(s.weight, s.reps) >= est1RM(b.weight, b.reps) ? s : b, e.sets[0]);
      if (best > (newPRs[e.name]?.est1rm || 0) && bestSet.weight > 0) {
        newPRs[e.name] = { est1rm: Math.round(best * 10) / 10, weight: bestSet.weight, reps: bestSet.reps, date };
        hitPRs.push(`${e.name} — ${bestSet.weight}kg × ${bestSet.reps}`);
      }
    }
    try {
      await db.insert('workouts', { date, title: title.trim() || 'Workout', duration_min: null, volume_kg: Math.round(volume), exercises: clean, avg_hr: Number(avgHr) || null, source: 'manual' });
      await db.upsertMemory('workout_prs', newPRs);
      setPrMsg(hitPRs.length ? '🏆 New PR: ' + hitPRs.join(' · ') : null);
      setActive(false);
      onSaved?.();
    } catch (e) { setPrMsg('Save failed: ' + (e.message || e)); }
    finally { setSaving(false); }
  }

  if (!active) {
    return (
      <div className="px card">
        <div className="spread">
          <div className="card-title" style={{ margin: 0 }}><span className="sq" style={{ background: 'var(--green)' }} />Workout</div>
          <button className="btn btn-green" onClick={start}>+ Start workout</button>
        </div>
        {prMsg && <div className="small mt" style={{ color: 'var(--yellow)' }}>{prMsg}</div>}
        <div className="small muted mt">Hevy-style: search 870+ exercises with animated demos, log sets × reps × weight, auto-detect PRs.</div>
      </div>
    );
  }

  return (
    <div className="px card">
      <div className="flex" style={{ flexWrap: 'wrap', marginBottom: 10 }}>
        <input style={{ flex: 2, minWidth: 150 }} placeholder="Workout name (e.g. Push Day)" value={title} onChange={e => setTitle(e.target.value)} />
        <input type="date" style={{ width: 150 }} value={date} onChange={e => setDate(e.target.value)} />
        <input style={{ width: 130 }} type="number" placeholder="avg HR bpm" value={avgHr} onChange={e => setAvgHr(e.target.value)} />
      </div>

      {exercises.map((e, ei) => (
        <div key={ei} className="wk-ex">
          <div className="flex" style={{ alignItems: 'flex-start', gap: 10 }}>
            <Demo images={e.images} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="spread">
                <b style={{ fontWeight: 'normal', fontSize: 18 }}>{e.name}</b>
                <button className="btn btn-sm" onClick={() => rmExercise(ei)}>✕</button>
              </div>
              <div className="flex" style={{ gap: 5, flexWrap: 'wrap', marginTop: 4 }}>
                {(e.primaryMuscles || []).slice(0, 2).map(m => <span key={m} className="chip c-purple">{m}</span>)}
                <button className="chip" style={{ cursor: 'pointer' }} onClick={() => setOpenInstr(openInstr === ei ? null : ei)}>how-to</button>
                {prs[e.name] && <span className="chip c-yellow">PR {prs[e.name].weight}×{prs[e.name].reps}</span>}
              </div>
              {openInstr === ei && <div className="small muted mt" style={{ lineHeight: 1.4 }}>{(e.instructions || []).slice(0, 4).join(' ')}</div>}
            </div>
          </div>
          <table className="ptable wk-sets">
            <thead><tr><th>Set</th><th>kg</th><th>Reps</th><th /></tr></thead>
            <tbody>
              {e.sets.map((s, si) => {
                const pr = setIsPR(e.name, s.weight, s.reps);
                return (
                  <tr key={si}>
                    <td>{si + 1}{pr && <span className="chip c-yellow" style={{ marginLeft: 6 }}>PR</span>}</td>
                    <td><input style={{ width: 70 }} type="number" value={s.weight} onChange={ev => setField(ei, si, 'weight', ev.target.value)} /></td>
                    <td><input style={{ width: 70 }} type="number" value={s.reps} onChange={ev => setField(ei, si, 'reps', ev.target.value)} /></td>
                    <td><button className="btn btn-sm" onClick={() => rmSet(ei, si)}>✕</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <button className="btn btn-sm btn-cyan" onClick={() => addSet(ei)}>+ set</button>
        </div>
      ))}

      <div className="flex mt" style={{ flexWrap: 'wrap' }}>
        <button className="btn btn-pink" onClick={() => setPicker(true)}>+ Add exercise</button>
        <button className="btn btn-green" onClick={finish} disabled={saving}>{saving ? 'saving…' : '✓ Finish workout'}</button>
        <button className="btn" onClick={() => setActive(false)}>Cancel</button>
      </div>

      {picker && (
        <div className="modal-overlay" onClick={() => setPicker(false)}>
          <div className="px modal-panel" onClick={ev => ev.stopPropagation()}>
            <div className="spread" style={{ marginBottom: 10 }}>
              <div className="card-title" style={{ margin: 0 }}><span className="sq" style={{ background: 'var(--pink)' }} />Exercise library</div>
              <button className="btn btn-sm btn-pink" onClick={() => setPicker(false)}>✕</button>
            </div>
            <input placeholder="Search exercise…" value={q} onChange={e => setQ(e.target.value)} autoFocus />
            <div className="flex mt" style={{ flexWrap: 'wrap', gap: 5 }}>
              {MUSCLES.map(m => <button key={m} className={`btn btn-sm ${muscle === m ? 'btn-pink' : ''}`} onClick={() => setMuscle(m)}>{m}</button>)}
            </div>
            <div className="mt" style={{ maxHeight: 380, overflowY: 'auto' }}>
              {!lib.length && <div className="muted small">Loading library…</div>}
              {results.map((e, i) => (
                <div className="row" key={i} style={{ cursor: 'pointer' }} onClick={() => addExercise(e)}>
                  {e.images?.[0] && <img src={exImg(e.images[0])} alt="" style={{ width: 40, height: 40, objectFit: 'cover', border: '2px solid var(--border)' }} loading="lazy" />}
                  <span style={{ flex: 1 }}>{e.name}<span className="muted small"> · {(e.primaryMuscles || [])[0]} · {e.equipment || 'body'}</span></span>
                  <span className="btn btn-sm btn-green">+ add</span>
                </div>
              ))}
              {lib.length > 0 && results.length === 0 && <div className="muted small">No match.</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
