import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Card, StatTile, Empty } from '../ui.jsx';
import { useLiveQuotes } from '../../lib/live.js';
import { fetchCaps, hasKey } from '../../lib/fundamentals.js';
import { fetchCandles } from '../../lib/marketdata.js';
import {
  UNIVERSE, INDEX_PROXIES, buildRows, rank, sortRows, SORTS, breadth,
  capConcentration, treemap, heatColour, sparkPath, toCsv,
} from '../../lib/leaders.js';

// The market, ranked. The reference screen is a table of the largest companies
// with a strip of index moves above it and a heat map behind a toggle.
//
// The thing this screen has to keep straight is the difference between a figure
// that is small and a figure that has not arrived. Market caps land one at a
// time over a few seconds, so for most of the first render most rows have no
// cap — and a table that sorts them to the bottom with "$0M" beside them is
// telling the reader that Apple is worthless. They are drawn unranked, with a
// dash, until their number lands.

const fmtCap = n => {                    // finnhub reports in $ millions
  if (n == null || !Number.isFinite(n)) return '—';
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}T`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}B`;
  return `$${n.toFixed(0)}M`;
};
const fmtPx = n => (n == null || !Number.isFinite(n) ? '—' : `$${n.toFixed(2)}`);
const pct = (n, dp = 2) => (n == null || !Number.isFinite(n) ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(dp)}%`);

// ---- sparkline cell -------------------------------------------------------
export function Spark({ values, w = 62, h = 20 }) {
  const s = sparkPath(values, w, h);
  if (!s) return <span className="muted small">—</span>;
  const c = s.up === false ? 'var(--red)' : s.up === true ? 'var(--green)' : 'var(--ink-3)';
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} shapeRendering="crispEdges"
      style={{ display: 'block', imageRendering: 'pixelated' }}>
      {s.d && <path d={s.d} fill="none" stroke={c} strokeWidth="1.5"
        style={{ filter: `drop-shadow(0 0 3px ${c})` }} />}
      {/* One price is a dot. Drawing a line through a single point would claim a
          month of flatness we have no evidence for. */}
      {s.dot && <rect x={s.dot.x - 1} y={s.dot.y - 1} width="2.5" height="2.5" fill={c} />}
    </svg>
  );
}

// ---- heat map -------------------------------------------------------------
export function HeatMap({ rows = [], height = 320 }) {
  const wrapRef = useRef(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(es => { const x = es[0]?.contentRect?.width; if (x) setW(Math.round(x)); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const W = w || 660;
  const tiles = treemap(rows, W, height);
  if (!tiles.length) {
    return (
      <div ref={wrapRef}>
        <Empty icon="▦" text="No market caps have loaded yet — the heat map sizes tiles by company size, so it waits for them rather than drawing everything the same." />
      </div>
    );
  }
  return (
    <div ref={wrapRef}>
      <svg viewBox={`0 0 ${W} ${height}`} width="100%" height={height} shapeRendering="crispEdges"
        style={{ display: 'block', imageRendering: 'pixelated' }}>
        {tiles.map(t => {
          const col = heatColour(t.changePct);
          const room = t.w > 52 && t.h > 26;
          return (
            <g key={t.ticker}>
              <rect x={t.x} y={t.y} width={Math.max(0, t.w - 1)} height={Math.max(0, t.h - 1)}
                fill={col.fill} stroke={col.edge} strokeWidth="1" />
              {room && (
                <>
                  <text x={t.x + 5} y={t.y + 14} fontSize="11" fill="var(--ink)">{t.ticker}</text>
                  <text x={t.x + 5} y={t.y + 25} fontSize="9"
                    fill={t.changePct == null ? 'rgba(255,255,255,.4)' : t.changePct >= 0 ? 'var(--green)' : 'var(--red)'}>
                    {t.changePct == null ? 'no move on file' : pct(t.changePct)}
                  </text>
                </>
              )}
              <title>{`${t.ticker} · ${fmtCap(t.marketCap)} · ${t.changePct == null ? 'no move on file' : pct(t.changePct)}`}</title>
            </g>
          );
        })}
      </svg>
      <div className="div-legend small mt">
        <span><i className="lb-key up" /> up today</span>
        <span><i className="lb-key down" /> down today</span>
        <span><i className="lb-key none" /> no move on file</span>
        <span className="muted">tile size = market cap</span>
      </div>
    </div>
  );
}

// ---- index strip ----------------------------------------------------------
export function IndexStrip({ quotes = {} }) {
  return (
    <div className="lb-strip">
      {INDEX_PROXIES.map(p => {
        const q = quotes[p.t] || {};
        const c = Number.isFinite(Number(q.changePct)) ? Number(q.changePct) : null;
        return (
          <div key={p.t} className="lb-idx">
            <div className="lb-idx-name">{p.label}</div>
            <div className="lb-idx-px">{fmtPx(Number.isFinite(Number(q.price)) ? Number(q.price) : null)}</div>
            <div className="lb-idx-chg" style={{ color: c == null ? 'var(--ink-3)' : c >= 0 ? 'var(--green)' : 'var(--red)' }}>
              {c == null ? '—' : `${c >= 0 ? '▲' : '▼'} ${Math.abs(c).toFixed(2)}%`}
            </div>
            {/* Naming the instrument matters: this is the ETF, quoted during cash
                hours. It is not the future, and it does not trade overnight. */}
            <div className="lb-idx-note">{p.t} ETF · tracks {p.tracks}</div>
          </div>
        );
      })}
    </div>
  );
}

// ---- main -----------------------------------------------------------------
export default function Leaderboard({ holdings = [], onOpen = null }) {
  const [view, setView] = useState('table');       // table | heat
  const [sort, setSort] = useState('cap');
  const [dir, setDir] = useState(null);
  const [caps, setCaps] = useState({});
  const [capsBusy, setCapsBusy] = useState(false);
  const [spark, setSpark] = useState({});
  const [sparkState, setSparkState] = useState('idle');   // idle | loading | done | nokey
  const [sparkDone, setSparkDone] = useState(0);

  const tickers = useMemo(() => {
    const own = holdings.map(h => String(h.ticker || '').toUpperCase()).filter(Boolean);
    return [...new Set([...UNIVERSE.map(u => u.t), ...own])];
  }, [holdings]);

  const watched = useMemo(() => [...tickers, ...INDEX_PROXIES.map(p => p.t)], [tickers]);
  const { quotes, status } = useLiveQuotes(watched);

  // Caps arrive one at a time and the table fills in as they do.
  useEffect(() => {
    if (!hasKey()) return;
    let dead = false;
    setCapsBusy(true);
    fetchCaps(tickers, (_t, _v, all) => { if (!dead) setCaps(all); })
      .then(all => { if (!dead) { setCaps(all); setCapsBusy(false); } })
      .catch(() => { if (!dead) setCapsBusy(false); });
    return () => { dead = true; };
  }, [tickers]);

  const rows = useMemo(
    () => buildRows({ holdings, quotes, caps, spark }),
    [holdings, quotes, caps, spark],
  );
  const ranked = useMemo(() => rank(rows), [rows]);
  const shown = useMemo(() => {
    // Ranking is by cap always — it is what "rank" means on this screen — and
    // the sort then reorders the rows without renumbering them, so a row's rank
    // stays the same fact whichever column you click.
    const byKey = Object.fromEntries(ranked.map(r => [r.ticker, r.rank]));
    return sortRows(ranked, sort, dir).map(r => ({ ...r, rank: byKey[r.ticker] }));
  }, [ranked, sort, dir]);

  const br = useMemo(() => breadth(rows), [rows]);
  const cc = useMemo(() => capConcentration(rows, 5), [rows]);
  const capsIn = rows.filter(r => r.marketCap != null).length;

  // 30-day shapes are a separate provider on a tight free-tier budget, so they
  // are asked for rather than assumed. Loading thirty charts unprompted would
  // spend a day's credits on a screen the user may only be glancing at.
  async function loadSparks() {
    setSparkState('loading'); setSparkDone(0);
    const acc = {};
    let n = 0;
    for (const t of tickers) {
      try {
        const c = await fetchCandles(t, '6M');
        acc[t] = c.slice(-30).map(x => x.c);
        setSpark({ ...acc });
      } catch (e) {
        if (String(e.message) === 'NO_KEY') { setSparkState('nokey'); return; }
        acc[t] = null;
      }
      setSparkDone(++n);
      await new Promise(r => setTimeout(r, 8200));   // free tier is 8 requests a minute
    }
    setSparkState('done');
  }

  function download() {
    const csv = toCsv(shown);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `market-leaders-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const header = (key, label, right = true) => (
    <th style={{ textAlign: right ? 'right' : 'left', cursor: 'pointer', whiteSpace: 'nowrap' }}
      onClick={() => {
        if (sort === key) setDir(d => (d === -1 ? 1 : -1));
        else { setSort(key); setDir(null); }
      }}>
      {label}{sort === key ? (dir === 1 ? ' ▲' : ' ▼') : ''}
    </th>
  );

  if (!hasKey()) {
    return (
      <Card title="Market leaders" color="var(--yellow)">
        <Empty icon="▦" text="Add a Finnhub key in Config and the leaderboard fills with live prices and market caps." />
      </Card>
    );
  }

  return (
    <Card title="Market leaders" color="var(--yellow)" right={
      <span className="flex" style={{ gap: 8 }}>
        <span className="seg">
          <button className={`seg-btn${view === 'table' ? ' on' : ''}`} onClick={() => setView('table')}>Table</button>
          <button className={`seg-btn${view === 'heat' ? ' on' : ''}`} onClick={() => setView('heat')}>Heat map</button>
        </span>
        <button className="btn btn-sm" onClick={download}>↓ CSV</button>
      </span>
    }>
      <IndexStrip quotes={quotes} />

      <div className="tile-row mt">
        <StatTile label="ADVANCING" color="var(--green)" value={String(br.up)}
          note={`of ${br.judged} with a price today`} />
        <StatTile label="DECLINING" color="var(--red)" value={String(br.down)}
          note={br.judged < br.of ? `${br.of - br.judged} still without a quote` : 'all quoted'} />
        <StatTile label="AVERAGE MOVE" color={br.avg == null ? 'var(--ink-3)' : br.avg >= 0 ? 'var(--green)' : 'var(--red)'}
          value={pct(br.avg)} note="unweighted, across the list" />
        <StatTile label="TOP 5 SHARE" color="var(--yellow)"
          value={cc ? `${cc.pct.toFixed(1)}%` : '—'}
          note={cc ? `of the ${cc.covered} caps loaded` : 'no caps loaded yet'} />
      </div>

      {capsBusy && (
        <div className="small muted mt">
          Loading market caps — {capsIn} of {rows.length} in. Rows still waiting are
          shown unranked with a dash rather than being sorted to the bottom at zero.
        </div>
      )}

      {view === 'heat' && <div className="mt"><HeatMap rows={rows} /></div>}

      {view === 'table' && (
        <div className="scroll-x mt">
          <table className="ptable lb-table">
            <thead>
              <tr>
                <th style={{ textAlign: 'right' }}>#</th>
                {header('name', 'Company', false)}
                {header('cap', 'Market cap')}
                {header('price', 'Price')}
                {header('change', 'Today')}
                <th style={{ textAlign: 'right' }}>30 days</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(r => (
                <tr key={r.ticker} className={r.mine ? 'res-self' : ''}
                  style={onOpen && r.mine ? { cursor: 'pointer' } : undefined}
                  onClick={() => { if (onOpen && r.mine) onOpen(r.ticker); }}>
                  <td style={{ textAlign: 'right' }} className={r.rank == null ? 'muted' : ''}>
                    {r.rank == null ? '—' : r.rank}
                  </td>
                  <td>
                    <span style={{ marginRight: 6 }}>{r.flag}</span>
                    <b style={{ fontWeight: 'normal', color: r.mine ? 'var(--yellow)' : 'var(--cyan)' }}>{r.ticker}</b>
                    {r.mine && <span className="chip c-yellow" style={{ marginLeft: 6 }}>yours</span>}
                    <div className="small muted">{r.name}</div>
                  </td>
                  <td style={{ textAlign: 'right' }} className={r.marketCap == null ? 'muted' : ''}>
                    {fmtCap(r.marketCap)}
                  </td>
                  <td style={{ textAlign: 'right' }}>{fmtPx(r.price)}</td>
                  <td style={{ textAlign: 'right' }}>
                    {r.changePct == null
                      ? <span className="muted">—</span>
                      : <span className={`chip ${r.changePct >= 0 ? 'c-green' : 'c-red'}`}>{pct(r.changePct)}</span>}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <Spark values={r.spark} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex mt" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {sparkState === 'idle' && (
          <button className="btn btn-sm btn-cyan" onClick={loadSparks}>▤ Load 30-day shapes</button>
        )}
        {sparkState === 'loading' && (
          <span className="small muted">
            Drawing 30-day shapes — {sparkDone} of {tickers.length}. Paced to eight a
            minute because that is the whole free-tier budget for chart data.
          </span>
        )}
        {sparkState === 'nokey' && (
          <span className="small muted">Add a Twelve Data key in Config for the 30-day shapes.</span>
        )}
        {sparkState === 'done' && <span className="small muted">30-day shapes loaded.</span>}
        <span className="small muted" style={{ marginLeft: 'auto' }}>
          {status === 'live' ? 'Prices live' : status === 'closed' ? 'US market shut — last close' : 'Prices idle'}
        </span>
      </div>

      <div className="small muted mt">
        Rank is by market cap, and it does not move when you re-sort the table — a
        company ranked fourth is ranked fourth whichever column you click. Caps come
        from the provider’s last filing snapshot, cached for a day, so a company
        without one yet shows a dash instead of being ranked last at zero. The strip
        along the top quotes the ETFs that track each index, not the futures: they
        move during cash hours and stop.
      </div>
    </Card>
  );
}
