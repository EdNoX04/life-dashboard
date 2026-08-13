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

  // --- look-through -------------------------------------------------------
  //
  // Five rules that need nothing from you. Every other rule in this file waits
  // on a figure you have to type; these run on the book itself the day the app
  // is installed, which is when the briefing is emptiest and least useful.
  //
  // None of them introduces a threshold I picked. Two reuse a convention this
  // file already cites, two derive their limit from the data's own shape the way
  // conc.spread does, and one has a threshold of zero — which needs no
  // justification, because "some of your money is missing from the total" is not
  // a matter of degree.
  {
    id: 'xray.top1', topic: 'Concentration', view: 'xray', basis: 'convention',
    needs: 'at least one holding with a price',
    cite: 'The same 20–25% single-position convention conc.top1 cites, applied to true exposure instead of to the ticker. No new number: the only thing that changed is that the funds have been unpacked first.',
    run: ({ xray, cur }) => {
      const top = xray?.exposures?.[0];
      if (!top || !fin(xray.total) || xray.total <= 0) return null;
      const LIMIT = 25, BAND = 5;
      const shelf = fin(xray.shelf?.[top.sym]);
      const where = shelf == null
        ? `and its own ticker is not on your shelf at all`
        : `while its own line reads ${pc(shelf)}`;
      if (top.pct <= LIMIT) {
        return { ok: true,
          headline: `After unpacking every fund, your largest single company is ${top.name} at ${pc(top.pct)} of the book.`,
          detail: `Under the ${LIMIT}% single-position convention, ${where}.` };
      }
      return { ok: false, over: top.pct - LIMIT, band: BAND,
        headline: `${top.name} is ${pc(top.pct)} of everything you own once the funds are unpacked, ${where}.`,
        detail: `That is ${pp(top.pct - LIMIT)} past the ${LIMIT}% single-position convention. The X-ray screen shows which funds it arrives through.` };
    },
  },
  {
    id: 'xray.spread', topic: 'Concentration', view: 'xray', basis: 'stated',
    needs: 'at least two companies after the funds are unpacked',
    cite: 'The same effective-N arithmetic conc.spread uses, over companies instead of positions. The X-ray prints it beside the coverage figure it is measured across, because an effective count over two-thirds of a book is not a fact about the book.',
    run: ({ xray }) => {
      const eff = fin(xray?.conc?.effective);
      const n = xray?.exposures?.length ?? 0;
      if (eff == null || n < 2) return null;
      // Derived from the data, exactly as conc.spread derives its own: the point
      // at which the company count stops describing the book.
      const LIMIT = n / 2, BAND = Math.max(1, n / 6);
      const basis = fin(xray?.conc?.basis);
      const across = basis == null ? '' : ` Measured across the ${pc(basis)} of the book that could be decomposed.`;
      if (eff >= LIMIT) {
        return { ok: true, headline: `${plural(n, 'company', 'companies')} spread like ${n1(eff)} equal ones.`,
          detail: `At least half the company count.${across}` };
      }
      return { ok: false, over: LIMIT - eff, band: BAND,
        headline: `Your funds resolve to ${plural(n, 'company', 'companies')}, but they spread like ${n1(eff)} equal ones.`,
        detail: `Under half the company count, which means counting names overstates how spread the book is.${across}` };
    },
  },
  {
    id: 'xray.overlap', topic: 'Concentration', view: 'xray', basis: 'stated',
    needs: 'two funds held with published compositions',
    cite: 'Overlap is the sum of the smaller weight in every company two funds share, and it fires at 50% — the point at which two funds are literally more than half the same fund. That is a statement of arithmetic, not a view about whether owning both is wise. The figure is a FLOOR: it is computed from top-25 lists, so the unlisted remainders overlap further by an amount nothing can see.',
    run: ({ xray }) => {
      const pairs = xray?.pairs;
      if (!pairs?.length) return null;
      const LIMIT = 50, BAND = 10;
      const worst = pairs[0];
      if (worst.pct <= LIMIT) {
        return { ok: true, headline: `Your most similar pair of funds, ${worst.a} and ${worst.b}, share at least ${pc(worst.pct)} of themselves.`,
          detail: `No pair is more than half the same fund on the holdings we can see.` };
      }
      const others = pairs.filter(p => p.pct > LIMIT).length;
      return { ok: false, over: worst.pct - LIMIT, band: BAND,
        headline: `${worst.a} and ${worst.b} are at least ${pc(worst.pct)} the same fund${others > 1 ? `, and ${others - 1} other pair${others > 2 ? 's are' : ' is'} also past half` : ''}.`,
        detail: `Past the point where two funds are more than half identical. The X-ray lists the shared names and their weights.` };
    },
  },
  {
    id: 'data.currency', topic: 'Records', view: 'portfolio', basis: 'stated',
    needs: 'holdings with prices',
    cite: 'Threshold zero, which needs no source: a position left out of a total makes the total smaller by exactly its own value. The app excludes rather than converting at 1.0, because a rupee figure added to a dollar one is wrong by about ninety and a total that has absorbed one looks exactly like a correct total.',
    run: ({ xray }) => {
      const ex = xray?.excluded;
      if (!ex) return null;
      if (!ex.length) return { ok: true, headline: 'Every position is in a currency the totals can convert.', detail: 'Nothing is being left out of the book value.' };
      return { ok: false, over: ex.length, band: 1,
        headline: `${plural(ex.length, 'position is', 'positions are')} missing from the book value for want of an exchange rate: ${ex.map(e => e.ticker).join(', ')}.`,
        detail: `The totals are understated by whatever those are worth. They are excluded rather than converted at 1.0, which would be wrong by the exchange rate instead of merely incomplete.` };
    },
  },
  {
    id: 'data.lookthrough', topic: 'Records', view: 'xray', basis: 'stated',
    needs: 'at least one fund held',
    cite: 'The X-ray publishes its own coverage on screen and refuses to spread an unknown fund across the names it does know. This rule reports the same figure the screen prints, which is how much of the book the concentration numbers above actually describe.',
    run: ({ xray }) => {
      const unknown = xray?.unknown;
      if (!unknown || !fin(xray.total) || xray.total <= 0) return null;
      if (!unknown.funds?.length) {
        return { ok: true, headline: 'Every fund you hold has a published composition on file.',
          detail: `The look-through covers the whole book${fin(xray.coverage) != null ? `, resolving ${pc(xray.coverage)} of it to named companies` : ''}.` };
      }
      return { ok: false, over: unknown.pct, band: 5,
        headline: `${pc(unknown.pct)} of the book sits in ${plural(unknown.funds.length, 'fund', 'funds')} with no composition on file: ${unknown.funds.map(f => f.sym).join(', ')}.`,
        detail: `Every company figure on the X-ray describes the rest of the book, not that part. The money is counted in the total and left out of the exposures rather than spread over the names we happen to know.` };
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
// HOW TO MAKE A SKIPPED RULE RUN.
//
// Listing an absence is decision 1. Leaving the reader to work out what to do
// about it is a different failure, and a quieter one: nine rows saying "needs
// transactions logged" reads as a wall of excuses rather than a short list of
// jobs. Each entry below names the ONE action that turns a skipped rule into a
// running one, and the screen it happens on.
//
// This is not advice and the distinction is exact. "Save your target allocation
// on the Rebalance screen" is an instruction about how to operate this app.
// "Your target allocation should be 60/40" would be an instruction about your
// money, and there is nothing in here of that kind — every action below is
// record-keeping, and none of them names a number.
//
// A rule with no entry here cannot be enabled by anything you type. risk.grade
// wants twenty days of history; the only thing that produces that is twenty days
// passing. Saying so is more use than a button that cannot help.
export const ENABLE = {
  'alloc.drift': { view: 'rebal', action: 'Save a target allocation on the Rebalance screen.' },
  'alloc.untargeted': { view: 'rebal', action: 'Save a target allocation on the Rebalance screen.' },
  'data.factors': { view: 'fin', action: 'Import or type fundamentals on the Financials screen.' },
  'cash.runway': { view: 'cash', action: 'Log transactions on the Cash screen, and record a deposit or cash balance.' },
  'cash.rate': { view: 'cash', action: 'Log at least three complete months of transactions on the Cash screen.' },
  'cash.fixed': { view: 'cash', action: 'Mark this month\u2019s transactions fixed or variable on the Cash screen.' },
  'tax.term': { view: 'book', action: 'Import your order history so every lot carries a purchase date.' },
  'tax.realised': { view: 'tax', action: 'Nothing to do unless you have sold this financial year \u2014 the rule needs a realised gain to report on.' },
  'div.coverage': { view: 'divsync', action: 'Run the dividend import on the Data screen.' },
  'div.source': { view: 'divsync', action: 'Run the dividend import on the Data screen, which fills more than one holding at once.' },
  'plan.track': { view: 'plan', action: 'Add a goal with a target amount and a date on the Plan screen.' },
  'plan.fire': { view: 'plan', action: 'Set a withdrawal rate on the Plan screen, and log transactions on the Cash screen.' },
  'plan.date': { view: 'plan', action: 'Save a plan on the Plan screen with a monthly contribution, a growth rate and annual expenses.' },
  'plan.spendgap': { view: 'plan', action: 'Enter annual expenses on the Plan screen, and log at least one month on the Cash screen.' },
  'risk.grade': { view: null, action: 'Nothing to enter \u2014 this needs twenty days of recorded portfolio history, which only time produces.' },
  'risk.dd': { view: null, action: 'Nothing to enter \u2014 this needs a recorded peak above today\u2019s value, which only time produces.' },
};

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
      skipped.push({ ...rule, why: `The rule failed to run: ${e.message}`, broke: true, enable: ENABLE[rule.id] || null });
      continue;
    }
    if (!out) {
      skipped.push({ ...rule, why: `Needs ${rule.needs}.`, enable: ENABLE[rule.id] || null });
      continue;
    }
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
