import React, { useMemo, useState } from 'react';
import { Card, StatTile, Empty } from '../ui.jsx';
import * as S from '../../lib/sentiment.js';
import { fetchCandles } from '../../lib/marketdata.js';

// The screen half of lib/sentiment.js: a fear/greed dial and a movers board.
//
// The dial is the part that could most easily lie, so the layout is built around
// making the lie impossible to tell:
//
//   The divisor is printed next to the number, always. "62" alone is a market
//   reading. "62 · from 5 of 7" is a market reading with its own sample size
//   attached, and Neel can see at a glance whether he is looking at a full
//   gauge or a thin one.
//
//   Blocked components are listed, not omitted. Two of the seven need
//   exchange-wide data no free feed sells. Hiding them would make the gauge look
//   complete; showing them greyed with the reason is the honest shape.
//
//   Every live component prints its measured value, its band, and one sentence
//   of English. The score is then checkable by hand, which is the whole point of
//   decision 2 — a number nobody can recompute is a number nobody should trust.
//
// The loader is behind a button because five symbols against an 8-request-per-
// minute free tier is most of a minute of budget, and a gauge that silently
// burns the day's quota on every tab visit is a worse feature than one click.

const PACE = 8200; // Twelve Data free tier: 8 requests/minute. See marketdata.js.
const sleep = ms => new Promise(r => setTimeout(r, ms));

const fmtRaw = (r, unit) => {
  if (!Number.isFinite(r)) return '—';
  const sign = r > 0 ? '+' : '';
  return `${sign}${r.toFixed(1)}${unit === '%' ? '%' : unit === '% up' ? '%' : ''}`;
};

// ---------- the dial ----------

export function Gauge({ score, zone }) {
  const { cx, cy, r } = S.ARC;
  const has = Number.isFinite(score);
  const needle = S.polar(cx, cy, r - 26, S.angleFor(has ? score : 50));
  return (
    <svg viewBox="0 0 300 170" className="snt-dial" shapeRendering="crispEdges" role="img"
      aria-label={has ? `sentiment ${score} of 100` : 'no sentiment reading yet'}>
      {/* One coloured band per zone, drawn from the same angleFor() the needle
          uses, so the needle can never point at a colour the label disagrees
          with — both are derived from a single mapping. */}
      {S.ZONES.map(z => (
        <path key={z.key} d={S.arcPath(z.lo, z.hi)} fill="none" stroke={z.color}
          strokeWidth="15" opacity={has && zone && zone.key === z.key ? 1 : 0.26}
          style={has && zone && zone.key === z.key ? { filter: `drop-shadow(0 0 6px ${z.color})` } : undefined} />
      ))}
      {/* Tick marks every 25, so the dial can be read without the number. */}
      {[0, 25, 50, 75, 100].map(t => {
        const a = S.polar(cx, cy, r + 10, S.angleFor(t));
        const b = S.polar(cx, cy, r + 2, S.angleFor(t));
        return <line key={t} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--border-bright)" strokeWidth="2" />;
      })}
      {has && (
        <>
          <line x1={cx} y1={cy} x2={needle.x} y2={needle.y} stroke={zone?.color || 'var(--ink)'}
            strokeWidth="4" style={{ filter: `drop-shadow(0 0 5px ${zone?.color || 'var(--ink)'})` }} />
          <circle cx={cx} cy={cy} r="7" fill="var(--bg-deep)" stroke={zone?.color || 'var(--ink)'} strokeWidth="3" />
        </>
      )}
      {/* No needle at all when there is no reading. A needle parked at 50 would
          be indistinguishable from a genuine neutral market. */}
      {!has && <circle cx={cx} cy={cy} r="7" fill="var(--bg-deep)" stroke="var(--ink-3)" strokeWidth="2" strokeDasharray="3 3" />}
      <text x={cx} y={cy - 34} textAnchor="middle" className="snt-num"
        fill={has ? (zone?.color || 'var(--ink)') : 'var(--ink-3)'}>{has ? score : '—'}</text>
      <text x={20} y={162} className="snt-end" fill="var(--red)">FEAR</text>
      <text x={280} y={162} textAnchor="end" className="snt-end" fill="var(--green)">GREED</text>
    </svg>
  );
}

export function ComponentRow({ row }) {
  const live = row.state === 'ok';
  return (
    <div className={`snt-row snt-${row.state}`}>
      <div className="snt-row-head">
        <span className="snt-row-label">{row.label}</span>
        {/* Decision 4: a component measuring something smaller than its name
            suggests says so on the row, not in a footnote. */}
        {row.narrow && <span className="snt-narrow">narrow scope</span>}
        <span className="snt-row-score">{live ? Math.round(row.score) : '—'}</span>
      </div>
      <p className="snt-why">{row.why}</p>
      {live ? (
        <>
          <p className="snt-detail">{row.detail}</p>
          {/* Decision 2: the band is on screen, so 62 can be recomputed by hand. */}
          <div className="snt-band">
            <span className="snt-band-lbl">measured</span>
            <span className="snt-band-val">{fmtRaw(row.raw, row.unit)}</span>
            <span className="snt-band-lbl">band</span>
            <span className="snt-band-val">{row.band[0]} → {row.band[1]}</span>
            <span className="snt-band-lbl">scope</span>
            <span className="snt-band-val">{row.scope}</span>
          </div>
          <div className="snt-meter">
            <div className="snt-meter-fill" style={{ width: `${Math.round(row.score)}%` }} />
          </div>
        </>
      ) : (
        <p className="snt-blocked">{row.reason}</p>
      )}
    </div>
  );
}

export function MoverRow({ r, cur = '$' }) {
  const up = r.changePct > 0;
  return (
    <div className="snt-mv">
      <span className="snt-mv-t">{r.ticker}</span>
      {r.held && <span className="snt-mv-held" title="you hold this">◆</span>}
      <span className="snt-mv-n">{r.name || ''}</span>
      <span className="snt-mv-p">{cur}{r.price.toFixed(2)}</span>
      <span className={`snt-mv-c ${up ? 'up' : 'down'}`}>
        {up ? '+' : ''}{r.changePct.toFixed(2)}%
      </span>
    </div>
  );
}

export function Movers({ quotes, meta, cur = '$', now }) {
  const sess = S.session(now);
  const m = useMemo(() => S.movers(quotes, meta), [quotes, meta]);
  const title = S.moversTitle(sess);
  return (
    <Card title={title} color={sess === 'open' ? 'var(--green)' : 'var(--purple)'}
      right={<span className="snt-sess">{S.SESSION_LABEL[sess]}</span>}>
      {m.counted === 0 ? (
        <Empty icon="◷" text="No live quotes yet. Add holdings or a watchlist and the movers fill in." />
      ) : (
        <>
          <div className="snt-mv-cols">
            <div className="snt-mv-col">
              <div className="snt-mv-h up">Gainers</div>
              {m.gainers.length === 0
                ? <p className="snt-mv-none">Nothing is up.</p>
                : m.gainers.map(r => <MoverRow key={r.ticker} r={r} cur={cur} />)}
            </div>
            <div className="snt-mv-col">
              <div className="snt-mv-h down">Losers</div>
              {m.losers.length === 0
                ? <p className="snt-mv-none">Nothing is down.</p>
                : m.losers.map(r => <MoverRow key={r.ticker} r={r} cur={cur} />)}
            </div>
          </div>
          {/* Scope and staleness, every time. A list that looks live but is a
              day old is worse than one that admits it. */}
          <p className="snt-note">
            {S.moversNote(sess, m.counted)}
            {m.flat > 0 && ` ${m.flat} unchanged.`}
          </p>
        </>
      )}
    </Card>
  );
}

// ---------- the panel ----------

export default function Sentiment({ quotes = {}, meta = {}, cur = '$', now }) {
  const [series, setSeries] = useState({});
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(true);

  const g = useMemo(() => S.computeSentiment(series, { quotes }), [series, quotes]);

  async function load() {
    if (busy) return;
    setErr('');
    const next = {};
    try {
      for (let i = 0; i < S.SYMBOLS.length; i++) {
        const sym = S.SYMBOLS[i];
        setBusy(`${sym} (${i + 1}/${S.SYMBOLS.length})`);
        try {
          // 1Y of daily bars: momentum needs 125 sessions, volatility 50.
          next[sym] = await fetchCandles(sym, '1Y');
        } catch (e) {
          if (e.message === 'NO_KEY') { setErr('No Twelve Data key in Settings — the dial needs one for price history.'); break; }
          // One symbol failing costs one component, not the whole dial. It is
          // recorded as absent, which shrinks the divisor rather than faking it.
          next[sym] = [];
        }
        // Paced against the free tier. The last symbol needs no wait after it.
        if (i < S.SYMBOLS.length - 1) { setBusy(`waiting for the rate limit — ${S.SYMBOLS[i + 1]} next`); await sleep(PACE); }
      }
      setSeries(next);
    } finally { setBusy(''); }
  }

  const loaded = Object.keys(series).length > 0;

  return (
    <>
      <Card title="Market sentiment" color={g.zone?.color || 'var(--ink-3)'}
        right={<span className="snt-count">{g.have} of {g.total}</span>}>

        <div className="snt-top">
          <Gauge score={g.score} zone={g.zone} />
          <div className="snt-read">
            <div className="snt-zone" style={{ color: g.zone?.color || 'var(--ink-3)' }}>
              {g.zone ? g.zone.label : 'NO READING'}
            </div>
            {/* Decision 1 in one sentence, printed under the number every time. */}
            <p className="snt-basis">{g.basis}</p>
            {g.blocked > 0 && (
              <p className="snt-basis snt-dim">
                {g.blocked} component{g.blocked === 1 ? '' : 's'} need exchange-wide data no free feed sells.
                They are listed below rather than quietly dropped.
              </p>
            )}
            <div className="snt-load">
              <button className="btn btn-cyan btn-sm" onClick={load} disabled={!!busy}>
                {busy ? 'loading…' : loaded ? 'reload history' : 'load price history'}
              </button>
              {busy && <span className="snt-busy">{busy}</span>}
              {!busy && !loaded && (
                <span className="snt-busy">
                  {S.SYMBOLS.length} symbols, paced for the free tier — about {Math.round((S.SYMBOLS.length - 1) * PACE / 1000)}s.
                </span>
              )}
            </div>
            {err && <p className="snt-err">{err}</p>}
          </div>
        </div>

        <div className="tile-row">
          <StatTile label="Reading" value={Number.isFinite(g.score) ? g.score : '—'}
            note={g.zone ? g.zone.label.toLowerCase() : 'nothing measured yet'}
            color={g.zone?.color || 'var(--ink-3)'} />
          <StatTile label="Components live" value={`${g.have}/${g.total}`}
            note={g.missing ? `${g.missing} awaiting data` : 'all available ones in'} color="var(--cyan)" />
          <StatTile label="Unavailable" value={g.blocked} note="need exchange-wide feeds" color="var(--ink-3)" />
        </div>

        <div className="snt-head2">
          <button className="btn btn-sm" onClick={() => setOpen(v => !v)}>
            {open ? 'hide' : 'show'} the {g.total} components
          </button>
        </div>

        {open && (
          <div className="snt-rows">
            {g.rows.map(r => <ComponentRow key={r.key} row={r} />)}
          </div>
        )}

        <p className="snt-disc">
          Prices only. This dial reports what markets did against the bands printed on each row —
          it is not a forecast, and nothing here is investment advice.
        </p>
      </Card>

      <Movers quotes={quotes} meta={meta} cur={cur} now={now} />
    </>
  );
}
