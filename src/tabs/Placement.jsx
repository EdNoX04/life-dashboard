import React, { useEffect, useRef, useState } from 'react';
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

const rnd = () => Math.random() - 0.5;
const sample = (sec, n) => [...QUESTIONS.filter(q => q.sec === sec)].sort(rnd).slice(0, n);
const MOCKS = [
  { key: 'full', label: 'Full mixed', desc: '8 Num · 6 Rea · 6 Ver · 20 min', min: 20, build: () => [...sample('num', 8), ...sample('rea', 6), ...sample('ver', 6)].sort(rnd) },
  { key: 'num', label: 'Numerical section', desc: '20 questions · 25 min', min: 25, build: () => sample('num', 20) },
  { key: 'ver', label: 'Verbal section', desc: '25 questions · 25 min', min: 25, build: () => sample('ver', 25) },
  { key: 'rea', label: 'Reasoning section', desc: '20 questions · 25 min', min: 25, build: () => sample('rea', 20) },
];
const SECNAME = { num: 'Numerical', rea: 'Reasoning', ver: 'Verbal' };

function MockMenu({ prog, onPick }) {
  const m = prog.mock || {};
  return (
    <Card title="Choose a mock" color="var(--pink)">
      <div className="grid2">
        {MOCKS.map(c => (
          <button key={c.key} className="sec-card" style={{ borderColor: 'var(--pink)' }} onClick={() => onPick(c)}>
            <div className="sec-name" style={{ color: 'var(--pink)' }}>{c.label}</div>
            <div className="small muted">{c.desc}</div>
            <div className="small mt">{m[c.key]?.best != null ? `best ${m[c.key].best}% · ${m[c.key].attempts}×` : 'not attempted'}</div>
          </button>
        ))}
      </div>
      <div className="small muted mt">Timed, with a question palette and a full review at the end — mirrors the real iON sections.</div>
    </Card>
  );
}

function Mock({ cfg, prog, onSaved, onExit }) {
  const [quiz] = useState(cfg.build);
  const [ans, setAns] = useState(() => Array(quiz.length).fill(null));
  const [cur, setCur] = useState(0);
  const [left, setLeft] = useState(cfg.min * 60);
  const [submitted, setSubmitted] = useState(false);
  const savedRef = useRef(false);
  const q = quiz[cur];
  const answered = ans.filter(x => x != null).length;

  async function finish() {
    setSubmitted(true);
    if (savedRef.current) return; savedRef.current = true;
    const correct = quiz.reduce((s, qq, i) => s + (ans[i] === qq.ans ? 1 : 0), 0);
    const pct = Math.round((correct / quiz.length) * 100);
    const prevAll = prog.mock || {};
    const prev = prevAll[cfg.key] || {};
    const nv = { ...prog, mock: { ...prevAll, [cfg.key]: { best: Math.max(prev.best || 0, pct), last: pct, attempts: (prev.attempts || 0) + 1 } }, xpTotal: (prog.xpTotal || 0) + correct * 10 };
    try { await db.upsertMemory('tcs_progress', nv); onSaved?.(); } catch {}
  }

  useEffect(() => {
    if (submitted) return;
    if (left <= 0) { finish(); return; }
    const t = setTimeout(() => setLeft(l => l - 1), 1000);
    return () => clearTimeout(t);
  }, [left, submitted]); // eslint-disable-line

  if (submitted) {
    const correct = quiz.reduce((s, qq, i) => s + (ans[i] === qq.ans ? 1 : 0), 0);
    const pct = Math.round((correct / quiz.length) * 100);
    const bySec = {}; quiz.forEach((qq, i) => { const b = bySec[qq.sec] || { c: 0, t: 0 }; b.t++; if (ans[i] === qq.ans) b.c++; bySec[qq.sec] = b; });
    const band = pct >= 83 ? ['PRIME', 'var(--pink)'] : pct >= 63 ? ['DIGITAL', 'var(--yellow)'] : pct >= 50 ? ['NINJA', 'var(--cyan)'] : ['BELOW CUTOFF', 'var(--red)'];
    const wrong = quiz.map((qq, i) => ({ qq, i })).filter(x => ans[x.i] !== x.qq.ans);
    return (
      <>
        <Card title={`Result · ${cfg.label}`} color={band[1]}>
          <div className="tile-row" style={{ marginBottom: 8 }}>
            <StatTile label="Score" value={`${correct}/${quiz.length}`} note={`${pct}%`} color={band[1]} />
            <StatTile label="Est. band" value={band[0]} color={band[1]} />
            <StatTile label="Answered" value={`${answered}/${quiz.length}`} color="var(--cyan)" />
          </div>
          <div className="flex" style={{ gap: 8, flexWrap: 'wrap' }}>
            {Object.entries(bySec).map(([s, b]) => <span key={s} className="chip">{SECNAME[s]}: {b.c}/{b.t}</span>)}
          </div>
          <div className="small muted mt">Estimate only — the real band also weighs Advanced Coding heavily. {pct >= 63 ? 'Strong! Lock in coding + weak sections.' : 'Drill any section below 70% and run it again.'}</div>
          <div className="flex mt" style={{ gap: 8 }}>
            <button className="btn btn-green" onClick={() => onExit(true)}>↻ New mock</button>
            <button className="btn" onClick={() => onExit(false)}>Back</button>
          </div>
        </Card>
        {wrong.length > 0 && (
          <Card title={`Review — ${wrong.length} to fix`} color="var(--red)">
            {wrong.map(({ qq, i }) => (
              <div key={i} className="mock-rev">
                <div className="small"><b style={{ fontWeight: 'normal' }}>{qq.q}</b></div>
                <div className="small" style={{ color: 'var(--green)' }}>✓ {qq.opts[qq.ans]}</div>
                {ans[i] != null && <div className="small" style={{ color: 'var(--red)' }}>You: {qq.opts[ans[i]]}</div>}
                <div className="small muted">{qq.sol}</div>
              </div>
            ))}
          </Card>
        )}
      </>
    );
  }

  return (
    <Card title={`${cfg.label} · ${quiz.length} Q`} color="var(--pink)"
      right={<span className={`chip ${left <= 60 ? 'c-red' : 'c-yellow'}`}>⏱ {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</span>}>
      <div className="q-pal">
        {quiz.map((_, i) => <button key={i} className={`q-pal-btn${i === cur ? ' cur' : ''}${ans[i] != null ? ' done' : ''}`} onClick={() => setCur(i)}>{i + 1}</button>)}
      </div>
      <div className="flex" style={{ gap: 8, margin: '10px 0 6px' }}>
        <span className="chip c-purple">{SECNAME[q.sec]}</span>
        <span className="chip">{q.topic}</span>
        <span className="chip c-cyan">Q {cur + 1}/{quiz.length}</span>
      </div>
      <div className="quiz-q">{q.q}</div>
      <div className="quiz-opts">
        {q.opts.map((o, idx) => (
          <button key={idx} className={`quiz-opt${ans[cur] === idx ? ' sel' : ''}`} onClick={() => setAns(a => a.map((x, k) => (k === cur ? idx : x)))}>
            <span className="quiz-key">{String.fromCharCode(65 + idx)}</span>{o}
          </button>
        ))}
      </div>
      <div className="spread mt">
        <span className="flex" style={{ gap: 6 }}>
          <button className="btn btn-sm" disabled={cur === 0} onClick={() => setCur(c => c - 1)}>← Prev</button>
          <button className="btn btn-sm" disabled={cur === quiz.length - 1} onClick={() => setCur(c => c + 1)}>Next →</button>
        </span>
        <button className="btn btn-green" onClick={finish}>Submit ({answered}/{quiz.length})</button>
      </div>
    </Card>
  );
}

function Browse() {
  const [sec, setSec] = useState('all');
  const [topic, setTopic] = useState('all');
  const [open, setOpen] = useState({});
  const pool = QUESTIONS.filter(q => sec === 'all' || q.sec === sec);
  const topics = ['all', ...Array.from(new Set(pool.map(q => q.topic)))];
  const shown = pool.filter(q => topic === 'all' || q.topic === topic);
  return (
    <Card title={`Question bank · ${shown.length}`} color="var(--cyan)">
      <div className="flex" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <select className="sel" value={sec} onChange={e => { setSec(e.target.value); setTopic('all'); }}>
          <option value="all">All sections</option>
          <option value="num">Numerical</option>
          <option value="rea">Reasoning</option>
          <option value="ver">Verbal</option>
        </select>
        <select className="sel" value={topic} onChange={e => setTopic(e.target.value)}>
          {topics.map(t => <option key={t} value={t}>{t === 'all' ? 'All topics' : t}</option>)}
        </select>
      </div>
      {shown.map(q => (
        <div key={q.q} className="brow-item">
          <div className="spread" style={{ cursor: 'pointer', gap: 8 }} onClick={() => setOpen(o => ({ ...o, [q.q]: !o[q.q] }))}>
            <span style={{ flex: 1 }}>{q.q}</span>
            <span className="flex" style={{ gap: 6 }}>
              <span className="chip">{q.tag === 'PYQ' ? 'PYQ' : 'Exp'}</span>
              <span className="chip c-purple" style={{ minWidth: 56, textAlign: 'center' }}>{open[q.q] ? '▲ hide' : '▾ answer'}</span>
            </span>
          </div>
          {open[q.q] && (
            <div className="brow-ans">
              {q.opts.map((o, idx) => (
                <div key={idx} className={idx === q.ans ? 'brow-correct' : 'brow-opt'}>{String.fromCharCode(65 + idx)}. {o}{idx === q.ans ? '  ✓' : ''}</div>
              ))}
              <div className="small mt" style={{ color: 'var(--cyan)', lineHeight: 1.5 }}>{q.sol}</div>
            </div>
          )}
        </div>
      ))}
    </Card>
  );
}

export default function Placement({ go }) {
  const daysLeft = Math.max(0, Math.ceil((PLACEMENT_EXPIRY - new Date()) / 864e5));
  const [view, setView] = useState('plan');
  const [quizSec, setQuizSec] = useState(null);
  const [mockKey, setMockKey] = useState(0);
  const [mockCfg, setMockCfg] = useState(null);
  const [openCode, setOpenCode] = useState(null);
  const { items: mem, refresh } = useCollection('memory', { filter: 'key=eq.tcs_progress', order: 'key' });
  const prog = mem?.[0]?.value || {};

  const VIEWS = [['plan', '📋 Plan'], ['practice', '🎮 Practice'], ['mock', '🧪 Mock'], ['browse', '📖 Bank'], ['coding', '💻 Coding'], ['cheat', '📝 Cheatsheet'], ['roadmap', '💰 Roadmap']];

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
        {VIEWS.map(([k, l]) => <button key={k} className={`tf-btn${view === k ? ' on' : ''}`} onClick={() => { setView(k); setQuizSec(null); setMockCfg(null); }}>{l}</button>)}
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

      {view === 'mock' && (mockCfg
        ? <Mock key={mockKey} cfg={mockCfg} prog={prog} onSaved={refresh} onExit={again => { if (again) setMockKey(k => k + 1); else setMockCfg(null); }} />
        : <MockMenu prog={prog} onPick={c => { setMockCfg(c); setMockKey(k => k + 1); }} />)}

      {view === 'browse' && <Browse />}

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
