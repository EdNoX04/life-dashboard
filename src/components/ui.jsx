import React, { useEffect, useRef, useState } from 'react';
import * as db from '../lib/db.js';
import { aiChat, pickProvider, providerLabel } from '../lib/ai.js';
import { homeContext } from '../lib/ally.js';
import { useCollection } from '../lib/hooks.js';

export function Card({ title, color = 'var(--purple)', children, right, className = '' }) {
  return (
    <div className={`px card ${className}`}>
      {title && (
        <div className="card-title spread">
          <span className="flex" style={{ gap: 8 }}>
            <span className="sq" style={{ background: color }} />
            {title}
          </span>
          {right}
        </div>
      )}
      {children}
    </div>
  );
}

export function StatTile({ label, value, note, color = 'var(--cyan)' }) {
  return (
    <div className="px stat-tile">
      <div className="stat-label" style={{ color }}>{label}</div>
      <div className="stat-value">{value}</div>
      {note && <div className="stat-note">{note}</div>}
    </div>
  );
}

export function Empty({ icon = '?', text }) {
  return (
    <div className="empty">
      <span className="pix">[{icon}]</span>
      {text}
    </div>
  );
}

export function Toast({ msg }) {
  if (!msg) return null;
  return <div className="toast">{msg}</div>;
}

// Manual refresh: in remote mode also files a `refresh` request so Cowork
// re-pulls the underlying source (amizone, prices, news…) on its next run.
export function RefreshButton({ source, onLocalRefresh, label = 'Refresh' }) {
  const [state, setState] = useState('idle');
  async function go() {
    setState('busy');
    try {
      if (onLocalRefresh) await onLocalRefresh();
      if (db.isRemote() && source) await db.sendRequest('refresh', { source });
      setState('done');
      setTimeout(() => setState('idle'), 1600);
    } catch {
      setState('idle');
    }
  }
  return (
    <button className="btn btn-sm btn-cyan" onClick={go} disabled={state === 'busy'}>
      {state === 'busy' ? '...' : state === 'done' ? 'Queued!' : `↻ ${label}`}
    </button>
  );
}

// Live AI chat — talks straight to whichever provider key is set in Config
// (Claude / Gemini / ChatGPT). Every reply logs its token cost to the usage meter.
// PLAYER TWO — the co-op partner. Named for the app rather than for the model
// because the model behind it will change and the name should not.
const AI_SYSTEM = "You are PLAYER TWO, the built-in assistant inside Neel's personal life dashboard (a retro-arcade PWA covering college, habits, study, tasks and health). You do NOT cover money — the Money tab has its own assistant, LEDGER, with access you do not have. If asked anything financial, say so and point there. Be concise, warm and practical. Use plain sentences, not long lists. Answer from the CONTEXT below when it covers the question. If the context does not contain the answer, say that plainly and name the tab that would have it — never invent a class, a task or a date.";

export function AskCowork() {
  const [msgs, setMsgs] = useState([]); // {role:'user'|'assistant', content}
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const logRef = useRef(null);
  const provider = pickProvider();

  // The dock used to be sent no data at all, so "what's my second class on
  // Monday" got "I don't have access to your class schedule" — a true statement
  // about an empty prompt, and a useless one to read on your own dashboard.
  // Everything read here is non-personal by the standard in ally.js: this dock
  // routes to NVIDIA's free tier, whose terms say inputs are used for training.
  const { items: timetable } = useCollection('timetable', { order: 'id' });
  const { items: todos } = useCollection('todos', { order: 'due_date', asc: true });
  const { items: habits } = useCollection('habits', { order: 'id' });
  const { items: goals } = useCollection('goals', { order: 'id' });
  const { items: calMem } = useCollection('memory', { filter: 'key=eq.calendar_events', order: 'key' });

  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [msgs, busy]);

  async function send() {
    const text = q.trim();
    if (!text || busy) return;
    setErr('');
    const next = [...msgs, { role: 'user', content: text }];
    setMsgs(next); setQ(''); setBusy(true);
    try {
      // No agent name: this is the general dock and it has no idea what the
      // question is about, so it takes the server's fail-closed default and
      // goes to the paid provider. The cheap alternative is guessing, and
      // guessing wrong here means posting personal data to a training endpoint.
      const context = homeContext({
        timetable: timetable || [], todos: todos || [], habits: habits || [], goals: goals || [],
        events: calMem?.[0]?.value?.events || [],
      });
      // agent:'home' routes to GLM-5.2. Safe because homeContext is an allowlist,
      // not a dump — see HOME_WITHHELD for what it refuses to carry.
      const { text: reply } = await aiChat(next, {
        system: `${AI_SYSTEM}\n\n--- CONTEXT ---\n${context}`,
        agent: 'home',   // never 'money' — PLAYER TWO does not see finance at all
      });
      setMsgs(m => [...m, { role: 'assistant', content: reply || '(no reply)' }]);
    } catch (e) {
      setErr(String(e.message || e));
    }
    setBusy(false);
  }

  return (
    <Card title="AI assistant" color="var(--pink)"
      right={provider ? <span className="chip c-green">{providerLabel(provider)}</span> : <span className="chip c-yellow">no key</span>}>
      {!provider && <div className="small muted mb">Add a Claude, Gemini or ChatGPT key in Config → AI providers to turn this on. Whichever you set is used automatically.</div>}
      {msgs.length > 0 && (
        <div className="chat-log" ref={logRef}>
          {msgs.map((m, i) => (
            <div key={i} className={`chat-msg ${m.role === 'user' ? 'me' : 'bot'}`}>
              <span className="chat-who">{m.role === 'user' ? 'YOU' : 'AI'}</span>
              <span className="chat-body" style={{ whiteSpace: 'pre-wrap' }}>{m.content}</span>
            </div>
          ))}
          {busy && <div className="chat-msg bot"><span className="chat-who">AI</span><span className="chat-body muted">…thinking</span></div>}
        </div>
      )}
      <div className="flex">
        <input
          placeholder={provider ? 'Ask anything…' : 'Add a key in Config first'}
          value={q}
          disabled={!provider || busy}
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && send()}
        />
        <button className="btn btn-pink" onClick={send} disabled={!provider || busy}>{busy ? '…' : 'Send'}</button>
      </div>
      {err && <div className="small mt" style={{ color: 'var(--red)' }}>{err}</div>}
      {provider && !err && <div className="small muted mt">Live — answers come straight from {providerLabel(provider)}. Usage & cost tracked in Config.</div>}
    </Card>
  );
}

// Pixel checkbox with "+XP" coin pop on completion
export function PCheck({ done, onToggle, xp = 10 }) {
  const [pop, setPop] = useState(false);
  return (
    <span className={`pcheck ${done ? 'done' : ''}`}
      onClick={() => {
        if (!done) { setPop(true); setTimeout(() => setPop(false), 750); }
        onToggle();
      }}>
      {done ? '✕' : ''}
      {pop && <span className="coin-pop">+{xp}xp</span>}
    </span>
  );
}

// Money privacy: amounts hidden by default each visit; eye reveals for the session.
// Shared across tabs via a window event so HQ + Money stay in sync.
export function useMoneyVisible() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const h = e => setVisible(e.detail);
    window.addEventListener('ldx-money-vis', h);
    return () => window.removeEventListener('ldx-money-vis', h);
  }, []);
  const toggle = () => {
    setVisible(v => {
      const nv = !v;
      window.dispatchEvent(new CustomEvent('ldx-money-vis', { detail: nv }));
      return nv;
    });
  };
  return [visible, toggle];
}

// Retro eye toggle — pure symbol, no words. Open eye = amounts shown;
// slashed eye = hidden.
export function EyeBtn({ visible, onClick }) {
  return (
    <button className="btn btn-sm btn-eye" onClick={onClick} title={visible ? 'Hide amounts' : 'Show amounts'} aria-label="toggle amounts">
      <svg viewBox="0 0 20 14" width="19" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square" aria-hidden="true">
        <path d="M1.5 7 Q10 -1.5 18.5 7 Q10 15.5 1.5 7 Z" />
        <circle cx="10" cy="7" r="3.1" />
        <circle cx="11.1" cy="5.9" r="0.9" fill="currentColor" stroke="none" />
        {!visible && <path d="M3 13 L17 1" strokeWidth="2.1" />}
      </svg>
    </button>
  );
}

export function money(n, visible, cur = '$') {
  if (n == null) return '—';
  if (!visible) return '•••••';
  return cur + Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function useNow(intervalMs = 30000) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
