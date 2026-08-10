import React, { useMemo, useState } from 'react';
import { Card, Empty, StatTile } from '../ui.jsx';
import { diary, undated, summarise, streak, activity, withRewatch, monthLabel } from '../../lib/medialog.js';

// The diary.
//
// The shelf answers "what do I own / plan to watch". This answers "what did I
// actually watch, and when" — a question the app could not answer at all, since
// nothing recorded a date. They are different enough that they get different
// screens rather than a toggle on the same one.
//
// Grouped by month and then by day, because the shape is the finding. Four films
// across one weekend and then three empty weeks is a fact about how you watch,
// and a flat reverse-chronological list hides it behind scrolling. Letterboxd
// groups the same way for the same reason.

const HEAT = ['rgba(255,255,255,0.05)', 'rgba(70,220,130,.35)', 'rgba(70,220,130,.6)', 'rgba(70,220,130,.85)', 'var(--green)'];
const heat = n => HEAT[Math.min(n, HEAT.length - 1)];

const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

// Sixteen weeks of viewing, one cell a day. Days with nothing are drawn as
// empty cells rather than skipped — a gap is information, a missing cell is
// just a missing cell.
function Activity({ cells }) {
  const weeks = useMemo(() => {
    const out = [];
    let week = [];
    for (const c of cells) {
      const dow = new Date(`${c.date}T00:00:00`).getDay();
      if (!week.length) for (let i = 0; i < dow; i++) week.push(null);
      week.push(c);
      if (week.length === 7) { out.push(week); week = []; }
    }
    if (week.length) { while (week.length < 7) week.push(null); out.push(week); }
    return out;
  }, [cells]);

  return (
    <div className="md-heat">
      <div className="md-heat-dow">{DOW.map((d, i) => <span key={i}>{d}</span>)}</div>
      <div className="md-heat-grid">
        {weeks.map((w, i) => (
          <div className="md-heat-week" key={i}>
            {w.map((c, j) => (
              <i key={j} title={c ? `${c.date} · ${c.count} viewing${c.count === 1 ? '' : 's'}` : ''}
                style={{ background: c ? heat(c.count) : 'transparent' }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function Row({ e, onEdit, onDelete }) {
  return (
    <div className="md-row">
      <span className="md-art">
        {e.poster_url
          ? <img src={e.poster_url} alt="" style={{ imageRendering: 'pixelated' }} />
          : <b>{e.kind === 'movie' ? '▶' : '📺'}</b>}
      </span>
      <span className="md-title">
        {e.title}
        {/* Season and episode belong next to the title, not in a tooltip: on a
            sitcom night the episode IS what you watched. */}
        {e.season != null && (
          <i className="md-ep">S{String(e.season).padStart(2, '0')}{e.episode != null ? `E${String(e.episode).padStart(2, '0')}` : ''}</i>
        )}
        {e.rewatch && <i className="md-rewatch" title="You had seen this before">↻ rewatch</i>}
        {e.note && <i className="md-note">{e.note}</i>}
      </span>
      <span className="md-rating">{e.rating ? '★'.repeat(e.rating) : ''}</span>
      <span className="md-acts">
        <button className="btn btn-sm" onClick={() => onEdit(e)}>EDIT</button>
        <button className="btn btn-sm" onClick={() => onDelete(e)}>✕</button>
      </span>
    </div>
  );
}

export default function Diary({ log = [], onEdit, onDelete, onAdd }) {
  const [months, setMonths] = useState(3);

  // Rewatch is derived here rather than stored, so it stays correct when an
  // older viewing is imported later. Adding a 2019 viewing of a film you logged
  // in 2026 should turn the 2026 one into the rewatch, and it does.
  const marked = useMemo(() => withRewatch(log), [log]);
  const groups = useMemo(() => diary(marked), [marked]);
  const loose = useMemo(() => undated(marked), [marked]);
  const all = useMemo(() => summarise(marked), [marked]);
  const cells = useMemo(() => activity(marked, { days: 112 }), [marked]);
  const run = useMemo(() => streak(marked), [marked]);

  // This month, for the tiles. Compared against the previous month rather than
  // shown alone, because a count with nothing to measure it against is a number
  // you cannot act on.
  const thisMonth = groups[0]?.count ?? 0;
  const lastMonth = groups[1]?.count ?? 0;

  if (!log.length) {
    return (
      <Card title="Diary" color="var(--pink)">
        <Empty
          icon="◷"
          text="Nothing logged yet. Every time you finish something, log it with the date you watched it — that date is what turns a shelf into a diary, and it is the one thing that cannot be reconstructed afterwards."
        />
        {onAdd && <div className="flex" style={{ justifyContent: 'center' }}><button className="btn btn-green" onClick={onAdd}>+ LOG A VIEWING</button></div>}
      </Card>
    );
  }

  return (
    <>
      <div className="tile-row">
        <StatTile label="Viewings" value={all.viewings}
          note={`${all.titles} title${all.titles === 1 ? '' : 's'}${all.rewatches ? ` · ${all.rewatches} rewatch` : ''}`}
          color="var(--pink)" />
        <StatTile label="This month" value={thisMonth}
          note={groups[1] ? `${lastMonth} in ${monthLabel(groups[1].key).split(' ')[0]}` : 'first month on record'}
          color="var(--cyan)" />
        <StatTile
          label="Time" value={all.exact ? `${all.hours.toFixed(1)}h` : `~${all.estHours.toFixed(1)}h`}
          note={all.exact ? 'from recorded runtimes' : `${all.unknownRuntime} without a runtime`}
          color="var(--orange)" />
        <StatTile label="Streak" value={run} note={run === 1 ? 'day' : 'days in a row'} color="var(--green)" />
      </div>

      <Card title="Activity" color="var(--green)"
        right={onAdd ? <button className="btn btn-sm btn-green" onClick={onAdd}>+ LOG</button> : null}>
        <Activity cells={cells} />
        <p className="small muted" style={{ marginTop: 8 }}>
          Sixteen weeks. Each cell is a day; the brighter it is, the more you watched.
        </p>
      </Card>

      {groups.slice(0, months).map(m => (
        <Card key={m.key} title={m.label} color="var(--pink)"
          right={<span className="chip c-pink">{m.count} viewing{m.count === 1 ? '' : 's'}</span>}>
          {m.days.map(d => (
            <div className="md-day" key={d.date}>
              <div className="md-dayhead">
                <b>{String(d.day).padStart(2, '0')}</b>
                <span className="muted small">
                  {new Date(`${d.date}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'long' })}
                </span>
                {/* A double feature is worth pointing at. It is the pattern the
                    grouping exists to reveal. */}
                {d.entries.length > 1 && <span className="chip c-cyan">{d.entries.length} in a day</span>}
              </div>
              {d.entries.map(e => <Row key={e.id} e={e} onEdit={onEdit} onDelete={onDelete} />)}
            </div>
          ))}
        </Card>
      ))}

      {groups.length > months && (
        <div className="flex" style={{ justifyContent: 'center', marginBottom: 12 }}>
          <button className="btn" onClick={() => setMonths(n => n + 6)}>
            ↓ {groups.length - months} EARLIER MONTH{groups.length - months === 1 ? '' : 'S'}
          </button>
        </div>
      )}

      {/* Undated viewings are shown, not hidden. They mostly arrive from an
          import that had no date, and a diary that silently drops them would be
          quietly wrong about how much you have watched. */}
      {loose.length > 0 && (
        <Card title="No date recorded" color="var(--yellow)"
          right={<span className="chip c-yellow">{loose.length}</span>}>
          <p className="small muted" style={{ marginTop: 0 }}>
            These are real viewings with a missing date, so they count in your
            totals but cannot appear in the diary above. Edit one to place it.
          </p>
          {loose.map(e => <Row key={e.id} e={e} onEdit={onEdit} onDelete={onDelete} />)}
        </Card>
      )}
    </>
  );
}
