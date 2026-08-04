import { useState, useMemo } from 'react';
import { Card, Empty } from '../ui.jsx';
import {
  LISTS, MEMBERS, buildList, sortList, listSummary, gaps, sectorMix, snapshotAge,
} from '../../lib/divlists.js';

// The curated dividend lists — Kings, Aristocrats, Achievers, high yield.
//
// The whole screen is built around one refusal: it will not pretend the streak
// column is live. Every number derived from the snapshot carries its date, the
// staleness banner is unconditional once the snapshot is a year old, and the
// streak is written "63 yrs (2025)" rather than "63 yrs" so there is nowhere
// for the age to hide. See src/lib/divlists.js for the reasoning.

const pct = v => (v == null ? '—' : `${v.toFixed(2)}%`);

function Bar({ mix }) {
  if (!mix.length) return null;
  const COLORS = ['var(--green)', 'var(--cyan)', 'var(--orange)', 'var(--purple)',
    'var(--yellow)', 'var(--pink)', 'var(--s4)', 'var(--s5)', 'var(--s6)'];
  return (
    <div className="dvl-mix" title="Sector spread of this list">
      <div className="dvl-mixbar">
        {mix.map((m, i) => (
          <span key={m.sector} style={{ width: `${m.pct}%`, background: COLORS[i % COLORS.length] }}
            title={`${m.sector} · ${m.n}`} />
        ))}
      </div>
      <div className="dvl-mixkey small">
        {mix.slice(0, 5).map((m, i) => (
          <span key={m.sector}>
            <i style={{ background: COLORS[i % COLORS.length] }} />{m.sector} {m.n}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function DivLists({ held = [], quotes = {} }) {
  const [key, setKey] = useState('kings');
  const [mineOnly, setMineOnly] = useState(false);

  const list = LISTS.find(l => l.key === key) || LISTS[0];
  const age = useMemo(() => snapshotAge(new Date()), []);

  const rows = useMemo(
    () => sortList(buildList(key, { quotes, holdings: held }), key),
    [key, quotes, held],
  );
  const shown = mineOnly ? rows.filter(r => r.held) : rows;
  const sum = useMemo(() => listSummary(rows), [rows]);
  const mix = useMemo(() => sectorMix(rows), [rows]);
  const missing = useMemo(() => gaps(rows, 6), [rows]);

  return (
    <>
      <div className="seg dvl-seg">
        {LISTS.map(l => (
          <button key={l.key} className={`seg-btn${key === l.key ? ' on' : ''}`}
            onClick={() => setKey(l.key)}>{l.label}</button>
        ))}
      </div>

      {/* Unconditional once the snapshot is a year old. Not a dismissible
          toast, not a tooltip: the age of this data changes what every number
          below it means, so it sits above them and stays. */}
      {age.stale && (
        <div className="dvl-stale">
          <b>SNAPSHOT {age.asOf}</b>
          <span>
            Membership and dividend rates were last read {age.days} days ago. Streaks may have ended
            and rates may have moved since. Prices below are live; the yields are live prices over
            snapshot rates, so treat them as indicative and check a name before acting on it.
          </span>
        </div>
      )}

      <Card title={list.label} color={list.color}
        right={<span className="small muted">{sum.count} names · {sum.heldCount} held</span>}>
        <div className="small muted mb">{list.blurb}</div>

        <div className="dvl-sum">
          <span><b>{sum.count}</b> on list</span>
          <span>median yield <b className="c-green">{pct(sum.medianYield)}</b></span>
          <span>you hold <b className="c-cyan">{sum.heldCount}</b> of {sum.heldOf}</span>
          {sum.withYield < sum.count && (
            /* Said out loud rather than left to be inferred from a short table.
               A median over 3 of 28 names is not a median of the list. */
            <span className="muted" title="A yield needs a live price; the rest have not quoted yet">
              priced: <b>{sum.withYield}</b>/{sum.count}
            </span>
          )}
        </div>

        <Bar mix={mix} />

        <div className="seg dvl-filter">
          <button className={`seg-btn${!mineOnly ? ' on' : ''}`} onClick={() => setMineOnly(false)}>All</button>
          <button className={`seg-btn${mineOnly ? ' on' : ''}`} onClick={() => setMineOnly(true)}>Only mine</button>
        </div>

        {shown.length === 0
          ? <Empty text={mineOnly ? 'You do not hold anything on this list yet.' : 'Nothing qualifies.'} />
          : (
            <div className="dvl-tbl">
              <div className="dvl-head">
                <span>Ticker</span><span>Streak</span><span>Sector</span>
                <span className="r">Rate</span><span className="r">Price</span><span className="r">Yield</span>
              </div>
              {shown.map(r => (
                <div key={r.ticker} className={`dvl-row${r.held ? ' mine' : ''}`}>
                  <span className="dvl-tk">
                    <b>{r.ticker}</b>
                    <i>{r.name}</i>
                    {r.held && <span className="chip c-cyan">held</span>}
                    {r.freq === 12 && <span className="chip c-purple">monthly</span>}
                  </span>
                  {/* Decision 2 made visible: the year travels with the number. */}
                  <span className="dvl-streak" title={r.note || `Consecutive years of increases as of ${r.streakAsOf}`}>
                    {r.streak == null ? '—' : <><b>{r.streak}</b> yrs <i>({r.streakAsOf})</i></>}
                    {r.note && <em title={r.note}>!</em>}
                  </span>
                  <span className="muted small">{r.sector}</span>
                  <span className="r muted">{r.rate == null ? '—' : `$${r.rate.toFixed(2)}`}</span>
                  <span className="r">{r.price == null ? <i className="muted">—</i> : `$${r.price.toFixed(2)}`}</span>
                  <span className={`r ${r.yieldPct == null ? 'muted' : 'c-green'}`}>{pct(r.yieldPct)}</span>
                </div>
              ))}
            </div>
          )}

        {sum.income > 0 && (
          <div className="small muted mt">
            Your holdings on this list would pay about <b className="c-green">${sum.income.toFixed(2)}</b> a
            year at the snapshot rates — before withholding tax, and assuming every rate above still stands.
          </div>
        )}
      </Card>

      {missing.length > 0 && !mineOnly && (
        <Card title="On the list, not in your book" color="var(--ink-3)"
          right={<span className="small muted">by yield</span>}>
          {/* Decision 4, stated where it can be read rather than only in the
              module header. This card exists because "what am I not in" is a
              question about the portfolio. It is not a shortlist. */}
          <div className="small muted mb">
            A fact about your book, not a suggestion. These are simply the names on this list you do
            not currently own, ordered by the list's own column. Nothing here is scored or recommended,
            and a high yield is as often a fallen price as a generous payout.
          </div>
          <div className="dvl-gaps">
            {missing.map(r => (
              <span key={r.ticker} className="dvl-gap">
                <b>{r.ticker}</b>
                <i>{pct(r.yieldPct)}</i>
                <em>{r.streak} yrs</em>
              </span>
            ))}
          </div>
        </Card>
      )}

      <Card title="How these lists are built" color="var(--ink-3)">
        <div className="small muted">
          One membership table drives all four lists, so a name can never appear as a King and go
          missing from the Aristocrats — the lists are thresholds on a single streak column
          ({MEMBERS.length} names tracked). Kings are 50+ years of consecutive increases, Aristocrats 25+,
          Achievers 10+; each list therefore contains the stricter ones above it. The published
          Aristocrats index adds an S&P 500 membership and liquidity screen on top of the streak, which
          is not modelled here. A spin-off resets a streak regardless of the company's earlier record,
          and those names are kept in the table at zero rather than deleted, so a demotion does not
          look like a delisting. Streaks are never rolled forward: a streak is shown with the year it
          was true, because adding elapsed years would invent raises that may not have happened.
        </div>
      </Card>
    </>
  );
}
