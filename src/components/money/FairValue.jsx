import React, { useEffect, useMemo, useState } from 'react';
import { Card, StatTile, Empty } from '../ui.jsx';
import * as F from '../../lib/fairvalue.js';
import * as db from '../../lib/db.js';
import { useCollection } from '../../lib/hooks.js';
import { fetchCandles } from '../../lib/marketdata.js';

// The screen half of lib/fairvalue.js.
//
// Two things about this layout are deliberate departures from the reference
// image, and both come out of the same worry: this is the screen most likely to
// be believed, because a big number with a percentage under it looks like a
// finding rather than a division.
//
//   The verdict is a measurement, not a verdict. The reference says "Good
//   entry" in green. This says where the price sits against a band, names the
//   multiple, and names the window, in one sentence that cannot be quoted
//   without its own basis attached.
//
//   The figures editor is not hidden behind a settings gear. It is on the same
//   screen, below the chart, because every number above it came out of those
//   boxes and burying the input makes the output look like it arrived from
//   somewhere authoritative. Neel should be able to see his own typing.
//
// The spectrum bar is the widget the other valuation screens will reuse, so it
// is exported on its own and takes plain numbers rather than a result object.

const f2 = n => (Number.isFinite(n) ? n.toFixed(2) : '—');
const f1 = n => (Number.isFinite(n) ? n.toFixed(1) : '—');
const mult = n => (Number.isFinite(n) ? `${n.toFixed(1)}×` : '—');

// ---------- the Cheap → Expensive track ----------

export function SpectrumBar({ min, median, max, current, tag }) {
  const has = [min, median, max].every(Number.isFinite);
  const pos = has ? F.positionOf(current, min, max) : null;
  const medPos = has ? F.positionOf(median, min, max) : null;
  return (
    <div className="fv-spec">
      <div className="fv-spec-track">
        {/* Six blocks rather than a smooth gradient. A gradient implies the
            scale is continuous and meaningful; blocks say "five buckets", which
            is all the precision a hand-typed band can carry. */}
        {[0, 1, 2, 3, 4, 5].map(i => <span key={i} className={`fv-spec-blk fv-blk-${i}`} />)}
        {Number.isFinite(medPos) && (
          <span className="fv-spec-med" style={{ left: `${medPos}%` }} title="median multiple" />
        )}
        {Number.isFinite(pos) && (
          <span className="fv-spec-mark" style={{ left: `${pos}%`, borderColor: tag?.color || 'var(--ink)' }}>
            <span className="fv-spec-mark-v" style={{ color: tag?.color || 'var(--ink)' }}>{mult(current)}</span>
          </span>
        )}
      </div>
      <div className="fv-spec-scale">
        <span className="fv-spec-end">
          <b>MIN</b> {mult(min)}
        </span>
        <span className="fv-spec-mid">
          <b>MEDIAN</b> {mult(median)}
        </span>
        <span className="fv-spec-end fv-spec-end-r">
          <b>MAX</b> {mult(max)}
        </span>
      </div>
      <div className="fv-spec-ends">
        <span className="fv-spec-cheap">CHEAP FOR THIS STOCK</span>
        <span className="fv-spec-exp">EXPENSIVE FOR THIS STOCK</span>
      </div>
    </div>
  );
}

// ---------- price against the implied line ----------

export function PriceVsFair({ series, target, cur = '$' }) {
  const g = useMemo(() => F.chartGeometry(series), [series]);
  if (!g) {
    return <Empty icon="◠" text="Not enough paired periods to draw a line. Load more price history, or add earlier years below." />;
  }
  return (
    <div className="fv-chart">
      <svg viewBox={`0 0 ${g.w} ${g.h}`} className="fv-svg" shapeRendering="crispEdges" role="img"
        aria-label="price against the value implied by the target multiple">
        {/* One polygon per stretch on the same side of the line. A single
            polygon with one fill would colour four years by whatever happened
            to be true on the last day. */}
        {g.polys.map((p, i) => (
          <polygon key={i} points={p.points}
            fill={p.under ? 'var(--green)' : 'var(--red)'} opacity="0.18" />
        ))}
        <polyline points={g.fair} fill="none" stroke="var(--cyan)" strokeWidth="1.5" strokeDasharray="4 3" />
        <polyline points={g.price} fill="none" stroke="var(--ink)" strokeWidth="2"
          style={{ filter: 'drop-shadow(0 0 3px var(--ink-3))' }} />
      </svg>
      <div className="fv-legend">
        <span className="fv-lg"><i className="fv-lg-solid" /> price</span>
        <span className="fv-lg"><i className="fv-lg-dash" /> {mult(target)} × the figure known that day</span>
        <span className="fv-lg"><i className="fv-lg-g" /> price under it</span>
        <span className="fv-lg"><i className="fv-lg-r" /> price over it</span>
        <span className="fv-lg fv-lg-dim">{cur}{f2(g.lo)} – {cur}{f2(g.hi)}</span>
      </div>
    </div>
  );
}

// ---------- what got left out ----------

// Decision 3 on screen. These counts exist so that a suspiciously tight band can
// be explained rather than merely trusted: a band built from 40 of 1,200 days is
// not the same claim as a band built from 1,200.
export function Counts({ counts, spectrum }) {
  if (!counts) return null;
  const used = spectrum ? spectrum.n : 0;
  const bits = [];
  if (counts.noEntry) bits.push(`${counts.noEntry} had no finished financial year to divide by`);
  if (counts.nonPositive) bits.push(`${counts.nonPositive} fell in a year the figure was zero or negative`);
  if (counts.capped) bits.push(`${counts.capped} produced a multiple over ${F.MULTIPLE_CAP}× and were dropped as a near-zero denominator`);
  return (
    <p className="fv-counts">
      Band built from <b>{used}</b> of {counts.considered} trading days in the window.
      {bits.length > 0 && <> Of the rest, {bits.join('; ')}.</>}
    </p>
  );
}

// ---------- the typing ----------

export function FigureEditor({ rows, onChange, meta, basis }) {
  const bm = F.basisMeta(basis);
  return (
    <div className="fv-edit">
      <p className="fv-edit-note">{meta.note}</p>
      <p className="fv-edit-note fv-dim">
        Filed under <b>{bm.label}</b> — {bm.title} Nothing here checks your figure against a filing;
        it is stored exactly as typed, on this basis only.
      </p>
      <div className="fv-edit-grid">
        <span className="fv-edit-h">Financial year</span>
        <span className="fv-edit-h">{meta.label} per share</span>
        <span className="fv-edit-h" />
        {rows.map((r, i) => (
          <React.Fragment key={i}>
            <input className="fv-in" inputMode="numeric" placeholder="2025" value={r.year}
              onChange={e => onChange(rows.map((x, j) => (j === i ? { ...x, year: e.target.value } : x)))} />
            <input className="fv-in" inputMode="decimal" placeholder="5.61" value={r.value}
              onChange={e => onChange(rows.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
            <button className="btn btn-sm fv-del" onClick={() => onChange(rows.filter((_, j) => j !== i))}
              aria-label="remove this year">×</button>
          </React.Fragment>
        ))}
      </div>
      <button className="btn btn-sm" onClick={() => onChange([...rows, { year: '', value: '' }])}>+ add a year</button>
    </div>
  );
}

// ---------- the panel ----------

export default function FairValue({ held = [], quotes = {}, cur = '$' }) {
  const tickers = useMemo(
    () => [...new Set(held.map(h => String(h.ticker || '').toUpperCase()).filter(Boolean))].sort(),
    [held.map(h => h.ticker).join(',')], // eslint-disable-line
  );

  const [ticker, setTicker] = useState('');
  const [metric, setMetric] = useState('eps');
  const [basis, setBasis] = useState('adj');
  const [lookback, setLookback] = useState(5);
  const [target, setTarget] = useState('');
  const [candles, setCandles] = useState({});   // ticker -> bars
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [rows, setRows] = useState([]);
  const [saved, setSaved] = useState('');

  const { items: mem, refresh } = useCollection('memory', { filter: `key=eq.${F.FV_MEMORY_KEY}`, order: 'key' });
  const blob = mem?.[0]?.value || {};

  useEffect(() => { if (!ticker && tickers.length) setTicker(tickers[0]); }, [tickers, ticker]);

  // The editor is refilled from storage whenever the slot it points at changes.
  // Switching basis with unsaved typing therefore discards it — which is the
  // right way round, because the alternative is carrying GAAP numbers into the
  // adjusted slot and saving them there.
  useEffect(() => {
    const e = F.readEntries(blob, ticker, metric, basis);
    setRows(e.map(x => ({ year: String(x.year), value: String(x.value) })));
    setSaved('');
  }, [ticker, metric, basis, mem]); // eslint-disable-line

  const bars = candles[ticker] || [];
  const price = Number(quotes[ticker]?.price) || (bars.length ? bars[bars.length - 1].c : null);

  const r = useMemo(() => F.computeFairValue({
    candles: bars,
    entries: rows,
    metric, basis, lookback,
    price,
    target: target.trim() === '' ? null : target,
  }), [bars, rows, metric, basis, lookback, price, target]);

  const v = F.verdictOf(r);
  const tag = F.bandTag(r.percentile);
  const meta = F.metricMeta(metric);
  const series = useMemo(
    () => (r.state === 'ok' ? F.fairSeries(bars, rows, r.target) : []),
    [bars, rows, r.state, r.target],
  );

  async function load() {
    if (!ticker || busy) return;
    setErr(''); setBusy(ticker);
    try {
      // One request. The band wants a decade if it can get one; ALL is monthly
      // bars, which is plenty for a multiple that only moves when a year ends.
      const c = await fetchCandles(ticker, lookback && lookback <= 5 ? '5Y' : 'ALL');
      setCandles(p => ({ ...p, [ticker]: c }));
    } catch (e) {
      setErr(e.message === 'NO_KEY'
        ? 'No Twelve Data key in Settings — the band is built from price history and needs one.'
        : e.message);
    }
    setBusy('');
  }

  async function save() {
    setSaved('');
    try {
      await db.upsertMemory(F.FV_MEMORY_KEY, F.writeEntries(blob, ticker, metric, basis, rows));
      setSaved(`Saved ${F.cleanEntries(rows).length} year${F.cleanEntries(rows).length === 1 ? '' : 's'} for ${ticker} · ${meta.label} · ${F.basisMeta(basis).label}.`);
      refresh();
    } catch (e) { setErr(e.message); }
  }

  if (!tickers.length) {
    return (
      <Card title="Fair value spectrum" color="var(--cyan)">
        <Empty icon="◫" text="No holdings yet. Add one in Portfolio and its valuation band builds from there." />
      </Card>
    );
  }

  return (
    <Card title="Fair value spectrum" color={tag?.color || 'var(--cyan)'}
      right={<span className="fv-badge">{meta.short}</span>}>

      <div className="fv-bar">
        <span className="seg">
          {tickers.slice(0, 12).map(t => (
            <button key={t} className={`seg-btn${ticker === t ? ' on' : ''}`} onClick={() => setTicker(t)}>{t}</button>
          ))}
        </span>
      </div>

      <div className="fv-bar">
        <span className="seg">
          {F.METRICS.map(m => (
            <button key={m.key} className={`seg-btn${metric === m.key ? ' on' : ''}`}
              onClick={() => setMetric(m.key)} title={m.note}>{m.label}</button>
          ))}
        </span>
      </div>

      <div className="fv-bar">
        <span className="seg">
          {F.BASES.map(b => (
            <button key={b.key} className={`seg-btn${basis === b.key ? ' on' : ''}`}
              onClick={() => setBasis(b.key)} title={b.title}>{b.label}</button>
          ))}
        </span>
        <span className="seg">
          {F.LOOKBACKS.map(y => (
            <button key={y} className={`seg-btn${lookback === y ? ' on' : ''}`}
              onClick={() => setLookback(y)}>{F.lookbackLabel(y)}</button>
          ))}
        </span>
        <button className="btn btn-cyan btn-sm" onClick={load} disabled={!!busy}>
          {busy ? `loading ${busy}…` : bars.length ? 'reload prices' : 'load price history'}
        </button>
      </div>

      {err && <p className="fv-err">{err}</p>}

      {/* Decision 5: a measurement where the reference put a verdict. */}
      {v ? (
        <div className="fv-verdict" style={{ borderLeftColor: tag?.color || 'var(--ink-3)' }}>
          {tag && <span className="fv-tag" style={{ color: tag.color, borderColor: tag.color }}>{tag.label}</span>}
          <p className="fv-head">{v.headline}</p>
          <p className="fv-detail">{v.detail}</p>
        </div>
      ) : (
        <div className="fv-verdict fv-verdict-none">
          <p className="fv-head fv-dim">No reading</p>
          <p className="fv-detail">{r.reason}</p>
        </div>
      )}

      <div className="tile-row">
        <StatTile label="Current price" value={price === null ? '—' : `${cur}${f2(price)}`}
          note={bars.length ? `${bars.length} bars loaded` : 'live quote'} color="var(--ink)" />
        <StatTile label={`Target ${meta.short}`} value={mult(r.target)}
          note={r.targetSource || 'needs a band'} color="var(--cyan)" />
        <StatTile label="Implied value" value={r.implied === null ? '—' : `${cur}${f2(r.implied)}`}
          note={r.current ? `${mult(r.target)} × ${r.current.value}` : 'no figure'} color="var(--purple)" />
        <StatTile label="Gap to implied"
          value={r.gapPct === null ? '—' : `${r.gapPct >= 0 ? '+' : ''}${f1(r.gapPct)}%`}
          note={r.gapPct === null ? '—' : r.gapPct >= 0 ? 'price is under it' : 'price is over it'}
          color={r.gapPct === null ? 'var(--ink-3)' : r.gapPct >= 0 ? 'var(--green)' : 'var(--red)'} />
      </div>

      {r.spectrum && (
        <>
          <SpectrumBar min={r.spectrum.min} median={r.spectrum.median} max={r.spectrum.max}
            current={r.currentMultiple} tag={tag} />
          <Counts counts={r.counts} spectrum={r.spectrum} />
        </>
      )}

      <div className="fv-sec">
        <span className="fv-sec-t">Price vs. the implied line</span>
        <input className="fv-in fv-in-t" inputMode="decimal" placeholder={r.spectrum ? f1(r.spectrum.median) : 'target ×'}
          value={target} onChange={e => setTarget(e.target.value)}
          aria-label="override the target multiple" />
        <span className="fv-sec-n">override the target multiple</span>
      </div>

      {r.state === 'ok'
        ? <PriceVsFair series={series} target={r.target} cur={cur} />
        : <Empty icon="◠" text="The chart draws once there is a band and a figure to draw it against." />}

      <div className="fv-sec">
        <span className="fv-sec-t">
          {meta.label} per share · {ticker} · {F.basisMeta(basis).label}
        </span>
        <button className="btn btn-green btn-sm" onClick={save}>save figures</button>
      </div>

      <FigureEditor rows={rows} onChange={setRows} meta={meta} basis={basis} />
      {saved && <p className="fv-saved">{saved}</p>}

      <p className="fv-disc">{F.DISCLAIMER}</p>
    </Card>
  );
}
