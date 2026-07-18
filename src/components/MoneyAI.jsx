import React, { useEffect, useState } from 'react';
import { Card, Empty, StatTile } from './ui.jsx';
import { pickProvider, providerLabel } from '../lib/ai.js';
import { aiPortfolioAdvice, aiNextBuy, memGet } from '../lib/advisor.js';

const ago = at => {
  if (!at) return '';
  const m = Math.round((Date.now() - new Date(at).getTime()) / 60000);
  return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};
const actChip = a => (
  <span className={`chip ${a === 'BUY' ? 'c-green' : a === 'SELL' ? 'c-red' : 'c-yellow'}`} style={{ minWidth: 46, textAlign: 'center' }}>{a}</span>
);

export function RiskMeter({ level, onPick, label }) {
  const NAMES = ['', 'Safe', 'Cautious', 'Balanced', 'Aggressive', 'Degen'];
  return (
    <div className="riskmeter">
      {label && <span className="small muted" style={{ marginRight: 6 }}>{label}</span>}
      {[1, 2, 3, 4, 5].map(i => (
        <span key={i}
          className={`risk-seg${i <= level ? ' on' : ''}${onPick ? ' pick' : ''}`}
          style={{ '--rc': i <= 2 ? 'var(--green)' : i === 3 ? 'var(--yellow)' : 'var(--red)' }}
          onClick={onPick ? () => onPick(i) : undefined} />
      ))}
      <span className="small" style={{ color: level <= 2 ? 'var(--green)' : level === 3 ? 'var(--yellow)' : 'var(--red)', marginLeft: 6 }}>{NAMES[level] || ''}</span>
    </div>
  );
}

// ---- whole-portfolio verdict card ----
export function PortfolioAdvisor({ held, priceOf, quotes }) {
  const provider = pickProvider();
  const [advice, setAdvice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { memGet('ai_portfolio_advice').then(v => v && setAdvice(v)); }, []);

  async function run() {
    setBusy(true); setErr('');
    try { setAdvice(await aiPortfolioAdvice(held, priceOf, quotes)); }
    catch (e) { setErr(String(e.message || e)); }
    setBusy(false);
  }

  return (
    <Card title="AI portfolio advisor" color="var(--purple)"
      right={<span className="flex" style={{ gap: 6 }}>
        {advice?.at && <span className="chip">{ago(advice.at)}</span>}
        <button className="btn btn-sm btn-pink" onClick={run} disabled={busy || !provider || !held.length}>{busy ? 'analyzing…' : advice ? '↻ re-analyze' : '✦ Analyze'}</button>
      </span>}>
      {!provider && <Empty icon="✦" text="Add an AI key in Config → AI providers and this card scores your whole portfolio with buy/hold/sell calls per holding." />}
      {provider && !advice && !busy && <Empty icon="✦" text={`Hit Analyze — ${providerLabel(provider)} reads your live holdings + market conditions and gives a definitive verdict.`} />}
      {err && <div className="small" style={{ color: 'var(--red)', marginBottom: 8 }}>{err}</div>}
      {advice && (
        <>
          <div className="flex" style={{ gap: 18, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
            <div className="pscore" style={{ '--pc': advice.score >= 70 ? 'var(--green)' : advice.score >= 45 ? 'var(--yellow)' : 'var(--red)' }}>
              <span className="pscore-n">{advice.score}</span>
              <span className="pscore-l">SCORE</span>
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <span className="chip c-purple" style={{ marginBottom: 6, display: 'inline-block' }}>{advice.grade}</span>
              <div style={{ lineHeight: 1.55 }}>{advice.summary}</div>
            </div>
          </div>
          {(advice.holdings || []).map((h, i) => (
            <div className="row" key={i}>
              <b style={{ fontWeight: 'normal', color: 'var(--cyan)', minWidth: 62 }}>{h.ticker}</b>
              {actChip(h.action)}
              <span style={{ flex: 1 }} className="small">{h.reason}</span>
            </div>
          ))}
          <div className="small muted mt">{advice.disclaimer}</div>
        </>
      )}
    </Card>
  );
}

// ---- NEXT BUY desk (own view) ----
export function NextBuyDesk({ held, priceOf, quotes }) {
  const provider = pickProvider();
  const [budget, setBudget] = useState('');
  const [risk, setRisk] = useState(3);
  const [aiRisk, setAiRisk] = useState(true);
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { memGet('ai_next_buy').then(v => { if (v) { setRes(v); if (v.budget) setBudget(String(v.budget)); } }); }, []);

  async function run() {
    const b = Number(budget);
    if (!b || b <= 0) { setErr('Enter your US wallet budget first.'); return; }
    setBusy(true); setErr('');
    try { setRes(await aiNextBuy(held, priceOf, quotes, { budget: b, risk, aiRisk })); }
    catch (e) { setErr(String(e.message || e)); }
    setBusy(false);
  }

  return (
    <>
      <Card title="Next buy — AI suggestion desk" color="var(--pink)">
        {!provider && <Empty icon="✦" text="Add an AI key in Config → AI providers to unlock the suggestion desk." />}
        {provider && (
          <>
            <div className="flex" style={{ flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
              <label className="small muted">US wallet budget</label>
              <input style={{ width: 120 }} type="number" placeholder="$ e.g. 200" value={budget} onChange={e => setBudget(e.target.value)} />
              <span className="seg">
                <button className={`seg-btn${aiRisk ? ' on' : ''}`} onClick={() => setAiRisk(true)}>AI picks risk</button>
                <button className={`seg-btn${!aiRisk ? ' on' : ''}`} onClick={() => setAiRisk(false)}>I set risk</button>
              </span>
              {!aiRisk && <RiskMeter level={risk} onPick={setRisk} />}
              <button className="btn btn-pink" onClick={run} disabled={busy}>{busy ? 'thinking…' : '✦ Suggest'}</button>
            </div>
            {err && <div className="small mt" style={{ color: 'var(--red)' }}>{err}</div>}
          </>
        )}
      </Card>

      {res && (
        <>
          <Card title="The call" color="var(--cyan)"
            right={<span className="flex" style={{ gap: 6 }}><span className="chip">{ago(res.at)}</span><span className="chip c-cyan">${res.budget}</span></span>}>
            <div className="flex" style={{ gap: 14, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
              <RiskMeter level={Number(res.risk_meter) || 3} label="Risk of this play:" />
            </div>
            <div style={{ lineHeight: 1.55, marginBottom: 4 }}>{res.market_read}</div>
          </Card>
          {(res.suggestions || []).map((s, i) => (
            <Card key={i} color="var(--green)" title={`${s.ticker} — ${s.name || ''}`}
              right={<span className="flex" style={{ gap: 6 }}><span className="chip c-green">${s.allocate_usd}</span><RiskMeter level={Number(s.risk) || 3} /></span>}>
              <div style={{ lineHeight: 1.55 }}>{s.why}</div>
            </Card>
          ))}
          {res.avoid && (
            <Card title="Avoid right now" color="var(--red)">
              <div style={{ lineHeight: 1.5 }}>{res.avoid}</div>
              <div className="small muted mt">{res.disclaimer}</div>
            </Card>
          )}
        </>
      )}
    </>
  );
}
