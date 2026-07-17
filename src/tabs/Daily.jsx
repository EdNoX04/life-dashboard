import React from 'react';
import { useCollection, todayStr } from '../lib/hooks.js';
import { Card, Empty, StatTile, EyeBtn, useNow, useMoneyVisible, money } from '../components/ui.jsx';
import { useLiveQuotes } from '../lib/live.js';

// Time-of-day surface. One tab whose whole content swaps with the clock:
//   before 17:00  → MORNING BRIEF (what today holds)
//   17:00–21:00   → NEWS (markets + college + headlines)
//   21:00 onward  → NIGHT (wind-down: portfolio + health recap)
// All data is pulled live so it's never stale.
export function dailyPhase(hour) {
  if (hour < 17) return 'morning';
  if (hour < 21) return 'news';
  return 'night';
}
export function dailyMeta(hour) {
  const p = dailyPhase(hour);
  return p === 'morning' ? { label: 'Brief', icon: '☀', color: 'var(--yellow)' }
    : p === 'news' ? { label: 'News', icon: '📰', color: 'var(--cyan)' }
    : { label: 'Night', icon: '☾', color: 'var(--purple)' };
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function usePortfolio() {
  const { items: investments } = useCollection('investments');
  const held = investments.filter(h => Number(h.qty) > 0);
  const { quotes } = useLiveQuotes(held.map(h => h.ticker));
  const value = held.reduce((s, h) => s + Number(h.qty) * Number(quotes[h.ticker]?.price ?? h.last_price ?? h.avg_cost ?? 0), 0);
  const cost = held.reduce((s, h) => s + Number(h.qty) * Number(h.avg_cost || 0), 0);
  const pct = cost ? ((value - cost) / cost) * 100 : 0;
  return { held, value, pct };
}

function PortfolioLine() {
  const { held, value, pct } = usePortfolio();
  const [vis, toggle] = useMoneyVisible();
  if (!held.length) return null;
  return (
    <Card title="Markets — your portfolio" color="var(--green)" right={<EyeBtn visible={vis} onClick={toggle} />}>
      <div className="spread">
        <span className="stat-value" style={{ fontSize: 16, cursor: 'pointer' }} onClick={toggle}>{money(value, vis)}</span>
        <span className="chip" style={{ color: pct >= 0 ? 'var(--green)' : 'var(--red)', borderColor: pct >= 0 ? 'var(--green)' : 'var(--red)' }}>{pct >= 0 ? '▲' : '▼'} {Math.abs(pct).toFixed(2)}%</span>
      </div>
    </Card>
  );
}

export default function Daily({ go }) {
  const now = useNow();
  const hour = now.getHours();
  const phase = dailyPhase(hour);
  const today = todayStr();
  const dayName = DAYS[now.getDay()];

  const { items: briefs } = useCollection('briefs', { order: 'date' });
  const { items: todos } = useCollection('todos');
  const { items: habits } = useCollection('habits');
  const { items: logs } = useCollection('habit_logs');
  const { items: timetable } = useCollection('timetable', { order: 'start_time', asc: true });
  const { items: news } = useCollection('news', { order: 'published_at' });
  const { items: annc } = useCollection('announcements', { order: 'date' });

  const brief = briefs.find(b => b.date === today);
  const classes = timetable.filter(t => t.day === dayName);
  const openTodos = todos.filter(t => !t.completed && t.due_date && t.due_date <= today);
  const liveHabits = habits.filter(h => !h.archived);
  const habitsDone = liveHabits.filter(h => logs.some(l => l.habit_id === h.id && l.date === today)).length;

  const stockNews = news.filter(n => n.category === 'stocks');
  const otherNews = news.filter(n => n.category !== 'stocks');

  const timeStr = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  const dateStr = now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

  // ---------------- MORNING ----------------
  if (phase === 'morning') {
    return (
      <>
        <h1 className="tab-title">MORNING BRIEF</h1>
        <p className="tab-sub">{dateStr} · {timeStr} — everything today holds, live.</p>

        <div className="tile-row">
          <StatTile label="Classes" value={classes.length} note="today" color="var(--cyan)" />
          <StatTile label="Due" value={openTodos.length} note="tasks" color="var(--yellow)" />
          <StatTile label="Habits" value={`${habitsDone}/${liveHabits.length}`} note="done" color="var(--green)" />
        </div>

        {brief && (brief.sections || []).length > 0 && (
          <Card title="Today's brief" color="var(--pink)">
            {(brief.sections || []).map((s, i) => (
              <div key={i} style={{ marginBottom: 12 }}>
                <div className="card-title"><span className="sq" style={{ background: 'var(--purple)' }} />{s.title}</div>
                <div style={{ whiteSpace: 'pre-wrap' }}>{s.body}</div>
              </div>
            ))}
          </Card>
        )}

        <div className="grid2">
          <Card title="Today's classes" color="var(--cyan)" right={<button className="btn btn-sm" onClick={() => go('college')}>open →</button>}>
            {classes.length === 0 && <Empty icon="☺" text={timetable.length ? 'No classes today — free roam.' : 'Timetable not posted yet — it fills in automatically once college publishes it.'} />}
            {classes.map(t => (
              <div className="row" key={t.id}>
                <span className="chip c-cyan">{t.start_time}</span>
                <span style={{ flex: 1 }}>{t.subject}</span>
                {t.room && <span className="chip c-purple">{t.room}</span>}
              </div>
            ))}
          </Card>
          <Card title="Priorities" color="var(--yellow)" right={<button className="btn btn-sm" onClick={() => go('todos')}>open →</button>}>
            {openTodos.length === 0 && <Empty icon="✓" text="Nothing due. Legend." />}
            {openTodos.slice(0, 6).map(t => (
              <div className="row" key={t.id}><span style={{ flex: 1 }}>{t.title}</span><span className="chip c-yellow">{t.due_date}</span></div>
            ))}
          </Card>
        </div>

        <PortfolioLine />

        <Card title="Headlines" color="var(--purple)" right={<button className="btn btn-sm" onClick={() => go('news')}>all →</button>}>
          {news.length === 0 && <Empty icon="※" text="Headlines arrive with the daily run." />}
          {news.slice(0, 4).map(n => (
            <div className="row" key={n.id}><span style={{ flex: 1 }}><a href={n.url} target="_blank" rel="noreferrer" style={{ color: 'var(--ink)' }}>{n.title}</a></span><span className="chip c-purple">{n.category}</span></div>
          ))}
        </Card>
      </>
    );
  }

  // ---------------- NEWS (5–9pm) ----------------
  if (phase === 'news') {
    return (
      <>
        <h1 className="tab-title">EVENING · NEWS</h1>
        <p className="tab-sub">{timeStr} — markets, your holdings, and college, in one place.</p>

        <PortfolioLine />

        <Card title="Your stocks — news" color="var(--pink)" right={<button className="btn btn-sm" onClick={() => go('money')}>money →</button>}>
          {stockNews.length === 0 && <Empty icon="※" text="No holdings news right now — updates through the day." />}
          {stockNews.slice(0, 6).map(n => (
            <div className="row" key={n.id} style={{ alignItems: 'flex-start' }}>
              <span style={{ flex: 1 }}><a href={n.url} target="_blank" rel="noreferrer" style={{ color: 'var(--ink)' }}>{n.title}</a>{n.summary && <div className="small muted">{n.summary}</div>}</span>
              <span className="chip c-cyan">{n.source}</span>
            </div>
          ))}
        </Card>

        <Card title="College — announcements" color="var(--cyan)" right={<button className="btn btn-sm" onClick={() => go('college')}>college →</button>}>
          {annc.length === 0 && <Empty icon="!" text="Nothing new from college." />}
          {annc.slice(0, 5).map(a => (
            <div className="row" key={a.id} style={{ alignItems: 'flex-start' }}>
              <span style={{ flex: 1 }}><b style={{ fontWeight: 'normal' }}>{a.title}</b>{a.body && <div className="small muted">{a.body}</div>}</span>
              <span className="chip c-purple">{a.date}</span>
            </div>
          ))}
        </Card>

        <Card title="Finance & tech" color="var(--purple)" right={<button className="btn btn-sm" onClick={() => go('news')}>all →</button>}>
          {otherNews.length === 0 && <Empty icon="※" text="Headlines arrive with the daily run." />}
          {otherNews.slice(0, 6).map(n => (
            <div className="row" key={n.id}><span style={{ flex: 1 }}><a href={n.url} target="_blank" rel="noreferrer" style={{ color: 'var(--ink)' }}>{n.title}</a></span><span className="chip c-purple">{n.category}</span></div>
          ))}
        </Card>
      </>
    );
  }

  // ---------------- NIGHT (9pm+) ----------------
  return (
    <>
      <h1 className="tab-title">NIGHT</h1>
      <p className="tab-sub">{timeStr} — wind down. Where today landed, and what tomorrow needs.</p>

      <PortfolioLine />

      <div className="tile-row">
        <StatTile label="Tasks done" value={todos.filter(t => t.completed).length} note="all-time" color="var(--green)" />
        <StatTile label="Habits today" value={`${habitsDone}/${liveHabits.length}`} color="var(--yellow)" />
        <StatTile label="Classes tmrw" value={timetable.filter(t => t.day === DAYS[(now.getDay() + 1) % 7]).length} note={DAYS[(now.getDay() + 1) % 7]} color="var(--cyan)" />
      </div>

      <Card title="Body & recovery" color="var(--red)" right={<button className="btn btn-sm" onClick={() => go('health')}>health →</button>}>
        <Empty icon="☾" text="Tonight's wind-down panel — workout done, food macros, resting heart rate, biological age, sleep needed & sleep debt — lights up once the Health tab is built out (next up after this batch). The layout's here and ready for the data." />
        <div className="tile-row" style={{ marginTop: 10, marginBottom: 0, opacity: .55 }}>
          <StatTile label="Sleep need" value="—" note="target" color="var(--purple)" />
          <StatTile label="Sleep debt" value="—" note="rolling" color="var(--red)" />
          <StatTile label="Bio age" value="—" note="est." color="var(--cyan)" />
        </div>
      </Card>

      <Card title="Set tomorrow up" color="var(--yellow)" right={<button className="btn btn-sm" onClick={() => go('todos')}>todos →</button>}>
        {openTodos.length === 0 && <Empty icon="✓" text="Nothing carried over. Clean slate." />}
        {openTodos.slice(0, 6).map(t => (
          <div className="row" key={t.id}><span style={{ flex: 1 }}>{t.title}</span><span className="chip c-yellow">{t.due_date}</span></div>
        ))}
      </Card>
    </>
  );
}
