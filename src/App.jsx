import React, { useEffect, useState } from 'react';
import PlayerTwo from './components/PlayerTwo.jsx';
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
import Flights from './tabs/Flights.jsx';
import Meetings from './tabs/Meetings.jsx';
import Placement from './tabs/Placement.jsx';
import Books from './tabs/Books.jsx';
import Notes from './tabs/Notes.jsx';
import Decision from './tabs/Decision.jsx';
import Money from './tabs/Money.jsx';
import Health from './tabs/Health.jsx';
import Nutrition from './tabs/Nutrition.jsx';
import Sleep from './tabs/Sleep.jsx';
import Music from './tabs/Music.jsx';
import News from './tabs/News.jsx';
import Builds from './tabs/Builds.jsx';
import Settings from './tabs/Settings.jsx';
import { BootScreen, PlayerCard } from './components/arcade.jsx';
import NavIcon from './components/NavIcons.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import MiniPlayer from './components/MiniPlayer.jsx';

// retro glyph per tab (rendered in a pixel frame, replaces the plain colour dot)
const TABS = [
  ['hq', 'HOME', 'var(--pink)', HQ],
  ['calendar', 'Calendar', 'var(--cyan)', Calendar],
  ['todos', 'Todo', 'var(--yellow)', Todos],
  ['habits', 'Habits', 'var(--green)', Habits],
  ['goals', 'Goals', 'var(--purple)', Goals],
  ['college', 'College', 'var(--cyan)', College],
  ['placement', 'Placement', 'var(--yellow)', Placement],
  ['dsa', 'DSA', 'var(--green)', DSA],
  ['study', 'Study', 'var(--yellow)', Study],
  ['flights', 'Flights', 'var(--cyan)', Flights],
  ['meetings', 'Meetings', 'var(--orange)', Meetings],
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
  ['settings', 'Settings', 'var(--ink-3)', Settings],
];

export default function App() {
  const [tab, setTab] = useState('hq');
  const [clickId, setClickId] = useState(null); // drives the click-press animation
  // Placement is a temporary tab — drop it automatically once the season's over.
  const tabs = TABS;
  const Active = tabs.find(t => t[0] === tab)?.[3] || HQ;

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
          {tabs.map(([id, label, color]) => (
            <div key={id}
              className={`nav-item ${tab === id ? 'active' : ''} ${clickId === id ? 'clicked' : ''}`}
              onClick={() => pick(id)}>
              <span className="nav-ico"><NavIcon id={id} color={color} /></span>
              {label}
            </div>
          ))}
        </div>
        <MiniPlayer />
        <PlayerCard />
      </nav>
      <main className="main">
        <ErrorBoundary key={tab}>
          <Active go={setTab} />
        </ErrorBoundary>
      </main>
      {/* At the root, not inside a tab: an assistant that disappears when you
          navigate is a widget, not a partner. The thread survives the move —
          including across Money and Media, where it renders nothing because
          LEDGER and Ally own those screens (see lib/assistants.js). Passing the
          tab rather than mounting conditionally is what keeps the thread alive
          while the dock is away. */}
      <PlayerTwo tab={tab} />
    </div>
  );
}
