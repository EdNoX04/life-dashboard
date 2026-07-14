import React, { useState } from 'react';
import HQ from './tabs/HQ.jsx';
import Todos from './tabs/Todos.jsx';
import Habits from './tabs/Habits.jsx';
import Goals from './tabs/Goals.jsx';
import Journal from './tabs/Journal.jsx';
import Movies from './tabs/Movies.jsx';
import College from './tabs/College.jsx';
import Calendar from './tabs/Calendar.jsx';
import Subjects from './tabs/Subjects.jsx';
import DSA from './tabs/DSA.jsx';
import Money from './tabs/Money.jsx';
import Health from './tabs/Health.jsx';
import News from './tabs/News.jsx';
import Builds from './tabs/Builds.jsx';
import Settings from './tabs/Settings.jsx';
import { BootScreen, PlayerCard } from './components/arcade.jsx';

const TABS = [
  ['hq', 'HQ', 'var(--pink)', HQ],
  ['calendar', 'Calendar', 'var(--cyan)', Calendar],
  ['todos', 'Todo', 'var(--yellow)', Todos],
  ['habits', 'Habits', 'var(--green)', Habits],
  ['goals', 'Goals', 'var(--purple)', Goals],
  ['college', 'College', 'var(--cyan)', College],
  ['dsa', 'DSA', 'var(--green)', DSA],
  ['subjects', 'Subjects', 'var(--orange)', Subjects],
  ['money', 'Money', 'var(--green)', Money],
  ['health', 'Health', 'var(--red)', Health],
  ['journal', 'Journal', 'var(--pink)', Journal],
  ['movies', 'Media', 'var(--purple)', Movies],
  ['news', 'News', 'var(--cyan)', News],
  ['builds', 'Builds', 'var(--yellow)', Builds],
  ['settings', 'Config', 'var(--ink-3)', Settings],
];

export default function App() {
  const [tab, setTab] = useState('hq');
  const Active = TABS.find(t => t[0] === tab)?.[3] || HQ;

  return (
    <div className="app crt">
      <BootScreen />
      <nav className="sidebar">
        <div className="logo">PLAYER<span>▮</span>ONE</div>
        {TABS.map(([id, label, color]) => (
          <div key={id} className={`nav-item ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>
            <span className="nav-dot" style={{ background: color }} />
            {label}
          </div>
        ))}
        <PlayerCard />
      </nav>
      <main className="main">
        <Active go={setTab} />
      </main>
    </div>
  );
}
