import React, { useState } from 'react';
import * as amb from '../lib/ambient.js';
import * as bus from '../lib/audiobus.js';

// The ambience panel.
//
// It replaced a grid of on/off tiles and a single master volume. That interface
// could express exactly one mix — everything, equally loud — which is the one
// mix nobody wants. A soundscape is a balance: rain loud, café underneath it, a
// clock barely there. So each sound that is playing gets its own level, and each
// one sits somewhere around your head rather than in the middle of it.
//
// The controls only appear for sounds that are ON. An idle grid of eighteen
// tiles each with a slider is a mixing desk, and picking a background noise
// should not feel like operating one.

export default function Ambience({ keys = null, columns = 4 }) {
  const a = amb.useAmbient();
  const [placing, setPlacing] = useState(false);

  const list = (keys && keys.length ? keys : Object.keys(amb.SOUNDS))
    .filter(k => amb.SOUNDS[k])
    .map(k => ({ key: k, ...amb.SOUNDS[k] }));

  const groups = amb.GROUPS
    .map(([id, label]) => [label, list.filter(s => s.group === id)])
    .filter(([, items]) => items.length);
  const ungrouped = list.filter(s => !amb.GROUPS.some(([id]) => id === s.group));
  if (ungrouped.length) groups.push(['Other', ungrouped]);

  const on = a.keys;
  const vol = Math.round(a.vol * 100);

  return (
    <div className="ambience">
      {/* ---- presets: one click to a whole mix ---- */}
      <div className="flex" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {amb.PRESETS.map(p => (
          <button key={p.id}
            className={`btn btn-sm ${a.preset === p.id ? 'btn-cyan' : ''}`}
            onClick={() => amb.applyPreset(p.id)}>
            {p.icon} {p.label}
          </button>
        ))}
        {on.length > 0 && (
          <button className="btn btn-sm" onClick={() => amb.stopAll()}>■ stop all</button>
        )}
      </div>

      {/* ---- the sounds, grouped ---- */}
      {groups.map(([label, items]) => (
        <div key={label} className="amb-group">
          <div className="amb-group-h">{label}</div>
          <div className="amb-grid" style={{ gridTemplateColumns: `repeat(${columns},1fr)` }}>
            {items.map(s => (
              <button key={s.key}
                className={`amb-tile${on.includes(s.key) ? ' on' : ''}`}
                onClick={() => amb.toggle(s.key)}
                aria-pressed={on.includes(s.key)}>
                <span className="amb-ico">{s.icon}</span>
                <span className="amb-lbl">{s.label}</span>
              </button>
            ))}
          </div>
        </div>
      ))}

      {/* ---- per-sound mixer, only for what is actually playing ---- */}
      {on.length > 0 && (
        <div className="amb-mix">
          {on.map(k => {
            const s = amb.SOUNDS[k];
            if (!s) return null;
            const level = Math.round(amb.volumeOf(k) * 100);
            const angle = amb.angleOf(k);
            return (
              <div key={k} className="amb-row">
                <span className="amb-row-name"><span className="amb-ico-sm">{s.icon}</span>{s.label}</span>
                <input type="range" min="0" max="100" value={level}
                  aria-label={`${s.label} level`}
                  onChange={e => amb.setVolume(k, +e.target.value / 100)} />
                <span className="amb-row-val">{level}</span>
                {placing && a.spatial && (
                  <>
                    <input type="range" min="0" max="359" value={angle} className="amb-angle"
                      aria-label={`${s.label} direction`}
                      onChange={e => amb.setAngle(k, +e.target.value)} />
                    <span className="amb-row-dir">{bus.bearing(angle)}</span>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ---- master ---- */}
      <div className="flex mt" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="small muted">MASTER</span>
        <input type="range" min="0" max="100" value={vol}
          aria-label="Master ambience volume"
          onChange={e => amb.setMasterVolume(+e.target.value / 100)} style={{ flex: 1, minWidth: 110 }} />
        <span className="small">{vol}</span>
        <button className={`btn btn-sm ${a.spatial ? 'btn-purple' : ''}`}
          onClick={() => amb.setSpatial(!a.spatial)}
          title="Place each sound around you — best with headphones">
          {a.spatial ? '◉ 3D on' : '○ 3D off'}
        </button>
        {a.spatial && on.length > 0 && (
          <button className={`btn btn-sm ${placing ? 'btn-purple' : ''}`} onClick={() => setPlacing(v => !v)}>
            {placing ? 'done' : '⌖ place'}
          </button>
        )}
        {placing && (
          <button className="btn btn-sm" onClick={() => amb.resetPlacement()}>reset</button>
        )}
      </div>

      <div className="small muted mt" style={{ lineHeight: 1.55 }}>
        {a.spatial
          ? 'Each sound sits somewhere around you and drifts slowly — wear headphones for it to work.'
          : 'Flat stereo. Turn 3D on for sounds placed around your head.'}
        {' '}Mix as many as you like — they keep playing when you switch tabs, with controls next to your XP bar.
      </div>
    </div>
  );
}
