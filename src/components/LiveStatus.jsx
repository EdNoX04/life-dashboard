import React from 'react';
import { useCollection } from '../lib/hooks.js';

// Live "what am I doing right now" chip, driven by memory.health_live which the
// 15-min iOS Shortcut writes (latest HR, steps in the last hour, sleeping flag).
// The app infers the state so the dashboard feels alive.
export default function LiveStatus({ className = '' }) {
  const { items } = useCollection('memory', { filter: 'key=eq.health_live', order: 'key' });
  const live = items?.[0]?.value;
  if (!live?.at) return null;

  const ageMin = Math.max(0, Math.round((Date.now() - new Date(live.at).getTime()) / 60000));
  const hr = live.hr != null ? Math.round(Number(live.hr)) : null;
  const steps = Number(live.steps_hour || 0);
  const hour = new Date().getHours();
  const stale = ageMin > 50;

  let label = 'Awake', icon = '⚡', color = 'var(--cyan)';
  if (live.asleep) { label = 'Sleeping'; icon = '😴'; color = 'var(--purple)'; }
  else if (live.workout || (hr != null && hr > 115)) { label = 'Working out'; icon = '🏋'; color = 'var(--red)'; }
  else if (steps > 250 || (hr != null && hr > 95)) { label = 'Active'; icon = '🚶'; color = 'var(--green)'; }
  else if (hour >= 23 || hour < 6) { label = 'Winding down'; icon = '🌙'; color = 'var(--purple)'; }

  return (
    <div className={`live-status ${stale ? 'stale' : ''} ${className}`} style={{ '--c': stale ? 'var(--ink-3)' : color }}>
      <span className="ls-dot" />
      <span className="ls-ico">{stale ? '·' : icon}</span>
      <span className="ls-label">{stale ? 'Health idle' : label}</span>
      {hr != null && !stale && <span className="ls-hr">♥ {hr}</span>}
      {steps > 0 && !stale && label === 'Active' && <span className="ls-hr">{steps} st/h</span>}
      <span className="ls-age">{ageMin <= 1 ? 'live' : `${ageMin}m`}</span>
    </div>
  );
}
