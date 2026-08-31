import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import LoginGate from './components/LoginGate.jsx';
import './theme.css';
import './arcade.css';
import { applyTheme, getTheme } from './lib/theme.js';
import { takeHandoff } from './lib/amizonecookie.js';

applyTheme(getTheme()); // set the saved color theme before first paint

// The Amizone bookmarklet lands here with the ticket in the fragment. Take it
// and scrub the address bar now — before React renders, before the login gate,
// before anything can screenshot or bookmark a URL with a session ticket in it.
// From here it lives in module memory until the Settings card files it.
takeHandoff();

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <LoginGate>
      <App />
    </LoginGate>
  </React.StrictMode>
);
