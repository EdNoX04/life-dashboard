// The accounts screen: where your money sits, and what that changes about it.
//
// Three rendering decisions, each one guarding a specific way this screen could
// mislead:
//
//   1. THE UNASSIGNED PILE IS DRAWN AS AN ACCOUNT, not as a leftovers tray at
//      the bottom in smaller type. It is the account most likely to be wrong —
//      it is where everything starts — and shrinking it is exactly how it stays
//      wrong for six months.
//
//   2. WHEN A SCOPE FILTER IS ON, THE SCOPE SENTENCE IS PRINTED ABOVE THE
//      NUMBERS, not below them and not in a tooltip. By the time a reader
//      reaches a caption under a total they have already read the total as
//      their whole portfolio. The correction has to arrive first.
//
//   3. DELETE SAYS WHAT IT WILL DO BEFORE IT DOES IT, in terms of holdings
//      rather than in terms of the account. "Delete account?" and "these 6
//      holdings go back to unassigned; nothing is removed from your book" are
//      the same operation described at two different levels of honesty.
//
// The assign control is a plain <select> per holding rather than drag-and-drop,
// because drag-and-drop on a phone is how a position ends up in the wrong
// account without anyone noticing, and this is a list you edit twice a year.

import React, { useEffect, useMemo, useState } from 'react';
import { Card, Empty, StatTile, useMoneyVisible, EyeBtn, money } from '../ui.jsx';
import {
  ACCOUNT_KINDS, kindOf, UNASSIGNED, SPLIT_CAVEAT, DISCLAIMER,
  loadAccounts, saveAccounts, saveMap,
  addAccount, editAccount, removeAccount, assign,
  accountSummary, concentrationNote, scopeLabel, scopeNote, filterRows, accountTotals,
} from '../../lib/accounts.js';

const pct = v => (v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`);
const gainColor = v => (v == null ? 'var(--ink-3)' : v >= 0 ? 'var(--green)' : 'var(--red)');

// ------------------------------------------------------------------ editor

export function AccountForm({ initial, existingCount, onSave, onCancel }) {
  const [label, setLabel] = useState((initial && initial.label) || '');
  const [kind, setKind] = useState((initial && initial.kind) || 'broker');
  const [note, setNote] = useState((initial && initial.note) || '');
  const k = kindOf(kind);

  return (
    <div className="acc-form">
      <div className="acc-form-row">
        <label className="acc-lbl">Name</label>
        <input
          className="acc-in" value={label} maxLength={40}
          placeholder={existingCount ? 'e.g. Zerodha, NPS, SBI FDs' : 'e.g. Zerodha'}
          onChange={e => setLabel(e.target.value)}
        />
      </div>
      <div className="acc-form-row">
        <label className="acc-lbl">Type</label>
        <select className="acc-in" value={kind} onChange={e => setKind(e.target.value)}>
          {ACCOUNT_KINDS.map(x => <option key={x.key} value={x.key}>{x.label}</option>)}
        </select>
      </div>
      {/* The kind's meaning is shown at the moment of choosing, not in a legend
          somewhere else. The whole reason the kinds are about tax and access
          rather than brand names is lost if the reader never reads them. */}
      <p className="acc-kind-note" style={{ color: k.color }}>{k.note}</p>
      <div className="acc-form-row">
        <label className="acc-lbl">Note</label>
        <input
          className="acc-in" value={note} maxLength={200}
          placeholder="optional — anything you want to remember about it"
          onChange={e => setNote(e.target.value)}
        />
      </div>
      <div className="acc-form-btns">
        <button
          className="btn btn-sm btn-green"
          disabled={!label.trim()}
          onClick={() => onSave({ label: label.trim(), kind, note: note.trim() })}
        >{initial ? 'SAVE' : 'ADD ACCOUNT'}</button>
        <button className="btn btn-sm" onClick={onCancel}>CANCEL</button>
      </div>
      <p className="acc-caveat">{SPLIT_CAVEAT}</p>
    </div>
  );
}

// ------------------------------------------------------------- account card

export function AccountCard({ acct, visible, cur, onEdit, onDelete, expanded, onToggle }) {
  const t = acct.totals;
  const [confirming, setConfirming] = useState(false);
  const k = kindOf(acct.kind);

  return (
    <div
      className={`acc-card${acct.unassigned ? ' acc-card-loose' : ''}`}
      style={{ borderLeftColor: acct.color }}
    >
      <button className="acc-card-head" onClick={onToggle}>
        <span className="acc-card-id">
          <span className="acc-card-label" style={{ color: acct.color }}>{acct.label}</span>
          <span className="acc-card-kind">
            {acct.unassigned ? 'not in an account yet' : k.label}
            {' · '}{t.count} holding{t.count === 1 ? '' : 's'}
          </span>
        </span>
        <span className="acc-card-nums">
          <span className="acc-card-val">{money(t.marketValue, visible, cur)}</span>
          <span className="acc-card-share">{acct.share.toFixed(1)}% of book</span>
        </span>
        <span className="acc-card-ret" style={{ color: gainColor(t.unrealisedPct) }}>
          {/* A null return prints as a reason, not as a dash the reader has to
              interpret and not as 0.00%, which would be a claim. */}
          {t.unrealisedPct == null
            ? <span className="acc-card-nocost">no cost basis</span>
            : pct(t.unrealisedPct)}
        </span>
        <span className="acc-card-caret">{expanded ? '▾' : '▸'}</span>
      </button>

      {expanded && (
        <div className="acc-card-body">
          {acct.note && <p className="acc-card-note">{acct.note}</p>}
          {!acct.unassigned && <p className="acc-card-kindnote">{k.note}</p>}
          {t.costNote && <p className="acc-card-warn">{t.costNote}</p>}

          <div className="acc-stats">
            <StatTile label="Value" value={money(t.marketValue, visible, cur)} color="var(--cyan)" />
            <StatTile
              label="Invested" color="var(--ink-2)"
              value={t.invested == null ? '—' : money(t.invested, visible, cur)}
              note={t.invested == null ? 'not recorded' : null}
            />
            <StatTile
              label="Unrealised" color={gainColor(t.unrealised)}
              value={t.unrealised == null ? '—' : money(t.unrealised, visible, cur)}
            />
            <StatTile
              label="Day" color={gainColor(t.dayGain)}
              value={money(t.dayGain, visible, cur)} note={pct(t.dayPct)}
            />
          </div>

          <div className="acc-holdings">
            {t.count === 0
              ? <Empty icon="?" text="Nothing assigned here yet." />
              : acct.rows.map(r => (
                <div key={r.ticker} className="acc-hold">
                  <span className="acc-hold-t">{r.ticker}</span>
                  <span className="acc-hold-v">{money(r.marketValue, visible, cur)}</span>
                  <span className="acc-hold-g" style={{ color: gainColor(r.unrealisedPct) }}>
                    {r.unrealisedPct == null ? '—' : pct(r.unrealisedPct)}
                  </span>
                </div>
              ))}
          </div>

          {!acct.unassigned && (
            <div className="acc-card-btns">
              <button className="btn btn-sm btn-cyan" onClick={onEdit}>EDIT</button>
              {confirming ? (
                <span className="acc-confirm">
                  {/* Decision 3: the consequence is stated in holdings, before
                      the button that causes it, and it is stated accurately —
                      this really is non-destructive. */}
                  <span className="acc-confirm-txt">
                    {t.count
                      ? `${t.count} holding${t.count === 1 ? '' : 's'} go back to unassigned. Nothing is removed from your book.`
                      : 'This account holds nothing.'}
                  </span>
                  <button className="btn btn-sm btn-pink" onClick={() => { setConfirming(false); onDelete(); }}>REMOVE</button>
                  <button className="btn btn-sm" onClick={() => setConfirming(false)}>KEEP</button>
                </span>
              ) : (
                <button className="btn btn-sm" onClick={() => setConfirming(true)}>REMOVE</button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ assigner

export function Assigner({ rows, accounts, map, onAssign, visible, cur }) {
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const needle = q.trim().toUpperCase();
    const base = needle ? rows.filter(r => r.ticker.toUpperCase().includes(needle)) : rows;
    // Unassigned first: this list exists to be emptied, so the work to be done
    // sorts to the top rather than being hunted for among rows already filed.
    return [...base].sort((a, b) => {
      const ua = map[a.ticker] ? 1 : 0, ub = map[b.ticker] ? 1 : 0;
      return ua - ub || b.marketValue - a.marketValue;
    });
  }, [rows, map, q]);

  const left = rows.filter(r => !map[r.ticker]).length;

  return (
    <div className="acc-assign">
      <div className="acc-assign-top">
        <input
          className="acc-in acc-search" value={q} placeholder="filter by ticker"
          onChange={e => setQ(e.target.value)}
        />
        <span className="acc-assign-left">
          {left ? `${left} still unassigned` : 'everything is filed'}
        </span>
      </div>
      <div className="acc-assign-rows">
        {list.length === 0
          ? <Empty icon="?" text="No holdings match." />
          : list.map(r => (
            <div key={r.ticker} className={`acc-arow${map[r.ticker] ? '' : ' acc-arow-loose'}`}>
              <span className="acc-arow-t">{r.ticker}</span>
              <span className="acc-arow-v">{money(r.marketValue, visible, cur)}</span>
              <select
                className="acc-in acc-sel"
                value={map[r.ticker] || UNASSIGNED}
                onChange={e => onAssign(r.ticker, e.target.value)}
              >
                <option value={UNASSIGNED}>— unassigned —</option>
                {accounts.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
            </div>
          ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ screen

export default function Accounts({ rows = [], cur = '$' }) {
  const [visible, toggleVisible] = useMoneyVisible();
  const [accounts, setAccounts] = useState([]);
  const [map, setMap] = useState({});
  const [orphans, setOrphans] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [scope, setScope] = useState('all');
  const [tab, setTab] = useState('accounts');

  useEffect(() => {
    let alive = true;
    loadAccounts().then(({ accounts: a, map: m, orphans: o }) => {
      if (!alive) return;
      setAccounts(a); setMap(m); setOrphans(o); setLoaded(true);
      // An orphan clean-up is a change to stored state, so it is written back
      // rather than being re-derived on every open.
      if (o.length) saveMap(m);
    }).catch(() => setLoaded(true));
    return () => { alive = false; };
  }, []);

  const persistAccounts = next => { setAccounts(next); saveAccounts(next); };
  const persistMap = next => { setMap(next); saveMap(next); };

  const summary = accountSummary(rows, map, accounts);
  const conc = concentrationNote(summary);

  // Scoped rows and the sentence that has to accompany them. Both derived here
  // so they cannot get out of step: there is no path that renders scoped numbers
  // without also having the note in hand.
  const scoped = filterRows(rows, map, scope);
  const scopedTotals = accountTotals(scoped);
  const note = scopeNote(accounts, scope, scopedTotals);

  if (!loaded) return <Card title="Accounts" color="var(--cyan)"><p className="acc-loading">Reading your accounts…</p></Card>;

  return (
    <div className="acc-wrap">
      <p className="acc-disclaimer">{DISCLAIMER}</p>

      <Card
        title="Accounts"
        color="var(--cyan)"
        right={<EyeBtn visible={visible} onClick={toggleVisible} />}
      >
        {accounts.length === 0 && !adding ? (
          <div className="acc-zero">
            <p className="acc-zero-txt">
              No accounts yet. All {rows.length} of your holdings sit in one
              undifferentiated pile, which is fine — accounts only earn their
              keep once the tax or access rules differ between them.
            </p>
            <button className="btn btn-sm btn-green" onClick={() => setAdding(true)}>ADD YOUR FIRST ACCOUNT</button>
          </div>
        ) : (
          <>
            <span className="seg acc-seg">
              <button className={`seg-btn${tab === 'accounts' ? ' on' : ''}`} onClick={() => setTab('accounts')}>Accounts</button>
              <button className={`seg-btn${tab === 'assign' ? ' on' : ''}`} onClick={() => setTab('assign')}>Assign holdings</button>
            </span>

            {/* Decision 2: above the numbers. */}
            {note && <p className="acc-scope-note">{note}</p>}

            {tab === 'accounts' && (
              <>
                <div className="acc-scope">
                  <button className={`seg-btn${scope === 'all' ? ' on' : ''}`} onClick={() => setScope('all')}>All accounts</button>
                  {accounts.map(a => (
                    <button
                      key={a.id}
                      className={`seg-btn${scope === a.id ? ' on' : ''}`}
                      onClick={() => setScope(a.id)}
                    >{a.label}</button>
                  ))}
                  {summary.some(s => s.unassigned) && (
                    <button
                      className={`seg-btn${scope === UNASSIGNED ? ' on' : ''}`}
                      onClick={() => setScope(UNASSIGNED)}
                    >Unassigned</button>
                  )}
                </div>

                {scope !== 'all' && (
                  <div className="acc-scoped">
                    <StatTile label={`${scopeLabel(accounts, scope)} — value`} value={money(scopedTotals.marketValue, visible, cur)} color="var(--cyan)" />
                    <StatTile
                      label="Unrealised" color={gainColor(scopedTotals.unrealised)}
                      value={scopedTotals.unrealised == null ? '—' : money(scopedTotals.unrealised, visible, cur)}
                      note={scopedTotals.unrealisedPct == null ? 'no cost basis' : pct(scopedTotals.unrealisedPct)}
                    />
                    <StatTile label="Holdings" value={String(scopedTotals.count)} color="var(--ink-2)" />
                  </div>
                )}

                {orphans.length > 0 && (
                  <p className="acc-warn">
                    {orphans.length} holding{orphans.length === 1 ? ' was' : 's were'} assigned to an
                    account that no longer exists ({orphans.slice(0, 5).join(', ')}
                    {orphans.length > 5 ? '…' : ''}). {orphans.length === 1 ? 'It has' : 'They have'} been
                    returned to unassigned rather than hidden.
                  </p>
                )}

                <div className="acc-cards">
                  {summary.map(a => (
                    <AccountCard
                      key={a.id} acct={a} visible={visible} cur={cur}
                      expanded={openId === a.id}
                      onToggle={() => setOpenId(openId === a.id ? null : a.id)}
                      onEdit={() => { setEditingId(a.id); setAdding(false); }}
                      onDelete={() => {
                        const res = removeAccount(accounts, map, a.id);
                        persistAccounts(res.accounts);
                        persistMap(res.map);
                        if (scope === a.id) setScope('all');
                        if (openId === a.id) setOpenId(null);
                      }}
                    />
                  ))}
                </div>

                {conc && <p className="acc-conc">{conc}</p>}

                {editingId && (
                  <AccountForm
                    initial={accounts.find(a => a.id === editingId)}
                    existingCount={accounts.length}
                    onCancel={() => setEditingId(null)}
                    onSave={draft => { persistAccounts(editAccount(accounts, editingId, draft)); setEditingId(null); }}
                  />
                )}
                {!editingId && !adding && (
                  <button className="btn btn-sm btn-green acc-add" onClick={() => setAdding(true)}>+ ADD ACCOUNT</button>
                )}
              </>
            )}

            {tab === 'assign' && (
              <Assigner
                rows={rows} accounts={accounts} map={map} visible={visible} cur={cur}
                onAssign={(t, id) => persistMap(assign(map, t, id))}
              />
            )}
          </>
        )}

        {adding && (
          <AccountForm
            existingCount={accounts.length}
            onCancel={() => setAdding(false)}
            onSave={draft => { persistAccounts(addAccount(accounts, draft)); setAdding(false); }}
          />
        )}
      </Card>
    </div>
  );
}
