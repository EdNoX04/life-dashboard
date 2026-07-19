import React from 'react';
import { useCollection, todayStr } from '../lib/hooks.js';
import { Card, Empty, StatTile, AskCowork, useNow, useMoneyVisible, money } from '../components/ui.jsx';
import { Ticker, Sky, useDailySpark } from '../components/arcade.jsx';
import LiveStatus from '../components/LiveStatus.jsx';
import MiniCalendar from '../components/MiniCalendar.jsx';
import NextMeeting from '../components/NextMeeting.jsx';
import { useLiveQuotes } from '../lib/live.js';

const WD = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const briefPhase = h => (h < 17 ? 'morning' : h < 21 ? 'evening' : 'night');
const attPct = raw => { const n = Number(raw) || 0; return n > 0 && n <= 1 ? Math.round(n * 1000) / 10 : n; };

export default function HQ({ go }) {
  const now = useNow();
  const today = todayStr();
  const plus7 = todayStr(new Date(Date.now() + 7 * 864e5));

  const { items: briefs } = useCollection('briefs', { order: 'date' });
  const { items: todos } = useCollection('todos');
  const { items: habits } = useCollection('habits');
  const { items: logs } = useCollection('habit_logs');
  const { items: timetable } = useCollection('timetable', { order: 'start_time', asc: true });
  const { items: investments } = useCollection('investments');
  const { items: news } = useCollection('news', { order: 'published_at' });
  const { items: subjects } = useCollection('subjects');
  const { items: calMem } = useCollection('memory', { filter: 'key=eq.calendar_events', order: 'key' });
  const gEvents = calMem?.[0]?.value?.events || [];

  const brief = briefs.find(b => b.date === today) || briefs[0];
  const dayName = WD[now.getDay()];
  const isSchoolDay = now.getDay() !== 0; // classes Mon–Sat, hidden Sunday
  const openTodos = todos.filter(t => !t.completed && t.due_date && t.due_date <= today);
  const liveHabits = habits.filter(h => !h.archived);
  const habitsDone = liveHabits.filter(h => logs.some(l => l.habit_id === h.id && l.date === today)).length;
  const classes = timetable.filter(t => t.day === dayName);
  const [moneyVis, toggleMoney] = useMoneyVisible();
  const held = investments.filter(h => Number(h.qty) > 0);
  const { quotes } = useLiveQuotes(held.map(h => h.ticker));
  const pValue = held.reduce((s, h) => s + Number(h.qty) * Number(quotes[h.ticker]?.price ?? h.last_price ?? h.avg_cost ?? 0), 0);
  const pCost = held.reduce((s, h) => s + Number(h.qty) * Number(h.avg_cost || 0), 0);
  const pPct = pCost ? ((pValue - pCost) / pCost) * 100 : 0;

  const hour = now.getHours();
  const greet = hour < 5 ? 'STILL UP?' : hour < 12 ? 'GOOD MORNING' : hour < 17 ? 'GOOD AFTERNOON' : 'GOOD EVENING';
  const spark = useDailySpark();

  // ---- reminders: overdue tasks, attendance risk, upcoming due + events ----
  const reminders = [];
  todos.filter(t => !t.completed && t.due_date && t.due_date < today).slice(0, 3)
    .forEach(t => reminders.push({ icon: '⚠', text: t.title, chip: 'overdue', c: 'var(--red)', go: 'todos' }));
  subjects.filter(s => { const p = attPct(s.attendance_pct); return p > 0 && p < 75; })
    .forEach(s => reminders.push({ icon: '%', text: `${s.name} attendance low`, chip: `${attPct(s.attendance_pct)}%`, c: 'var(--red)', go: 'college' }));
  todos.filter(t => !t.completed && t.due_date && t.due_date >= today && t.due_date <= plus7)
    .sort((a, b) => a.due_date.localeCompare(b.due_date)).slice(0, 3)
    .forEach(t => reminders.push({ icon: '◷', text: t.title, chip: t.due_date === today ? 'today' : t.due_date, c: 'var(--yellow)', go: 'todos' }));
  gEvents.filter(e => { const d = (e.start || '').slice(0, 10); return d >= today && d <= plus7; })
    .sort((a, b) => (a.start || '').localeCompare(b.start || '')).slice(0, 3)
    .forEach(e => reminders.push({ icon: '★', text: e.summary || 'Event', chip: (e.start || '').slice(5, 10), c: 'var(--cyan)', go: 'calendar' }));

  // ---- time-aware brief body ----
  const phase = briefPhase(hour);
  const first = classes[0];
  const nextDay = WD[(now.getDay() + 1) % 7];
  const tmrwClasses = timetable.filter(t => t.day === nextDay).length;
  const doneToday = todos.filter(t => t.completed).length;
  const briefMeta = phase === 'morning' ? { t: "Today's brief", c: 'var(--yellow)' }
    : phase === 'evening' ? { t: 'This evening', c: 'var(--cyan)' } : { t: 'Tonight', c: 'var(--purple)' };

  const BriefCard = (
    <Card title={briefMeta.t} color={briefMeta.c}>
      {phase === 'morning' && (
        <>
          <div style={{ lineHeight: 1.6 }}>
            {isSchoolDay && classes.length ? `${classes.length} class${classes.length > 1 ? 'es' : ''} today${first ? ` — first is ${first.subject} at ${first.start_time}` : ''}. ` : isSchoolDay ? 'No classes on the timetable today. ' : 'Sunday — no classes. '}
            {openTodos.length ? `${openTodos.length} task${openTodos.length > 1 ? 's' : ''} due, ` : 'Nothing due, '}
            habits {habitsDone}/{liveHabits.length} done.
            {held.length ? ` Portfolio ${pPct >= 0 ? 'up' : 'down'} ${Math.abs(pPct).toFixed(1)}%.` : ''}
          </div>
          {brief && (brief.sections || []).length > 0 && (brief.sections || []).map((s, i) => (
            <div key={i} style={{ marginTop: 12 }}>
              <div className="card-title"><span className="sq" style={{ background: 'var(--purple)' }} />{s.title}</div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{s.body}</div>
            </div>
          ))}
        </>
      )}
      {phase === 'evening' && (
        <>
          <div style={{ lineHeight: 1.6, marginBottom: news.length ? 10 : 0 }}>
            {held.length ? `Markets: your portfolio is ${pPct >= 0 ? 'up' : 'down'} ${Math.abs(pPct).toFixed(1)}%. ` : ''}
            {openTodos.length ? `${openTodos.length} task${openTodos.length > 1 ? 's' : ''} still open. ` : 'Tasks clear. '}
            Tomorrow ({nextDay}): {tmrwClasses} class{tmrwClasses !== 1 ? 'es' : ''}.
          </div>
          {news.slice(0, 3).map(n => (
            <div className="row" key={n.id}><span style={{ flex: 1 }}><a href={n.url} target="_blank" rel="noreferrer" style={{ color: 'var(--ink)' }}>{n.title}</a></span><span className="chip c-purple">{n.category}</span></div>
          ))}
        </>
      )}
      {phase === 'night' && (
        <div style={{ lineHeight: 1.6 }}>
          {doneToday} task{doneToday !== 1 ? 's' : ''} done, habits {habitsDone}/{liveHabits.length}.
          {held.length ? ` Portfolio closed ${pPct >= 0 ? 'up' : 'down'} ${Math.abs(pPct).toFixed(1)}%.` : ''}
          {' '}Tomorrow ({nextDay}): {tmrwClasses} class{tmrwClasses !== 1 ? 'es' : ''} — {openTodos.length ? `${openTodos.length} carried over.` : 'clean slate.'}
        </div>
      )}
    </Card>
  );

  return (
    <>
      <div className="hero-wrap">
        <div className="hero">
          <Sky hour={now.getHours()} />
          <div className="world">WORLD {now.getMonth() + 1}-{now.getDate()} · {dayName.toUpperCase()}</div>
          <h1 className="tab-title" style={{ marginTop: 8 }}>{greet}, NEEL</h1>
          <p className="tab-sub" style={{ margin: 0 }}>{now.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })} · {now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</p>
        </div>
        <div className="hero-spark">
          <span className="hs-label">✦ DAILY SPARK</span>
          <span className="hs-q">“{spark.q}”</span>
          <span className="hs-a">— {spark.a}</span>
        </div>
        <LiveStatus className="hero-live" />
      </div>
      <Ticker />

      <div className="tile-row">
        <StatTile label="Due today" value={openTodos.length} note="tasks" color="var(--yellow)" />
        <StatTile label="Habits" value={`${habitsDone}/${liveHabits.length}`} note="done today" color="var(--green)" />
        {isSchoolDay
          ? <StatTile label="Classes" value={classes.length} note="today" color="var(--cyan)" />
          : <StatTile label="Reminders" value={reminders.length} note="to look at" color="var(--cyan)" />}
        <StatTile label="Portfolio" value={held.length ? money(pValue, moneyVis) : '—'}
          note={held.length ? <span onClick={toggleMoney} style={{ cursor: 'pointer', color: pPct >= 0 ? 'var(--green)' : 'var(--red)' }}>{pPct >= 0 ? '▲' : '▼'} {Math.abs(pPct).toFixed(2)}% · {moneyVis ? 'hide' : 'tap'}</span> : null}
          color="var(--pink)" />
      </div>

      <div className="dash-cols">
        <div className="dash-col">
          {BriefCard}

          <Card title="Priorities" color="var(--yellow)" right={<button className="btn btn-sm" onClick={() => go('todos')}>open →</button>}>
            {openTodos.length === 0 && <Empty icon="✓" text="Nothing due. Legend." />}
            {openTodos.slice(0, 6).map(t => (
              <div className="row" key={t.id}><span style={{ flex: 1 }}>{t.title}</span><span className="chip c-yellow">{t.due_date}</span></div>
            ))}
          </Card>

          <Card title="News brief" color="var(--purple)" right={<button className="btn btn-sm" onClick={() => go('news')}>all →</button>}>
            {news.length === 0 && <Empty icon="※" text="Headlines arrive with the daily run." />}
            {news.slice(0, 5).map(n => (
              <div className="row" key={n.id}><span style={{ flex: 1 }}><a href={n.url} target="_blank" rel="noreferrer" style={{ color: 'var(--ink)' }}>{n.title}</a></span><span className="chip c-purple">{n.category}</span></div>
            ))}
          </Card>
        </div>

        <div className="dash-col">
          <NextMeeting />

          <Card title="Reminders" color="var(--red)">
            {reminders.length === 0 && <Empty icon="✓" text="All clear — nothing needs your attention." />}
            {reminders.slice(0, 7).map((r, i) => (
              <div className="row" key={i} style={{ cursor: 'pointer' }} onClick={() => go(r.go)}>
                <span className="rem-ico" style={{ color: r.c }}>{r.icon}</span>
                <span style={{ flex: 1 }} className="small">{r.text}</span>
                <span className="chip" style={{ color: r.c, borderColor: r.c }}>{r.chip}</span>
              </div>
            ))}
          </Card>

          <MiniCalendar go={go} />

          {isSchoolDay && (
            <Card title="Today's classes" color="var(--cyan)" right={<button className="btn btn-sm" onClick={() => go('college')}>open →</button>}>
              {classes.length === 0 && <Empty icon="☺" text="No classes today — free roam." />}
              {classes.slice(0, 8).map(t => (
                <div className="row" key={t.id}>
                  <span className="chip c-cyan">{t.start_time}</span>
                  <span style={{ flex: 1 }}>{t.subject}</span>
                  {t.room && <span className="chip c-purple">{t.room}</span>}
                </div>
              ))}
            </Card>
          )}
        </div>
      </div>

      <AskCowork />
    </>
  );
}
