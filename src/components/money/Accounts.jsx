// The accounts screen: where your money sits, and what that changes about it.
//
// REBUILT, because it had two scope controls. The tab strip above it set one
// selection and a second row inside this card set another, and they never
// spoke — so choosing INDstocks at the top left this card listing every
// account, including the US one, under a header that said INDstocks. Two
// sources of truth for one question is the same failure as two derivations of a
// total: they disagree and the reader cannot tell which half is lying.
//
// There is now ONE selection, owned by the tab. This card is a function of it,
// and it renders one of two entirely different screens:
//
//   ALL      — every account side by side, plus the tools to create and assign.
//   ONE      — a dossier for that account and NOTHING about any other. Not a
//              filtered version of the overview: a different screen, because
//              the questions are different. "How is my money split" and "what
//              is in this account" do not want the same layout.
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
  accountDossier,
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

export function AccountCard({ acct, visible, cur, onEdit, onDelete, expanded, onToggle, onOpen }) {
  const t = acct.totals;
  const [confirming, setConfirming] = useState(false);
  const k = kindOf(acct.kind);

  return (
    <div
      className={`acc-card${acct.unassigned ? ' acc-card-loose' : ''}`}
      style={{ borderLeftColor: acct.color }}
    >
      {/* The card body still expands in place — a quick look without leaving
          the comparison. The label opens the account's own screen, which is the
          thing that was missing entirely: there was nowhere to go. */}
      <button className="acc-card-head" onClick={onOpen || onToggle}>
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
      </button>
      <button className="acc-card-caret" onClick={onToggle}
        title={expanded ? 'collapse' : 'peek without leaving this screen'}>
        {expanded ? '▾' : '▸'}
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

// ------------------------------------------------------------------ dossier

// One account, in full. Deliberately not a filtered overview — a reader who has
// picked an account is asking "what is IN this", and the answer is a holdings
// table, not a card that has to be expanded.
export function AccountDossier({ d, visible, cur, onBack, onEdit, onAssign }) {
  const { account, totals, holdings, currencies, concentration: conc, kind } = d;

  return (
    <>
      <div className="acd-head" style={{ borderColor: account.color || kind.color }}>
        <button className="acd-back" onClick={onBack}>← all accounts</button>
        <h3 className="acd-name" style={{ color: account.color || kind.color }}>{account.label}</h3>
        <span className="acd-kind" style={{ color: kind.color, borderColor: kind.color }}>{kind.label}</span>
        {!account.unassigned && !account.missing && onEdit && (
          <button className="btn btn-sm acd-edit" onClick={onEdit}>edit</button>
        )}
      </div>

      {account.note && <p className="acd-note">{account.note}</p>}
      {/* What the TYPE means for this money — tax, access, lock-in. The reason
          the kinds are about rules rather than brand names is lost if it is
          only ever shown in the create form. */}
      {kind.note && <p className="acd-kindnote" style={{ borderColor: kind.color }}>{kind.note}</p>}

      {account.missing && (
        <p className="acc-warn">
          This account is not in your list any more. Its holdings are shown so nothing
          silently disappears — reassign them, or recreate the account.
        </p>
      )}

      {d.empty ? (
        <Empty
          icon="◇"
          text={account.unassigned
            ? 'Nothing is unassigned — every holding is in an account.'
            : 'No holdings in this account yet. Use “Assign holdings” to put something in it.'}
        />
      ) : (
        <>
          <div className="tile-row">
            <StatTile label="Value" value={money(totals.marketValue, visible, cur)}
              note={d.shareOfBook == null ? '' : `${d.shareOfBook.toFixed(1)}% of everything you own`}
              color="var(--cyan)" />
            <StatTile label="Unrealised" color={gainColor(totals.unrealised)}
              value={totals.unrealised == null ? '—' : money(totals.unrealised, visible, cur)}
              note={totals.unrealisedPct == null ? 'no cost basis recorded' : pct(totals.unrealisedPct)} />
            <StatTile label="Today" color={gainColor(totals.dayGain)}
              value={totals.dayGain == null ? '—' : money(totals.dayGain, visible, cur)}
              note={totals.dayPct == null ? 'no quotes yet' : pct(totals.dayPct)} />
            <StatTile label="Holdings" value={String(totals.count)}
              note={conc.effectiveN == null ? '' : `spreading like ${conc.effectiveN.toFixed(1)} equal ones`}
              color="var(--ink-2)" />
          </div>

          {totals.costNote && <p className="acd-caveat">{totals.costNote}</p>}

          {/* An account priced in two currencies carries an exchange-rate
              movement inside every return figure above. Worth saying once. */}
          {d.mixed && (
            <p className="acd-caveat">
              This account holds {currencies.map(c => `${c.count} ${c.code}`).join(' and ')} priced
              positions ({currencies.map(c => `${c.code} ${c.pct.toFixed(0)}%`).join(', ')}), so the
              return figures above contain an exchange-rate movement as well as a price movement.
            </p>
          )}

          <div className="acd-table">
            <div className="acd-h">
              <span>Holding</span><span>Qty</span><span>Value</span>
              <span>Of account</span><span>Of book</span><span>Today</span><span>Unrealised</span>
            </div>
            {holdings.map(h => (
              <div key={h.ticker} className="acd-r">
                <span className="acd-t">
                  <b>{h.ticker}</b>
                  {h.currency && String(h.currency).toUpperCase() === 'INR' && <i className="acd-ccy">₹</i>}
                </span>
                <span className="acd-n">{h.qty == null ? '—' : Number(h.qty).toFixed(4).replace(/\.?0+$/, '')}</span>
                <span className="acd-n">{money(h.marketValue, visible, cur)}</span>
                {/* Two weights, always both. Either alone is a true number that
                    reads as the other one. */}
                <span className="acd-n acd-strong">{h.weightInAccount == null ? '—' : `${h.weightInAccount.toFixed(1)}%`}</span>
                <span className="acd-n acd-dim">{h.weightOfBook == null ? '—' : `${h.weightOfBook.toFixed(2)}%`}</span>
                <span className="acd-n" style={{ color: gainColor(h.dayPct) }}>
                  {h.dayPct == null ? '—' : pct(h.dayPct)}
                </span>
                <span className="acd-n" style={{ color: gainColor(h.unrealisedPct) }}>
                  {h.unrealisedPct == null ? '—' : pct(h.unrealisedPct)}
                </span>
              </div>
            ))}
          </div>

          <p className="acd-conc">
            {conc.count === 1
              ? <>This account holds one position, so it is {conc.top1 == null ? '' : `${conc.top1.toFixed(0)}% `}
                concentrated by definition. That is a description, not a criticism — a
                single-holding account is a normal thing to have.</>
              : <><strong>{conc.top1Ticker}</strong> is {conc.top1 == null ? '—' : `${conc.top1.toFixed(0)}%`} of
                this account, and its {conc.count} holdings spread like{' '}
                {conc.effectiveN == null ? '—' : conc.effectiveN.toFixed(1)} equal ones. Both figures
                describe THIS account only; the whole book is on the Spread screen.</>}
          </p>

          {onAssign && (
            <button className="btn btn-sm acd-move" onClick={onAssign}>move holdings in or out →</button>
          )}
        </>
      )}
    </>
  );
}

// ------------------------------------------------------------------ screen

export default function Accounts({ rows = [], cur = '$', scope = 'all', onScope = null, bookTotal = null, dropped = 0 }) {
  const [visible, toggleVisible] = useMoneyVisible();
  const [accounts, setAccounts] = useState([]);
  const [map, setMap] = useState({});
  const [orphans, setOrphans] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [tab, setTab] = useState('accounts');

  // NOTE: there is no `scope` state here any more, and that absence is the fix.
  // It used to be local, which meant this card and the tab strip above it held
  // two different answers to "which account am I looking at". The selection now
  // arrives as a prop and leaves through onScope; there is exactly one.

  useEffect(() => {
    let alive = true;
    loadAccounts().then(({ accounts: a, map: m, orphans: o }) => {
      if (!alive) return;
      setAccounts(a); setMap(m); setOrphans(o); setLoaded(true);
      if (o.length) saveMap(m);
    }).catch(() => setLoaded(true));
    return () => { alive = false; };
  }, []);

  const persistAccounts = next => { setAccounts(next); saveAccounts(next); };
  const persistMap = next => { setMap(next); saveMap(next); };
  const setScope = id => onScope && onScope(id);

  const summary = accountSummary(rows, map, accounts);
  const conc = concentrationNote(summary);
  const dossier = useMemo(
    () => accountDossier(rows, map, accounts, scope, { bookTotal }),
    [rows, map, accounts, scope, bookTotal],
  );

  if (!loaded) return <Card title="Accounts" color="var(--cyan)"><p className="acc-loading">Reading your accounts…</p></Card>;

  // ---------------------------------------------------------------- one
  // A chosen account gets its own screen. Nothing about any other account is
  // rendered here — not a card, not a share, not a comparison sentence. The bug
  // being fixed was precisely that "showing INDstocks" still talked about the
  // US account, so the guarantee has to be structural rather than a filter
  // somebody remembers to apply.
  if (dossier && tab === 'accounts') {
    return (
      <div className="acc-wrap">
        <Card title={dossier.account.label} color={dossier.account.color || dossier.kind.color}
          right={<EyeBtn visible={visible} onClick={toggleVisible} />}>
          <AccountDossier
            d={dossier} visible={visible} cur={cur}
            onBack={() => setScope('all')}
            onEdit={dossier.account.unassigned || dossier.account.missing ? null
              : () => { setScope('all'); setEditingId(dossier.account.id); }}
            onAssign={() => setTab('assign')}
          />
          {editingId === dossier.account.id && (
            <AccountForm
              initial={accounts.find(a => a.id === editingId)}
              existingCount={accounts.length}
              onCancel={() => setEditingId(null)}
              onSave={draft => { persistAccounts(editAccount(accounts, editingId, draft)); setEditingId(null); }}
            />
          )}
        </Card>
      </div>
    );
  }

  // ---------------------------------------------------------------- all
  return (
    <div className="acc-wrap">
      <p className="acc-disclaimer">{DISCLAIMER}</p>

      <Card
        title="Accounts"
        color="var(--cyan)"
        right={<EyeBtn visible={visible} onClick={toggleVisible} />}
      >
        {dropped > 0 && (
          <p className="acc-warn">
            {dropped} holding{dropped === 1 ? ' is' : 's are'} missing from this screen because no
            exchange rate has loaded for {dropped === 1 ? 'its' : 'their'} currency. They are excluded
            rather than counted at par — a rupee added to a dollar total is wrong by about ninety,
            and a total that has absorbed one looks exactly like a correct total.
          </p>
        )}

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

            {/* The assign tab is deliberately NOT scoped. Moving a holding
                between accounts requires seeing both ends of the move, and a
                scoped list would hide the destination. */}
            {tab === 'assign' && scope !== 'all' && (
              <p className="acc-scope-note">
                Showing every holding, not just {scopeLabel(accounts, scope)} — you cannot
                move something into an account you cannot see.
              </p>
            )}

            {tab === 'accounts' && (
              <>
                {orphans.length > 0 && (
                  <p className="acc-warn">
                    {orphans.length} holding{orphans.length === 1 ? ' was' : 's were'} assigned to an
                    account that no longer exists ({orphans.slice(0, 5).join(', ')}
                    {orphans.length > 5 ? '…' : ''}). {orphans.length === 1 ? 'It has' : 'They have'} been
                    returned to unassigned rather than hidden.
                  </p>
                )}

                <p className="acc-pick">Pick an account above to see everything in it.</p>

                <div className="acc-cards">
                  {summary.map(a => (
                    <AccountCard
                      key={a.id} acct={a} visible={visible} cur={cur}
                      expanded={openId === a.id}
                      onToggle={() => setOpenId(openId === a.id ? null : a.id)}
                      onOpen={() => setScope(a.id)}
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
