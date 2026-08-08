import React, { useEffect, useMemo, useState } from 'react';
import {
  loadAccounts, saveAccounts, saveMap, filterRows, scopeLabel, scopeNote,
  accountTotals, suggestFromCurrency, UNASSIGNED, kindOf,
} from '../../lib/accounts.js';

// Combined + per-account tabs, sitting above whatever screen is being scoped.
//
// The design problem this solves is not "show a filter". It is that accounts
// are useless until every holding is assigned, and assigning twenty tickers by
// hand is a chore nobody does — so the feature ships, sits unused, and the tabs
// stay permanently empty. Hence the seed offer: one click to split the book by
// the currency each holding is priced in, with the reasoning shown and every
// assignment editable afterwards.
//
// Three things it refuses to do:
//
//   It does not apply the seed silently. An app that decides where your money
//   lives and then reports per-account totals has made a claim on your behalf.
//
//   It does not hide the unassigned tab once something is assigned. A holding
//   that belongs to no account is exactly the thing you need to see, and hiding
//   the tab when the count is low hides it precisely when it is easiest to fix.
//
//   It does not let a scoped view look like the whole book. When a scope is
//   active the caller gets a caveat line to render, because every figure below
//   is then describing part of a portfolio.

export default function AccountTabs({ rows = [], scope = 'all', onScope, cur = '$' }) {
  const [accounts, setAccounts] = useState([]);
  const [map, setMap] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [offer, setOffer] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let dead = false;
    loadAccounts().then(({ accounts: a, map: m }) => {
      if (dead) return;
      setAccounts(a); setMap(m); setLoaded(true);
    }).catch(() => setLoaded(true));
    return () => { dead = true; };
  }, []);

  const counts = useMemo(() => {
    const c = { all: rows.length, [UNASSIGNED]: 0 };
    for (const a of accounts) c[a.id] = 0;
    for (const r of rows) {
      const id = map[r.ticker];
      if (id && c[id] != null) c[id] += 1; else c[UNASSIGNED] += 1;
    }
    return c;
  }, [rows, accounts, map]);

  const suggestion = useMemo(
    () => (loaded ? suggestFromCurrency(rows, accounts) : null),
    [loaded, rows, accounts],
  );

  // Only worth offering when there is actually something unassigned to fix.
  const worthOffering = !!suggestion && counts[UNASSIGNED] > 0;

  async function applySeed() {
    if (!suggestion) return;
    setBusy(true);
    const nextAccounts = [...accounts, ...suggestion.accounts];
    const nextMap = { ...map, ...suggestion.map };
    setAccounts(nextAccounts); setMap(nextMap); setOffer(false);
    try {
      await saveAccounts(nextAccounts);
      await saveMap(nextMap);
    } catch { /* offline: local state stands until the next load */ }
    setBusy(false);
  }

  const scoped = filterRows(rows, map, scope);
  const totals = accountTotals(scoped);
  const note = scopeNote(accounts, scope, totals);

  if (!loaded) return null;

  const tab = (id, label, color) => (
    <button
      key={id}
      className={`at-tab${scope === id ? ' on' : ''}`}
      style={color ? { '--at-c': color } : undefined}
      onClick={() => onScope?.(id)}
    >
      {label}
      <span className="at-n">{counts[id] ?? 0}</span>
    </button>
  );

  return (
    <div className="at">
      <div className="at-row">
        {tab('all', 'COMBINED', 'var(--cyan)')}
        {accounts.map(a => tab(a.id, a.label.toUpperCase(), a.color || kindOf(a.kind).color))}
        {/* Always present when anything is loose, however few. */}
        {counts[UNASSIGNED] > 0 && tab(UNASSIGNED, 'UNASSIGNED', 'var(--orange)')}
      </div>

      {note && <p className="at-note">{note}</p>}

      {worthOffering && !offer && (
        <button className="at-offer" onClick={() => setOffer(true)}>
          {counts[UNASSIGNED]} holding{counts[UNASSIGNED] === 1 ? '' : 's'} not in any account — split them automatically?
        </button>
      )}

      {worthOffering && offer && (
        <div className="at-seed">
          <p className="at-seed-why">{suggestion.reason}</p>
          <p className="at-seed-what">
            {suggestion.accounts.length > 0 && (
              <>Creates {suggestion.accounts.map(a => a.label).join(' and ')}. </>
            )}
            Assigns {suggestion.counts.USD} dollar-priced and {suggestion.counts.INR}{' '}
            rupee-priced holding{suggestion.counts.INR === 1 ? '' : 's'}.
          </p>
          <div className="flex" style={{ gap: 6 }}>
            <button className="btn btn-sm btn-green" onClick={applySeed} disabled={busy}>
              {busy ? '…' : 'DO IT'}
            </button>
            <button className="btn btn-sm" onClick={() => setOffer(false)}>NOT NOW</button>
          </div>
        </div>
      )}
    </div>
  );
}
