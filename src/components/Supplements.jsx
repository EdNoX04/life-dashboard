import React, { useState } from 'react';
import { Card } from './ui.jsx';
import { SUPPLEMENTS, suppByKey } from '../lib/healthdata.js';
import PixelIcon from './PixelIcon.jsx';

// The shelf. Nine pixel jars you tap to log a dose.
//
// One tap logs the typical serving rather than opening a form, because a
// supplement is the most boring thing in this tab and the logging has to cost
// nothing or it won't happen. The macros and micros ride along on the entry, so a
// scoop of whey moves the protein tile and a multivitamin fills in the
// micronutrient bars — same path a scanned food takes.
//
// Anything not on the shelf goes through "Other", which is the only one that asks
// for a name.

const z = n => String(n).padStart(2, '0');
const nowHM = () => { const d = new Date(); return `${z(d.getHours())}:${z(d.getMinutes())}`; };
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.round(performance.now()));

export default function Supplements({ log = [], onAdd, onRemove, busy = false }) {
  const [custom, setCustom] = useState(null); // null | {name, serving}

  const countOf = key => log.filter(s => s.key === key).length;

  const add = (s, name) => {
    onAdd({
      id: uid(),
      key: s.key,
      name: name || s.label,
      serving: s.serving,
      macros: s.macros || {},
      micros: s.micros || {},
      time: nowHM(),
      ts: new Date().toISOString(),
    });
  };

  const tap = s => {
    if (s.key === 'other') { setCustom({ name: '', serving: '1 dose' }); return; }
    add(s);
  };

  const saveCustom = () => {
    const name = (custom?.name || '').trim();
    if (!name) return;
    add({ ...suppByKey('other'), serving: custom.serving || '1 dose' }, name);
    setCustom(null);
  };

  return (
    <Card title="Supplements" color="var(--purple)"
      right={log.length ? <span className="chip c-purple">{log.length} today</span> : null}>

      <div className="supp-shelf">
        {SUPPLEMENTS.map(s => {
          const n = countOf(s.key);
          return (
            <button key={s.key} className={`supp-tile${n ? ' on' : ''}`} onClick={() => tap(s)} disabled={busy}
              title={`${s.note} — ${s.serving}`} style={n ? { borderColor: s.color } : undefined}>
              {n > 0 && <span className="supp-count" style={{ background: s.color }}>{n}</span>}
              <PixelIcon name={s.icon} size={46} glow={n ? s.color : null} dim={!n} />
              <span className="supp-label">{s.label}</span>
              <span className="supp-serving">{s.serving}</span>
            </button>
          );
        })}
      </div>

      {custom && (
        <div className="meal-form mt">
          <div className="meal-macros">
            <input autoFocus style={{ flex: '2 1 180px' }} placeholder="What is it? e.g. Magnesium glycinate"
              value={custom.name} onChange={e => setCustom({ ...custom, name: e.target.value })}
              onKeyDown={e => { if (e.key === 'Enter') saveCustom(); if (e.key === 'Escape') setCustom(null); }} />
            <input placeholder="Serving" value={custom.serving}
              onChange={e => setCustom({ ...custom, serving: e.target.value })} />
            <button className="btn btn-sm btn-green" onClick={saveCustom} disabled={busy}>+ Log</button>
            <button className="btn btn-sm" onClick={() => setCustom(null)}>cancel</button>
          </div>
        </div>
      )}

      {log.length === 0 && !custom && (
        <div className="small muted mt">
          Tap a jar to log today's dose. Servings are label typicals — protein and vitamins feed straight into
          your intake and micronutrient panels above.
        </div>
      )}

      {log.map(s => (
        <div className="row meal-row" key={s.id}>
          <PixelIcon name={suppByKey(s.key).icon} size={20} />
          <span style={{ flex: 1, minWidth: 0 }}>
            {s.name}
            {s.serving && <span className="muted small"> · {s.serving}</span>}
          </span>
          {s.macros?.protein ? <span className="chip c-pink">{s.macros.protein}p</span> : null}
          {s.macros?.kcal ? <span className="chip c-orange">{s.macros.kcal} kcal</span> : null}
          {s.micros && Object.keys(s.micros).length > 0 && <span className="chip c-purple" title="feeds micronutrients">✦</span>}
          <span className="chip c-cyan">{s.time}</span>
          <button className="btn btn-sm" onClick={() => onRemove(s.id)} disabled={busy}>✕</button>
        </div>
      ))}
    </Card>
  );
}
