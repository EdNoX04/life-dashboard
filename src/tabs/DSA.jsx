import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useCollection, todayStr } from '../lib/hooks.js';
import { Card, Empty } from '../components/ui.jsx';
import * as db from '../lib/db.js';

const API = 'https://alfa-leetcode-api.onrender.com';
const LANGS = [
  { id: 71, key: 'python', label: 'Python', tmpl: '# read input, print output\nimport sys\ndata = sys.stdin.read().split()\n\n' },
  { id: 54, key: 'cpp', label: 'C++', tmpl: '#include <bits/stdc++.h>\nusing namespace std;\nint main(){\n    \n    return 0;\n}\n' },
  { id: 62, key: 'java', label: 'Java', tmpl: 'import java.util.*;\npublic class Main {\n  public static void main(String[] args){\n    Scanner sc = new Scanner(System.in);\n    \n  }\n}\n' },
  { id: 63, key: 'js', label: 'JS', tmpl: "const data = require('fs').readFileSync(0,'utf8').split(/\\s+/);\n\n" },
];
const MODES = [['easy', 'EASY', 'c-green'], ['medium', 'MEDIUM', 'c-yellow'], ['hard', 'HARD', 'c-red'], ['daily', 'DAILY', 'c-cyan']];

function streakFrom(dates) {
  const set = new Set(dates); let s = 0;
  for (let i = 0; ; i++) { const d = todayStr(new Date(Date.now() - i * 864e5)); if (set.has(d)) s++; else if (i === 0) continue; else break; }
  return s;
}
const stripHtml = h => (h || '').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
const diffChip = d => d === 'Hard' ? 'c-red' : d === 'Medium' ? 'c-yellow' : 'c-green';

export default function DSA() {
  const { items: solveMem, refresh: rSolve } = useCollection('memory', { filter: 'key=eq.dsa_solves', order: 'key' });
  const { items: reqs } = useCollection('requests');
  const [mode, setMode] = useState('easy');
  const [problem, setProblem] = useState(null);
  const [loadingP, setLoadingP] = useState(true);
  const [lang, setLang] = useState(LANGS[0]);
  const [code, setCode] = useState(LANGS[0].tmpl);
  const [stdin, setStdin] = useState('');
  const [output, setOutput] = useState(null);
  const [running, setRunning] = useState(false);
  const [lcUser, setLcUser] = useState(db.getConfig().leetcodeUser || '');
  const [profile, setProfile] = useState(null);
  const listsRef = useRef({}); const ptrRef = useRef({});

  const solves = solveMem?.[0]?.value?.list || [];
  const solvedSlugs = new Set(solves.map(s => s.slug));
  const solveDates = solves.map(s => s.date);
  const streak = streakFrom(solveDates);
  const solvedToday = solveDates.includes(todayStr());
  const hints = reqs.filter(r => r.kind === 'dsa_help').slice(0, 6);

  async function loadDetails(slug) {
    const j = await (await fetch(`${API}/select?titleSlug=${slug}`)).json();
    return { title: j.questionTitle, difficulty: j.difficulty, link: `https://leetcode.com/problems/${slug}/`, slug, tags: (j.topicTags || []).map(t => t.name), body: stripHtml(j.question).slice(0, 700), sample: (j.exampleTestcases || '').slice(0, 200) };
  }
  async function loadProblem(m, advance = false) {
    setLoadingP(true); setProblem(null); setOutput(null);
    try {
      if (m === 'daily') { const j = await (await fetch(`${API}/daily`)).json(); setProblem({ title: j.questionTitle, difficulty: j.difficulty, link: j.questionLink, slug: j.titleSlug, tags: (j.topicTags || []).map(t => t.name), body: stripHtml(j.question).slice(0, 700) }); }
      else {
        if (!listsRef.current[m]) { const j = await (await fetch(`${API}/problems?difficulty=${m.toUpperCase()}&limit=300`)).json(); listsRef.current[m] = (j.problemsetQuestionList || []).filter(p => !p.paidOnly); ptrRef.current[m] = 0; }
        const list = listsRef.current[m];
        if (advance) ptrRef.current[m] = (ptrRef.current[m] + 1) % list.length;
        // from pointer, find next not-solved
        let idx = ptrRef.current[m]; let pick = null;
        for (let k = 0; k < list.length; k++) { const c = list[(idx + k) % list.length]; if (!solvedSlugs.has(c.titleSlug)) { pick = c; ptrRef.current[m] = (idx + k); break; } }
        pick = pick || list[idx];
        setProblem(await loadDetails(pick.titleSlug));
      }
    } catch { setProblem(null); } finally { setLoadingP(false); }
  }
  useEffect(() => { loadProblem(mode); /* eslint-disable-next-line */ }, [mode]);
  useEffect(() => { if (lcUser) fetchProfile(lcUser); /* eslint-disable-next-line */ }, []);

  async function fetchProfile(u) {
    try { const j = await (await fetch(`${API}/userProfile/${encodeURIComponent(u)}`)).json(); if (j && j.totalSolved != null) setProfile(j); else setProfile({ error: true }); }
    catch { setProfile({ error: true }); }
  }
  function connectLC() { const u = lcUser.trim(); if (!u) return; db.setConfig({ leetcodeUser: u }); setProfile(null); fetchProfile(u); }

  function pickLang(l) { setLang(l); if (!code.trim() || LANGS.some(x => x.tmpl.trim() === code.trim())) setCode(l.tmpl); }
  function onEditorKey(e) { if (e.key === 'Tab') { e.preventDefault(); const el = e.target, s = el.selectionStart, en = el.selectionEnd; setCode(code.slice(0, s) + '  ' + code.slice(en)); requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = s + 2; }); } }

  async function run() {
    setRunning(true); setOutput(null);
    try {
      const r = await fetch('https://ce.judge0.com/submissions?base64_encoded=false&wait=true', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source_code: code, language_id: lang.id, stdin }) });
      if (r.status === 429) { setOutput({ err: 'Rate limited — wait a few seconds and run again.' }); return; }
      const j = await r.json();
      setOutput({ stdout: j.stdout, stderr: j.stderr || j.compile_output, status: j.status?.description, time: j.time });
    } catch { setOutput({ err: 'Runner unreachable. Try again.' }); } finally { setRunning(false); }
  }
  async function markSolved() {
    if (solvedToday || !problem) return;
    const list = [...solves, { date: todayStr(), slug: problem.slug, title: problem.title, lang: lang.key, difficulty: problem.difficulty }];
    await db.upsertMemory('dsa_solves', { list }); await rSolve();
  }
  async function askHint(kind) { await db.sendRequest('dsa_help', { kind, slug: problem?.slug, title: problem?.title, lang: lang.key, code: kind === 'review' ? code.slice(0, 4000) : undefined }); }

  return (
    <>
      <div className="spread">
        <h1 className="tab-title">DSA ARENA</h1>
        <span className="flex">
          <span className="chip c-yellow">🔥 {streak}d</span>
          <span className="chip c-green">{solves.length} solved</span>
          {profile && !profile.error && <span className="chip c-cyan">LC #{profile.ranking?.toLocaleString?.() || profile.ranking}</span>}
        </span>
      </div>
      <p className="tab-sub">One a day, starting easy. Keep the chain. Level up.</p>

      <div className="flex" style={{ flexWrap: 'wrap', marginBottom: 14 }}>
        {MODES.map(([k, l]) => <button key={k} className={`btn btn-sm ${mode === k ? 'btn-pink' : ''}`} onClick={() => setMode(k)}>{l}</button>)}
        {mode !== 'daily' && <button className="btn btn-sm btn-cyan" onClick={() => loadProblem(mode, true)}>🎲 Next</button>}
      </div>

      <div className="dsa-grid">
        {/* LEFT — solve */}
        <div>
          <Card title="Problem" color="var(--cyan)" right={problem && <span className={`chip ${diffChip(problem.difficulty)}`}>{problem.difficulty}</span>}>
            {loadingP && <div className="muted small">Loading problem… (first load can take a few seconds)</div>}
            {!loadingP && !problem && <Empty icon="?" text="Couldn’t load a problem — tap Next or switch mode." />}
            {problem && (
              <>
                <div className="spread">
                  <b style={{ fontSize: 19 }}>{problem.title}</b>
                  <a className="btn btn-sm btn-cyan" href={problem.link} target="_blank" rel="noreferrer">↗ LeetCode</a>
                </div>
                <div className="flex mt" style={{ flexWrap: 'wrap', gap: 5 }}>{problem.tags?.slice(0, 5).map(t => <span key={t} className="chip">{t}</span>)}</div>
                <div className="small muted mt" style={{ lineHeight: 1.4 }}>{problem.body}…</div>
              </>
            )}
          </Card>

          <Card title="Code" color="var(--green)" right={<span className="flex" style={{ gap: 5 }}>{LANGS.map(l => <button key={l.id} className={`btn btn-sm ${lang.id === l.id ? 'btn-green' : ''}`} onClick={() => pickLang(l)}>{l.label}</button>)}</span>}>
            <textarea className="code-editor" spellCheck={false} value={code} onChange={e => setCode(e.target.value)} onKeyDown={onEditorKey} rows={12} />
            <label className="mt">stdin (sample input)</label>
            <textarea className="code-editor" spellCheck={false} value={stdin} onChange={e => setStdin(e.target.value)} rows={2} placeholder="paste sample input here" />
            <div className="flex mt">
              <button className="btn btn-cyan" onClick={run} disabled={running}>{running ? 'running…' : '▶ Run'}</button>
              <button className={`btn ${solvedToday ? '' : 'btn-green'}`} onClick={markSolved} disabled={solvedToday || !problem}>{solvedToday ? '✓ Solved today' : '✓ Mark solved (+20xp)'}</button>
            </div>
            {output && (
              <div className="code-out mt">
                {output.err && <span style={{ color: 'var(--red)' }}>{output.err}</span>}
                {output.status && <div className="small" style={{ color: output.status === 'Accepted' ? 'var(--green)' : 'var(--yellow)' }}>{output.status}{output.time ? ` · ${output.time}s` : ''}</div>}
                {output.stdout && <pre>{output.stdout}</pre>}
                {output.stderr && <pre style={{ color: 'var(--red)' }}>{output.stderr}</pre>}
              </div>
            )}
          </Card>
        </div>

        {/* RIGHT — account + AI */}
        <div>
          <Card title="LeetCode account" color="var(--orange)">
            {profile && !profile.error ? (
              <>
                <div className="spread"><b style={{ fontSize: 18 }}>@{db.getConfig().leetcodeUser}</b><span className="chip c-cyan">rank #{profile.ranking?.toLocaleString?.()}</span></div>
                <div className="tile-row mt" style={{ marginBottom: 0 }}>
                  <div className="px stat-tile"><div className="stat-label" style={{ color: 'var(--green)' }}>Easy</div><div className="stat-value" style={{ fontSize: 15 }}>{profile.easySolved}/{profile.totalEasy}</div></div>
                  <div className="px stat-tile"><div className="stat-label" style={{ color: 'var(--yellow)' }}>Medium</div><div className="stat-value" style={{ fontSize: 15 }}>{profile.mediumSolved}/{profile.totalMedium}</div></div>
                  <div className="px stat-tile"><div className="stat-label" style={{ color: 'var(--red)' }}>Hard</div><div className="stat-value" style={{ fontSize: 15 }}>{profile.hardSolved}/{profile.totalHard}</div></div>
                  <div className="px stat-tile"><div className="stat-label" style={{ color: 'var(--cyan)' }}>Total</div><div className="stat-value" style={{ fontSize: 15 }}>{profile.totalSolved}</div></div>
                </div>
                <button className="btn btn-sm mt" onClick={() => { db.setConfig({ leetcodeUser: '' }); setProfile(null); setLcUser(''); }}>Disconnect</button>
              </>
            ) : (
              <>
                <div className="flex">
                  <input placeholder="your LeetCode username" value={lcUser} onChange={e => setLcUser(e.target.value)} onKeyDown={e => e.key === 'Enter' && connectLC()} />
                  <button className="btn btn-green" onClick={connectLC}>Connect</button>
                </div>
                {profile?.error && <div className="small mt" style={{ color: 'var(--red)' }}>Couldn’t find that username — check the spelling.</div>}
                <div className="small muted mt">Shows your solved counts & rank (public profile).</div>
              </>
            )}
          </Card>

          <Card title="Cowork · learn & solve" color="var(--pink)">
            <div className="small muted">Progressive help, queued to Cowork (or ask me in chat for instant).</div>
            <div className="flex mt" style={{ flexWrap: 'wrap' }}>
              <button className="btn btn-sm btn-pink" onClick={() => askHint('nudge')} disabled={!problem}>💡 Nudge</button>
              <button className="btn btn-sm btn-pink" onClick={() => askHint('approach')} disabled={!problem}>🧭 Approach</button>
              <button className="btn btn-sm btn-pink" onClick={() => askHint('review')} disabled={!problem}>🔍 Review code</button>
            </div>
          </Card>

          <Card title="Hints & answers" color="var(--purple)">
            {hints.length === 0 && <Empty icon="✦" text="Your hints will appear here." />}
            {hints.map(h => (
              <div key={h.id} style={{ marginBottom: 10, borderBottom: '2px dashed var(--border)', paddingBottom: 8 }}>
                <span className={`chip ${h.status === 'done' ? 'c-green' : 'c-yellow'}`}>{h.payload?.kind || 'help'} · {h.status}</span>
                {h.response ? <div className="small mt" style={{ whiteSpace: 'pre-wrap' }}>{h.response}</div> : <div className="small muted mt">queued…</div>}
              </div>
            ))}
          </Card>

          <Card title="Recent solves" color="var(--yellow)">
            {solves.length === 0 && <Empty icon="★" text="No solves yet — crack today’s and start the chain." />}
            {[...solves].reverse().slice(0, 8).map((s, i) => (
              <div className="row" key={i}>
                <span className="chip c-green">{s.date}</span>
                <span style={{ flex: 1 }}>{s.title || s.slug}</span>
                {s.difficulty && <span className={`chip ${diffChip(s.difficulty)}`}>{s.difficulty[0]}</span>}
              </div>
            ))}
          </Card>
        </div>
      </div>
    </>
  );
}
