import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, Empty } from '../components/ui.jsx';
import { useCollection } from '../lib/hooks.js';
import { upsertMemory } from '../lib/db.js';
import FlightGlobe from '../components/flight/FlightGlobe.jsx';
import FlightPicker from '../components/flight/FlightPicker.jsx';
import FlightCard from '../components/flight/FlightCard.jsx';
import {
  parseFeed, positioned, sortForList, feedSummary, routeQuery, toCallsigns,
  coverage, phaseOf, progress, etaMinutes, fmtDuration,
  compass, fmtAlt, fmtSpeed, fmtKm, fmtVs, fmtAge,
  airport, PRESETS, clampRadius,
} from '../lib/flights.js';
import {
  isoDate, dayLabel, trackability, flightsFromCalendar, planKey,
  parseSchedule, delayMinutes, fmtLocal, SCHEDULE_UNAVAILABLE, hubFor,
} from '../lib/flightplan.js';

// FLIGHT RADAR.
//
// Two sources, kept visibly apart because they are different kinds of fact:
//
//   adsb.lol      — free, keyless, volunteer ADS-B. Where an aeroplane IS.
//                   Live only, and only where a receiver can hear it.
//   AeroDataBox   — optional, needs a key. What a flight is SCHEDULED to do:
//                   terminal, gate, baggage belt, times.
//
// Everything works without the second one; the schedule panel then says what
// is missing and why rather than showing blanks.

const POLL_MS = 15000;
const MODES = [
  { id: 'area', label: 'Area' },
  { id: 'mil', label: 'Military' },
  { id: 'emg', label: 'Squawk 7700' },
];

export default function Flights() {
  const today = isoDate();

  const [plan, setPlan] = useState(null);          // the flight we are tracking
  const [mode, setMode] = useState('area');        // browse mode when no plan
  const [preset, setPreset] = useState(PRESETS[0]);
  const [radius, setRadius] = useState(250);
  const [list, setList] = useState([]);
  const [sel, setSel] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [live, setLive] = useState(true);
  const [meta, setMeta] = useState(null);
  const [sched, setSched] = useState(null);        // { state, data, note }
  const [saved, setSaved] = useState([]);
  const [nearby, setNearby] = useState(null);   // the airline's other flights, when ours is not up
  const timer = useRef(null);
  const abort = useRef(null);

  // ---- saved plans + calendar flights -----------------------------------
  const { items: savedMem } = useCollection('memory', { filter: 'key=eq.flight_plans', order: 'key' });
  const { items: calMem } = useCollection('memory', { filter: 'key=eq.calendar_events', order: 'key' });
  useEffect(() => {
    const v = savedMem?.[0]?.value;
    if (Array.isArray(v)) setSaved(v);
  }, [savedMem]);

  // Flights the user never typed in: pulled out of the Google Calendar events
  // this app already syncs. Deliberately conservative about what counts as a
  // flight — see flightsFromCalendar.
  const calFlights = useMemo(
    () => flightsFromCalendar(calMem?.[0]?.value?.events || [], today),
    [calMem, today],
  );

  const myFlights = useMemo(() => {
    const seen = new Set();
    return [...calFlights, ...saved].filter(f => {
      const k = planKey(f);
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [calFlights, saved]);

  async function savePlan(p) {
    const next = [...saved.filter(x => planKey(x) !== planKey(p)), p]
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-40);
    setSaved(next);
    await upsertMemory('flight_plans', next).catch(() => {});
  }
  async function dropPlan(p) {
    const next = saved.filter(x => planKey(x) !== planKey(p));
    setSaved(next);
    await upsertMemory('flight_plans', next).catch(() => {});
  }

  // ---- what to fetch -----------------------------------------------------
  const url = useCallback(() => {
    if (plan) {
      const t = trackability(plan.date, today);
      if (!t.can) return null;                       // nothing live to look for
      return `/api/flight?op=callsign&q=${encodeURIComponent(plan.callsign)}`;
    }
    if (mode === 'mil') return '/api/flight?op=mil';
    if (mode === 'emg') return '/api/flight?op=sqk&q=7700';
    return `/api/flight?op=point&lat=${preset.lat}&lon=${preset.lon}&r=${clampRadius(radius)}`;
  }, [plan, mode, preset, radius, today]);

  const load = useCallback(async () => {
    const u = url();
    if (!u) { setList([]); setMeta(null); setBusy(false); return; }
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
      setMeta({ cache: j._cache, warn: j._warn, at: Date.now() });
      // When tracking one flight, select it automatically — and keep the
      // selection's data fresh across polls rather than holding the record
      // from whenever it was first clicked.
      setSel(s => {
        if (plan) return parsed[0] || null;
        return s ? parsed.find(a => a.hex === s.hex) || s : s;
      });
      setErr(j._warn ? `showing cached data — ${j._warn}` : '');
    } catch (e) {
      if (e.name !== 'AbortError') setErr(String(e.message || e).slice(0, 160));
    } finally {
      if (!ctl.signal.aborted) setBusy(false);
    }
  }, [url, plan]);

  useEffect(() => { load(); }, [load]);

  // When a tracked flight finds nothing, look at the airline's hub and show
  // what that airline IS flying right now.
  //
  // A flight only transmits during the hours it is airborne, so an empty
  // result is the CORRECT answer most of the day — and an empty screen is
  // indistinguishable from a broken app. This is what makes the difference
  // legible: if six other Emirates flights appear, the pipe demonstrably
  // works and yours simply is not up yet.
  useEffect(() => {
    if (!plan || busy || list.length > 0) { setNearby(null); return; }
    if (!trackability(plan.date, today).can) { setNearby(null); return; }
    const hub = hubFor(plan.iata);
    const a = airport(hub);
    if (!a) { setNearby({ state: 'nohub' }); return; }
    let dead = false;
    (async () => {
      setNearby({ state: 'loading', hub: a });
      try {
        const r = await fetch(`/api/flight?op=point&lat=${a.lat}&lon=${a.lon}&r=250`);
        const j = await r.json();
        if (dead) return;
        const mine = parseFeed(j).filter(x => x.airline === plan.icao);
        setNearby({ state: 'ok', hub: a, list: sortForList(mine), total: (j.ac || []).length });
      } catch {
        if (!dead) setNearby({ state: 'error', hub: a });
      }
    })();
    return () => { dead = true; };
  }, [plan?.id, busy, list.length, today]);
  useEffect(() => {
    clearInterval(timer.current);
    if (!live) return;
    // Never poll a hidden tab — this is a background ornament most of its life.
    timer.current = setInterval(() => { if (!document.hidden) load(); }, POLL_MS);
    return () => clearInterval(timer.current);
  }, [live, load]);

  // ---- schedule (optional provider) --------------------------------------
  useEffect(() => {
    if (!plan) { setSched(null); return; }
    let dead = false;
    (async () => {
      setSched({ state: 'loading' });
      try {
        const r = await fetch(`/api/flight?op=schedule&q=${encodeURIComponent(plan.iata + plan.number)}&date=${plan.date}`);
        const j = await r.json();
        if (dead) return;
        if (r.status === 501) { setSched({ state: 'nokey' }); return; }
        if (!r.ok) { setSched({ state: 'error', note: j.error }); return; }
        const first = (j.flights || [])[0];
        setSched(first ? { state: 'ok', data: parseSchedule(first) } : { state: 'none', note: j._note });
      } catch (e) {
        if (!dead) setSched({ state: 'error', note: String(e.message || e) });
      }
    })();
    return () => { dead = true; };
  }, [plan?.id]);

  const shown = useMemo(() => sortForList(list), [list]);
  const withPos = useMemo(() => positioned(shown), [shown]);
  const summary = useMemo(() => feedSummary(list), [list]);

  // Route comes from the plan when we know it, otherwise from the schedule.
  const A = airport(plan?.from || sched?.data?.departure?.airport);
  const B = airport(plan?.to || sched?.data?.arrival?.airport);
  const route = A && B ? { from: A, to: B } : null;

  const cov = sel ? coverage(sel) : null;
  const ph = sel ? phaseOf(sel) : null;
  const prog = sel && route ? progress(A, B, sel) : null;
  const eta = prog ? etaMinutes(prog.leftKm, sel.groundSpeedKt) : null;
  const track = plan ? trackability(plan.date, today) : null;

  function startTracking(p) { setPlan(p); setSel(null); setErr(''); }
  function stopTracking() { setPlan(null); setSel(null); setSched(null); setErr(''); }

  return (
    <>
      <h1 className="tab-title">FLIGHT RADAR</h1>
      <p className="tab-sub">Live aircraft from volunteer ADS-B receivers. Track your flight, or just watch the sky. ✈</p>

      {!plan && (
        <Card title="Track a flight" color="var(--cyan)">
          <FlightPicker today={today} onTrack={startTracking} onSave={savePlan} />
        </Card>
      )}

      {!plan && myFlights.length > 0 && (
        <Card title="My flights" color="var(--yellow)"
          right={<span className="small muted">{calFlights.length} from calendar</span>}>
          <div className="fl-mine">
            {myFlights.map(f => {
              const t = trackability(f.date, today);
              return (
                <div key={planKey(f)} className={`fl-mine-row${t.state === 'past' ? ' past' : ''}`}>
                  <span className="fl-mine-no">{f.flightNo}</span>
                  <span className="fl-mine-air">{f.airline}</span>
                  <span className="fl-mine-rt">
                    {f.from && f.to ? `${f.from} → ${f.to}` : <span className="muted">route unknown</span>}
                  </span>
                  <span className="fl-mine-day">{dayLabel(f.date, today)}</span>
                  {f.source === 'calendar'
                    ? <span className="chip c-yellow">cal</span>
                    : <button className="btn btn-sm" title="remove" onClick={() => dropPlan(f)}>✕</button>}
                  <button className="btn btn-sm btn-cyan" disabled={!t.can}
                    title={t.text} onClick={() => startTracking(f)}>
                    {t.can ? 'Track' : t.state === 'past' ? 'flown' : 'waiting'}
                  </button>
                </div>
              );
            })}
          </div>
          <div className="small muted mt" style={{ lineHeight: 1.55 }}>
            Flights are read out of the Google Calendar events this app already syncs — anything
            with a real airline code and a flight-shaped context. Only today&rsquo;s can be tracked
            live; the rest sit here until their day comes.
          </div>
        </Card>
      )}

      {plan && (
        <>
          <FlightCard
            plan={plan}
            ac={sel}
            sched={sched?.state === 'ok' ? sched.data : null}
            route={route}
            live={live}
            busy={busy}
            onToggleLive={() => setLive(v => !v)}
            onRefresh={load}
            onStop={stopTracking}
          />
          {!track.can && <div className="small mt" style={{ color: 'var(--yellow)' }}>{track.text}</div>}
          {sched?.state === 'nokey' && (
            <div className="fl-sched fl-sched-off mt">
              <div className="fl-sched-h">TERMINAL · GATE · BELT</div>
              <div className="small" style={{ lineHeight: 1.55 }}>{SCHEDULE_UNAVAILABLE}</div>
            </div>
          )}
          {sched?.state === 'none' && (
            <div className="small muted mt">No schedule found for {plan.flightNo} on {dayLabel(plan.date, today).toLowerCase()}.</div>
          )}
          {err && <div className="small mt" style={{ color: 'var(--yellow)' }}>{err}</div>}
          {track.can && !sel && !busy && (
            <div className="fl-none mt">
              <div className="fl-none-h">Not transmitting as {plan.callsign} right now</div>
              <div className="small" style={{ lineHeight: 1.6, color: 'var(--ink-2)' }}>
                A flight only appears while it is actually airborne, so for most of the day this
                is the correct answer rather than a fault. It has probably not taken off yet, or
                has already landed.
              </div>
              <NearbyFleet nearby={nearby} plan={plan} onPick={setSel} />
            </div>
          )}
        </>
      )}

      <div className="fl-split">
        <Card title="Radar" color="var(--purple)" right={<span className="small muted">{summary}</span>}>
          <FlightGlobe aircraft={withPos} selected={sel} route={route} onPick={setSel} size={360} />
          <div className="small muted mt" style={{ lineHeight: 1.55, textAlign: 'center' }}>
            Coastlines and borders are Natural Earth data. Drag to spin, scroll to zoom —
            every aircraft position on it is real and live.
          </div>
        </Card>

        <Card title={plan ? 'Nearby traffic' : sel ? 'Live position' : 'In range'} color="var(--cyan)"
          right={sel && !plan ? <button className="btn btn-sm" onClick={() => setSel(null)}>← list</button> : null}>
          {!plan && !sel && (
            <>
              <div className="flex" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                {MODES.map(m => (
                  <button key={m.id} className={`btn btn-sm ${mode === m.id ? 'btn-cyan' : ''}`}
                    onClick={() => { setMode(m.id); setSel(null); }}>{m.label}</button>
                ))}
              </div>
              {mode === 'area' && (
                <>
                  <div className="flex" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                    {PRESETS.map(p => (
                      <button key={p.id} className={`btn btn-sm ${preset.id === p.id ? 'btn-purple' : ''}`}
                        onClick={() => { setPreset(p); setSel(null); }}>{p.label}</button>
                    ))}
                  </div>
                  <div className="flex" style={{ gap: 8, alignItems: 'center', marginBottom: 8 }}>
                    <span className="small muted">RADIUS</span>
                    <input type="range" min="25" max="250" step="25" value={radius}
                      onChange={e => setRadius(+e.target.value)} style={{ flex: 1 }} />
                    <span className="small">{radius} nm</span>
                  </div>
                </>
              )}
              {mode === 'emg' && (
                <div className="small" style={{ color: 'var(--yellow)', lineHeight: 1.55, marginBottom: 8 }}>
                  7700 is the general emergency squawk. Usually empty — and when it is not, it is
                  most often a light aircraft with a minor problem rather than anything dramatic.
                </div>
              )}
            </>
          )}

          {!sel && shown.length === 0 && !busy && !plan && <Empty icon="✈" text="Nothing in range." />}

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
                <div className="fl-hero-sub">{[sel.type, sel.reg, sel.callsign].filter(Boolean).join(' · ')}</div>
                {/* A marker that stops moving looks identical whether the
                    aircraft landed or simply flew out of range. Say which. */}
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

              {route && prog && (
                <div className="fl-route mt">
                  <div className="fl-bar">
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
                    Progress is great-circle distance and the ETA is from current ground speed —
                    neither uses a published schedule.
                  </div>
                </div>
              )}
            </>
          )}
        </Card>
      </div>

      <Card title="Where this comes from" color="var(--ink-3)">
        <div className="small muted" style={{ lineHeight: 1.6 }}>
          Positions come from <b>adsb.lol</b>, a volunteer network of ADS-B receivers — free, no
          account, no key. Coverage follows where people live: dense over cities and coastlines,
          absent over open ocean. A Dubai–Mumbai flight really does go quiet for a stretch of the
          Arabian Sea, and this screen says &ldquo;out of receiver coverage&rdquo; rather than
          leaving the aircraft parked mid-sea. Terminal, gate and baggage belt are not in the ADS-B
          broadcast at all and come from a separate schedule provider.
          {meta?.at && <> Last updated {fmtAge((Date.now() - meta.at) / 1000)} ago.</>}
        </div>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------- schedule

function SchedulePanel({ sched }) {
  if (!sched) return null;
  if (sched.state === 'loading') return <div className="small muted mt">looking up the schedule…</div>;

  if (sched.state === 'nokey') {
    return (
      <div className="fl-sched fl-sched-off mt">
        <div className="fl-sched-h">TERMINAL · GATE · BELT</div>
        <div className="small" style={{ lineHeight: 1.55 }}>{SCHEDULE_UNAVAILABLE}</div>
      </div>
    );
  }
  if (sched.state === 'none') {
    return <div className="small muted mt">No schedule found for this flight and date.</div>;
  }
  if (sched.state === 'error') {
    return <div className="small mt" style={{ color: 'var(--yellow)' }}>Schedule unavailable — {sched.note}</div>;
  }

  const d = sched.data;
  if (!d) return null;
  const dep = d.departure, arr = d.arrival;
  const dDelay = delayMinutes(dep), aDelay = delayMinutes(arr);

  return (
    <div className="fl-sched mt">
      <div className="fl-sched-grid">
        <SideCol side={dep} title="Departure" delay={dDelay} />
        <SideCol side={arr} title="Arrival" delay={aDelay} arrival />
      </div>
      <div className="small muted mt" style={{ lineHeight: 1.5 }}>
        {d.status && <>Status <b>{d.status}</b>. </>}
        {d.aircraft && <>{d.aircraft}{d.reg ? ` · ${d.reg}` : ''}. </>}
        Gates and belts are assigned late and change — treat anything here as the airport&rsquo;s
        current intention, not a guarantee.
      </div>
    </div>
  );
}

function SideCol({ side, title, delay, arrival }) {
  if (!side) return <div className="fl-side"><div className="fl-sched-h">{title}</div><div className="small muted">not reported</div></div>;
  const t = fmtLocal(side.revised || side.scheduled);
  const sch = fmtLocal(side.scheduled);
  return (
    <div className="fl-side">
      <div className="fl-sched-h">{title} · {side.airport || '—'}</div>
      <div className="fl-time">
        {t || '—'}
        {delay != null && delay !== 0 && (
          <span className="fl-delay" style={{ color: delay > 0 ? 'var(--red)' : 'var(--green)' }}>
            {delay > 0 ? `+${delay}m` : `${delay}m`}
          </span>
        )}
      </div>
      {/* Times are the airport's own clock, which is the number on the
          departure board — not converted into the reader's timezone. */}
      {delay != null && delay !== 0 && sch && <div className="fl-was">was {sch} local</div>}
      <div className="fl-slots">
        <Slot label="Terminal" v={side.terminal} />
        <Slot label={arrival ? 'Belt' : 'Gate'} v={arrival ? side.belt : side.gate} />
        {!arrival && side.checkInDesk && <Slot label="Check-in" v={side.checkInDesk} />}
      </div>
    </div>
  );
}

// A blank slot says "not assigned yet" rather than showing an empty box —
// the difference between "no gate exists" and "no gate has been chosen" is
// the whole question you are asking when you look at this.
const Slot = ({ label, v }) => (
  <div className="fl-slot">
    <div className="fl-slot-l">{label}</div>
    <div className={`fl-slot-v${v ? '' : ' none'}`}>{v || 'not yet'}</div>
  </div>
);

/**
 * The airline's other traffic, shown when the searched flight is not up.
 *
 * This exists to answer the question the empty screen actually raises, which
 * is not "where is my flight" but "is this thing even working". A live list of
 * the same airline's aircraft answers it immediately, and gives something to
 * click instead of a dead end.
 */
function NearbyFleet({ nearby, plan, onPick }) {
  if (!nearby) return null;
  if (nearby.state === 'loading') {
    return <div className="small muted mt">checking what {plan.airline} has airborne…</div>;
  }
  if (nearby.state === 'nohub') {
    return <div className="small muted mt">No hub on file for {plan.airline}, so there is nothing to compare against.</div>;
  }
  if (nearby.state === 'error') {
    return <div className="small muted mt">Could not reach the radar for a second look.</div>;
  }
  if (!nearby.list?.length) {
    return (
      <div className="small mt" style={{ color: 'var(--ink-3)', lineHeight: 1.55 }}>
        No {plan.airline} aircraft are airborne near {nearby.hub.city} either — though
        {' '}{nearby.total} other aircraft are, so the radar itself is working.
      </div>
    );
  }
  return (
    <div className="fl-fleet mt">
      <div className="fl-fleet-h">
        {nearby.list.length} {plan.airline} {nearby.list.length === 1 ? 'flight' : 'flights'} airborne
        near {nearby.hub.city} right now — so the radar is working
      </div>
      <div className="fl-fleet-list">
        {nearby.list.slice(0, 12).map(a => (
          <button key={a.hex} className="fl-fleet-item" onClick={() => onPick?.(a)}>
            <span className="fl-fleet-no">{a.flightNo || a.callsign}</span>
            <span className="fl-fleet-alt">{fmtAlt(a.altFt)}</span>
          </button>
        ))}
      </div>
    </div>
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
