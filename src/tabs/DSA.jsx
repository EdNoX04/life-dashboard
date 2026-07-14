import React, { useEffect, useMemo, useState } from 'react';
import { useCollection, todayStr } from '../lib/hooks.js';
import { Card, Empty } from '../components/ui.jsx';
import * as db from '../lib/db.js';

const LANGS = [
  { id: 71, key: 'python', label: 'Python', tmpl: '# read input, print output\nimport sys\ndata = sys.stdin.read().split()\n\n' },
  { id: 54, key: 'cpp', label: 'C++', tmpl: '#include <bits/stdc++.h>\nusing namespace std;\nint main(){\n    \n    return 0;\n}\n' },
  { id: 62, key: 'java', label: 'Java', tmpl: 'import java.util.*;\npublic class Main {\n  public static void main(String[] args){\n    Scanner sc = new Scanner(System.in);\n    \n  }\n}\n' },
  { id: 63, key: 'js', label: 'JS', tmpl: "const data = require('fs').readFileSync(0,'utf8').split(/\\s+/);\n\n" },
];

function streakFrom(dates) {
  const set = new Set(dates);
  let s = 0;
  for (let i = 0; ; i++) {
    const d = todayStr(new Date(Date.now() - i * 864e5));
    if (set.has(d)) s++;
    else if (i === 0) continue; // today not done yet doesn't break it
    else break;
  }
  return s;
}
const stripHtml = h => (h || '').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();

export default function DSA() {
  const { items: solveMem, refresh: rSolve } = useCollection('memory', { filter: 'key=eq.dsa_solves', order: 'key' });
  const { items: reqs } = useCollection('requests');
  const [daily, setDaily] = useState(null);
  const [loadingP, setLoadingP] = useState(true);
  const [lang, setLang] = useState(LANGS[0]);
  const [code, setCode] = useState(LANGS[0].tmpl);
  const [stdin, setStdin] = useState('');
  const [output, setOutput] = useState(null);
  const [running, setRunning] = useState(false);

  const solves = solveMem?.[0]?.value?.list || [];
  const solveDates = solves.map(s => s.date);
  const streak = streakFrom(solveDates);
  const solvedToday = solveDates.includes(todayStr());
  const hints = reqs.filter(r => r.kind === 'dsa_help').slice(0, 6);

  useEffect(() => {
    let alive = true;
    fetch('https://alfa-leetcode-api.onrender.com/daily')
      .then(r => r.json())
      .then(j => { if (alive) setDaily({ title: j.questionTitle, difficulty: j.difficulty, link: j.questionLink, slug: j.titleSlug, tags: (j.topicTags || []).map(t => t.name), body: stripHtml(j.question).slice(0, 700) }); })
      .catch(() => {})
      .finally(() => alive && setLoadingP(false));
    return () => { alive = false; };
  }, []);

  function pickLang(l) { setLang(l); if (!code.trim() || LANGS.some(x => x.tmpl.trim() === code.trim())) setCode(l.tmpl); }

  function onEditorKey(e) {
    if (e.key === 'Tab') { e.preventDefault(); const el = e.target; const s = el.selectionStart, en = el.selectionEnd; const nv = code.slice(0, s) + '  ' + code.slice(en); setCode(nv); requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = s + 2; }); }
  }

  async function run() {
    setRunning(true); setOutput(null);
    try {
      const r = await fetch('https://ce.judge0.com/submissions?base64_encoded=false&wait=true', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_code: code, language_id: lang.id, stdin }),
      });
      if (r.status === 429) { setOutput({ err: 'Rate limited — wait a few seconds and run again.' }); return; }
      const j = await r.json();
      setOutput({ stdout: j.stdout, stderr: j.stderr || j.compile_output, status: j.status?.description, time: j.time });
    } catch (e) { setOutput({ err: 'Runner unreachable. Try again.' }); }
    finally { setRunning(false); }
  }

  async function markSolved() {
    if (solvedToday) return;
    const list = [...solves, { date: todayStr(), slug: daily?.slug || 'unknown', title: daily?.title, lang: lang.key }];
    await db.upsertMemory('dsa_solves', { list });
    await rSolve();
  }

  async function askHint(kind) {
    await db.sendRequest('dsa_help', { kind, slug: daily?.slug, title: daily?.title, lang: lang.key, code: kind === 'review' ? code.slice(0, 4000) : undefined });
  }

  return (
    <>
      <div className="spread">
        <h1 className="tab-title">DSA ARENA</h1>
        <span className="flex">
          <span className="chip c-yellow">🔥 {streak}d streak</span>
          <span className="chip c-green">{solves.length} solved</span>
        </span>
      </div>
      <p className="tab-sub">One problem a day. Keep the chain. Level up.</p>

      <div className="dsa-grid">
        {/* LEFT — solve */}
        <div>
          <Card title="Daily problem" color="var(--cyan)" right={daily && <span className={`chip ${daily.difficulty === 'Hard' ? 'c-red' : daily.difficulty === 'Medium' ? 'c-yellow' : 'c-green'}`}>{daily.difficulty}</span>}>
            {loadingP && <div className="muted small">Loading today’s LeetCode…</div>}
            {!loadingP && !daily && <Empty icon="?" text="Couldn’t load today’s problem. Refresh in a bit." />}
            {daily && (
              <>
                <div className="spread">
                  <b style={{ fontSize: 19 }}>{daily.title}</b>
                  <a className="btn btn-sm btn-cyan" href={daily.link} target="_blank" rel="noreferrer">↗ LeetCode</a>
                </div>
                <div className="flex mt" style={{ flexWrap: 'wrap', gap: 5 }}>{daily.tags?.slice(0, 5).map(t => <span key={t} className="chip">{t}</span>)}</div>
                <div className="small muted mt" style={{ lineHeight: 1.4 }}>{daily.body}…</div>
              </>
            )}
          </Card>

          <Card title="Code" color="var(--green)" right={
            <span className="flex" style={{ gap: 5 }}>{LANGS.map(l => <button key={l.id} className={`btn btn-sm ${lang.id === l.id ? 'btn-green' : ''}`} onClick={() => pickLang(l)}>{l.label}</button>)}</span>
          }>
            <textarea className="code-editor" spellCheck={false} value={code} onChange={e => setCode(e.target.value)} onKeyDown={onEditorKey} rows={12} />
            <label className="mt">stdin (sample input)</label>
            <textarea className="code-editor" spellCheck={false} value={stdin} onChange={e => setStdin(e.target.value)} rows={2} placeholder="paste sample input here" />
            <div className="flex mt">
              <button className="btn btn-cyan" onClick={run} disabled={running}>{running ? 'running…' : '▶ Run'}</button>
              <button className={`btn ${solvedToday ? '' : 'btn-green'}`} onClick={markSolved} disabled={solvedToday}>{solvedToday ? '✓ Solved today' : '✓ Mark solved (+20xp)'}</button>
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

        {/* RIGHT — AI help */}
        <div>
          <Card title="Cowork · learn & solve" color="var(--pink)">
            <div className="small muted">Get progressively bigger help. Queued to Cowork (answered on the next run, or ask me in chat for instant help).</div>
            <div className="flex mt" style={{ flexWrap: 'wrap' }}>
              <button className="btn btn-sm btn-pink" onClick={() => askHint('nudge')} disabled={!daily}>💡 Nudge</button>
              <button className="btn btn-sm btn-pink" onClick={() => askHint('approach')} disabled={!daily}>🧭 Explain approach</button>
              <button className="btn btn-sm btn-pink" onClick={() => askHint('review')} disabled={!daily}>🔍 Review my code</button>
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
                <span className="chip">{s.lang}</span>
              </div>
            ))}
          </Card>
        </div>
      </div>
    </>
  );
}
