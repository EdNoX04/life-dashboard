// Retro color themes. Each recolors the whole app by overriding CSS variables
// via a data-theme attribute on <html> (see the [data-theme=…] blocks in theme.css).
// The choice persists in config (theme) and syncs across devices.
import { getConfig, setConfig } from './db.js';

export const THEMES = [
  { id: 'grape',  name: 'Neon Grape',     swatch: ['#ff5fa2', '#b967ff', '#4fd1ff'], note: 'default' },
  { id: 'amber',  name: 'Amber CRT',      swatch: ['#ffb347', '#ff8c42', '#ffd166'], note: 'warm terminal' },
  { id: 'matrix', name: 'Green Phosphor', swatch: ['#39ff14', '#28c76f', '#8affc1'], note: 'hacker green' },
  { id: 'ice',    name: 'Cyber Ice',      swatch: ['#48dbff', '#5b8cff', '#7defe0'], note: 'cool blue' },
  { id: 'synth',  name: 'Synthwave',      swatch: ['#ff2e97', '#b14bff', '#2de2e6'], note: 'retro sunset' },
];

export const DEFAULT_THEME = 'grape';

export function applyTheme(id) {
  const valid = THEMES.some(t => t.id === id) ? id : DEFAULT_THEME;
  try { document.documentElement.setAttribute('data-theme', valid); } catch {}
  return valid;
}

export function getTheme() {
  try { return getConfig().theme || DEFAULT_THEME; } catch { return DEFAULT_THEME; }
}

export function setTheme(id) {
  const valid = applyTheme(id);
  try { setConfig({ theme: valid }); } catch {}
  return valid;
}
