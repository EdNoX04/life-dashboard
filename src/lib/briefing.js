// The briefing — the one screen that reads across every other one.
//
// Every module in this tab answers a single question well and in isolation.
// Book knows concentration and nothing about cash. Rebalance knows drift and
// nothing about tax. FinBoy can join them, but only by spending tokens against
// a provider key, and a key that is not set makes the whole screen dead. So the
// join has to exist a second time, deterministically, with no network at all.
//
// That is the dangerous thing to build, because a screen that says "here is what
// I noticed about your money" is one short step from a screen that says what to
// do about it, and the step is invisible from the inside. Six decisions hold the
// line:
//
// 1. A RULE WITH NO DATA IS ABSENT, NOT PASSING. This is sentiment.js's first
//    decision, and it matters more here. A briefing that prints "12 checks, all
//    clear" when nine of them never ran is not reporting on the portfolio, it is
//    reporting on how little it managed to measure — in the most reassuring
//    possible voice. Every rule declares what it `needs`; a rule missing an
//    input returns null and is listed under SKIPPED with the reason. The header
//    prints ran/total, and the skipped list is never collapsed by default.
//
// 2. EVERY THRESHOLD DECLARES WHERE IT CAME FROM. A flag that fires at 25% is
//    only honest if the screen says who chose 25. There are exactly three
//    legitimate sources and each rule names one:
//
//      'yours'      — a number Neel typed. His rebalance targets, his budgets,
//                     his goal, his own trailing average. A rule on this basis
//                     is measuring his book against his own stated intent, which
//                     is the only kind of flag that cannot be an opinion.
//      'convention' — a number published outside this app: the statutory
//                     long-term holding period, the safe-withdrawal convention.
//                     Cited, and cited as a convention rather than as a fact.
//      'stated'     — a ladder this app itself publishes, with its working shown
//                     on its own screen (the risk bands, the factor coverage
//                     floor). Legitimate only because you can click through and
//                     see the arithmetic.
//
//    A number that would be none of those three — a threshold I picked because
//    it felt about right — is not a rule. Several plausible rules were dropped
//    for exactly that reason and the list is at the bottom of this file.
//
// 3. A FLAG IS AN OBSERVATION AND NEVER AN INSTRUCTION. No rule in this file
//    returns "trim", "buy", "switch", "rebalance", "sell before April". The
//    difference is load-bearing and it is not a matter of tone: "your top
//    holding is 38% of the book, and the target you saved for it is 20%" is
//    arithmetic on Neel's own two numbers. "So trim it" is advice, which this
//    app is not licensed to give, has said in four other headers that it does
//    not give, and does not give here. Every rule ends at the number and the
//    link to the screen that shows the working.
//
// 4. SEVERITY IS DISTANCE, NOT DRAMA. Ordering is by how far past its own
//    threshold a rule fired, measured in that rule's own band widths. Two rules
//    are comparable because both are expressed as "multiples of the distance
//    that would have made this worth mentioning at all", not because I ranked
//    concentration above cash. The ordering is reproducible from the numbers.
//
// 5. A RULE NEVER READS A NUMBER NO SCREEN CAN SHOW. Every rule cites the view
//    that displays its inputs. A flag you cannot click through and check is
//    unfalsifiable, and an unfalsifiable flag on a money screen is just a mood
//    with a number attached.
//
// 6. THE BRIEFING IS DERIVED, NEVER STORED. Nothing here writes to memory. It
//    recomputes from the same saved blobs every other screen reads, so a stale
//    briefing is impossible by construction — there is nowhere for one to live.

// Fourth appearance of this guard, and it is written out again rather than
// imported for the reason estimates.js gives: a missing figure that silently
// becomes 0 is how a rule fires on data it never had. `num` is the coercion that
// keeps missing missing.
const num = v => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const fin = v => (Number.isFinite(v) ? v : null);
const pc = v => `${v >= 0 ? '' : '−'}${Math.abs(v).toFixed(1)}%`;
const pp = v => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}pp`;
const n1 = v => Number(v).toFixed(1);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export const BASIS = {
  yours: { key: 'yours', label: 'your number', color: 'var(--green)',
    note: 'A figure you typed into this app. The rule measures your book against your own stated intent.' },
  convention: { key: 'convention', label: 'convention', color: 'var(--cyan)',
    note: 'A number published outside this app — a statute or a widely cited rule of thumb. Cited as a convention, not as a fact about you.' },
  stated: { key: 'stated', label: 'this app’s ladder', color: 'var(--purple)',
    note: 'A threshold this app publishes on its own screen, with the arithmetic shown there. Click through to check it.' },
};

// The money formatter is injected rather than imported, because the briefing is
// the one screen that shows figures from three different currencies at once —
// holdings in one, transactions in another, plan figures in a third — and a
// single formatter baked in here would quietly convert none of them while
// looking like it had.
const fmt = (cur, v) => `${cur}${Math.round(Math.abs(v)).toLocaleString('en-IN')}`;
const signed = (cur, v) => `${v < 0 ? '−' : ''}${fmt(cur, v)}`;

// ---------------------------------------------------------------------------
// A rule returns one of three things:
//   null                       — could not run. The `needs` string says why.
//   { ok: true, ... }          — ran, nothing past the threshold.
//   { ok: false, over, ... }   — fired. `over` is distance past threshold in the
//                                rule's own unit; `band` is the unit width.
// `headline` states what is true. `detail` states the threshold and its source.
// Neither ever states what to do about it.

export const RULES = [
  // --- concentration ------------------------------------------------------
  {
    id: 'conc.top1', topic: 'Concentration', view: 'book', basis: 'convention',
    needs: 'at least one holding with a price',
    cite: 'The 20–25% single-position ceiling is a common diversification convention, not a rule of law and not your number — you have not saved a per-holding cap.',
    run: ({ conc, held, cur }) => {
      const top = fin(conc?.top1);
      if (top == null || !held?.length) return null;
      const LIMIT = 25, BAND = 5;
      const name = [...held].map(h => ({ t: h.ticker, v: num(h.qty) * (h.__px ?? 0) }))
        .sort((a, b) => (b.v ?? 0) - (a.v ?? 0))[0]?.t;
      if (top <= LIMIT) {
        return { ok: true, headline: `Your largest position${name ? ` (${name})` : ''} is ${pc(top)} of the book.`,
          detail: `Under the ${LIMIT}% single-position convention.` };
      }
      return { ok: false, over: top - LIMIT, band: BAND,
        headline: `${name || 'Your largest position'} is ${pc(top)} of the book.`,
        detail: `That is ${pp(top - LIMIT)} past the ${LIMIT}% single-position convention. The Book screen shows every weight and the arithmetic behind them.` };
    },
  },
  {
    id: 'conc.spread', topic: 'Concentration', view: 'book', basis: 'stated',
    needs: 'at least two holdings with prices',
    cite: 'Effective N is 1 divided by the Herfindahl index — the number of equally sized positions that would spread the book the same way. The Book screen prints it beside the weights it comes from.',
    run: ({ conc, held }) => {
      const eff = fin(conc?.effectiveN);
      const n = held?.filter(h => num(h.qty) > 0).length ?? 0;
      if (eff == null || n < 2) return null;
      // Fires when the book behaves like less than half the number of positions
      // it contains — the point at which the position count stops describing it.
      const LIMIT = n / 2, BAND = Math.max(1, n / 6);
      if (eff >= LIMIT) {
        return { ok: true, headline: `${plural(n, 'position', 'positions')} spread like ${n1(eff)} equal ones.`,
          detail: `The book behaves like at least half the positions it holds.` };
      }
      return { ok: false, over: LIMIT - eff, band: BAND,
        headline: `You hold ${plural(n, 'position', 'positions')}, but they spread like ${n1(eff)} equal ones.`,
        detail: `Effective N is under half the position count, which means the count overstates how spread the book is. Book → concentration shows the weights this comes from.` };
    },
  },

  // --- allocation ---------------------------------------------------------
  {
    id: 'alloc.drift', topic: 'Allocation', view: 'rebal', basis: 'yours',
    needs: 'targets saved on the Rebalance screen',
    cite: 'The targets and the tolerance band are both yours — typed on the Rebalance screen. This rule reports distance from them and nothing else.',
    run: ({ drift }) => {
      if (!drift || !drift.targeted) return null;
      const w = drift.worst;
      if (!w || !fin(w.driftPp)) return null;
      const band = fin(drift.band) ?? 5;
      if (!drift.actionable) {
        return { ok: true, headline: `Every targeted sleeve is inside your ±${band}pp band.`,
          detail: `Worst drift is ${w.label} at ${pp(w.driftPp)}.` };
      }
      return { ok: false, over: Math.abs(w.driftPp) - band, band,
        headline: `${plural(drift.actionable, 'sleeve is', 'sleeves are')} outside your ±${band}pp band — worst is ${w.label} at ${pp(w.driftPp)}.`,
        detail: `Landing exactly on your saved targets would move ${pc(drift.turnoverPct)} of the book. Rebalance shows the per-sleeve figures.` };
    },
  },
  {
    id: 'alloc.untargeted', topic: 'Allocation', view: 'rebal', basis: 'yours',
    needs: 'targets saved on the Rebalance screen',
    cite: 'Your saved targets. A sleeve with no target is not drift — there is nothing for it to drift from — so it is reported separately rather than folded into the number above.',
    run: ({ drift }) => {
      if (!drift || !drift.targeted) return null;
      if (!drift.untargeted) return { ok: true, headline: `Every sleeve you hold has a target.`, detail: 'Nothing is unaccounted for on the Rebalance screen.' };
      return { ok: false, over: drift.untargeted, band: 1,
        headline: `${plural(drift.untargeted, 'sleeve has', 'sleeves have')} no target saved.`,
        detail: `Drift is only defined against a target, so these are excluded from the figure above rather than counted as being on target.` };
    },
  },

  // --- the records themselves --------------------------------------------
  // These are the rules with the highest ratio of value to cleverness. A wrong
  // conclusion drawn from complete data is a hard problem; a confident
  // conclusion drawn from two-thirds of the book is a bookkeeping problem, and
  // it is the one that actually happens.
  {
    id: 'data.untagged', topic: 'Records', view: 'portfolio', basis: 'stated',
    needs: 'holdings with prices',
    cite: 'Coverage is what share of book value carries an asset class. The allocation chart draws only what it can classify, so this is the share of the chart you can trust.',
    run: ({ alloc, untagged, bookValue }) => {
      if (!alloc || !fin(bookValue) || bookValue <= 0) return null;
      const missing = num(untagged) ?? 0;
      if (!missing) return { ok: true, headline: 'Every holding has an asset class.', detail: 'The allocation chart covers the whole book.' };
      const pctMissing = (missing / bookValue) * 100;
      return { ok: false, over: pctMissing, band: 5,
        headline: `${pc(pctMissing)} of the book has no asset class set.`,
        detail: `Which means the allocation chart — and every rule above that reads it — covers ${pc(100 - pctMissing)} of your money, not all of it.` };
    },
  },
  {
    id: 'data.price', topic: 'Records', view: 'portfolio', basis: 'stated',
    needs: 'holdings',
    cite: 'A holding with no live price falls back to its own cost, which makes its profit exactly zero. That is the app’s stated fallback, and it is visible as a dash in the price column.',
    run: ({ held }) => {
      if (!held?.length) return null;
      const stale = held.filter(h => num(h.qty) > 0 && num(h.last_price) == null);
      if (!stale.length) return { ok: true, headline: 'Every holding has a price.', detail: 'No position is being valued at its own cost.' };
      return { ok: false, over: stale.length, band: 1,
        headline: `${plural(stale.length, 'holding is', 'holdings are')} valued at cost because no price came back: ${stale.slice(0, 4).map(h => h.ticker).join(', ')}${stale.length > 4 ? '…' : ''}.`,
        detail: `Those positions show exactly zero profit — not because they are flat, but because the app has nothing to compare their cost to.` };
    },
  },
  {
    id: 'data.factors', topic: 'Records', view: 'factors', basis: 'stated',
    needs: 'fundamentals typed on the Financials screen',
    cite: 'The factor screen publishes a coverage floor and refuses to draw a tilt below it. This rule reports where you sit against that same floor.',
    run: ({ tilt }) => {
      const cov = fin(tilt?.coverage);
      if (cov == null) return null;
      const FLOOR = 50;
      if (cov * 100 >= FLOOR) return { ok: true, headline: `Factor data covers ${pc(cov * 100)} of the book.`, detail: `Above the ${FLOOR}% floor, so the tilt is drawn.` };
      return { ok: false, over: FLOOR - cov * 100, band: 10,
        headline: `Factor data covers only ${pc(cov * 100)} of the book.`,
        detail: `Below the ${FLOOR}% floor the Factors screen refuses to draw a tilt, because a tilt measured on a third of the book is a claim about that third wearing the whole book’s label.` };
    },
  },

  // --- cash ---------------------------------------------------------------
  {
    id: 'cash.runway', topic: 'Cash', view: 'cash', basis: 'convention',
    needs: 'transactions logged, and deposits or cash recorded',
    cite: 'The three-to-six month emergency fund is a widely published rule of thumb. It is not your number — you have not saved a runway target — and it is not a law.',
    run: ({ cash, liquid, cur }) => {
      const spend = fin(cash?.avgs?.spend);
      const l = fin(liquid);
      if (spend == null || spend <= 0 || l == null) return null;
      const months = l / spend;
      const LIMIT = 6, BAND = 1.5;
      if (months >= LIMIT) {
        return { ok: true, headline: `Liquid holdings cover ${n1(months)} months of your average spend.`,
          detail: `At or above the ${LIMIT}-month convention. Average spend is ${fmt(cur, spend)} across ${plural(cash.avgs.months, 'complete month', 'complete months')}.` };
      }
      return { ok: false, over: LIMIT - months, band: BAND,
        headline: `Liquid holdings cover ${n1(months)} months of average spend.`,
        detail: `The commonly cited emergency-fund range is ${LIMIT} months. Average spend of ${fmt(cur, spend)} comes from ${plural(cash.avgs.months, 'complete month', 'complete months')} on the Cash screen — a short history moves this number a lot.` };
    },
  },
  {
    id: 'cash.rate', topic: 'Cash', view: 'cash', basis: 'yours',
    needs: 'at least three complete months of transactions',
    cite: 'Your own trailing savings rate, from your own logged transactions. There is no external threshold here — the comparison is you against you.',
    run: ({ cash, monthRate }) => {
      const avg = fin(cash?.avgs?.savingsRate);
      const now = fin(monthRate);
      if (avg == null || now == null || (cash?.avgs?.months ?? 0) < 3) return null;
      const BAND = 10;
      const gap = avg - now;
      if (gap <= BAND) {
        return { ok: true, headline: `This month is saving ${pc(now)} of income, against your ${pc(avg)} average.`,
          detail: `Within ${BAND}pp of your own trailing rate.` };
      }
      return { ok: false, over: gap - BAND, band: BAND,
        headline: `This month is saving ${pc(now)} of income, against your ${pc(avg)} average over ${plural(cash.avgs.months, 'month', 'months')}.`,
        detail: `A gap of ${pp(-gap)} against your own trailing rate. The month may simply be unfinished — Cash marks the in-progress month as provisional.` };
    },
  },
  {
    id: 'cash.fixed', topic: 'Cash', view: 'cash', basis: 'convention',
    needs: 'transactions marked fixed or variable this month',
    cite: 'The 50% ceiling on committed costs is the fixed half of the widely published 50/30/20 split. A convention, cited as one.',
    run: ({ cash, cur }) => {
      const f = fin(cash?.fixed?.fixedPct);
      if (f == null) return null;
      const LIMIT = 50, BAND = 10;
      if (f <= LIMIT) return { ok: true, headline: `Fixed commitments are ${pc(f)} of this month’s spend.`, detail: `Under the ${LIMIT}% convention.` };
      return { ok: false, over: f - LIMIT, band: BAND,
        headline: `Fixed commitments are ${pc(f)} of this month’s spend (${fmt(cur, cash.fixed.fixed)} of ${fmt(cur, cash.fixed.total)}).`,
        detail: `Past the ${LIMIT}% convention for committed costs. Which charges count as fixed is your own labelling on the Cash screen.` };
    },
  },

  // --- risk ---------------------------------------------------------------
  {
    id: 'risk.grade', topic: 'Risk', view: 'risk', basis: 'stated',
    needs: 'at least 20 days of portfolio history',
    cite: 'The health grade ladder is published on the Risk screen with every input and weight visible. This rule reads that same ladder.',
    run: ({ profile }) => {
      const g = profile?.health;
      const score = fin(g?.score);
      if (score == null) return null;
      const LIMIT = 50, BAND = 10;
      const label = g?.grade?.label || g?.label || null;
      if (score >= LIMIT) return { ok: true, headline: `Portfolio health scores ${Math.round(score)}${label ? ` (${label})` : ''}.`, detail: `At or above the ladder’s midpoint.` };
      return { ok: false, over: LIMIT - score, band: BAND,
        headline: `Portfolio health scores ${Math.round(score)}${label ? ` (${label})` : ''}.`,
        detail: `Below the midpoint of the app’s own ladder. Risk shows which of the inputs pulled it down, and how many of them had data at all.` };
    },
  },
  {
    id: 'risk.dd', topic: 'Risk', view: 'risk', basis: 'yours',
    needs: 'portfolio history with a peak above the current value',
    cite: 'Your own history: today measured against your own worst previous fall. No external threshold — the book is being compared to itself.',
    run: ({ stats }) => {
      const cur = fin(stats?.drawdown?.current ?? stats?.currentDD);
      const max = fin(stats?.drawdown?.maxDD ?? stats?.maxDD);
      if (cur == null || max == null || max >= 0) return null;
      const curPct = Math.abs(cur * (Math.abs(cur) <= 1 ? 100 : 1));
      const maxPct = Math.abs(max * (Math.abs(max) <= 1 ? 100 : 1));
      if (maxPct <= 0) return null;
      const LIMIT = maxPct * 0.5, BAND = Math.max(2, maxPct * 0.15);
      if (curPct <= LIMIT) {
        return { ok: true, headline: `The book is ${pc(curPct)} below its peak.`,
          detail: `Less than half of its own worst fall of ${pc(maxPct)}.` };
      }
      return { ok: false, over: curPct - LIMIT, band: BAND,
        headline: `The book is ${pc(curPct)} below its peak, against a worst-ever fall of ${pc(maxPct)}.`,
        detail: `Today is more than halfway to the deepest drawdown this portfolio has recorded. Risk draws the underwater chart this comes from.` };
    },
  },

  // --- tax ----------------------------------------------------------------
  // Both of these state dates and arithmetic. Neither states an action, and the
  // distinction is not cosmetic: "this lot crosses the long-term line on 14 March"
  // is a fact about the statute and Neel's own order history. Anything about what
  // to do before or after that date would be tax advice, which this app does not
  // give and has said so on the Tax screen.
  {
    id: 'tax.term', topic: 'Tax', view: 'tax', basis: 'convention',
    needs: 'orders logged with dates',
    cite: 'The holding period that separates short-term from long-term is set by statute, and the Tax screen prints which period it is applying to which market.',
    run: ({ crossings, cur }) => {
      if (!Array.isArray(crossings)) return null;
      if (!crossings.length) return { ok: true, headline: 'No lot crosses its long-term boundary in the next 60 days.', detail: 'Nothing changes classification soon.' };
      const soonest = crossings[0];
      return { ok: false, over: 60 - soonest.days, band: 20,
        headline: `${plural(crossings.length, 'lot crosses', 'lots cross')} the long-term boundary within 60 days — soonest is ${soonest.ticker} in ${plural(soonest.days, 'day', 'days')}.`,
        detail: `On that date the lot’s gain changes which rate it is classified under. This is a statement about the calendar, not about what to do with it — the Tax screen shows the lots and the rates.` };
    },
  },
  {
    id: 'tax.realised', topic: 'Tax', view: 'tax', basis: 'convention',
    needs: 'realised gains this financial year',
    cite: 'The exemption threshold is statutory and is typed on the Tax screen, where it can be corrected when it changes.',
    run: ({ taxInfo, cur }) => {
      const gain = fin(taxInfo?.position?.ltcgGain ?? taxInfo?.position?.longGain);
      const exempt = fin(taxInfo?.position?.exemption);
      if (gain == null || exempt == null || exempt <= 0) return null;
      const used = (gain / exempt) * 100;
      const LIMIT = 80, BAND = 20;
      if (used <= LIMIT) return { ok: true, headline: `Long-term gains realised this year use ${pc(used)} of the exemption.`, detail: `${fmt(cur, gain)} against ${fmt(cur, exempt)}.` };
      return { ok: false, over: used - LIMIT, band: BAND,
        headline: `Realised long-term gains are ${fmt(cur, gain)} against an exemption of ${fmt(cur, exempt)} — ${pc(used)} of it.`,
        detail: `${taxInfo.fyLabel || 'This financial year'}. Past this point further realised long-term gains fall outside the exemption. Tax shows the lot-by-lot working.` };
    },
  },

  // --- income -------------------------------------------------------------
  {
    id: 'div.coverage', topic: 'Income', view: 'divs', basis: 'yours',
    needs: 'dividends typed on the Value screen and transactions logged',
    cite: 'Both halves are yours: the per-share dividends you typed, and your own logged spending. No external benchmark is applied.',
    run: ({ income, cash, cur }) => {
      const annual = fin(income?.year ?? income?.total);
      const spend = fin(cash?.avgs?.spend);
      if (annual == null || spend == null || spend <= 0) return null;
      const monthly = annual / 12;
      const cov = (monthly / spend) * 100;
      // Nothing here is a threshold — this rule reports and never fires. It
      // exists because the number is the single best answer to the question the
      // whole tab was built around, and because a rule that can only ever say
      // "clear" is more honest than one with a made-up bar to clear.
      return { ok: true, always: true,
        headline: `Dividends cover ${pc(cov)} of your average monthly spend.`,
        detail: `${fmt(cur, monthly)} a month against ${fmt(cur, spend)} of spending. Both figures are your own — typed dividends, logged transactions.` };
    },
  },
  {
    id: 'div.source', topic: 'Income', view: 'divs', basis: 'convention',
    needs: 'dividends typed for more than one holding',
    cite: 'The same 25% single-source convention applied to income rather than to capital. A convention, and not a strong one — cited so you can disagree with it.',
    run: ({ divLines }) => {
      const lines = (divLines || []).filter(l => !l.unknown && num(l.income) > 0);
      if (lines.length < 2) return null;
      const total = lines.reduce((s, l) => s + num(l.income), 0);
      if (!(total > 0)) return null;
      const top = [...lines].sort((a, b) => num(b.income) - num(a.income))[0];
      const share = (num(top.income) / total) * 100;
      const LIMIT = 25, BAND = 10;
      if (share <= LIMIT) return { ok: true, headline: `Your largest dividend payer is ${pc(share)} of income.`, detail: `Under the ${LIMIT}% single-source convention.` };
      return { ok: false, over: share - LIMIT, band: BAND,
        headline: `${top.ticker} pays ${pc(share)} of your dividend income.`,
        detail: `Past the ${LIMIT}% single-source convention. Income concentration is not the same as capital concentration — Dividends shows the per-holding split.` };
    },
  },

  // --- plan ---------------------------------------------------------------
  {
    id: 'plan.track', topic: 'Plan', view: 'plan', basis: 'yours',
    needs: 'a goal with a target and a date on the Plan screen',
    cite: 'Your goal, your target, your date, and the growth and contribution assumptions you set on the Plan screen. The projection is only as good as those assumptions and Plan prints them beside it.',
    run: ({ plan, cur }) => {
      if (!plan || plan.onTrack == null) return null;
      const short = fin(plan.shortfall);
      if (plan.onTrack) {
        return { ok: true, headline: `Your plan reaches ${fmt(cur, plan.target)} by ${plan.byYear}.`,
          detail: `Projected ${fmt(cur, plan.projected)} — ahead by ${fmt(cur, -short)} on your own assumptions.` };
      }
      const gap = (short / plan.target) * 100;
      return { ok: false, over: gap, band: 10,
        headline: `Your plan projects ${fmt(cur, plan.projected)} by ${plan.byYear}, against a target of ${fmt(cur, plan.target)}.`,
        detail: `A shortfall of ${fmt(cur, short)} — ${pc(gap)} of the target — on the growth and contribution figures you saved. Plan shows what each assumption is worth.` };
    },
  },
  {
    id: 'plan.fire', topic: 'Plan', view: 'plan', basis: 'convention',
    needs: 'a withdrawal rate on the Plan screen and logged transactions',
    cite: 'The safe-withdrawal convention is published research, applied to your own logged spending. The rate itself is the one you saved on the Plan screen.',
    run: ({ fire, netWorth, swr, cur }) => {
      const target = fin(fire);
      const now = fin(netWorth);
      if (target == null || now == null || target <= 0) return null;
      const pct = (now / target) * 100;
      return { ok: true, always: true,
        headline: `Net worth is ${pc(pct)} of the ${fmt(cur, target)} that would fund your logged spending at ${n1(swr)}%.`,
        detail: `${fmt(cur, now)} today. The target is your own annual spending divided by the withdrawal rate you set — change either on the Plan screen and this moves.` };
    },
  },
  {
    id: 'plan.date', topic: 'Plan', view: 'levers', basis: 'yours',
    needs: 'a plan saved on the Plan screen with a contribution, a growth rate and annual expenses',
    cite: 'Every figure is one you saved: starting balance, contribution, step-up, growth, inflation, spending and withdrawal rate. The crossing is measured against the inflation-adjusted balance, because the target is built from what a year costs today \u2014 Levers prints the whole assumption list beside the date.',
    run: ({ fireDate, cur }) => {
      if (!fireDate || fireDate.target == null) return null;
      if (fireDate.reachable) {
        // No threshold. A date is not something a rule can be past \u2014 it is the
        // answer to the question the tab exists for, and it belongs on the screen
        // whether or not anything is wrong.
        return { ok: true, always: true,
          headline: `On the plan you saved, the portfolio reaches ${fmt(cur, fireDate.target)} in real terms in ${fireDate.calYear}.`,
          detail: `${fireDate.years} years out, on your own growth, contribution and inflation figures. Measured in today's money \u2014 the nominal balance crosses years earlier and would not buy the same year of living. Levers shows what each change is worth.` };
      }
      const short = fin(fireDate.shortfall);
      if (short == null) return null;
      const gap = (short / fireDate.target) * 100;
      return { ok: false, over: gap, band: 10,
        headline: `On the plan you saved, the portfolio does not reach ${fmt(cur, fireDate.target)} inside your ${fireDate.horizon}-year horizon.`,
        detail: `It ends ${fmt(cur, short)} short in today's money \u2014 ${pc(gap)} of the target. The horizon is one you set, and so is every figure feeding it; Levers marks which changes bring the crossing inside it.` };
    },
  },
  {
    id: 'plan.spendgap', topic: 'Plan', view: 'plan', basis: 'yours',
    needs: 'annual expenses on the Plan screen and at least a month of logged transactions',
    cite: 'Both numbers are yours and neither is adjusted: the annual expense figure you typed into the plan, and the average of what you actually logged. The comparison is subtraction.',
    run: ({ planSpend, observedSpend, swr, cur }) => {
      const planned = fin(num(planSpend)), actual = fin(num(observedSpend));
      if (planned == null || actual == null || planned <= 0 || actual <= 0) return null;
      const rate = num(swr);
      if (!(rate > 0)) return null;
      const diff = actual - planned;
      const targetShift = diff / (rate / 100);
      // Reports and never fires, for the same reason div.coverage does: any
      // threshold here would be mine. How far a plan's spending assumption may
      // drift from logged spending before it matters is a judgement about how
      // stable the logging is, and only Neel knows that.
      if (Math.abs(diff) < 1) {
        return { ok: true, always: true,
          headline: `Your plan's spending assumption matches what you have logged: ${fmt(cur, planned)} a year.`,
          detail: `The number the plan is built on and the number you are living on are the same, so the target on the Plan screen is the one your own record supports.` };
      }
      const dir = diff > 0 ? 'more' : 'less';
      return { ok: true, always: true,
        headline: `Your plan assumes ${fmt(cur, planned)} a year of spending; you have logged ${fmt(cur, actual)}.`,
        detail: `${fmt(cur, Math.abs(diff))} a year ${dir} than planned. At the ${n1(rate)}% withdrawal rate you set, that is ${fmt(cur, Math.abs(targetShift))} ${diff > 0 ? 'added to' : 'off'} the number you are aiming at. Neither figure is adjusted \u2014 one is typed, one is logged.` };
    },
  },
];

// ---------------------------------------------------------------------------
// Rules that were considered and dropped, kept here because the absences are
// the argument. Each one would have required me to invent the threshold, and a
// number I invented, printed next to numbers Neel typed, in the same typeface,
// is the exact failure this file is built to avoid:
//
//   * "Your portfolio beta is above 1.2." — There is no defensible source for
//     1.2. Neel has not stated a beta he wants. It is on the Risk screen as a
//     measurement, which is the honest place for it.
//   * "You are underweight international." — Requires a view about what the
//     right weight is. If Neel saves a target for it, alloc.drift already
//     covers it, on his number instead of mine.
//   * "Holding X has fallen 20% and may be worth reviewing." — This is a
//     recommendation with a hedge on it. A price move is on every screen in the
//     tab already; wrapping it in "may be worth" adds nothing but authority.
//   * "Your cash is earning nothing." — True, and it is one sentence away from
//     naming an instrument to move it into, which is advice.
//   * A composite "financial health score" out of 100 for the whole picture.
//     It would be a weighted mean, the weights would be mine, and the single
//     number would bury every stamp and every skipped rule underneath it. This
//     is the same argument sentiment.js makes for an unweighted mean, taken one
//     step further: here, there is no defensible mean at all.

// ---------------------------------------------------------------------------

export function brief(ctx = {}) {
  const flags = [], clear = [], skipped = [];
  for (const rule of RULES) {
    let out = null;
    // A rule that throws is a bug in the rule, and it must not take the other
    // seventeen down with it — but it must not be silently counted as passing
    // either. It lands in SKIPPED with the error, where it is visible.
    try { out = rule.run(ctx); }
    catch (e) {
      skipped.push({ ...rule, why: `The rule failed to run: ${e.message}`, broke: true });
      continue;
    }
    if (!out) { skipped.push({ ...rule, why: `Needs ${rule.needs}.` }); continue; }
    const row = { ...rule, ...out, basisInfo: BASIS[rule.basis] };
    if (out.ok) clear.push(row);
    else flags.push(row);
  }
  // Decision 4: distance past threshold, in the rule's own band widths.
  for (const f of flags) f.severity = fin(f.band) > 0 ? f.over / f.band : 0;
  flags.sort((a, b) => (b.severity ?? 0) - (a.severity ?? 0));

  return {
    flags, clear, skipped,
    ran: flags.length + clear.length,
    total: RULES.length,
    // Decision 1, made unmissable: the confidence of the whole briefing is the
    // share of its rules that had data, and it is returned beside every result
    // rather than left for the caller to work out.
    coverage: RULES.length ? ((flags.length + clear.length) / RULES.length) * 100 : 0,
  };
}

export const SEVERITY = s =>
  (s >= 2 ? { key: 'far', label: 'well past', color: 'var(--red)' }
    : s >= 1 ? { key: 'past', label: 'past', color: 'var(--orange)' }
      : { key: 'near', label: 'just past', color: 'var(--yellow)' });

// Lots approaching the statutory long-term boundary. Pure calendar arithmetic
// over Neel's own orders: no rate is applied, no action is named, and a lot that
// has already crossed is not included — it is not "approaching" anything, and
// the Tax screen already reports it where it belongs.
export function termCrossings(orders = [], { asOf = new Date(), within = 60, foreignOf = () => false, shortDays = 365, foreignShortDays = 730 } = {}) {
  const out = [];
  const byTicker = new Map();
  for (const o of orders) {
    if (String(o?.side || o?.type || 'buy').toLowerCase() !== 'buy') continue;
    const t = String(o?.ticker || '').toUpperCase();
    const d = o?.date ? new Date(o.date) : null;
    const q = num(o?.qty);
    if (!t || !d || Number.isNaN(+d) || !(q > 0)) continue;
    if (!byTicker.has(t)) byTicker.set(t, []);
    byTicker.get(t).push({ date: d, qty: q });
  }
  for (const [ticker, lots] of byTicker) {
    const limit = foreignOf(ticker) ? foreignShortDays : shortDays;
    for (const lot of lots) {
      const held = Math.floor((asOf - lot.date) / 86400000);
      const days = limit - held;
      if (days >= 0 && days <= within) out.push({ ticker, days, qty: lot.qty, on: new Date(+lot.date + limit * 86400000) });
    }
  }
  return out.sort((a, b) => a.days - b.days);
}
