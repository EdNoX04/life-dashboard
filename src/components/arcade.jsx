import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useCollection, todayStr } from '../lib/hooks.js';

// Trim to a length without slicing a word in half (the old ticker cut mid-word,
// which read as text being chopped off).
function clip(s, n) {
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  const sp = cut.lastIndexOf(' ');
  return (sp > n * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s—–-]+$/, '') + '…';
}

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
      <div className="boot-logo">PLAYER ONE</div>
      <div className="boot-bar"><div /></div>
      <div className="boot-hint">LOADING WORLD…</div>
    </div>
  );
}

// Player card: level & XP from lifetime completions (todos + habit logs)
export function PlayerCard() {
  const { items: todos } = useCollection('todos');
  const { items: logs } = useCollection('habit_logs');
  const { items: dsaMem } = useCollection('memory', { filter: 'key=eq.dsa_solves', order: 'key' });
  const dsaSolves = dsaMem?.[0]?.value?.list?.length || 0;
  const xp = todos.filter(t => t.completed).length * 10 + logs.length * 5 + dsaSolves * 20;
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

// Scrolling HUD ticker for HQ.
// The loop works by rendering two identical halves and sliding exactly -50%, so the
// second half lands where the first began. That only looks seamless if a half is at
// least as wide as the rail — otherwise the content runs out mid-rail and items look
// like they've been blacked out. So we measure one copy of the list and repeat it
// enough times to cover the rail before duplicating.
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
      ...news.slice(0, 3).map(n => `※ ${clip(String(n.title || '').toUpperCase(), 70)}`),
      'PRESS ANY TAB TO CONTINUE',
    ];
    return bits;
  }, [todos, habits, logs, news, today]);

  const railRef = useRef(null);
  const baseRef = useRef(null);
  const [{ reps, unit }, setFit] = useState({ reps: 1, unit: 0 });

  useLayoutEffect(() => {
    const rail = railRef.current, base = baseRef.current;
    if (!rail || !base) return;
    const calc = () => {
      const railW = rail.clientWidth || 0;
      const baseW = base.scrollWidth || 0;
      if (!railW || !baseW) return;
      const r = Math.max(1, Math.ceil(railW / baseW));
      setFit(p => (p.reps === r && p.unit === baseW * r ? p : { reps: r, unit: baseW * r }));
    };
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(rail); ro.observe(base);
    return () => ro.disconnect();
  }, [items]);

  const half = useMemo(() => {
    const out = [];
    for (let r = 0; r < reps; r++) out.push(...items);
    return out;
  }, [items, reps]);

  // constant reading speed regardless of how much content there is
  const dur = Math.max(18, Math.round(unit / 55)) || 36;

  return (
    <div className="ticker" ref={railRef}>
      {/* hidden single copy, used only to measure one pass of the list */}
      <div className="ticker-measure" ref={baseRef} aria-hidden="true">
        {items.map((x, i) => <span key={i}>{x}</span>)}
      </div>
      <div className="ticker-inner" style={{ animationDuration: `${dur}s` }}>
        {[...half, ...half].map((x, i) => <span key={i}>{x}</span>)}
      </div>
    </div>
  );
}

function Cloud({ style, scale = 1, fill = '#e8dcff' }) {
  return (
    <svg width={46 * scale} height={20 * scale} viewBox="0 0 23 10" shapeRendering="crispEdges" style={style}>
      <g fill={fill}>
        <rect x="6" y="2" width="6" height="2" /><rect x="10" y="1" width="5" height="2" />
        <rect x="3" y="4" width="17" height="2" /><rect x="1" y="6" width="21" height="2" />
      </g>
    </svg>
  );
}

// Time-reactive animated sky: sunrise / day / sunset / night.
export function Sky({ hour }) {
  const phase = hour >= 5 && hour < 8 ? 'sunrise' : hour >= 8 && hour < 16 ? 'day' : hour >= 16 && hour < 19 ? 'sunset' : 'night';
  const isNight = phase === 'night';
  // orb lives on the RIGHT side of the banner; tracks a low→high→low arc through the day
  const orbLeft = phase === 'sunrise' ? '62%' : phase === 'day' ? '74%' : phase === 'sunset' ? '90%' : '82%';
  const orbTop = phase === 'day' ? '16%' : isNight ? '22%' : '44%';
  const orbColor = isNight ? '#e8e2ff' : phase === 'day' ? '#ffe08a' : '#ffb15c';
  const cloudFill = isNight ? '#3a2c52' : phase === 'sunset' ? '#c98ab0' : '#e8dcff';

  return (
    <div className={`sky sky-${phase}`} aria-hidden="true">
      {isNight && (
        <div className="stars">
          {[[56, 22], [64, 46], [72, 16], [80, 58], [90, 32], [66, 64], [94, 52], [76, 14], [86, 40], [60, 70]].map(([l, t], i) => (
            <span key={i} className="star" style={{ left: l + '%', top: t + '%', animationDelay: (i * 0.4) + 's' }} />
          ))}
        </div>
      )}
      <div className="orb" style={{ left: orbLeft, top: orbTop, background: orbColor, boxShadow: `0 0 18px ${orbColor}` }}>
        {isNight && <span className="moon-crater" />}
      </div>
      <Cloud style={{ position: 'absolute', top: '22%', animation: 'cloudDrift 46s linear infinite' }} scale={1.4} fill={cloudFill} />
      <Cloud style={{ position: 'absolute', top: '48%', animation: 'cloudDrift 70s linear infinite', animationDelay: '-20s', opacity: 0.7 }} scale={1} fill={cloudFill} />
      <Cloud style={{ position: 'absolute', top: '12%', animation: 'cloudDrift 90s linear infinite', animationDelay: '-55s', opacity: 0.55 }} scale={0.8} fill={cloudFill} />
    </div>
  );
}

const SPARKS = [
  { q: 'The obstacle is the way.', a: 'Marcus Aurelius' },
  { q: 'What you do every day matters more than what you do once in a while.', a: 'Gretchen Rubin' },
  { q: 'Discipline is choosing between what you want now and what you want most.', a: 'Augusta F. Kantra' },
  { q: 'You do not rise to the level of your goals. You fall to the level of your systems.', a: 'James Clear' },
  { q: 'The best time to plant a tree was 20 years ago. The second best time is now.', a: 'Proverb' },
  { q: 'Compound interest is the eighth wonder of the world.', a: 'attrib. Einstein' },
  { q: 'Hard choices, easy life. Easy choices, hard life.', a: 'Jerzy Gregorek' },
  { q: 'It is not that we have a short time to live, but that we waste a lot of it.', a: 'Seneca' },
  { q: 'Amateurs sit and wait for inspiration; the rest of us just get up and go to work.', a: 'Chuck Close' },
  { q: 'Slow is smooth, and smooth is fast.', a: 'Navy SEAL adage' },
  { q: 'You are what you repeatedly do. Excellence is a habit.', a: 'Will Durant' },
  { q: 'The man who moves a mountain begins by carrying away small stones.', a: 'Confucius' },
  { q: 'Motivation gets you going, but discipline keeps you growing.', a: 'John C. Maxwell' },
  { q: 'If it is important, do it every day. If it is not, do not do it at all.', a: 'Dan Gable' },
  { q: 'Comparison is the thief of joy.', a: 'Theodore Roosevelt' },
  { q: 'Fall seven times, stand up eight.', a: 'Japanese Proverb' },
  { q: 'Do the hard jobs first. The easy jobs will take care of themselves.', a: 'Dale Carnegie' },
  { q: 'Little by little, one travels far.', a: 'J.R.R. Tolkien' },
  { q: 'Risk comes from not knowing what you are doing.', a: 'Warren Buffett' },
  { q: 'The price of anything is the amount of life you exchange for it.', a: 'Thoreau' },
  { q: 'What gets measured gets managed.', a: 'Peter Drucker' },
  { q: 'Everything you want is on the other side of consistency.', a: '—' },
  { q: 'A year from now you may wish you had started today.', a: 'Karen Lamb' },
  { q: 'Simplicity is the ultimate sophistication.', a: 'da Vinci' },
  { q: 'Focus on being productive instead of busy.', a: 'Tim Ferriss' },
  { q: 'The cave you fear to enter holds the treasure you seek.', a: 'Joseph Campbell' },
  { q: 'Well begun is half done.', a: 'Aristotle' },
  { q: 'Energy and persistence conquer all things.', a: 'Benjamin Franklin' },
  { q: 'Make each day your masterpiece.', a: 'John Wooden' },
  { q: 'Knowing is not enough; we must apply.', a: 'Bruce Lee' },
];

export function useDailySpark() {
  const day = Math.floor(Date.now() / 86400000);
  return SPARKS[day % SPARKS.length];
}
