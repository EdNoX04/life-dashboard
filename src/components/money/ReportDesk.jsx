import React, { useEffect, useMemo, useState } from 'react';
import { Card, Empty } from '../ui.jsx';
import { memGet } from '../../lib/advisor.js';
import {
  buildReport, toText, DISCLAIMER,
  positionSection, allocationSection, performanceSection, riskSection,
  factorSection, incomeSection, taxSection, cashSection, planSection,
} from '../../lib/report.js';
import { allocationBreakdown, concentration, loadAssetMeta, loadFixedIncome, metaOf } from '../../lib/assets.js';
import { analyse } from '../../lib/analytics.js';
import { riskProfile } from '../../lib/risk.js';
import { portfolioTilt, tiltSummary } from '../../lib/factors.js';
import { calendarForYear, incomeSummary, perHolding, bookYield, EMPTY_DIVS } from '../../lib/dividends.js';
import { DEFAULT_RATES, fyBounds, realised, taxPosition } from '../../lib/tax.js';
import { monthlySeries, averages, fixedSplit, inMonth, thisMonthKey, normaliseTxn } from '../../lib/expenses.js';
import { EMPTY_GOALS, goalProgress, projectAll, DEFAULT_PLAN } from '../../lib/plan.js';

// ReportDesk — the on-demand report (spec item 16).
//
// The library decides what a report may claim. This file decides what a reader
// SEES first, which is a different problem with its own ways of going quietly
// wrong. Four decisions live here rather than in report.js:
//
//   1. A section that could not be built is drawn IN PLACE, in order, not swept
//      into a footer. The gap where a number should have been is the thing that
//      makes its absence noticeable; a list of omissions at the bottom is read by
//      nobody and reassures everybody.
//   2. A skipped card is drawn so it cannot be misread as a zero — dashed border,
//      no value column at all, and the words "not included". An empty table row
//      and a zero look identical at a glance, and only one of them is true.
//   3. The as-of stamp sits in the section header at the same weight as the title.
//      Put it in small grey print at the bottom and it stops being read, which
//      defeats the entire point of stamping sections separately.
//   4. There is ONE text formatter — the library's toText(). The download is
//      byte-for-byte what the suite pins. A second screen-only formatter would
//      drift, and the copy that drifts is always the one that leaves the app.

const STALE_HOURS = 24;
const FY_LABEL = fy => `FY ${new Date(fy.from).getFullYear()}-${String(new Date(fy.to).getFullYear()).slice(2)}`;
const at = d => (d ? new Date(d).toISOString().slice(0, 16).replace('T', ' ') : null);
const hoursOld = d => (d ? (Date.now() - new Date(d).getTime()) / 3.6e6 : null);

// ---------------------------------------------------------------------------
export function Coverage({ report }) {
  if (!report) return null;
  const c = report.completeness, f = report.freshness;
  const short = c.built < c.attempted;
  return (
    <div className="rep-cover">
      <div className="rep-cov-head">
        <span className="rep-cov-num" style={{ color: short ? 'var(--orange)' : 'var(--green)' }}>
          {c.built}/{c.attempted}
        </span>
        <span className="rep-cov-txt">sections could be built ({c.pct.toFixed(0)}%)</span>
      </div>
      {/* Decision 6 of the library, honoured at the top of the screen: a reader who
          scrolls trusts whatever they land on, so what is MISSING is stated before
          the first figure rather than after the last one. */}
      {c.missing.length > 0 && (
        <div className="rep-cov-miss">
          Not in this report: {c.missing.map(m => m.title).join(' · ')}
        </div>
      )}
      <div className="rep-fresh">
        {f.known
          ? <>Oldest data here is from <b>{at(f.oldest)}</b>.</>
          : <>Data age is <b style={{ color: 'var(--orange)' }}>not fully known</b>
              {f.undated.length ? ` — undated: ${f.undated.join(', ')}` : ''}. Treat every figure as possibly stale.</>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
export function SectionCard({ section: s }) {
  if (!s || !s.ok) return null;
  const old = hoursOld(s.asOf);
  const stale = old != null && old > STALE_HOURS;
  return (
    <div className="rep-sec">
      {/* Decision 3: the stamp is header furniture, the same size as the title. */}
      <div className="rep-shead">
        <span className="rep-stitle">{s.title}</span>
        <span className="rep-sstamp" style={{ color: stale ? 'var(--orange)' : 'var(--ink-3)' }}>
          {s.asOfKnown ? at(s.asOf) : 'as-of unknown'}{stale ? ' · stale' : ''}
        </span>
      </div>
      <div className="rep-ssrc">from {s.source}</div>
      <table className="rep-tbl">
        <tbody>
          {s.lines.map((l, i) => (
            <tr key={i}>
              <td className="rep-lab">{l.label}</td>
              <td className="rep-val">{l.value}</td>
              <td className="rep-win">{l.window || ''}</td>
              <td className="rep-note">{l.note || ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {s.withheld.length > 0 && (
        <div className="rep-held">
          Held back for want of a stated window: {s.withheld.join(', ')}. A return with no
          period attached is not a fact, so it is not printed.
        </div>
      )}
      {s.notes.map((n, i) => <div className="rep-snote" key={i}>{n}</div>)}
    </div>
  );
}

// ---------------------------------------------------------------------------
export function MissingCard({ section: s }) {
  if (!s || s.ok) return null;
  // Decision 2: no value column exists on this card at all. There is nothing here
  // that could be mistaken for a number, let alone for a zero.
  return (
    <div className="rep-sec rep-miss">
      <div className="rep-shead">
        <span className="rep-stitle" style={{ color: 'var(--ink-3)' }}>{s.title}</span>
        <span className="rep-sstamp">not included</span>
      </div>
      <div className="rep-mwhy">{s.reason}</div>
      {s.remedy && <div className="rep-mfix">→ {s.remedy}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
export function ReportBody({ report }) {
  if (!report) return null;
  return (
    <div className="rep-body">
      <Coverage report={report} />
      <div className="rep-disc">{report.disclaimer}</div>
      {/* Decision 1: one pass, in order, built and skipped interleaved exactly as
          the report lists them. Nothing is filtered and nothing is reordered. */}
      {report.sections.map(s => (
        s.ok ? <SectionCard key={s.id} section={s} /> : <MissingCard key={s.id} section={s} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
export default function ReportDesk({
  held = [], priceOf = h => Number(h.last_price ?? h.avg_cost ?? 0), orders = [],
  series = [], flowsByDay = {}, currentValue, benchmark = [], benchName = 'benchmark',
  cur = '$', crypto = [],
}) {
  const [blobs, setBlobs] = useState(null);
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);

  // Everything the report needs is already stored. Nothing here fetches: a report
  // that goes to the network is a report whose figures were not the ones on the
  // screens it claims to summarise.
  useEffect(() => {
    let alive = true;
    (async () => {
      const [meta, fi, div, rates, exp, goals, fund] = await Promise.all([
        loadAssetMeta().catch(() => ({})),
        loadFixedIncome().catch(() => null),
        memGet('div_meta').catch(() => null),
        memGet('tax_rates').catch(() => null),
        memGet('expenses').catch(() => null),
        memGet('goals_money').catch(() => null),
        memGet('fundamentals').catch(() => null),
      ]);
      if (alive) setBlobs({ meta: meta || {}, fi, div, rates, exp, goals, fund: fund || {} });
    })();
    return () => { alive = false; };
  }, []);

  const value = useMemo(
    () => held.reduce((s, h) => s + Number(h.qty || 0) * priceOf(h), 0), [held, priceOf]);
  const cost = useMemo(
    () => held.reduce((s, h) => s + Number(h.qty || 0) * Number(h.avg_cost || 0), 0), [held]);

  const generate = () => {
    if (!blobs) return;
    setBusy(true);
    const b = blobs;
    const now = new Date();

    // --- position + allocation: as fresh as the quotes, which is now.
    const alloc = allocationBreakdown({ held, priceOf, saved: b.meta, fi: b.fi || undefined, crypto });
    const conc = concentration(held, priceOf);

    // --- performance: stamped with the last date in the series, NOT with now.
    // A series that stopped updating last week is a week old however recently the
    // button was pressed, and that is exactly the lie decision 1 exists to stop.
    const stats = series.length > 1
      ? analyse({ series, benchmark, orders, flowsByDay, currentValue: currentValue ?? value })
      : null;
    const seriesAsOf = stats?.to ? new Date(stats.to + 'T00:00:00Z') : undefined;

    // --- factors: read from the fundamentals cache, never fetched here, and
    // stamped with the OLDEST cache entry that fed it.
    const fRows = held.map(h => {
      const t = String(h.ticker || '').toUpperCase();
      const hit = b.fund[t];
      return { ticker: t, name: h.name, value: Number(h.qty || 0) * priceOf(h),
        meta: metaOf(h, b.meta), metric: hit?.metric || null, at: hit?.at || null };
    }).filter(r => r.value > 0);
    const fStamps = fRows.map(r => r.at).filter(Boolean);
    const anyMetric = fRows.some(r => r.metric);
    const tilt = anyMetric ? portfolioTilt(fRows) : null;
    const tSum = tilt ? tiltSummary(tilt) : null;

    // --- income
    const dmeta = (b.div && (b.div.rows || b.div)) || {};
    const year = now.getFullYear();
    const sharesOf = h => Number(h.qty ?? h.shares ?? 0);
    const payments = calendarForYear(held, dmeta, year, { sharesOf });
    const dLines = perHolding(held, dmeta, { sharesOf, priceOf, costOf: h => Number(h.avg_cost || 0), year });
    const iSum = payments.length ? incomeSummary(payments) : null;

    // --- tax
    const fy = fyBounds(now);
    const rates = { ...DEFAULT_RATES, ...(b.rates || {}) };
    const foreign = {};
    for (const h of held) if (h?.ticker) foreign[h.ticker] = metaOf(h, b.meta).market === 'US';
    const r = orders.length ? realised({ orders, fy, foreignOf: t => !!foreign[t], rates }) : null;

    // --- cash
    const txns = Array.isArray(b.exp?.txns) ? b.exp.txns.map(normaliseTxn) : [];
    const avgs = txns.length ? averages(monthlySeries(txns)) : null;

    // --- plan
    const goals = b.goals || EMPTY_GOALS;
    const goal = goals?.rows?.[0] || goals?.goal || null;
    const rows = goal ? projectAll({ ...DEFAULT_PLAN, ...(goals.plan || {}), start: value }) : [];

    const sections = [
      positionSection({ held, value, cost, asOf: now }),
      allocationSection({ alloc, conc, asOf: now }),
      performanceSection({ stats, benchName, asOf: seriesAsOf }),
      riskSection({
        profile: stats || alloc?.total
          ? riskProfile({ stats: stats || {}, conc, alloc })
          : null,
        asOf: seriesAsOf,
      }),
      factorSection({ tilt, summary: tSum,
        asOf: fStamps.length ? new Date(Math.min(...fStamps)) : undefined }),
      incomeSection({ summary: iSum, yieldInfo: dLines.length ? bookYield(dLines) : null, asOf: now }),
      taxSection({ realised: r, position: r ? taxPosition(r, rates) : null, fyLabel: FY_LABEL(fy), asOf: now }),
      cashSection({ avgs, fixed: fixedSplit(inMonth(txns, thisMonthKey(now))), asOf: now }),
      planSection({ progress: goal ? goalProgress(goal, { value, rows }) : null, asOf: now }),
    ];

    setReport(buildReport(sections, { generatedAt: now }));
    setBusy(false);
  };

  const download = () => {
    if (!report) return;
    // Decision 4: the same toText() the suite pins. There is no second formatter.
    const blob = new Blob([toText(report)], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `portfolio-report-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="rep-wrap">
      <Card title="REPORT" color="var(--cyan)" right={
        <div className="flex">
          <button className="btn btn-sm btn-cyan" onClick={generate} disabled={!blobs || busy}>
            {busy ? 'BUILDING…' : report ? 'REBUILD' : 'GENERATE'}
          </button>
          {report && <button className="btn btn-sm" onClick={download}>DOWNLOAD .TXT</button>}
        </div>
      }>
        <div className="small muted">
          A report is the most quotable thing this app produces: a number on a screen is read
          once with the button that loaded it still in view, while a number in a report gets
          pasted somewhere six months later with none of that around it. So every section
          below carries the age of its own data rather than the time you pressed the button,
          and a section that could not be built is printed where it would have been, with the
          reason and the fix — never dropped, because a report with holes in it that you can
          see is worth more than a tidy one you cannot check.
        </div>
        {!report && !blobs && <div className="small muted mt">Reading your saved data…</div>}
        {!report && blobs && (
          <div className="mt">
            <Empty icon="🖨" text="Nothing has been built yet. Press GENERATE." />
          </div>
        )}
      </Card>

      {report && <ReportBody report={report} />}

      {report && (
        <div className="ai-note">
          Nothing above is a recommendation. This report describes a portfolio that already
          exists — it does not rank holdings, does not say what to buy or sell, and is not
          investment or tax advice. The tax figures are arithmetic against rates you entered
          yourself, and rates written into an app go out of date by default.
        </div>
      )}
    </div>
  );
}
