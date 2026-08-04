// The screener.
//
// src/lib/scanner.js has carried six stated decisions and no suite at all. Each
// decision exists to prevent one specific lie, and this suite is organised
// around the lies rather than around the functions:
//
//   1. "the market" — a screen over 77 names implying coverage of a market.
//   2. "it failed"  — a name dropped for missing data, indistinguishable from
//                     a name that was measured and did not qualify.
//   3. "it matched" — a card that prints its passes and swallows its failures.
//   4. "it's best"  — an order invented by the sort where the rules contain no
//                     preference.
//   5. "buy it at"  — an entry, a target, a stop or a size, any one of which
//                     turns a filter into advice.
//   6. "right now"  — a statement about three-week-old candles presented in the
//                     present tense.
//
// Plus the universe widening this batch added, which is where the first lie is
// easiest to reintroduce by accident: three lists bolted together dedup wrongly
// and the screen starts overstating its own size.
//
// Table-driven walks over RULES and STRATEGIES are paired with hand-typed
// anchors throughout, because a walk that derives its expectation from the same
// table it is checking agrees with any table.

import {
  PASS, FAIL, UNKNOWN,
  RULES, ruleById, STRATEGIES, strategyById,
  evaluate, rankWithTies, scan,
  UNIVERSE_SOURCES, buildUniverse, universeNote, CANDLE_PACE_MS, fetchEstimate,
  DAY, dataAge, ideaCard, DISCLAIMER,
} from '../src/lib/scanner.js';
import { UNIVERSE as LEADERS } from '../src/lib/leaders.js';
import { MEMBERS as DIV_MEMBERS } from '../src/lib/divlists.js';
import { readFileSync } from 'fs';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass += 1; } else { fail += 1; console.log(`FAIL: ${name}${extra ? ` — ${extra}` : ''}`); }
};

const SRC = readFileSync(new URL('../src/lib/scanner.js', import.meta.url), 'utf8');
const JSX = readFileSync(new URL('../src/components/money/Scanner.jsx', import.meta.url), 'utf8');
const CSS = readFileSync(new URL('../src/arcade.css', import.meta.url), 'utf8')
  + readFileSync(new URL('../src/theme.css', import.meta.url), 'utf8');

// A profitable name on a modest multiple: passes all four quality-value rules.
const GOOD = {
  ticker: 'GOOD',
  price: 100,
  metric: {
    peTTM: 12, roeTTM: 22, netProfitMarginTTM: 15,
    'totalDebt/totalEquityQuarterly': 0.5,
    dividendYieldIndicatedAnnual: 3.2, beta: 0.8,
    '52WeekLow': 95, '52WeekHigh': 180,
  },
};
// Measured, and it does not qualify: every quality-value rule answers FAIL.
const POOR = {
  ticker: 'POOR',
  price: 100,
  metric: {
    peTTM: 55, roeTTM: 4, netProfitMarginTTM: 2,
    'totalDebt/totalEquityQuarterly': 3.1,
  },
};
// Nothing loaded. Decision 2's whole reason for existing.
const DARK = { ticker: 'DARK', price: 100 };

const rising = n => Array.from({ length: n }, (_, i) => ({ t: i, c: 100 + i * 0.5, v: 1000 }));

// ------------------------------------------- decision 1: a STATED universe
{
  // Hand-typed anchors first. Every derived count below is measured against
  // these rather than against the tables that produced them.
  ok('the leaderboard source holds 30 names', LEADERS.length === 30, String(LEADERS.length));
  ok('the dividend-lists source holds 60 names', DIV_MEMBERS.length === 60, String(DIV_MEMBERS.length));
  const lt = LEADERS.map(u => u.t), dt = DIV_MEMBERS.map(m => m.t);
  const overlap = lt.filter(t => dt.includes(t));
  ok('and 13 names sit on both lists, which is what dedup is for',
    overlap.length === 13, overlap.join());
  ok('KO is one of them', overlap.includes('KO'));
  ok('NVDA is on the leaderboard only', lt.includes('NVDA') && !dt.includes('NVDA'));
  ok('MAIN is on the dividend table only', dt.includes('MAIN') && !lt.includes('MAIN'));

  // The table's ORDER is the precedence order and the header says it is
  // load-bearing. Pin it: held must be first, or a holding gets claimed by a
  // list and stops being marked as yours.
  ok('there are exactly three sources', UNIVERSE_SOURCES.length === 3, String(UNIVERSE_SOURCES.length));
  ok('and they are held, watch, lists in that order',
    UNIVERSE_SOURCES.map(s => s.key).join(',') === 'held,watch,lists',
    UNIVERSE_SOURCES.map(s => s.key).join(','));
  ok('every source names itself', UNIVERSE_SOURCES.every(s => typeof s.label === 'function'));
  ok('and can produce tickers', UNIVERSE_SOURCES.every(s => typeof s.tickers === 'function'));

  const empty = buildUniverse();
  ok('with nothing held the universe is 77 names', empty.total === 77, String(empty.total));
  ok('none of which came from the held source', empty.counts.held === 0, String(empty.counts.held));
  ok('30 from the leaderboard', empty.counts.watch === 30, String(empty.counts.watch));
  ok('and 47 from the dividend table, being 60 less the 13 already counted',
    empty.counts.lists === 47, String(empty.counts.lists));
  ok('the counts add up to the total',
    empty.counts.held + empty.counts.watch + empty.counts.lists === empty.total);
  ok('and rows.length agrees with total', empty.rows.length === empty.total);

  // THE dedup property, stated as an invariant rather than as a count: adding
  // a holding that is already in the universe must not grow it. This is the
  // specific way a screener starts overstating its own size.
  const withKO = buildUniverse({ holdings: [{ ticker: 'KO', name: 'Coca-Cola' }] });
  ok('holding a name already on a list does not grow the universe',
    withKO.total === 77, String(withKO.total));
  ok('but it does move that name into the held source', withKO.counts.held === 1);
  ok('and the leaderboard count drops by exactly one', withKO.counts.watch === 29, String(withKO.counts.watch));
  ok('KO appears exactly once', withKO.rows.filter(r => r.ticker === 'KO').length === 1);
  ok('and it is claimed by the FIRST source, not a later one',
    withKO.rows.find(r => r.ticker === 'KO')?.source === 'held');
  ok('so it is flagged as held', withKO.rows.find(r => r.ticker === 'KO')?.held === true);
  ok('while a leaderboard-only name is not',
    withKO.rows.find(r => r.ticker === 'NVDA')?.held === false);

  // A name nobody lists is still yours, so it must widen the universe.
  const withNew = buildUniverse({ holdings: [{ ticker: 'ZZZZ', name: 'Nowhere Inc' }] });
  ok('holding a name on no list does grow the universe', withNew.total === 78, String(withNew.total));
  ok('and it keeps the name you gave it',
    withNew.rows.find(r => r.ticker === 'ZZZZ')?.name === 'Nowhere Inc');

  const messy = buildUniverse({ holdings: [{ ticker: 'ko' }, { ticker: '' }, { ticker: 'KO' }, null] });
  ok('a lowercase ticker is folded into the same name', messy.counts.held === 1, String(messy.counts.held));
  ok('a blank ticker contributes nothing', messy.total === 77, String(messy.total));
  ok('and a nameless holding falls back to its ticker',
    messy.rows.find(r => r.ticker === 'KO')?.name === 'KO');
  ok('every row carries a source', messy.rows.every(r => r.source));
  ok('and no ticker repeats anywhere in the universe',
    new Set(messy.rows.map(r => r.ticker)).size === messy.rows.length);
}

// ------------------------------------- decision 1, said out loud in the copy
{
  const none = universeNote({});
  ok('an empty universe reports zero', none.total === 0);
  ok('and says so in words rather than printing an empty list',
    /nothing to scan yet/.test(none.text), none.text);
  ok('the empty note still refuses the coverage claim',
    /no market feed/.test(none.text), none.text);

  const one = universeNote({ held: 4 });
  ok('one contributing source needs no conjunction', !/ and /.test(one.text), one.text);
  ok('and is counted', one.total === 4);
  ok('with the singular handled', /1 name you hold/.test(universeNote({ held: 1 }).text));
  ok('and the plural handled', /4 names you hold/.test(one.text), one.text);

  const two = universeNote({ held: 2, lists: 47 });
  ok('a source contributing nothing is omitted rather than printed as zero',
    !/leaderboard/.test(two.text), two.text);
  ok('two sources are joined with "and"',
    /2 names you hold and 47 more from the dividend-lists table/.test(two.text), two.text);
  ok('and the total is the sum of what actually went in', two.total === 49, String(two.total));

  const three = universeNote({ held: 2, watch: 28, lists: 47 });
  ok('three sources use commas up to the last', /hold, 28 more/.test(three.text), three.text);
  ok('and "and" before it', /leaderboard list and 47 more/.test(three.text), three.text);
  ok('the full universe totals 77', three.total === 77, String(three.total));
  ok('the sentence leads with the count', /^Scanning 77 names/.test(three.text), three.text);

  // Decision 1's actual point: the note must state the limit, not just the size.
  ok('it denies a market feed', /no market feed behind this screen/.test(three.text));
  ok('and says a name outside the list cannot appear however good it is',
    /cannot appear here however well it would have scored/.test(three.text));
  ok('the sources are ordered in the sentence the way the table orders them',
    three.text.indexOf('you hold') < three.text.indexOf('leaderboard')
    && three.text.indexOf('leaderboard') < three.text.indexOf('dividend-lists'));
}

// ------------------------------- the wait is stated before it is agreed to
{
  ok('the pace is the provider\'s eight calls a minute', CANDLE_PACE_MS === 8200, String(CANDLE_PACE_MS));

  const zero = fetchEstimate(0);
  ok('nothing to load costs nothing', zero.ms === 0 && zero.count === 0);
  ok('and says so plainly', zero.text === 'There is nothing to load.', zero.text);
  ok('rubbish input is treated as nothing', fetchEstimate('abc').ms === 0);
  ok('and a negative count cannot produce a negative wait', fetchEstimate(-5).ms === 0);

  // n names is n-1 waits. Charging for the pause after the last call is the
  // easy off-by-one, and on a 77-name run it overstates by eight seconds.
  ok('one name waits not at all', fetchEstimate(1).ms === 0, String(fetchEstimate(1).ms));
  ok('two names wait once', fetchEstimate(2).ms === 8200, String(fetchEstimate(2).ms));
  ok('and 77 names wait 76 times', fetchEstimate(77).ms === 76 * 8200, String(fetchEstimate(77).ms));
  ok('the pace is overridable for a different provider', fetchEstimate(3, 1000).ms === 2000);

  ok('a short run reads as under a minute', /under a minute/.test(fetchEstimate(8).text), fetchEstimate(8).text);
  ok('and 8 names is genuinely under one', fetchEstimate(8).ms < 60000, String(fetchEstimate(8).ms));
  ok('a nine-name run crosses the minute', fetchEstimate(9).ms >= 60000);
  ok('and reads in minutes', /about 1 minute\b/.test(fetchEstimate(9).text), fetchEstimate(9).text);
  ok('the full universe reads as about ten minutes',
    /about 10 minutes/.test(fetchEstimate(77).text), fetchEstimate(77).text);
  ok('the count is repeated in the sentence', /^77 names,/.test(fetchEstimate(77).text));

  // Stoppability is only honest because of decision 2, and the sentence that
  // offers the stop is the same sentence that says what a stop costs.
  ok('the estimate says the run can be stopped', /stop it part way/.test(fetchEstimate(77).text));
  ok('and that stopping produces unknowns rather than failures',
    /"not evaluated" rather than as failures/.test(fetchEstimate(77).text), fetchEstimate(77).text);
}

// ---------------------------------------- decision 2: unknown is not fail
{
  const r = evaluate('quality-value', DARK);
  ok('a name with no data still produces a card', !!r);
  ok('all four rules come back unknown', r.unknown.length === 4, String(r.unknown.length));
  ok('none of them failed', r.failed.length === 0, String(r.failed.length));
  ok('and none passed', r.passed.length === 0);
  ok('so nothing was answered', r.answered === 0, String(r.answered));
  ok('and the card knows it is incomplete', r.complete === false);
  ok('it names the kind of data that would fix it', r.needs.join() === 'metric', r.needs.join());
  ok('each unknown names the missing input rather than saying "no data"',
    r.unknown.every(u => /is not in the saved data for this name\.$/.test(u.text)),
    r.unknown.map(u => u.text).join(' | '));

  const good = evaluate('quality-value', GOOD);
  ok('a fully-loaded name answers every rule', good.answered === 4 && good.complete === true);
  ok('and needs nothing', good.needs.length === 0, good.needs.join());
  ok('matching all four', good.matched === 4, String(good.matched));
  ok('out of four', good.of === 4);

  const poor = evaluate('quality-value', POOR);
  ok('a measured name that qualifies for nothing is answered, not blocked',
    poor.answered === 4 && poor.matched === 0);
  ok('and its four failures are failures, not unknowns',
    poor.failed.length === 4 && poor.unknown.length === 0);

  // The asymmetry that stops a loss reading as a bargain, and stops it reading
  // as a fact either. These two rules deliberately diverge on the same input.
  const loss = { metric: { peTTM: -8 } };
  ok('a negative P/E fails the cheap-multiple rule', ruleById('pe.cheap').test(loss).state === FAIL);
  ok('and says why rather than printing a small number',
    /Earnings are negative/.test(ruleById('pe.cheap').test(loss).text));
  ok('while the stretched-multiple rule cannot measure it at all',
    ruleById('pe.rich').test(loss).state === UNKNOWN);

  // A zero denominator is not a distance of zero.
  ok('a 52-week low of zero is unmeasurable, not a perfect match',
    ruleById('near.low').test({ price: 10, metric: { '52WeekLow': 0 } }).state === UNKNOWN);
  ok('and a missing price is unmeasurable too',
    ruleById('near.low').test({ metric: { '52WeekLow': 90 } }).state === UNKNOWN);
  ok('with the low present and the price present it answers',
    ruleById('near.low').test({ price: 100, metric: { '52WeekLow': 95 } }).state === PASS);

  // Candle rules with no history are what makes a stopped run survivable.
  const mom = evaluate('momentum', { ticker: 'M', price: 100, metric: { '52WeekHigh': 200 } });
  ok('every candle rule is unknown with no history',
    mom.unknown.filter(u => u.need === 'candles').length === 4,
    String(mom.unknown.filter(u => u.need === 'candles').length));
  ok('none of them failed for want of a fetch',
    mom.failed.every(f => f.need !== 'candles'));
  ok('and the card asks for candles by name', mom.needs.includes('candles'), mom.needs.join());
  ok('a short series is still not enough, and says how short',
    /there are 50/.test(ruleById('trend.up').test({ candles: rising(50) }).text),
    ruleById('trend.up').test({ candles: rising(50) }).text);
  ok('and an empty one says none are loaded',
    /none are loaded/.test(ruleById('trend.up').test({ candles: [] }).text));

  const long = { candles: rising(250) };
  ok('with enough history the trend rule answers', ruleById('trend.up').test(long).state === PASS);
  ok('the cross rule answers', ruleById('trend.cross').test(long).state === PASS);
  ok('a strictly rising series is stretched, not washed out',
    ruleById('rsi.hot').test(long).state === PASS && ruleById('rsi.washed').test(long).state === FAIL);
  const surge = rising(30).map((c, i, a) => (i === a.length - 1 ? { ...c, v: 5000 } : c));
  ok('a heavy bar surges', ruleById('vol.surge').test({ candles: surge }).state === PASS);
  ok('an even series does not', ruleById('vol.surge').test({ candles: rising(30) }).state === FAIL);
  ok('and too little volume history is unknown rather than calm',
    ruleById('vol.surge').test({ candles: rising(5) }).state === UNKNOWN);
}

// -------------------------- decision 2 again, at the level of the whole scan
{
  const out = scan('quality-value', [GOOD, POOR, DARK]);
  ok('the scan sees three names', out.universe === 3, String(out.universe));
  ok('one matched', out.hits.length === 1 && out.hits[0].ticker === 'GOOD');
  ok('one was measured and matched nothing', out.misses.length === 1 && out.misses[0].ticker === 'POOR');
  ok('and one could not be evaluated', out.blocked.length === 1 && out.blocked[0].ticker === 'DARK');

  // THE distinction the third list exists to preserve.
  ok('the unmeasured name is not in the misses',
    !out.misses.some(r => r.ticker === 'DARK'));
  ok('and the measured failure is not in the blocked list',
    !out.blocked.some(r => r.ticker === 'POOR'));
  ok('nothing is dropped: every input appears in exactly one list',
    out.hits.length + out.misses.length + out.blocked.length === 3);

  const nothing = scan('quality-value', []);
  ok('an empty scan is empty rather than broken',
    nothing.universe === 0 && nothing.hits.length === 0);
  const bogus = scan('no-such-strategy', [GOOD]);
  ok('an unknown strategy returns nothing rather than everything',
    bogus.strategy === null && bogus.hits.length === 0 && bogus.blocked.length === 0);
  ok('and reports a universe of zero rather than the row count', bogus.universe === 0);

  ok('a strategy object may be passed instead of an id',
    scan(strategyById('quality-value'), [GOOD]).hits.length === 1);
}

// ------------------------------------------- decision 3: both sides, always
{
  const r = evaluate('quality-value', { ticker: 'MIX', metric: { peTTM: 12, roeTTM: 4 } });
  ok('the results hold every rule in the strategy, not just the passes',
    r.results.length === 4, String(r.results.length));
  ok('in the strategy\'s own order',
    r.results.map(x => x.id).join() === strategyById('quality-value').rules.join(),
    r.results.map(x => x.id).join());
  ok('the counts are consistent with the results they are drawn from',
    r.passed.length + r.failed.length + r.unknown.length === r.results.length);
  ok('one passed, one failed, two unmeasured',
    r.passed.length === 1 && r.failed.length === 1 && r.unknown.length === 2,
    `${r.passed.length}/${r.failed.length}/${r.unknown.length}`);
  ok('the denominator is what could be answered, not the rule count',
    r.answered === 2 && r.of === 4, `${r.answered}/${r.of}`);

  const card = ideaCard(r);
  ok('the card carries the passes', card.what.length === 1);
  ok('AND the misses, in the card rather than a screen away', card.missed.length === 1);
  ok('and the unmeasured ones as well', card.unmeasured.length === 2);
  ok('the note uses the answered denominator when the card is incomplete',
    /Matched 1 of the 2 rules that could be answered/.test(card.note), card.note);
  ok('and names how many could not be', /2 could not be evaluated/.test(card.note), card.note);
  ok('a complete card uses the rule count instead',
    ideaCard(evaluate('quality-value', GOOD)).note === 'Matched 4 of 4 rules in this screen.',
    ideaCard(evaluate('quality-value', GOOD)).note);
  ok('the singular is handled in the incomplete note',
    / 1 rule that could be answered/.test(
      ideaCard(evaluate('quality-value', { metric: { peTTM: 12 } })).note));
  ok('no card at all for no result', ideaCard(null) === null);
  ok('and no evaluation for an unknown strategy', evaluate('nope', GOOD) === null);
}

// ------------------------- decision 4: rank is a count, and ties stay tied
{
  const A = { ticker: 'A', matched: 3 }, B = { ticker: 'B', matched: 3 };
  const C = { ticker: 'C', matched: 2 }, D = { ticker: 'D', matched: 3 };
  const out = rankWithTies([C, A, B]);
  ok('the highest count comes first', out[0].matched === 3);
  ok('equal counts share a rank', out[0].rank === 1 && out[1].rank === 1);
  ok('and the next rank skips, competition-style, rather than reading 2',
    out[2].rank === 3, String(out[2].rank));
  ok('members of a group larger than one are marked tied',
    out[0].tied === true && out[1].tied === true);
  ok('with the size of their group', out[0].tiedWith === 2, String(out[0].tiedWith));
  ok('and a lone name is not tied', out[2].tied === false && out[2].tiedWith === 1);

  // No secondary sort key anywhere. Input order survives inside a group, which
  // is the honest version of "these are not ordered".
  ok('input order survives within a tie',
    rankWithTies([A, B, D]).map(r => r.ticker).join() === 'A,B,D');
  ok('and reversing the input reverses the group, proving nothing sorts it',
    rankWithTies([D, B, A]).map(r => r.ticker).join() === 'D,B,A');
  ok('the source contains no tiebreaker on ticker',
    !/a\.ticker|localeCompare/.test(SRC));
  ok('and the only comparator subtracts matched counts and stops',
    /\(b\.matched - a\.matched\) \|\| 0/.test(SRC));

  ok('an empty list ranks to nothing', rankWithTies([]).length === 0);
  ok('and the input array is not mutated',
    (() => { const src = [C, A]; rankWithTies(src); return src[0] === C; })());
}

// ------------------ decision 5: an expiry condition, and nothing that sizes
{
  ok('there are 17 rules', RULES.length === 17, String(RULES.length));
  ok('every rule id is unique', new Set(RULES.map(r => r.id)).size === RULES.length);
  ok('every rule states its threshold in words', RULES.every(r => r.rule && r.rule.length > 8));
  ok('and its own inverse', RULES.every(r => r.ends && r.ends.length > 5));
  ok('the inverse is never a copy of the threshold', RULES.every(r => r.ends !== r.rule));
  ok('every rule declares the data it needs',
    RULES.every(r => ['metric', 'price', 'candles'].includes(r.need)),
    RULES.map(r => r.need).filter(n => !['metric', 'price', 'candles'].includes(n)).join());

  // Hand-typed anchors on the thresholds themselves, so the walk above is not
  // measuring the table against itself.
  ok('the cheap-multiple rule is 20', ruleById('pe.cheap').rule === 'Trailing P/E at or under 20');
  ok('the stretched one is 40', ruleById('pe.rich').rule === 'Trailing P/E above 40');
  ok('return on equity is 15%', ruleById('roe.strong').rule === 'Return on equity at or above 15%');
  ok('the yield floor is 2%', ruleById('yield.pays').rule === 'Indicated dividend yield at or above 2%');
  ok('and the volume surge is 1.5x', /1\.5×/.test(ruleById('vol.surge').rule));
  ok('an unknown rule id resolves to null rather than a default', ruleById('nope') === null);

  ok('there are six strategies', STRATEGIES.length === 6, String(STRATEGIES.length));
  ok('and their ids are unique', new Set(STRATEGIES.map(s => s.id)).size === 6);
  ok('every strategy resolves every rule it names',
    STRATEGIES.every(s => s.rules.every(id => ruleById(id))),
    STRATEGIES.flatMap(s => s.rules.filter(id => !ruleById(id))).join());
  ok('every strategy says what it describes', STRATEGIES.every(s => s.thesis && s.thesis.length > 40));
  ok('and what it cannot see', STRATEGIES.every(s => s.caution && s.caution.length > 40));
  ok('quality-value is the four ratio rules',
    strategyById('quality-value').rules.join() === 'pe.cheap,roe.strong,margin.solid,debt.low');
  ok('and an unknown id resolves to null', strategyById('nope') === null);

  // The four things that turn a filter into advice. None of them may exist as
  // a field on a rule, a strategy, an evaluation or a card.
  const banned = ['target', 'stop', 'entry', 'size', 'score', 'weight', 'rating', 'signal'];
  ok('no rule carries a weight or a score',
    RULES.every(r => banned.every(k => !(k in r))));
  ok('no strategy weights its rules',
    STRATEGIES.every(s => banned.every(k => !(k in s))));
  ok('an evaluation has no score',
    banned.every(k => !(k in evaluate('quality-value', GOOD))));
  ok('and neither has the card',
    banned.every(k => !(k in ideaCard(evaluate('quality-value', GOOD)))));

  // What a match DOES get: the condition that ends it, taken straight off the
  // rule so the inverse can never drift from the threshold.
  const card = ideaCard(evaluate('quality-value', GOOD));
  ok('every pass contributes an expiry condition', card.ends.length === card.what.length);
  ok('and each is the rule\'s own wording',
    card.ends.every(e => RULES.some(r => r.label === e.label && r.ends === e.ends)));
  ok('the cheap-multiple match expires on the P/E rising above 20',
    card.ends.some(e => e.ends === 'the P/E rising above 20'), JSON.stringify(card.ends));

  ok('the disclaimer refuses the word suggestion',
    /These are filters, not suggestions\./.test(DISCLAIMER));
  ok('it says the data describes the past',
    /a description of the past and not a view about what happens next/.test(DISCLAIMER));
  ok('and it names buying and selling explicitly rather than hedging',
    /Nothing on this screen is a recommendation to buy or sell anything\.$/.test(DISCLAIMER),
    DISCLAIMER.slice(-70));
}

// --------------------------- decision 6: stamped with its own oldest input
{
  const now = Date.UTC(2026, 7, 4);
  ok('no stamps means the age is not known', dataAge([], now).known === false);
  ok('and it refuses to be treated as current',
    /cannot be treated as current/.test(dataAge([], now).text));
  ok('zeroes and nulls are not stamps', dataAge([0, null, ''], now).known === false);

  // THE property: the oldest wins. An average would hide the one that matters.
  const fresh = now - 1 * DAY, stale = now - 30 * DAY;
  const a = dataAge([fresh, stale], now);
  ok('the age is taken from the oldest input, not the newest', a.days === 30, String(a.days));
  ok('nor from the mean of the two', a.days !== 15);
  ok('and the oldest timestamp is reported', a.oldest === stale);
  ok('thirty days is stale', a.stale === true);
  ok('the sentence puts the reading in the past tense',
    /statement about the data as it stood then/.test(a.text), a.text);

  ok('same-day data reads as today', /Every input was read today/.test(dataAge([now], now).text));
  ok('and is not stale', dataAge([now], now).stale === false);
  ok('six days is not yet stale', dataAge([now - 6 * DAY], now).stale === false);
  ok('seven days is', dataAge([now - 7 * DAY], now).stale === true);
  ok('the singular day is handled', /1 day old/.test(dataAge([now - 1 * DAY], now).text));
  ok('Date objects are accepted alongside numbers',
    dataAge([new Date(stale)], now).days === 30, String(dataAge([new Date(stale)], now).days));
  ok('a day is a day', DAY === 86400e3);
}

// -------------------------------- the screen must not put the advice back
{
  // The universe is composed in the library now. If the component reimports the
  // leaderboard directly it has started building its own universe again, which
  // is exactly the split that let the dedup rule and the sentence describing it
  // disagree.
  ok('the screen does not import the leaderboard directly',
    !/from '\.\.\/\.\.\/lib\/leaders\.js'/.test(JSX));
  ok('it builds the universe through the library', /buildUniverse\(\{ holdings: held \}\)/.test(JSX));
  ok('and takes the sentence from the same place', /universeNote\(universe\.counts\)/.test(JSX));
  ok('the universe tile no longer claims to be held plus the leaderboard',
    /note="held \+ lists"/.test(JSX), 'tile note');

  // The wait is stated before the press, not discovered after it.
  ok('the estimate is computed from the row count', /fetchEstimate\(rows\.length\)/.test(JSX));
  ok('and rendered inside the candle strip', /estimate\.text/.test(JSX));
  ok('before the button that starts the run',
    JSX.indexOf('estimate.text') < JSX.indexOf('load price history'));

  // Stoppability. A ten-minute run the reader cannot end is one they end by
  // closing the tab, which throws away the names already fetched.
  ok('the stop flag is a ref, not state', /const stopRef = useRef\(false\)/.test(JSX));
  ok('and useRef is imported', /useRef/.test(JSX.split('\n')[0]));
  ok('the loop checks it before every fetch', /if \(stopRef\.current\) break;/.test(JSX));
  ok('the stop button sets it', /stopRef\.current = true;/.test(JSX));
  ok('and reports progress on its own face', /stop — \{done\}\/\{rows\.length\}/.test(JSX));
  ok('the pace is only paid between calls, not after the last one',
    /i < rows\.length - 1 && !stopRef\.current/.test(JSX));
  ok('and the pace itself comes from the library rather than a second literal',
    /setTimeout\(res, CANDLE_PACE_MS\)/.test(JSX) && !/8200/.test(JSX));

  // Decision 5 of the screen: the disclaimer is above the first result.
  ok('the disclaimer is rendered before the matched card',
    JSX.indexOf('{DISCLAIMER}') > 0 && JSX.indexOf('{DISCLAIMER}') < JSX.indexOf('title={`Matched'));
  ok('the blocked list is drawn unconditionally, not behind a toggle',
    /<Blocked rows=\{result\.blocked\} \/>/.test(JSX));
  ok('and the not-evaluated tile calls it missing data rather than a failure',
    /note="missing data, not a failure"/.test(JSX));

  // Retro idiom, per the standing rule for anything new on this dashboard.
  ok('the candle strip is styled', /\.sc-candles\s*[{,]/.test(CSS));
  ok('the stop button reuses the existing small-button class', /\.btn-sm[\s,{]/.test(CSS));
  ok('and the strip keeps its text and its button on one row',
    /\.sc-candles[^{]*\{[^}]*display:\s*flex/.test(CSS));
}

console.log(`\n${pass}/${pass + fail} passing`);
if (fail) process.exit(1);
