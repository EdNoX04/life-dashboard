import React, { useState, useEffect } from 'react';
import { useCollection, todayStr } from '../lib/hooks.js';
import { Card, Empty, StatTile, useNow, useMoneyVisible, money } from '../components/ui.jsx';
import { Ticker, Sky, useDailySpark } from '../components/arcade.jsx';
import LiveStatus from '../components/LiveStatus.jsx';
import RetroClock from '../components/RetroClock.jsx';
import MiniCalendar from '../components/MiniCalendar.jsx';
import NextMeeting from '../components/NextMeeting.jsx';
import MailStrip from '../components/MailStrip.jsx';
import { useLiveQuotes } from '../lib/live.js';
import { portfolioTotals } from '../lib/holdings.js';
import { currencyOf } from '../lib/indiabook.js';
import { fetchUsdInr } from '../lib/markets.js';
import { activeDay, ROLLOVER_HOUR } from '../lib/schedule.js';
import DashAllocation from '../components/money/DashAllocation.jsx';
import { studyReminders } from '../lib/exams.js';

const WD = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const briefPhase = h => (h < 17 ? 'morning' : h < 21 ? 'evening' : 'night');

// Column count by width: 3 on wide desktop, 2 on iPad (unchanged), 1 on phone.
const colsFor = w => (w >= 1500 ? 3 : w >= 901 ? 2 : 1);
function useDashCols() {
  const [n, setN] = useState(() => (typeof window === 'undefined' ? 2 : colsFor(window.innerWidth)));
  useEffect(() => {
    const on = () => setN(colsFor(window.innerWidth));
    on();
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return n;
}
const attPct = raw => { const n = Number(raw) || 0; return n > 0 && n <= 1 ? Math.round(n * 1000) / 10 : n; };

export default function HQ({ go }) {
  const cols = useDashCols();
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
  // after 9pm (and on Sunday) the timetable looks ahead instead of showing a spent day
  const viewDay = activeDay(now);
  const whenWord = viewDay.rolled ? (viewDay.isTomorrow ? 'tomorrow' : viewDay.name) : 'today';
  const openTodos = todos.filter(t => !t.completed && t.due_date && t.due_date <= today);
  const liveHabits = habits.filter(h => !h.archived);
  const habitsDone = liveHabits.filter(h => logs.some(l => l.habit_id === h.id && l.date === today)).length;
  const classes = timetable.filter(t => t.day === viewDay.name);
  const [moneyVis, toggleMoney] = useMoneyVisible();
  const held = investments.filter(h => Number(h.qty) > 0);
  // Needed to price the rupee holdings. Until it arrives they are excluded from
  // the total rather than counted at par - the tile says so below.
  const [fx, setFx] = useState(null);
  useEffect(() => { fetchUsdInr().then(setFx); }, []);
  const { quotes } = useLiveQuotes(held.map(h => h.ticker));
  // Same helper the Money tab uses. These two tiles used to compute the total
  // independently, and disagreed by exactly the rupee value of the GOLDBEES
  // position: this one multiplied qty by price with no currency check, so ₹122
  // a unit entered a dollar total as $122.
  const { value: pValue, pnlPct: pPct, excludedInr } = portfolioTotals(held, {
    priceOf: h => Number(quotes[h.ticker]?.price ?? h.last_price ?? h.avg_cost ?? 0),
    fx,
    currencyOf,
  });

  const hour = now.getHours();
  const greet = hour < 5 ? 'STILL UP?' : hour < 12 ? 'GOOD MORNING' : hour < 17 ? 'GOOD AFTERNOON' : 'GOOD EVENING';
  const spark = useDailySpark();

  // ---- reminders: overdue tasks, attendance risk, upcoming due + events ----
  const reminders = [];
  // First, and deliberately so. The card renders seven rows, and these are the
  // only entries whose deadline cannot be recovered: a missed Spanish FBL
  // module may never be attempted later, and an exam does not reschedule. They
  // come from lib/exams.js rather than from a todo, because they are fixed
  // university dates that nobody has to remember to type in.
  studyReminders(today).forEach(r => reminders.push(r));
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
  // "what's next" = the day after this one, unless we've already rolled over, in which
  // case viewDay IS the next day. Evaluating activeDay at the rollover hour skips Sundays.
  const lookAhead = viewDay.rolled ? viewDay
    : activeDay(new Date(now.getFullYear(), now.getMonth(), now.getDate(), ROLLOVER_HOUR));
  const nextDay = lookAhead.name;
  const tmrwClasses = viewDay.rolled ? classes.length : timetable.filter(t => t.day === nextDay).length;
  const doneToday = todos.filter(t => t.completed).length;
  const briefMeta = phase === 'morning' ? { t: "Today's brief", c: 'var(--yellow)' }
    : phase === 'evening' ? { t: 'This evening', c: 'var(--cyan)' } : { t: 'Tonight', c: 'var(--purple)' };

  const BriefCard = (
    <Card key="brief" title={briefMeta.t} color={briefMeta.c}>
      {phase === 'morning' && (
        <>
          <div style={{ lineHeight: 1.6 }}>
            {classes.length
              ? `${classes.length} class${classes.length > 1 ? 'es' : ''} ${whenWord}${first ? ` — first is ${first.subject} at ${first.start_time}` : ''}. `
              : `No classes on the timetable ${whenWord}. `}
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
            {lookAhead.isTomorrow ? 'Tomorrow' : 'Next up'} ({nextDay}): {tmrwClasses} class{tmrwClasses !== 1 ? 'es' : ''}.
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
          {' '}{lookAhead.isTomorrow ? 'Tomorrow' : 'Next up'} ({nextDay}): {tmrwClasses} class{tmrwClasses !== 1 ? 'es' : ''} — {openTodos.length ? `${openTodos.length} carried over.` : 'clean slate.'}
        </div>
      )}
    </Card>
  );

  const MeetingsCard = <NextMeeting key="meetings" />;
  // Mail sits directly under the next meeting because they answer the same
  // question — "is something about to want me?" — and splitting them across
  // columns means checking two places for one answer.
  const MailCard = <MailStrip key="mail" />;
  const CalendarCard = <MiniCalendar key="calendar" go={go} />;
  const RemindersCard = (
    <Card key="reminders" title="Reminders" color="var(--red)">
      {reminders.length === 0 && <Empty icon="✓" text="All clear — nothing needs your attention." />}
      {reminders.slice(0, 7).map((r, i) => (
        <div className="row" key={i} style={{ cursor: 'pointer' }} onClick={() => go(r.go)}>
          <span className="rem-ico" style={{ color: r.c }}>{r.icon}</span>
          <span style={{ flex: 1 }} className="small">{r.text}</span>
          <span className="chip" style={{ color: r.c, borderColor: r.c }}>{r.chip}</span>
        </div>
      ))}
    </Card>
  );
  const PrioritiesCard = (
    <Card key="priorities" title="Priorities" color="var(--yellow)" right={<button className="btn btn-sm" onClick={() => go('todos')}>open →</button>}>
      {openTodos.length === 0 && <Empty icon="✓" text="Nothing due. Legend." />}
      {openTodos.slice(0, 6).map(t => (
        <div className="row" key={t.id}><span style={{ flex: 1 }}>{t.title}</span><span className="chip c-yellow">{t.due_date}</span></div>
      ))}
    </Card>
  );
  const NewsCard = (
    <Card key="news" title="News brief" color="var(--purple)" right={<button className="btn btn-sm" onClick={() => go('news')}>all →</button>}>
      {news.length === 0 && <Empty icon="※" text="Headlines arrive with the daily run." />}
      {news.slice(0, 5).map(n => (
        <div className="row" key={n.id}><span style={{ flex: 1 }}><a href={n.url} target="_blank" rel="noreferrer" style={{ color: 'var(--ink)' }}>{n.title}</a></span><span className="chip c-purple">{n.category}</span></div>
      ))}
    </Card>
  );
  const ClassesCard = (
    <Card key="classes" title={viewDay.rolled ? `Classes ${whenWord}` : "Today's classes"} color="var(--cyan)" right={<button className="btn btn-sm" onClick={() => go('college')}>open →</button>}>
      {classes.length === 0 && <Empty icon="☺" text={`No classes ${whenWord} — free roam.`} />}
      {classes.slice(0, 8).map(t => (
        <div className="row" key={t.id}>
          <span className="chip c-cyan">{t.start_time}</span>
          <span style={{ flex: 1 }}>{t.subject}</span>
          {t.room && <span className="chip c-purple">{t.room}</span>}
        </div>
      ))}
    </Card>
  );

  // The ring is handed the quotes the Portfolio tile above it was priced with, so
  // the two can never disagree about what a share is worth. It reads the deposits,
  // bonds and crypto itself, because those are the parts the tile does NOT count —
  // which is exactly why the ring is worth having next to it.
  const AllocationCard = (
    <DashAllocation key="alloc" held={held} quotes={quotes} moneyVis={moneyVis}
      cur="$" fx={fx} onOpen={() => go('money')} />
  );

  // Same cards, grouped by column count. 2-col grouping is the original iPad layout.
  const cardMap = { brief: BriefCard, meetings: MeetingsCard, mail: MailCard, reminders: RemindersCard, priorities: PrioritiesCard, calendar: CalendarCard, news: NewsCard, classes: ClassesCard, alloc: AllocationCard };
  const LAYOUTS = {
    1: [['brief', 'meetings', 'mail', 'reminders', 'priorities', 'alloc', 'calendar', 'news', 'classes']],
    2: [['brief', 'priorities', 'alloc', 'news'], ['meetings', 'mail', 'reminders', 'calendar', 'classes']],
    3: [['brief', 'news'], ['meetings', 'mail', 'priorities', 'alloc'], ['reminders', 'calendar', 'classes']],
  };
  const layout = LAYOUTS[cols] || LAYOUTS[2];
  const gtc = cols === 3 ? '1.15fr 1fr 1fr' : cols === 2 ? '1.35fr 1fr' : '1fr';

  return (
    <>
      <div className="hero-wrap">
        {/* .hero-board exists only to be the spark's positioning context. The
            spark cannot live inside .hero (which is overflow:hidden, to clip
            the sky) and it must not anchor to .hero-wrap either, because
            .hero-live sits in the wrap's flow below the hero and grows it —
            which is exactly how the spark ended up beside the Awake pill
            instead of in the hero's bottom-right corner. .hero-board hugs the
            hero and nothing else, so bottom:12px means what it says. */}
        <div className="hero-board">
        <div className="hero">
          <Sky hour={now.getHours()} />
          <div className="world">WORLD {now.getMonth() + 1}-{now.getDate()} · {dayName.toUpperCase()}</div>
          <h1 className="tab-title" style={{ marginTop: 8 }}>{greet}, NEEL</h1>
          <p className="tab-sub" style={{ margin: 0 }}>{now.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })} · {now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })}</p>
          <RetroClock />
        </div>
          <div className="hero-spark">
            <span className="hs-label">✦ DAILY SPARK</span>
            <span className="hs-q">“{spark.q}”</span>
            <span className="hs-a">— {spark.a}</span>
          </div>
        </div>
        <LiveStatus className="hero-live" />
      </div>
      <Ticker />

      <div className="tile-row">
        <StatTile label="Due today" value={openTodos.length} note="tasks" color="var(--yellow)" />
        <StatTile label="Habits" value={`${habitsDone}/${liveHabits.length}`} note="done today" color="var(--green)" />
        <StatTile label="Classes" value={classes.length} note={whenWord} color="var(--cyan)" />
        <StatTile label="Portfolio" value={held.length ? money(pValue, moneyVis) : '—'}
          note={held.length ? <span onClick={toggleMoney} style={{ cursor: 'pointer', color: pPct >= 0 ? 'var(--green)' : 'var(--red)' }}>{pPct >= 0 ? '▲' : '▼'} {Math.abs(pPct).toFixed(2)}% · {moneyVis ? 'hide' : 'tap'}</span> : null}
          color="var(--pink)" />
      </div>

      <div className="dash-cols" style={{ gridTemplateColumns: gtc }}>
        {layout.map((col, i) => (
          <div className="dash-col" key={i}>
            {col.map(k => cardMap[k]).filter(Boolean)}
          </div>
        ))}
      </div>

      {/* The in-tab assistant is gone. PLAYER TWO is mounted at the app root and
          follows you across tabs, so keeping a second copy here meant two chat
          windows on this screen with separate histories and the same job. */}
    </>
  );
}
