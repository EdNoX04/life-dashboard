import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Card, Empty } from '../ui.jsx';
import { memGet } from '../../lib/advisor.js';
import { aiChat, pickProvider, providerLabel } from '../../lib/ai.js';
import { getConfig } from '../../lib/db.js';
import {
  buildIndex, retrieve, classify, quoteAnswer, buildPrompt, estimateTokens,
  auditNumbers, composeContext, SYSTEM, FLOOR,
} from '../../lib/finboy.js';
import { allocationBreakdown, concentration, loadAssetMeta, loadFixedIncome, metaOf } from '../../lib/assets.js';
import { analyse } from '../../lib/analytics.js';
import { riskProfile } from '../../lib/risk.js';
import { portfolioTilt, tiltSummary } from '../../lib/factors.js';
import { calendarForYear, incomeSummary, perHolding, bookYield } from '../../lib/dividends.js';
import { DEFAULT_RATES, fyBounds, realised, taxPosition } from '../../lib/tax.js';
import {
  monthlySeries, averages, fixedSplit, inMonth, thisMonthKey, normaliseTxn,
  totals as cashTotals, peopleBalances, ledgerSummary,
} from '../../lib/expenses.js';
import { xrayFromBook } from '../../lib/xray.js';
import { loadAccounts, accountSummary } from '../../lib/accounts.js';
import { EMPTY_GOALS, goalProgress, projectAll, DEFAULT_PLAN } from '../../lib/plan.js';

// LEDGER — the money-scoped assistant (spec item 8), screen half.
//
// finboy.js decides what may be said. This file decides what the reader SEES,
// and a chat window has a specific way of undoing a careful library: everything
// in it looks like an answer. A refusal styled as a grey error line, a citation
// hidden behind a chevron, a fabricated figure noted in the console — each of
// those turns a guarded system back into a confident one. So six decisions live
// here rather than in the library:
//
//   1. A refusal is an ANSWER, drawn at full weight in the tape, with its reason.
//      Not a toast, not a red line that scrolls away. If it declined to answer,
//      that is the most important thing on the screen and it must survive being
//      scrolled back to.
//   2. The facts an answer was drawn from are shown WITH it, always, stamped —
//      never behind a "sources" toggle. A citation you have to ask for is a
//      citation nobody reads, and the whole point here is that a sentence about
//      your money can be checked against the figure it came from.
//   3. An unverified figure is a banner ON the answer naming the number, not a
//      log entry. auditNumbers is the only guardrail that works when the model
//      ignores its instructions, so its output cannot be the quiet one.
//   4. The cost is shown BEFORE the press, next to the button. After is a receipt;
//      before is a decision.
//   5. Nothing is ever sent automatically. No send-on-enter-while-typing, no
//      retry, no follow-up call. Every network round-trip is one deliberate press.
//   6. The tape is not saved. An answer is only as true as the data was at the
//      moment it was drawn; a stored transcript is a pile of undated claims about
//      your money, which is the exact thing the whole feature exists to prevent.

const SUGGESTIONS = [
  'What is my portfolio worth?',
  'How much tax do I owe this year?',
  'Am I beating the index?',
  'How much do I spend each month?',
  'How concentrated is my book?',
];

// ---------------------------------------------------------------------------
// Decision 2: the facts, with their stamps, attached to whatever they produced.
export function Cites({ hits = [] }) {
  if (!hits.length) return null;
  return (
    <div className="fb-cites">
      <div className="fb-cites-h">Drawn from {hits.length} saved {hits.length === 1 ? 'figure' : 'figures'}:</div>
      {hits.map(f => (
        <div className="fb-cite" key={f.id}>
          <span className="fb-cite-t">{f.topic}</span>
          <span className="fb-cite-x">{f.text}</span>
          <span className={`fb-cite-at${f.asOfKnown ? '' : ' fb-cite-unknown'}`}>
            {f.asOfKnown ? new Date(f.asOf).toISOString().slice(0, 10) : 'age unknown'}
          </span>
        </div>
      ))}
    </div>
  );
}

// Decision 1: a refusal is drawn at answer weight, and each kind says a different
// thing, because "I will not" and "I cannot" are different facts about your data.
export function Refusal({ kind, why, hits }) {
  const head = kind === 'advice' ? 'THIS ONE IS YOURS TO DECIDE'
    : kind === 'offtopic' ? 'NOT A MONEY QUESTION'
      : 'NOTHING IN YOUR DATA MATCHES THAT';
  return (
    <div className={`fb-a fb-refuse fb-refuse-${kind}`}>
      <div className="fb-refuse-k">{head}</div>
      <div className="fb-why">{why}</div>
      {/* An advice question is still a question about real figures. Refusing to
          recommend is not a reason to withhold what the data says. */}
      {kind === 'advice' && <Cites hits={hits} />}
      {kind === 'nomatch' && (
        <div className="fb-fix">
          Try naming the thing you mean — a ticker, "tax", "dividends", "spending",
          "goal". LEDGER only knows what the other screens have already worked out,
          so if a screen is empty this is empty too.
        </div>
      )}
    </div>
  );
}

// Decision 6 of the library: the no-key path is a real answer, not a degraded one.
export function QuoteCard({ quoted, hits }) {
  if (!quoted) return null;
  return (
    <div className="fb-a fb-quote">
      <div className="fb-lead">{quoted.lead}</div>
      <div className="fb-rows">
        {quoted.rows.map((r, i) => (
          <div className="fb-row" key={i}>
            <span className="fb-row-t">{r.topic}</span>
            <span className="fb-row-x">{r.text}</span>
            <span className={`fb-row-at${r.asOf ? '' : ' fb-cite-unknown'}`}>{r.asOf || 'age unknown'}</span>
          </div>
        ))}
      </div>
      <div className="fb-tail">{quoted.tail}</div>
      {/* No <Cites> here: the rows ARE the facts. Printing them twice would imply
          the answer was derived from something, and it was not — it is the data. */}
      <span className="fb-hits-count" hidden>{hits?.length || 0}</span>
    </div>
  );
}

// Decision 3: the audit banner is on the answer, above the answer, naming the
// figure. A model that invents a number writes a paragraph that reads perfectly,
// so the warning cannot be subtler than the thing it is warning about.
export function AnswerCard({ text, provider, audit, hits }) {
  return (
    <div className="fb-a">
      {audit && !audit.clean && (
        <div className="fb-warn">
          <span className="fb-warn-k">UNVERIFIED FIGURE</span>
          <span className="fb-warn-x">
            {audit.unsupported.length === 1 ? 'This number is' : 'These numbers are'}{' '}
            <b>{audit.unsupported.join(', ')}</b> — {audit.unsupported.length === 1 ? 'it is' : 'they are'} not
            in any of your saved figures below. Treat {audit.unsupported.length === 1 ? 'it' : 'them'} as
            made up until you have checked{' '}
            {audit.unsupported.length === 1 ? 'it' : 'them'} on the screen it came from.
          </span>
        </div>
      )}
      <div className="fb-text">{text}</div>
      <div className="fb-foot">
        <span className={`fb-verd${audit?.verified ? ' ok' : ''}`}>
          {audit?.verified
            ? `${audit.checked} ${audit.checked === 1 ? 'figure' : 'figures'} checked against your data`
            : audit?.checked
              ? `${audit.unsupported.length} of ${audit.checked} figures not found in your data`
              : 'no figures in this answer to check'}
        </span>
        {provider && <span className="fb-prov">{provider}</span>}
      </div>
      <Cites hits={hits} />
    </div>
  );
}

export function Turn({ turn }) {
  return (
    <div className="fb-turn">
      <div className="fb-q">{turn.q}</div>
      {turn.kind === 'refusal' && <Refusal kind={turn.refusal} why={turn.why} hits={turn.hits} />}
      {turn.kind === 'quote' && <QuoteCard quoted={turn.quoted} hits={turn.hits} />}
      {turn.kind === 'answer' && (
        <AnswerCard text={turn.text} provider={turn.provider} audit={turn.audit} hits={turn.hits} />
      )}
      {turn.kind === 'error' && (
        <div className="fb-a fb-err">
          <div className="fb-refuse-k">THAT DID NOT GO THROUGH</div>
          <div className="fb-why">{turn.why}</div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
export default function LEDGER({
  held = [], priceOf = h => Number(h.last_price ?? h.avg_cost ?? 0), orders = [],
  series = [], benchmark = [], flowsByDay = {}, currentValue = null, crypto = [],
  cur = '$', fx = null,
}) {
  const [blobs, setBlobs] = useState(null);
  const [q, setQ] = useState('');
  const [tape, setTape] = useState([]);          // decision 6: memory only, never written
  const [busy, setBusy] = useState(false);
  const provider = useMemo(() => { try { return pickProvider(); } catch { return null; } }, [tape.length]);
  const box = useRef(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [meta, fi, div, rates, exp, goals, fund, acct] = await Promise.all([
        loadAssetMeta().catch(() => ({})),
        loadFixedIncome().catch(() => null),
        memGet('div_meta').catch(() => null),
        memGet('tax_rates').catch(() => null),
        memGet('expenses').catch(() => null),
        memGet('goals_money').catch(() => null),
        memGet('fundamentals').catch(() => null),
        loadAccounts().catch(() => null),
      ]);
      if (alive) setBlobs({ meta: meta || {}, fi, div, rates, exp, goals, fund: fund || {}, acct });
    })();
    return () => { alive = false; };
  }, []);

  // The index is built from the same saved blobs every other screen reads, and
  // each part is stamped with the age of ITS source rather than with now — the
  // library refuses to quote an unstamped fact as current, and that refusal is
  // only worth anything if the stamps here are honest.
  const index = useMemo(() => {
    if (!blobs) return [];
    const b = blobs;
    const now = new Date();
    const value = held.reduce((s, h) => s + Number(h.qty || 0) * priceOf(h), 0);

    const alloc = allocationBreakdown({ held, priceOf, saved: b.meta, fi: b.fi || undefined, crypto });
    const conc = held.length ? concentration(held, priceOf) : null;

    const stats = series.length > 1
      ? analyse({ series, benchmark, orders, flowsByDay, currentValue: currentValue ?? value })
      : null;
    const seriesAsOf = stats?.to ? new Date(stats.to + 'T00:00:00Z') : undefined;

    const fRows = held.map(h => {
      const t = String(h.ticker || '').toUpperCase();
      const hit = b.fund[t];
      return { ticker: t, name: h.name, value: Number(h.qty || 0) * priceOf(h),
        meta: metaOf(h, b.meta), metric: hit?.metric || null, at: hit?.at || null };
    }).filter(r => r.value > 0);
    const fStamps = fRows.map(r => r.at).filter(Boolean);
    const tilt = fRows.some(r => r.metric) ? tiltSummary(portfolioTilt(fRows)) : null;

    const dmeta = (b.div && (b.div.rows || b.div)) || {};
    const sharesOf = h => Number(h.qty ?? h.shares ?? 0);
    const payments = calendarForYear(held, dmeta, now.getFullYear(), { sharesOf });
    const dLines = perHolding(held, dmeta, { sharesOf, priceOf, costOf: h => Number(h.avg_cost || 0), year: now.getFullYear() });

    const fy = fyBounds(now);
    const rates = { ...DEFAULT_RATES, ...(b.rates || {}) };
    const foreign = {};
    for (const h of held) if (h?.ticker) foreign[h.ticker] = metaOf(h, b.meta).market === 'US';
    const r = orders.length ? realised({ orders, fy, foreignOf: t => !!foreign[t], rates }) : null;

    const txns = Array.isArray(b.exp?.txns) ? b.exp.txns.map(normaliseTxn) : [];
    const goals = b.goals || EMPTY_GOALS;
    const goal = goals?.rows?.[0] || goals?.goal || null;
    const rows = goal ? projectAll({ ...DEFAULT_PLAN, ...(goals.plan || {}), start: value }) : [];

    return buildIndex({
      held, priceOf, cur, alloc, conc, stats,
      drawdownInfo: stats?.drawdown || null,
      profile: (stats || alloc?.total) ? riskProfile({ stats: stats || {}, conc, alloc }) : null,
      income: payments.length ? incomeSummary(payments) : null,
      yieldInfo: dLines.length ? bookYield(dLines) : null,
      taxInfo: r ? { position: taxPosition(r, rates), fyLabel: `FY ${new Date(fy.from).getFullYear()}` } : null,
      cash: txns.length ? { avgs: averages(monthlySeries(txns)), fixed: fixedSplit(inMonth(txns, thisMonthKey(now))) } : null,
      plan: goal ? goalProgress(goal, { value, rows }) : null,
      tilt,
      // Everything built after this file was. Each of these was a question it
      // used to answer confidently from a book it could not see all of.
      xray: xrayFromBook(held, { priceOf, fx }),
      accounts: b.acct
        ? accountSummary(
          held.map(h => ({
            ticker: h.ticker,
            marketValue: Number(h.qty || 0) * priceOf(h),
            invested: Number(h.avg_cost) > 0 ? Number(h.qty || 0) * Number(h.avg_cost) : null,
          })),
          b.acct.map || {}, b.acct.accounts || [],
        )
        : null,
      ledger: txns.length
        ? (() => {
          const balances = peopleBalances(txns, b.exp?.people || []);
          return { balances, ...ledgerSummary(balances) };
        })()
        : null,
      cashFlows: txns.length ? cashTotals(txns) : null,
      asOf: now, seriesAsOf, factorAsOf: fStamps.length ? new Date(Math.min(...fStamps)) : undefined,
    });
  }, [blobs, held, series, orders, crypto, cur, fx]);

  // Decision 4: what a press would cost, worked out before the press exists.
  const preview = useMemo(() => {
    const text = q.trim();
    if (!text || !index.length) return null;
    const intent = classify(text);
    if (intent.kind !== 'money') return { intent, send: false };
    const hit = retrieve(index, text);
    if (!hit.enough) return { intent, hit, send: false };
    return { intent, hit, send: !!provider, tokens: estimateTokens(text, hit.hits) };
  }, [q, index, provider]);

  const push = t => setTape(prev => [...prev, t]);

  const ask = async () => {
    const text = q.trim();
    if (!text || busy) return;

    // Decision 5 of the library: intent is settled here, offline, before anything
    // could possibly leave the machine.
    const intent = classify(text);
    if (intent.kind === 'empty') return;

    if (intent.kind === 'offtopic') {
      setQ('');
      return push({ q: text, kind: 'refusal', refusal: 'offtopic', why: intent.why, hits: [] });
    }

    const hit = retrieve(index, text);

    // Decision 1 of the library: nothing matched is a refusal, not a smaller
    // prompt. No model is called.
    if (!hit.enough) {
      setQ('');
      return push({ q: text, kind: 'refusal', refusal: 'nomatch', hits: [],
        why: `Nothing in your saved figures scored above the matching floor (best was ${hit.best.toFixed(2)}, the floor is ${FLOOR}). Rather than hand an unrelated set of numbers to a model and let it improvise, LEDGER stops here.` });
    }

    if (intent.kind === 'advice') {
      setQ('');
      return push({ q: text, kind: 'refusal', refusal: 'advice', why: intent.why, hits: hit.hits });
    }

    // Decision 6 of the library: no key is a working state, not a broken one.
    if (!provider) {
      setQ('');
      return push({ q: text, kind: 'quote', quoted: quoteAnswer(hit.hits), hits: hit.hits });
    }

    setBusy(true);
    setQ('');
    const context = composeContext(hit.hits);
    try {
      const { text: answer, provider: used, citations } = await aiChat(
        [{ role: 'user', content: buildPrompt(text, hit.hits) }],
        // Tagged explicitly rather than leaning on the server's fail-closed
        // default. A backstop you rely on is a decision you have not made.
        { system: SYSTEM, agent: 'money', model: getConfig().finboyModel || '', web: getConfig().finboyWeb ? 2 : 0 });
      // Decision 3: audited before it is displayed, every time, no opt-out.
      // A figure fetched from the web is legitimately absent from the retrieved
      // context, so auditing against context alone would flag every web-sourced
      // number as fabricated — and a warning that fires on correct answers stops
      // being read, which is the same as not having it. The pool widens by the
      // CITED TEXT only: what the model actually quoted, not the whole page and
      // not the model's summary of it.
      const pool = citations?.length
        ? context + '\n' + citations.map(c => c.text).join('\n')
        : context;
      push({ q: text, kind: 'answer', text: answer, provider: providerLabel(used) || used,
        audit: auditNumbers(answer, pool), hits: hit.hits, citations: citations || [] });
    } catch (e) {
      push({ q: text, kind: 'error', why: e?.message || String(e) });
    }
    setBusy(false);
  };

  const label = providerLabel(provider);

  return (
    <div className="fb-wrap">
      <Card title="FINBOY" color="var(--pink)" right={
        <span className="fb-prov-tag">{label ? `via ${label}` : 'no key — quoting mode'}</span>
      }>
        <div className="small muted">
          LEDGER answers only from figures the other screens have already worked out, and every
          answer arrives with those figures attached and dated. Any number in a reply that is
          not in them gets flagged on the reply itself — a wrong figure in a sentence reads
          exactly like a right one, which is the one failure this screen has that no chart does.
          It reports; it will not tell you what to buy or sell.
        </div>

        {!blobs && <div className="small muted mt">Reading your saved figures…</div>}
        {blobs && !index.length && (
          <div className="mt"><Empty icon="🤖" text="There is nothing saved to answer from yet. Add holdings, expenses or a goal first." /></div>
        )}

        {blobs && !!index.length && (
          <>
            <div className="fb-tape" ref={box}>
              {!tape.length && (
                <div className="fb-empty">
                  <div className="fb-empty-h">{index.length} figures loaded. Ask about any of them.</div>
                  <div className="fb-sugg">
                    {SUGGESTIONS.map(s => (
                      <button key={s} className="fb-sugg-b" onClick={() => setQ(s)}>{s}</button>
                    ))}
                  </div>
                </div>
              )}
              {tape.map((t, i) => <Turn key={i} turn={t} />)}
              {busy && <div className="fb-busy">reading your figures…</div>}
            </div>

            <div className="fb-ask">
              <input
                className="fb-in" value={q} placeholder="ask about your money…"
                onChange={e => setQ(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); } }}
              />
              <button className="btn btn-sm btn-pink" onClick={ask} disabled={busy || !q.trim()}>
                {busy ? '…' : 'ASK'}
              </button>
            </div>

            {/* Decision 4: before the press, not after it. */}
            <div className="fb-cost">
              {!preview && 'Nothing typed yet.'}
              {preview?.intent?.kind === 'offtopic' && 'That does not look like a money question — it will be answered here without going anywhere.'}
              {preview?.intent?.kind === 'advice' && 'That is asking what to do. LEDGER will show the figures and decline the call — nothing will be sent.'}
              {preview?.intent?.kind === 'money' && preview.hit && !preview.hit.enough
                && `Nothing saved matches that yet (best score ${preview.hit.best.toFixed(2)} against a floor of ${FLOOR}) — nothing will be sent.`}
              {preview?.send && `${preview.hit.hits.length} figures will be sent, roughly ${preview.tokens} tokens — a fraction of a cent on ${label}.`}
              {preview?.intent?.kind === 'money' && preview.hit?.enough && !provider
                && `${preview.hit.hits.length} figures match. With no key set, they will be quoted straight back rather than summarised — nothing leaves this device.`}
            </div>
          </>
        )}
      </Card>

      <div className="ai-note">
        LEDGER is not a licensed adviser and nothing it says is investment or tax advice. It
        describes figures you already have. Nothing you ask here is saved — close the tab and
        the conversation is gone, because an answer is only as true as the data was when it
        was drawn.
      </div>
    </div>
  );
}
