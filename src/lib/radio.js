// Global radio singleton.
//
// WHY THIS NO LONGER USES YOUTUBE
// It used to play Lofi Girl's live streams through the YouTube IFrame API. That
// stopped working, and not for a reason any amount of code could fix: YouTube
// returned error 150 — "embedding disabled by the owner". The channel turned off
// third-party embedding, so the player loaded correctly, was handed a valid live
// video id, and was refused. Measured in Neel's own browser rather than guessed.
//
// Two earlier failures on the way to that measurement, both worth remembering:
//   * The Content-Security-Policy added in the security pass set script-src to
//     'self', which blocked https://www.youtube.com/iframe_api outright. The
//     promise that loaded the API had no rejection path, so the symptom was a
//     play button that span forever and said nothing.
//   * The tab was stale. A CSP is applied at document load, so a fixed header on
//     the server changes nothing until the page is reloaded.
//
// The replacement is an ordinary <audio> element pointed at direct Icecast/MP3
// streams. This is better than what it replaces in every way that matters here:
// no third-party script, no iframe, no embedding permission that someone else
// can revoke, no 160x90 hidden video player, a fraction of the memory, and it
// keeps playing with the tab backgrounded. It also let script-src go back to
// 'self' — the radio is now the reason the CSP is TIGHTER, not looser.
//
// The element lives at module scope, attached to nothing in React's tree, so
// switching tabs cannot stop the music. Tabs are control surfaces over it.

import { useEffect, useState } from 'react';
import { stopAll as stopAmbience } from './ambient.js';
import * as bus from './audiobus.js';

let audio = null;

// ---------------------------------------------------------------- spatial
//
// Routing the radio through Web Audio puts it in the same room as the ambience:
// one listener, one master, and the station placed somewhere around your head
// instead of flat between your ears.
//
// The catch is CORS. `createMediaElementSource` on a cross-origin stream that
// does not send `Access-Control-Allow-Origin` produces a **silent** node — no
// error, no warning, just nothing, which is the worst failure a music player can
// have. Whether a given Icecast mount sends that header cannot be discovered
// without a user gesture, so it is not something to assume at build time.
//
// So the graph verifies itself. An analyser watches the signal, and if the
// stream reports it is playing while the analyser reads pure silence for a few
// seconds, the graph is abandoned and the audio is played straight to the
// speakers. It costs one element rebuild, once, on a station that turns out not
// to allow it — and the person just hears music.
//
// `createMediaElementSource` may only be called once per element, so falling
// back means discarding the element entirely rather than rewiring it.
let node = null, panner = null, analyser = null, stopOrbit = () => {};
let spatialFailed = false;
let watchdog = null;

const SILENCE_GRACE_MS = 4000;

function teardownGraph() {
  clearTimeout(watchdog); watchdog = null;
  stopOrbit(); stopOrbit = () => {};
  try { node?.disconnect(); } catch { /* already gone */ }
  try { panner?.disconnect(); } catch { /* already gone */ }
  try { analyser?.disconnect(); } catch { /* already gone */ }
  node = null; panner = null; analyser = null;
}

/** Should this play attempt route through Web Audio? */
function wantSpatial() { return bus.spatialOn() && !spatialFailed; }

function buildGraph(a) {
  if (node || !wantSpatial()) return;
  const c = bus.context();
  if (!c || !c.createMediaElementSource) return;
  try {
    node = c.createMediaElementSource(a);
    panner = bus.makePanner(340, 1.2, 5);   // just left of centre, close in
    analyser = c.createAnalyser();
    analyser.fftSize = 256;
    if (panner) {
      node.connect(panner); panner.connect(analyser);
      // A very slow drift, the same idea as the ambience: a fixed point source
      // is what makes a long stream start to feel like a wall.
      stopOrbit = bus.orbit(panner, { from: 340, degreesPerSecond: 0.5, distance: 1.2, elevation: 5 });
    } else {
      node.connect(analyser);
    }
    analyser.connect(bus.masterOut());
  } catch {
    // Already routed, or the browser refused. Either way, play it flat.
    teardownGraph();
    spatialFailed = true;
  }
}

/** If the graph is silent while the stream says it is playing, abandon it. */
function armWatchdog() {
  if (!analyser || watchdog) return;
  watchdog = setTimeout(() => {
    watchdog = null;
    if (!analyser || !S.playing) return;
    const buf = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i];
    if (sum === 0) {
      // Silence with the element claiming playback: CORS blocked the tap.
      spatialFailed = true;
      teardownGraph();
      try { audio?.pause(); } catch { /* nothing playing */ }
      audio = null;              // the element is permanently routed; discard it
      play(S.idx);               // and start again, straight to the speakers
    }
  }, SILENCE_GRACE_MS);
}

const S = {
  stations: [],   // [{ url, label }]
  source: '',     // which tab last claimed the dial ('study' | 'sleep' | …)
  idx: 0,
  playing: false,
  loading: false,
  vol: 60,
  err: '',
};

const subs = new Set();
const emit = () => { for (const f of [...subs]) f(); };

export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }
export function snap() { return { ...S, station: S.stations[S.idx] || null }; }

// React binding — any component can read live radio state.
export function useRadio() {
  const [, bump] = useState(0);
  useEffect(() => subscribe(() => bump(n => n + 1)), []);
  return snap();
}

/**
 * A live stream is not a file: the server can drop the connection, a laptop can
 * sleep mid-song, a phone can change network. So a stall is treated as normal
 * and retried, rather than reported as an error the person has to act on.
 */
const RETRY_MS = 4000;
let retryTimer = null;
const clearRetry = () => { clearTimeout(retryTimer); retryTimer = null; };

function ensure() {
  if (audio) return audio;
  const a = new Audio();
  a.preload = 'none';
  // Must be set BEFORE any src assignment, or the fetch is made without the
  // CORS request and the media element source is tainted regardless.
  if (wantSpatial()) a.crossOrigin = 'anonymous';
  // Live radio has no meaningful position, so nothing here seeks or scrubs.
  a.volume = S.vol / 100;

  a.addEventListener('playing', () => {
    clearRetry();
    S.playing = true; S.loading = false; S.err = ''; emit();
    armWatchdog();
  });
  a.addEventListener('waiting', () => { S.loading = true; emit(); });
  a.addEventListener('pause', () => { S.playing = false; emit(); });
  a.addEventListener('error', () => fail());
  a.addEventListener('stalled', () => scheduleRetry());
  a.addEventListener('ended', () => scheduleRetry()); // a live stream should never end

  audio = a;
  return a;
}

function scheduleRetry() {
  if (retryTimer || !(S.playing || S.loading)) return;
  S.loading = true; emit();
  retryTimer = setTimeout(() => { retryTimer = null; if (S.loading || S.playing) play(S.idx); }, RETRY_MS);
}

function fail() {
  // MEDIA_ERR_NETWORK / DECODE are worth retrying; SRC_NOT_SUPPORTED is not,
  // because the URL itself is wrong and retrying just repeats the failure.
  const code = audio?.error?.code;
  if (code === 4) {
    S.err = 'That station is not reachable — try another.';
    S.playing = false; S.loading = false; clearRetry(); emit();
    return;
  }
  scheduleRetry();
}

// A tab offers its station list. Whatever is currently on air wins — if the radio
// is already playing we keep those stations so the controls keep matching the sound.
export function setStations(list, source) {
  if (!list?.length) return;
  if (S.source === source) { S.stations = list; return; }
  if (S.playing || S.loading) return;
  S.stations = list; S.source = source; S.idx = 0; emit();
}

export async function play(idx = S.idx) {
  const station = S.stations[idx];
  if (!station) return;
  S.idx = idx; S.err = ''; S.loading = true; emit();
  const a = ensure();
  try {
    // Reassigning src and calling load() forces a fresh connection even when the
    // same station is selected again — a live stream that has died must not be
    // resumed from the browser's buffer, which sounds like silence. The URL is
    // left untouched: some Icecast mount points reject unknown query strings, so
    // a cache-buster would break more than it fixes.
    a.src = station.url;
    a.volume = S.vol / 100;
    a.load();
    buildGraph(a);
    await a.play();
  } catch (e) {
    // NotAllowedError means the browser wanted a user gesture. Every route into
    // here is a click, so this should not fire — but if it does, say the true
    // reason rather than blaming the station.
    S.err = e?.name === 'NotAllowedError'
      ? 'The browser blocked playback — press play again.'
      : 'Could not start that station — try another.';
    S.loading = false; S.playing = false; emit();
  }
}

export function pause() {
  clearRetry();
  clearTimeout(watchdog); watchdog = null;
  try { audio?.pause(); } catch { /* nothing playing */ }
  S.playing = false; S.loading = false; emit();
}

export function toggle() { (S.playing || S.loading) ? pause() : play(); }

export function pick(idx) {
  const wasOn = S.playing || S.loading;
  S.idx = idx; S.err = ''; emit();
  if (wasOn) play(idx);
}

export function setVolume(v) {
  S.vol = Math.min(100, Math.max(0, Math.round(v)));
  if (audio) audio.volume = S.vol / 100;
  emit();
}

export function isOn() { return S.playing || S.loading; }

/** True when the stream is being rendered through the spatial graph. */
export function isSpatial() { return Boolean(node) && !spatialFailed; }

/** True when spatial was wanted but the stream would not allow it. */
export function spatialRefused() { return spatialFailed; }

// ---- sleep timer ----
// Lives here rather than in the Sleep tab: the audio outlives the tab now, so the
// thing that switches it off has to outlive the tab too.
let sleepAt = 0, sleepTick = null;

function clearSleep() { clearInterval(sleepTick); sleepTick = null; sleepAt = 0; }

export function sleepLeft() {
  return sleepAt ? Math.max(0, Math.round((sleepAt - Date.now()) / 1000)) : 0;
}

export function setSleep(mins) {
  clearSleep();
  if (!mins) { emit(); return; }
  sleepAt = Date.now() + mins * 60000;
  sleepTick = setInterval(() => {
    if (Date.now() >= sleepAt) { clearSleep(); pause(); stopAmbience(); }
    emit();
  }, 1000);
  emit();
}

export function cancelSleep() { clearSleep(); emit(); }
