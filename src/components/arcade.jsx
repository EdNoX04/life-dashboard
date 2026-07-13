import React, { useEffect, useMemo, useState } from 'react';
import { useCollection, todayStr } from '../lib/hooks.js';

// One-time boot screen per session (kept short; skippable by tap)
export function BootScreen() {
  const [phase, setPhase] = useState(() => (sessionStorage.getItem('ldx_booted') ? 'off' : 'on'));
  useEffect(() => {
    if (phase !== 'on') return;
    const t1 = setTimeout(() => setPhase('out'), 1700);
    const t2 = setTimeout(() => { setPhase('off'); sessionStorage.setItem('ldx_booted', '1'); }, 2150);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [phase]);
  if (phase === 'off') return null;
  return (
    <div className={`boot ${phase === 'out' ? 'done' : ''}`} onClick={() => { setPhase('off'); sessionStorage.setItem('ldx_booted', '1'); }}>
      <div className="boot-logo">LIFE HQ</div>
      <div className="boot-bar"><div /></div>
      <div className="boot-hint">LOADING WORLD…</div>
    </div>
  );
}

// Player card: level & XP from lifetime completions (todos + habit logs)
export function PlayerCard() {
  const { items: todos } = useCollection('todos');
  const { items: logs } = useCollection('habit_logs');
  const xp = todos.filter(t => t.completed).length * 10 + logs.length * 5;
  const lv = Math.floor(Math.sqrt(xp / 25)) + 1;
  const nextAt = 25 * lv * lv;
  const prevAt = 25 * (lv - 1) * (lv - 1);
  const pct = Math.min(100, Math.round(((xp - prevAt) / Math.max(1, nextAt - prevAt)) * 100));
  return (
    <div className="player-card">
      <div className="player-name">▲ NEEL</div>
      <div className="player-lv">LV {lv} · {xp} XP</div>
      <div className="xp-bar" title={`${pct}% to LV ${lv + 1}`}><div style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

// Scrolling HUD ticker for HQ
export function Ticker() {
  const today = todayStr();
  const { items: todos } = useCollection('todos');
  const { items: habits } = useCollection('habits');
  const { items: logs } = useCollection('habit_logs');
  const { items: news } = useCollection('news', { order: 'published_at' });

  const items = useMemo(() => {
    const due = todos.filter(t => !t.completed && t.due_date && t.due_date <= today).length;
    const habitsDone = habits.filter(h => !h.archived && logs.some(l => l.habit_id === h.id && l.date === today)).length;
    const bits = [
      due > 0 ? `⚠ ${due} QUEST${due > 1 ? 'S' : ''} DUE TODAY` : '✓ NO QUESTS DUE — FREE ROAM',
      `♥ HABITS ${habitsDone}/${habits.filter(h => !h.archived).length || 0}`,
      ...news.slice(0, 3).map(n => `※ ${String(n.title || '').toUpperCase().slice(0, 70)}`),
      'PRESS ANY TAB TO CONTINUE',
    ];
    return bits;
  }, [todos, habits, logs, news, today]);

  return (
    <div className="ticker">
      <div className="ticker-inner">
        {[...items, ...items].map((x, i) => <span key={i}>{x}</span>)}
      </div>
    </div>
  );
}

export function PixelClouds() {
  return (
    <svg className="pix-clouds" width="90" height="34" viewBox="0 0 45 17" shapeRendering="crispEdges">
      <g fill="#b7a8cc" opacity=".5">
        <rect x="4" y="4" width="10" height="3" /><rect x="6" y="2" width="6" height="2" />
        <rect x="2" y="7" width="14" height="2" />
        <rect x="28" y="8" width="12" height="3" /><rect x="30" y="6" width="8" height="2" />
        <rect x="26" y="11" width="16" height="2" />
      </g>
    </svg>
  );
}
