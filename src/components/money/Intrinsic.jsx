import React, { useEffect, useMemo, useState } from 'react';
import { Card, StatTile, Empty } from '../ui.jsx';
import * as V from '../../lib/intrinsic.js';
import * as db from '../../lib/db.js';
import { useCollection } from '../../lib/hooks.js';

// The screen half of lib/intrinsic.js.
//
// Three layout decisions, all downstream of the same worry that shaped
// FairValue.jsx: this is the screen most likely to be believed, because a big
// rupee figure labelled "intrinsic value" looks like a fact about a company
// rather than the output of six numbers somebody guessed.
//
//   THE RANGE IS THE HEADLINE, NOT THE BASE CASE. The bear and bull figures are
//   the same size as the base one and sit beside it, because the spread is the
//   finding. A layout that puts one number in 32px type and the range in a
//   footnote has decided for you which to remember.
//
//   THE INPUTS ARE ON THE SAME SCREEN, ALWAYS VISIBLE. Not behind a gear. Every
//   number above them came out of those boxes, and hiding the boxes makes the
//   output look like it arrived from somewhere with a research department.
//
//   THE WORKING IS SHOWN. Year by year: the cash flow, the discount factor, the
//   present value. A valuation you cannot check is one you are taking on trust,
//   and the whole point of building this rather than subscribing to it is that
//   you should not have to.

const f0 = n => (Number.isFinite(n) ? Math.round(n).toLocaleString('en-IN') : '—');
const f2 = n => (Number.isFinite(n) ? n.toFixed(2) : '—');
const pct = n => (Number.isFinite(n) ? `${n >= 0 ? '' : '−'}${Math.abs(n).toFixed(1)}%` : '—');

// ---------- the bear → bull track ----------

// A range bar rather than a gauge, because there is no maximum here — the scale
// is set by the two extremes the model itself produced. The price marker is the
// only thing on it that is a fact.
export function RangeBar({ lo, hi, base, price }) {
  const ok = Number.isFinite(lo) && Number.isFinite(hi) && hi > lo;
  const span = ok ? hi - lo : 0;
  // The track is padded by 15% either side so a price outside the range still
  // lands on the bar rather than clipping at an end, where it would read as
  // "exactly at the edge" — which is a different claim.
  const pad = span * 0.15;
  const a = lo - pad, b = hi + pad;
  const at = v => (Number.isFinite(v) && b > a ? Math.max(0, Math.min(100, ((v - a) / (b - a)) * 100)) : null);
  const l = at(lo), h = at(hi), bp = at(base), pp = at(price);

  return (
    <div className="iv-range">
      <div className="iv-range-track">
        {ok && (
          <span className="iv-range-band" style={{ left: `${l}%`, width: `${h - l}%` }} />
        )}
        {Number.isFinite(bp) && <span className="iv-range-base" style={{ left: `${bp}%` }} title="base case" />}
        {Number.isFinite(pp) && (
          <span className="iv-range-price" style={{ left: `${pp}%` }}>
            <span className="iv-range-price-v">₹{f0(price)}</span>
          </span>
        )}
      </div>
      <div className="iv-range-scale">
        <span><b>BEAR</b> ₹{f0(lo)}</span>
        <span className="iv-range-mid"><b>BASE</b> ₹{f0(base)}</span>
        <span><b>BULL</b> ₹{f0(hi)}</span>
      </div>
    </div>
  );
}

// ---------- the year-by-year working ----------

function WorkingTable({ result }) {
  if (!result?.ok || !result.rows?.length) return null;
  return (
    <div className="iv-work">
      <div className="iv-work-head">
        <span>YR</span><span>GROWTH</span><span>CASH FLOW</span><span>× FACTOR</span><span>PRESENT VALUE</span>
      </div>
      {result.rows.map(r => (
        <div className="iv-work-row" key={r.year}>
          <span className="iv-work-yr">{r.year}</span>
          <span className="muted">{r.growth.toFixed(1)}%</span>
          <span>₹{f2(r.cashFlow)}</span>
          <span className="muted">{r.factor.toFixed(4)}</span>
          <span className="iv-work-pv">₹{f2(r.pv)}</span>
        </div>
      ))}
      <div className="iv-work-row iv-work-sum">
        <span /><span /><span className="muted">explicit years</span><span />
        <span className="iv-work-pv">₹{f2(result.pvExplicit)}</span>
      </div>
      <div className="iv-work-row iv-work-sum">
        <span /><span /><span className="muted">terminal value</span>
        <span className="muted">₹{f0(result.terminal)} raw</span>
        <span className="iv-work-pv">₹{f2(result.terminalPV)}</span>
      </div>
      {Number.isFinite(result.netCash) && result.netCash !== 0 && (
        <div className="iv-work-row iv-work-sum">
          <span /><span /><span className="muted">net cash</span><span />
          <span className="iv-work-pv">₹{f2(result.netCash)}</span>
        </div>
      )}
      <div className="iv-work-row iv-work-total">
        <span /><span /><span>VALUE PER SHARE</span><span />
        <span>₹{f2(result.value)}</span>
      </div>
      {Number.isFinite(result.terminalShare) && (
        <div className={`iv-term-share${result.terminalShare > 0.75 ? ' iv-term-warn' : ''}`}>
          {(result.terminalShare * 100).toFixed(0)}% of this figure is terminal value —
          {result.terminalShare > 0.75
            ? ' which means the projected decade is decoration and the answer is almost entirely your guess about growth forever.'
            : ' the share that comes from the perpetuity rather than the projected years.'}
        </div>
      )}
    </div>
  );
}

// ---------- the sensitivity grid ----------

function Sensitivity({ model, inputs, price }) {
  const grid = useMemo(() => V.sensitivityGrid(model, inputs), [model, inputs]);
  if (!grid) return null;
  const p = Number(price) || null;
  return (
    <div className="iv-grid-wrap">
      <div className="iv-grid">
        <div className="iv-grid-row iv-grid-head">
          <span className="iv-grid-corner">rate ↓ / term →</span>
          {grid.terms.map(t => <span key={t}>{t.toFixed(2)}%</span>)}
        </div>
        {grid.cells.map((row, i) => (
          <div className="iv-grid-row" key={grid.rates[i]}>
            <span className="iv-grid-rate">{grid.rates[i].toFixed(1)}%</span>
            {row.map(c => (
              <span
                key={`${c.rate}-${c.terminal}`}
                className={`iv-grid-cell${c.value === null ? ' iv-grid-na' : p && c.value >= p ? ' iv-grid-over' : p ? ' iv-grid-under' : ''}`}
                title={c.reason || `discount ${c.rate.toFixed(1)}%, terminal ${c.terminal.toFixed(2)}%`}
              >
                {c.value === null ? '—' : f0(c.value)}
              </span>
            ))}
          </div>
        ))}
      </div>
      <div className="small muted mt">
        {/* The whole reason the grid is here. */}
        Every cell is the same company with the same cash flows — only the two rates move, by one
        point and a quarter point. The spread across this table is the honest error bar on any
        single figure above it.
        {p ? ' Green cells value the share above today\'s price, dim cells below it.' : ''}
      </div>
    </div>
  );
}

// ---------- the screen ----------

export default function Intrinsic({ held = [], quotes = {}, cur = '₹' }) {
  const tickers = useMemo(
    () => [...new Set(held.map(h => String(h.ticker || '').toUpperCase()).filter(Boolean))].sort(),
    [held.map(h => h.ticker).join(',')], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const [ticker, setTicker] = useState('');
  const [model, setModel] = useState('dcf');
  const [draft, setDraft] = useState({});
  const [saved, setSaved] = useState('');
  const [showWork, setShowWork] = useState(false);
  const [showGrid, setShowGrid] = useState(false);

  const { items: mem, refresh } = useCollection('memory', { filter: `key=eq.${V.IV_MEMORY_KEY}`, order: 'key' });
  const blob = mem?.[0]?.value || {};

  useEffect(() => { if (!ticker && tickers.length) setTicker(tickers[0]); }, [tickers, ticker]);

  // Reload the draft whenever the slot changes. The draft is per ticker AND per
  // model, so switching models cannot silently carry a DCF's growth rate into
  // the Graham formula, where the same number means something different.
  useEffect(() => {
    if (!ticker) return;
    setDraft(V.readInputs(blob, ticker, model));
    setSaved('');
  }, [ticker, model, mem]); // eslint-disable-line react-hooks/exhaustive-deps

  const meta = V.modelMeta(model);
  const price = Number(quotes[ticker]?.price) || null;

  const scenarios = useMemo(() => V.runScenarios(model, draft), [model, draft]);
  const range = useMemo(() => V.readRange(scenarios, price), [scenarios, price]);
  const baseResult = scenarios.find(s => s.scenario.key === 'base')?.result || null;

  const setField = (k, v) => setDraft(d => ({ ...d, [k]: v }));

  const save = async () => {
    if (!ticker) return;
    await db.upsertMemory(V.IV_MEMORY_KEY, V.writeInputs(blob, ticker, model, draft));
    setSaved(`Saved your ${meta.label} inputs for ${ticker}.`);
    refresh?.();
  };

  if (!tickers.length) {
    return (
      <Card title="Intrinsic value" color="var(--purple)">
        <Empty icon="∑" text="No holdings to value yet."
          note="This screen values a share from the cash it produces rather than from what the market pays for it. Add a holding and it becomes available." />
      </Card>
    );
  }

  return (
    <>
      <Card title="Intrinsic value" color="var(--purple)"
        right={<span className="small muted">{meta.short}</span>}>

        <span className="seg iv-seg">
          {tickers.slice(0, 12).map(t => (
            <button key={t} className={`seg-btn${ticker === t ? ' on' : ''}`} onClick={() => setTicker(t)}>{t}</button>
          ))}
        </span>

        <span className="seg iv-seg mt">
          {V.MODELS.map(m => (
            <button key={m.key} className={`seg-btn${model === m.key ? ' on' : ''}`}
              onClick={() => setModel(m.key)} title={m.blurb}>{m.label}</button>
          ))}
        </span>

        <div className="iv-blurb">
          {meta.blurb}
          <div className="small muted mt">Best on: {meta.best}</div>
        </div>
      </Card>

      {/* ---- the inputs, deliberately above the answer ---- */}
      <Card title={`Your assumptions · ${ticker}`} color="var(--orange)"
        right={<button className="btn btn-sm" onClick={save}>save</button>}>
        <div className="iv-inputs">
          {meta.needs.map(k => {
            const spec = V.INPUTS[k];
            if (!spec) return null;
            return (
              <label className="iv-input" key={k} title={spec.hint}>
                <span className="iv-input-label">{spec.label}</span>
                <span className="iv-input-box">
                  {spec.unit === '₹' && <span className="rupee">₹</span>}
                  <input type="number" step={spec.step} value={draft[k] ?? ''}
                    placeholder="—"
                    onChange={e => setField(k, e.target.value)} />
                  {spec.unit !== '₹' && <span className="iv-input-unit">{spec.unit}</span>}
                </span>
                <span className="iv-input-hint">{spec.hint}</span>
              </label>
            );
          })}
          {(model === 'dcf' || model === 'sdcf') && (
            <label className="iv-input" title={V.INPUTS.netCash.hint}>
              <span className="iv-input-label">{V.INPUTS.netCash.label}</span>
              <span className="iv-input-box">
                <span className="rupee">₹</span>
                <input type="number" step={0.01} value={draft.netCash ?? ''} placeholder="0"
                  onChange={e => setField('netCash', e.target.value)} />
              </span>
              <span className="iv-input-hint">{V.INPUTS.netCash.hint}</span>
            </label>
          )}
        </div>
        {saved && <div className="iv-saved">{saved}</div>}
        <div className="small muted mt">
          Nothing here is fetched. There is no free feed for cash flow or book value, and there could
          never be one for the discount rate — that is your required return, which is a judgement.
        </div>
      </Card>

      {/* ---- the three scenarios, equally weighted ---- */}
      <Card title="Bear · Base · Bull" color="var(--cyan)"
        right={price ? <span className="small muted">price {cur}{f0(price)}</span> : null}>
        <div className="iv-scen">
          {scenarios.map(({ scenario, inputs, result }) => (
            <div className={`iv-scen-col iv-scen-${scenario.key}`} key={scenario.key}>
              <div className="iv-scen-head" style={{ color: scenario.color }}>{scenario.label}</div>
              {result.ok ? (
                <>
                  <div className="iv-scen-val" style={{ color: scenario.color }}>
                    <span className="rupee">₹</span>{f0(result.value)}
                  </div>
                  <div className="iv-scen-assum">
                    growth {Number(inputs.growth).toFixed(1)}%
                    {model === 'graham'
                      ? ` · bond ${Number(inputs.bond).toFixed(1)}%`
                      : ` · discount ${Number(inputs.rate).toFixed(1)}%`}
                  </div>
                  {price && (
                    <div className="iv-scen-mos">
                      {(() => {
                        const m = V.marginOfSafety(result.value, price);
                        return m === null ? null : (
                          <span style={{ color: m >= 0 ? 'var(--green)' : 'var(--red)' }}>
                            {pct(m)} margin of safety
                          </span>
                        );
                      })()}
                    </div>
                  )}
                </>
              ) : (
                // A refusal renders as a refusal, in the same column, at the
                // same size. Collapsing it to a dash would let a model that
                // cannot be computed look like a model that computed to nothing.
                <div className="iv-scen-refuse">{result.reason}</div>
              )}
              <div className="iv-scen-note">{scenario.note}</div>
            </div>
          ))}
        </div>

        {range && range.verdict !== 'no_price' && (
          <>
            <RangeBar lo={range.lo} hi={range.hi} base={range.base} price={range.price} />
            <div className={`iv-verdict iv-verdict-${range.verdict}`}>
              <div className="iv-verdict-head">{range.headline}</div>
              <div className="iv-verdict-detail">{range.detail}</div>
            </div>
          </>
        )}
        {range && range.verdict === 'no_price' && (
          <Empty icon="◇" text={range.headline}
            note="Load prices on the Ticker screen and the comparison appears here." />
        )}
        {!range && (
          <Empty icon="∑" text="Nothing computable yet."
            note="Fill in the assumptions above. Each model states what it needs and refuses rather than guessing." />
        )}
      </Card>

      {/* ---- tiles ---- */}
      {baseResult?.ok && (
        <div className="tile-row">
          <StatTile label="Base case" value={`${cur}${f0(baseResult.value)}`}
            note="per share, your inputs unmodified" color="var(--cyan)" />
          <StatTile label="Price" value={price ? `${cur}${f0(price)}` : '—'}
            note="today" color="var(--ink)" />
          <StatTile label="Margin of safety"
            value={price ? pct(V.marginOfSafety(baseResult.value, price)) : '—'}
            note="how far price sits below the base case"
            color={price && V.marginOfSafety(baseResult.value, price) >= 0 ? 'var(--green)' : 'var(--red)'} />
          <StatTile label="Range width"
            value={range ? `${(((range.hi - range.lo) / range.base) * 100).toFixed(0)}%` : '—'}
            note="bear to bull, against base" color="var(--orange)" />
        </div>
      )}

      {/* ---- the working ---- */}
      {baseResult?.ok && (baseResult.rows?.length > 0) && (
        <Card title="The arithmetic" color="var(--green)"
          right={<button className="btn btn-sm" onClick={() => setShowWork(v => !v)}>
            {showWork ? '▲ hide' : '▼ show'}
          </button>}>
          {showWork
            ? <WorkingTable result={baseResult} />
            : <div className="small muted">Year by year: projected cash flow, the discount factor applied to it, and the present value that results. Every figure above is a sum of these.</div>}
        </Card>
      )}

      {/* ---- Graham and DDM show their (much shorter) working inline ---- */}
      {baseResult?.ok && model === 'graham' && (
        <Card title="The arithmetic" color="var(--green)">
          <div className="iv-formula">
            <span className="rupee">₹</span>{f2(baseResult.eps)} EPS
            × ({V.GRAHAM_BASE} + 2 × {baseResult.growth.toFixed(1)}) = {baseResult.multiple.toFixed(1)}× multiple
            × ({V.GRAHAM_BOND_NORM} ÷ {baseResult.bond.toFixed(1)}) = ×{baseResult.bondAdj.toFixed(3)} bond adjustment
          </div>
          <div className="iv-formula-total">= <span className="rupee">₹</span>{f2(baseResult.value)} per share</div>
          <div className="small muted mt" style={{ lineHeight: 1.5 }}>
            The growth term is linear, so a 20% grower is handed a multiple of 48.5. Graham published
            this as a rough screen and warned against precision with it. It stays here because it is
            fast and because where it disagrees with the DCF, the disagreement is informative — not
            because it is more reliable than the cash-flow models.
          </div>
        </Card>
      )}
      {baseResult?.ok && model === 'ddm' && (
        <Card title="The arithmetic" color="var(--green)">
          <div className="iv-formula">
            <span className="rupee">₹</span>{f2(baseResult.d0)} paid × (1 + {baseResult.growth.toFixed(1)}%)
            = <span className="rupee">₹</span>{f2(baseResult.d1)} next year
            ÷ ({baseResult.rate.toFixed(1)}% − {baseResult.growth.toFixed(1)}% = {baseResult.spread.toFixed(1)}%)
          </div>
          <div className="iv-formula-total">= <span className="rupee">₹</span>{f2(baseResult.value)} per share</div>
          <div className={`small mt${baseResult.spread < 2 ? ' iv-term-warn' : ' muted'}`} style={{ lineHeight: 1.5 }}>
            {baseResult.spread < 2
              ? `The gap between your discount rate and growth rate is only ${baseResult.spread.toFixed(1)} points. At that spread the value is roughly ${(100 / baseResult.spread).toFixed(0)}× the dividend, and moving either input by a quarter point moves the answer by more than 10%. This model is not telling you much here.`
              : 'The whole model is one division, which is its virtue and its limit: it assumes the dividend grows at exactly this rate forever and that nothing else about the company matters.'}
          </div>
        </Card>
      )}

      {/* ---- sensitivity ---- */}
      {baseResult?.ok && (model === 'dcf' || model === 'sdcf') && (
        <Card title="Sensitivity — the same company, two rates moved" color="var(--yellow)"
          right={<button className="btn btn-sm" onClick={() => setShowGrid(v => !v)}>
            {showGrid ? '▲ hide' : '▼ show'}
          </button>}>
          {showGrid
            ? <Sensitivity model={model} inputs={draft} price={price} />
            : <div className="small muted">A grid of values across a band of discount and terminal growth rates. Usually the most sobering thing on this screen.</div>}
        </Card>
      )}

      <div className="iv-disclaimer">{V.DISCLAIMER}</div>
    </>
  );
}
