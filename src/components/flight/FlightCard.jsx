import React from 'react';
import {
  coverage, phaseOf, progress, etaMinutes, fmtDuration,
  compass, fmtAlt, fmtSpeed, fmtKm, fmtVs, haversineKm,
} from '../../lib/flights.js';
import { delayMinutes, fmtLocal } from '../../lib/flightplan.js';

// The flight card — the thing you actually look at.
//
// Modelled on Flighty's boarding-pass layout: two airports, big times, and a
// route line with the aeroplane on it. The difference is what happens when a
// fact is missing, which for us is often, because we are assembling this from
// two sources that each know only half of it:
//
//   the live radar knows where it IS but not where it is going
//   the schedule knows the plan but not where the aircraft is
//
// So every slot renders three ways — a value, "not yet" (the airport has not
// assigned one), or "—" (we have no provider for it at all). Those are three
// genuinely different facts and collapsing them into a blank box is how a
// tracker ends up quietly lying.

const STATUS = {
  scheduled: { label: 'SCHEDULED', c: 'var(--ink-3)' },
  boarding: { label: 'BOARDING', c: 'var(--yellow)' },
  ground: { label: 'ON GROUND', c: 'var(--yellow)' },
  climb: { label: 'DEPARTED', c: 'var(--green)' },
  cruise: { label: 'IN FLIGHT', c: 'var(--cyan)' },
  level: { label: 'IN FLIGHT', c: 'var(--cyan)' },
  descent: { label: 'DESCENDING', c: 'var(--pink)' },
  landed: { label: 'LANDED', c: 'var(--ink-3)' },
  notup: { label: 'NOT AIRBORNE', c: 'var(--ink-3)' },
  lost: { label: 'NO SIGNAL', c: 'var(--red)' },
};

/**
 * The single status word for the flight.
 *
 * Derived from what we can actually observe rather than asserted. If the
 * aircraft is not transmitting we say NOT AIRBORNE, not "on time" — we have no
 * idea whether it is on time, and a green "on time" pill over an aircraft
 * nobody can hear is exactly the kind of confident nonsense this app avoids.
 */
export function statusOf(ac, sched) {
  if (!ac) {
    if (sched?.status && /cancel/i.test(sched.status)) return { label: 'CANCELLED', c: 'var(--red)' };
    if (sched?.status && /arriv|land/i.test(sched.status)) return STATUS.landed;
    return STATUS.notup;
  }
  const cov = coverage(ac);
  if (cov.state === 'lost') return STATUS.lost;
  return STATUS[phaseOf(ac).key] || STATUS.cruise;
}

export default function FlightCard({ plan, ac, sched, route, onStop, live, onToggleLive, onRefresh, busy }) {
  const st = statusOf(ac, sched);
  const cov = ac ? coverage(ac) : null;
  const dep = sched?.departure;
  const arr = sched?.arrival;

  const A = route?.from;
  const B = route?.to;
  const prog = ac && A && B ? progress(A, B, ac) : null;
  const eta = prog ? etaMinutes(prog.leftKm, ac.groundSpeedKt) : null;
  const totalKm = A && B ? haversineKm(A, B) : null;

  const depDelay = delayMinutes(dep);
  const arrDelay = delayMinutes(arr);

  // The plane's position on the bar. With no live fix we do not guess from the
  // clock — an aircraft that never took off would slide across the bar on
  // schedule alone, which is a fabricated journey.
  const pct = prog ? prog.pct * 100 : null;

  return (
    <div className="fc">
      <div className="fc-top">
        <div className="fc-id">
          <div className="fc-no">{plan?.flightNo || ac?.flightNo || ac?.callsign}</div>
          <div className="fc-sub">
            {[plan?.airline, sched?.aircraft || ac?.type, ac?.reg || sched?.reg]
              .filter(Boolean).join(' · ') || plan?.callsign}
          </div>
        </div>
        <div className="fc-actions">
          <span className="fc-status" style={{ color: st.c, borderColor: st.c }}>{st.label}</span>
          <button className={`btn btn-sm ${live ? 'btn-green' : ''}`} onClick={onToggleLive}>
            {live ? '● live' : '‖ hold'}
          </button>
          <button className="btn btn-sm" onClick={onRefresh} disabled={busy}>{busy ? '…' : '↻'}</button>
          <button className="btn btn-sm" onClick={onStop}>✕</button>
        </div>
      </div>

      {/* ---------- the boarding-pass strip ---------- */}
      <div className="fc-route">
        <Side
          code={A?.iata || dep?.airport || plan?.from}
          city={A?.city || dep?.airportName}
          time={fmtLocal(dep?.revised || dep?.scheduled)}
          was={depDelay ? fmtLocal(dep?.scheduled) : null}
          delay={depDelay}
        />

        <div className="fc-line">
          <div className="fc-track">
            <div className="fc-track-bg" />
            {pct != null && <div className="fc-track-done" style={{ width: `${pct}%` }} />}
            {pct != null
              ? <div className="fc-plane" style={{ left: `${pct}%` }}>✈</div>
              : <div className="fc-plane fc-plane-idle">✈</div>}
          </div>
          <div className="fc-line-meta">
            {prog
              ? <>{Math.round(prog.pct * 100)}% · {fmtKm(prog.leftKm)} to run{eta != null && ` · ${fmtDuration(eta)} left`}</>
              : totalKm
                ? <>{fmtKm(totalKm)} great-circle</>
                : <span className="muted">route not set</span>}
          </div>
        </div>

        <Side
          code={B?.iata || arr?.airport || plan?.to}
          city={B?.city || arr?.airportName}
          time={fmtLocal(arr?.revised || arr?.scheduled)}
          was={arrDelay ? fmtLocal(arr?.scheduled) : null}
          delay={arrDelay}
          right
        />
      </div>

      {/* ---------- terminal / gate / belt ---------- */}
      <div className="fc-slots">
        <Slot label="Terminal" v={dep?.terminal} have={!!sched} side="dep" />
        <Slot label="Gate" v={dep?.gate} have={!!sched} side="dep" />
        <Slot label="Check-in" v={dep?.checkInDesk} have={!!sched} side="dep" />
        <Slot label="Terminal" v={arr?.terminal} have={!!sched} side="arr" />
        <Slot label="Belt" v={arr?.belt} have={!!sched} side="arr" />
      </div>

      {/* ---------- live telemetry ---------- */}
      {ac ? (
        <>
          <div className="fc-tele">
            <T l="Altitude" v={fmtAlt(ac.altFt)} />
            <T l="Speed" v={fmtSpeed(ac.groundSpeedKt)} />
            <T l="Vertical" v={fmtVs(ac.verticalRateFpm)} />
            <T l="Heading" v={ac.trackDeg == null ? '—' : `${Math.round(ac.trackDeg)}° ${compass(ac.trackDeg)}`} />
            {ac.machNo != null && <T l="Mach" v={ac.machNo.toFixed(3)} />}
            {ac.oatC != null && <T l="Outside" v={`${ac.oatC}°C`} />}
            {ac.windKt != null && <T l="Wind" v={`${compass(ac.windDirDeg)} ${ac.windKt}kt`} />}
            {ac.squawk && <T l="Squawk" v={ac.squawk} />}
          </div>
          <div className="fc-cov" style={{
            color: cov.state === 'live' ? 'var(--green)' : cov.state === 'stale' ? 'var(--yellow)' : 'var(--red)',
          }}>
            {cov.state === 'live' ? '● live ADS-B signal' : `○ ${cov.text}`}
            {ac.mlat && ' · multilaterated position, less precise than a normal fix'}
          </div>
        </>
      ) : null}
    </div>
  );
}

function Side({ code, city, time, was, delay, right }) {
  return (
    <div className={`fc-side${right ? ' fc-side-r' : ''}`}>
      <div className="fc-code">{code || '—'}</div>
      <div className="fc-time">
        {time || <span className="fc-notime">no time</span>}
      </div>
      {delay != null && delay !== 0 && (
        <div className="fc-delay" style={{ color: delay > 0 ? 'var(--red)' : 'var(--green)' }}>
          {delay > 0 ? `+${delay} min` : `${delay} min`}{was && ` · was ${was}`}
        </div>
      )}
      <div className="fc-city">{city || ''}</div>
    </div>
  );
}

/**
 * Three states, deliberately distinguishable:
 *   a value      — the airport has assigned one
 *   "not yet"    — we have schedule data, and it has no value for this field
 *   "—"          — we have no schedule provider at all, so we cannot know
 */
function Slot({ label, v, have }) {
  const text = v || (have ? 'not yet' : '—');
  const cls = v ? '' : have ? ' soon' : ' none';
  return (
    <div className={`fc-slot${cls}`}>
      <div className="fc-slot-l">{label}</div>
      <div className="fc-slot-v">{text}</div>
    </div>
  );
}

const T = ({ l, v }) => (
  <div className="fc-t"><span className="fc-t-l">{l}</span><span className="fc-t-v">{v}</span></div>
);
