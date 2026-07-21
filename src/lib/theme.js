// Retro color themes. Each recolors the whole app by overriding CSS variables
// via a data-theme attribute on <html> (see the [data-theme=…] blocks in theme.css).
// The choice persists in config (theme) and syncs across devices.
import { getConfig, setConfig } from './db.js';

export const THEMES = [
  // ---- normal ----
  { id: 'grape',   name: 'Neon Grape',     cat: 'normal', swatch: ['#ff5fa2', '#b967ff', '#4fd1ff'], note: 'default' },
  { id: 'amber',   name: 'Amber CRT',      cat: 'normal', swatch: ['#ffb347', '#ff8c42', '#ffd166'], note: 'warm terminal' },
  { id: 'matrix',  name: 'Green Phosphor', cat: 'normal', swatch: ['#39ff14', '#28c76f', '#8affc1'], note: 'hacker green' },
  { id: 'ice',     name: 'Cyber Ice',      cat: 'normal', swatch: ['#48dbff', '#5b8cff', '#7defe0'], note: 'cool blue' },
  { id: 'synth',   name: 'Synthwave',      cat: 'normal', swatch: ['#ff2e97', '#b14bff', '#2de2e6'], note: 'retro sunset' },
  { id: 'retro70', name: 'Retro 70s',      cat: 'normal', swatch: ['#e76219', '#fea712', '#c21717'], note: 'disco stripes' },
  { id: 'vintage', name: 'Vintage Vinyl',  cat: 'normal', swatch: ['#dfa05d', '#ac5045', '#658761'], note: 'american retro' },
  // ---- seasonal (special) ----
  { id: 'spring',  name: 'Spring Bloom',   cat: 'season', swatch: ['#f2729a', '#7bb765', '#ffd76a'], note: 'fresh greens' },
  { id: 'summer',  name: 'Summer Tropics', cat: 'season', swatch: ['#f2725b', '#2fbfa8', '#ffe86a'], note: 'sun & sea' },
  { id: 'autumn',  name: 'Autumn Rust',    cat: 'season', swatch: ['#d36228', '#daa520', '#8a8a3a'], note: 'fall leaves' },
  { id: 'winter',  name: 'Winter Frost',   cat: 'season', swatch: ['#7fb5ff', '#6fe0e0', '#c9d8ec'], note: 'icy blue' },
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
