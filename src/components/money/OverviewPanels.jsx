import React, { useEffect, useMemo, useState } from 'react';
import { Card, Empty } from '../ui.jsx';
import { memGet } from '../../lib/advisor.js';
import { holdingRows, concentration } from '../../lib/holdings.js';
import { perHolding, coverage, bookYield } from '../../lib/dividends.js';

// The two panels that belong on the front page of a portfolio: what you own most
// of, and what pays you most. Everything else on the Money tab is a screen you
// go to; these are the two facts you want without going anywhere.
//
// Both panels are built on the same principle, which is the one this whole tab
// is built on: a rank is only honest if the thing being ranked is measured the
// same way for every row, and a row that cannot be measured is SHOWN as
// unmeasured rather than sorted to the bottom as though it were a zero.
//
// So "Largest positions" ranks by market value, which every holding has. It does
// not rank by gain, which holdings with an unknown cost basis do not have.
// And "Top payers" ranks by annual income, which only holdings with dividend
// data have — so the panel reports its own coverage in the header, because a
// list of your three best payers is worthless if it was drawn from the four
// holdings you happened to fill in.

const fmt = (n, cur = '$', dp = 0) =>
  n == null || !Number.isFinite(Number(n)) ? '—'
    : (n < 0 ? '-' : '') + cur + Math.abs(Number(n)).toLocaleString(undefined, {
      minimumFractionDigits: dp, maximumFractionDigits: dp,
    });
const compact = (n, cur = '$') => {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const v = Number(n), a = Math.abs(v), s = v < 0 ? '-' : '';
  const f = (x, u) => s + cur + (x >= 100 ? Math.round(x) : x.toFixed(1)) + u;
  if (a >= 1e7) return f(a / 1e7, ' Cr');
  if (a >= 1e5) return f(a / 1e5, ' L');
  if (a >= 1e3) return f(a / 1e3, 'K');
  return s + cur + a.toFixed(0);
};
const pct = (n, dp = 1) => (n == null || !Number.isFinite(n) ? '—' : `${n.toFixed(dp)}%`);
const sign = n => (n == null ? '' : n >= 0 ? '+' : '−');

// A weight bar with a hard scale. The widest bar is the largest position, not
// 100% — at portfolio weights of 8% and 6% a 0-100 scale draws two slivers and
// says nothing. The scale is stated on the panel so the bar is never mistaken
// for a share of the whole.
export function WeightBar({ value = 0, max = 1, color = 'var(--cyan)' }) {
  const w = max > 0 ? Math.max(2, Math.min(100, (value / max) * 100)) : 0;
  return (
    <span className="ov-bar" aria-hidden="true">
      <i style={{ width: `${w}%`, background: color, color }} />
    </span>
  );
}

// ---- largest positions ---------------------------------------------------
export function LargestPositions({ rows = [], cur = '$', limit = 6, onOpen }) {
  const ranked = useMemo(
    () => [...rows].filter(r => Number(r.marketValue) > 0).sort((a, b) => b.marketValue - a.marketValue),
    [rows],
  );
  const conc = useMemo(() => concentration(rows), [rows]);
  const show = ranked.slice(0, limit);
  const rest = ranked.length - show.length;
  const max = show[0]?.marketValue || 0;
  const restValue = ranked.slice(limit).reduce((a, r) => a + r.marketValue, 0);

  if (!ranked.length) {
    return (
      <Card title="Largest positions" color="var(--cyan)">
        <Empty icon="▤" text="Nothing priced yet — positions rank once quotes land." />
      </Card>
    );
  }

  return (
    <Card title="Largest positions" color="var(--cyan)"
      right={<span className="small muted">bars scaled to the largest, not to 100%</span>}>
      <div className="ov-rows">
        {show.map((r, i) => (
          <div key={r.id ?? r.ticker} className={`ov-row${onOpen ? ' click' : ''}`}
            onClick={onOpen ? () => onOpen(r.ticker) : undefined}>
            <span className="ov-rank">{i + 1}</span>
            <span className="ov-tk">{r.ticker}</span>
            <span className="ov-w">{pct(r.weight)}</span>
            <WeightBar value={r.marketValue} max={max}
              color={r.unrealised == null ? 'var(--ink-3)' : r.unrealised >= 0 ? 'var(--green)' : 'var(--red)'} />
            <span className="ov-v">{compact(r.marketValue, cur)}</span>
            {/* A holding with no cost basis has no gain. It says so; it does not
                render a confident 0.0% that would sort and read as flat. */}
            <span className="ov-p" style={{
              color: r.unrealisedPct == null ? 'var(--ink-3)'
                : r.unrealisedPct >= 0 ? 'var(--green)' : 'var(--red)',
            }}>
              {r.unrealisedPct == null ? 'no cost' : `${sign(r.unrealisedPct)}${Math.abs(r.unrealisedPct).toFixed(1)}%`}
            </span>
          </div>
        ))}
      </div>

      {rest > 0 && (
        <div className="ov-rest small muted">
          + {rest} more holding{rest === 1 ? '' : 's'} worth {compact(restValue, cur)} between them
        </div>
      )}

      <div className="ov-conc">
        <div>
          <span className="ov-conc-k">HALF YOUR MONEY IS IN</span>
          <span className="ov-conc-v">
            {conc.namesToHalf} of {conc.names} <span className="muted" style={{ fontSize: 13 }}>holdings</span>
          </span>
        </div>
        <div>
          <span className="ov-conc-k">TOP 3</span>
          <span className="ov-conc-v">{pct(conc.top3, 0)}</span>
        </div>
        <div>
          <span className="ov-conc-k">TOP 5</span>
          <span className="ov-conc-v">{pct(conc.top5, 0)}</span>
        </div>
        <div>
          <span className="ov-conc-k">BIGGEST SINGLE</span>
          <span className="ov-conc-v">{pct(conc.top1, 0)}</span>
        </div>
      </div>
      <div className="small muted mt">
        These are descriptions of the book, not scores. There is no level at which
        this screen decides you are over-concentrated — that depends on what else
        you hold, what you earn, and how long you have, none of which this panel
        can see.
      </div>
    </Card>
  );
}

// ---- top payers ----------------------------------------------------------
export function TopPayers({ lines = [], cur = '$', limit = 6, onOpen }) {
  const payers = useMemo(
    () => lines.filter(l => !l.unknown && Number(l.income) > 0).sort((a, b) => b.income - a.income),
    [lines],
  );
  const cov = useMemo(() => coverage(lines), [lines]);
  const book = useMemo(() => bookYield(lines), [lines]);
  const show = payers.slice(0, limit);
  const max = show[0]?.income || 0;
  const totalIncome = payers.reduce((a, l) => a + l.income, 0);

  if (!lines.length) {
    return (
      <Card title="Top payers" color="var(--pink)">
        <Empty icon="◈" text="Nothing to rank yet." />
      </Card>
    );
  }
  if (!payers.length) {
    return (
      <Card title="Top payers" color="var(--pink)">
        <Empty icon="◈" text="No dividend data entered yet — fill a payer in on the Divs tab and it ranks here." />
      </Card>
    );
  }

  return (
    <Card title="Top payers" color="var(--pink)"
      right={
        <span className="chip c-pink">{compact(totalIncome, cur)}/yr</span>
      }>
      {/* Coverage first, above the list. A ranking drawn from a third of the book
          is a ranking of what has been typed in, and saying so afterwards is too
          late — the list has already been read by then. */}
      <div className={`ov-cov${cov.complete ? ' full' : ''}`}>
        {cov.complete
          ? 'Dividend data covers every holding, so this is the whole picture.'
          : `Dividend data covers ${pct(cov.pct, 0)} of the book by value. ${cov.missing.length} holding${cov.missing.length === 1 ? '' : 's'} — ${cov.missing.slice(0, 6).join(', ')}${cov.missing.length > 6 ? '…' : ''} — ${cov.missing.length === 1 ? 'has' : 'have'} nothing entered, so ${cov.missing.length === 1 ? 'it is' : 'they are'} absent from this ranking rather than at the bottom of it.`}
      </div>

      <div className="ov-rows mt">
        {show.map((l, i) => (
          <div key={l.ticker} className={`ov-row${onOpen ? ' click' : ''}`}
            onClick={onOpen ? () => onOpen(l.ticker) : undefined}>
            <span className="ov-rank pink">{i + 1}</span>
            <span className="ov-tk">{l.ticker}</span>
            <span className="ov-w">{pct(l.currentYield)}</span>
            <WeightBar value={l.income} max={max} color="var(--pink)" />
            <span className="ov-v">{compact(l.income, cur)}<span className="muted">/yr</span></span>
            {/* Yield on cost, not current yield, in the last column: what the
                shares you actually bought pay against what you actually paid.
                It is the only one of the two that is a fact about your money. */}
            <span className="ov-p" style={{ color: l.yieldOnCost == null ? 'var(--ink-3)' : 'var(--yellow)' }}>
              {l.yieldOnCost == null ? 'no cost' : `${l.yieldOnCost.toFixed(1)}% YoC`}
            </span>
          </div>
        ))}
      </div>

      {payers.length > limit && (
        <div className="ov-rest small muted">
          + {payers.length - limit} more payer{payers.length - limit === 1 ? '' : 's'} worth {compact(payers.slice(limit).reduce((a, l) => a + l.income, 0), cur)}/yr
        </div>
      )}

      <div className="ov-conc">
        <div>
          <span className="ov-conc-k">INCOME A YEAR</span>
          <span className="ov-conc-v" style={{ color: 'var(--pink)' }}>{compact(book.income, cur)}</span>
        </div>
        <div>
          <span className="ov-conc-k">YIELD ON VALUE</span>
          <span className="ov-conc-v">{pct(book.onValue)}</span>
        </div>
        <div>
          <span className="ov-conc-k">YIELD ON COST</span>
          <span className="ov-conc-v" style={{ color: 'var(--yellow)' }}>{pct(book.onCost)}</span>
        </div>
        <div>
          <span className="ov-conc-k">A MONTH</span>
          <span className="ov-conc-v">{compact(book.income / 12, cur)}</span>
        </div>
      </div>
      <div className="small muted mt">
        Both yields are computed on the holdings that have dividend data, not on
        the whole book — adding a stock that pays nothing does not reduce what
        your payers yield, and a figure that moved when you bought one would be
        measuring the wrong thing.
      </div>
    </Card>
  );
}

// ---- the pair, wired ------------------------------------------------------
// Mounted as one block so the overview asks for its data once. The dividend meta
// is loaded here rather than passed down because the overview is the only place
// that needs it outside the Divs tab itself.
export default function OverviewPanels({
  held = [], priceOf, costOf, quotes = {}, fx = 1, cur = '$', year, onOpen,
}) {
  const [meta, setMeta] = useState({});

  useEffect(() => {
    memGet('div_meta').then(v => {
      if (v && typeof v === 'object') setMeta(v.rows && typeof v.rows === 'object' ? v.rows : v);
    }).catch(() => {});
  }, []);

  const rows = useMemo(
    () => holdingRows(held, { priceOf, costOf, quotes, fx }),
    [held, quotes, fx],
  );
  const lines = useMemo(
    () => perHolding(held, meta, {
      priceOf: priceOf ? h => priceOf(h) : undefined,
      costOf: costOf ? h => costOf(h) : undefined,
      year, fx,
    }),
    [held, meta, fx, year],
  );

  if (!held.length) return null;

  return (
    <div className="ov-pair">
      <LargestPositions rows={rows} cur={cur} onOpen={onOpen} />
      <TopPayers lines={lines} cur={cur} onOpen={onOpen} />
    </div>
  );
}
