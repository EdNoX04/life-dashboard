import { useEffect, useState } from 'react';

// Ambient sound engine — real field-recording loops (Moodist, CC-licensed) streamed
// from the jsDelivr CDN, decoded via Web Audio for seamless looping + per-sound and
// master volume. Natural, not synthesized.

const CDN = 'https://cdn.jsdelivr.net/gh/remvze/moodist@main/public/sounds/';
export const SOUNDS = {
  rain: { label: 'Rain', icon: '🌧', url: CDN + 'rain/light-rain.mp3' },
  thunder: { label: 'Thunder', icon: '⛈', url: CDN + 'rain/thunder.mp3' },
  fire: { label: 'Fireplace', icon: '🔥', url: CDN + 'nature/campfire.mp3' },
  wind: { label: 'Wind', icon: '🌬', url: CDN + 'nature/wind.mp3' },
  forest: { label: 'Forest', icon: '🌲', url: CDN + 'nature/jungle.mp3' },
  waves: { label: 'Ocean', icon: '🌊', url: CDN + 'nature/waves.mp3' },
  river: { label: 'River', icon: '🏞', url: CDN + 'nature/river.mp3' },
  cafe: { label: 'Café', icon: '☕', url: CDN + 'places/cafe.mp3' },
  night: { label: 'Crickets', icon: '🦗', url: CDN + 'animals/crickets.mp3' },
  birds: { label: 'Birds', icon: '🐦', url: CDN + 'animals/birds.mp3' },
  noise: { label: 'Brown noise', icon: '📻', url: CDN + 'noise/brown-noise.wav' },
};

let ctx = null, master = null;
let masterVol = 0.6;       // remembered even before the audio context exists
const active = new Map();  // key -> { stop() } | 'loading'
const cache = new Map();   // url -> Promise<AudioBuffer>

// This engine is module-level, so sound survives tab switches. These let the UI
// (the Study/Sleep grids and the sidebar mini player) read that shared state.
const subs = new Set();
const emit = () => { for (const f of [...subs]) f(); };
export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }
export function activeKeys() { return [...active.keys()]; }
export function anyOn() { return active.size > 0; }
export function masterVolume() { return masterVol; }

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = masterVol; master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}
export function setMasterVolume(v) {
  masterVol = Math.max(0, Math.min(1, v));
  if (master) master.gain.value = masterVol;
  emit();
}

function getBuffer(url) {
  if (cache.has(url)) return cache.get(url);
  const c = ac();
  const p = fetch(url).then(r => r.arrayBuffer()).then(a => c.decodeAudioData(a));
  cache.set(url, p);
  return p;
}

export async function start(key) {
  if (active.has(key)) return;
  const s = SOUNDS[key]; if (!s) return;
  active.set(key, 'loading'); emit();
  try {
    const c = ac();
    const buf = await getBuffer(s.url);
    if (!active.has(key)) return; // toggled off while loading
    const src = c.createBufferSource(); src.buffer = buf; src.loop = true;
    const g = c.createGain(); g.gain.value = 0.9;
    src.connect(g); g.connect(master); src.start();
    active.set(key, { stop() { try { src.stop(); } catch {} try { g.disconnect(); } catch {} } });
    emit();
  } catch { active.delete(key); emit(); }
}
export function stop(key) { const a = active.get(key); if (a && a.stop) a.stop(); active.delete(key); emit(); }
export function toggle(key) { if (active.has(key)) { stop(key); return false; } start(key); return true; }
export function stopAll() { for (const k of [...active.keys()]) stop(k); }
export function isOn(key) { return active.has(key); }

// React binding — re-renders whenever the shared mix changes.
export function useAmbient() {
  const [, bump] = useState(0);
  useEffect(() => subscribe(() => bump(n => n + 1)), []);
  return { keys: activeKeys(), vol: masterVol };
}
