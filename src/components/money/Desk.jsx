import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, Empty, StatTile, money, useMoneyVisible, EyeBtn } from '../ui.jsx';
import {
  breadth, movers, rangePosition, consensus, consensusAgeMonths, valuationDrift,
  evaluate, validRule, ruleLabel, TEMPLATES, METRICS, METRIC, OPS,
  nextScanAt, scanAge, SCAN_INTERVAL_MIN, bandOf, peHistoryOf, currentPeOf,
} from '../../lib/desk.js';
import { xrayFromBook } from '../../lib/xray.js';
import { memGet, memSet, fetchRecommendations } from '../../lib/advisor.js';
import { usMarketState } from '../../lib/live.js';

// THE DESK — everything you would want in front of you before deciding, and
// nothing that decides for you.
//
// This screen was asked for as a place to "get advice". What it is instead is a
// place where the facts stop being scattered across nine other screens: what
// moved, where things sit in their own ranges, what brokers filed, how a
// multiple compares to the company's own past, and which of Neel's own rules
// tripped. The judgement stays his, and that is not a hedge — it is the reason
// the screen can be trusted at all. A verdict row here would be the most
// authoritative thing on the page and would have the least behind it.
//
// So there are three kinds of thing on this screen and they are visually
// distinct, because conflating them is the whole failure mode:
//
//   MEASURED    — arithmetic on prices and holdings. Checkable.
//   ATTRIBUTED  — what someone else said, with their name and the date on it.
//   YOURS       — a rule Neel wrote, firing against a threshold Neel set.
//
// Nothing on this screen is mine.

const pct = (v, d = 1) => (v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(d)}%`);
const signed = (v, d = 2) => (v == null || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}%`);
const uid = () => `r${Math.random().toString(36).slice(2, 9)}`;

function Kind({ k }) {
  const map = {
    measured: { t: 'MEASURED', c: 'var(--cyan)', n: 'Arithmetic on your own prices and holdings. Every figure is checkable on another screen.' },
    attributed: { t: 'ATTRIBUTED', c: 'var(--yellow)', n: 'Someone else’s opinion, reported with their name and the date they filed it. Not this app’s view.' },
    yours: { t: 'YOURS', c: 'var(--green)', n: 'A rule you wrote, firing against a threshold you set.' },
  }[k];
  return <span className="dk-kind" style={{ color: map.c, borderColor: map.c }} title={map.n}>{map.t}</span>;
}

// ---------------------------------------------------------------- the clock
function ScanHead({ lastAt, marketOpen, busy, onScan, blocked }) {
  const age = scanAge(lastAt);
  const next = nextScanAt(lastAt, { marketOpen });
  return (
    <div className="dk-scan">
      <span className={`dk-dot${marketOpen ? ' on' : ''}`} />
      <span className="dk-scan-t">
        US market {marketOpen ? 'open' : 'closed'}
        {age == null ? ' · never scanned'
          : age === 0 ? ' · scanned just now'
            : ` · scanned ${age} min ago`}
      </span>
      <span className="dk-scan-n">
        {marketOpen
          ? (next.at ? `next in ${Math.max(0, Math.ceil(next.inMs / 60000))} min` : 'scanning')
          : `every ${SCAN_INTERVAL_MIN} min while open`}
      </span>
      <button className="btn btn-sm btn-cyan" onClick={onScan} disabled={busy || blocked}>
        {busy ? 'scanning…' : 'scan now'}
      </button>
    </div>
  );
}

export default function Desk({
  held = [], priceOf, quotes = {}, fx = null, inr = false, orders = [],
  briefResult = null, onGo = null,
}) {
  const [visible, toggleVisible] = useMoneyVisible();
  const [rules, setRules] = useState(null);
  const [recs, setRecs] = useState({});
  const [funda, setFunda] = useState({});
  const [lastAt, setLastAt] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [adding, setAdding] = useState(false);
  const marketOpen = usMarketState() === 'open';
  const timer = useRef(null);

  useEffect(() => {
    memGet('desk_rules').then(v => setRules(Array.isArray(v?.rules) ? v.rules : [])).catch(() => setRules([]));
    memGet('fundamentals').then(v => setFunda(v || {})).catch(() => {});
    memGet('desk_recs').then(v => {
      if (v?.rows) setRecs(v.rows);
      if (v?.at) setLastAt(v.at);
    }).catch(() => {});
  }, []);

  const saveRules = useCallback(next => {
    setRules(next);
    memSet('desk_rules', { rules: next });
  }, []);

  const tickers = useMemo(
    () => held.filter(h => Number(h.qty) > 0).map(h => String(h.ticker || '').toUpperCase()),
    [held],
  );

  // The scan. Broker recommendations are one request per holding, so this is
  // deliberately NOT on a render — it runs on the interval, or when pressed.
  const scan = useCallback(async () => {
    if (busy || !tickers.length) return;
    setBusy(true); setErr(null);
    try {
      const out = {};
      let got = 0;
      for (const t of tickers) {
        // eslint-disable-next-line no-await-in-loop
        const r = await fetchRecommendations(t);
        if (r) { out[t] = r; got++; }
        // eslint-disable-next-line no-await-in-loop
        await new Promise(res => setTimeout(res, 220));   // free-tier rate limit
      }
      const at = new Date().toISOString();
      setRecs(out); setLastAt(at);
      memSet('desk_recs', { rows: out, at });
      if (!got) setErr('No broker data came back for any holding. That usually means the Finnhub key is missing or out of quota — Settings has the key, and the panel stays empty rather than showing zeros.');
    } catch (e) {
      setErr(`The scan failed: ${e.message}. Nothing was overwritten.`);
    } finally { setBusy(false); }
  }, [busy, tickers]);

  // Decision 6 of the library: the clock stops with the market. A scan every
  // half hour overnight spends quota on prices that cannot move.
  useEffect(() => {
    clearInterval(timer.current);
    if (!marketOpen || !tickers.length) return undefined;
    if (nextScanAt(lastAt, { marketOpen }).due) scan();
    timer.current = setInterval(() => {
      if (usMarketState() === 'open') scan();
    }, SCAN_INTERVAL_MIN * 60000);
    return () => clearInterval(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marketOpen, tickers.join(',')]);

  const xray = useMemo(() => xrayFromBook(held, { priceOf, fx }), [held, priceOf, fx]);

  // One row per holding, carrying every metric a rule can read. Built once so a
  // rule and the panel above it cannot disagree about what a number is.
  const rows = useMemo(() => {
    const total = held.reduce((s, h) => s + (Number(h.qty) || 0) * (priceOf ? priceOf(h) : 0), 0);
    return held.filter(h => Number(h.qty) > 0).map(h => {
      const t = String(h.ticker || '').toUpperCase();
      const px = priceOf ? priceOf(h) : Number(h.last_price) || 0;
      const value = (Number(h.qty) || 0) * px;
      const q = quotes[t] || {};
      const entry = funda[t] || null;
      const band = bandOf(entry);
      const cost = Number(h.avg_cost);
      const drift = valuationDrift(peHistoryOf(entry), currentPeOf(entry));
      const con = consensus(recs[t]);
      const true_ = xray?.exposures?.find(e => e.sym === t);
      return {
        ticker: t, name: h.name || t, value, price: px,
        weight: total ? (value / total) * 100 : null,
        trueWeight: true_ ? true_.pct : null,
        dayPct: q.changePct == null ? null : Number(q.changePct),
        rangePct: rangePosition(px, band.low, band.high),
        band,
        unrealisedPct: Number.isFinite(cost) && cost > 0 ? ((px - cost) / cost) * 100 : null,
        peVsMedian: drift?.enough ? drift.vsMedian : null,
        drift,
        sellPct: con ? con.sellPct : null,
        consensus: con,
      };
    });
  }, [held, priceOf, quotes, funda, recs, xray]);

  const bd = useMemo(() => breadth(rows), [rows]);
  const mv = useMemo(() => movers(rows), [rows]);
  const ev = useMemo(() => evaluate(rules || [], rows), [rules, rows]);
  const disp = v => money(inr && fx ? v * fx : v, visible, inr && fx ? '₹' : '$');

  const withCons = rows.filter(r => r.consensus);
  const withDrift = rows.filter(r => r.drift?.enough)
    .sort((a, b) => Math.abs(b.peVsMedian) - Math.abs(a.peVsMedian));
  const thinDrift = rows.filter(r => r.drift && !r.drift.enough).length;

  if (!held.length) {
    return <Card title="Desk" color="var(--pink)"><Empty icon="◈" text="No holdings to scan yet." /></Card>;
  }

  return (
    <div className="dk">
      <Card title="Desk" color="var(--pink)" right={<EyeBtn visible={visible} onClick={toggleVisible} />}>
        <p className="dk-lead">
          Everything worth having in front of you before you decide something,
          gathered from screens that would otherwise take nine clicks. Three kinds
          of thing appear here and they are labelled, because the difference
          matters: what was <b>measured</b>, what someone else <b>said</b>, and
          what <b>your own rules</b> caught. There is no row at the bottom that
          adds them up into a verdict — that row would be the most confident thing
          on the page and the least supported.
        </p>
        <ScanHead
          lastAt={lastAt} marketOpen={marketOpen} busy={busy}
          onScan={scan} blocked={!tickers.length}
        />
        {err && <p className="dk-err">{err}</p>}
      </Card>

      {/* ------------------------------------------------------- YOURS */}
      <Card
        title={`Your rules (${ev.active} active${ev.fired.length ? `, ${ev.fired.length} caught something` : ''})`}
        color="var(--green)"
        right={<button className="btn btn-sm" onClick={() => setAdding(a => !a)}>{adding ? 'done' : '+ add a rule'}</button>}
      >
        <p className="dk-note">
          <Kind k="yours" /> Nothing is switched on until you switch it on. A
          threshold this app chose for you would be this app&rsquo;s opinion
          arriving in your interface, so the list starts empty and the numbers
          below are starting points you can change.
        </p>

        {adding && (
          <div className="dk-templates">
            {TEMPLATES.map(t => (
              <button
                key={t.label}
                className="dk-template"
                onClick={() => saveRules([...(rules || []), { ...t, id: uid(), enabled: true }])}
              >
                <b>+</b> {t.label}
                <i>{ruleLabel(t)}</i>
              </button>
            ))}
          </div>
        )}

        {!rules?.length ? (
          <Empty icon="◇" text="No rules yet. Add one and it will be checked on every scan." />
        ) : (
          <div className="dk-rules">
            {ev.byRule.map(({ rule, hits, blind }) => (
              <div key={rule.id} className={`dk-rule${hits.length ? ' on' : ''}`}>
                <div className="dk-rule-hd">
                  <input
                    type="checkbox" checked={rule.enabled !== false}
                    onChange={e => saveRules(rules.map(r => (r.id === rule.id ? { ...r, enabled: e.target.checked } : r)))}
                  />
                  <span className="dk-rule-t">{rule.label || ruleLabel(rule)}</span>
                  <input
                    className="dk-rule-v" type="number" value={rule.value}
                    onChange={e => saveRules(rules.map(r => (r.id === rule.id ? { ...r, value: Number(e.target.value) } : r)))}
                  />
                  <span className="dk-rule-u">{METRIC[rule.metric]?.unit}</span>
                  <button className="dk-rule-x" title="remove"
                    onClick={() => saveRules(rules.filter(r => r.id !== rule.id))}>×</button>
                </div>
                <div className="dk-rule-sub">{ruleLabel(rule)}</div>
                {hits.length > 0 && (
                  <div className="dk-hits">
                    {hits.map(h => (
                      <button key={h.ticker} className="dk-hit"
                        onClick={() => onGo && onGo(METRIC[rule.metric]?.view || 'book')}>
                        <b>{h.ticker}</b>
                        <span>{h.value.toFixed(1)}{METRIC[rule.metric]?.unit === '%' ? '%' : ''}</span>
                        <i>threshold {h.threshold}</i>
                      </button>
                    ))}
                  </div>
                )}
                {/* Three outcomes, not two. A rule that could not read a holding
                    has not cleared it. */}
                {blind > 0 && (
                  <div className="dk-blind">
                    could not be checked on {blind} holding{blind === 1 ? '' : 's'} — no data for this metric
                  </div>
                )}
                {!hits.length && !blind && <div className="dk-rule-sub">ran, caught nothing.</div>}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ---------------------------------------------------- MEASURED */}
      <div className="tile-row">
        <StatTile label="Up today" value={`${bd.up}/${bd.measured}`}
          note={bd.unmeasured ? `${bd.unmeasured} had no quote to read` : 'every holding had a quote'}
          color={bd.upPct == null ? 'var(--ink-3)' : bd.upPct >= 50 ? 'var(--ok)' : 'var(--orange)'} />
        <StatTile label="Value up" value={disp(bd.upValue)} note="market value of what rose" color="var(--cyan)" />
        <StatTile label="Value down" value={disp(bd.downValue)} note="market value of what fell" color="var(--pink)" />
        <StatTile label="Rules caught" value={String(ev.fired.length)}
          note={ev.blind ? `${ev.blind} checks had no data` : `${ev.attempted} checks, all answerable`}
          color={ev.fired.length ? 'var(--orange)' : 'var(--ok)'} />
      </div>

      <Card title="What moved" color="var(--cyan)">
        <p className="dk-note"><Kind k="measured" /> Against the previous close.</p>
        <div className="dk-mv">
          <div>
            <div className="dk-mv-h">Up</div>
            {mv.gainers.length ? mv.gainers.map(r => (
              <div key={r.ticker} className="dk-mv-r"><b>{r.ticker}</b><span className="up">{signed(r.dayPct)}</span><i>{disp(r.value)}</i></div>
            )) : <div className="dk-mv-none">nothing rose</div>}
          </div>
          <div>
            <div className="dk-mv-h">Down</div>
            {mv.losers.length ? mv.losers.map(r => (
              <div key={r.ticker} className="dk-mv-r"><b>{r.ticker}</b><span className="dn">{signed(r.dayPct)}</span><i>{disp(r.value)}</i></div>
            )) : <div className="dk-mv-none">nothing fell</div>}
          </div>
        </div>
        {mv.unmeasured > 0 && (
          <p className="dk-note dk-gap">
            {mv.unmeasured} holding{mv.unmeasured === 1 ? '' : 's'} had no quote and {mv.unmeasured === 1 ? 'is' : 'are'} in
            neither column. They are not flat — they are unread, and counting them as flat
            would make this a claim about the whole book built from part of it.
          </p>
        )}
      </Card>

      <Card title="Where each sits in its own 52-week range" color="var(--purple)">
        <p className="dk-note">
          <Kind k="measured" /> 0 is the 52-week low, 100 the high. Read off the
          saved fundamentals; a holding with none is listed as unread rather than
          drawn at zero.
        </p>
        <div className="dk-range">
          {rows.map(r => (
            <div key={r.ticker} className="dk-range-r">
              <b>{r.ticker}</b>
              {r.rangePct == null ? (
                <span className="dk-unread">no 52-week band on file</span>
              ) : (
                <>
                  <span className="dk-track"><i style={{ left: `${r.rangePct}%` }} /></span>
                  <span className="dk-range-v">{r.rangePct.toFixed(0)}</span>
                </>
              )}
            </div>
          ))}
        </div>
      </Card>

      {/* -------------------------------------------------- ATTRIBUTED */}
      <Card title="What brokers filed" color="var(--yellow)">
        <p className="dk-note">
          <Kind k="attributed" /> Counts from Finnhub&rsquo;s recommendation
          trends, with the month each was filed. Shown as counts and never
          collapsed into one word: twenty-eight buys against two sells and twelve
          against eleven are opposite situations that a verdict would spell the
          same way. This app has no view of its own here and does not add one.
        </p>
        {!withCons.length ? (
          <Empty icon="◎" text="No broker data yet. Press scan, or check that the Finnhub key is set in Settings." />
        ) : (
          <div className="dk-cons">
            {withCons.map(r => {
              const c = r.consensus;
              const age = consensusAgeMonths(c.period);
              return (
                <div key={r.ticker} className="dk-con">
                  <b className="dk-con-t">{r.ticker}</b>
                  <span className="dk-con-bar">
                    <i className="b" style={{ width: `${c.buyPct}%` }} title={`${c.buy} buy`} />
                    <i className="h" style={{ width: `${c.holdPct}%` }} title={`${c.hold} hold`} />
                    <i className="s" style={{ width: `${c.sellPct}%` }} title={`${c.sell} sell`} />
                  </span>
                  <span className="dk-con-n">{c.buy} buy · {c.hold} hold · {c.sell} sell</span>
                  {c.divided && <em className="dk-divided" title="no camp holds a majority">divided</em>}
                  <span className="dk-con-d">
                    {c.period || 'undated'}{age != null && age >= 2 ? ` · ${age} mo old` : ''}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card title="Multiple against its own history" color="var(--orange)">
        <p className="dk-note">
          <Kind k="measured" /> Each company&rsquo;s current multiple against the
          median of its own past — not against peers, because a peer set is an
          argument someone made before the number was computed. Nothing is drawn
          below {rows[0]?.drift?.need ?? 5} observations: a median of three is an
          anecdote with a statistic&rsquo;s authority.
        </p>
        {!withDrift.length ? (
          <Empty icon="◇" text="No holding has enough saved history yet. The Financials screen fills this." />
        ) : (
          <div className="dk-drift">
            {withDrift.map(r => (
              <div key={r.ticker} className="dk-drift-r">
                <b>{r.ticker}</b>
                <span className="dk-drift-v" style={{ color: r.peVsMedian > 0 ? 'var(--orange)' : 'var(--cyan)' }}>
                  {signed(r.peVsMedian, 0)}
                </span>
                <span className="dk-drift-n">
                  {r.drift.current.toFixed(1)}× now vs {r.drift.median.toFixed(1)}× median
                </span>
                <i className="dk-drift-c">{r.drift.n} years</i>
              </div>
            ))}
          </div>
        )}
        {thinDrift > 0 && (
          <p className="dk-note dk-gap">
            {thinDrift} holding{thinDrift === 1 ? ' has' : 's have'} some history but not
            enough for a median, and {thinDrift === 1 ? 'is' : 'are'} left out rather than
            shown with a thinner one.
          </p>
        )}
      </Card>

      {briefResult?.flags?.length > 0 && (
        <Card title={`Open from the briefing (${briefResult.flags.length})`} color="var(--ink-3)"
          right={onGo && <button className="btn btn-sm" onClick={() => onGo('brief')}>open briefing →</button>}>
          <p className="dk-note">
            Pulled in so deciding one thing does not mean reading two screens.
            Each is past a threshold whose source the briefing states on its own row.
          </p>
          <div className="dk-flags">
            {briefResult.flags.slice(0, 6).map(f => (
              <button key={f.id} className="dk-flag" onClick={() => onGo && onGo(f.view)}>
                <span className="dk-flag-t">{f.topic}</span>
                <span className="dk-flag-h">{f.headline}</span>
              </button>
            ))}
          </div>
          {briefResult.flags.length > 6 && (
            <p className="dk-note dk-gap">
              Showing the 6 furthest past their thresholds, of {briefResult.flags.length}.
            </p>
          )}
        </Card>
      )}

      <Card title="What this screen will not do" color="var(--ink-3)">
        <p className="dk-note">
          There is no combined score, no ranking across these panels, and no
          suggested action. Each of those would be a weighted mean whose weights
          this app chose, and it would sit at the bottom of the page looking like
          the conclusion while burying the dispersion, the dates and the
          could-not-tell counts that everything above is careful to show. The
          broker counts are the only opinions here and they arrive with a name and
          a date attached. Every other number is arithmetic you can check on the
          screen it came from.
        </p>
      </Card>
    </div>
  );
}
