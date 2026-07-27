import React, { useEffect, useState } from 'react';
import { Card } from '../ui.jsx';
import { runSelfTest, benchmarkStatus, proxyEnabled } from '../../lib/india.js';
import { getConfig, setConfig } from '../../lib/db.js';

// Where the index data actually comes from.
//
// I could not verify a single market-data host from the machine this was built on
// — its egress proxy answers 403 for anything not allow-listed — so instead of
// hardcoding one provider and hoping, the fetcher walks a chain and this panel
// reports which links in that chain work from *your* browser. Run it once on the
// iPad and once on the Mac; the answer can legitimately differ between them.

const dot = ok => (ok === null ? 'var(--ink-3)' : ok ? 'var(--green)' : 'var(--red)');
const mark = ok => (ok === null ? '·' : ok ? '✓' : '✕');

const age = h => {
  if (h == null) return 'never';
  if (h < 1) return `${Math.round(h * 60)}m ago`;
  if (h < 48) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
};

export default function DataStatus() {
  const [status, setStatus] = useState(null);
  const [test, setTest] = useState(null);
  const [busy, setBusy] = useState(false);
  const [relay, setRelay] = useState(proxyEnabled());

  useEffect(() => { benchmarkStatus().then(setStatus).catch(() => {}); }, []);

  async function run() {
    setBusy(true);
    try { setTest(await runSelfTest()); } catch (e) { setTest({ results: [], verdict: String(e.message || e) }); }
    setBusy(false);
    benchmarkStatus().then(setStatus).catch(() => {});
  }

  function toggleRelay() {
    const next = !relay;
    setRelay(next);
    setConfig({ allowMarketProxy: next });
  }

  const hasKey = !!(getConfig().twelveKey || '').trim();

  return (
    <Card
      title="Market data — where the index lines come from"
      color="var(--yellow)"
      right={<button className="btn btn-sm btn-cyan" onClick={run} disabled={busy}>{busy ? 'probing…' : '▶ Run self-test'}</button>}
    >
      <div className="small muted" style={{ lineHeight: 1.55 }}>
        Benchmarks are tried in order: Twelve Data (needs a free key), then Stooq
        (keyless), then Stooq through a public relay if you switch that on. Whatever
        answers first is cached, so the chart still draws when every provider is down.
      </div>

      {status && (
        <div className="scroll-x mt">
          <table className="ptable">
            <thead><tr><th>Index</th><th>Cached</th><th>Source</th><th>Refreshed</th><th>Last close</th></tr></thead>
            <tbody>
              {status.rows.map(r => (
                <tr key={r.key}>
                  <td style={{ color: 'var(--cyan)' }}>{r.label}</td>
                  <td style={{ color: r.points ? 'var(--green)' : 'var(--ink-3)' }}>
                    {r.points ? `${r.points} pts` : 'none'}
                  </td>
                  <td className="small">{r.source || '—'}</td>
                  <td className="small">{age(r.ageHours)}</td>
                  <td className="small">{r.last ? `${r.last.d} · ${r.last.v.toFixed(2)}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {test && (
        <div className="mt">
          {test.results.map((r, i) => (
            <div className="row" key={i} style={{ alignItems: 'flex-start', gap: 8 }}>
              <span style={{ color: dot(r.ok), width: 14, textAlign: 'center' }}>{mark(r.ok)}</span>
              <span style={{ flex: 1 }}>
                <div>{r.label}</div>
                <div className="small muted">{r.detail}</div>
              </span>
              {r.probe && <span className="chip">{r.ms}ms</span>}
            </div>
          ))}
          <div className="mt">
            <span className={`chip ${/succeeded/.test(test.verdict) ? 'c-green' : 'c-red'}`}>{test.verdict}</span>
          </div>
        </div>
      )}

      <div className="flex mt" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className={`chip ${hasKey ? 'c-green' : 'c-yellow'}`}>
          Twelve Data key {hasKey ? 'set' : 'missing'}
        </span>
        <button className={`btn btn-sm${relay ? ' btn-pink' : ''}`} onClick={toggleRelay}>
          Relay {relay ? 'ON' : 'OFF'}
        </button>
        <span className="small muted" style={{ flex: 1, minWidth: 220 }}>
          The relay routes the request through a third party, so it stays off unless
          you turn it on. Only public index symbols ever go through it — never a key,
          a holding, or anything of yours.
        </span>
      </div>
    </Card>
  );
}
