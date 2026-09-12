import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Empty } from './ui.jsx';
import {
  SCOPES, TOKEN_URL, API, authUrl, redirectUri, makeVerifier, challengeFor,
  readCallback, tokenFrom, isExpired, mergeToken, explain, isPremium,
  normalizeTracks, normalizeState, fmtMs,
} from '../lib/spotify.js';

// Spotify, wired up.
//
// Everything with a rule in it lives in lib/spotify.js with its tests; this
// file is the parts that can only be done in a browser — the redirect, the
// SDK script, and the fetches.
//
// THE THREE THINGS THAT MAKE THIS ANNOYING TO SET UP, handled rather than
// documented:
//
//   * The redirect URI must match the Spotify dashboard EXACTLY. It is derived
//     from the running page, and the panel PRINTS the string to paste, so the
//     two cannot disagree about a trailing slash.
//   * PKCE state has to survive a full page navigation to accounts.spotify.com
//     and back, so the verifier goes in sessionStorage — not React state, which
//     does not exist any more by the time we return.
//   * The tab we came back to is whatever tab was open. A flag is left behind
//     so the app returns to Music rather than HQ.
//
// Tokens live in localStorage on this device only. They are not synced to
// Supabase: a Spotify refresh token is a durable credential, and db.js already
// removed the model keys from the synced config on exactly that principle.

const LS_TOK = 'ldx_spotify_token';
const SS_VERIFIER = 'ldx_spotify_verifier';
const SS_STATE = 'ldx_spotify_state';
const SS_RETURN = 'ldx_spotify_return';

const readTok = () => { try { return JSON.parse(localStorage.getItem(LS_TOK) || 'null'); } catch { return null; } };
const writeTok = t => { try { t ? localStorage.setItem(LS_TOK, JSON.stringify(t)) : localStorage.removeItem(LS_TOK); } catch { /* private window */ } };

export default function SpotifyPanel({ clientId, onTrack }) {
  const [tok, setTok] = useState(readTok);
  const [me, setMe] = useState(null);
  const [problem, setProblem] = useState(null);
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [state, setState] = useState(null);
  const [deviceId, setDeviceId] = useState('');
  const [busy, setBusy] = useState(false);
  const player = useRef(null);
  const redirect = redirectUri(window.location.origin, '/');

  const fail = e => setProblem(explain(e));

  // ---- the token -----------------------------------------------------------
  const fresh = useCallback(async () => {
    let t = readTok();
    if (!t) return null;
    if (!isExpired(t)) return t;
    if (!t.refreshToken) { setProblem(explain({ status: 401 })); return null; }
    try {
      const r = await fetch(TOKEN_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: t.refreshToken, client_id: clientId }),
      });
      if (!r.ok) throw Object.assign(new Error(await r.text()), { status: r.status });
      // mergeToken, not assignment: Spotify omits refresh_token on some
      // refreshes and dropping it ends the session an hour later.
      t = mergeToken(t, tokenFrom(await r.json()));
      writeTok(t); setTok(t);
      return t;
    } catch (e) { fail(e); return null; }
  }, [clientId]);

  const call = useCallback(async (path, init = {}) => {
    const t = await fresh();
    if (!t) return null;
    const r = await fetch(`${API}${path}`, {
      ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${t.accessToken}` },
    });
    if (r.status === 204) return {};
    if (!r.ok) {
      let reason = '';
      try { reason = (await r.json())?.error?.message || ''; } catch { /* empty body */ }
      throw Object.assign(new Error(reason || r.statusText), { status: r.status, reason });
    }
    return r.json();
  }, [fresh]);

  // ---- connect -------------------------------------------------------------
  async function connect() {
    if (!clientId) return;
    const verifier = makeVerifier();
    const st = makeVerifier(43);
    try {
      sessionStorage.setItem(SS_VERIFIER, verifier);
      sessionStorage.setItem(SS_STATE, st);
      sessionStorage.setItem(SS_RETURN, 'music');
    } catch { /* a private window cannot complete this flow at all */ }
    window.location.href = authUrl({ clientId, redirect, challenge: await challengeFor(verifier), state: st });
  }

  function disconnect() {
    writeTok(null); setTok(null); setMe(null); setState(null); setResults([]);
    try { player.current?.disconnect(); } catch { /* never connected */ }
  }

  // ---- the callback --------------------------------------------------------
  useEffect(() => {
    const cb = readCallback(window.location.search, sessionStorage.getItem(SS_STATE));
    if (cb.kind === 'none') return;
    // The code is single-use, so the URL is cleaned before the exchange rather
    // than after: a reload mid-exchange would otherwise retry a spent code and
    // report an auth failure that is really a double submit.
    window.history.replaceState({}, '', window.location.pathname);
    if (cb.kind !== 'code') { setProblem(explain(cb)); return; }
    const verifier = sessionStorage.getItem(SS_VERIFIER);
    sessionStorage.removeItem(SS_VERIFIER); sessionStorage.removeItem(SS_STATE);
    if (!verifier) { setProblem(explain({ reason: 'state_mismatch' })); return; }
    (async () => {
      try {
        const r = await fetch(TOKEN_URL, {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'authorization_code', code: cb.code, redirect_uri: redirect,
            client_id: clientId, code_verifier: verifier,
          }),
        });
        const j = await r.json();
        if (!r.ok) throw Object.assign(new Error(j?.error_description || j?.error || ''), { status: r.status, reason: j?.error_description || j?.error || '' });
        const t = tokenFrom(j);
        writeTok(t); setTok(t); setProblem(null);
      } catch (e) { fail(e); }
    })();
  }, [clientId, redirect]);

  // ---- who are we ----------------------------------------------------------
  useEffect(() => {
    if (!tok) return;
    call('/me').then(j => j && setMe(j)).catch(fail);
  }, [tok, call]);

  // ---- the SDK -------------------------------------------------------------
  //
  // Loaded only once there is a token AND the account is Premium. Free accounts
  // get a hard refusal from the SDK, and loading it anyway would turn a clear
  // "Premium only" into an unexplained console error.
  useEffect(() => {
    if (!tok || isPremium(me) !== true || player.current) return undefined;
    let cancelled = false;

    const boot = () => {
      if (cancelled || !window.Spotify) return;
      const p = new window.Spotify.Player({
        name: 'PLAYER ONE',
        getOAuthToken: async cb => { const t = await fresh(); if (t) cb(t.accessToken); },
        volume: 0.8,
      });
      p.addListener('ready', ({ device_id }) => setDeviceId(device_id));
      p.addListener('not_ready', () => setDeviceId(''));
      p.addListener('player_state_changed', s => setState(normalizeState(s)));
      p.addListener('authentication_error', ({ message }) => fail({ status: 401, reason: message }));
      p.addListener('account_error', ({ message }) => fail({ kind: 'premium', reason: message }));
      p.addListener('initialization_error', ({ message }) => fail({ reason: message }));
      p.connect();
      player.current = p;
    };

    if (window.Spotify) { boot(); } else {
      window.onSpotifyWebPlaybackSDKReady = boot;
      if (!document.getElementById('spotify-sdk')) {
        const s = document.createElement('script');
        s.id = 'spotify-sdk'; s.src = 'https://sdk.scdn.co/spotify-player.js'; s.async = true;
        s.onerror = () => fail({ reason: 'Failed to fetch the Spotify SDK' });
        document.body.appendChild(s);
      }
    }
    return () => { cancelled = true; };
  }, [tok, me, fresh]);

  // The track travels up so the tab's own quality panel can say what is playing
  // — and, importantly, say it is REPORTED rather than measured.
  useEffect(() => { onTrack?.(state?.track || null); }, [state, onTrack]);

  // ---- actions -------------------------------------------------------------
  async function search(e) {
    e?.preventDefault();
    if (!q.trim()) return;
    setBusy(true); setProblem(null);
    try {
      const j = await call(`/search?type=track&limit=20&q=${encodeURIComponent(q.trim())}`);
      setResults(normalizeTracks(j?.tracks?.items || []));
    } catch (e2) { fail(e2); }
    setBusy(false);
  }

  async function playUri(uri) {
    if (!deviceId) { setProblem(explain({ status: 404, reason: 'no active device' })); return; }
    setBusy(true);
    try {
      await call(`/me/player/play?device_id=${deviceId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uris: [uri] }),
      });
      setProblem(null);
    } catch (e) { fail(e); }
    setBusy(false);
  }

  const toggle = () => player.current?.togglePlay().catch(fail);
  const nextTrack = () => player.current?.nextTrack().catch(fail);
  const prevTrack = () => player.current?.previousTrack().catch(fail);

  // ---- render --------------------------------------------------------------
  if (!clientId) {
    return (
      <Empty icon="♫" text="Spotify needs a client ID."
        note={`Create an app at developer.spotify.com/dashboard (free, no card), add EXACTLY this redirect URI — ${redirect} — then paste the Client ID into Settings. It is not a secret: this uses PKCE, which exists so a browser app needs no secret at all.`} />
    );
  }

  if (!tok) {
    return (
      <div className="sp-connect">
        <button className="btn btn-green" onClick={connect}>Connect Spotify</button>
        <div className="small" style={{ color: 'var(--ink-3)', marginTop: 6 }}>
          Redirect URI to register: <code>{redirect}</code> — it has to match character for character.
        </div>
        {problem && <div className="small" style={{ color: 'var(--orange)', marginTop: 6 }}>{problem.fix}</div>}
      </div>
    );
  }

  const premium = isPremium(me);
  return (
    <div className="sp">
      <div className="row sp-top">
        <span style={{ flex: 1 }} className="small">
          {me?.display_name ? `Connected as ${me.display_name}` : 'Connected'}
          {premium === false && <b style={{ color: 'var(--orange)' }}> · free account</b>}
          {premium === true && deviceId && <span style={{ color: 'var(--green)' }}> · this tab is the player</span>}
          {premium === true && !deviceId && <span style={{ color: 'var(--ink-3)' }}> · starting the player…</span>}
        </span>
        <button className="btn btn-sm" onClick={disconnect}>Disconnect</button>
      </div>

      {/* Premium is a rule of Spotify's, not a fault of this app, so it is
          stated once and calmly — and the search below still works without it. */}
      {premium === false && (
        <div className="small" style={{ color: 'var(--orange)', marginBottom: 8 }}>
          {explain({ kind: 'premium' }).fix}
        </div>
      )}
      {problem && <div className="small" style={{ color: 'var(--orange)', marginBottom: 8 }}>{problem.fix}</div>}

      {state?.track && (
        <div className="sp-now">
          {state.track.art && <img className="sp-art" src={state.track.art} alt="" />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="sp-title">{state.track.name}</div>
            <div className="sp-artist">{state.track.artist}</div>
            <div className="sp-time">{fmtMs(state.positionMs)} / {fmtMs(state.durationMs)}</div>
          </div>
          <div className="flex" style={{ gap: 4 }}>
            <button className="btn btn-sm" onClick={prevTrack}>◄◄</button>
            <button className="btn btn-sm btn-green" onClick={toggle}>{state.paused ? '▶' : '❚❚'}</button>
            <button className="btn btn-sm" onClick={nextTrack}>►►</button>
          </div>
        </div>
      )}

      <form className="row sp-search" onSubmit={search}>
        <input placeholder="Search Spotify…" value={q} onChange={e => setQ(e.target.value)} />
        <button className="btn btn-sm" disabled={busy || !q.trim()}>Search</button>
      </form>

      {results.map(t => (
        <div className="row sp-row" key={t.id}>
          {t.art && <img className="sp-thumb" src={t.art} alt="" />}
          <span style={{ flex: 1, minWidth: 0 }}>
            <span className="sp-title">{t.name}</span>
            <span className="sp-artist"> · {t.artist}</span>
          </span>
          <span className="small" style={{ color: 'var(--ink-3)' }}>{fmtMs(t.durationMs)}</span>
          {/* A track Spotify itself says is unplayable is shown as such rather
              than offered and silently skipped. */}
          {!t.playable
            ? <span className="chip" title="Spotify reports this track as unavailable here">unavailable</span>
            : premium === true
              ? <button className="btn btn-sm btn-green" disabled={busy} onClick={() => playUri(t.uri)}>▶</button>
              : null}
        </div>
      ))}
    </div>
  );
}
