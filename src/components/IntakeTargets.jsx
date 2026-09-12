import React, { useState } from 'react';
import { targets, against, ACTIVITY } from '../lib/intake.js';

// What the intake tiles are numbers OF.
//
// Until now "2,100 kcal" sat on screen with nothing to read it against, while
// the micronutrient panel below had a target for all thirteen of its entries.
//
// Three rules this component holds to, and they are the reason it is small:
//
//   1. NO TARGET WITHOUT A BODY. An incomplete profile shows the form, not a
//      figure derived from a default 70kg person. lib/intake.js returns no
//      number at all in that case, so there is nothing here to render anyway.
//   2. NO VERDICT. The bar fills and stops. Nothing goes red for being past the
//      line, nothing congratulates, nothing is a streak. Food is the one place
//      in this app where a scoring system does real harm.
//   3. THE REFERENCE SAYS WHAT IT IS. "The energy this body uses in a day, not
//      a plan" is carried on the object itself, so it cannot be dropped by a
//      screen that forgot to print it.

const pctText = share => (share == null ? '' : `${Math.round(share * 100)}%`);

export default function IntakeTargets({ totals, profile = {}, onSave, busy }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    weightKg: profile.weightKg ?? '', heightCm: profile.heightCm ?? '',
    age: profile.age ?? '', sex: profile.sex || 'male', activity: profile.activity || 'light',
  });

  const t = targets(profile);
  const cmp = against(totals, t);

  function save() {
    onSave({
      weightKg: Number(form.weightKg) || null, heightCm: Number(form.heightCm) || null,
      age: Number(form.age) || null, sex: form.sex, activity: form.activity,
    });
    setOpen(false);
  }

  if (!t.known) {
    return (
      <div className="intake-tgt">
        {open ? (
          <div className="med-form">
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <input type="number" placeholder="Weight kg" value={form.weightKg} onChange={e => setForm(f => ({ ...f, weightKg: e.target.value }))} style={{ width: 96 }} />
              <input type="number" placeholder="Height cm" value={form.heightCm} onChange={e => setForm(f => ({ ...f, heightCm: e.target.value }))} style={{ width: 96 }} />
              <input type="number" placeholder="Age" value={form.age} onChange={e => setForm(f => ({ ...f, age: e.target.value }))} style={{ width: 72 }} />
              <select value={form.sex} onChange={e => setForm(f => ({ ...f, sex: e.target.value }))}>
                <option value="male">male</option><option value="female">female</option>
              </select>
              <select value={form.activity} onChange={e => setForm(f => ({ ...f, activity: e.target.value }))}>
                {ACTIVITY.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
              </select>
              <button className="btn btn-sm btn-green" onClick={save} disabled={busy}>Save</button>
            </div>
            <div className="small" style={{ color: 'var(--ink-3)' }}>
              Used once, for a reference figure. Nothing is stored anywhere but your own dashboard.
            </div>
          </div>
        ) : (
          <div className="small" style={{ color: 'var(--ink-3)' }}>
            {/* Names exactly what is missing. "Add your details" is a shrug;
                "needs your height and age" is a thing to do. */}
            No reference yet — needs your {t.missing.join(', ')}.{' '}
            <button className="btn btn-sm" onClick={() => setOpen(true)}>Add</button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="intake-tgt">
      {cmp.rows.map(r => (
        <div className="tgt-row" key={r.key}>
          <span className="tgt-label">{r.label}</span>
          <span className="tgt-bar">
            {/* Capped at 100% width so a big day does not draw a bar through
                the card, but the NUMBER beside it is never capped — the bar is
                a glance, the figure is the truth. */}
            <span className="tgt-fill" style={{ width: `${Math.min(100, (r.share || 0) * 100)}%` }} />
          </span>
          <span className="tgt-num">{r.have}<i> / {r.want} {r.unit}</i></span>
          <span className="tgt-pct">{pctText(r.share)}</span>
        </div>
      ))}
      <div className="small" style={{ color: 'var(--ink-3)', marginTop: 4 }}>
        {t.basis}{' '}
        <button className="btn btn-sm" onClick={() => setOpen(o => !o)}>edit</button>
      </div>
      {open && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
          <input type="number" placeholder="Weight kg" value={form.weightKg} onChange={e => setForm(f => ({ ...f, weightKg: e.target.value }))} style={{ width: 96 }} />
          <input type="number" placeholder="Height cm" value={form.heightCm} onChange={e => setForm(f => ({ ...f, heightCm: e.target.value }))} style={{ width: 96 }} />
          <input type="number" placeholder="Age" value={form.age} onChange={e => setForm(f => ({ ...f, age: e.target.value }))} style={{ width: 72 }} />
          <select value={form.activity} onChange={e => setForm(f => ({ ...f, activity: e.target.value }))}>
            {ACTIVITY.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
          </select>
          <button className="btn btn-sm btn-green" onClick={save} disabled={busy}>Save</button>
        </div>
      )}
    </div>
  );
}
