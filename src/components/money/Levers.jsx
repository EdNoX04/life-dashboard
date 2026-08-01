import React, { useEffect, useMemo, useState } from 'react';
import { Card, Empty } from '../ui.jsx';
import { memGet } from '../../lib/advisor.js';
import { DEFAULT_PLAN } from '../../lib/plan.js';
import { analyse, assumptionsOf, RUNGS } from '../../lib/levers.js';

// Levers — the screen for "what would make it sooner".
//
// The library made eight decisions; this file is the four that only a screen can
// make, and all four are about what the eye does before the reader has read
// anything.
//
// A. THE TWO KINDS ARE NOT TWO SECTIONS OF ONE TABLE, THEY ARE TWO CARDS WITH
//    DIFFERENT FRAMES.
//
//    Decision 1 of the library is structural — separate arrays, never sorted
//    across. That protection dies the moment the screen renders them as
//    "Controls" and "Assumptions" headings inside one bordered box, because a
//    single frame reads as a single list and the eye compares the biggest number
//    in the top half to the biggest number in the bottom half. So they are
//    separate cards, the assumptions card is dashed rather than solid, its rungs
//    are drawn in --ink-3 rather than in the lever colour, and its title says
//    what it is for: how much of the answer is guess.
//
// B. THE ASSUMPTIONS PRINT ABOVE THE DATE, NOT UNDER IT.
//
//    `assumptionsOf` exists so that a year cannot be rendered without the
//    numbers that produced it. Under the date it becomes a footnote, and a
//    footnote to a big glowing year is decoration. Above it, the year reads as
//    the consequence of a list the reader can see is theirs — which is what it
//    is. This costs a little drama at the top of the screen and it is the whole
//    difference between arithmetic and a prediction.
//
// C. THE BAR IS SCALED WITHIN A LEVER, NEVER ACROSS THE SCREEN.
//
//    A bar that shares a scale between the contribution ladder and the growth
//    ladder is a ranking drawn in pixels, and it would reintroduce across-kind
//    comparison after the library went to some trouble to prevent it. Each
//    ladder's bar is a fraction of that ladder's own largest rung, so it shows
//    curvature — the thing decision 6 wants shown — and nothing else. The number
//    of months is printed beside it in every case, because that is the figure
//    that survives being wrong about the bar.
//
// D. WHEN THE BASELINE NEVER CROSSES, THE LADDERS DO NOT LEAD.
//
//    In that state a table of "—" reads as "nothing helps", which is false. The
//    baseline note goes first, in the warning colour, and the only rungs drawn in
//    a live colour are the ones that bring the crossing inside the horizon.
//    Everything else stays on screen, dimmed, because decision 7 says a lever
//    that does nothing is a finding.
//
// Not on this screen, deliberately: a "best lever" callout, a sort control that
// could merge the two lists, and any control that edits the plan. Editing lives
// in the Planner, which is where the numbers are entered and where they are
// persisted; a second place to type them is a second source of truth.

const PLAN_KEY = 'money_plan';

const compact = (n, cur = '₹') => {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const v = Number(n); const s = v < 0 ? '-' : ''; const a = Math.abs(v);
  const f = (x, u) => s + cur + (x >= 100 ? Math.round(x) : x.toFixed(x >= 10 ? 1 : 2)) + u;
  if (cur === '₹') {
    if (a >= 1e7) return f(a / 1e7, ' Cr');
    if (a >= 1e5) return f(a / 1e5, ' L');
    if (a >= 1e3) return f(a / 1e3, 'K');
  } else {
    if (a >= 1e9) return f(a / 1e9, 'B');
    if (a >= 1e6) return f(a / 1e6, 'M');
    if (a >= 1e3) return f(a / 1e3, 'K');
  }
  return s + cur + a.toFixed(a < 10 ? 2 : 0);
};

// Months, spoken. "21 months" is arithmetic; "1 yr 9 mo" is the sentence a
// person would say, and this screen is read in sentences.
export function months(m) {
  if (m == null) return '—';
  const v = Math.round(m);
  if (v === 0) return 'no change';
  const sign = v < 0 ? '−' : '+';
  const a = Math.abs(v);
  if (a < 12) return `${sign}${a} mo`;
  const y = Math.floor(a / 12); const r = a % 12;
  return `${sign}${y} yr${r ? ` ${r} mo` : ''}`;
}

// ---- the assumptions rail (decision B) -----------------------------------
export function Assumptions({ pairs = [] }) {
  if (!pairs.length) return null;
  return (
    <div className="lv-assume">
      <div className="lv-assume-k">ON THESE NUMBERS</div>
      <div className="lv-assume-grid">
        {pairs.map(p => (
          <div className="lv-assume-cell" key={p.label}>
            <span className="lv-assume-l">{p.label}</span>
            <span className="lv-assume-v">{p.value}</span>
            {p.note && <span className="lv-assume-n">{p.note}</span>}
          </div>
        ))}
      </div>
      <div className="lv-assume-foot">
        Every date below is a consequence of exactly these. Change one in the Plan
        screen and the whole board moves — which is the point of the screen, not a
        flaw in it.
      </div>
    </div>
  );
}

// ---- the headline --------------------------------------------------------
export function Baseline({ base, cur = '₹', note = null, realTerms = '' }) {
  const ok = base?.reachable;
  return (
    <div className={`lv-base${ok ? '' : ' lv-base-no'}`}>
      <div className="lv-base-row">
        <div className="lv-base-k">AS IT STANDS</div>
        <div className="lv-base-big">
          {ok ? base.calYear : 'not inside the horizon'}
        </div>
        {ok && <div className="lv-base-sub">in {base.years} year{base.years === 1 ? '' : 's'}</div>}
      </div>
      <div className="lv-base-line">
        Target {compact(base?.target, cur)} · {realTerms}
      </div>
      {!ok && base?.shortfall != null && (
        <div className="lv-base-line">
          Ends {compact(base.endReal, cur)} in today's money, short by {compact(base.shortfall, cur)}.
        </div>
      )}
      {note && <div className="lv-base-note">{note}</div>}
    </div>
  );
}

// ---- one ladder ----------------------------------------------------------
export function Ladder({ lever, cur = '₹', dim = false }) {
  if (!lever) return null;
  const steps = lever.steps || [];
  // Decision C: the scale is this ladder's own biggest rung.
  const top = Math.max(1, ...steps.map(s => Math.abs(s.movedMonths ?? 0)));
  const sign = lever.dir < 0 ? '−' : '+';
  const money = lever.unit.startsWith('₹');
  const amt = a => (money ? `${sign}${cur}${Math.round(a / (lever.perMonth ? 12 : 1)).toLocaleString('en-IN')}` : `${sign}${a}`);
  const val = s => (money
    ? `${cur}${Math.round(s.shown).toLocaleString('en-IN')}`
    : `${Number(s.shown).toFixed(Number(s.shown) % 1 ? 1 : 0)}%`);

  return (
    <div className={`lv-lad${dim ? ' lv-lad-dim' : ''}${lever.flat ? ' lv-lad-flat' : ''}`}>
      <div className="lv-lad-head">
        <span className="lv-lad-name">{lever.label}</span>
        <span className="lv-lad-unit">per {lever.step}{lever.unit.startsWith('₹') ? '' : ' '}{lever.unit}</span>
      </div>
      <div className="lv-lad-note">{lever.note}</div>

      {lever.flat && (
        <div className="lv-lad-nil">
          Nothing at this size moves the date. That is a fact about the plan, not a
          missing row — the other numbers are large enough to swallow it.
        </div>
      )}

      <div className="lv-lad-rows">
        {steps.map(s => {
          const m = s.movedMonths ?? 0;
          const w = Math.round((Math.abs(m) / top) * 100);
          const live = s.becomesReachable || m > 0;
          return (
            <div className={`lv-rung${s.becomesReachable ? ' lv-rung-open' : ''}${live ? '' : ' lv-rung-nil'}`} key={s.rungs}>
              <span className="lv-rung-amt">{amt(s.amount)}</span>
              <span className="lv-rung-to">→ {val(s)}{s.clamped ? ' (floor)' : ''}</span>
              <span className="lv-rung-bar" aria-hidden="true">
                <i style={{ width: `${w}%` }} />
              </span>
              <span className="lv-rung-m">{months(s.movedMonths)}</span>
              <span className="lv-rung-y">
                {s.becomesReachable
                  ? `reaches it — ${s.calYear}`
                  : (s.calYear ? s.calYear : 'still not inside the horizon')}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- main ----------------------------------------------------------------
export default function Levers({ currentValue = 0, cur = '₹', onEditPlan = null }) {
  const [plan, setPlan] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let dead = false;
    (async () => {
      const p = await memGet(PLAN_KEY);
      if (dead) return;
      setPlan(p && typeof p === 'object' ? { ...DEFAULT_PLAN, ...p } : { ...DEFAULT_PLAN });
      setLoaded(true);
    })();
    return () => { dead = true; };
  }, []);

  // Same resolution as the Planner, and for the same reason: a null start means
  // "use the live book". If this screen resolved it differently the two would
  // print different dates for one plan, which is the failure mode decision 3 of
  // the library exists to prevent — the same failure, one level up.
  const effective = useMemo(() => {
    if (!plan) return null;
    const start = plan.startValue == null ? Number(currentValue) || 0 : Number(plan.startValue);
    return { ...plan, startValue: start };
  }, [plan, currentValue]);

  const res = useMemo(() => (effective ? analyse(effective, { rungs: RUNGS }) : null), [effective]);
  const pairs = useMemo(() => (effective ? assumptionsOf(effective, cur) : []), [effective, cur]);

  if (!loaded) return <Card title="LEVERS" color="green"><Empty icon="⏳" text="Reading the plan…" /></Card>;
  if (!res) return <Card title="LEVERS" color="green"><Empty icon="◇" text="No plan saved yet — set one up in the Plan screen." /></Card>;

  const noTarget = res.base?.target == null;

  return (
    <div className="lv-wrap">
      <Card
        title="LEVERS"
        color="green"
        right={onEditPlan ? <button className="btn btn-sm btn-cyan" onClick={onEditPlan}>edit plan →</button> : null}
      >
        <div className="lv-intro">
          What each change is worth, measured by re-running the same projection the
          Plan screen runs. Nothing here is a recommendation: the ladders say what
          an amount buys, and which amount is worth buying is not an arithmetic
          question.
        </div>

        {noTarget ? (
          <Empty icon="◇" text={res.base.why} />
        ) : (
          <>
            {/* Decision B — the inputs come before the answer. */}
            <Assumptions pairs={pairs} />
            <Baseline base={res.base} cur={cur} note={res.baselineNote} realTerms={res.realTerms} />
          </>
        )}
      </Card>

      {!noTarget && (
        <>
          {/* Decision A — separate card, solid frame, lever colour. */}
          <Card title="WHAT YOU CONTROL" color="cyan">
            <div className="lv-sec-note">
              Three numbers you can actually change. Each ladder holds everything
              else still, so the rungs are not additive — two changes together are
              not the sum of their rows.
            </div>
            {res.controls.map(l => <Ladder key={l.id} lever={l} cur={cur} />)}
          </Card>

          {/* Decision A — dashed frame, dimmed, and a title that says what it is. */}
          <Card title="WHAT YOU ASSUMED" color="purple" className="lv-card-assume">
            <div className="lv-sec-note">
              These are not levers. They are the guesses the whole projection rests
              on, and the size of the movement below is a measure of how much of
              the date is guesswork rather than saving. Nobody can decide to get a
              better return.
            </div>
            {res.assumptions.map(l => <Ladder key={l.id} lever={l} cur={cur} dim />)}
          </Card>
        </>
      )}
    </div>
  );
}
