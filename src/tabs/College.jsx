import React from 'react';
import { useCollection } from '../lib/hooks.js';
import { Card, Empty, StatTile, RefreshButton } from '../components/ui.jsx';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
// Amizone stores attendance as a fraction (0.81) OR a percent (81); normalize to %.
const attPct = raw => { const n = Number(raw) || 0; return n > 0 && n <= 1 ? Math.round(n * 1000) / 10 : n; };

export default function College() {
  const { items: timetable, refresh: rT } = useCollection('timetable', { order: 'start_time', asc: true });
  const { items: subjects, refresh: rS } = useCollection('subjects', { order: 'name', asc: true });
  const { items: annc, refresh: rA } = useCollection('announcements', { order: 'date' });
  const { items: logMem, refresh: rL } = useCollection('memory', { filter: 'key=eq.attendance_log', order: 'key' });
  const attLog = logMem?.[0]?.value;

  const todayName = DAYS[(new Date().getDay() + 6) % 7] || 'Monday';
  // average only over subjects that actually have attendance data (skip unsynced 0s)
  const rated = subjects.map(s => attPct(s.attendance_pct)).filter(p => p > 0);
  const avgAtt = rated.length ? Math.round(rated.reduce((a, b) => a + b, 0) / rated.length) : null;
  const lowAtt = subjects.filter(s => { const p = attPct(s.attendance_pct); return p > 0 && p < 75; });

  return (
    <>
      <div className="spread">
        <h1 className="tab-title">COLLEGE</h1>
        <RefreshButton source="amizone" onLocalRefresh={async () => { await rT(); await rS(); await rA(); await rL(); }} label="Sync Amizone" />
      </div>
      <p className="tab-sub">Timetable, attendance & announcements — scraped from Amizone by Cowork.</p>

      <div className="tile-row">
        <StatTile label="Avg attendance" value={avgAtt != null ? `${avgAtt}%` : '—'}
          note={lowAtt.length ? `${lowAtt.length} subject(s) below 75%!` : 'all safe'}
          color={avgAtt != null && avgAtt < 75 ? 'var(--red)' : 'var(--green)'} />
        <StatTile label="Classes today" value={timetable.filter(t => t.day === todayName).length} color="var(--cyan)" />
        <StatTile label="Announcements" value={annc.length} color="var(--pink)" />
      </div>

      <Card title={`Today — ${todayName}`} color="var(--cyan)">
        {timetable.filter(t => t.day === todayName).length === 0 && (
          <Empty icon="☺" text={timetable.length ? `No classes on ${todayName} — free roam. Your classes: ${[...new Set(timetable.map(t => t.day))].join(', ')}.` : 'No classes synced yet — ask Cowork to sync your college.'} />
        )}
        {timetable.filter(t => t.day === todayName).map(t => (
          <div className="tt-item" key={t.id}>
            <span className="chip c-cyan tt-time">{t.start_time}–{t.end_time}</span>
            <span className="tt-subj">{t.subject}</span>
            <span className="tt-meta">
              {t.room && <span className="chip">{t.room}</span>}
              {t.faculty && <span className="chip c-purple">{t.faculty}</span>}
            </span>
          </div>
        ))}
      </Card>

      <Card title="Attendance by subject" color="var(--green)">
        {subjects.length === 0 && <Empty icon="%" text="Synced from Amizone once connected — or add subjects in the Subjects tab." />}
        {subjects.map(s => {
          const pct = attPct(s.attendance_pct);
          return (
            <div className="att-row" key={s.id}>
              <span className="att-name">{s.name}</span>
              <div className="att-meter">
                <div className="pbar"><div style={{ width: `${Math.min(100, pct)}%`, background: pct < 75 ? 'var(--bad)' : 'var(--ok)' }} /></div>
                <span className={`chip ${pct < 75 ? 'c-red' : 'c-green'}`}>{pct ? pct + '%' : '—'}</span>
              </div>
            </div>
          );
        })}
      </Card>

      {attLog?.courses?.length > 0 && (
        <Card title="Attendance log — day-wise" color="var(--cyan)"
          right={<span className="small muted">as of {new Date(attLog.updated).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>}>
          <div className="att-legend small muted">
            <span><span className="att-dot present" /> present</span>
            <span><span className="att-dot absent" /> absent</span>
            <span><span className="att-dot partial" /> partial</span>
          </div>
          {attLog.courses.map(c => (
            <div className="attlog-course" key={c.code}>
              <div className="spread" style={{ gap: 8, flexWrap: 'wrap' }}>
                <b style={{ fontWeight: 'normal' }}>{c.code} · <span className="muted small">{c.name}</span></b>
                <span className="flex" style={{ gap: 6 }}>
                  <span className="chip">{c.present}/{c.total} classes</span>
                  <span className={`chip ${c.pct < 75 ? 'c-red' : 'c-green'}`}>{c.pct}%</span>
                </span>
              </div>
              <div className="att-days">
                {c.records.map((r, i) => (
                  <span key={i} className={`att-day ${r.status}`} title={`${r.day} ${r.date} · ${r.status.toUpperCase()} · ${r.present}P / ${r.absent}A`}>
                    <span className="att-dnum">{r.date.slice(8)}</span>
                    <span className="att-dow">{r.day.slice(0, 3).toUpperCase()}</span>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </Card>
      )}

      <Card title="Announcements" color="var(--pink)">
        {annc.length === 0 && <Empty icon="!" text="Nothing yet." />}
        {annc.map(a => (
          <div className="row" key={a.id} style={{ alignItems: 'flex-start' }}>
            <span style={{ flex: 1 }}>
              <b style={{ fontWeight: 'normal' }}>{a.title}</b>
              {a.body && <div className="small muted">{a.body}</div>}
            </span>
            <span className="chip c-purple">{a.date}</span>
          </div>
        ))}
      </Card>

      <Card title="Weekly timetable" color="var(--purple)">
        <div className="scroll-x">
          <table className="ptable">
            <thead><tr><th>Day</th><th>Time</th><th>Subject</th><th>Room</th></tr></thead>
            <tbody>
              {timetable.map(t => (
                <tr key={t.id}><td>{t.day}</td><td>{t.start_time}–{t.end_time}</td><td>{t.subject}</td><td>{t.room || '—'}</td></tr>
              ))}
              {timetable.length === 0 && <tr><td colSpan={4} className="muted">Waiting for Amizone sync…</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
