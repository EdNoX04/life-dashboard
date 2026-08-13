import React, { useEffect, useMemo, useState } from 'react';
import { Card, Empty, StatTile } from '../ui.jsx';
import { memGet } from '../../lib/advisor.js';
import { brief, termCrossings, BASIS, SEVERITY, RULES } from '../../lib/briefing.js';
import { allocationBreakdown, concentration, loadAssetMeta, loadFixedIncome, metaOf, fdValue, bondValue } from '../../lib/assets.js';
import { analyse } from '../../lib/analytics.js';
import { riskProfile } from '../../lib/risk.js';
import { portfolioTilt, tiltSummary } from '../../lib/factors.js';
import { calendarForYear, incomeSummary, perHolding } from '../../lib/dividends.js';
import { DEFAULT_RATES, fyBounds, realised, taxPosition } from '../../lib/tax.js';
import { averages, fixedSplit, inMonth, monthlySeries, normaliseTxn, thisMonthKey, totals } from '../../lib/expenses.js';
import { DEFAULT_PLAN, EMPTY_GOALS, fireNumber, goalProgress, projectAll } from '../../lib/plan.js';
import { driftRows, normaliseTargets, summarise as rebalSummary, DEFAULT_BAND } from '../../lib/rebalance.js';
import { crossing } from '../../lib/levers.js';
import { xrayFromBook } from '../../lib/xray.js';

// The briefing — screen half.
//
// briefing.js decides what may be said. This file decides what is SEEN, and a
// screen that lists observations has a specific way of undoing a careful
// library: everything on it looks equally solid. A rule that ran on seven
// months of data and a rule that ran on three weeks look the same. A rule that
// could not run at all disappears entirely if it is put behind a chevron, and
// what is left reads as a complete picture. Five decisions live here:
//
//   1. SKIPPED IS DRAWN AT FULL WEIGHT, NEVER COLLAPSED. The library's first
//      decision — a rule with no data is absent, not passing — survives only if
//      the screen refuses to hide the absences. They sit in their own panel,
//      open, each with the reason it could not run. This is the single most
//      important thing on the page when the app is new, because when the app is
//      new it is nearly the whole page.
//
//   2. COVERAGE IS IN THE HEADER, ABOVE THE FLAGS. "11 of 18 checks had data"
//      has to be read before the flags are read, not discovered underneath them.
//      A footnote after the conclusions is not a caveat, it is an alibi.
//
//   3. THE SOURCE OF EACH THRESHOLD IS ON ITS OWN ROW. A legend at the top gets
//      read once and forgotten by the third row. The chip that says whether the
//      number is Neel's or a convention travels with the row it qualifies.
//
//   4. EVERY ROW CLICKS THROUGH TO THE SCREEN THAT SHOWS ITS WORKING. Decision 5
//      of the library made real. A flag you cannot check is a mood.
//
//   5. NOTHING PULSES, FLASHES, OR COUNTS DOWN. Severity is a colour and an
//      ordering, both derived from stated arithmetic. An animated red row is an
//      instruction with no words in it, which is exactly the kind of advice this
//      app is not allowed to give and would be giving without ever writing it
//      down. The retro idiom here is static: dashed rule, scanline, block caps.

const num = v => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

function BasisChip({ basis }) {
  const b = BASIS[basis];
  if (!b) return null;
  return (
    <span className="bf-basis" style={{ color: b.color, borderColor: b.color }} title={b.note}>
      {b.label}
    </span>
  );
}

export function Row({ row, onGo }) {
  const sev = row.ok ? null : SEVERITY(row.severity ?? 0);
  const color = row.ok ? 'var(--ok)' : sev.color;
  return (
    <div className={`bf-row${row.ok ? ' bf-ok' : ''}`} style={{ borderLeftColor: color }}>
      <div className="bf-row-top">
        <span className="bf-mark" style={{ color, filter: `drop-shadow(0 0 4px ${color})` }}>
          {row.ok ? '[ok]' : '[!!]'}
        </span>
        <span className="bf-topic">{row.topic}</span>
        <BasisChip basis={row.basis} />
        {!row.ok && (
          <span className="bf-sev" style={{ color: sev.color }}>
            {sev.label} · {(row.severity ?? 0).toFixed(1)}× band
          </span>
        )}
      </div>
      <div className="bf-head" style={{ color: row.ok ? 'var(--ink)' : color }}>{row.headline}</div>
      <div className="bf-detail">{row.detail}</div>
      <div className="bf-foot">
        {/* Decision 3: the citation is here, on the row, not in a legend. */}
        <span className="bf-cite">{row.cite}</span>
        {onGo && (
          <button className="btn btn-sm bf-go" onClick={() => onGo(row.view)}>
            show the working →
          </button>
        )}
      </div>
    </div>
  );
}

// The absences, as a job list rather than a wall of excuses.
//
// Decision 1 of the library says a skipped rule is never collapsed, and that
// still holds: every one of them is on screen, at full weight, with the reason
// it could not run. What changed is the shape. Nine stacked paragraphs each
// saying "needs transactions logged" is technically honest and practically
// unreadable — the reader skims it, concludes the app is broken, and the
// absences stop being information.
//
// So they are split by whether you can do anything about them. That is the only
// question a reader actually has here, and the old panel made you work it out
// yourself sixteen times.
export function Waiting({ rows, onGo }) {
  if (!rows?.length) return null;
  const yours = rows.filter(r => r.enable?.view);
  const time = rows.filter(r => !r.enable?.view);

  const line = r => (
    <div key={r.id} className={`bf-wait${r.broke ? ' bf-broke' : ''}`}>
      <span className="bf-wait-topic">{r.topic}</span>
      <span className="bf-wait-txt">
        {r.enable?.action || r.why}
        {r.broke && <b className="bf-skip-bad"> this one failed rather than abstained</b>}
      </span>
      {r.enable?.view && onGo && (
        <button className="btn btn-sm bf-go" onClick={() => onGo(r.enable.view)}>enter it →</button>
      )}
    </div>
  );

  return (
    <Card title={`Waiting on data (${rows.length})`} color="var(--ink-3)">
      <div className="bf-skip-why">
        These are listed rather than counted as passing, because a check that
        never ran is not a check that found nothing.
      </div>
      {yours.length > 0 && (
        <>
          <div className="bf-wait-hd">{yours.length} you can fill in</div>
          <div className="bf-waits">{yours.map(line)}</div>
        </>
      )}
      {time.length > 0 && (
        <>
          <div className="bf-wait-hd">{time.length} nothing to enter</div>
          <div className="bf-waits">{time.map(line)}</div>
        </>
      )}
    </Card>
  );
}

// The rules that ran and found nothing.
//
// This is the least important content on the screen and it was the bulk of its
// height — eight full rows, each with a headline, a threshold, a citation and a
// button, all to say that nothing happened. Folded to one chip per topic, which
// still states the count and still opens to the full working, because the point
// of a passing check is that you can go and verify it passed.
export function ClearByTopic({ rows, onGo }) {
  const [open, setOpen] = useState(null);
  if (!rows?.length) return null;

  const byTopic = new Map();
  for (const r of rows) {
    if (!byTopic.has(r.topic)) byTopic.set(r.topic, []);
    byTopic.get(r.topic).push(r);
  }
  const topics = [...byTopic.entries()];

  return (
    <Card title={`Ran and found nothing (${rows.length})`} color="var(--ok)">
      <div className="bf-chips">
        {topics.map(([topic, list]) => (
          <button
            key={topic}
            className={`bf-chip${open === topic ? ' on' : ''}`}
            onClick={() => setOpen(open === topic ? null : topic)}
          >
            <i>{open === topic ? '−' : '+'}</i>{topic}<b>{list.length}</b>
          </button>
        ))}
      </div>
      {open && (
        <div className="bf-rows bf-chip-open">
          {byTopic.get(open).map(c => <Row key={c.id} row={c} onGo={onGo} />)}
        </div>
      )}
    </Card>
  );
}

export function Header({ result }) {
  const { ran, total, flags, coverage } = result;
  // Decision 2: read before the flags, not after.
  const tone = coverage >= 80 ? 'var(--ok)' : coverage >= 50 ? 'var(--warn)' : 'var(--bad)';
  return (
    <div className="tile-row">
      <StatTile label="CHECKS WITH DATA" value={`${ran}/${total}`} color={tone}
        note={`${Math.round(coverage)}% of the rules had something to read`} />
      <StatTile label="PAST A THRESHOLD" value={String(flags.length)} color={flags.length ? 'var(--orange)' : 'var(--ok)'}
        note={flags.length ? 'ordered by distance past it' : 'nothing past its threshold'} />
      <StatTile label="INSIDE" value={String(result.clear.length)} color="var(--cyan)"
        note="ran and found nothing to report" />
    </div>
  );
}

// Decision 6 of the library: derived, never stored. Everything here is recomputed
// from the same blobs the other screens read, which is why a stale briefing cannot
// exist — there is nowhere for one to live.
// Exported for one reason: three separate bugs lived in this function's reading of
// the saved blobs — a plan read from a key nothing writes, a goal read from a field
// nothing writes, and `start` passed where `startValue` was expected. All three were
// invisible because they produced a quiet abstention or a silent default rather than
// a throw, and nothing tested the shapes the WRITERS actually write. The suite now
// feeds this the literal output of the Planner's own save calls.
export function buildContext({ blobs, held, priceOf, orders, series, benchmark, flowsByDay, currentValue, crypto, cur, fx = null }) {
    const b = blobs;
    const now = new Date();
    const withPx = held.map(h => ({ ...h, __px: priceOf(h) }));
    const bookValue = withPx.reduce((s, h) => s + (num(h.qty) ?? 0) * (h.__px || 0), 0);

    const alloc = allocationBreakdown({ held, priceOf, saved: b.meta, fi: b.fi || undefined, crypto });
    const conc = held.length ? concentration(held, priceOf) : null;

    // Look-through. Five rules read this and none of them needs anything typed,
    // which is the point: on a new install every other rule in the file abstains
    // and these still have something true to say.
    //
    // `fx` is threaded in rather than defaulted to 1, because defaulting would
    // convert a rupee position at par and quietly understate the book by the
    // exchange rate. With no rate loaded, bookPositions excludes those positions
    // and names them — and data.currency exists to report exactly that, so the
    // omission surfaces as a flag instead of as a wrong total.
    // One call, in a plain .js module, so the five rules that read it can be
    // tested. The previous shape of this was fifteen lines inline here — which
    // is a .jsx file that no test in this repo can import without a bundler,
    // and a rule nothing tests is a rule that quietly stops firing.
    const xray = xrayFromBook(held, { priceOf, fx, saved: b.etf || {} });

    // Book value carrying no asset class. metaOf falls back to an inferred kind,
    // so 'unknown' here means genuinely unclassified rather than merely untyped.
    const untagged = withPx.reduce((s, h) => {
      const m = metaOf(h, b.meta);
      return s + (m?.kind && m.kind !== 'unknown' ? 0 : (num(h.qty) ?? 0) * (h.__px || 0));
    }, 0);

    const stats = series.length > 1
      ? analyse({ series, benchmark, orders, flowsByDay, currentValue: currentValue ?? bookValue })
      : null;

    const fRows = withPx.map(h => ({
      ticker: String(h.ticker || '').toUpperCase(), name: h.name, value: (num(h.qty) ?? 0) * (h.__px || 0),
      meta: metaOf(h, b.meta), metric: b.fund[String(h.ticker || '').toUpperCase()]?.metric || null,
    })).filter(r => r.value > 0);
    const tilt = fRows.some(r => r.metric) ? tiltSummary(portfolioTilt(fRows)) : null;

    // Drift only exists if Neel saved targets. No targets means the rule abstains,
    // which is the correct outcome and not a zero.
    let drift = null;
    if (b.targets && Object.keys(b.targets).length) {
      const { targets } = normaliseTargets(b.targets);
      const slices = (alloc?.byClass || []).map(s => ({ label: s.label, value: s.value }));
      drift = rebalSummary(driftRows({ slices, targets, total: alloc?.total || 0, band: DEFAULT_BAND }), DEFAULT_BAND);
    }

    const dmeta = (b.div && (b.div.rows || b.div)) || {};
    const sharesOf = h => num(h.qty ?? h.shares) ?? 0;
    const payments = calendarForYear(held, dmeta, now.getFullYear(), { sharesOf });
    const divLines = perHolding(held, dmeta, { sharesOf, priceOf, costOf: h => num(h.avg_cost) ?? 0, year: now.getFullYear() });

    const fy = fyBounds(now);
    const rates = { ...DEFAULT_RATES, ...(b.rates || {}) };
    const foreign = {};
    for (const h of held) if (h?.ticker) foreign[String(h.ticker).toUpperCase()] = metaOf(h, b.meta).market === 'US';
    const foreignOf = t => !!foreign[String(t || '').toUpperCase()];
    const r = orders.length ? realised({ orders, fy, foreignOf, rates }) : null;

    const txns = Array.isArray(b.exp?.txns) ? b.exp.txns.map(normaliseTxn) : [];
    const mSeries = txns.length ? monthlySeries(txns) : [];
    const thisMonth = txns.length ? inMonth(txns, thisMonthKey(now)) : [];
    const mTotals = thisMonth.length ? totals(thisMonth) : null;
    const monthRate = mTotals && mTotals.income > 0
      ? ((mTotals.income - mTotals.spend) / mTotals.income) * 100 : null;

    const goals = b.goals || EMPTY_GOALS;
    // `goals.goals` is the shape the Planner writes: { goals: [{id,label,target,by}] }.
    // The old read was `goals.rows?.[0] || goals.goal`, neither of which any writer
    // produces, so this was permanently null and plan.track never once fired. The
    // fallbacks are kept for a hand-edited blob but the real field is first.
    const goal = goals?.goals?.[0] || goals?.rows?.[0] || goals?.goal || null;
    // The plan lives under its own memory key. This file used to read it out of the
    // goals blob, where nothing has ever written it — so every plan rule ran on
    // DEFAULT_PLAN while its own copy said "the rate you set on the Plan screen".
    // A default wearing the label of a stated figure is worse than an abstention,
    // which is what basis:'yours' exists to prevent.
    const planCfg = { ...DEFAULT_PLAN, ...(b.savedPlan && typeof b.savedPlan === 'object' ? b.savedPlan : {}) };
    // `projectAll` reads `startValue`, not `start`. Passing `start` left startValue
    // at its null default, so the projection began from zero — a bug that was
    // invisible only because the goal above was always null and the rule never ran.
    const planStart = planCfg.startValue == null ? (num(currentValue) ?? bookValue) : num(planCfg.startValue);
    const rows = goal ? projectAll({ ...planCfg, startValue: planStart }) : [];
    const avgs = mSeries.length ? averages(mSeries) : null;

    // Liquid = deposits and cash sleeves. Equities are not a runway; calling
    // them one is how a 6-month buffer turns out to be a 6-month buffer that
    // has to be sold in the month you needed it.
    const liquidLabels = new Set(['Cash', 'Deposit', 'Fixed deposit', 'FD', 'Savings']);
    const liquid = (alloc?.byClass || []).filter(s => liquidLabels.has(s.label))
      .reduce((s, x) => s + x.value, 0) || null;

    const swr = num(planCfg.swrPct) ?? 3.5;
    const annualSpend = avgs?.spend != null ? avgs.spend * 12 : null;

    return {
      cur, held: withPx, bookValue, conc, alloc, untagged, drift, tilt, stats, xray,
      profile: (stats || alloc?.total) ? riskProfile({ stats: stats || {}, conc: conc || {}, alloc }) : null,
      income: payments.length ? incomeSummary(payments) : null,
      divLines,
      taxInfo: r ? { position: taxPosition(r, rates), fyLabel: `FY ${new Date(fy.from).getFullYear()}` } : null,
      crossings: orders.length ? termCrossings(orders, { asOf: now, foreignOf }) : null,
      cash: avgs ? { avgs, fixed: thisMonth.length ? fixedSplit(thisMonth) : {} } : null,
      monthRate, liquid,
      plan: goal ? goalProgress(goal, { value: bookValue, rows }) : null,
      fire: annualSpend ? fireNumber({ annualExpenses: annualSpend, swrPct: swr }) : null,
      // The crossing is computed from the SAME resolved plan the Levers screen
      // resolves, by the same function, so the two cannot print different dates
      // for one plan. `plan.date` reports the saved-expense target; `plan.fire`
      // reports the logged-spending one; `plan.spendgap` exists because those two
      // targets can differ, and a reader seeing both without the difference named
      // would reasonably conclude one of the screens is broken.
      fireDate: crossing({ ...planCfg, startValue: planStart }),
      planSpend: num(planCfg.annualExpenses),
      observedSpend: annualSpend,
      netWorth: alloc?.total || bookValue || null,
      swr,
    };
}

// ---------------------------------------------------------------------------
// The context assembly is a hook rather than a body, because the overview strip
// runs the same rules and the two must not be able to drift. A strip computing
// its own slightly different context is how a headline figure ends up disagreeing
// with the screen it links to, and the reader has no way to tell which is wrong.
export function useBriefing({
  held = [], priceOf = h => Number(h.last_price ?? h.avg_cost ?? 0), orders = [],
  series = [], benchmark = [], flowsByDay = {}, currentValue = null, crypto = [],
  cur = '\u20b9', fx = null,
} = {}) {
  const [blobs, setBlobs] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [meta, fi, div, rates, exp, goals, fund, targets, savedPlan, etf] = await Promise.all([
        loadAssetMeta().catch(() => ({})),
        loadFixedIncome().catch(() => null),
        memGet('div_meta').catch(() => null),
        memGet('tax_rates').catch(() => null),
        memGet('expenses').catch(() => null),
        memGet('goals_money').catch(() => null),
        memGet('fundamentals').catch(() => null),
        memGet('rebal_targets').catch(() => null),
        // The Planner persists the plan under its own key; see buildContext.
        memGet('money_plan').catch(() => null),
        // Composition overrides for the look-through. Absent is fine — the
        // checked-in seed carries five funds on its own.
        memGet('etf_holdings').catch(() => null),
      ]);
      if (alive) setBlobs({ meta: meta || {}, fi, div, rates, exp, goals, fund: fund || {}, targets: targets?.targets || null, savedPlan, etf: etf || {} });
    })();
    return () => { alive = false; };
  }, []);

  const ctx = useMemo(() => {
    if (!blobs) return null;
    return buildContext({ blobs, held, priceOf, orders, series, benchmark, flowsByDay, currentValue, crypto, cur, fx });
  }, [blobs, held, series, orders, crypto, cur, fx]);

  return useMemo(() => (ctx ? brief(ctx) : null), [ctx]);
}

// The compact form, for the overview. Two decisions of its own:
//
//   a. IT CARRIES THE COVERAGE FIGURE TOO. The strip is the half of the briefing
//      that actually gets read, and a strip that shows three flags without
//      showing that only nine of eighteen rules had data is the reassuring half
//      of a caveated screen, printed on its own.
//
//   b. IT SAYS WHAT IT IS NOT SHOWING. Three of seven is written as three of
//      seven. A truncated list that does not admit to being truncated reads as
//      a complete one, and this is the strip's only chance to be honest about it.
export function BriefStrip({ result, onOpen, limit = 3 }) {
  if (!result) return null;
  const { flags, ran, total, coverage } = result;
  if (!ran) {
    return (
      <div className="bf-strip bf-strip-none" onClick={onOpen} role={onOpen ? 'button' : undefined}>
        <span className="bf-strip-k">BRIEFING</span>
        <span className="bf-strip-txt">
          None of the {total} checks had anything to read yet — nothing is being reported as clear.
        </span>
      </div>
    );
  }
  const shown = flags.slice(0, limit);
  return (
    <div className="bf-strip">
      <div className="bf-strip-head">
        <span className="bf-strip-k">BRIEFING</span>
        {/* Decision a: the caveat travels with the conclusions. */}
        <span className="bf-strip-cov" style={{ color: coverage >= 80 ? 'var(--ok)' : coverage >= 50 ? 'var(--warn)' : 'var(--bad)' }}>
          {ran}/{total} checks had data
        </span>
        {onOpen && <button className="btn btn-sm btn-cyan" onClick={onOpen}>open →</button>}
      </div>
      {flags.length === 0 ? (
        <div className="bf-strip-txt">Nothing that ran is past its threshold.</div>
      ) : (
        <>
          <div className="bf-strip-rows">
            {shown.map(f => (
              <div key={f.id} className="bf-strip-row" style={{ borderLeftColor: SEVERITY(f.severity ?? 0).color }}>
                <span className="bf-strip-topic">{f.topic}</span>
                <span className="bf-strip-line">{f.headline}</span>
              </div>
            ))}
          </div>
          {/* Decision b: no silent truncation. */}
          {flags.length > shown.length && (
            <div className="bf-strip-more">
              Showing the {shown.length} furthest past their thresholds, of {flags.length}.
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
export default function Briefing({
  held = [], priceOf = h => Number(h.last_price ?? h.avg_cost ?? 0), orders = [],
  series = [], benchmark = [], flowsByDay = {}, currentValue = null, crypto = [],
  cur = '₹', onGo = null, fx = null,
}) {
  const result = useBriefing({ held, priceOf, orders, series, benchmark, flowsByDay, currentValue, crypto, cur, fx });
  // Closed by default. The legend is read once and then never again, and it was
  // occupying a full card at the bottom of every visit.
  const [legend, setLegend] = useState(false);

  if (!result) {
    return <Card title="Briefing" color="var(--purple)"><Empty icon="..." text="Reading your saved figures." /></Card>;
  }

  // The screen reads top to bottom in order of how much it wants your
  // attention: what fired, then what is waiting on you, then — folded away —
  // what ran and was fine, then the legend. The previous order put eight
  // passing checks between the flags and the absences, which is the two things
  // worth reading separated by the one that is not.
  return (
    <div className="bf">
      <Card title="Briefing" color="var(--purple)">
        <div className="bf-intro">
          {RULES.length} rules read across every other screen in this tab. Each states
          what is true and where its threshold came from, and stops there — nothing
          here tells you what to do about any of it.
        </div>
        <Header result={result} />
      </Card>

      {result.flags.length > 0 ? (
        <Card title={`Past a threshold (${result.flags.length})`} color="var(--orange)"
          right={<span className="bf-sortnote">ordered by distance past, not by topic</span>}>
          <div className="bf-rows">
            {result.flags.map(f => <Row key={f.id} row={f} onGo={onGo} />)}
          </div>
        </Card>
      ) : result.ran > 0 && (
        <Card title="Past a threshold (0)" color="var(--ok)">
          <div className="bf-intro">
            Nothing that ran is past its threshold. That is a statement about the{' '}
            {result.ran} rules that had data, not about the {result.total - result.ran}{' '}
            that did not.
          </div>
        </Card>
      )}

      {/* Decision 1 of the library: never collapsed, and now placed ABOVE the
          passing checks rather than below them, because an absence is closer in
          importance to a flag than to a pass. */}
      <Waiting rows={result.skipped} onGo={onGo} />

      <ClearByTopic rows={result.clear} onGo={onGo} />

      <Card title="Where the numbers come from" color="var(--cyan)">
        <button className="bf-legend-tog" onClick={() => setLegend(l => !l)}>
          {legend ? '−' : '+'} what the three chips on each row mean
        </button>
        {legend && (
          <div className="bf-legend">
            {Object.values(BASIS).map(b => (
              <div key={b.key} className="bf-legend-row">
                <span className="bf-basis" style={{ color: b.color, borderColor: b.color }}>{b.label}</span>
                <span className="bf-legend-txt">{b.note}</span>
              </div>
            ))}
          </div>
        )}
        <div className="bf-foot-note">
          Nothing on this screen is stored. It is recomputed from the same saved
          figures every other screen reads, so it cannot go stale — and it cannot
          be right about anything you have not recorded.
        </div>
      </Card>
    </div>
  );
}
