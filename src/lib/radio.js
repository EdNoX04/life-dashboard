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

function loadYT() {
  return new Promise(res => {
    if (window.YT?.Player) return res(window.YT);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev && prev(); res(window.YT); };
    if (!document.getElementById('yt-iframe-api')) {
      const s = document.createElement('script');
      s.id = 'yt-iframe-api';
      s.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(s);
    }
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
    setTimeout(() => res(p), 4000); // safety if onReady is slow
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
  } catch {
    S.err = 'Could not start the stream — tap play again.';
    S.loading = false; emit();
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
