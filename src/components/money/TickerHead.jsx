import React, { useEffect, useMemo, useState } from 'react';
import { Card, StatTile, Empty } from '../ui.jsx';
import * as T from '../../lib/tickerhead.js';
import * as F from '../../lib/fairvalue.js';
import { useCollection } from '../../lib/hooks.js';
import { fetchCandles } from '../../lib/marketdata.js';
import { fetchFundamentals } from '../../lib/fundamentals.js';
import { metaOf } from '../../lib/assets.js';

// The screen half of lib/tickerhead.js.
//
// The four decisions that shaped the arithmetic are documented there. Three more
// belong to the screen, because they are about what a picture implies rather
// than what a number is:
//
// A. THE CHANGE CHIP ALWAYS CARRIES ITS BASELINE, AND THE BASELINE FOLLOWS THE
//    BRUSH. The reference prints a green "+1.24%" next to the price. On its own
//    that number is meaningless — up since when? Here the chip prints the date it
//    is measured from, and when the brush cuts the window down the chip
//    recomputes against the new first bar. The one place it does not is a full
//    1D window, where the baseline is yesterday's close so that this screen's
//    number agrees with the one every other screen shows for today. The instant
//    the brush moves off full, that special case is dropped and the label says
//    so, because "since previous close" over a brushed Tuesday afternoon would
//    be a false sentence with a correct-looking percentage attached.
//
// B. THE BRUSH IS TWO SLIDERS, NOT A DRAG SURFACE. A drag-to-select rectangle is
//    what the reference has and it needs pointer capture, touch fallbacks and a
//    hit target that fights the page scroll on a phone. Two range inputs do the
//    same job, work with a thumb and a keyboard on the first try, and — the part
//    that decided it — they are the version where the selected indices are
//    always visible as numbers, so a window that looks wrong can be read rather
//    than guessed at. brushClamp still owns every rule about inversion and
//    minimum span; the sliders only propose.
//
// C. TOTAL RETURN USES ONE BASIS AND SAYS WHICH. The Value screen keeps Adj,
//    GAAP and FWD dividend figures in three separate slots precisely so they
//    never mix. This screen needs one series, so it takes the first non-empty
//    slot in a fixed order and prints the name of the slot it used. It does not
//    merge them, and it does not pick "the one with the most years" — a rule
//    that changes which numbers are plotted when Neel types one more figure into
//    a slot he wasn't looking at is worse than a rule that is boring.

const f2 = n => (Number.isFinite(n) ? n.toFixed(2) : '—');
const f1 = n => (Number.isFinite(n) ? n.toFixed(1) : '—');
const pct = n => (Number.isFinite(n) ? `${n >= 0 ? '+' : ''}${n.toFixed(2)}%` : '—');

// Decision C, in the order it is applied.
const DIV_BASES = ['adj', 'gaap', 'fwd'];

// ---------- the generated mark (decision 1 of the lib) ----------

export function Monogram({ ticker, size = 46 }) {
  const m = T.monogram(ticker);
  if (!m) return <span className="th-mono th-mono-none" style={{ width: size, height: size }}>?</span>;
  return (
    <span className="th-mono" style={{ width: size, height: size, color: m.color, borderColor: m.color }}
      title="Generated from the ticker. No logo is fetched from anywhere.">
      {m.text}
    </span>
  );
}

// ---------- the identity block ----------

export function HeadLine({ ticker, prof, held }) {
  const p = prof || {};
  return (
    <div className="th-head">
      <Monogram ticker={ticker} />
      <div className="th-id">
        <div className="th-sym">
          <b>{ticker}</b>
          {p.name ? <span className="th-name">{p.name}</span>
            : <span className="th-name th-meta-x">company name not reported</span>}
          {held ? <span className="th-pill">IN PORTFOLIO · {held} sh</span> : null}
        </div>
        <div className="th-meta">
          {p.exchange ? <span>{p.exchange}</span> : <span className="th-meta-x">exchange not reported</span>}
          <i>·</i>
          {p.industry ? <span>{p.industry}</span> : <span className="th-meta-x">industry not reported</span>}
          <i>·</i>
          {/* The reference's third slot. This feed does not carry a sector and
              this file will not invent one, so it says where the value would
              have to come from instead of filling the gap with a guess. */}
          {p.sector
            ? <span title={`sector from ${p.sectorSource}`}>{p.sector}</span>
            : <span className="th-meta-x">no sector — set one on the holding</span>}
        </div>
      </div>
    </div>
  );
}

// ---------- price + the chip that cannot travel alone (decision A) ----------

export function ChangeChip({ change, cur = '$' }) {
  if (!change) return <span className="th-chip th-chip-none">no change to measure yet</span>;
  const up = change.abs >= 0;
  const col = up ? 'var(--green)' : 'var(--red)';
  return (
    <span className="th-chip" style={{ color: col, borderColor: col }}>
      <b>{up ? '▲' : '▼'} {pct(change.pct)}</b>
      <span className="th-chip-abs">{up ? '+' : '−'}{cur}{f2(Math.abs(change.abs))}</span>
      {/* The baseline is inside the chip, not in a caption near it, so the
          percentage cannot be read or screenshotted without it. */}
      <span className="th-chip-base">since {change.fromLabel} · {cur}{f2(change.fromPrice)}</span>
    </span>
  );
}

// ---------- the chart ----------

export function PriceChart({ rows, field = 'price', cur = '$', unit = '', second = null }) {
  const g = useMemo(() => {
    if (!second) return T.chartGeometry(rows, field);
    // Decision from the lib's `scale` note: both lines are measured against the
    // union of both ranges, so the gap between them is drawn to scale.
    const a = T.chartGeometry(rows, field);
    const b = T.chartGeometry(rows, second);
    if (!a || !b) return a || b;
    const sc = { lo: Math.min(a.lo, b.lo), hi: Math.max(a.hi, b.hi) };
    return T.chartGeometry(rows, field, 640, 220, 8, sc);
  }, [rows, field, second]);

  const g2 = useMemo(() => {
    if (!second || !g) return null;
    return T.chartGeometry(rows, second, 640, 220, 8, { lo: g.lo, hi: g.hi });
  }, [rows, second, g && g.lo, g && g.hi]);

  const axis = useMemo(() => T.axisDates(rows, 5), [rows]);

  if (!g) {
    return <Empty icon="◠" text="Fewer than two bars in this window — there is nothing to draw a line between." />;
  }
  const col = g.up ? 'var(--green)' : 'var(--red)';
  return (
    <div className="th-chart">
      <svg viewBox={`0 0 ${g.w} ${g.h}`} className="th-svg" shapeRendering="crispEdges" role="img"
        aria-label="price over the selected window">
        <polygon points={g.area} fill={col} opacity="0.14" />
        {g2 && <polyline points={g2.line} fill="none" stroke="var(--ink-3)" strokeWidth="1.5" strokeDasharray="4 3" />}
        <polyline points={g.line} fill="none" stroke={col} strokeWidth="2"
          style={{ filter: `drop-shadow(0 0 4px ${col})` }} />
      </svg>
      <div className="th-axis">
        {axis.map((a, i) => (
          <span key={i} className="th-ax" style={{ left: `${a.pct}%` }}>{a.label}</span>
        ))}
      </div>
      {/* The vertical range is printed because a line chart with a cropped y
          axis can make a 0.4% week look like a crash, and nothing on the picture
          itself says which one it is. */}
      <p className="th-yrange">
        vertical range {unit ? '' : cur}{f2(g.lo)}{unit} – {unit ? '' : cur}{f2(g.hi)}{unit}
        <span className="th-dim"> · {g.n} bars · axis does not start at zero</span>
      </p>
    </div>
  );
}

// ---------- the brush (decision B) ----------

export function Brush({ rows, sel, onChange }) {
  if (!rows || rows.length < 4 || !sel) return null;
  const n = rows.length;
  const spark = T.chartGeometry(rows, 'price', 640, 40, 3);
  const pctOf = i => (i / (n - 1)) * 100;
  return (
    <div className="th-brush">
      <div className="th-brush-svg">
        {spark && (
          <svg viewBox="0 0 640 40" shapeRendering="crispEdges" role="presentation">
            <polyline points={spark.line} fill="none" stroke="var(--ink-3)" strokeWidth="1" />
          </svg>
        )}
        <span className="th-brush-sel"
          style={{ left: `${pctOf(sel.lo)}%`, width: `${pctOf(sel.hi) - pctOf(sel.lo)}%` }} />
      </div>
      <div className="th-brush-ctl">
        <input className="th-brush-r" type="range" min="0" max={n - 1} value={sel.lo}
          aria-label="window start"
          onChange={e => onChange(T.brushClamp(+e.target.value, sel.hi, n))} />
        <input className="th-brush-r" type="range" min="0" max={n - 1} value={sel.hi}
          aria-label="window end"
          onChange={e => onChange(T.brushClamp(sel.lo, +e.target.value, n))} />
      </div>
      <p className="th-brush-lab">
        {T.dayOf(rows[sel.lo].t)} → {T.dayOf(rows[sel.hi].t)}
        <span className="th-dim"> · {sel.hi - sel.lo + 1} of {n} bars</span>
        {!sel.full && (
          <button className="btn btn-sm" onClick={() => onChange(T.brushClamp(0, n - 1, n))}>reset</button>
        )}
      </p>
    </div>
  );
}

// ---------- market cap: the refusal, printed (decision 2 of the lib) ----------

export function CapPanel({ profile, price, cur = '$' }) {
  const c = T.capFigure(profile, price);
  return (
    <div className="th-cap">
      <div className="tile-row">
        <StatTile label="Market cap · live" value={T.fmtCapM(c.live, cur)}
          note={c.shares !== null ? `${f1(c.shares)}M shares × ${cur}${f2(price)}` : 'no share count reported'}
          color="var(--cyan)" />
        <StatTile label="Market cap · as reported" value={T.fmtCapM(c.reported, cur)}
          note="from the profile snapshot, up to a day old" color="var(--ink-2)" />
        <StatTile label="The two disagree by" value={c.gapPct === null ? '—' : pct(c.gapPct)}
          note={c.disagrees ? 'more than a day of price movement can explain' : 'within a day of price movement'}
          color={c.disagrees ? 'var(--orange)' : 'var(--ink-3)'} />
      </div>
      <p className="th-cap-refuse">{T.CAP_REFUSAL}</p>
    </div>
  );
}

// ---------- the screen ----------

export default function TickerHead({ held = [], quotes = {}, cur = '$' }) {
  const tickers = useMemo(
    () => [...new Set(held.map(h => String(h.ticker || '').toUpperCase()).filter(Boolean))].sort(),
    [held.map(h => h.ticker).join(',')], // eslint-disable-line
  );

  // The selected ticker is DERIVED, not synced by an effect. The effect version
  // — set it in useEffect once `tickers` arrives — leaves one render with an
  // empty ticker, which is one render that asks the profile feed about "". It
  // also strands the selection when the holding it points at is sold: the state
  // still says NVDA, NVDA is no longer in the list, and the screen shows a
  // header for something Neel does not own. Deriving fixes both by construction.
  const [pick, setPick] = useState('');
  const ticker = pick && tickers.includes(pick) ? pick : (tickers[0] || '');
  const setTicker = setPick;
  const [range, setRange] = useState('1Y');
  const [mode, setMode] = useState('price');
  const [candles, setCandles] = useState({});     // `${ticker}|${range}` -> bars
  const [prof, setProf] = useState({});           // ticker -> profile
  const [sel, setSel] = useState(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');

  const { items: mem } = useCollection('memory', { filter: `key=eq.${F.FV_MEMORY_KEY}`, order: 'key' });
  const blob = mem?.[0]?.value || {};

  // The profile is cached for a day inside fundamentals.js, so this one may run
  // on open. The PRICE request may not — Twelve Data sells eight a minute and an
  // effect that fires on every range press would spend the budget on a toggle.
  useEffect(() => {
    if (!ticker) return undefined;
    let dead = false;
    fetchFundamentals(ticker)
      .then(v => { if (!dead) setProf(p => ({ ...p, [ticker]: v?.profile || null })); })
      .catch(() => { if (!dead) setProf(p => ({ ...p, [ticker]: null })); });
    return () => { dead = true; };
  }, [ticker]);

  const key = `${ticker}|${range}`;
  const bars = candles[key] || null;
  const win = useMemo(() => (bars ? T.windowOf(bars, range) : null), [bars, range]);

  // A new window resets the brush to full rather than keeping indices that
  // pointed into a different list — index 40 of a 1D chart and index 40 of a 10Y
  // one are not the same moment, and carrying one into the other is a silent
  // jump to an unrelated date.
  useEffect(() => {
    setSel(win && win.rows.length >= 2 ? T.brushClamp(0, win.rows.length - 1, win.rows.length) : null);
  }, [key, win && win.rows.length]);

  const rows = useMemo(() => {
    if (!win) return [];
    if (!sel) return win.rows;
    return win.rows.slice(sel.lo, sel.hi + 1);
  }, [win, sel]);

  const q = quotes[ticker] || {};
  const price = Number.isFinite(+q.price) && +q.price > 0
    ? +q.price
    : (rows.length ? rows[rows.length - 1].price : null);

  // Decision A: the previous-close baseline survives only on a full 1D window.
  const usePrev = range === '1D' && (!sel || sel.full);
  const change = useMemo(
    () => T.changeOver(rows, usePrev ? q.prevClose : null),
    [rows, usePrev, q.prevClose],
  );

  // Decision C: one basis, named.
  const divPick = useMemo(() => {
    for (const b of DIV_BASES) {
      const e = F.readEntries(blob, ticker, 'dividend', b);
      if (e.length) return { basis: b, entries: e };
    }
    return { basis: null, entries: [] };
  }, [blob, ticker]);

  const tr = useMemo(
    () => (mode === 'treturn' ? T.totalReturn(rows, divPick.entries) : null),
    [mode, rows, divPick.entries],
  );

  const savedMeta = useMemo(() => {
    const h = held.find(x => String(x.ticker || '').toUpperCase() === ticker);
    try { return h ? metaOf(h) : null; } catch { return null; }
  }, [held, ticker]);

  const p = useMemo(() => T.profileOf(prof[ticker], savedMeta), [prof, ticker, savedMeta]);
  const qty = useMemo(() => {
    const n = held.filter(h => String(h.ticker || '').toUpperCase() === ticker)
      .reduce((a, h) => a + (Number(h.qty) || 0), 0);
    return n > 0 ? n : null;
  }, [held, ticker]);

  const rMeta = T.rangeMeta(range);
  const mMeta = T.modeMeta(mode);

  async function load() {
    if (!ticker || busy) return;
    setErr(''); setBusy(ticker);
    try {
      const c = await fetchCandles(ticker, rMeta.tf);
      setCandles(prev => ({ ...prev, [`${ticker}|${range}`]: c }));
    } catch (e) {
      setErr(e.message === 'NO_KEY'
        ? 'No Twelve Data key in Settings — this chart is price history and needs one.'
        : e.message);
    }
    setBusy('');
  }

  if (!tickers.length) {
    return (
      <Card title="Ticker" color="var(--cyan)">
        <Empty icon="◫" text="No holdings yet. Add one in Portfolio and its chart opens here." />
      </Card>
    );
  }

  return (
    <Card title="Ticker" color="var(--cyan)"
      right={<span className="th-badge">{rMeta.label} · {mMeta.label}</span>}>

      <div className="th-bar">
        <span className="seg">
          {tickers.slice(0, 12).map(t => (
            <button key={t} className={`seg-btn${ticker === t ? ' on' : ''}`} onClick={() => setTicker(t)}>{t}</button>
          ))}
        </span>
      </div>

      <HeadLine ticker={ticker} prof={p} held={qty} />

      <div className="th-price">
        <span className="th-px">{price === null ? '—' : `${cur}${f2(price)}`}</span>
        <ChangeChip change={change} cur={cur} />
        {q.live ? <span className="th-live">LIVE</span> : <span className="th-live th-dim">last close</span>}
      </div>

      <div className="th-bar">
        <span className="seg th-ranges">
          {T.RANGES.map(r => (
            <button key={r.key} className={`seg-btn${range === r.key ? ' on' : ''}`}
              onClick={() => setRange(r.key)} title={r.note}>{r.label}</button>
          ))}
        </span>
        <button className="btn btn-cyan btn-sm" onClick={load} disabled={!!busy}>
          {busy ? `loading ${busy}…` : bars ? 'reload' : 'load prices'}
        </button>
      </div>

      <div className="th-bar">
        <span className="seg">
          {T.MODES.map(m => (
            <button key={m.key} className={`seg-btn${mode === m.key ? ' on' : ''}`}
              onClick={() => setMode(m.key)} title={m.note}>{m.label}</button>
          ))}
        </span>
      </div>

      <p className="th-note">{mMeta.note}</p>
      {err && <p className="th-err">{err}</p>}

      {/* Decision 4 of the lib, surfaced: a range whose data starts later than
          its own label says so on the picture rather than in a console. */}
      {win && win.short && (
        <p className="th-short">
          This feed's history for {ticker} begins {win.feedFrom}, which is later than {rMeta.label} asks for.
          The line below is everything there is, not everything the label implies.
        </p>
      )}

      {!bars && (
        <Empty icon="⌁" text={`Press “load prices” for ${ticker}. One request per press — the free feed allows eight a minute, so this screen never fetches on its own.`} />
      )}

      {bars && mode === 'price' && <PriceChart rows={rows} field="price" cur={cur} />}

      {bars && mode === 'treturn' && tr && tr.state === 'ok' && (
        <>
          <PriceChart rows={tr.rows} field="tr" second="px" cur={cur} unit="" />
          <div className="tile-row">
            <StatTile label="Price alone" value={pct(tr.pricePct)} note={`${tr.from} → ${tr.to}`} color="var(--ink-2)" />
            <StatTile label="With dividends reinvested" value={pct(tr.totalPct)}
              note={`${tr.credited.length} payout${tr.credited.length === 1 ? '' : 's'} inside this window`} color="var(--green)" />
            <StatTile label="The dividends were worth" value={`${tr.dividendPct >= 0 ? '+' : ''}${f2(tr.dividendPct)} pts`}
              note="of total return, over this window" color="var(--cyan)" />
          </div>
          <p className="th-note">
            Using the <b>{F.basisMeta(divPick.basis).label}</b> dividend figures you typed on the Value screen.
            {tr.skipped.length > 0 && ` ${tr.skipped.length} year${tr.skipped.length === 1 ? '' : 's'} you typed fall outside this window and were not used.`}
            {' '}Each year's cash is credited on that year's last bar, not on its real ex-dates — which understates
            compounding slightly, by weeks of reinvestment.
          </p>
        </>
      )}

      {bars && mode === 'treturn' && tr && tr.state === 'no_dividends' && (
        <Empty icon="◇" text={`No dividends typed for ${ticker}. Open the Value screen, pick the Dividend metric, and type the per-share cash by year — there is no free dividend feed, so this line cannot be drawn without them. The price line is not shown here relabelled.`} />
      )}

      {bars && mode === 'treturn' && tr && tr.state === 'no_history' && (
        <Empty icon="◠" text="Fewer than two priced bars in this window, so there is nothing to compound." />
      )}

      {bars && mode === 'mcap' && <CapPanel profile={prof[ticker]} price={price} cur={cur} />}

      {bars && mode !== 'mcap' && (
        <Brush rows={win ? win.rows : []} sel={sel} onChange={s => s && setSel(s)} />
      )}

      {win && win.dropped > 0 && (
        <p className="th-note th-dim">{win.dropped} bar{win.dropped === 1 ? '' : 's'} came back without a usable close and were dropped.</p>
      )}

      <p className="th-disc">{T.HEAD_DISCLAIMER}</p>
    </Card>
  );
}
