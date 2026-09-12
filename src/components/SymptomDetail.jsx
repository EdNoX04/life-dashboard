import React, { useMemo, useState } from 'react';
import {
  normaliseEpisode, severitySeries, trend, medsDuring, compareAll,
  describe, severityWord, isOngoing, SEVERITY_MAX,
} from '../lib/symptoms.js';

// One episode, opened up: how bad each day, what was taken, and what the rest
// of the body was doing.
//
// The comparison panel is the part to be careful with, and the care is in
// lib/symptoms.js — below three days inside the episode and a fortnight of
// baseline it returns no figure at all, so there is nothing here to render.
// That is deliberate: a number on screen gets quoted and acted on no matter
// what is printed under it, so the only safe thing to do with a comparison that
// cannot be supported is to not produce one.
//
// What IS rendered in that case is the reason. "4 days of sleep_hours outside
// it — a baseline needs at least 14" tells him the feature is working and what
// would make it say something, which a blank panel does not.

const METRIC_LABEL = {
  sleep_hours: 'Sleep', steps: 'Steps', resting_hr: 'Resting HR', active_energy: 'Active energy',
};
const fmt = (v, m) => (m === 'sleep_hours' ? `${v.toFixed(1)}h` : Math.round(v).toLocaleString('en-IN'));

export default function SymptomDetail({ episode, medLog = {}, healthRows = null, healthWhy = null, today, onScore, busy }) {
  const ep = useMemo(() => normaliseEpisode(episode || {}), [episode]);
  const [day, setDay] = useState(today);
  const series = severitySeries(ep, today);
  const t = trend(ep, today);
  const meds = medsDuring(ep, medLog, today);
  const cmp = useMemo(
    () => (healthRows ? compareAll(ep, healthRows, today) : null),
    [ep, healthRows, today],
  );
  const peak = Math.max(0, ...series.map(s => s.value ?? 0));

  return (
    <div className="sym-detail">
      <div className="sym-line">{describe(ep, today)}</div>

      {/* ---- severity, day by day ---- */}
      <div className="sym-bars">
        {series.map(s => (
          <div className="sym-bar" key={s.date} title={`${s.date} — ${s.value == null ? 'not scored' : `${s.value}/10 (${severityWord(s.value)})`}`}>
            {/* A day with no score is drawn as an empty slot, never as a zero
                bar. Zero means the symptom was gone, and showing them the same
                draws a recovery that never happened. */}
            <div className={`sym-fill${s.value == null ? ' unscored' : ''}`}
              style={s.value == null ? undefined : { height: `${Math.max(6, (s.value / SEVERITY_MAX) * 100)}%` }} />
            <span className="sym-day">{s.date.slice(8)}</span>
          </div>
        ))}
      </div>
      {!t.known && <div className="small" style={{ color: 'var(--ink-3)' }}>{t.why}</div>}

      {/* ---- score a day ---- */}
      {isOngoing(ep, today) && (
        <div className="row sym-score">
          <input type="date" value={day} max={today} min={ep.from || undefined}
            onChange={e => setDay(e.target.value)} />
          <span className="small" style={{ color: 'var(--ink-2)' }}>how bad?</span>
          {Array.from({ length: SEVERITY_MAX + 1 }, (_, i) => (
            <button key={i} className={`btn btn-sm${ep.severity[day] === i ? ' btn-green' : ''}`}
              disabled={busy} onClick={() => onScore(ep.id, day, i)}>{i}</button>
          ))}
        </div>
      )}

      {/* ---- what was taken ---- */}
      {meds.length > 0 && (
        <div className="sym-meds">
          <div className="sym-h">Taken during this</div>
          {meds.map(m => (
            <div className="row small" key={m.name}>
              <span style={{ flex: 1 }}>{m.name}</span>
              <span className="chip">{m.count} dose{m.count === 1 ? '' : 's'} over {m.days} day{m.days === 1 ? '' : 's'}</span>
            </div>
          ))}
          {/* Said once, plainly, under the list. These are the things taken
              while it was going on — the app is not claiming any of them did
              anything, and it never will from this data. */}
          <div className="small" style={{ color: 'var(--ink-3)' }}>
            What was taken while this was going on. Nothing here says any of it helped.
          </div>
        </div>
      )}

      {/* ---- the body, inside vs outside ---- */}
      {cmp && (
        <div className="sym-cmp">
          <div className="sym-h">Your numbers during this</div>
          {cmp.shown.map(c => (
            <div className="row small" key={c.metric}>
              <span style={{ flex: 1 }}>{METRIC_LABEL[c.metric] || c.metric}</span>
              <span className="chip">{fmt(c.inside, c.metric)} vs {fmt(c.outside, c.metric)}</span>
              <span className="chip" style={{ color: 'var(--ink-3)' }}>n={c.n.inside}/{c.n.outside}</span>
            </div>
          ))}
          {/* The withheld ones are listed rather than dropped. A panel that
              shows only what passed looks like the whole picture. */}
          {cmp.withheld.map(w => (
            <div className="small" key={w.metric} style={{ color: 'var(--ink-3)' }}>
              {METRIC_LABEL[w.metric] || w.metric}: {w.why}
            </div>
          ))}
          {cmp.shown.length > 0 && (
            <div className="small" style={{ color: 'var(--ink-3)', marginTop: 4 }}>
              These differed. That is all it means — being ill changes sleep and
              movement too, so this does not say which way round anything went.
            </div>
          )}
        </div>
      )}
      {/* Three different reasons there is no comparison, and they are not the
          same news: still loading, could not be read, or nothing recorded yet.
          Collapsing them into one sentence is how a broken read gets mistaken
          for an empty diary for a month. */}
      {!cmp && (
        <div className="small" style={{ color: healthWhy ? 'var(--orange)' : 'var(--ink-3)' }}>
          {healthWhy || 'No sleep, steps or heart-rate data yet, so there is nothing to line this up against.'}
        </div>
      )}
    </div>
  );
}
