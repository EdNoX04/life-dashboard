// report.js — the on-demand portfolio report (spec item 16).
//
// A report is the most quotable thing this app produces. A number on a screen is
// read once, in context, next to the button that loaded it; a number in a report
// gets pasted into a message six months later with none of that around it. So the
// failure mode here is not a wrong calculation — the libraries below have their own
// suites for that — it is a *correct* number that has quietly stopped being true.
//
// Seven decisions, in the order they matter:
//
//   1. Every section carries the as-of of ITS OWN data, never the report's
//      generation time. A header dated today over prices cached three days ago is
//      the single most misleading artifact this app could emit. An unknown stamp is
//      treated as the worst case and printed as unknown — it never falls back to now.
//   2. A section that cannot be computed is PRINTED, with the reason and what to do
//      about it. Dropping it silently makes the report look complete, and a reader
//      cannot notice the absence of something they were never told about.
//   3. A figure derived from a time series must name the window it covers. A return
//      with no window is not a fact. Lines that fail this are held back rather than
//      shown windowless.
//   4. The exported text carries the caveats, not just the screen. The export is the
//      copy that outlives this session, so the disclaimers, the as-of stamps and the
//      missing-section list are all in the text — not in UI chrome around it.
//   5. Nothing here is a recommendation. This file describes a portfolio.
//   6. Completeness is stated FIRST, not at the bottom. A reader who lands halfway
//      down will trust whatever they land on, so the coverage figure has to be above
//      the first number rather than below the last one.
//   7. This file computes NOTHING itself. Every figure comes from the same library
//      the corresponding screen calls, so a number in the report and the same number
//      on screen can never disagree. There is no statistics in this file — no
//      sqrt, no log, no exponent — only selection, labelling and stamping. If you
//      find yourself needing a formula here, it belongs in the library instead.

// ---------------------------------------------------------------------------
// Line + section constructors
// ---------------------------------------------------------------------------

// `windowed` marks a line as derived from a time series. Decision 3 lives here:
// such a line without a stated window is invalid and gets held back.
export function line(label, value, opts = {}) {
  const { note = null, window = null, windowed = false } = opts;
  return { label, value: value == null ? null : String(value), note, window, windowed };
}

export function validLine(l) {
  if (l.value == null || l.value === '') return false;
  if (l.windowed && !l.window) return false;   // decision 3
  return true;
}

// A section is either built (ok) or skipped with a reason and a remedy. There is no
// third state; a section is never simply absent.
export function section(id, title, { source, asOf = undefined, lines = [], notes = [] } = {}) {
  const kept = lines.filter(validLine);
  const held = lines.filter(l => !validLine(l) && l.windowed && !l.window);
  return {
    id, title, ok: kept.length > 0, source,
    // Decision 1: `undefined` means nobody told us, and that is NOT now.
    asOf: asOf === undefined ? null : asOf,
    asOfKnown: asOf !== undefined && asOf !== null,
    lines: kept, notes,
    withheld: held.map(l => l.label),
    reason: kept.length ? null : 'Every figure in this section was missing or could not be dated.',
    remedy: null,
  };
}

export function skipped(id, title, reason, remedy = null) {
  return { id, title, ok: false, source: null, asOf: null, asOfKnown: false,
    lines: [], notes: [], withheld: [], reason, remedy };
}

// ---------------------------------------------------------------------------
// Formatting — deliberately dumb. No rounding decisions are made here that the
// libraries have not already made; this only turns a number into characters.
// ---------------------------------------------------------------------------
const n1 = v => (Number.isFinite(v) ? v.toFixed(1) : null);
const n2 = v => (Number.isFinite(v) ? v.toFixed(2) : null);
const pct = v => (Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(1)}%` : null);
const pct0 = v => (Number.isFinite(v) ? `${v.toFixed(1)}%` : null);
const plain = v => (Number.isFinite(v) ? Math.round(v).toLocaleString('en-IN') : null);

// ---------------------------------------------------------------------------
// Section builders. Each takes what the corresponding screen already has and
// returns a section. None of them fetch, and none of them calculate.
// ---------------------------------------------------------------------------

export function positionSection({ held = [], value, cost, asOf } = {}) {
  if (!held.length) {
    return skipped('position', 'What you hold',
      'There are no holdings with a quantity above zero.',
      'Add a holding in the Portfolio view.');
  }
  const pnl = Number.isFinite(value) && Number.isFinite(cost) ? value - cost : null;
  const pnlPct = Number.isFinite(pnl) && cost ? (pnl / cost) * 100 : null;
  return section('position', 'What you hold', {
    source: 'live quotes + the holdings table',
    asOf,
    lines: [
      line('Positions', held.length),
      line('Market value', plain(value)),
      line('Cost basis', plain(cost)),
      line('Unrealised P/L', plain(pnl), { note: pct(pnlPct) }),
    ],
    notes: [
      'Market value uses the last price this app received, which is not necessarily the last price traded.',
    ],
  });
}

export function allocationSection({ alloc, conc, asOf } = {}) {
  if (!alloc?.total) {
    return skipped('allocation', 'How it is arranged',
      'Allocation needs a priced book — no positions carried a usable price.',
      'Open the Portfolio view so quotes load, then generate the report again.');
  }
  const top = (alloc.byClass || []).slice()
    .sort((a, b) => b.value - a.value)
    .map(s => `${s.label} ${pct0((s.value / alloc.total) * 100)}`)
    .join(' · ');
  return section('allocation', 'How it is arranged', {
    source: 'assets.js — allocationBreakdown / concentration',
    asOf,
    lines: [
      line('By class', top),
      line('Largest position', pct0(conc?.top1),
        { note: 'share of the book held in one name' }),
      line('Top 5 share', pct0(conc?.top5)),
      line('Effective positions', n1(conc?.effectiveN),
        { note: 'how many equally sized holdings would spread the money the same way' }),
    ],
    notes: [
      'Effective positions is a spread measure, not a target. A number lower than the position count means the money is bunched.',
    ],
  });
}

export function performanceSection({ stats, benchName, asOf } = {}) {
  if (!stats || !Number.isFinite(stats.days) || stats.days < 2) {
    return skipped('performance', 'How it has done',
      'No price history is loaded, so there is no series to measure a return over.',
      'Open the Portfolio view and press Load history, then generate the report again.');
  }
  const span = `${stats.from} → ${stats.to}`;
  const T = stats.trailing || {};
  const dd = stats.drawdown || {};
  return section('performance', 'How it has done', {
    source: 'analytics.js — analyse()',
    asOf,
    lines: [
      // Decision 3: every one of these is windowed and every one names its window.
      line('Total return', pct(stats.cumulative), { windowed: true, window: span }),
      line('Annualised (CAGR)', pct(stats.cagr), { windowed: true, window: span }),
      line('Money-weighted (XIRR)', pct(stats.xirr), { windowed: true, window: span,
        note: 'counts when the money went in, not just how the prices moved' }),
      line('3 months', pct(T['3M']), { windowed: true, window: 'last 3 months' }),
      line('1 year', pct(T['1Y']), { windowed: true, window: 'last 12 months' }),
      line('Volatility', pct0(stats.volatility), { windowed: true, window: span }),
      line('Worst drawdown', pct0(dd.maxDD), { windowed: true, window: span,
        note: dd.recovered ? `recovered in ${dd.recoveredInDays} days` : 'not yet recovered' }),
      line('Months positive', stats.consistency?.winRate == null ? null : pct0(stats.consistency.winRate),
        { windowed: true, window: `${(stats.months || []).length} months` }),
      line('Beta vs ' + (benchName || 'benchmark'), n2(stats.beta), { windowed: true, window: span }),
    ],
    notes: [
      `Measured over ${stats.days} days of history. A short history makes every figure above unstable, and this app does not extrapolate one.`,
    ],
  });
}

export function riskSection({ profile, asOf } = {}) {
  if (!profile?.risk) {
    return skipped('risk', 'Risk and health',
      'The risk profile needs either a priced book or price history, and neither was available.',
      'Open the Risk view once so its inputs load.');
  }
  const r = profile.risk, h = profile.health;
  return section('risk', 'Risk and health', {
    source: 'risk.js — riskProfile()',
    asOf,
    lines: [
      line('Risk score', `${Math.round(r.score)} / 600`, { note: r.band?.label || null }),
      line('Portfolio health', h?.score == null ? null : `${Math.round(h.score)} / 100`,
        { note: h?.grade?.label || null }),
      line('Closest model', profile.placement?.nearest?.name,
        { note: profile.placement?.nearest?.mix || null }),
    ],
    notes: [
      'The 0–600 scale is this app\'s own. It is not an industry measure and cannot be compared to a score from anywhere else.',
      profile.risk?.inputs?.enoughHistory === false
        ? 'Return-derived drivers are dark: there is not yet enough history to measure them, so this score rests on the book\'s composition alone.'
        : null,
    ].filter(Boolean),
  });
}

export function factorSection({ tilt, summary, asOf } = {}) {
  if (!tilt || !summary) {
    return skipped('factors', 'What it leans towards',
      'No company ratios have been loaded for the holdings.',
      'Open the Factors view and press Load ratios.');
  }
  if (summary.readable === false) {
    return skipped('factors', 'What it leans towards',
      summary.reason || 'Too little of the book carries ratios for a tilt to describe the whole of it.',
      'Load ratios for more holdings in the Factors view.');
  }
  // Coverage travels beside each score rather than as one number for the section,
  // because coverage is per-factor: the book can carry P/E everywhere and beta
  // nowhere, and a single averaged coverage figure would hide exactly that.
  const say = arr => (arr || [])
    .map(t => `${t.label} ${Math.round(t.score)} (${Math.round((t.covered ?? 0) * 100)}% covered)`)
    .join(' · ');
  return section('factors', 'What it leans towards', {
    source: 'factors.js — portfolioTilt / tiltSummary',
    asOf,
    lines: [
      line('Leans towards', say(summary.leans)),
      line('Leans away from', say(summary.against)),
    ],
    notes: [
      'Scores run against bands this app chose, anchored at an arbitrary midpoint. This is not a comparison to an index.',
      'Holdings with no ratio are left out of the average rather than scored down the middle.',
    ],
  });
}

export function incomeSection({ summary, yieldInfo, asOf } = {}) {
  if (!summary || summary.annual == null) {
    return skipped('income', 'What it pays',
      'No dividend entries have been recorded for the holdings.',
      'Add per-share amounts and frequencies in the Dividends view.');
  }
  return section('income', 'What it pays', {
    source: 'dividends.js — incomeSummary / bookYield',
    asOf,
    lines: [
      line('Expected across the year', plain(summary.annual), { windowed: true, window: 'calendar year' }),
      line('Average per month', plain(summary.averageMonthly), { windowed: true, window: 'calendar year' }),
      line('Months that pay anything', summary.payingMonths == null ? null : `${summary.payingMonths} of 12`,
        { windowed: true, window: 'calendar year' }),
      line('Declared rather than estimated', pct0(summary.declaredShare),
        { note: 'the rest is projected from the last known rate' }),
      line('Yield on market value', pct0(yieldInfo?.onValue)),
      line('Yield on cost', pct0(yieldInfo?.onCost),
        { note: 'what the same payments are worth against what you paid' }),
    ],
    notes: [
      'Forward figures assume every payment continues at its current rate. Dividends are declared, not guaranteed, and a cut is not predicted here.',
    ],
  });
}

export function taxSection({ realised, position, fyLabel, asOf } = {}) {
  if (!position || !realised) {
    return skipped('tax', 'Tax position',
      'No sales were found in the order tape for this financial year, so there is nothing realised to compute.',
      'Record sells in the Book view if any have happened.');
  }
  return section('tax', 'Tax position', {
    source: 'tax.js — realised / taxPosition',
    asOf,
    lines: [
      line('Financial year', fyLabel, { windowed: true, window: fyLabel }),
      line('Realised short-term gain', plain(realised.inShort + realised.fgShort), { windowed: true, window: fyLabel }),
      line('Realised long-term gain', plain(realised.inLong + realised.fgLong), { windowed: true, window: fyLabel }),
      line('Long-term exemption used', plain(position.exemptionUsed),
        { note: position.exemptionLeft > 0 ? `${plain(position.exemptionLeft)} of it unused` : 'fully used' }),
      line('Estimated tax including cess', plain(position.total), { windowed: true, window: fyLabel }),
    ],
    notes: [
      'This is arithmetic against rates you entered, not tax advice, and rates written into an app go out of date by default. Check the rate card before quoting any figure here.',
      'Unrealised gains are not in this section. Nothing that has not been sold has been taxed.',
    ],
  });
}

export function cashSection({ avgs, fixed, asOf } = {}) {
  if (!avgs || !avgs.months) {
    return skipped('cash', 'Money in and out',
      'No transactions have been logged, so there is no run rate to report.',
      'Add income and spending in the Cash view.');
  }
  return section('cash', 'Money in and out', {
    source: 'expenses.js — runRate / averages',
    asOf,
    lines: [
      line('Average income', plain(avgs.income), { windowed: true, window: `${avgs.months} months` }),
      line('Average spending', plain(avgs.spend), { windowed: true, window: `${avgs.months} months` }),
      line('Average surplus', plain(avgs.net), { windowed: true, window: `${avgs.months} months` }),
      line('Savings rate', pct0(avgs.savingsRate), { windowed: true, window: `${avgs.months} months` }),
      line('Fixed share of spending', pct0(fixed?.fixedPct)),
    ],
    notes: [
      `Averaged over ${avgs.months} complete month${avgs.months === 1 ? '' : 's'}. The current month is excluded because a month that is half over looks like a month you spent half as much in.`,
      'A month you did not log reads as a month you did not spend.',
    ],
  });
}

export function planSection({ progress, asOf } = {}) {
  if (!progress || progress.target == null) {
    return skipped('plan', 'Against the plan',
      'No goal has been set, so there is nothing to measure progress against.',
      'Set a target in the Plan view.');
  }
  return section('plan', 'Against the plan', {
    source: 'plan.js — goalProgress',
    asOf,
    lines: [
      line('Target', plain(progress.target)),
      line('Reached so far', `${plain(progress.now)} — ${pct0(progress.pct)}`),
      line('Due by', progress.byYear ? String(progress.byYear) : null),
      line('Projected value by then', plain(progress.projected),
        { windowed: true, window: progress.byYear ? `to ${progress.byYear}` : null,
          note: progress.onTrack == null ? null : (progress.onTrack ? 'ahead of the target' : `short by ${plain(progress.shortfall)}`) }),
    ],
    notes: [
      'The projection compounds one assumed rate forward. Real returns arrive unevenly, and the projected figure moves whenever the assumption does.',
      'Being ahead or short is a statement about the assumption, not about the market.',
    ],
  });
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

export const DISCLAIMER =
  'This report describes a portfolio that already exists. It does not rank holdings, ' +
  'does not suggest what to buy or sell, and is not investment or tax advice. Every ' +
  'figure is a description of data this app was given, and is only as current as the ' +
  'as-of stamp beside it.';

export function buildReport(sections = [], { generatedAt = new Date() } = {}) {
  const built = sections.filter(s => s.ok);
  const missing = sections.filter(s => !s.ok);

  // Decision 1: the report's freshness is the freshness of its OLDEST input, and a
  // section with no stamp poisons that — an undated section is not a fresh one.
  const stamps = built.map(s => s.asOf).filter(Boolean).map(d => new Date(d));
  const undated = built.filter(s => !s.asOfKnown).map(s => s.title);
  const oldest = stamps.length ? new Date(Math.min(...stamps.map(d => d.getTime()))) : null;

  return {
    generatedAt,
    sections,
    // Decision 6: this rides at the top of every rendering of the report.
    completeness: {
      built: built.length,
      attempted: sections.length,
      pct: sections.length ? (built.length / sections.length) * 100 : 0,
      missing: missing.map(s => ({ id: s.id, title: s.title, reason: s.reason, remedy: s.remedy })),
    },
    freshness: {
      oldest,
      undated,
      // Stated rather than implied: if anything is undated, the report as a whole
      // cannot claim a freshness at all.
      known: undated.length === 0 && oldest != null,
    },
    disclaimer: DISCLAIMER,
  };
}

// Decision 4. The export is the artifact that outlives the session, so it carries
// the completeness block, the freshness block, the per-section stamps, every note
// and the disclaimer. A caveat that only exists on screen is a caveat that will not
// be there when the number is read.
export function toText(report) {
  const L = [];
  const at = d => (d instanceof Date ? d.toISOString().slice(0, 16).replace('T', ' ') : String(d));
  L.push('PORTFOLIO REPORT');
  L.push('generated ' + at(report.generatedAt));
  L.push('');
  const c = report.completeness;
  L.push(`COVERAGE: ${c.built} of ${c.attempted} sections could be built (${c.pct.toFixed(0)}%).`);
  if (c.missing.length) {
    L.push('Not in this report, and why:');
    for (const m of c.missing) L.push(`  - ${m.title}: ${m.reason}${m.remedy ? ' → ' + m.remedy : ''}`);
  }
  L.push(report.freshness.known
    ? `Oldest data in this report: ${at(report.freshness.oldest)}.`
    : `Data age is NOT fully known${report.freshness.undated.length
        ? ' — undated: ' + report.freshness.undated.join(', ') : ''}. Treat every figure as possibly stale.`);
  L.push('');
  L.push(report.disclaimer);
  L.push('');
  for (const s of report.sections) {
    L.push('-'.repeat(60));
    L.push(s.title.toUpperCase());
    if (!s.ok) { L.push(`  not included — ${s.reason}`); if (s.remedy) L.push(`  to include it: ${s.remedy}`); L.push(''); continue; }
    L.push(`  source: ${s.source}`);
    L.push(`  as of: ${s.asOfKnown ? at(s.asOf) : 'unknown'}`);
    for (const l of s.lines) {
      L.push(`  ${l.label.padEnd(28)} ${l.value}${l.window ? `  [${l.window}]` : ''}${l.note ? `  (${l.note})` : ''}`);
    }
    if (s.withheld.length) L.push(`  held back for want of a stated window: ${s.withheld.join(', ')}`);
    for (const nt of s.notes) L.push(`  note: ${nt}`);
    L.push('');
  }
  return L.join('\n');
}
