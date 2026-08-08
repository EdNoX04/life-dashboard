import React, { useEffect, useMemo, useState } from 'react';
import { Card, StatTile, Empty } from '../ui.jsx';
import {
  holdingRows, totalsRow, sortRows, toCSV,
  HEAT_METRICS, heatCells, COLUMN_HELP,
} from '../../lib/holdings.js';
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
  { key: null, help: 'drip', label: 'DRIP', a: 'center' },
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

// The heat map. Area is weight, colour is the chosen metric — see heatCells in
// lib/holdings.js for why those two channels are kept separate.
function HeatGrid({ heat, cur, onOpen, rowsById }) {
  const shade = c => {
    if (c.intensity == null) return 'var(--panel-2)';
    const base = c.tone === 'up' ? '94,234,138' : c.tone === 'down' ? '255,91,110' : '138,138,160';
    return `rgba(${base}, ${(0.10 + c.intensity * 0.68).toFixed(3)})`;
  };
  return (
    <div className="heat">
      {heat.cells.map(c => (
        <button
          key={c.ticker}
          className={`heat-cell heat-${c.tone}`}
          // Area carries weight, so a big position is a big rectangle whatever
          // colour sits on it. flex-grow rather than a fixed width so the row
          // always fills the strip instead of leaving a ragged edge.
          style={{ flexGrow: Math.max(0.35, c.weight), background: shade(c) }}
          title={`${c.ticker} · ${c.weight.toFixed(1)}% of the book · ${heat.metric.label} ${c.value == null ? 'not known' : c.value.toFixed(2)}`}
          onClick={() => onOpen?.(rowsById[c.ticker]?.raw)}
        >
          <span className="heat-t">{c.ticker}</span>
          <span className="heat-v">
            {c.value == null ? '—' : `${c.value >= 0 ? '+' : ''}${c.value.toFixed(heat.metric.key === 'unrealised' ? 0 : 2)}${heat.metric.key === 'unrealised' ? '' : '%'}`}
          </span>
          <span className="heat-w">{c.weight.toFixed(1)}%</span>
        </button>
      ))}
    </div>
  );
}

export default function HoldingsTable({
  held = [], priceOf, quotes = {}, cur = '$', fx = 1, inr = false, onOpen, visible = true,
}) {
  const [metaVer, setMetaVer] = useState(0);
  const [divMeta, setDivMeta] = useState({});
  const [sort, setSort] = useState({ key: 'marketValue', dir: 'desc' });
  const [withDivs, setWithDivs] = useState(true);
  const [mode, setMode] = useState('table');       // table | heat
  const [heatKey, setHeatKey] = useState('dayPct');
  const [filter, setFilter] = useState('');

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
  const totalAll = useMemo(() => totalsRow(rows), [rows]);
  // Filtering happens before sorting and before the heat map, so both views and
  // the CSV all describe the same set of rows. A filtered table whose TOTAL row
  // still reports the whole book is a table that answers a question nobody
  // asked.
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? rows.filter(r => String(r.ticker).toLowerCase().includes(q)) : rows;
  }, [rows, filter]);
  const view = useMemo(() => sortRows(filtered, sort.key, sort.dir), [filtered, sort]);
  const heat = useMemo(() => heatCells(filtered, heatKey), [filtered, heatKey]);
  const rowsById = useMemo(
    () => Object.fromEntries(filtered.map(r => [r.ticker, r])), [filtered],
  );

  const total = useMemo(() => totalsRow(filtered), [filtered]);

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
      {/* The summary tiles describe the WHOLE book, never the filter. Typing a
          ticker is a way of finding a row, not a way of redefining your
          portfolio, and a headline that moved every time you searched would be
          actively misleading. The TOTAL row inside the table does follow the
          filter, because that one is a footer of what is above it. */}
      <div className="tile-row">
        <StatTile label="MARKET VALUE" color="var(--cyan)" value={compact(totalAll.marketValue, cur)}
          note={`${totalAll.count} position${totalAll.count === 1 ? '' : 's'}`} />
        <StatTile label="INVESTED" color="var(--purple)" value={compact(totalAll.invested, cur)}
          note={totalAll.missingCost.length ? `${totalAll.missingCost.length} without a cost basis` : 'all costs on file'} />
        <StatTile label="DAY" color={tone(totalAll.dayGain)} value={compact(totalAll.dayGain, cur)}
          note={pct(totalAll.dayPct)} />
        <StatTile label="UNREALISED" color={tone(totalAll.unrealised)} value={compact(totalAll.unrealised, cur)}
          note={pct(totalAll.unrealisedPct)} />
        <StatTile label="TOTAL RETURN" color={tone(totalAll.totalReturnPct)} value={pct(totalAll.totalReturnPct)}
          note={anyIncome ? `incl. ${compact(totalAll.income, cur)} dividends` : 'price only'} />
      </div>

      <Card
        title={filter ? `Holdings — “${filter}” (${view.length} of ${rows.length})` : 'Holdings'}
        color="var(--green)"
        right={
          <span className="flex" style={{ gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <input
              className="hold-filter" placeholder="filter…" value={filter}
              onChange={e => setFilter(e.target.value)}
            />
            <span className="seg">
              <button className={`seg-btn${mode === 'table' ? ' on' : ''}`} onClick={() => setMode('table')}>TABLE</button>
              <button className={`seg-btn${mode === 'heat' ? ' on' : ''}`} onClick={() => setMode('heat')}>HEAT</button>
            </span>
            {mode === 'table' ? (
              <span className="seg">
                <button className={`seg-btn${withDivs ? ' on' : ''}`} onClick={() => setWithDivs(true)}>Total rtn</button>
                <button className={`seg-btn${!withDivs ? ' on' : ''}`} onClick={() => setWithDivs(false)}>Price only</button>
              </span>
            ) : (
              <span className="seg">
                {HEAT_METRICS.map(m => (
                  <button
                    key={m.key} className={`seg-btn${heatKey === m.key ? ' on' : ''}`}
                    onClick={() => setHeatKey(m.key)} title={m.note}
                  >{m.label}</button>
                ))}
              </span>
            )}
            <button className="btn btn-sm btn-cyan" onClick={download}>↓ CSV</button>
          </span>
        }
      >
        {view.length === 0 && (
          <Empty icon="?" text={`Nothing in the book matches “${filter}”.`} />
        )}

        {view.length > 0 && mode === 'heat' && (
          <>
            <HeatGrid heat={heat} cur={cur} onOpen={onOpen} rowsById={rowsById} />
            <div className="small muted mt">
              Width is the position&#39;s share of the book; colour is {heat.metric.note}.
              Those two are kept separate on purpose — a small position glowing red is
              not the same news as a large one, and if width moved with the colour you
              could not tell them apart.
              {heat.missing > 0 && ` ${heat.missing} position${heat.missing === 1 ? ' has' : 's have'} no reading for this metric and ${heat.missing === 1 ? 'is' : 'are'} shown blank rather than as zero.`}
            </div>
          </>
        )}

        {view.length > 0 && mode === 'table' && (
        <div className="scroll-x">
          <table className="ptable hold-table">
            <thead>
              <tr>
                {COLS.map(c => {
                  const help = COLUMN_HELP[c.help || c.key];
                  return (
                    <th
                      key={c.label} style={{ textAlign: c.a, cursor: c.key ? 'pointer' : 'default' }}
                      onClick={c.key ? head(c.key) : undefined}
                      // Native title rather than a hover card: it survives
                      // touch-and-hold, it is readable by a screen reader, and it
                      // cannot be clipped by the horizontal scroll this table
                      // lives inside.
                      title={help || undefined}
                    >
                      {c.label}
                      {help && <span className="hold-info" aria-hidden="true">ⓘ</span>}
                      {sort.key === c.key && <span className="hold-caret">{sort.dir === 'desc' ? '▼' : '▲'}</span>}
                    </th>
                  );
                })}
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
                  {/* The secondary line is the same figure as a share of the
                      book, so a column of currency amounts also reads as a
                      column of proportions without a second column to scan. */}
                  <td style={{ textAlign: 'right' }}>
                    {r.invested == null ? '—' : <>
                      {compact(r.invested, cur)}
                      {total.invested > 0 && (
                        <i className="hold-sub">{((r.invested / total.invested) * 100).toFixed(1)}% of cost</i>
                      )}
                    </>}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <b>{compact(r.marketValue, cur)}</b>
                    {total.marketValue > 0 && (
                      <i className="hold-sub">{((r.marketValue / total.marketValue) * 100).toFixed(1)}% of book</i>
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}><WeightCell pct={r.weight} /></td>
                  <td style={{ textAlign: 'right', color: tone(r.dayGain) }}>
                    {r.dayGain == null ? '—' : <>
                      {compact(r.dayGain, cur)}
                      <i className="hold-sub">{pct(r.dayPct)}</i>
                    </>}
                  </td>
                  <td style={{ textAlign: 'right', color: tone(r.unrealised) }}>
                    {r.unrealised == null ? '—' : <>
                      {compact(r.unrealised, cur)}
                      {r.invested > 0 && <i className="hold-sub">{pct((r.unrealised / r.invested) * 100, 1)}</i>}
                    </>}
                  </td>
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
        )}

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
