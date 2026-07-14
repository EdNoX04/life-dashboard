import React from 'react';
import { useCollection, todayStr } from '../lib/hooks.js';
import { Card, Empty, StatTile, AskCowork, useNow, useMoneyVisible, money } from '../components/ui.jsx';
import { Ticker, Sky, useDailySpark } from '../components/arcade.jsx';
import PortfolioChart from '../components/PortfolioChart.jsx';
import * as db from '../lib/db.js';

export default function HQ({ go }) {
  const now = useNow();
  const today = todayStr();
  const [orders, setOrders] = React.useState([]);
  React.useEffect(() => {
    db.list('memory', { filter: 'key=eq.stock_orders', order: 'key' })
      .then(rows => setOrders(rows?.[0]?.value?.orders || [])).catch(() => {});
  }, []);
  const { items: briefs } = useCollection('briefs', { order: 'date' });
  const { items: todos } = useCollection('todos');
  const { items: habits } = useCollection('habits');
  const { items: logs } = useCollection('habit_logs');
  const { items: timetable } = useCollection('timetable', { order: 'start_time', asc: true });
  const { items: investments } = useCollection('investments');
  const { items: news } = useCollection('news', { order: 'published_at' });

  const brief = briefs.find(b => b.date === today) || briefs[0];
  const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getDay()];
  const openTodos = todos.filter(t => !t.completed && t.due_date && t.due_date <= today);
  const liveHabits = habits.filter(h => !h.archived);
  const habitsDone = liveHabits.filter(h => logs.some(l => l.habit_id === h.id && l.date === today)).length;
  const classes = timetable.filter(t => t.day === dayName);
  const [moneyVis, toggleMoney] = useMoneyVisible();
  const held = investments.filter(h => Number(h.qty) > 0);
  const pValue = held.reduce((s, h) => s + Number(h.qty) * Number(h.last_price || h.avg_cost || 0), 0);
  const pCost = held.reduce((s, h) => s + Number(h.qty) * Number(h.avg_cost || 0), 0);
  const pPct = pCost ? ((pValue - pCost) / pCost) * 100 : 0;

  const hour = now.getHours();
  const greet = hour < 5 ? 'STILL UP?' : hour < 12 ? 'GOOD MORNING' : hour < 17 ? 'GOOD AFTERNOON' : 'GOOD EVENING';
  const spark = useDailySpark();

  return (
    <>
      <div className="hero">
        <Sky hour={now.getHours()} />
        <div className="world">WORLD {now.getMonth() + 1}-{now.getDate()} · {dayName.toUpperCase()}</div>
        <h1 className="tab-title" style={{ marginTop: 8 }}>{greet}, NEEL</h1>
        <p className="tab-sub" style={{ margin: 0 }}>{now.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })} · {now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</p>
        <div className="hero-spark">
          <span className="hs-label">✦ DAILY SPARK</span>
          <span className="hs-q">“{spark.q}”</span>
          <span className="hs-a">— {spark.a}</span>
        </div>
      </div>
      <Ticker />

      <div className="tile-row">
        <StatTile label="Due today" value={openTodos.length} note="tasks" color="var(--yellow)" />
        <StatTile label="Habits" value={`${habitsDone}/${liveHabits.length}`} note="done today" color="var(--green)" />
        <StatTile label="Classes" value={classes.length} note="today" color="var(--cyan)" />
        <StatTile label="Portfolio" value={held.length ? money(pValue, moneyVis) : '—'}
          note={held.length ? <span onClick={toggleMoney} style={{ cursor: 'pointer', color: pPct >= 0 ? 'var(--green)' : 'var(--red)' }}>{pPct >= 0 ? '▲' : '▼'} {Math.abs(pPct).toFixed(2)}% · {moneyVis ? 'hide' : 'tap to show'}</span> : null}
          color="var(--pink)" />
      </div>

      <Card title={`Morning brief — ${brief?.date || today}`} color="var(--pink)">
        {!brief && <Empty icon="☀" text="The brief lands here every morning once Cowork's daily run is connected. Meanwhile, everything below is live." />}
        {brief && (brief.sections || []).map((s, i) => (
          <div key={i} style={{ marginBottom: 12 }}>
            <div className="card-title"><span className="sq" style={{ background: 'var(--purple)' }} />{s.title}</div>
            <div style={{ whiteSpace: 'pre-wrap' }}>{s.body}</div>
          </div>
        ))}
      </Card>

      <div className="grid2">
        <Card title="Priorities" color="var(--yellow)" right={<button className="btn btn-sm" onClick={() => go('todos')}>open →</button>}>
          {openTodos.length === 0 && <Empty icon="✓" text="Nothing due. Legend." />}
          {openTodos.slice(0, 5).map(t => (
            <div className="row" key={t.id}>
              <span style={{ flex: 1 }}>{t.title}</span>
              <span className="chip c-yellow">{t.due_date}</span>
            </div>
          ))}
        </Card>

        <Card title="Today's classes" color="var(--cyan)" right={<button className="btn btn-sm" onClick={() => go('college')}>open →</button>}>
          {classes.length === 0 && <Empty icon="☺" text="No classes today — free roam." />}
          {classes.slice(0, 6).map(t => (
            <div className="row" key={t.id}>
              <span className="chip c-cyan">{t.start_time}</span>
              <span style={{ flex: 1 }}>{t.subject}</span>
              {t.room && <span className="chip c-purple">{t.room}</span>}
            </div>
          ))}
        </Card>
      </div>

      {held.length > 0 && (
        <Card title="Portfolio" color="var(--pink)" right={<button className="btn btn-sm" onClick={() => go('money')}>open →</button>}>
          <div className="spread" style={{ marginBottom: 6 }}>
            <span className="stat-value" style={{ fontSize: 16 }} onClick={toggleMoney}>{money(pValue, moneyVis)}</span>
            <span className="chip" style={{ color: pPct >= 0 ? 'var(--green)' : 'var(--red)', borderColor: pPct >= 0 ? 'var(--green)' : 'var(--red)' }}>{pPct >= 0 ? '▲' : '▼'} {Math.abs(pPct).toFixed(2)}%</span>
          </div>
          <PortfolioChart orders={orders} currentValue={pValue} visible={moneyVis} variant="mini" />
        </Card>
      )}

      <Card title="News brief" color="var(--purple)" right={<button className="btn btn-sm" onClick={() => go('news')}>all →</button>}>
        {news.length === 0 && <Empty icon="※" text="Headlines arrive with the daily run." />}
        {news.slice(0, 4).map(n => (
          <div className="row" key={n.id}>
            <span style={{ flex: 1 }}><a href={n.url} target="_blank" rel="noreferrer" style={{ color: 'var(--ink)' }}>{n.title}</a></span>
            <span className="chip c-purple">{n.category}</span>
          </div>
        ))}
      </Card>

      <AskCowork />
    </>
  );
}
