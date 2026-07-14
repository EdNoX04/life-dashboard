import React, { useEffect, useState } from 'react';
import * as db from '../lib/db.js';

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

export function AskCowork() {
  const [q, setQ] = useState('');
  const [sent, setSent] = useState(false);
  async function send() {
    if (!q.trim()) return;
    await db.sendRequest('ask', { question: q.trim() });
    setQ('');
    setSent(true);
    setTimeout(() => setSent(false), 2500);
  }
  return (
    <Card title="Ask Cowork" color="var(--pink)">
      <div className="flex">
        <input
          placeholder="Ask anything — answered on Cowork's next run…"
          value={q}
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && send()}
        />
        <button className="btn btn-pink" onClick={send}>Send</button>
      </div>
      {sent && <div className="small mt" style={{ color: 'var(--green)' }}>Queued — Cowork picks it up on its next scheduled run.</div>}
      {!db.isRemote() && <div className="small muted mt">Local mode: requests queue up once Supabase is connected (Settings tab).</div>}
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

export function EyeBtn({ visible, onClick }) {
  return (
    <button className="btn btn-sm" onClick={onClick} title={visible ? 'Hide amounts' : 'Show amounts'} aria-label="toggle amounts">
      {visible ? '🙈 hide' : '👁 show'}
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
