import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import LoginGate from './components/LoginGate.jsx';
import './theme.css';
import './arcade.css';
import { applyTheme, getTheme } from './lib/theme.js';

applyTheme(getTheme()); // set the saved color theme before first paint

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <LoginGate>
      <App />
    </LoginGate>
  </React.StrictMode>
);
