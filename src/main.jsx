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

// Register the service worker.
//
// It caches nothing — see public/sw.js for why that is deliberate. Its whole job
// is to make notifications possible on iOS, where the `Notification` constructor
// does not exist and `registration.showNotification()` is the only route, and to
// make clicking a notification focus the app instead of doing nothing.
//
// After render, and failing silently: a browser that refuses to register one
// (private windows, older Safari, an insecure origin) should lose notifications
// on that device, not the dashboard.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* notifications only */ });
  });
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <LoginGate>
      <App />
    </LoginGate>
  </React.StrictMode>
);
