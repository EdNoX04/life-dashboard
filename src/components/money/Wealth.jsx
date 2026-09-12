import React, { useMemo, useState } from 'react';
import { Card, Empty, StatTile, useMoneyVisible, money } from '../ui.jsx';
import { useCollection } from '../../lib/hooks.js';
import * as db from '../../lib/db.js';
import {
  SLEEVES, sleeveOf, normaliseEntry, sleeves as buildSleeves,
  netWorth, mix, drift, headline,
} from '../../lib/wealth.js';

// Wealth — the whole balance sheet, not the brokerage account.
//
// Forty views on this tab and none of them answered "what am I worth". Every
// one is about the investment BOOK; the bank balance, the deposits, EPF, NPS,
// the funds held outside the book, the gold and anything owed were all absent.
//
// Two screen decisions worth stating, because both are the opposite of what a
// wealth app usually does:
//
//   1. WHAT COULD NOT BE VALUED IS ON THE SCREEN, not in a tooltip. A net worth
//      missing a sleeve is a different number from a net worth, and the page
//      says which one it is showing. The unvalued DEBT line is louder than the
//      unvalued asset one on purpose: an asset you missed makes you look
//      poorer, a debt you missed makes you look richer.
//   2. THERE IS NO SUGGESTED ALLOCATION. Not 60/40, not "balanced", not a
//      nudge. The drift table appears only against a target Neel typed in
//      himself; with none, it says the app has no opinion. Money is read-only
//      here, and a default target would be advice with arithmetic in front.

const ENTRIES_KEY = 'wealth_entries';
const TARGET_KEY = 'wealth_target';
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.round(performance.now()));
const todayStr = () => { const d = new Date(); const z = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`; };
const blank = () => ({ sleeve: 'cash', label: '', amount: '', at: todayStr() });

export default function Wealth({ book = null, fx = null }) {
  const { items: entMem, refresh: rEnt } = useCollection('memory', { filter: `key=eq.${ENTRIES_KEY}`, order: 'key' });
  const { items: tgtMem, refresh: rTgt } = useCollection('memory', { filter: `key=eq.${TARGET_KEY}`, order: 'key' });
  const { items: cryptoMem } = useCollection('memory', { filter: 'key=eq.binance_ledger', order: 'key' });
  const [vis, toggleVis] = useMoneyVisible();
  const [form, setForm] = useState(blank());
  const [busy, setBusy] = useState(false);
  const [showTarget, setShowTarget] = useState(false);

  const entries = entMem?.[0]?.value?.list || [];
  const target = tgtMem?.[0]?.value || null;
  const crypto = cryptoMem?.[0]?.value || null;
  const today = todayStr();

  const rows = useMemo(
    () => buildSleeves({ book, crypto, entries, base: 'INR', fx, today }),
    [book, crypto, entries, fx, today],
  );
  const nw = useMemo(() => netWorth(rows), [rows]);
  const spread = useMemo(() => mix(rows), [rows]);
  const off = useMemo(() => drift(spread, target), [spread, target]);

  async function save(list) {
    setBusy(true);
    try { await db.upsertMemory(ENTRIES_KEY, { list }); await rEnt(); }
    catch (e) { alert('Could not save — check connection.'); }
    setBusy(false);
  }
  const add = () => {
    if (form.amount === '' || Number.isNaN(Number(form.amount))) return;
    save([...entries, normaliseEntry({ ...form, id: uid() })]);
    setForm(blank());
  };
  const remove = id => save(entries.filter(e => e.id !== id));

  async function saveTarget(next) {
    setBusy(true);
    try { await db.upsertMemory(TARGET_KEY, next); await rTgt(); } catch { /* shown by the value not changing */ }
    setBusy(false);
  }

  const rupees = n => money(n, vis, '₹');

  return (
    <>
      <Card title="Net worth" color="var(--green)"
        right={<button className="btn btn-sm" onClick={toggleVis}>{vis ? 'hide' : 'show'}</button>}>
        <div className="wealth-head">{vis ? headline(nw) : '₹••••••'}</div>

        <div className="tile-row">
          <StatTile label="Assets" value={rupees(nw.assets)} note="what you hold" color="var(--green)" />
          <StatTile label="Owed" value={rupees(nw.liabilities)} note="loans & debt" color="var(--red)" />
          <StatTile label="Net" value={rupees(nw.net)} note={nw.complete ? 'assets minus debt' : 'of what could be valued'} color="var(--cyan)" />
        </div>

        {/* The unvalued sleeves, on the page rather than in a tooltip. A net
            worth missing a sleeve is a different number, and this says which. */}
        {nw.excluded.length > 0 && (
          <div className="wealth-gap">
            {nw.missingDebt && (
              // First and in orange: this is the error that flatters you.
              <div style={{ color: 'var(--orange)' }}>
                ⚠ Something you owe could not be valued, so this number is higher than the truth, not lower.
              </div>
            )}
            Left out: {nw.excluded.map(e => `${e.label} (${e.why})`).join(' · ')}
          </div>
        )}
        {nw.stale.length > 0 && (
          <div className="wealth-gap">
            Last updated a while ago: {nw.stale.join(', ')} — not wrong, but not today either.
          </div>
        )}
      </Card>

      <Card title="Where it sits" color="var(--purple)">
        {spread.rows.length === 0 && <Empty icon="◧" text="Nothing valued yet." note="Add what you hold below, and the split appears here." />}
        {spread.rows.map(r => (
          <div className="wealth-bar" key={r.key}>
            <span className="wealth-bar-label">{r.label}</span>
            <span className="wealth-bar-track">
              <span className="wealth-bar-fill" style={{ width: `${r.pct}%`, background: r.color }} />
            </span>
            <span className="wealth-bar-pct">{r.pct.toFixed(1)}%</span>
            <span className="wealth-bar-val">{rupees(r.value)}</span>
          </div>
        ))}
        {spread.rows.length > 0 && (
          <div className="small" style={{ color: 'var(--ink-3)', marginTop: 6 }}>
            Of assets — a debt is not a slice of a pie.
            {!nw.complete && ' And of what could be valued, so these add to 100% of a smaller number than your real one.'}
          </div>
        )}
      </Card>

      <Card title="Against your target" color="var(--yellow)"
        right={<button className="btn btn-sm" onClick={() => setShowTarget(t => !t)}>{showTarget ? 'close' : 'set'}</button>}>
        {!off.known && <div className="small" style={{ color: 'var(--ink-2)' }}>{off.why}</div>}

        {off.known && off.rows.map(r => (
          <div className="row small" key={r.key}>
            <span style={{ flex: 1 }}>{r.label}</span>
            <span className="chip">{r.actual.toFixed(1)}% vs {r.target.toFixed(1)}%</span>
            {/* A number, not a verdict. No colour for "too much", no arrow
                telling him which way to move — that is the line between
                reporting and advising, and this tab stays on one side of it. */}
            <span style={{ minWidth: 64, textAlign: 'right', color: 'var(--ink-2)' }}>
              {r.diff >= 0 ? '+' : '−'}{Math.abs(r.diff).toFixed(1)}
            </span>
          </div>
        ))}
        {off.known && off.normalised && (
          <div className="small" style={{ color: 'var(--ink-3)', marginTop: 4 }}>
            Your target adds to {Math.round(off.sum)}%, so it has been read as the shape you meant rather than as everything being adrift.
          </div>
        )}

        {showTarget && (
          <div className="wealth-target">
            {SLEEVES.filter(s => s.kind === 'asset').map(s => (
              <label className="row small" key={s.key}>
                <span style={{ flex: 1 }}>{s.label}</span>
                <input type="number" min="0" max="100" style={{ width: 72 }}
                  defaultValue={target?.[s.key] ?? ''}
                  onBlur={e => saveTarget({ ...(target || {}), [s.key]: Number(e.target.value) || 0 })} />
                <span className="small">%</span>
              </label>
            ))}
            <div className="small" style={{ color: 'var(--ink-3)' }}>
              These are yours. Nothing here suggests a number, and nothing acts on one.
            </div>
          </div>
        )}
      </Card>

      <Card title="What you hold" color="var(--cyan)">
        <div className="wealth-form">
          <select value={form.sleeve} onChange={e => setForm(f => ({ ...f, sleeve: e.target.value }))}>
            {SLEEVES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <input placeholder="What is it — HDFC savings, Education loan…" value={form.label}
            onChange={e => setForm(f => ({ ...f, label: e.target.value }))} />
          <input type="number" inputMode="decimal" placeholder="Amount ₹" value={form.amount}
            onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
          <input type="date" value={form.at} max={today}
            onChange={e => setForm(f => ({ ...f, at: e.target.value }))} title="When this was last true" />
          <button className="btn btn-sm btn-green" disabled={busy || form.amount === ''} onClick={add}>+ Add</button>
        </div>
        <div className="small" style={{ color: 'var(--ink-3)', marginBottom: 8 }}>
          Stocks and ETFs come from your book, and crypto from the Binance sync — everything else is typed here.
          A loan goes in as a plain number; it is subtracted because of the sleeve, not because of a minus sign.
        </div>

        {entries.length === 0 && <Empty icon="₹" text="Nothing added yet." />}
        {SLEEVES.map(s => {
          const mine = entries.filter(e => e.sleeve === s.key);
          if (!mine.length) return null;
          return (
            <div key={s.key}>
              <div className="card-title mt" style={{ fontSize: 11 }}>
                <span className="sq" style={{ background: s.color }} />{s.label}
              </div>
              {mine.map(e => (
                <div className="row small" key={e.id}>
                  <span style={{ flex: 1 }}>
                    {e.label}
                    {e.at && <i style={{ color: 'var(--ink-3)' }}> · as of {e.at}</i>}
                  </span>
                  {/* An entry with no amount is shown as such rather than as
                      zero — it is a line nobody has filled in, and the total
                      already knows to leave it out. */}
                  <span className="chip">{e.amount == null ? 'no amount' : rupees(e.amount)}</span>
                  <button className="btn btn-sm" disabled={busy} onClick={() => remove(e.id)}>✕</button>
                </div>
              ))}
            </div>
          );
        })}
      </Card>
    </>
  );
}
