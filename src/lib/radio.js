// Global radio singleton.
//
// The YouTube IFrame player used to live inside whichever tab rendered <LofiRadio/>,
// which meant switching tabs unmounted it and the music stopped. Now the player lives
// in a host element owned by this module and attached straight to <body>, so it is
// completely independent of React's tree. Tabs are just control surfaces over it.
//
// The host is kept on-screen (browsers throttle or refuse playback for elements parked
// far off-viewport) but at 1/1000 opacity behind everything, so it is never visible.

import { useEffect, useState } from 'react';
import { stopAll as stopAmbience } from './ambient.js';

let player = null;
let hostEl = null;

const S = {
  stations: [],   // [{ id, label }]
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

// Loading the YouTube IFrame API.
//
// This used to be a promise with no rejection path, which turned every possible
// failure into the same symptom: the play button spins forever and says nothing.
// That is exactly what happened when the Content-Security-Policy added in the
// security pass tightened script-src to 'self' — the API script was blocked, the
// promise never settled, and the radio looked broken with no explanation
// anywhere. The CSP now allows www.youtube.com and s.ytimg.com; this rejects, so
// that if it is ever blocked again the reason reaches the screen in ten seconds
// instead of never.
const YT_SRC = 'https://www.youtube.com/iframe_api';
const YT_TIMEOUT_MS = 10000;

function loadYT() {
  return new Promise((res, rej) => {
    if (window.YT?.Player) return res(window.YT);

    let settled = false;
    const ok = () => { if (!settled) { settled = true; res(window.YT); } };
    const no = msg => { if (!settled) { settled = true; rej(new Error(msg)); } };

    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev && prev(); ok(); };

    // A CSP refusal fires securitypolicyviolation, not onerror, so watch for both.
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

    // Tidy up whichever way it went.
    const done = () => document.removeEventListener('securitypolicyviolation', onViolation);
    setTimeout(done, YT_TIMEOUT_MS + 100);
  });
}

function host() {
  if (hostEl) return hostEl;
  hostEl = document.createElement('div');
  hostEl.id = 'ldx-radio-host';
  Object.assign(hostEl.style, {
    position: 'fixed', left: '0', bottom: '0', width: '160px', height: '90px',
    opacity: '0.001', pointerEvents: 'none', zIndex: '-1', overflow: 'hidden',
  });
  const inner = document.createElement('div');
  inner.id = 'ldx-radio-yt';
  hostEl.appendChild(inner);
  document.body.appendChild(hostEl);
  return hostEl;
}

async function ensure() {
  if (player) return player;
  host();
  const YT = await loadYT();
  if (!YT?.Player) throw new Error('yt-api-missing');
  return await new Promise(res => {
    const p = new YT.Player('ldx-radio-yt', {
      width: '100%', height: '100%', videoId: (S.stations[S.idx] || {}).id,
      playerVars: { autoplay: 0, controls: 0, disablekb: 1, fs: 0, modestbranding: 1, playsinline: 1, rel: 0 },
      events: {
        onReady: () => { try { p.setVolume(S.vol); } catch {} res(p); },
        onStateChange: e => {
          S.playing = e.data === 1;
          S.loading = e.data === 3;
          if (e.data === 1) S.err = '';
          emit();
        },
        onError: () => {
          S.err = 'This stream is unavailable right now — try another.';
          S.loading = false; S.playing = false; emit();
        },
      },
    });
    player = p;
    // onReady is occasionally slow; resolving anyway is fine because loadVideoById
    // queues. What must NOT happen is resolving when there is no player at all,
    // which is why the YT.Player check above throws before we get here.
    setTimeout(() => res(p), 4000);
  });
}

// A tab offers its station list. Whatever is currently on air wins — if the radio is
// already playing we keep those stations so the controls keep matching the sound.
export function setStations(list, source) {
  if (!list?.length) return;
  if (S.source === source) { S.stations = list; return; }
  if (S.playing || S.loading) return;
  S.stations = list; S.source = source; S.idx = 0; emit();
}

export async function play(idx = S.idx) {
  if (!S.stations[idx]) return;
  S.idx = idx; S.err = ''; S.loading = true; emit();
  try {
    const p = await ensure();
    p.loadVideoById(S.stations[idx].id);
    p.setVolume(S.vol);
    p.playVideo();
  } catch (e) {
    // Name the failure. "Tap play again" is useless advice when the script is
    // blocked, and it is what hid this bug for as long as it did.
    const why = String(e?.message || '');
    S.err = why === 'blocked-by-csp'
      ? 'The browser blocked YouTube\u2019s player (content security policy). This needs a deploy to fix, not a retry.'
      : why === 'timeout' || why === 'script-failed' || why === 'yt-api-missing'
        ? 'Could not reach YouTube \u2014 check the connection, or an extension may be blocking it.'
        : 'Could not start the stream \u2014 tap play again.';
    S.loading = false; S.playing = false; emit();
  }
}

export function pause() {
  try { player?.pauseVideo(); } catch {}
  S.playing = false; S.loading = false; emit();
}

export function toggle() { (S.playing || S.loading) ? pause() : play(); }

export function pick(idx) {
  const wasOn = S.playing || S.loading;
  S.idx = idx; emit();
  if (wasOn) play(idx);
}

export function setVolume(v) {
  S.vol = v;
  try { player?.setVolume(v); } catch {}
  emit();
}

export function isOn() { return S.playing || S.loading; }

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
