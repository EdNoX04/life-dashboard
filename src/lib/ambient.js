import { useEffect, useState } from 'react';
import * as bus from './audiobus.js';

// Ambient sound engine — real field-recording loops (Moodist, CC-licensed) streamed
// from the jsDelivr CDN, decoded via Web Audio for seamless looping.
//
// WHAT CHANGED, AND WHY
// It used to be a grid of on/off tiles at a fixed 0.9 gain sharing one master
// volume. That makes exactly one mix: everything, equally loud. But a mix is the
// whole point of ambience — rain wants to be loud and crickets want to be barely
// there, and the difference between "rain plus a café" and "a café in the rain"
// is entirely in the balance. So every sound now has its own level and its own
// position around the listener, both remembered.
//
// The context and the master gain moved to lib/audiobus.js, because the radio
// needs the same listener. See the note there for why one context matters.

const CDN = 'https://cdn.jsdelivr.net/gh/remvze/moodist@main/public/sounds/';

// `at` is the default azimuth in degrees clockwise from straight ahead: 0 in
// front, 90 right, 180 behind, 270 left. The defaults are chosen so a plausible
// mix lands spread out rather than stacked in the middle of your head — rain
// overhead and all around, a fire off to one side, birds in front and above.
export const SOUNDS = {
  rain:    { label: 'Rain',        icon: '🌧', url: CDN + 'rain/light-rain.mp3',       at: 200, dist: 1.4, el: 20, group: 'weather' },
  storm:   { label: 'Heavy rain',  icon: '🌦', url: CDN + 'rain/heavy-rain.mp3',       at: 170, dist: 1.6, el: 15, group: 'weather' },
  thunder: { label: 'Thunder',     icon: '⛈', url: CDN + 'rain/thunder.mp3',          at: 250, dist: 3.2, el: 30, group: 'weather' },
  wind:    { label: 'Wind',        icon: '🌬', url: CDN + 'nature/wind.mp3',           at: 300, dist: 2.0, el: 10, group: 'weather' },
  fire:    { label: 'Fireplace',   icon: '🔥', url: CDN + 'nature/campfire.mp3',       at: 45,  dist: 1.1, el: -10, group: 'place' },
  forest:  { label: 'Forest',      icon: '🌲', url: CDN + 'nature/jungle.mp3',         at: 120, dist: 1.8, el: 5,  group: 'nature' },
  waves:   { label: 'Ocean',       icon: '🌊', url: CDN + 'nature/waves.mp3',          at: 0,   dist: 2.2, el: 0,  group: 'nature' },
  river:   { label: 'River',       icon: '🏞', url: CDN + 'nature/river.mp3',          at: 260, dist: 1.5, el: -5, group: 'nature' },
  night:   { label: 'Crickets',    icon: '🦗', url: CDN + 'animals/crickets.mp3',      at: 150, dist: 2.4, el: -8, group: 'nature' },
  birds:   { label: 'Birds',       icon: '🐦', url: CDN + 'animals/birds.mp3',         at: 20,  dist: 2.0, el: 28, group: 'nature' },
  cafe:    { label: 'Café',        icon: '☕', url: CDN + 'places/cafe.mp3',           at: 285, dist: 1.7, el: 0,  group: 'place' },
  library: { label: 'Library',     icon: '📚', url: CDN + 'places/library.mp3',        at: 75,  dist: 1.8, el: 0,  group: 'place' },
  train:   { label: 'Train',       icon: '🚂', url: CDN + 'transport/train.mp3',       at: 190, dist: 1.6, el: -6, group: 'place' },
  keyboard:{ label: 'Keyboard',    icon: '⌨️', url: CDN + 'things/keyboard.mp3',       at: 350, dist: 0.9, el: -15, group: 'place' },
  clock:   { label: 'Clock',       icon: '🕰', url: CDN + 'things/clock.mp3',          at: 100, dist: 1.9, el: 12, group: 'place' },
  noise:   { label: 'Brown noise', icon: '📻', url: CDN + 'noise/brown-noise.wav',     at: 0,   dist: 1.0, el: 0,  group: 'noise' },
  white:   { label: 'White noise', icon: '⚪', url: CDN + 'noise/white-noise.wav',     at: 0,   dist: 1.0, el: 0,  group: 'noise' },
  pink:    { label: 'Pink noise',  icon: '🩷', url: CDN + 'noise/pink-noise.wav',      at: 0,   dist: 1.0, el: 0,  group: 'noise' },
};

export const GROUPS = [
  ['weather', 'Weather'],
  ['nature',  'Nature'],
  ['place',   'Places'],
  ['noise',   'Noise'],
];

/** Ready-made mixes. Values are per-sound levels, 0–1. */
export const PRESETS = [
  { id: 'rainy-cafe', label: 'Rainy café',  icon: '☔', mix: { rain: 0.65, cafe: 0.4, thunder: 0.25 } },
  { id: 'deep-focus', label: 'Deep focus',  icon: '🧠', mix: { noise: 0.35, keyboard: 0.2, clock: 0.15 } },
  { id: 'storm',      label: 'Storm',       icon: '⚡', mix: { storm: 0.7, thunder: 0.45, wind: 0.4 } },
  { id: 'campfire',   label: 'Campfire',    icon: '🏕', mix: { fire: 0.7, night: 0.35, wind: 0.2 } },
  { id: 'forest',     label: 'Forest walk', icon: '🌳', mix: { forest: 0.55, birds: 0.35, river: 0.4 } },
  { id: 'night',      label: 'Night',       icon: '🌙', mix: { night: 0.45, wind: 0.25, rain: 0.3 } },
];

const LEVELS_KEY = 'p1_amb_levels';
const PLACES_KEY = 'p1_amb_places';
const DEFAULT_LEVEL = 0.7;

const active = new Map();  // key -> { stop() } | 'loading'
const cache = new Map();   // url -> Promise<AudioBuffer>
const levels = loadMap(LEVELS_KEY);   // key -> 0..1
const places = loadMap(PLACES_KEY);   // key -> azimuth degrees

const subs = new Set();
const emit = () => { for (const f of [...subs]) f(); };
export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }
export function activeKeys() { return [...active.keys()]; }
export function anyOn() { return active.size > 0; }

// The bus owns the master volume now; these stay so existing callers keep working.
export const masterVolume = bus.masterVolume;
export const setMasterVolume = bus.setMasterVolume;
export const spatialOn = bus.spatialOn;

function loadMap(key) {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    const o = raw ? JSON.parse(raw) : null;
    return new Map(o && typeof o === 'object' ? Object.entries(o) : []);
  } catch { return new Map(); }
}
function saveMap(key, map) {
  try { globalThis.localStorage?.setItem(key, JSON.stringify(Object.fromEntries(map))); } catch { /* private mode */ }
}

/** The level for one sound, 0–1. Unset sounds start at a sensible default. */
export function volumeOf(key) {
  const v = levels.get(key);
  return typeof v === 'number' && v >= 0 && v <= 1 ? v : DEFAULT_LEVEL;
}

/**
 * Change one sound's level. Applied to the live node immediately with a short
 * ramp — a gain set instantaneously on a playing source is an audible click, and
 * a volume slider produces dozens of these per drag.
 */
export function setVolume(key, v) {
  const val = Math.max(0, Math.min(1, Number(v) || 0));
  levels.set(key, val);
  saveMap(LEVELS_KEY, levels);
  const a = active.get(key);
  if (a && a.gain) {
    const c = bus.context();
    try { a.gain.gain.linearRampToValueAtTime(val, (c?.currentTime ?? 0) + 0.05); }
    catch { a.gain.gain.value = val; }
  }
  emit();
}

/** Where a sound sits, in degrees clockwise from ahead. */
export function angleOf(key) {
  const v = places.get(key);
  return typeof v === 'number' ? v : (SOUNDS[key]?.at ?? 0);
}

export function setAngle(key, deg) {
  const d = ((Math.round(Number(deg) || 0) % 360) + 360) % 360;
  places.set(key, d);
  saveMap(PLACES_KEY, places);
  const a = active.get(key);
  if (a && a.panner) bus.place(a.panner, d, SOUNDS[key]?.dist ?? 1.5, SOUNDS[key]?.el ?? 0);
  emit();
}

/** Put every sound back where it started. */
export function resetPlacement() {
  places.clear();
  saveMap(PLACES_KEY, places);
  for (const [k, a] of active) {
    if (a && a.panner) bus.place(a.panner, SOUNDS[k]?.at ?? 0, SOUNDS[k]?.dist ?? 1.5, SOUNDS[k]?.el ?? 0);
  }
  emit();
}

function getBuffer(url) {
  if (cache.has(url)) return cache.get(url);
  const c = bus.context();
  const p = fetch(url).then(r => r.arrayBuffer()).then(a => c.decodeAudioData(a));
  cache.set(url, p);
  return p;
}

export async function start(key) {
  if (active.has(key)) return;
  const s = SOUNDS[key];
  if (!s) return;
  active.set(key, 'loading'); emit();
  try {
    const c = bus.context();
    const buf = await getBuffer(s.url);
    if (!active.has(key)) return; // toggled off while it was loading
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const g = c.createGain();
    g.gain.value = volumeOf(key);

    // Spatial is a routing choice made at start time. Flipping it mid-playback
    // would mean rebuilding the graph under a running source, so `setSpatial`
    // takes effect on the next sound rather than rewiring what is already going.
    let panner = null, stopOrbit = () => {};
    src.connect(g);
    if (bus.spatialOn()) {
      panner = bus.makePanner(angleOf(key), s.dist ?? 1.5, s.el ?? 0);
      if (panner) {
        g.connect(panner);
        panner.connect(bus.masterOut());
        // Noise is meant to be a flat bed, so it stays put; everything else
        // drifts, very slowly, so the loop never quite repeats in the same place.
        if (s.group !== 'noise') {
          stopOrbit = bus.orbit(panner, {
            from: angleOf(key),
            degreesPerSecond: 0.8 + Math.random() * 0.8,
            distance: s.dist ?? 1.5,
            elevation: s.el ?? 0,
          });
        }
      } else {
        g.connect(bus.masterOut());
      }
    } else {
      g.connect(bus.masterOut());
    }

    src.start();
    active.set(key, {
      gain: g,
      panner,
      stop() {
        stopOrbit();
        try { src.stop(); } catch { /* already stopped */ }
        try { g.disconnect(); } catch { /* already gone */ }
        try { panner?.disconnect(); } catch { /* already gone */ }
      },
    });
    emit();
  } catch {
    active.delete(key);
    emit();
  }
}

export function stop(key) {
  const a = active.get(key);
  if (a && a.stop) a.stop();
  active.delete(key);
  emit();
}
export function toggle(key) { if (active.has(key)) { stop(key); return false; } start(key); return true; }
export function stopAll() { for (const k of [...active.keys()]) stop(k); }
export function isOn(key) { return active.has(key); }

/** Apply a preset: start what it names at the level it names, stop everything else. */
export function applyPreset(id) {
  const p = PRESETS.find(x => x.id === id);
  if (!p) return;
  for (const k of [...active.keys()]) if (!(k in p.mix)) stop(k);
  for (const [k, v] of Object.entries(p.mix)) {
    setVolume(k, v);
    if (!active.has(k)) start(k);
  }
  emit();
}

/** Which preset the current mix matches, or null. Compares the set of sounds. */
export function presetOf() {
  const on = new Set(active.keys());
  const p = PRESETS.find(x => {
    const keys = Object.keys(x.mix);
    return keys.length === on.size && keys.every(k => on.has(k));
  });
  return p ? p.id : null;
}

/** Turning spatial on or off is a graph change, so restart whatever is playing. */
export function setSpatial(on) {
  const was = activeKeys();
  bus.setSpatial(on);
  if (!was.length) { emit(); return; }
  for (const k of was) stop(k);
  for (const k of was) start(k);
}

// React binding — re-renders whenever the shared mix changes.
export function useAmbient() {
  const [, bump] = useState(0);
  useEffect(() => {
    const a = subscribe(() => bump(n => n + 1));
    const b = bus.subscribe(() => bump(n => n + 1));
    return () => { a(); b(); };
  }, []);
  return {
    keys: activeKeys(),
    vol: bus.masterVolume(),
    spatial: bus.spatialOn(),
    preset: presetOf(),
  };
}
