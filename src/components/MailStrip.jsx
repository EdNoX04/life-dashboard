import React, { useMemo, useState } from 'react';
import { Card, Empty } from './ui.jsx';
import { useCollection } from '../lib/hooks.js';

// MailStrip — unread mail across every connected Google account.
//
// Read-only by design, and the design is the point. The worker that fills this
// holds a `gmail.readonly` token and has no send path at all, so the worst a bug
// here can do is show you the wrong subject line. Nothing in this component, and
// nothing behind it, can reply, forward, archive or delete. That constraint is
// what makes it reasonable to have work mail on a personal dashboard at all.
//
// It also stores metadata only — sender, subject, and the snippet Google itself
// generates — never message bodies. A dashboard is a thing left open on a desk.
//
// Sorting deserves a note. The obvious order is newest-first, and that is the
// fallback, but it is not the top-level order: mail Google has flagged IMPORTANT
// floats above the rest. A strip capped at a handful of rows that fills up with
// newsletters teaches you to stop looking at it, and a strip you have stopped
// looking at is worse than no strip, because you still believe you would have
// noticed something.

function ago(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return '';
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return d < 7 ? `${d}d` : `${Math.floor(d / 7)}w`;
}

export default function MailStrip({ limit = 6 }) {
  const { items } = useCollection('memory', { filter: 'key=eq.mail_inbox', order: 'key' });
  const blob = items?.[0]?.value || {};
  const accounts = Array.isArray(blob.accounts) ? blob.accounts : [];
  const byAccount = blob.byAccount || {};
  const [filter, setFilter] = useState('all');
  const [expanded, setExpanded] = useState(false);

  const { rows, totalUnread, problems } = useMemo(() => {
    const out = [];
    const probs = [];
    let unread = 0;
    for (const a of accounts) {
      const box = byAccount[a.id];
      if (!box) continue;
      if (!box.ok) { probs.push({ label: a.label, reason: box.reason }); continue; }
      unread += box.unread || 0;
      if (filter !== 'all' && filter !== a.id) continue;
      for (const m of (box.messages || [])) {
        out.push({ ...m, accountId: a.id, accountLabel: a.label, color: a.color });
      }
    }
    out.sort((x, y) => {
      // Important first, then newest. Both directions matter: important-only
      // would bury a genuinely urgent unflagged mail from an hour ago, and
      // newest-only would bury your manager under a marketing blast.
      if (!!y.important !== !!x.important) return y.important ? 1 : -1;
      return String(y.date).localeCompare(String(x.date));
    });
    return { rows: out, totalUnread: unread, problems: probs };
  }, [accounts, byAccount, filter]);

  const shown = expanded ? rows : rows.slice(0, limit);
  const configured = accounts.length > 0;

  return (
    <Card
      title={`Inbox${totalUnread ? ` · ${totalUnread} unread` : ''}`}
      color={totalUnread ? 'var(--orange)' : 'var(--green)'}
      right={accounts.length > 1 && (
        <span className="flex" style={{ gap: 4 }}>
          <button className={`btn btn-sm${filter === 'all' ? ' btn-cyan' : ''}`} onClick={() => setFilter('all')}>ALL</button>
          {accounts.map(a => (
            <button key={a.id} className={`btn btn-sm${filter === a.id ? ' btn-cyan' : ''}`} onClick={() => setFilter(a.id)}>
              {a.label.toUpperCase()}
            </button>
          ))}
        </span>
      )}
    >
      {!configured && (
        <Empty note="No Google account is connected yet. Add GOOGLE_REFRESH_TOKEN (and GOOGLE_WORK_REFRESH_TOKEN for the company account) in the repo secrets — see Background sync below." />
      )}

      {problems.map(p => (
        <div key={p.label} className="mail-problem">
          <strong>{p.label}:</strong> {p.reason}
        </div>
      ))}

      {configured && rows.length === 0 && problems.length === 0 && (
        <div className="muted small" style={{ padding: '6px 2px' }}>
          — inbox zero —
        </div>
      )}

      <div className="mail-rows">
        {shown.map(m => (
          <a key={`${m.accountId}:${m.id}`} className="mail-row" href={m.link} target="_blank" rel="noreferrer">
            <span className="mail-bar" style={{ background: m.color || 'var(--cyan)' }} aria-hidden="true" />
            <span className="mail-body">
              <span className="mail-head">
                <span className="mail-from">{m.fromName || m.fromEmail}</span>
                {m.important && <span className="mail-flag" title="Google flagged this as important">!</span>}
                {m.starred && <span className="mail-star" title="Starred">★</span>}
                <span className="mail-when">{ago(m.date)}</span>
              </span>
              <span className="mail-subject">{m.subject}</span>
              <span className="mail-snippet">{m.snippet}</span>
            </span>
          </a>
        ))}
      </div>

      {rows.length > limit && (
        <button className="btn btn-sm mt" onClick={() => setExpanded(v => !v)}>
          {expanded ? '▲ show less' : `▼ ${rows.length - limit} more`}
        </button>
      )}

      {blob.updated && (
        <div className="small muted mt">
          Read-only · metadata only · synced {new Date(blob.updated).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
        </div>
      )}
    </Card>
  );
}
