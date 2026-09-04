// Global radio singleton.
//
// WHAT I GOT WRONG, AND WHY THIS IS SHAPED THE WAY IT IS
//
// The radio stopped playing and I diagnosed it in two steps. The first was
// right: the CSP added in the security pass set `script-src 'self'`, which
// blocked YouTube's IFrame API outright, and the loader had no rejection path so
// the symptom was a play button that span forever saying nothing.
//
// The second was wrong. With the script allowed, ONE video id — Lofi Girl's main
// study stream — returned error 150, "embedding disabled by the owner". I
// generalised from that single measurement to "YouTube is dead here" and ripped
// the whole transport out. Neel then pointed out that Synth and Jazz had been
// playing fine the entire time. They are Lofi Girl streams too. One id was
// refusing; the transport was not.
//
// So the fix is not to pick a winner between YouTube and direct streams. It is
// to stop guessing which sources work. A STATION IS NOW A LIST OF SOURCES, tried
// in order until one plays:
//
//   { label: 'Lofi', sources: [
//       { kind: 'yt',     id: 'jfKfPfyJRdk' },   // if the owner blocks it…
//       { kind: 'yt',     id: 'rUxyKA_-grg' },   // …try her next stream…
//       { kind: 'stream', url: 'https://…' },    // …and if all else fails, this
//   ]}
//
// A source that fails with an embed error is remembered as dead for the rest of
// the session, so the fallback is instant on every later play. The person hears
// music; the station keeps its name; nothing has to be diagnosed by hand. That
// is what should have been built the first time, instead of a conclusion drawn
// from a sample of one.
//
// The player lives at module scope, attached to nothing in React's tree, so
// switching tabs cannot stop the music. Tabs are control surfaces over it.

import { useEffect, useState } from 'react';
import { stopAll as stopAmbience } from './ambient.js';
import * as bus from './audiobus.js';

// ---------------------------------------------------------------- state

const S = {
  stations: [],    // [{ label, sources: [source] }]
  source: '',      // which tab last claimed the dial ('study' | 'sleep' | …)
  idx: 0,          // which station
  srcIdx: 0,       // which source WITHIN that station is on air
  playing: false,
  loading: false,
  vol: 60,
  err: '',
  via: '',         // 'yt' | 'stream' — what is actually carrying the sound
};

const subs = new Set();
const emit = () => { for (const f of [...subs]) f(); };
export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }
export function snap() {
  return { ...S, station: S.stations[S.idx] || null, source_: S.stations[S.idx]?.sources?.[S.srcIdx] || null };
}

export function useRadio() {
  const [, bump] = useState(0);
  useEffect(() => subscribe(() => bump(n => n + 1)), []);
  return snap();
}

/**
 * Accept the old station shapes as well as the new one.
 *
 * `{ id }` was a YouTube video and `{ url }` was a stream, and both are still in
 * use in tabs that have not been updated. Normalising here rather than at every
 * call site means one place to be wrong instead of four.
 */
export function normalizeStation(s) {
  if (!s) return null;
  if (Array.isArray(s.sources) && s.sources.length) return { label: s.label || '', sources: s.sources };
  if (s.id) return { label: s.label || '', sources: [{ kind: 'yt', id: s.id }] };
  if (s.url) return { label: s.label || '', sources: [{ kind: 'stream', url: s.url }] };
  return null;
}

const sourceKey = src => (src?.kind === 'yt' ? `yt:${src.id}` : `stream:${src?.url}`);

// Sources proven unplayable this session. An embed the owner has disabled will
// not become enabled between two clicks, so re-probing it just costs the person
// four seconds of silence every single time.
const dead = new Set();
export function isDead(src) { return dead.has(sourceKey(src)); }
export function deadCount() { return dead.size; }

/**
 * Is this failure permanent, or just this moment?
 *
 * The distinction matters more than it looks. Writing a source off for the
 * session is right for an embed the owner has disabled — that will not change
 * between two clicks. It is WRONG for a slow connection or a browser that wanted
 * a click first: mark those dead and one bad moment on a train burns through a
 * station's entire fallback list, and Lofi Girl stays gone until a reload. Which
 * is the same mistake as before, just smaller — a single measurement treated as
 * a permanent fact.
 */
const isPermanent = outcome => /^yt-error-/.test(outcome) || outcome === 'stream-unsupported';

// ---------------------------------------------------------------- youtube

let yt = null;          // the YT.Player
let ytHost = null;
let ytReady = false;

const YT_SRC = 'https://www.youtube.com/iframe_api';
const YT_TIMEOUT_MS = 10000;

function loadYT() {
  return new Promise((res, rej) => {
    if (globalThis.YT?.Player) return res(globalThis.YT);
    let settled = false;
    const ok = () => { if (!settled) { settled = true; res(globalThis.YT); } };
    const no = m => { if (!settled) { settled = true; rej(new Error(m)); } };

    const prev = globalThis.onYouTubeIframeAPIReady;
    globalThis.onYouTubeIframeAPIReady = () => { prev && prev(); ok(); };

    // A CSP refusal fires securitypolicyviolation, not onerror. Watch for both,
    // because the difference between "blocked by our own policy" and "the
    // network is down" is the difference between a deploy and a retry.
    const onViolation = e => {
      if (String(e.blockedURI || '').includes('youtube.com')) no('blocked-by-csp');
    };
    document.addEventListener('securitypolicyviolation', onViolation);

    let s = document.getElementById('yt-iframe-api');
    if (!s) {
      s = document.createElement('script');
      s.id = 'yt-iframe-api';
      s.src = YT_SRC;
      s.onerror = () => no('script-failed');
      document.head.appendChild(s);
    }
    setTimeout(() => no('timeout'), YT_TIMEOUT_MS);
    setTimeout(() => document.removeEventListener('securitypolicyviolation', onViolation), YT_TIMEOUT_MS + 100);
  });
}

function host() {
  if (ytHost) return ytHost;
  ytHost = document.createElement('div');
  ytHost.id = 'ldx-radio-host';
  // Kept on-screen: browsers throttle or refuse playback for elements parked far
  // off-viewport. One part in a thousand of opacity, behind everything.
  Object.assign(ytHost.style, {
    position: 'fixed', left: '0', bottom: '0', width: '200px', height: '120px',
    opacity: '0.001', pointerEvents: 'none', zIndex: '-1', overflow: 'hidden',
  });
  const inner = document.createElement('div');
  inner.id = 'ldx-radio-yt';
  ytHost.appendChild(inner);
  document.body.appendChild(ytHost);
  return ytHost;
}

// The current attempt's resolver, so onError can hand control back to play().
let ytAttempt = null;

async function ensureYT() {
  if (yt && ytReady) return yt;
  host();
  const API = await loadYT();
  if (!API?.Player) throw new Error('yt-api-missing');
  if (yt) return yt;
  return new Promise(res => {
    const p = new API.Player('ldx-radio-yt', {
      width: '100%', height: '100%',
      playerVars: { autoplay: 0, controls: 0, disablekb: 1, fs: 0, modestbranding: 1, playsinline: 1, rel: 0 },
      events: {
        onReady: () => { ytReady = true; try { p.setVolume(S.vol); } catch { /* not ready */ } res(p); },
        onStateChange: e => {
          if (e.data === 1) {                    // PLAYING
            S.playing = true; S.loading = false; S.err = ''; S.via = 'yt';
            ytAttempt?.ok();
            emit();
          } else if (e.data === 3) {             // BUFFERING
            S.loading = true; emit();
          } else if (e.data === 2 || e.data === 0) {
            S.playing = false; emit();
          }
        },
        onError: e => {
          // 101 and 150 both mean the owner disabled embedding; 100 is gone;
          // 2 is a bad id; 5 is an HTML5 player fault. All of them mean THIS
          // source will not play, so the station should move to the next one.
          ytAttempt?.fail('yt-error-' + e.data);
        },
      },
    });
    yt = p;
    setTimeout(() => res(p), 5000);   // onReady is occasionally slow; loadVideoById queues
  });
}

function stopYT() {
  try { yt?.stopVideo(); } catch { /* not started */ }
}

// ---------------------------------------------------------------- streams

let audio = null;
const RETRY_MS = 4000;
let retryTimer = null;
const clearRetry = () => { clearTimeout(retryTimer); retryTimer = null; };

// Spatial routing for the <audio> path only. A YouTube iframe is cross-origin,
// so its audio is out of reach of Web Audio entirely — see isSpatial().
let node = null, panner = null, analyser = null, stopOrbit = () => {};
let spatialFailed = false;
let watchdog = null;
const SILENCE_GRACE_MS = 4000;

function teardownGraph() {
  clearTimeout(watchdog); watchdog = null;
  stopOrbit(); stopOrbit = () => {};
  try { node?.disconnect(); } catch { /* gone */ }
  try { panner?.disconnect(); } catch { /* gone */ }
  try { analyser?.disconnect(); } catch { /* gone */ }
  node = null; panner = null; analyser = null;
}

function wantSpatial() { return bus.spatialOn() && !spatialFailed; }

function ensureAudio() {
  if (audio) return audio;
  const a = new Audio();
  a.preload = 'none';
  // Must be set BEFORE any src assignment, or the fetch goes out without the
  // CORS request and the media element source is tainted regardless.
  if (wantSpatial()) a.crossOrigin = 'anonymous';
  a.volume = S.vol / 100;

  a.addEventListener('playing', () => {
    clearRetry();
    S.playing = true; S.loading = false; S.err = ''; S.via = 'stream';
    ytAttempt?.ok();
    emit();
    armWatchdog();
  });
  a.addEventListener('waiting', () => { S.loading = true; emit(); });
  a.addEventListener('pause', () => { S.playing = false; emit(); });
  a.addEventListener('stalled', () => scheduleRetry());
  a.addEventListener('ended', () => scheduleRetry());   // a live stream never ends
  a.addEventListener('error', () => {
    const code = audio?.error?.code;
    // 4 = SRC_NOT_SUPPORTED: the URL itself is wrong, so retrying repeats the
    // failure. Anything else is a network blip, which live radio does all day.
    if (code === 4) ytAttempt?.fail('stream-unsupported');
    else scheduleRetry();
  });

  audio = a;
  return a;
}

function scheduleRetry() {
  if (retryTimer || !(S.playing || S.loading)) return;
  S.loading = true; emit();
  retryTimer = setTimeout(() => { retryTimer = null; if (S.loading || S.playing) play(S.idx); }, RETRY_MS);
}

function buildGraph(a) {
  if (node || !wantSpatial()) return;
  const c = bus.context();
  if (!c || !c.createMediaElementSource) return;
  try {
    node = c.createMediaElementSource(a);
    panner = bus.makePanner(340, 1.2, 5);
    analyser = c.createAnalyser();
    analyser.fftSize = 256;
    if (panner) {
      node.connect(panner); panner.connect(analyser);
      stopOrbit = bus.orbit(panner, { from: 340, degreesPerSecond: 0.5, distance: 1.2, elevation: 5 });
    } else {
      node.connect(analyser);
    }
    analyser.connect(bus.masterOut());
  } catch {
    teardownGraph();
    spatialFailed = true;
  }
}

/**
 * `createMediaElementSource` on a cross-origin stream that sends no
 * Access-Control-Allow-Origin produces a SILENT node — no error, no warning.
 * That is the worst failure a music player can have, and whether a given Icecast
 * mount sends the header cannot be known without a user gesture. So the graph
 * verifies itself: silence while the element claims to be playing means the tap
 * was blocked, and the audio is replayed straight to the speakers.
 */
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
      spatialFailed = true;
      teardownGraph();
      try { audio?.pause(); } catch { /* nothing playing */ }
      audio = null;            // permanently routed; the element must be discarded
      play(S.idx);
    }
  }, SILENCE_GRACE_MS);
}

// ---------------------------------------------------------------- stations

export function setStations(list, source) {
  const norm = (list || []).map(normalizeStation).filter(Boolean);
  if (!norm.length) return;
  if (S.source === source) { S.stations = norm; return; }
  if (S.playing || S.loading) return;     // whatever is on air keeps its dial
  S.stations = norm; S.source = source; S.idx = 0; S.srcIdx = 0; emit();
}

/** How long to give one source before deciding it is not going to play. */
const SOURCE_TIMEOUT_MS = 9000;

function stopEverything() {
  clearRetry();
  clearTimeout(watchdog); watchdog = null;
  stopYT();
  try { audio?.pause(); } catch { /* nothing playing */ }
}

/**
 * Play a station by trying its sources in order.
 *
 * Each attempt resolves when the source actually produces sound, or rejects when
 * it errors or takes too long. A rejected source is marked dead and the next one
 * is tried. Only when every source has failed does the person see a message —
 * and by then it is a true statement about the station rather than a guess about
 * the transport.
 */
export async function play(idx = S.idx) {
  const station = S.stations[idx];
  if (!station?.sources?.length) return;

  S.idx = idx; S.err = ''; S.loading = true; emit();
  stopEverything();

  const token = ++playToken;
  const tried = [];

  for (let i = 0; i < station.sources.length; i++) {
    const src = station.sources[i];
    if (isDead(src)) { tried.push(sourceKey(src) + ' (known dead)'); continue; }
    S.srcIdx = i; emit();

    const outcome = await attempt(src, token);
    if (token !== playToken) return;          // a newer play() superseded this one
    if (outcome === 'ok') return;

    if (isPermanent(outcome)) dead.add(sourceKey(src));
    tried.push(`${sourceKey(src)} → ${outcome}`);
  }

  S.loading = false; S.playing = false;
  const name = station.label || 'this station';
  S.err = tried.some(t => t.endsWith('needs-gesture'))
    // Not the station's fault and not fixable by trying a different one: the
    // browser wants a click first. Saying "try another station" here would send
    // the person round every station in the list for nothing.
    ? 'Your browser blocked autoplay — press play again.'
    : station.sources.length > 1
      ? `No source for ${name} would play — try another.`
      : 'That station is unavailable right now — try another.';
  // Kept out of the message but available in the console: which sources were
  // tried and how each one failed. A user does not need this; a bug report does.
  if (tried.length) console.info('[radio] all sources failed:', tried);
  emit();
}

let playToken = 0;

function attempt(src, token) {
  return new Promise(resolve => {
    let settled = false;
    const fin = v => {
      if (settled) return;
      settled = true;
      ytAttempt = null;
      clearTimeout(timer);
      resolve(v);
    };
    ytAttempt = { ok: () => fin('ok'), fail: why => fin(why) };
    const timer = setTimeout(() => fin('timeout'), SOURCE_TIMEOUT_MS);

    (async () => {
      try {
        if (src.kind === 'yt') {
          const p = await ensureYT();
          if (token !== playToken) return fin('superseded');
          p.loadVideoById(src.id);
          p.setVolume(S.vol);
          p.playVideo();
        } else {
          stopYT();
          const a = ensureAudio();
          a.src = src.url;
          a.volume = S.vol / 100;
          a.load();
          buildGraph(a);
          await a.play();
        }
      } catch (e) {
        fin(e?.name === 'NotAllowedError' ? 'needs-gesture' : String(e?.message || 'failed'));
      }
    })();
  });
}

export function pause() {
  clearRetry();
  clearTimeout(watchdog); watchdog = null;
  playToken++;                       // cancel any in-flight source attempt
  ytAttempt = null;
  try { yt?.pauseVideo(); } catch { /* not started */ }
  try { audio?.pause(); } catch { /* nothing playing */ }
  S.playing = false; S.loading = false; emit();
}

export function toggle() { (S.playing || S.loading) ? pause() : play(); }

export function pick(idx) {
  const wasOn = S.playing || S.loading;
  S.idx = idx; S.srcIdx = 0; S.err = ''; emit();
  if (wasOn) play(idx);
}

export function setVolume(v) {
  S.vol = Math.min(100, Math.max(0, Math.round(v)));
  if (audio) audio.volume = S.vol / 100;
  try { yt?.setVolume(S.vol); } catch { /* not ready */ }
  emit();
}

export function isOn() { return S.playing || S.loading; }

/**
 * True only when the sound is genuinely being rendered through the spatial
 * graph. A YouTube source plays inside a cross-origin iframe, which Web Audio
 * cannot reach at all — so this is honest about the one case where the 3D
 * toggle has no effect, rather than letting the UI imply otherwise.
 */
export function isSpatial() { return S.via === 'stream' && Boolean(node) && !spatialFailed; }
export function via() { return S.via; }

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
