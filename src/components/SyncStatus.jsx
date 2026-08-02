import React from 'react';
import { Card } from './ui.jsx';
import { useCollection } from '../lib/hooks.js';

// SyncStatus — one honest line per background worker.
//
// This card is the other half of a change made in scripts/meeting-worker.mjs.
// That worker used to exit non-zero when its Google credentials were missing,
// which meant an unfinished setup step produced a red GitHub Actions email every
// five minutes, eighteen hours a day. Nobody reads the two-hundredth copy of an
// email, so the alert that mattered was guaranteed to be missed.
//
// Silencing it there without surfacing it here would have been strictly worse
// than the email storm: a sync that is quietly not running looks exactly like a
// sync that has nothing to report. Both states show an empty calendar. So the
// workers now write what they did into `memory.sync_status`, and this draws it
// where it is actually looked at.
//
// The three states are deliberately distinct, because they need different things
// from the reader:
//   NOT CONNECTED (amber) — you have not finished setting this up. Nothing is
//                           broken; there is a task waiting for you.
//   ERROR (red)           — this used to work and has stopped. Act now.
//   LIVE (green)          — with the timestamp, because "connected" without
//                           "and it ran twenty minutes ago" is not reassurance.

const WORKERS = [
  { key: 'meetings', label: 'CALENDAR + MAIL', hint: 'Google Calendar events, Meet links and the unread inbox.' },
  { key: 'amizone',  label: 'AMIZONE',         hint: 'Timetable, subjects and attendance from s.amizone.net.' },
  { key: 'prices',   label: 'MARKET PRICES',   hint: 'Quote refresh for holdings and the watchlist.' },
  { key: 'binance',  label: 'BINANCE',         hint: 'Balances, P2P orders, deposits and withdrawals — read-only.' },
];

function ago(iso) {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'just now';
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// A run that succeeded but hours ago is its own kind of problem — the schedule
// itself has stopped firing — and it should not sit there wearing a green light.
const STALE_AFTER = { meetings: 45 * 60e3, amizone: 26 * 3600e3, prices: 6 * 3600e3, binance: 26 * 3600e3 };

function stateOf(key, s) {
  if (!s) return { tone: 'idle', word: 'NO REPORT', color: 'var(--ink-3)' };
  if (s.configured === false) return { tone: 'setup', word: 'NOT CONNECTED', color: 'var(--yellow)' };
  if (!s.ok) return { tone: 'error', word: 'ERROR', color: 'var(--red)' };
  const age = s.at ? Date.now() - new Date(s.at).getTime() : Infinity;
  if (age > (STALE_AFTER[key] ?? Infinity)) return { tone: 'stale', word: 'STALE', color: 'var(--orange)' };
  return { tone: 'ok', word: 'LIVE', color: 'var(--green)' };
}

export default function SyncStatus() {
  const { items } = useCollection('memory', { filter: 'key=eq.sync_status', order: 'key' });
  const status = items?.[0]?.value || {};

  const rows = WORKERS.map(w => ({ ...w, s: status[w.key], st: stateOf(w.key, status[w.key]) }));
  const bad = rows.filter(r => r.st.tone === 'error' || r.st.tone === 'stale').length;
  const unset = rows.filter(r => r.st.tone === 'setup').length;

  // The card's own colour carries the worst state, so a collapsed or scrolled-past
  // card still says something true from the corner of the eye.
  const cardColor = bad ? 'var(--red)' : unset ? 'var(--yellow)' : 'var(--green)';

  return (
    <Card title="Background sync" color={cardColor}>
      <div className="small muted" style={{ marginBottom: 10, lineHeight: 1.5 }}>
        These run on GitHub Actions, not on your phone or laptop — they keep working
        while everything is closed. A worker that is not connected is waiting on a
        repo secret, not broken.
      </div>

      <div className="sync-rows">
        {rows.map(r => (
          <div key={r.key} className="sync-row">
            <span
              className="sync-dot"
              style={{ background: r.st.color, boxShadow: `0 0 6px ${r.st.color}` }}
              aria-hidden="true"
            />
            <div className="sync-main">
              <div className="sync-head">
                <span className="sync-label">{r.label}</span>
                <span className="sync-word" style={{ color: r.st.color }}>{r.st.word}</span>
                <span className="sync-when">{ago(r.s?.at)}</span>
              </div>
              <div className="sync-hint">
                {r.st.tone === 'idle'
                  ? 'This worker has not reported yet. It reports on its first run after deploy.'
                  : r.s?.reason || r.hint}
              </div>
              {r.s?.waiting > 0 && (
                <div className="sync-waiting">
                  {r.s.waiting} item{r.s.waiting === 1 ? '' : 's'} queued — nothing is lost, they go through once this connects.
                </div>
              )}
              {Array.isArray(r.s?.accounts) && r.s.accounts.length > 0 && (
                <div className="sync-accounts">
                  {r.s.accounts.map(a => <span key={a} className="sync-chip">{a}</span>)}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
