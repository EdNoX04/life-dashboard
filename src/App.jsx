import React, { useEffect, useState } from 'react';
import { syncPullConfig } from './lib/db.js';
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
import Study from './tabs/Study.jsx';
import Placement, { PLACEMENT_EXPIRY } from './tabs/Placement.jsx';
import Books from './tabs/Books.jsx';
import Notes from './tabs/Notes.jsx';
import Decision from './tabs/Decision.jsx';
import Daily, { dailyMeta } from './tabs/Daily.jsx';
import Money from './tabs/Money.jsx';
import Health from './tabs/Health.jsx';
import Nutrition from './tabs/Nutrition.jsx';
import Sleep from './tabs/Sleep.jsx';
import Music from './tabs/Music.jsx';
import News from './tabs/News.jsx';
import Builds from './tabs/Builds.jsx';
import Settings from './tabs/Settings.jsx';
import { BootScreen, PlayerCard } from './components/arcade.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';

// retro glyph per tab (rendered in a pixel frame, replaces the plain colour dot)
const ICONS = {
  hq: '⌂', daily: '☀', calendar: '▦', todos: '✎', habits: '✦', goals: '◎',
  college: '⌆', placement: '★', dsa: '⬡', study: '❐', subjects: '≣', notes: '✐',
  books: '❏', decision: '⟐', money: '$', health: '♥', nutrition: '◍', sleep: '☾',
  journal: '✒', music: '♫', movies: '▶', news: '❋', builds: '⚒', settings: '⚙',
};

const TABS = [
  ['hq', 'HOME', 'var(--pink)', HQ],
  ['daily', 'Brief', 'var(--yellow)', Daily],
  ['calendar', 'Calendar', 'var(--cyan)', Calendar],
  ['todos', 'Todo', 'var(--yellow)', Todos],
  ['habits', 'Habits', 'var(--green)', Habits],
  ['goals', 'Goals', 'var(--purple)', Goals],
  ['college', 'College', 'var(--cyan)', College],
  ['placement', 'Placement', 'var(--yellow)', Placement],
  ['dsa', 'DSA', 'var(--green)', DSA],
  ['study', 'Study', 'var(--yellow)', Study],
  ['subjects', 'Subjects', 'var(--orange)', Subjects],
  ['notes', 'Notes', 'var(--cyan)', Notes],
  ['books', 'Books', 'var(--pink)', Books],
  ['decision', 'Decision', 'var(--purple)', Decision],
  ['money', 'Money', 'var(--green)', Money],
  ['health', 'Health', 'var(--red)', Health],
  ['nutrition', 'Body', 'var(--cyan)', Nutrition],
  ['sleep', 'Sleep', 'var(--purple)', Sleep],
  ['journal', 'Journal', 'var(--pink)', Journal],
  ['music', 'Music', 'var(--pink)', Music],
  ['movies', 'Media', 'var(--purple)', Movies],
  ['news', 'News', 'var(--cyan)', News],
  ['builds', 'Builds', 'var(--yellow)', Builds],
  ['settings', 'Config', 'var(--ink-3)', Settings],
];

export default function App() {
  const [tab, setTab] = useState('hq');
  const [clickId, setClickId] = useState(null); // drives the click-press animation
  // Placement is a temporary tab — drop it automatically once the season's over.
  const tabs = TABS.filter(t => t[0] !== 'placement' || new Date() < PLACEMENT_EXPIRY);
  const Active = tabs.find(t => t[0] === tab)?.[3] || HQ;

  // the "daily" tab relabels + recolours itself with the clock (Brief / News / Night)
  const dm = dailyMeta(new Date().getHours());

  // on load, pull synced keys (market data etc.) set on any other device
  useEffect(() => {
    syncPullConfig().then(changed => { if (changed) window.dispatchEvent(new Event('ldx-config-synced')); });
  }, []);

  function pick(id) {
    setClickId(id);
    setTab(id);
    setTimeout(() => setClickId(null), 260);
  }

  return (
    <div className="app crt">
      <BootScreen />
      <nav className="sidebar">
        <div className="logo">PLAYER<span>▮</span>ONE</div>
        <div className="nav-scroll">
          {tabs.map(([id, label, color]) => {
            const isDaily = id === 'daily';
            const ico = isDaily ? dm.icon : (ICONS[id] || '◆');
            const col = isDaily ? dm.color : color;
            const lbl = isDaily ? dm.label : label;
            return (
              <div key={id}
                className={`nav-item ${tab === id ? 'active' : ''} ${clickId === id ? 'clicked' : ''}`}
                onClick={() => pick(id)}>
                <span className="nav-ico" style={{ color: col, borderColor: col }}>{ico}</span>
                {lbl}
              </div>
            );
          })}
        </div>
        <PlayerCard />
      </nav>
      <main className="main">
        <ErrorBoundary key={tab}>
          <Active go={setTab} />
        </ErrorBoundary>
      </main>
    </div>
  );
}
