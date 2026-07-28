import React, { useEffect, useMemo, useState } from 'react';
import { Card, Empty, money } from '../ui.jsx';
import {
  MARKETS, KINDS, CAPS, CAP_LABEL,
  loadAssetMeta, assetMetaSync, saveAssetMeta, metaOf, groupHoldings,
  loadFixedIncome, saveFixedIncome, fdValue, bondValue, EMPTY_FI,
  allocationBreakdown, concentration,
} from '../../lib/assets.js';
import AllocationPie from './AllocationPie.jsx';
import HoldingsTable from './HoldingsTable.jsx';

// The book, split the way Neel actually thinks about it: Indian equity and
// international equity are separate worlds with separate currencies and separate
// market hours, and inside each, funds behave differently from single names.
//
// Each section carries its own return on the left edge — a coloured strip with the
// percentage running down it — so the shape of the book reads at a glance before
// any number is parsed.

const pctTxt = n => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1)}%`;
const toneOf = n => (n >= 0 ? 'var(--green)' : 'var(--red)');

function EdgeStrip({ pct }) {
  const c = toneOf(pct);
  return (
    <div
      title={`${pctTxt(pct)} on this sleeve`}
      style={{
        width: 34, flex: '0 0 34px', alignSelf: 'stretch',
        background: `linear-gradient(180deg, ${c}22, transparent)`,
        borderRight: `2px solid ${c}`, display: 'flex',
        alignItems: 'center', justifyContent: 'center',
      }}
    >
      <span style={{
        color: c, fontSize: 11, letterSpacing: 1,
        writingMode: 'vertical-rl', transform: 'rotate(180deg)',
        filter: `drop-shadow(0 0 3px ${c})`,
      }}>
        {pctTxt(pct)}
      </span>
    </div>
  );
}

function Section({ g, priceOf, quotes, visible, onOpen, onClassify }) {
  const [editing, setEditing] = useState(null);
  const cur = g.cur;
  const fmt = n => money(n, visible, cur);

  return (
    <div className="px card" style={{ padding: 0, overflow: 'hidden' }}>
      <div className="flex" style={{ gap: 0, alignItems: 'stretch' }}>
        <EdgeStrip pct={g.pnlPct} />
        <div style={{ flex: 1, minWidth: 0, padding: '10px 12px' }}>
          <div className="card-title spread" style={{ marginBottom: 8 }}>
            <span className="flex" style={{ gap: 8 }}>
              <span className="sq" style={{ background: g.color }} />
              {g.title}
            </span>
            <span className="flex" style={{ gap: 6 }}>
              <span className="chip">{g.rows.length}</span>
              <span className="chip" style={{ color: toneOf(g.pnl), borderColor: toneOf(g.pnl) }}>
                {g.pnl >= 0 ? '▲' : '▼'} {fmt(Math.abs(g.pnl))}
              </span>
              <span className="chip c-cyan">{fmt(g.value)}</span>
            </span>
          </div>

          <div className="scroll-x">
            <table className="ptable">
              <thead>
                <tr><th>Ticker</th><th>Qty</th><th>Avg</th><th>Last</th><th>Day</th><th>Value</th><th>P&L</th><th>Cap</th></tr>
              </thead>
              <tbody>
                {g.rows.map(h => {
                  const price = priceOf(h);
                  const v = Number(h.qty) * price;
                  const c = Number(h.qty) * Number(h.avg_cost || 0);
                  const p = h.avg_cost ? v - c : null;
                  const pp = c ? (p / c) * 100 : 0;
                  const dp = quotes?.[h.ticker]?.changePct;
                  const cap = h.meta.cap;
                  return (
                    <tr key={h.id} style={{ cursor: 'pointer' }} onClick={() => onOpen?.(h)}>
                      <td><b style={{ fontWeight: 'normal', color: 'var(--cyan)' }}>{h.ticker} ›</b></td>
                      <td>{Number(h.qty).toFixed(4)}</td>
                      <td>{money(h.avg_cost, visible, cur)}</td>
                      <td>{price ? cur + price.toFixed(2) : '—'}</td>
                      <td style={{ color: dp == null ? undefined : toneOf(dp) }}>
                        {dp == null ? '—' : `${dp >= 0 ? '+' : ''}${dp.toFixed(2)}%`}
                      </td>
                      <td>{fmt(v)}</td>
                      <td style={{ color: p == null ? undefined : toneOf(p) }}>
                        {fmt(p)} {h.avg_cost ? <span className="small">({pp >= 0 ? '+' : ''}{pp.toFixed(1)}%)</span> : ''}
                      </td>
                      <td onClick={e => { e.stopPropagation(); setEditing(editing === h.id ? null : h.id); }}>
                        <span className={`chip${cap ? '' : ' c-yellow'}`} style={{ cursor: 'pointer' }}>
                          {cap ? CAP_LABEL[cap].replace(' cap', '') : 'set'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {editing && (
            <div className="flex mt" style={{ gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
              <span className="small muted">Market cap band for {g.rows.find(r => r.id === editing)?.ticker}:</span>
              {CAPS.map(k => (
                <button key={k} className="btn btn-sm"
                  onClick={() => { onClassify(g.rows.find(r => r.id === editing).ticker, { cap: k }); setEditing(null); }}>
                  {CAP_LABEL[k]}
                </button>
              ))}
              <button className="btn btn-sm" onClick={() => setEditing(null)}>✕</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- fixed income: FDs and bonds, entered by hand because no API has them ----

const BLANK_FD = { bank: '', principal: '', rate: '', start: '', maturity: '', payout: 'cumulative' };
const BLANK_BOND = { name: '', qty: '', face: '', price: '', coupon: '', maturity: '', avg_cost: '' };

function FixedIncome({ fi, setFi, visible }) {
  const [tab, setTab] = useState('fd');
  const [fd, setFd] = useState(BLANK_FD);
  const [bond, setBond] = useState(BLANK_BOND);

  const fdRows = (fi.fds || []).map(f => ({ ...f, calc: fdValue(f) }));
  const bondRows = (fi.bonds || []).map(b => ({ ...b, calc: bondValue(b) }));
  const fdTotal = fdRows.reduce((s, r) => s + r.calc.value, 0);
  const bondTotal = bondRows.reduce((s, r) => s + r.calc.value, 0);
  const coupons = bondRows.reduce((s, r) => s + r.calc.annualCoupon, 0);

  const commit = next => { setFi(next); saveFixedIncome(next); };
  const addFd = () => {
    if (!fd.bank.trim() || !Number(fd.principal)) return;
    commit({ ...fi, fds: [...(fi.fds || []), { ...fd, id: `fd_${Date.now()}`, principal: Number(fd.principal), rate: Number(fd.rate) }] });
    setFd(BLANK_FD);
  };
  const addBond = () => {
    if (!bond.name.trim() || !Number(bond.qty)) return;
    commit({ ...fi, bonds: [...(fi.bonds || []), { ...bond, id: `bd_${Date.now()}`, qty: Number(bond.qty), face: Number(bond.face), price: Number(bond.price || bond.face), coupon: Number(bond.coupon) }] });
    setBond(BLANK_BOND);
  };
  const dropFd = id => commit({ ...fi, fds: fi.fds.filter(f => f.id !== id) });
  const dropBond = id => commit({ ...fi, bonds: fi.bonds.filter(b => b.id !== id) });

  const rupee = n => money(n, visible, '₹');

  return (
    <Card title="Fixed income — deposits & bonds" color="var(--yellow)" right={
      <span className="seg">
        <button className={`seg-btn${tab === 'fd' ? ' on' : ''}`} onClick={() => setTab('fd')}>FDs</button>
        <button className={`seg-btn${tab === 'bond' ? ' on' : ''}`} onClick={() => setTab('bond')}>Bonds</button>
      </span>
    }>
      <div className="small muted">
        Nothing here fetches itself — banks and bond registrars have no public feed, so
        these are typed in once and then valued forward. FDs compound quarterly (the
        Indian cumulative-deposit norm) unless you mark them simple-interest.
      </div>

      {tab === 'fd' && <>
        {fdRows.length === 0 && <Empty icon="₹" text="No deposits logged. Add one below and it will accrue on its own." />}
        {fdRows.length > 0 && (
          <div className="scroll-x mt">
            <table className="ptable">
              <thead><tr><th>Bank</th><th>Principal</th><th>Rate</th><th>Matures</th><th>Value now</th><th>Interest</th><th /></tr></thead>
              <tbody>
                {fdRows.map(r => (
                  <tr key={r.id}>
                    <td style={{ color: 'var(--cyan)' }}>{r.bank}{r.calc.matured && <span className="chip c-green" style={{ marginLeft: 6 }}>matured</span>}</td>
                    <td>{rupee(r.principal)}</td>
                    <td>{Number(r.rate).toFixed(2)}%</td>
                    <td className="small">{r.maturity || '—'}</td>
                    <td>{rupee(r.calc.value)}</td>
                    <td style={{ color: 'var(--green)' }}>{rupee(r.calc.interest)}</td>
                    <td><button className="btn btn-sm" onClick={() => dropFd(r.id)}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex mt" style={{ flexWrap: 'wrap' }}>
          <input style={{ width: 130 }} placeholder="Bank" value={fd.bank} onChange={e => setFd({ ...fd, bank: e.target.value })} />
          <input style={{ width: 110 }} type="number" placeholder="Principal ₹" value={fd.principal} onChange={e => setFd({ ...fd, principal: e.target.value })} />
          <input style={{ width: 80 }} type="number" placeholder="Rate %" value={fd.rate} onChange={e => setFd({ ...fd, rate: e.target.value })} />
          <input style={{ width: 140 }} type="date" title="Start" value={fd.start} onChange={e => setFd({ ...fd, start: e.target.value })} />
          <input style={{ width: 140 }} type="date" title="Maturity" value={fd.maturity} onChange={e => setFd({ ...fd, maturity: e.target.value })} />
          <select value={fd.payout} onChange={e => setFd({ ...fd, payout: e.target.value })}>
            <option value="cumulative">Cumulative</option>
            <option value="simple">Simple interest</option>
          </select>
          <button className="btn btn-sm btn-green" onClick={addFd}>+ Add FD</button>
        </div>
        <div className="mt" style={{ textAlign: 'right' }}>
          <span className="small muted">Deposits total: </span><span className="chip c-yellow">{rupee(fdTotal)}</span>
        </div>
      </>}

      {tab === 'bond' && <>
        {bondRows.length === 0 && <Empty icon="※" text="No bonds logged yet." />}
        {bondRows.length > 0 && (
          <div className="scroll-x mt">
            <table className="ptable">
              <thead><tr><th>Bond</th><th>Qty</th><th>Face</th><th>Price</th><th>Coupon</th><th>Value</th><th>YTM</th><th /></tr></thead>
              <tbody>
                {bondRows.map(r => (
                  <tr key={r.id}>
                    <td style={{ color: 'var(--cyan)' }}>{r.name}</td>
                    <td>{r.qty}</td>
                    <td>{rupee(r.face)}</td>
                    <td>{rupee(r.price)}</td>
                    <td>{Number(r.coupon).toFixed(2)}%</td>
                    <td>{rupee(r.calc.value)}</td>
                    <td style={{ color: 'var(--yellow)' }}>{r.calc.ytm.toFixed(2)}%</td>
                    <td><button className="btn btn-sm" onClick={() => dropBond(r.id)}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex mt" style={{ flexWrap: 'wrap' }}>
          <input style={{ width: 150 }} placeholder="Bond name" value={bond.name} onChange={e => setBond({ ...bond, name: e.target.value })} />
          <input style={{ width: 70 }} type="number" placeholder="Qty" value={bond.qty} onChange={e => setBond({ ...bond, qty: e.target.value })} />
          <input style={{ width: 90 }} type="number" placeholder="Face ₹" value={bond.face} onChange={e => setBond({ ...bond, face: e.target.value })} />
          <input style={{ width: 90 }} type="number" placeholder="Price ₹" value={bond.price} onChange={e => setBond({ ...bond, price: e.target.value })} />
          <input style={{ width: 90 }} type="number" placeholder="Coupon %" value={bond.coupon} onChange={e => setBond({ ...bond, coupon: e.target.value })} />
          <input style={{ width: 140 }} type="date" title="Maturity" value={bond.maturity} onChange={e => setBond({ ...bond, maturity: e.target.value })} />
          <button className="btn btn-sm btn-green" onClick={addBond}>+ Add bond</button>
        </div>
        <div className="mt" style={{ textAlign: 'right' }}>
          <span className="small muted">Bonds {rupee(bondTotal)} · annual coupon income </span>
          <span className="chip c-green">{rupee(coupons)}</span>
        </div>
      </>}
    </Card>
  );
}

export default function Book({ held = [], priceOf, quotes = {}, visible = true, onOpen, fx = null, inr = false, crypto = [] }) {
  const [metaVer, setMetaVer] = useState(0);
  const [fi, setFi] = useState(EMPTY_FI);

  useEffect(() => {
    loadAssetMeta().then(() => setMetaVer(v => v + 1)).catch(() => {});
    loadFixedIncome().then(setFi).catch(() => {});
  }, []);

  const groups = useMemo(
    () => groupHoldings(held, priceOf, assetMetaSync()),
    [held, quotes, metaVer] // eslint-disable-line
  );

  async function classify(ticker, patch) {
    await saveAssetMeta(ticker, patch);
    setMetaVer(v => v + 1);
  }

  const alloc = useMemo(
    () => allocationBreakdown({ held, priceOf, saved: assetMetaSync(), fi, crypto, fx: fx || 1, inr }),
    [held, quotes, metaVer, fi, crypto, fx, inr] // eslint-disable-line
  );
  const conc = useMemo(() => concentration(held, priceOf), [held, quotes]); // eslint-disable-line
  const dcur = inr ? '₹' : '$';

  return (
    <>
      {groups.length === 0 && (
        <Empty icon="$" text="No holdings yet — snapshot from INDmoney or add one on the Portfolio tab." />
      )}

      {held.length > 0 && (
        <HoldingsTable held={held} priceOf={priceOf} quotes={quotes}
          cur={dcur} fx={fx} inr={inr} onOpen={onOpen} visible={visible} />
      )}

      {alloc.total > 0 && (
        <Card title="Asset allocation" color="var(--purple)"
          right={<span className="chip c-cyan">{money(alloc.total, visible, dcur)}</span>}>
          <div className="grid2">
            <div>
              <div className="small muted" style={{ marginBottom: 6 }}>By asset class</div>
              <AllocationPie slices={alloc.byClass} label="CLASS" />
            </div>
            <div>
              <div className="small muted" style={{ marginBottom: 6 }}>By market cap</div>
              <AllocationPie slices={alloc.byCap} label="CAP" />
            </div>
          </div>
          <div className="flex mt" style={{ gap: 8, flexWrap: 'wrap' }}>
            <span className="chip">Top position {conc.top1.toFixed(1)}%</span>
            <span className="chip">Top 3 {conc.top3.toFixed(1)}%</span>
            <span className="chip">Top 5 {conc.top5.toFixed(1)}%</span>
            <span className={`chip ${conc.hhi > 0.25 ? 'c-red' : conc.hhi > 0.15 ? 'c-yellow' : 'c-green'}`}>
              Effective holdings {conc.effectiveN.toFixed(1)}
            </span>
          </div>
          <div className="small muted mt">
            "Effective holdings" is 1/HHI — how many equal-sized positions your book
            behaves like. Ten names with one of them at 60% behaves closer to three.
            Cap bands come from the tags you set in the tables below; untagged names
            sit in "Unclassified" rather than being guessed at.
          </div>
        </Card>
      )}
      {groups.map(g => (
        <Section key={g.id} g={g} priceOf={priceOf} quotes={quotes} visible={visible}
          onOpen={onOpen} onClassify={classify} />
      ))}
      <FixedIncome fi={fi} setFi={setFi} visible={visible} />
    </>
  );
}
