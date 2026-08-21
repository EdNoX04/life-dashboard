import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, Empty } from '../components/ui.jsx';
import FlightGlobe from '../components/flight/FlightGlobe.jsx';
import {
  parseFeed, positioned, sortForList, feedSummary, routeQuery, toCallsigns,
  coverage, phaseOf, progress, etaMinutes, fmtDuration, haversineKm, bearingDeg,
  compass, fmtAlt, fmtSpeed, fmtKm, fmtVs, fmtAge,
  AIRPORTS, airport, PRESETS, clampRadius,
} from '../lib/flights.js';

// FLIGHT RADAR.
//
// Data is adsb.lol: a volunteer network of ADS-B receivers, free, keyless, and
// BSD-3 licensed. That shapes what this screen can honestly claim. It shows
// aircraft that a volunteer's antenna can currently hear — which over a city is
// almost all of them and over open ocean is none. The screen says which of
// those two situations it is in rather than letting a stationary marker imply
// a stationary aircraft.
//
// It also has no schedules, no gates and no delay times: nobody gives those
// away for free. Everything here is derived from the aircraft's own broadcast
// — position, altitude, speed, track — plus geometry we compute ourselves.

const POLL_MS = 15000;
const MODES = [
  { id: 'area', label: 'Area' },
  { id: 'search', label: 'Search' },
  { id: 'mil', label: 'Military' },
  { id: 'emg', label: 'Squawk 7700' },
];

export default function Flights() {
  const [mode, setMode] = useState('area');
  const [preset, setPreset] = useState(PRESETS[0]);
  const [radius, setRadius] = useState(250);
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [list, setList] = useState([]);
  const [sel, setSel] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [meta, setMeta] = useState(null);
  const [live, setLive] = useState(true);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const timer = useRef(null);
  const abort = useRef(null);

  const url = useCallback(() => {
    if (mode === 'mil') return '/api/flight?op=mil';
    if (mode === 'emg') return '/api/flight?op=sqk&q=7700';
    if (mode === 'search') {
      if (!submitted) return null;
      const r = routeQuery(submitted);
      if (!r) return null;
      // toCallsigns turns "EK2" into "UAE2" — without it, searching your own
      // boarding pass returns nothing, which is the first thing anyone tries.
      const q = r.op === 'callsign' ? (toCallsigns(r.q)[0] || r.q) : r.q;
      return `/api/flight?op=${r.op}&q=${encodeURIComponent(q)}`;
    }
    return `/api/flight?op=point&lat=${preset.lat}&lon=${preset.lon}&r=${clampRadius(radius)}`;
  }, [mode, preset, radius, submitted]);

  const load = useCallback(async () => {
    const u = url();
    if (!u) { setList([]); setMeta(null); return; }
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setBusy(true);
    try {
      const r = await fetch(u, { signal: ctl.signal });
      const j = await r.json();
      if (ctl.signal.aborted) return;
      if (!r.ok) { setErr(j.error || `request failed (${r.status})`); setBusy(false); return; }
      const parsed = parseFeed(j);
      setList(parsed);
      setMeta({ cache: j._cache, ageMs: j._ageMs, warn: j._warn, at: Date.now() });
      // Keep the selected aircraft's data fresh across polls rather than
      // holding the record from whenever it was first clicked.
      setSel(s => (s ? parsed.find(a => a.hex === s.hex) || s : s));
      setErr(j._warn ? `showing cached data — ${j._warn}` : '');
    } catch (e) {
      if (e.name !== 'AbortError') setErr(String(e.message || e).slice(0, 160));
    } finally {
      if (!ctl.signal.aborted) setBusy(false);
    }
  }, [url]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    clearInterval(timer.current);
    if (!live) return;
    // Never poll a hidden tab. This is a background ornament for most of its
    // life and there is no reason to spend a phone's battery on it.
    timer.current = setInterval(() => { if (!document.hidden) load(); }, POLL_MS);
    return () => clearInterval(timer.current);
  }, [live, load]);

  const shown = useMemo(() => sortForList(list), [list]);
  const withPos = useMemo(() => positioned(shown), [shown]);
  const summary = useMemo(() => feedSummary(list), [list]);

  const A = airport(from);
  const B = airport(to);
  const route = A && B ? { from: A, to: B } : null;

  const cov = sel ? coverage(sel) : null;
  const ph = sel ? phaseOf(sel) : null;
  const prog = sel && route ? progress(A, B, sel) : null;
  const eta = prog ? etaMinutes(prog.leftKm, sel.groundSpeedKt) : null;

  function submit(e) {
    e.preventDefault();
    setMode('search');
    setSubmitted(query.trim());
    setSel(null);
  }

  return (
    <>
      <h1 className="tab-title">FLIGHT RADAR</h1>
      <p className="tab-sub">Live aircraft from volunteer ADS-B receivers. Search a flight, or just watch the sky. ✈</p>

      <Card title="Find a flight" color="var(--cyan)"
        right={
          <span className="flex" style={{ gap: 6, alignItems: 'center' }}>
            <button className={`btn btn-sm ${live ? 'btn-green' : ''}`} onClick={() => setLive(v => !v)}>
              {live ? '● live' : '‖ paused'}
            </button>
            <button className="btn btn-sm" onClick={load} disabled={busy}>{busy ? '…' : '↻'}</button>
          </span>
        }>
        <form onSubmit={submit} className="flex" style={{ gap: 6, flexWrap: 'wrap' }}>
          <input
            style={{ flex: 1, minWidth: 190 }}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="EK 2 · 6E 1492 · AI 916 · A6-EUR · 8963a9"
            autoComplete="off" spellCheck="false"
          />
          <button className="btn btn-cyan" type="submit">Track</button>
        </form>
        <div className="small muted mt">
          Flight number, tail number or ICAO hex. Your boarding pass says <b>EK 2</b>; the aircraft
          transmits <b>UAE2</b> — the search handles the translation.
        </div>

        <div className="flex mt" style={{ gap: 6, flexWrap: 'wrap' }}>
          {MODES.map(m => (
            <button key={m.id} className={`btn btn-sm ${mode === m.id ? 'btn-cyan' : ''}`}
              onClick={() => { setMode(m.id); setSel(null); }}>{m.label}</button>
          ))}
        </div>

        {mode === 'area' && (
          <>
            <div className="flex mt" style={{ gap: 6, flexWrap: 'wrap' }}>
              {PRESETS.map(p => (
                <button key={p.id} className={`btn btn-sm ${preset.id === p.id ? 'btn-purple' : ''}`}
                  onClick={() => { setPreset(p); setSel(null); }}>{p.label}</button>
              ))}
            </div>
            <div className="flex mt" style={{ gap: 8, alignItems: 'center' }}>
              <span className="small muted">RADIUS</span>
              <input type="range" min="25" max="250" step="25" value={radius}
                onChange={e => setRadius(+e.target.value)} style={{ flex: 1 }} />
              <span className="small">{radius} nm</span>
            </div>
          </>
        )}

        {mode === 'emg' && (
          <div className="small mt" style={{ color: 'var(--yellow)', lineHeight: 1.55 }}>
            7700 is the general emergency squawk. It is usually empty, and when it is not,
            it is often a light aircraft with a minor problem rather than anything dramatic.
          </div>
        )}

        {err && <div className="small mt" style={{ color: 'var(--yellow)' }}>{err}</div>}
      </Card>

      <div className="fl-split">
        <Card title="Radar" color="var(--purple)"
          right={<span className="small muted">{summary}</span>}>
          <FlightGlobe
            aircraft={withPos}
            selected={sel}
            route={route}
            onPick={setSel}
            size={340}
          />
          <div className="small muted mt" style={{ lineHeight: 1.55, textAlign: 'center' }}>
            A coordinate grid, not a map — real coastlines are not in this file, so none are drawn.
            Airport markers and every aircraft position are real.
          </div>
        </Card>

        <Card title={sel ? 'Selected flight' : 'In range'} color="var(--cyan)"
          right={sel ? <button className="btn btn-sm" onClick={() => setSel(null)}>← list</button> : null}>
          {!sel && shown.length === 0 && !busy && (
            <Empty icon="✈" text={
              mode === 'search' && submitted
                ? `Nothing is transmitting as “${submitted}” right now. It may not be airborne, or it may be somewhere no receiver can hear it.`
                : 'Nothing in range.'
            } />
          )}

          {!sel && shown.length > 0 && (
            <div className="fl-list">
              {shown.slice(0, 60).map(a => {
                const c = coverage(a);
                return (
                  <button key={a.hex} className="fl-row" onClick={() => setSel(a)}>
                    <span className="fl-cs">
                      {a.flightNo || a.callsign || a.hex}
                      {a.emergency && <span className="chip c-red">EMG</span>}
                      {a.military && <span className="chip c-purple">MIL</span>}
                    </span>
                    <span className="fl-type">{a.type || '—'}{a.reg ? ` · ${a.reg}` : ''}</span>
                    <span className="fl-alt">{fmtAlt(a.altFt)}</span>
                    <span className="fl-trk" style={{ color: c.live ? 'var(--green)' : 'var(--ink-3)' }}>
                      {a.onGround ? 'gnd' : compass(a.trackDeg)}
                    </span>
                  </button>
                );
              })}
              {shown.length > 60 && (
                <div className="small muted mt">Showing 60 of {shown.length} — narrow the radius to see fewer.</div>
              )}
            </div>
          )}

          {sel && (
            <>
              <div className="fl-hero">
                <div className="fl-hero-cs">{sel.flightNo || sel.callsign || sel.hex}</div>
                <div className="fl-hero-sub">
                  {[sel.type, sel.reg, sel.callsign].filter(Boolean).join(' · ')}
                </div>
                {/* The honesty line. A marker that stops moving looks identical
                    whether the aircraft landed or simply flew out of range. */}
                <div className="fl-cov" style={{
                  color: cov.state === 'live' ? 'var(--green)'
                    : cov.state === 'stale' ? 'var(--yellow)' : 'var(--red)',
                }}>
                  {cov.state === 'live' ? '● live signal' : `○ ${cov.text}`}
                </div>
              </div>

              <div className="fl-stats">
                <Stat label="Phase" value={ph.label} />
                <Stat label="Altitude" value={fmtAlt(sel.altFt)} />
                <Stat label="Speed" value={fmtSpeed(sel.groundSpeedKt)} />
                <Stat label="Vertical" value={fmtVs(sel.verticalRateFpm)} />
                <Stat label="Track" value={sel.trackDeg == null ? '—' : `${Math.round(sel.trackDeg)}° ${compass(sel.trackDeg)}`} />
                <Stat label="Squawk" value={sel.squawk || '—'} />
                {sel.machNo != null && <Stat label="Mach" value={sel.machNo.toFixed(3)} />}
                {sel.oatC != null && <Stat label="Outside air" value={`${sel.oatC}°C`} />}
                {sel.windKt != null && <Stat label="Wind" value={`${compass(sel.windDirDeg)} ${sel.windKt} kt`} />}
                <Stat label="Position" value={sel.lat == null ? '—' : `${sel.lat.toFixed(3)}, ${sel.lon.toFixed(3)}`} />
              </div>

              {sel.mlat && (
                <div className="small mt" style={{ color: 'var(--yellow)' }}>
                  Position is multilaterated, not broadcast — less precise than a normal ADS-B fix.
                </div>
              )}

              {/* Route is opt-in because the feed does not carry one. Guessing
                  origin and destination from a callsign would be fabrication. */}
              <div className="fl-route mt">
                <div className="small muted" style={{ marginBottom: 6 }}>
                  The ADS-B broadcast carries no origin or destination — type them to draw the route and get an ETA.
                </div>
                <div className="flex" style={{ gap: 6, flexWrap: 'wrap' }}>
                  <input style={{ width: 92 }} value={from} onChange={e => setFrom(e.target.value.toUpperCase())}
                    placeholder="From" maxLength={3} />
                  <input style={{ width: 92 }} value={to} onChange={e => setTo(e.target.value.toUpperCase())}
                    placeholder="To" maxLength={3} />
                  <span className="small muted" style={{ alignSelf: 'center' }}>
                    {A && B ? `${A.city} → ${B.city}` : 'IATA codes — DXB, BOM, DEL…'}
                  </span>
                </div>

                {route && prog && (
                  <>
                    <div className="fl-bar mt">
                      <div className="fl-bar-fill" style={{ width: `${(prog.pct * 100).toFixed(1)}%` }} />
                      <div className="fl-bar-plane" style={{ left: `${(prog.pct * 100).toFixed(1)}%` }}>✈</div>
                    </div>
                    <div className="flex" style={{ justifyContent: 'space-between' }}>
                      <span className="small muted">{A.city}</span>
                      <span className="small" style={{ color: 'var(--cyan)' }}>
                        {Math.round(prog.pct * 100)}% · {fmtKm(prog.leftKm)} to run
                        {eta != null && ` · ${fmtDuration(eta)}`}
                      </span>
                      <span className="small muted">{B.city}</span>
                    </div>
                    <div className="small muted mt" style={{ lineHeight: 1.55 }}>
                      Progress is measured by great-circle distance and the ETA by current ground speed.
                      Neither uses a published schedule, because free schedule data does not exist.
                    </div>
                  </>
                )}
                {from && to && !route && (
                  <div className="small mt" style={{ color: 'var(--yellow)' }}>
                    {!A && `${from} is not in the airport table. `}{!B && `${to} is not in the airport table. `}
                    Try a major airport code.
                  </div>
                )}
              </div>
            </>
          )}
        </Card>
      </div>

      <Card title="Where this comes from" color="var(--ink-3)">
        <div className="small muted" style={{ lineHeight: 1.6 }}>
          Positions are from <b>adsb.lol</b>, a volunteer network of ADS-B receivers — free, no
          account, no API key. Because it is volunteer-run, coverage follows where people live:
          dense over cities and coastlines, absent over open ocean. A Dubai–Mumbai flight really
          does go quiet for a stretch of the Arabian Sea, and this screen will say
          &ldquo;out of receiver coverage&rdquo; rather than leave the aircraft parked mid-sea.
          {meta?.at && (
            <> Last updated {fmtAge((Date.now() - meta.at) / 1000)} ago
              {meta.cache === 'hit' ? ' (from cache)' : ''}.</>
          )}
        </div>
      </Card>
    </>
  );
}

function Stat({ label, value }) {
  return (
    <div className="fl-stat">
      <div className="fl-stat-l">{label}</div>
      <div className="fl-stat-v">{value}</div>
    </div>
  );
}
