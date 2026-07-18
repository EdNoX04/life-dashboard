import React, { useEffect, useState } from 'react';
import { Card, Empty } from './ui.jsx';
import { getConfig } from '../lib/db.js';
import { pickProvider, aiChat } from '../lib/ai.js';
import { pickJSON, memGet, memSet } from '../lib/advisor.js';

const iso = d => d.toISOString().slice(0, 10);
const fmtD = s => new Date(s + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

// Earnings to watch (your holdings) + upcoming US economic reports.
export default function MarketCalendar({ held }) {
  const [earn, setEarn] = useState(undefined); // undefined loading | null err | []
  const [econ, setEcon] = useState(null);
  const [econBusy, setEconBusy] = useState(false);
  const provider = pickProvider();
  const tickers = held.map(h => String(h.ticker).toUpperCase());

  // ---- earnings: Finnhub calendar, filtered to what you own ----
  useEffect(() => {
    const key = (getConfig().finnhubKey || '').trim();
    if (!key) { setEarn(null); return; }
    let dead = false;
    const from = iso(new Date()), to = iso(new Date(Date.now() + 30 * 864e5));
    fetch(`https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}&token=${key}`)
      .then(r => r.json())
      .then(j => {
        if (dead) return;
        const all = j?.earningsCalendar || [];
        const mine = all.filter(e => tickers.includes(String(e.symbol).toUpperCase()))
          .sort((a, b) => String(a.date).localeCompare(String(b.date)));
        setEarn(mine);
      })
      .catch(() => { if (!dead) setEarn(null); });
    return () => { dead = true; };
  }, [tickers.join(',')]); // eslint-disable-line

  // ---- econ reports: cached; AI-composed schedule (Finnhub's econ calendar is paid) ----
  useEffect(() => { memGet('econ_calendar').then(v => v && setEcon(v)); }, []);
  async function loadEcon(force) {
    if (econBusy) return;
    if (!force && econ?.at && Date.now() - new Date(econ.at).getTime() < 72 * 3600e3) return;
    if (!provider) return;
    setEconBusy(true);
    try {
      const today = iso(new Date());
      const { text } = await aiChat([{ role: 'user', content:
        `Today is ${today}. List the major scheduled US economic reports/events for the next 14 days that move markets (CPI, PPI, FOMC/rate decision, Fed minutes, NFP jobs report, GDP, PCE, retail sales, consumer confidence, jobless claims — whichever fall in this window). Reply ONLY JSON: {"events":[{"date":"YYYY-MM-DD","name":"...","why":"<one short clause: why it moves markets>","impact":"HIGH"|"MED"}]} Use your knowledge of the standard US release schedule (e.g. CPI mid-month, NFP first Friday). Dates are estimates.` }],
        { system: 'You are a markets calendar assistant. Only valid JSON, no markdown.' });
      const j = pickJSON(text);
      if (j?.events) { const out = { events: j.events, at: new Date().toISOString() }; setEcon(out); memSet('econ_calendar', out); }
    } catch {}
    setEconBusy(false);
  }
  useEffect(() => { loadEcon(false); }, [provider]); // eslint-disable-line

  return (
    <>
      <Card title="Earnings to watch — your holdings" color="var(--yellow)">
        {earn === undefined && <div className="small muted">Checking the next 30 days…</div>}
        {earn === null && <Empty icon="◔" text="Needs your Finnhub key (Config) to pull the earnings calendar." />}
        {Array.isArray(earn) && earn.length === 0 && <Empty icon="☺" text="None of your holdings report earnings in the next 30 days." />}
        {Array.isArray(earn) && earn.map((e, i) => (
          <div className="row" key={i}>
            <span className="chip c-yellow" style={{ minWidth: 96, textAlign: 'center' }}>{fmtD(e.date)}</span>
            <b style={{ fontWeight: 'normal', color: 'var(--cyan)', minWidth: 62 }}>{e.symbol}</b>
            <span style={{ flex: 1 }} className="small muted">
              {e.hour === 'bmo' ? 'before open' : e.hour === 'amc' ? 'after close' : ''}
              {e.epsEstimate != null ? ` · est EPS $${Number(e.epsEstimate).toFixed(2)}` : ''}
              {e.quarter ? ` · Q${e.quarter}` : ''}
            </span>
          </div>
        ))}
      </Card>

      <Card title="US economic reports — next 2 weeks" color="var(--cyan)"
        right={provider && <button className="btn btn-sm" onClick={() => loadEcon(true)} disabled={econBusy}>{econBusy ? '…' : '↻'}</button>}>
        {!provider && <Empty icon="✦" text="Add an AI key in Config — the upcoming CPI / FOMC / jobs-report schedule shows here." />}
        {provider && !econ && <div className="small muted">{econBusy ? 'Building the schedule…' : 'Loading…'}</div>}
        {econ?.events && [...econ.events].sort((a, b) => String(a.date).localeCompare(String(b.date))).map((e, i) => (
          <div className="row" key={i}>
            <span className="chip c-cyan" style={{ minWidth: 96, textAlign: 'center' }}>{fmtD(e.date)}</span>
            <span className={`chip ${e.impact === 'HIGH' ? 'c-red' : 'c-yellow'}`}>{e.impact}</span>
            <span style={{ flex: 1 }}><b style={{ fontWeight: 'normal' }}>{e.name}</b> <span className="small muted">— {e.why}</span></span>
          </div>
        ))}
        {econ?.at && <div className="small muted mt">AI-composed schedule (dates approximate) · refreshed {new Date(econ.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</div>}
      </Card>
    </>
  );
}
