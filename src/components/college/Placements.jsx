import React, { useState } from 'react';
import { Card, Empty } from '../ui.jsx';
import {
  placementView, hoursLeft, STATUS_LABEL, driveId,
} from '../../lib/placements.js';

// Placement drives.
//
// The card is ordered by what you can still do, not by date and not by the order
// Amizone happens to render. Everything open sits at the top with a countdown;
// everything settled collapses behind a toggle, because a list of nineteen closed
// drives above the one that is still open is how the open one gets missed.

const CHIP = {
  open: 'c-yellow',
  unknown: 'c-yellow',
  applied: 'c-green',
  placed: 'c-green',
  closed: '',
  ineligible: 'c-red',
};

function countdown(r, now) {
  const h = hoursLeft(r, now);
  if (h == null) return { text: 'no closing date listed', urgent: false };
  if (h <= 0) return { text: 'closed', urgent: false };
  if (h < 1) return { text: `closes in ${Math.max(1, Math.round(h * 60))} min`, urgent: true };
  if (h < 24) return { text: `closes in ${Math.round(h)}h`, urgent: true };
  return { text: `closes in ${Math.round(h / 24)}d`, urgent: false };
}

const fmt = iso => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isFinite(d.getTime())
    ? d.toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    : '';
};

function Row({ r, now, dim }) {
  const c = countdown(r, now);
  return (
    <div className="row" style={dim ? { opacity: 0.5 } : undefined}>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.company}</span>
        <span className="dim" style={{ fontSize: 11 }}>
          {c.urgent ? <b style={{ color: 'var(--yellow)' }}>{c.text}</b> : c.text}
          {r.end && ` · ${fmt(r.end)}`}
          {r.note && ` · ${r.note}`}
        </span>
      </span>
      {/* The PDF is where the eligibility criteria and the CTC actually live, so
          it is a link on the row rather than something to go and find. */}
      {r.pdf && <a className="chip" href={r.pdf} target="_blank" rel="noreferrer">PDF</a>}
      <span className={`chip ${CHIP[r.status] || ''}`}>{STATUS_LABEL[r.status] || r.status}</span>
    </div>
  );
}

/**
 * @param {object} data  the `amizone_placements` memory row
 */
export default function Placements({ data }) {
  const [showAll, setShowAll] = useState(false);
  const now = new Date();
  const rows = data?.rows || [];
  const v = placementView(rows, now);

  // How stale the list is matters more here than anywhere else in the app: a
  // deadline card that has not refreshed for two days is not a card saying
  // "nothing is open", it is a card saying nothing at all.
  const at = data?.at ? new Date(data.at) : null;
  const ageH = at ? (Date.now() - at.getTime()) / 3600000 : null;
  const stale = ageH != null && ageH > 12;

  return (
    <Card
      title="Placement drives"
      color={v.actionable.length ? 'var(--yellow)' : 'var(--cyan)'}
      right={<a className="btn btn-sm" href="https://s.amizone.net/Placement/PlacementDetails" target="_blank" rel="noreferrer">Amizone →</a>}
    >
      {!rows.length && (
        <Empty icon="◷" text={data
          ? 'The placement page was captured but nothing parsed from it — open Amizone and check.'
          : 'Not synced yet. The Amizone bridge picks this up on its next run.'} />
      )}

      {rows.length > 0 && v.actionable.length === 0 && (
        <div className="dim" style={{ marginBottom: 8 }}>
          Nothing open right now — {v.applied.length} registered, {v.closed.length} closed
          {v.ineligible.length ? `, ${v.ineligible.length} you are not eligible for` : ''}.
        </div>
      )}

      {v.actionable.map(r => <Row key={driveId(r)} r={r} now={now} />)}

      {/* Worded as a fact, never as an accusation. This cannot tell a drive he
          read and passed on from one he never saw, and calling every one a miss
          is how the card earns itself a permanent scroll-past. */}
      {v.recentlyGone.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className="dim" style={{ fontSize: 11, marginBottom: 4 }}>Closed this week, not registered</div>
          {v.recentlyGone.slice(0, 3).map(r => <Row key={driveId(r)} r={r} now={now} dim />)}
        </div>
      )}

      {stale && (
        <div style={{ marginTop: 10, color: 'var(--red)', fontSize: 12 }}>
          Last read {ageH < 48 ? `${Math.round(ageH)}h` : `${Math.round(ageH / 24)}d`} ago — a new drive may already be open and not shown here.
        </div>
      )}

      {rows.length > v.actionable.length && (
        <div style={{ marginTop: 10 }}>
          <button className="btn btn-sm" onClick={() => setShowAll(s => !s)}>
            {showAll ? 'hide' : `all ${rows.length} drives`}
          </button>
        </div>
      )}

      {showAll && (
        <div style={{ marginTop: 8 }}>
          {[...v.applied, ...v.ineligible, ...v.closed]
            .sort((a, b) => Date.parse(b.end || 0) - Date.parse(a.end || 0))
            .map(r => <Row key={`all-${driveId(r)}`} r={r} now={now} dim />)}
        </div>
      )}
    </Card>
  );
}
