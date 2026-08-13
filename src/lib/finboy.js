// FinBoy — the money-scoped assistant (spec item 8).
//
// A chatbot over your own finances is a different animal from a chatbot. The
// dangerous answer here is not a rude one or a refused one; it is a fluent,
// confident paragraph containing a number that does not exist. Every other screen
// in this app can be checked against the thing it describes, because the thing is
// on the same screen. A sentence cannot. So the entire design is about making
// fabrication impossible rather than unlikely, and it costs six decisions:
//
//   1. Retrieval failure is a REFUSAL, not a smaller prompt. If nothing in your
//      data matches the question, no model is called at all. Handing a model an
//      unrelated context and a question it cannot answer from it is precisely the
//      condition under which it invents one.
//   2. Every fact enters the prompt with its own as-of stamp attached, and the
//      model is told that a fact with an unknown stamp may not be quoted as
//      current. Same rule as the report, for the same reason.
//   3. Numbers in the answer are checked back against the context AFTER the model
//      replies. Any figure that is not in the context — or a rounding of something
//      in it — is surfaced to you as unverified. This is the load-bearing one: it
//      is the only check here that does not depend on the model cooperating.
//   4. Advice is refused locally, before the call. "Should I sell HDFC" is caught
//      by intent, answered with the facts, and told plainly that it will not
//      recommend. Asking the model to decline is a request; declining here is a
//      guarantee.
//   5. Off-topic questions never reach the network. This is a money assistant over
//      your data; a general chatbot that also has your portfolio in its prompt is
//      a different and worse product, and every stray question spends your key.
//   6. It works with NO api key at all. Retrieval alone — quoting the matched
//      facts with their stamps — answers a large share of real questions, and it
//      answers them without the fabrication risk existing in the first place.
//
// This file makes no network call of any kind. It builds an index, scores a
// question against it, composes a prompt, and audits an answer. The caller does
// the talking.

export const FLOOR = 0.18;          // below this, nothing matched well enough to answer
export const MAX_FACTS = 14;        // how many facts may enter one prompt

// ---------------------------------------------------------------------------
// Facts

export function fact(id, topic, text, { tags = [], asOf = undefined } = {}) {
  return {
    id, topic, text,
    tags: tags.map(t => String(t).toLowerCase()),
    // Decision 2: undefined means nobody told us, and that is NOT now.
    asOf: asOf === undefined ? null : asOf,
    asOfKnown: asOf !== undefined && asOf !== null,
  };
}

const STOP = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'my', 'me', 'i', 'of', 'in',
  'on', 'to', 'for', 'and', 'or', 'do', 'does', 'did', 'how', 'what', 'whats', 'much', 'many',
  'have', 'has', 'had', 'it', 'this', 'that', 'be', 'been', 'am', 'at', 'by', 'with', 'from',
  'can', 'you', 'your', 'now', 'currently', 'right', 'so', 'far', 'up', 'about', 'tell', 'show',
  'give', 'whats', 'im', 'its']);

export function tokenise(s) {
  return String(s || '').toLowerCase()
    .replace(/[^a-z0-9%₹$.\s-]/g, ' ')
    .split(/\s+/)
    .map(t => t.replace(/^[-.]+|[-.]+$/g, ''))
    .filter(t => t.length > 1 && !STOP.has(t));
}

// A synonym map, because the words a person uses are not the words a data model
// uses. "Made" is "return"; "worth" is "value". Missing this is the most common
// way a perfectly good index scores zero against a perfectly clear question.
const SYN = {
  worth: ['value', 'total'], made: ['return', 'gain', 'profit'], lost: ['loss', 'drawdown'],
  earning: ['income', 'dividend', 'yield'], earn: ['income', 'dividend', 'yield'],
  pay: ['dividend', 'income'], paying: ['dividend', 'income'], payout: ['dividend'],
  owe: ['tax'], taxes: ['tax'], owed: ['tax'], spend: ['expense', 'spending'],
  spending: ['expense'], burn: ['expense', 'spending'], save: ['savings', 'rate'],
  risky: ['risk', 'volatility'], safe: ['risk'], swing: ['volatility'],
  big: ['largest', 'top', 'concentration'], biggest: ['largest', 'top', 'concentration'],
  diversified: ['concentration', 'allocation'], spread: ['concentration', 'allocation'],
  retire: ['fire', 'goal', 'plan'], retirement: ['fire', 'goal', 'plan'],
  beating: ['benchmark'], versus: ['benchmark'], vs: ['benchmark'], index: ['benchmark'],
  holding: ['position'], holdings: ['position'], stocks: ['position', 'equity'],
  shares: ['position'], portfolio: ['position', 'value'],
};

function expand(tokens) {
  const out = new Set(tokens);
  for (const t of tokens) for (const s of (SYN[t] || [])) out.add(s);
  return [...out];
}

// ---------------------------------------------------------------------------
// Retrieval — plain lexical overlap over tags and text. No embeddings, and that
// is deliberate: an embedding call is a network round-trip and a cost per
// question, and the corpus here is a few dozen sentences the app wrote itself
// with tags it chose. Fuzzy matching would buy nothing and could only make a
// wrong fact look relevant.

export function scoreFact(f, terms) {
  if (!terms.length) return 0;
  const text = (f.text + ' ' + f.topic).toLowerCase();
  let hits = 0;
  for (const t of terms) {
    if (f.tags.includes(t)) hits += 1;              // a tag is an exact intent match
    else if (f.tags.some(g => g.includes(t) || t.includes(g))) hits += 0.6;
    else if (text.includes(t)) hits += 0.35;        // a mention is weaker than a tag
  }
  return hits / terms.length;
}

export function retrieve(index = [], question, { limit = MAX_FACTS, floor = FLOOR } = {}) {
  const terms = expand(tokenise(question));
  const scored = index
    .map(f => ({ fact: f, score: scoreFact(f, terms) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score);
  const best = scored[0]?.score || 0;
  return {
    terms,
    best,
    // Decision 1: this is the gate, and it is checked before anything is sent.
    enough: best >= floor,
    hits: scored.slice(0, limit).map(x => x.fact),
    scores: scored.slice(0, limit).map(x => Number(x.score.toFixed(3))),
  };
}

// ---------------------------------------------------------------------------
// Intent — decided locally, so decisions 4 and 5 are guarantees rather than
// requests made of a model that is free to ignore them.

// "is it a good buy" and "is Infosys a good buy" are the same question, and an
// intent test that only catches the first one catches the phrasing nobody uses.
// The pattern is therefore on the judgement being asked for, not on the pronoun.
const ADVICE = /\b(should i|shall i|do i (buy|sell)|worth (buying|selling)|a good (buy|bet|time|entry|price|pick|investment|stock|idea)|recommend|advice|advise|what (should|would) (i|you) (buy|sell|do)|pick for me|tell me what to buy|invest in)\b/i;
const MONEYISH = /\b(portfolio|holding|position|stock|share|equity|etf|fund|invest|dividend|yield|payout|tax|capital gain|ltcg|stcg|expense|spend|spending|budget|saving|savings|cash|income|salary|net worth|allocation|asset|sector|risk|volatility|drawdown|benchmark|index|return|gain|loss|profit|fd|deposit|bond|crypto|fire|retire|goal|plan|rupee|dollar|₹|\$|value|worth|cost|xirr|cagr|sharpe|beta)\b/i;

export function classify(question) {
  const q = String(question || '').trim();
  if (!q) return { kind: 'empty', why: 'Nothing was asked.' };
  if (ADVICE.test(q)) {
    return {
      kind: 'advice',
      why: 'That is asking what to do, and FinBoy does not do that. It reports what is '
        + 'in your data — it is not a licensed adviser and will not tell you what to buy, '
        + 'sell or hold. Here is what the data says; the decision stays yours.',
    };
  }
  if (!MONEYISH.test(q)) {
    return {
      kind: 'offtopic',
      why: 'FinBoy only answers from your own money data, and nothing in this question '
        + 'looks like it. Nothing was sent anywhere — asking it would have spent your API '
        + 'key on a question it could not have answered from your data anyway.',
    };
  }
  return { kind: 'money', why: null };
}

// ---------------------------------------------------------------------------
// Prompt

export const SYSTEM = [
  'You are FinBoy, a read-only assistant over one person\'s own financial data.',
  '',
  'RULES, in order of importance:',
  '1. Every number you state must appear in the CONTEXT below. If it is not there, say you do not have it. Do not calculate new figures from the ones given, and do not estimate.',
  '2. Each fact carries an "as of" stamp. Quote it whenever you quote the fact. A fact stamped "as of: unknown" must NOT be described as current — say its age is unknown.',
  '3. If the context does not contain the answer, say exactly what is missing. A partial answer that names its gap is correct; a complete-sounding answer is not.',
  '4. You do not give investment, tax or financial advice. You do not rank holdings by attractiveness, suggest buying or selling, or say whether something is good. If asked, report the relevant figures and say the decision is theirs.',
  '5. Be brief and plain. No headings, no bullet lists, no preamble. Two or three sentences is usually the whole answer.',
].join('\n');

const stamp = f => (f.asOfKnown
  ? new Date(f.asOf).toISOString().slice(0, 16).replace('T', ' ')
  : 'unknown');

export function composeContext(hits = []) {
  if (!hits.length) return '';
  return hits.map(f => `- [${f.topic}] ${f.text} (as of: ${stamp(f)})`).join('\n');
}

export function buildPrompt(question, hits) {
  return `CONTEXT — these are the only facts you have:\n${composeContext(hits)}\n\nQUESTION: ${question}`;
}

// A rough token count so the cost of a question can be shown BEFORE it is spent.
// Deliberately an over-estimate: a surprise on the bill is worse than a surprise
// on the screen.
export function estimateTokens(question, hits) {
  const chars = SYSTEM.length + buildPrompt(question, hits).length;
  return Math.ceil(chars / 3.5) + 400;
}

// ---------------------------------------------------------------------------
// Decision 3 — the audit. The one guardrail here that does not require the model
// to cooperate.

const numsIn = s => [...String(s || '').matchAll(/-?\d[\d,]*(?:\.\d+)?/g)]
  .map(m => m[0].replace(/,/g, ''))
  .map(Number)
  .filter(n => Number.isFinite(n));

// A model that rounds is not lying, so a figure is supported if the context holds
// something it plausibly rounds from. Anything else is surfaced.
function supported(n, pool) {
  for (const c of pool) {
    if (c === n) return true;
    const mag = Math.max(Math.abs(c), Math.abs(n));
    // Rounding to a whole number, to one decimal, or to 3 significant figures.
    if (Math.abs(c - n) <= 0.5) return true;
    if (mag > 0 && Math.abs(c - n) / mag <= 0.005) return true;
  }
  return false;
}

export function auditNumbers(answer, context) {
  const pool = numsIn(context);
  const claimed = numsIn(answer);
  const seen = new Set();
  const unsupported = [];
  for (const n of claimed) {
    if (seen.has(n)) continue;
    seen.add(n);
    if (!supported(n, pool)) unsupported.push(n);
  }
  return {
    checked: seen.size,
    unsupported,
    clean: unsupported.length === 0,
    // Stated rather than implied: an answer with no numbers in it was not verified,
    // it simply had nothing to verify, and those are different.
    verified: seen.size > 0 && unsupported.length === 0,
  };
}

// ---------------------------------------------------------------------------
// Decision 6 — the no-key answer. Retrieval alone, quoted verbatim with stamps.
// Nothing is paraphrased, so nothing can be paraphrased wrongly.

export function quoteAnswer(hits = []) {
  if (!hits.length) return null;
  return {
    lead: hits.length === 1
      ? 'One thing in your data matches that:'
      : `${hits.length} things in your data match that:`,
    rows: hits.map(f => ({ topic: f.topic, text: f.text, asOf: f.asOfKnown ? stamp(f) : null })),
    tail: 'These are quoted straight from your saved figures, word for word — nothing here '
      + 'has been summarised or recalculated. Add an AI key in Config and FinBoy will answer '
      + 'in sentences instead.',
  };
}

// ---------------------------------------------------------------------------
// The index. Each builder is defensive about its input because a report that is
// missing a section is honest, but an index that throws takes the whole assistant
// down with it.

const n2 = v => (Number.isFinite(v) ? Number(v).toFixed(2) : null);
const n1 = v => (Number.isFinite(v) ? Number(v).toFixed(1) : null);
const pc = v => (Number.isFinite(v) ? `${Number(v).toFixed(1)}%` : null);

export function buildIndex({
  held = [], priceOf = h => Number(h.last_price ?? h.avg_cost ?? 0), cur = '$',
  alloc = null, conc = null, stats = null, drawdownInfo = null, profile = null,
  income = null, yieldInfo = null, taxInfo = null, cash = null, plan = null,
  tilt = null, asOf = undefined, seriesAsOf = undefined, factorAsOf = undefined,
  // Everything built after FinBoy was. Each one was a question it would answer
  // confidently and wrongly — "how much NVIDIA do I own" got the direct line
  // and missed the four funds holding it; "who owes me money" got nothing at
  // all. A partial index is worse than a missing one, because the gaps are
  // invisible from inside an answer.
  xray = null, accounts = null, ledger = null, cashFlows = null,
} = {}) {
  const F = [];
  const money = v => `${cur}${Math.round(v).toLocaleString('en-IN')}`;

  // --- positions
  const value = held.reduce((s, h) => s + Number(h.qty || 0) * priceOf(h), 0);
  const cost = held.reduce((s, h) => s + Number(h.qty || 0) * Number(h.avg_cost || 0), 0);
  if (held.length) {
    F.push(fact('pos.count', 'positions', `You hold ${held.length} positions.`,
      { tags: ['position', 'holding', 'count', 'how many'], asOf }));
    F.push(fact('pos.value', 'positions', `Those positions are worth ${money(value)} in total.`,
      { tags: ['value', 'worth', 'total', 'portfolio', 'position'], asOf }));
    if (cost > 0) {
      const pl = value - cost;
      F.push(fact('pos.cost', 'positions',
        `They cost ${money(cost)}, so the unrealised profit or loss is ${money(pl)} (${pc((pl / cost) * 100)}).`,
        { tags: ['cost', 'profit', 'loss', 'gain', 'return', 'unrealised'], asOf }));
    }
    const ranked = held
      .map(h => ({ t: h.ticker, n: h.name, v: Number(h.qty || 0) * priceOf(h) }))
      .filter(x => x.v > 0).sort((a, b) => b.v - a.v);
    for (const p of ranked.slice(0, 8)) {
      F.push(fact(`pos.${p.t}`, 'positions',
        `${p.t}${p.n ? ` (${p.n})` : ''} is worth ${money(p.v)}, which is ${pc(value ? (p.v / value) * 100 : 0)} of the book.`,
        { tags: [String(p.t).toLowerCase(), String(p.n || '').toLowerCase(), 'position', 'holding', 'weight'], asOf }));
    }
    if (ranked[0]) {
      F.push(fact('pos.largest', 'positions', `Your largest position is ${ranked[0].t}.`,
        { tags: ['largest', 'biggest', 'top', 'concentration'], asOf }));
    }
  }

  // --- look-through, which is a different answer from the shelf
  if (xray?.exposures?.length) {
    const top = xray.exposures[0];
    F.push(fact('xray.top', 'look-through',
      `After decomposing every fund, your largest single company exposure is ${top.name} at ${pc(top.pct)} of the whole book.`,
      { tags: ['really', 'actually', 'true', 'exposure', 'look through', 'lookthrough', 'largest', 'concentration', String(top.sym).toLowerCase()], asOf }));
    F.push(fact('xray.count', 'look-through',
      `Your positions resolve to ${xray.exposures.length} distinct companies once the funds are unpacked, and ${pc(xray.coverage)} of the book could be decomposed.`,
      { tags: ['companies', 'how many', 'look through', 'coverage', 'unpacked', 'funds'], asOf }));
    for (const e of xray.exposures.slice(0, 6)) {
      const via = (e.via || []).map(v => v.fund).join(', ');
      F.push(fact(`xray.${e.sym}`, 'look-through',
        `Counting what the funds hold, you own ${pc(e.pct)} of the book in ${e.name}${via ? `, arriving through ${via}` : ''}${e.direct ? ' as well as directly' : ' without holding it directly'}.`,
        { tags: [String(e.sym).toLowerCase(), String(e.name || '').toLowerCase(), 'exposure', 'really own', 'through', 'fund'], asOf }));
    }
    if (xray.conc?.effective != null) {
      F.push(fact('xray.spread', 'look-through',
        `Those companies spread like ${n1(xray.conc.effective)} equally sized ones, measured across the ${pc(xray.conc.basis)} of the book that could be decomposed.`,
        { tags: ['diversified', 'spread', 'concentration', 'effective', 'look through'], asOf }));
    }
    const worst = xray.pairs?.[0];
    if (worst) {
      F.push(fact('xray.overlap', 'look-through',
        `${worst.a} and ${worst.b} are at least ${pc(worst.pct)} the same fund — a floor, since it is computed from published top-25 lists.`,
        { tags: ['overlap', 'same', 'duplicate', 'similar', 'funds', String(worst.a).toLowerCase(), String(worst.b).toLowerCase()], asOf }));
    }
    if (xray.unknown?.funds?.length) {
      F.push(fact('xray.unknown', 'look-through',
        `${pc(xray.unknown.pct)} of the book sits in funds with no composition on file (${xray.unknown.funds.map(f => f.sym).join(', ')}), so the figures above describe the rest.`,
        { tags: ['unknown', 'missing', 'coverage', 'gap', 'look through'], asOf }));
    }
  }

  // --- accounts
  for (const a of (accounts || []).slice(0, 6)) {
    F.push(fact(`acct.${a.id}`, 'accounts',
      `${a.label} holds ${money(a.totals?.marketValue || 0)} across ${a.totals?.count || 0} holding${a.totals?.count === 1 ? '' : 's'}, which is ${pc(a.share || 0)} of everything you own.`,
      { tags: ['account', 'broker', 'where', String(a.label || '').toLowerCase(), 'held', 'split'], asOf }));
  }

  // --- who owes whom
  if (ledger?.balances?.length) {
    const open = ledger.balances.filter(b => !b.settledUp);
    if (open.length) {
      for (const b of open.slice(0, 6)) {
        F.push(fact(`lend.${b.id}`, 'lending',
          b.balance > 0
            ? `${b.name} owes you ${money(Math.abs(b.balance))}${b.last ? `, last movement ${b.last}` : ''}.`
            : `You owe ${b.name} ${money(Math.abs(b.balance))}${b.last ? `, last movement ${b.last}` : ''}.`,
          { tags: [String(b.name || '').toLowerCase(), 'owe', 'owes', 'lent', 'borrowed', 'debt', 'lending', 'friend'], asOf }));
      }
    }
    F.push(fact('lend.total', 'lending',
      `Across everyone, ${money(ledger.owedToYou || 0)} is owed to you and ${money(ledger.youOwe || 0)} is owed by you, over ${ledger.open || 0} open balance${ledger.open === 1 ? '' : 's'}.`,
      { tags: ['owe', 'owed', 'lending', 'borrowed', 'debt', 'total', 'who'], asOf }));
  }

  // --- cash flows that are not spending
  if (cashFlows && (cashFlows.invested > 0 || cashFlows.lent > 0)) {
    F.push(fact('cash.flows', 'cash',
      `In the period logged you moved ${money(cashFlows.invested || 0)} into investments and lent out ${money(cashFlows.lent || 0)}. Neither counts as spending — that money is not gone.`,
      { tags: ['invested', 'investing', 'saved', 'lent', 'spending', 'not spending', 'cash'], asOf }));
  }

  // --- allocation
  for (const s of (alloc?.byClass || []).slice(0, 8)) {
    F.push(fact(`alloc.${s.label}`, 'allocation',
      `${s.label} is ${pc(s.pct)} of everything you hold (${money(s.value)}).`,
      { tags: ['allocation', 'asset', 'class', String(s.label).toLowerCase()], asOf }));
  }
  if (alloc?.total) {
    F.push(fact('alloc.total', 'allocation',
      `Across equities, deposits, bonds and crypto, the total is ${money(alloc.total)}.`,
      { tags: ['net worth', 'total', 'everything', 'allocation'], asOf }));
  }
  if (conc?.top1) {
    F.push(fact('conc', 'concentration',
      `Your top holding is ${pc(conc.top1)} of the book, the top three are ${pc(conc.top3)}, and the spread is equivalent to ${n1(conc.effectiveN)} equally sized positions.`,
      { tags: ['concentration', 'diversified', 'spread', 'largest', 'top'], asOf }));
  }

  // --- performance, stamped with the series, never with now
  if (stats) {
    const win = stats.from && stats.to ? ` between ${stats.from} and ${stats.to}` : '';
    if (Number.isFinite(stats.cumulative)) {
      F.push(fact('perf.cum', 'performance',
        `The portfolio returned ${pc(stats.cumulative)}${win}.`,
        { tags: ['return', 'performance', 'made', 'gain'], asOf: seriesAsOf }));
    }
    if (Number.isFinite(stats.xirr)) {
      F.push(fact('perf.xirr', 'performance',
        `Your money-weighted return (XIRR) is ${pc(stats.xirr)}${win}.`,
        { tags: ['xirr', 'annualised', 'return', 'performance'], asOf: seriesAsOf }));
    }
    if (Number.isFinite(stats.benchXirr)) {
      F.push(fact('perf.bench', 'performance',
        `Over the same window the benchmark returned ${pc(stats.benchXirr)} on the same basis.`,
        { tags: ['benchmark', 'index', 'versus', 'beating'], asOf: seriesAsOf }));
    }
    if (Number.isFinite(stats.volatility)) {
      F.push(fact('perf.vol', 'risk',
        `Annualised volatility is ${pc(stats.volatility)}.`,
        { tags: ['volatility', 'risk', 'swing'], asOf: seriesAsOf }));
    }
    if (Number.isFinite(stats.sharpe)) {
      F.push(fact('perf.sharpe', 'risk', `The Sharpe ratio is ${n2(stats.sharpe)}.`,
        { tags: ['sharpe', 'risk', 'efficiency'], asOf: seriesAsOf }));
    }
  }
  if (drawdownInfo && Number.isFinite(drawdownInfo.maxDD)) {
    F.push(fact('perf.dd', 'risk',
      `The worst peak-to-trough fall was ${pc(drawdownInfo.maxDD)}, and the current drawdown is ${pc(drawdownInfo.currentDD)}.`,
      { tags: ['drawdown', 'fall', 'lost', 'worst', 'risk'], asOf: seriesAsOf }));
  }
  if (profile?.risk) {
    F.push(fact('risk.band', 'risk',
      `Your risk index scores ${n1(profile.risk.score)} out of 100, which is the "${profile.risk.band}" band.`,
      { tags: ['risk', 'risky', 'index', 'score', 'band'], asOf: seriesAsOf }));
  }
  if (profile?.health) {
    F.push(fact('risk.health', 'risk',
      `Portfolio health scores ${n1(profile.health.score)} out of 100, grade ${profile.health.grade}.`,
      { tags: ['health', 'grade', 'score'], asOf: seriesAsOf }));
  }

  // --- income
  if (income) {
    F.push(fact('inc.annual', 'dividends',
      `Declared dividends over the next twelve months come to ${money(income.annual)}, averaging ${money(income.averageMonthly)} a month.`,
      { tags: ['dividend', 'income', 'payout', 'earning', 'monthly'], asOf }));
    if (income.peak?.label) {
      F.push(fact('inc.peak', 'dividends',
        `${income.peak.label} is your biggest dividend month at ${money(income.peak.value)}, and ${income.lean?.label || 'the leanest month'} is the thinnest.`,
        { tags: ['dividend', 'month', 'biggest', 'peak'], asOf }));
    }
    if (Number.isFinite(income.declaredShare)) {
      F.push(fact('inc.declared', 'dividends',
        `${pc(income.declaredShare)} of that figure is from dividends that have actually been declared; the rest is estimated from past payments.`,
        { tags: ['declared', 'estimated', 'dividend', 'confidence'], asOf }));
    }
  }
  if (yieldInfo) {
    F.push(fact('inc.yield', 'dividends',
      `The book yields ${pc(yieldInfo.onValue)} on today's value and ${pc(yieldInfo.onCost)} on what you paid.`,
      { tags: ['yield', 'dividend', 'income', 'cost'], asOf }));
  }

  // --- tax
  if (taxInfo?.position) {
    const p = taxInfo.position;
    F.push(fact('tax.total', 'tax',
      `On realised gains this financial year the arithmetic comes to ${money(p.total)} including cess${taxInfo.fyLabel ? ` for ${taxInfo.fyLabel}` : ''}.`,
      { tags: ['tax', 'owe', 'liability', 'gains'], asOf }));
    if (Number.isFinite(p.exemptionLeft)) {
      F.push(fact('tax.exempt', 'tax',
        `${money(p.exemptionLeft)} of the long-term exemption is still unused.`,
        { tags: ['exemption', 'tax', 'ltcg', 'harvest'], asOf }));
    }
  }

  // --- cash
  if (cash?.avgs) {
    const a = cash.avgs;
    F.push(fact('cash.avg', 'cash',
      `Across ${a.months} complete months you took in ${money(a.income)} and spent ${money(a.spend)} a month on average, saving ${pc(a.savingsRate)}.`,
      { tags: ['spend', 'expense', 'income', 'savings', 'rate', 'monthly'], asOf }));
  }
  if (cash?.fixed && Number.isFinite(cash.fixed.fixedPct)) {
    F.push(fact('cash.fixed', 'cash',
      `${pc(cash.fixed.fixedPct)} of this month's spending is on fixed commitments rather than discretionary.`,
      { tags: ['fixed', 'variable', 'spend', 'expense', 'commitment'], asOf }));
  }

  // --- plan
  if (plan) {
    F.push(fact('plan.goal', 'plan',
      `Against your target of ${money(plan.target)} you are at ${money(plan.now)}, which is ${pc(plan.pct)} of the way there${Number.isFinite(plan.horizon) ? `, and the projection reaches it in ${n1(plan.horizon)} years` : ''}.`,
      { tags: ['goal', 'fire', 'retire', 'target', 'plan', 'progress'], asOf }));
    if (plan.shortfall > 0) {
      F.push(fact('plan.short', 'plan',
        `On current contributions the projection falls short by ${money(plan.shortfall)}.`,
        { tags: ['shortfall', 'behind', 'goal', 'plan'], asOf }));
    }
  }

  // --- factors
  if (tilt?.readable) {
    F.push(fact('factor.tilt', 'factors',
      `On the factors that could be measured, the book leans ${tilt.readable}.`,
      { tags: ['factor', 'tilt', 'style', 'quality', 'value', 'momentum'], asOf: factorAsOf }));
  }

  return F;
}
