import React from 'react';
import { freshnessNote, TONE } from '../lib/collegefresh.js';
import { useCollection } from '../lib/hooks.js';
import { Card, Empty, StatTile, RefreshButton } from '../components/ui.jsx';
import { DAYS, activeDay, dayLabel } from '../lib/schedule.js';
import WhatsAppImport from '../components/college/WhatsAppImport.jsx';
import { announcementLink } from '../lib/whatsapp.js';

// Amizone stores attendance as a fraction (0.81) OR a percent (81); normalize to %.
const attPct = raw => { const n = Number(raw) || 0; return n > 0 && n <= 1 ? Math.round(n * 1000) / 10 : n; };

export default function College() {
  const { items: timetable, refresh: rT } = useCollection('timetable', { order: 'start_time', asc: true });
  const { items: subjects, refresh: rS } = useCollection('subjects', { order: 'name', asc: true });
  const { items: annc, refresh: rA } = useCollection('announcements', { order: 'date' });
  const { items: logMem, refresh: rL } = useCollection('memory', { filter: 'key=eq.attendance_log', order: 'key' });
  const { items: syncMem } = useCollection('memory', { filter: 'key=eq.amizone_last_sync', order: 'key' });
  const { items: statusMem } = useCollection('memory', { filter: 'key=eq.sync_status', order: 'key' });
  const attLog = logMem?.[0]?.value;

  // How old everything on this screen is. The tab used to present three-week-old
  // attendance exactly as it presents today's — same numbers, same layout, same
  // confidence — with one small "as of" on one card. Attendance that has not
  // moved looks identical to attendance nobody recorded, so this cannot be left
  // for the reader to notice.
  const lastSync = syncMem?.[0]?.value?.at || attLog?.updated || null;
  const fresh = freshnessNote(lastSync, statusMem?.[0]?.value?.amizone);

  // after 9pm (and all day Sunday) this points at the next day instead of the spent one
  const viewDay = activeDay();
  const todayName = viewDay.name;
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

      {/* Above everything, not tucked beside one card. If the figures below are
          not current, that is the first thing to know about this screen — and
          the wording carries it as well as the colour, because a warning you
          have seen for three days stops registering as a colour first. */}
      <div className="col-fresh" style={{ borderColor: TONE[fresh.state], color: TONE[fresh.state] }}>
        {fresh.text}
      </div>
      <p className="tab-sub">Timetable, attendance & announcements — scraped from Amizone by Cowork.</p>

      <div className="tile-row">
        <StatTile label="Avg attendance" value={avgAtt != null ? `${avgAtt}%` : '—'}
          note={lowAtt.length ? `${lowAtt.length} subject(s) below 75%!` : 'all safe'}
          color={avgAtt != null && avgAtt < 75 ? 'var(--red)' : 'var(--green)'} />
        <StatTile label={viewDay.rolled ? `Classes ${viewDay.isTomorrow ? 'tomorrow' : todayName}` : 'Classes today'}
          value={timetable.filter(t => t.day === todayName).length} color="var(--cyan)" />
        <StatTile label="Announcements" value={annc.length} color="var(--pink)" />
      </div>

      <Card title={dayLabel(viewDay)} color="var(--cyan)">
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
        {annc.map(a => {
          // The link is read back out of the body rather than a column, because
          // announcements has no link column and adding one would need an ALTER
          // on a live database. Amizone rows benefit too: any body containing a
          // URL now gets a button it never had.
          const href = announcementLink(a);
          return (
            <div className="row" key={a.id} style={{ alignItems: 'flex-start' }}>
              <span style={{ flex: 1 }}>
                <b style={{ fontWeight: 'normal' }}>{a.title}</b>
                {a.body && <div className="small muted">{a.body}</div>}
              </span>
              {href && <a className="btn btn-sm btn-cyan" href={href} target="_blank" rel="noreferrer">open</a>}
              {a.source === 'whatsapp' && <span className="chip c-green">whatsapp</span>}
              <span className="chip c-purple">{a.date}</span>
            </div>
          );
        })}
      </Card>

      <WhatsAppImport />

      <Card title="Weekly timetable" color="var(--purple)">
        {timetable.length === 0 && <Empty icon="◷" text="Waiting for Amizone sync…" />}
        <div className="wtt-grid">
          {DAYS.map(day => {
            const rows = timetable.filter(t => t.day === day)
              .slice().sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)));
            if (!rows.length) return null;
            return (
              <div className={`wtt-day${day === todayName ? ' is-today' : ''}`} key={day}>
                <div className="wtt-head">
                  <span className="wtt-dot" />
                  <span className="wtt-name">{day}</span>
                  {day === todayName && <span className="chip c-cyan">{viewDay.rolled ? 'next' : 'today'}</span>}
                  <span className="wtt-count">{rows.length} class{rows.length > 1 ? 'es' : ''}</span>
                </div>
                <div className="wtt-classes">
                  {rows.map(t => (
                    <div className="wtt-class" key={t.id}>
                      <span className="chip c-cyan wtt-time">{t.start_time}–{t.end_time}</span>
                      <span className="wtt-subj">{t.subject}</span>
                      <span className="wtt-cmeta">
                        {t.room && <span className="chip">{t.room}</span>}
                        {t.faculty && <span className="chip c-purple">{t.faculty}</span>}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </>
  );
}
