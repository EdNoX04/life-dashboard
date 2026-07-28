import React, { useEffect, useMemo, useState } from 'react';
import { Card, Empty, StatTile } from '../ui.jsx';
import { memGet, memSet } from '../../lib/advisor.js';
import { metaOf, assetMetaSync, loadAssetMeta } from '../../lib/assets.js';
import {
  DEFAULT_RATES, RATE_FIELDS, fyBounds, fyList, realised, taxPosition,
  harvestCandidates, harvestEffect, filingPack, toCSV,
} from '../../lib/tax.js';

// The tax desk.
//
// The order of this screen is deliberate and is an argument about trust: the rates
// come FIRST, before a single figure is computed from them, because a tax number
// whose rate you have not seen is worse than no number at all. Then what has
// actually been realised. Then — clearly fenced off — what has not.
//
// Nothing here is tax advice. The screen says so at the top and at the bottom, and
// the filing pack says so in writing, because this is the one part of the app where
// someone could plausibly act on a number without checking it.

const KEY = 'tax_rates';

const fmtMoney = (n, cur = '₹') => {
  const v = Math.abs(Math.round(n || 0));
  const s = v.toLocaleString('en-IN');
  return `${n < 0 ? '−' : ''}${cur}${s}`;
};

// ---- the rate editor -----------------------------------------------------

export function RateEditor({ rates = DEFAULT_RATES, onChange, onReset }) {
  return (
    <div>
      <div className="tx-warn small mb">
        These rates were last set for <b>{rates.asOf}</b>. Tax rates change most budgets, and nothing in this
        app checks whether they are still current — that is the one thing it cannot know. Confirm them before
        anything computed below leaves this screen.
      </div>
      <div className="tx-rates">
        {RATE_FIELDS.map(f => (
          <label key={f.key} className="tx-rrow" title={f.hint}>
            <span className="tx-rlabel">{f.label}</span>
            <input
              className="tx-rin" type="number" min="0" step="0.5"
              value={rates[f.key] ?? ''}
              onChange={e => onChange(f.key, e.target.value)}
            />
          </label>
        ))}
      </div>
      <div className="flex mt" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <button className="btn btn-sm" onClick={onReset}>reset to defaults</button>
        <span className="small muted">{DEFAULT_RATES.note}</span>
      </div>
    </div>
  );
}

// ---- what has actually been realised -------------------------------------

export function RealisedTable({ r, position, cur = '₹' }) {
  if (!r || !r.lots.length) return null;
  const rows = [
    { label: 'India · short-term', gain: r.inShort, tax: position.inShort, c: 'c-orange' },
    { label: 'India · long-term', gain: r.inLong, tax: position.inLong, c: 'c-green' },
    { label: 'Foreign · short-term', gain: r.fgShort, tax: position.fgShort, c: 'c-orange' },
    { label: 'Foreign · long-term', gain: r.fgLong, tax: position.fgLong, c: 'c-green' },
  ];
  return (
    <table className="ptable tx-table">
      <thead><tr><th>Bucket</th><th>Gain</th><th>Tax</th></tr></thead>
      <tbody>
        {rows.map(row => (
          <tr key={row.label} className={row.gain === 0 ? 'tx-zero' : ''}>
            <td><span className={`chip ${row.c}`}>{row.label}</span></td>
            <td style={{ color: row.gain < 0 ? 'var(--red)' : row.gain > 0 ? 'var(--green)' : 'var(--ink-3)' }}>
              {fmtMoney(row.gain, cur)}
            </td>
            <td>{row.tax > 0 ? fmtMoney(row.tax, cur) : <span className="muted">—</span>}</td>
          </tr>
        ))}
        <tr className="tx-total">
          <td><b>Total incl. cess</b></td>
          <td className="muted">—</td>
          <td><b style={{ color: 'var(--yellow)' }}>{fmtMoney(position.total, cur)}</b></td>
        </tr>
      </tbody>
    </table>
  );
}

// ---- harvest candidates --------------------------------------------------

export function HarvestTable({ cands = [], picked = {}, onPick, cur = '₹' }) {
  if (!cands.length) return null;
  return (
    <table className="ptable tx-table">
      <thead>
        <tr><th> </th><th>Holding</th><th>Qty</th><th>Held</th><th>Cost</th><th>Now</th><th>Unrealised loss</th><th>Buy-back</th></tr>
      </thead>
      <tbody>
        {cands.map((c, i) => {
          const id = `${c.ticker}:${c.boughtTs}`;
          return (
            <tr key={id} className={c.washRisk ? 'tx-wash' : ''}>
              <td>
                <input type="checkbox" checked={!!picked[id]} onChange={() => onPick(id)} />
              </td>
              <td>{c.name}</td>
              <td>{c.qty}</td>
              <td>
                <span className={`chip ${c.term === 'long' ? 'c-green' : 'c-orange'}`}>
                  {c.term === 'long' ? 'long' : 'short'} · {c.days}d
                </span>
              </td>
              <td>{fmtMoney(c.cost, cur)}</td>
              <td>{fmtMoney(c.value, cur)}</td>
              <td style={{ color: 'var(--red)' }}>{fmtMoney(c.loss, cur)}</td>
              <td>
                {c.washRisk
                  ? <span className={`chip ${c.washKind === 'statutory' ? 'c-red' : 'c-yellow'}`}>
                      {c.washKind === 'statutory' ? 'wash rule' : 'looks like a device'}
                    </span>
                  : <span className="muted">—</span>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ---- the filing pack -----------------------------------------------------

export function FilingPack({ pack, cur = '₹', onCSV }) {
  if (!pack) return null;
  return (
    <>
      <table className="ptable tx-table">
        <thead><tr><th>Code</th><th>Line</th><th>Amount</th></tr></thead>
        <tbody>
          {pack.lines.map(l => (
            <tr key={l.code} className={l.amount === 0 ? 'tx-zero' : ''}>
              <td><span className="chip c-cyan">{l.code}</span></td>
              <td>{l.label}</td>
              <td>{fmtMoney(l.amount, cur)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {pack.scheduleFA.length > 0 && (
        <div className="mt">
          <div className="small mb" style={{ color: 'var(--pink)' }}>
            Schedule FA — foreign assets held at any point in the year
          </div>
          <table className="ptable tx-table">
            <thead><tr><th>Asset</th><th>Units</th><th>Value</th></tr></thead>
            <tbody>
              {pack.scheduleFA.map(a => (
                <tr key={a.ticker}><td>{a.name}</td><td>{a.qty}</td><td>{fmtMoney(a.value, cur)}</td></tr>
              ))}
            </tbody>
          </table>
          <div className="small muted mt">
            This is a disclosure, not a tax. It is required whether or not anything was sold, and leaving it
            out is penalised far more harshly than the tax on the assets it discloses.
          </div>
        </div>
      )}

      <div className="tx-caveats mt">
        {pack.caveats.map((c, i) => <div key={i} className="small muted tx-caveat">{c}</div>)}
      </div>

      <button className="btn btn-sm btn-cyan mt" onClick={onCSV}>download CSV</button>
    </>
  );
}

// ---- the desk ------------------------------------------------------------

export default function TaxDesk({ held = [], orders = [], priceOf = () => null, dividends = 0, cur = '₹' }) {
  const [rates, setRates] = useState(DEFAULT_RATES);
  const [saved, setSaved] = useState(assetMetaSync());
  const [fyIdx, setFyIdx] = useState(0);
  const [picked, setPicked] = useState({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    loadAssetMeta().then(m => { if (alive) setSaved(m); });
    memGet(KEY).then(v => {
      if (!alive) return;
      if (v && typeof v === 'object') setRates({ ...DEFAULT_RATES, ...v });
      setLoaded(true);
    });
    return () => { alive = false; };
  }, []);

  const years = useMemo(() => fyList(4), []);
  const fy = years[fyIdx] || fyBounds();

  // Domicile is a property of the asset and comes from the asset metadata, not
  // from a guess about the ticker. Anything the metadata does not call US is
  // treated as domestic, which is the conservative direction: it uses the
  // shorter threshold and the lower rate rather than inventing a foreign one.
  const foreignByTicker = useMemo(() => {
    const m = {};
    for (const h of held) if (h?.ticker) m[h.ticker] = metaOf(h, saved).market === 'US';
    return m;
  }, [held, saved]);

  const r = useMemo(
    () => realised({ orders, fy, foreignOf: t => !!foreignByTicker[t], rates }),
    [orders, fy, foreignByTicker, rates]
  );
  const position = useMemo(() => taxPosition(r, rates), [r, rates]);

  const cands = useMemo(
    () => harvestCandidates({
      held, orders, priceOf,
      foreignOf: h => !!foreignByTicker[h.ticker],
      rates,
    }),
    [held, orders, priceOf, foreignByTicker, rates]
  );

  const picks = useMemo(
    () => cands.filter(c => picked[`${c.ticker}:${c.boughtTs}`]),
    [cands, picked]
  );
  const effect = useMemo(() => harvestEffect(r, picks, rates), [r, picks, rates]);

  const foreignAssets = useMemo(
    () => held
      .filter(h => foreignByTicker[h.ticker])
      .map(h => ({ ticker: h.ticker, name: h.name || h.ticker, qty: h.qty, value: (Number(h.qty) || 0) * (Number(priceOf(h)) || 0) })),
    [held, foreignByTicker, priceOf]
  );

  const pack = useMemo(
    () => filingPack({ r, position, dividends, foreignWht: 0, foreignAssets }),
    [r, position, dividends, foreignAssets]
  );

  const setRate = (k, v) => {
    const next = { ...rates, [k]: v === '' ? '' : Number(v), asOf: new Date().toISOString().slice(0, 7) };
    setRates(next);
    memSet(KEY, next);
  };
  const reset = () => { setRates(DEFAULT_RATES); memSet(KEY, DEFAULT_RATES); };
  const pick = id => setPicked(p => ({ ...p, [id]: !p[id] }));

  const downloadCSV = () => {
    const blob = new Blob([toCSV(pack)], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `tax-${fy.label}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const money = n => fmtMoney(n, cur);

  return (
    <>
      <Card title="Rates — read these first" color="var(--orange)">
        <RateEditor rates={rates} onChange={setRate} onReset={reset} />
      </Card>

      <Card
        title={`Realised — ${fy.label}`}
        color="var(--cyan)"
        className="mt"
        right={
          <div className="seg">
            {years.map((y, i) => (
              <button key={y.label} className={`seg-btn${i === fyIdx ? ' on' : ''}`} onClick={() => setFyIdx(i)}>
                {y.label.replace('FY', '')}
              </button>
            ))}
          </div>
        }
      >
        {r.lots.length === 0 ? (
          <Empty icon="⌁" text={`Nothing was sold in ${fy.label}, so there is no capital gain to report for it. A year with no disposals is a year with no capital-gains tax, however much the book moved.`} />
        ) : (
          <>
            <div className="tile-row mb">
              <StatTile label="TAXABLE GAIN" value={money(r.inShort + position.inLongTaxable + r.fgShort + r.fgLong)} note={`${r.lots.length} disposals`} color="var(--cyan)" />
              <StatTile label="TAX + CESS" value={money(position.total)} note={`cess at ${rates.cess}%`} color="var(--yellow)" />
              <StatTile label="EXEMPTION USED" value={money(position.exemptionUsed)} note={`${money(position.exemptionLeft)} left this year`} color="var(--green)" />
            </div>
            <RealisedTable r={r} position={position} cur={cur} />
            <div className="small muted mt">
              The financial year runs 1 April to 31 March, so a sale in January belongs to the year that opened
              the previous April. The long-term exemption of {money(rates.inLongExempt)} is annual and is shared
              across every holding — it is applied once here, to the total, not once per stock.
            </div>
            {(position.carry.short < 0 || position.carry.long < 0) && (
              <div className="tx-warn small mt">
                {money(position.carry.short + position.carry.long)} of losses were realised. They do not reduce
                this year's bill to below zero — they carry forward, and the rules for how far and against what
                are not modelled here.
              </div>
            )}
            {r.incomplete && (
              <div className="tx-warn small mt">
                {r.orphan} holding{r.orphan === 1 ? '' : 's'} had a sale with no matching purchase on the tape.
                Those shares have no cost basis here, so their gain is understated. The tape is missing trades.
              </div>
            )}
          </>
        )}
      </Card>

      <Card title="Losses you could realise — nothing here has happened" color="var(--pink)" className="mt">
        {cands.length === 0 ? (
          <Empty icon="◇" text="No open lot is currently below what it cost. There is nothing to harvest, which is the pleasant version of this problem." />
        ) : (
          <>
            <div className="small muted mb">
              Every row below is <b>unrealised</b>. It is a position that could be sold, not one that was.
              Nothing here affects the figures above until an order actually exists on the tape.
            </div>
            <HarvestTable cands={cands} picked={picked} onPick={pick} cur={cur} />
            <div className="small muted mt">
              A red <b>wash rule</b> flag is US statute: selling at a loss and buying back inside
              {' '}{cands[0].washDays} days disallows the loss outright. A yellow flag is the Indian case, where
              no equivalent statute exists for listed equity — but buying straight back is exactly the pattern
              an assessing officer reads as a device, and it is worth being able to explain.
            </div>

            {picks.length > 0 && (
              <div className="tx-effect mt">
                <div className="tile-row">
                  <StatTile label="LOSS SELECTED" value={money(effect.lossUsed)} note={`${picks.length} lot${picks.length === 1 ? '' : 's'}`} color="var(--red)" />
                  <StatTile label="TAX BEFORE" value={money(effect.before.total)} color="var(--ink-2)" />
                  <StatTile label="TAX AFTER" value={money(effect.after.total)} color="var(--cyan)" />
                  <StatTile label="SAVED" value={money(effect.saved)} color={effect.wasted ? 'var(--orange)' : 'var(--green)'} />
                </div>
                {effect.wasted && (
                  <div className="tx-warn small mt">
                    This saves nothing. The exemption already covers the gain for {fy.label}, so realising these
                    losses spends them for no benefit — a loss carried into a year with a real gain is worth
                    more than one used against a year with none.
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </Card>

      <Card title={`Filing pack — ${fy.label}`} color="var(--green)" className="mt">
        <div className="small muted mb">
          This is not a return. It is the set of figures a return asks for, laid out so the conversation with an
          accountant starts from arithmetic instead of screenshots.
        </div>
        <FilingPack pack={pack} cur={cur} onCSV={downloadCSV} />
      </Card>

      <div className="ai-note mt">
        Everything on this screen is arithmetic on rates you entered and trades you recorded. It does not know
        your slab, your other income, your residency history, or which of the many exceptions apply to you —
        and every one of those changes the answer. It is not tax advice and cannot be filed as it stands. Hand
        it to your accountant; that is what it is for.
      </div>
    </>
  );
}
