import React, { useEffect, useMemo, useState } from 'react';
import { Card, StatTile, Empty } from '../ui.jsx';
import { holdingRows, totalsRow, sortRows, toCSV } from '../../lib/holdings.js';
import { loadAssetMeta, assetMetaSync, saveAssetMeta, metaOf } from '../../lib/assets.js';
import { memGet } from '../../lib/advisor.js';
import { paymentsForYear } from '../../lib/dividends.js';

// Every column a broker statement has, plus the two it never does: weight, and a
// total return that counts the dividends.
//
// The discipline of this screen is that a blank is a blank. Where the cost basis
// was never entered, the invested / unrealised / return cells stay empty and the
// row is dimmed — they are not filled with zeros, and those positions do not
// enter the TOTAL row's percentages. A table that quietly reports 0% for
// something it does not know is worse than one that reports nothing.

const DIV_KEY = 'div_meta';

const fmt = (n, cur, dp = 2) =>
  n == null || !Number.isFinite(Number(n)) ? '—'
    : (n < 0 ? '-' : '') + cur + Math.abs(Number(n)).toLocaleString(undefined, {
      minimumFractionDigits: dp, maximumFractionDigits: dp,
    });
const compact = (n, cur = '$') => {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const v = Number(n), a = Math.abs(v), s = v < 0 ? '-' : '';
  const f = (x, u) => s + cur + (x >= 100 ? Math.round(x) : x.toFixed(x >= 10 ? 1 : 2)) + u;
  if (cur === '₹') {
    if (a >= 1e7) return f(a / 1e7, ' Cr');
    if (a >= 1e5) return f(a / 1e5, ' L');
    if (a >= 1e3) return f(a / 1e3, 'K');
  } else {
    if (a >= 1e6) return f(a / 1e6, 'M');
    if (a >= 1e4) return f(a / 1e3, 'K');
  }
  return s + cur + a.toFixed(a < 100 ? 2 : 0);
};
const pct = (n, dp = 2) => (n == null || !Number.isFinite(n) ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(dp)}%`);
const tone = n => (n == null ? 'var(--ink-3)' : n > 0 ? 'var(--green)' : n < 0 ? 'var(--red)' : 'var(--ink-2)');

const COLS = [
  { key: 'ticker', label: 'Holding', a: 'left' },
  { key: 'shares', label: 'Shares', a: 'right' },
  { key: null, label: 'DRIP', a: 'center' },
  { key: 'price', label: 'Price', a: 'right' },
  { key: 'dayPct', label: 'Day', a: 'right' },
  { key: 'cost', label: 'Cost/sh', a: 'right' },
  { key: 'invested', label: 'Invested', a: 'right' },
  { key: 'marketValue', label: 'Mkt value', a: 'right' },
  { key: 'weight', label: 'Wt %', a: 'right' },
  { key: 'dayGain', label: 'Day G/L', a: 'right' },
  { key: 'unrealised', label: 'Unrlzd G/L', a: 'right' },
  { key: 'totalReturnPct', label: 'Total rtn', a: 'right' },
];

// A weight bar drawn behind the percentage. Reading a column of numbers to find
// the concentration risk is work; seeing one bar run twice as far is not.
function WeightCell({ pct: p }) {
  const w = Math.max(0, Math.min(100, Number(p) || 0));
  return (
    <span className="hold-wt">
      <i style={{ width: `${w}%` }} />
      <b>{w.toFixed(1)}</b>
    </span>
  );
}

export default function HoldingsTable({
  held = [], priceOf, quotes = {}, cur = '$', fx = 1, inr = false, onOpen, visible = true,
}) {
  const [metaVer, setMetaVer] = useState(0);
  const [divMeta, setDivMeta] = useState({});
  const [sort, setSort] = useState({ key: 'marketValue', dir: 'desc' });
  const [withDivs, setWithDivs] = useState(true);

  useEffect(() => {
    loadAssetMeta().then(() => setMetaVer(v => v + 1)).catch(() => {});
    memGet(DIV_KEY).then(m => {
      if (m && typeof m === 'object') setDivMeta(m.rows && typeof m.rows === 'object' ? m.rows : m);
    }).catch(() => {});
  }, []);

  const rate = inr && fx ? fx : 1;

  // Dividends credited SO FAR this year — not the full-year projection. Counting
  // payments that have not happened yet as return would be borrowing from the
  // future to flatter the present.
  const incomeOf = useMemo(() => {
    if (!withDivs) return null;
    const today = new Date();
    const y = today.getFullYear();
    const iso = `${y}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    return h => {
      const t = h.ticker || h.symbol;
      const e = divMeta[t];
      if (!e) return null;
      const paid = paymentsForYear(t, e, Number(h.qty ?? h.shares ?? 0), y, { fx: rate })
        .filter(p => p.pay <= iso);
      return paid.length ? paid.reduce((a, p) => a + p.amount, 0) : null;
    };
  }, [withDivs, divMeta, rate]);

  const rows = useMemo(
    () => holdingRows(held, {
      priceOf, quotes, fx: rate, incomeOf,
      metaOf: h => metaOf(h, assetMetaSync()),
    }),
    [held, quotes, rate, incomeOf, metaVer], // eslint-disable-line
  );
  const total = useMemo(() => totalsRow(rows), [rows]);
  const view = useMemo(() => sortRows(rows, sort.key, sort.dir), [rows, sort]);

  const head = key => () => setSort(s => (
    s.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: key === 'ticker' ? 'asc' : 'desc' }
  ));

  const toggleDrip = async (row, e) => {
    e.stopPropagation();
    await saveAssetMeta(row.ticker, { drip: !row.drip });
    setMetaVer(v => v + 1);
  };

  const download = () => {
    const blob = new Blob([toCSV(view, total)], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `holdings-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const anyIncome = rows.some(r => r.income != null);

  if (!held.length) {
    return <Empty icon="$" text="No holdings yet — snapshot from INDmoney or add one on the Portfolio tab." />;
  }

  return (
    <>
      <div className="tile-row">
        <StatTile label="MARKET VALUE" color="var(--cyan)" value={compact(total.marketValue, cur)}
          note={`${total.count} position${total.count === 1 ? '' : 's'}`} />
        <StatTile label="INVESTED" color="var(--purple)" value={compact(total.invested, cur)}
          note={total.missingCost.length ? `${total.missingCost.length} without a cost basis` : 'all costs on file'} />
        <StatTile label="DAY" color={tone(total.dayGain)} value={compact(total.dayGain, cur)}
          note={pct(total.dayPct)} />
        <StatTile label="UNREALISED" color={tone(total.unrealised)} value={compact(total.unrealised, cur)}
          note={pct(total.unrealisedPct)} />
        <StatTile label="TOTAL RETURN" color={tone(total.totalReturnPct)} value={pct(total.totalReturnPct)}
          note={anyIncome ? `incl. ${compact(total.income, cur)} dividends` : 'price only'} />
      </div>

      <Card title="Holdings" color="var(--green)" right={
        <span className="flex" style={{ gap: 6 }}>
          <span className="seg">
            <button className={`seg-btn${withDivs ? ' on' : ''}`} onClick={() => setWithDivs(true)}>Total rtn</button>
            <button className={`seg-btn${!withDivs ? ' on' : ''}`} onClick={() => setWithDivs(false)}>Price only</button>
          </span>
          <button className="btn btn-sm btn-cyan" onClick={download}>↓ CSV</button>
        </span>
      }>
        <div className="scroll-x">
          <table className="ptable hold-table">
            <thead>
              <tr>
                {COLS.map(c => (
                  <th key={c.label} style={{ textAlign: c.a, cursor: c.key ? 'pointer' : 'default' }}
                    onClick={c.key ? head(c.key) : undefined}>
                    {c.label}
                    {sort.key === c.key && <span className="hold-caret">{sort.dir === 'desc' ? '▼' : '▲'}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.map(r => (
                <tr key={r.id} className={r.unknownCost ? 'hold-partial' : ''}
                  style={{ cursor: onOpen ? 'pointer' : 'default' }}
                  onClick={() => onOpen?.(r.raw)}>
                  <td>
                    <b style={{ fontWeight: 'normal', color: 'var(--cyan)' }}>{r.ticker}{onOpen ? ' ›' : ''}</b>
                  </td>
                  <td style={{ textAlign: 'right' }}>{r.shares.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                  <td style={{ textAlign: 'center' }}>
                    <button className={`hold-drip${r.drip ? ' on' : ''}`} title="Dividends reinvested"
                      onClick={e => toggleDrip(r, e)}>{r.drip ? '◉' : '○'}</button>
                  </td>
                  <td style={{ textAlign: 'right' }}>{fmt(r.price, cur)}</td>
                  <td style={{ textAlign: 'right', color: tone(r.dayPct) }}>{pct(r.dayPct)}</td>
                  <td style={{ textAlign: 'right' }}>{r.cost == null ? <span className="muted">not set</span> : fmt(r.cost, cur)}</td>
                  <td style={{ textAlign: 'right' }}>{r.invested == null ? '—' : compact(r.invested, cur)}</td>
                  <td style={{ textAlign: 'right' }}><b>{compact(r.marketValue, cur)}</b></td>
                  <td style={{ textAlign: 'right' }}><WeightCell pct={r.weight} /></td>
                  <td style={{ textAlign: 'right', color: tone(r.dayGain) }}>{r.dayGain == null ? '—' : compact(r.dayGain, cur)}</td>
                  <td style={{ textAlign: 'right', color: tone(r.unrealised) }}>{r.unrealised == null ? '—' : compact(r.unrealised, cur)}</td>
                  <td style={{ textAlign: 'right', color: tone(r.totalReturnPct) }}>
                    {pct(r.totalReturnPct, 1)}
                    {r.income != null && <span className="hold-div" title="includes dividends received this year">·d</span>}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td><b>TOTAL</b></td>
                <td colSpan={5} className="small muted" style={{ textAlign: 'right' }}>
                  {total.missingCost.length ? `excludes ${total.missingCost.join(', ')} — no cost basis` : ''}
                </td>
                <td style={{ textAlign: 'right' }}><b>{compact(total.invested, cur)}</b></td>
                <td style={{ textAlign: 'right' }}><b>{compact(total.marketValue, cur)}</b></td>
                <td style={{ textAlign: 'right' }}>100.0</td>
                <td style={{ textAlign: 'right', color: tone(total.dayGain) }}><b>{compact(total.dayGain, cur)}</b></td>
                <td style={{ textAlign: 'right', color: tone(total.unrealised) }}><b>{compact(total.unrealised, cur)}</b></td>
                <td style={{ textAlign: 'right', color: tone(total.totalReturnPct) }}><b>{pct(total.totalReturnPct, 1)}</b></td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="small muted mt">
          Total return adds the dividends credited to each position <b>so far this year</b> —
          marked <span className="hold-div">·d</span> — to the price move; it does not count
          payments that have not happened yet. Where a cost basis was never entered the row is
          dimmed, its return cells stay blank, and it is left out of the TOTAL percentages
          rather than being counted as bought for nothing. DRIP is a label you set here; it
          does not reinvest anything on its own.
        </div>
      </Card>
    </>
  );
}
