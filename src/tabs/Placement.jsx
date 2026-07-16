import React, { useEffect, useState } from 'react';
import { Card, Empty, StatTile } from '../components/ui.jsx';
import { useCollection } from '../lib/hooks.js';
import * as db from '../lib/db.js';
import { EXAM, PACKAGES, PLAN, STRATEGY, FORMULAS, QUESTIONS, CODING } from '../data/tcs.js';

export const PLACEMENT_EXPIRY = new Date('2027-12-31T23:59:59');

const SECS = [
  { key: 'num', label: 'Numerical', color: 'var(--cyan)' },
  { key: 'rea', label: 'Reasoning', color: 'var(--green)' },
  { key: 'ver', label: 'Verbal', color: 'var(--pink)' },
  { key: 'all', label: 'Mixed', color: 'var(--yellow)' },
];
const QTIME = 60;

function Quiz({ sec, prog, onExit, onSaved }) {
  const pool = QUESTIONS.filter(q => sec === 'all' || q.sec === sec);
  const [quiz] = useState(() => [...pool].sort(() => Math.random() - 0.5));
  const [i, setI] = useState(0);
  const [sel, setSel] = useState(null);
  const [reveal, setReveal] = useState(false);
  const [score, setScore] = useState(0);
  const [xp, setXp] = useState(0);
  const [streak, setStreak] = useState(0);
  const [left, setLeft] = useState(QTIME);
  const [done, setDone] = useState(false);
  const q = quiz[i];

  useEffect(() => {
    if (reveal || done) return;
    if (left <= 0) { fire(null); return; }
    const t = setTimeout(() => setLeft(l => l - 1), 1000);
    return () => clearTimeout(t);
  }, [left, reveal, done]); // eslint-disable-line

  function fire(opt) {
    setReveal(true); setSel(opt);
    if (opt === q.ans) { setScore(s => s + 1); setXp(x => x + 15 + (streak >= 2 ? 5 : 0)); setStreak(s => s + 1); }
    else setStreak(0);
  }
  async function next() {
    if (i + 1 >= quiz.length) {
      const acc = Math.round((score / quiz.length) * 100);
      const prev = prog[sec] || {};
      const nv = { ...prog, [sec]: { best: Math.max(prev.best || 0, acc), attempts: (prev.attempts || 0) + 1, last: acc }, xpTotal: (prog.xpTotal || 0) + xp };
      try { await db.upsertMemory('tcs_progress', nv); onSaved?.(); } catch {}
      setDone(true); return;
    }
    setI(i + 1); setSel(null); setReveal(false); setLeft(QTIME);
  }

  if (done) {
    const acc = Math.round((score / quiz.length) * 100);
    return (
      <Card title="Session complete" color="var(--green)">
        <div className="tile-row" style={{ marginBottom: 8 }}>
          <StatTile label="Score" value={`${score}/${quiz.length}`} note={`${acc}%`} color={acc >= 70 ? 'var(--green)' : 'var(--yellow)'} />
          <StatTile label="XP earned" value={`+${xp}`} color="var(--pink)" />
        </div>
        <div className="small muted mb">{acc >= 80 ? '🔥 Prime-tier accuracy. Keep this up.' : acc >= 60 ? 'Solid — drill the ones you missed and push to 80%+.' : 'Review the solutions and run it again. You\'ll climb fast.'}</div>
        <div className="flex" style={{ gap: 8 }}>
          <button className="btn btn-green" onClick={() => onExit(true)}>↻ Again</button>
          <button className="btn" onClick={() => onExit(false)}>Back</button>
        </div>
      </Card>
    );
  }

  return (
    <Card title={`Practice · ${SECS.find(s => s.key === sec)?.label}`} color="var(--yellow)"
      right={<span className="flex" style={{ gap: 8 }}><span className="chip c-cyan">Q {i + 1}/{quiz.length}</span><span className={`chip ${left <= 10 ? 'c-red' : ''}`}>⏱ {left}s</span></span>}>
      <div className="flex" style={{ gap: 8, marginBottom: 8 }}>
        <span className="chip c-green">✓ {score}</span>
        <span className="chip c-pink">⚡ {xp} XP</span>
        {streak >= 2 && <span className="chip c-yellow">🔥 {streak} streak</span>}
        <span className="chip">{q.tag === 'PYQ' ? 'PYQ' : 'Expected'}</span>
        <span className="chip c-purple">{q.topic}</span>
      </div>
      <div className="quiz-q">{q.q}</div>
      <div className="quiz-opts">
        {q.opts.map((o, idx) => {
          let cls = 'quiz-opt';
          if (reveal) { if (idx === q.ans) cls += ' correct'; else if (idx === sel) cls += ' wrong'; }
          return <button key={idx} className={cls} disabled={reveal} onClick={() => fire(idx)}>
            <span className="quiz-key">{String.fromCharCode(65 + idx)}</span>{o}
          </button>;
        })}
      </div>
      {reveal && (
        <div className="quiz-sol">
          <b style={{ color: sel === q.ans ? 'var(--green)' : 'var(--red)' }}>{sel === q.ans ? '✓ Correct' : sel == null ? '⏱ Time up' : '✗ Incorrect'}</b>
          <div className="small mt" style={{ lineHeight: 1.5 }}>{q.sol}</div>
          <button className="btn btn-green mt" onClick={next}>{i + 1 >= quiz.length ? 'Finish →' : 'Next →'}</button>
        </div>
      )}
    </Card>
  );
}

export default function Placement({ go }) {
  const daysLeft = Math.max(0, Math.ceil((PLACEMENT_EXPIRY - new Date()) / 864e5));
  const [view, setView] = useState('plan');
  const [quizSec, setQuizSec] = useState(null);
  const [openCode, setOpenCode] = useState(null);
  const { items: mem, refresh } = useCollection('memory', { filter: 'key=eq.tcs_progress', order: 'key' });
  const prog = mem?.[0]?.value || {};

  const VIEWS = [['plan', '📋 Plan'], ['practice', '🎮 Practice'], ['coding', '💻 Coding'], ['cheat', '📝 Cheatsheet'], ['roadmap', '💰 Roadmap']];

  return (
    <>
      <div className="spread">
        <h1 className="tab-title">PLACEMENT · TCS NQT</h1>
        <span className="flex" style={{ gap: 6 }}>
          <span className="chip c-red">🎯 exam Monday</span>
          <span className="chip c-yellow">⏳ {daysLeft}d</span>
        </span>
      </div>
      <p className="tab-sub">Foundation + Advanced + 3 coding · 83 Qs · 190 min · no negative marking.</p>

      <div className="tf-row" style={{ marginBottom: 12 }}>
        {VIEWS.map(([k, l]) => <button key={k} className={`tf-btn${view === k ? ' on' : ''}`} onClick={() => { setView(k); setQuizSec(null); }}>{l}</button>)}
      </div>

      {view === 'plan' && (
        <>
          <Card title="4-day battle plan" color="var(--pink)">
            {PLAN.map((d, i) => (
              <div key={i} style={{ borderBottom: i < PLAN.length - 1 ? '2px dashed var(--border)' : 'none', padding: '8px 0' }}>
                <div className="spread"><b style={{ fontWeight: 'normal', color: 'var(--cyan)' }}>{d.day}</b><span className="chip c-purple">{d.focus}</span></div>
                <ul className="plan-list">{d.tasks.map((t, j) => <li key={j}>{t}</li>)}</ul>
              </div>
            ))}
          </Card>
          <Card title="How to score the top band" color="var(--yellow)">
            <ul className="plan-list">{STRATEGY.map((s, i) => <li key={i}>{s}</li>)}</ul>
          </Card>
          <Card title="Exam pattern" color="var(--cyan)">
            <div className="scroll-x"><table className="ptable">
              <thead><tr><th>Section</th><th>Part</th><th>Qs</th><th>Time</th><th>Level</th></tr></thead>
              <tbody>{EXAM.sections.map(s => <tr key={s.key}><td>{s.name}</td><td>{s.part}</td><td>{s.q}</td><td>{s.min}m</td><td>{s.diff}</td></tr>)}</tbody>
            </table></div>
            <div className="small muted mt">{EXAM.notes}</div>
          </Card>
        </>
      )}

      {view === 'practice' && (quizSec
        ? <Quiz sec={quizSec} prog={prog} onSaved={refresh} onExit={again => { setQuizSec(again ? quizSec : null); }} />
        : (
          <>
            <Card title="Pick a section" color="var(--yellow)">
              <div className="grid2">
                {SECS.map(s => {
                  const p = prog[s.key] || {};
                  return (
                    <button key={s.key} className="sec-card" style={{ borderColor: s.color }} onClick={() => setQuizSec(s.key)}>
                      <div className="sec-name" style={{ color: s.color }}>{s.label}</div>
                      <div className="small muted">{s.key === 'all' ? QUESTIONS.length : QUESTIONS.filter(q => q.sec === s.key).length} questions</div>
                      <div className="small mt">{p.best != null ? `best ${p.best}% · ${p.attempts}×` : 'not attempted'}</div>
                    </button>
                  );
                })}
              </div>
            </Card>
            <Card title="Progress" color="var(--green)">
              <StatTile label="Total XP" value={prog.xpTotal || 0} note="from practice" color="var(--pink)" />
              <div className="small muted mt">Timed drills, instant solutions, XP + streaks. Attempt every question — no negative marking on the real thing.</div>
            </Card>
          </>
        ))}

      {view === 'coding' && (
        <>
          <Card title="Advanced coding — expected problems" color="var(--green)" right={<button className="btn btn-sm" onClick={() => go('dsa')}>DSA Arena →</button>}>
            <div className="small muted mb">3 problems, 90 min. Solve ≥1 fully for Digital; both for Prime. Handle edge cases &amp; exact output format.</div>
            {CODING.map((c, i) => (
              <div key={i} className="code-item">
                <div className="spread" onClick={() => setOpenCode(openCode === i ? null : i)} style={{ cursor: 'pointer' }}>
                  <b style={{ fontWeight: 'normal' }}>{c.title}</b>
                  <span className="flex" style={{ gap: 6 }}><span className={`chip ${c.diff === 'Medium' ? 'c-yellow' : 'c-green'}`}>{c.diff}</span><span className="chip">{openCode === i ? '−' : '+'}</span></span>
                </div>
                {openCode === i && (
                  <div className="mt">
                    <div className="small">{c.statement}</div>
                    <div className="small mt" style={{ color: 'var(--cyan)' }}><b>Approach:</b> {c.approach}</div>
                    <pre className="code-block">{c.code}</pre>
                  </div>
                )}
              </div>
            ))}
          </Card>
        </>
      )}

      {view === 'cheat' && (
        <>
          {[['num', 'Numerical formulas', 'var(--cyan)'], ['rea', 'Reasoning methods', 'var(--green)'], ['ver', 'Verbal rules', 'var(--pink)']].map(([k, title, c]) => (
            <Card key={k} title={title} color={c}>
              <ul className="plan-list">{FORMULAS[k].map((f, i) => <li key={i}>{f}</li>)}</ul>
            </Card>
          ))}
        </>
      )}

      {view === 'roadmap' && (
        <>
          <Card title="Package roadmap" color="var(--pink)">
            {PACKAGES.map(p => (
              <div key={p.band} className="row" style={{ alignItems: 'flex-start' }}>
                <span className="chip" style={{ color: p.color, borderColor: p.color, minWidth: 62, textAlign: 'center' }}>{p.band}</span>
                <span style={{ flex: 1 }}>
                  <b style={{ fontWeight: 'normal', color: p.color }}>{p.ctc}</b>
                  <div className="small muted">{p.pct} · coding: {p.coding}</div>
                </span>
              </div>
            ))}
            <div className="small muted mt">Target the highest band your drive offers. The lever from Ninja → Digital/Prime is the Advanced Coding + 80%+ reasoning/verbal.</div>
          </Card>
          <Card title="After the written — interview" color="var(--purple)">
            <Empty icon="🎤" text="Once the NQT is done we build interview prep here: DSA rounds, project deep-dives, CS fundamentals (OS/DBMS/OOP/Networks), HR questions, and mock rounds." />
          </Card>
        </>
      )}
    </>
  );
}
