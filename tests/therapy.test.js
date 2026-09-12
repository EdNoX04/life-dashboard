// The session backbone.
//
// Three groups of rules, in order of how much they matter:
//
//   1. The override. If risk appears, nothing else in this file applies. That
//      is tested first because it is the property everything else is allowed to
//      exist underneath.
//   2. The promise. "End to end encrypted" is not achievable here and must not
//      be claimed — the model reads the words to answer them. The wording lives
//      in this file precisely so no component can quietly upgrade it.
//   3. The gates — the $20 ceiling, the 30-hour window, the weekly cadence —
//      and the rule that none of them may scold.

import {
  STATES, VALID_HOURS, CEILING_USD, MOOD_MIN, MOOD_MAX, MIN_FOR_TREND, RESOURCES, STORAGE,
  normaliseSession, clampMood, stateOf, isLive, hoursLeft, ageHours,
  costOf, canContinue, mentionsRisk, crisisCheck, blocked,
  cadence, moodTrend, moodShift, privacyClaim, redactForApp,
} from '../src/lib/therapy.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log('FAIL ' + n); } };
const eq = (a, b, n) => ok(Object.is(a, b), `${n} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const T0 = Date.parse('2026-09-13T10:00:00Z');
const hrs = h => T0 + h * 3600000;
const iso = t => new Date(t).toISOString();

// =========================================================================
// 1. THE OVERRIDE
// =========================================================================
{
  for (const said of [
    'i want to kill myself', 'I have been thinking about suicide',
    'i want to die', "i don't want to be here any more",
    'there is no point in living', "they'd be better off without me",
    'i want to end it', 'i keep self-harming',
  ]) {
    ok(mentionsRisk(said), `"${said}" raises the flag`);
    ok(crisisCheck(said).blocked, 'and blocks the session');
  }

  const c = crisisCheck('i want to die');
  ok(c.resources.lines.length > 0, 'with real places to call');
  ok(!/as an ai|i am not able|unfortunately|disclaimer/i.test(c.text),
     'and no wall of caveats in front of them — someone reading this is not looking for a disclaimer');

  ok(crisisCheck('a normal hard day', { flaggedByModel: true }).blocked,
     'the model can raise it too — this is a NET, not a filter, so a miss by one is not a miss by the system');
  ok(!crisisCheck('work has been stressful and I slept badly').blocked,
     'an ordinary bad week is not a crisis');

  // The property that makes it an override rather than a feature.
  const spent = normaliseSession({ spent: 19.99, crisis: true, startedAt: iso(T0) });
  ok(blocked(spent, ''), 'a session already flagged stays flagged');
  ok(blocked(normaliseSession({}), 'i want to die'),
     'and it fires regardless of ceiling, cadence or clock — every other gate in this file is moot underneath it');
}

// =========================================================================
// 2. THE PROMISE
// =========================================================================
{
  const claim = privacyClaim().toLowerCase();
  ok(!/end.to.end/.test(claim),
     'the wording NEVER says end-to-end — the model reads the words to answer them, and claiming otherwise changes what someone is willing to type');
  ok(/encrypted at rest/.test(claim), 'it says what is actually true');
  ok(/sees what you type/.test(claim), 'and says the part people would assume away');
  ok(/lose the passphrase/.test(claim), 'and states the cost of the property, once, plainly');

  eq(STORAGE.transcript.supabase, false, 'the transcript never touches Supabase');
  eq(STORAGE.transcript.plaintextAnywhere, false, 'and is never stored in plaintext anywhere');
  eq(STORAGE.key.where, 'nowhere', 'the server never holds the key');

  const full = { id: 'x', startedAt: iso(T0), summary: 'ok', transcript: 'the whole conversation', key: 'secret' };
  const shown = redactForApp(full);
  ok(!('transcript' in shown), 'what the app may render contains NO transcript');
  ok(!('key' in shown), 'and no key');
  ok(!JSON.stringify(shown).includes('the whole conversation'), 'not anywhere inside it either');
  eq(shown.summary, 'ok', 'the summary is the thing it shows');
}

// =========================================================================
// 3. THE GATES
// =========================================================================

// ---- the 30-hour window
{
  const s = normaliseSession({ startedAt: iso(T0), state: 'open' });
  eq(stateOf(s, hrs(1)), 'open', 'an hour in, it is open');
  eq(stateOf({ ...s, state: 'paused' }, hrs(5)), 'paused', 'paused stays paused');
  eq(stateOf(s, hrs(VALID_HOURS + 0.1)), 'expired',
     `past ${VALID_HOURS} hours it expires ITSELF — a session that is neither open nor finished is the state that quietly loses work`);
  eq(stateOf({ ...s, state: 'closed' }, hrs(1)), 'closed', 'a closed session stays closed');
  eq(isLive(s, hrs(31)), false, 'and an expired one is not live');

  // The window runs from the START, not the last message.
  const poked = normaliseSession({ startedAt: iso(T0), state: 'paused' });
  eq(stateOf(poked, hrs(31)), 'expired',
     'a session paused on Monday and poked on Wednesday is NOT still today’s session — the window does not slide');
  eq(Math.round(hoursLeft(s, hrs(6))), 24, 'the time left is stated');
  eq(hoursLeft(s, hrs(40)), null, 'and is null once there is none');
  eq(ageHours({ startedAt: 'never' }), null, 'an unparseable start has no age rather than 1970');
}

// ---- the $20 ceiling
{
  const rates = { inPerMillion: 3, outPerMillion: 15, sttPerMinute: 0.006, ttsPerMillionChars: 15 };
  const c = costOf({ inTokens: 1e6, outTokens: 1e6, sttMinutes: 10, ttsChars: 1e6 }, rates);
  eq(c.known, true, 'with a price list the meter works');
  eq(Math.round(c.usd * 100) / 100, 33.06, 'and counts text, speech in AND speech out');
  ok(c.parts.stt > 0 && c.parts.tts > 0,
     'voice is metered on BOTH sides — a ceiling that only watches tokens is not a $20 ceiling');

  const blind = costOf({ inTokens: 1e6 }, null);
  eq(blind.known, false, 'with no price list it says it cannot measure');
  eq(blind.usd, null, 'rather than guessing a number the ceiling is then enforced against');

  const nearly = normaliseSession({ spent: 19.5 });
  eq(canContinue(nearly, { estimate: 0.2 }).ok, true, 'a turn that fits is allowed');
  const over = canContinue(nearly, { estimate: 1.0 });
  eq(over.ok, false, 'one that would cross the line is refused BEFORE it happens — a ceiling you discover you crossed is not a ceiling');
  ok(/\$20/.test(over.text), 'and the message names the limit');
  ok(!/upgrade|more credits|sorry|afraid/i.test(over.text), 'as a fact about a budget, not a rebuke or a sales pitch');
  eq(canContinue(normaliseSession({ spent: 0 }), {}).left, CEILING_USD, 'a fresh session has the whole allowance');
}

// ---- cadence, without a leash
{
  const closed = at => ({ state: 'closed', startedAt: iso(at) });
  const c = cadence([closed(hrs(-24 * 8))], T0);
  eq(c.due, true, 'a week on, a session is due');
  eq(cadence([closed(hrs(-24 * 2))], T0).due, false, 'two days on, it is not');
  eq(cadence([closed(hrs(-24 * 2))], T0).allowed, true,
     'but it is STILL ALLOWED — the cadence is a suggestion, and someone reaching for a session early is the last person to put a gate in front of');
  eq(cadence([], T0).due, true, 'with no history at all, one is due');

  const words = JSON.stringify(cadence([closed(hrs(-24 * 30))], T0)).toLowerCase();
  for (const bad of ['streak', 'missed', 'overdue', 'behind', 'broken']) {
    ok(!words.includes(bad), `nothing says "${bad}" — the likeliest reason to miss a week is the reason you would least want a badge about it`);
  }
}

// ---- mood: two numbers, never a grade
{
  eq(clampMood(0), MOOD_MIN, 'moods are clamped to the scale');
  eq(clampMood(99), MOOD_MAX, 'at both ends');
  eq(clampMood(''), null, 'and an unanswered question is null, not a middling 5');

  const shift = moodShift({ moodIn: 6, moodOut: 4 });
  eq(shift.delta, -2, 'a session can end lower than it started');
  ok(!('good' in shift) && !('failed' in shift) && !('label' in shift),
     'and NOTHING says what that means — a session that ends lower is not a failed session');
  eq(moodShift({ moodIn: 6 }).known, false, 'with one number there is no shift');

  const few = moodTrend([{ state: 'closed', startedAt: iso(hrs(-100)), moodIn: 5 },
                         { state: 'closed', startedAt: iso(hrs(-50)), moodIn: 7 }]);
  eq(few.known, false, `two sessions is not a shape — ${MIN_FOR_TREND} is the floor`);
  ok(/says more than two points can/.test(few.why), 'and it says why rather than drawing the line anyway');

  const many = moodTrend([4, 4, 6, 7].map((m, i) => ({ state: 'closed', startedAt: iso(hrs(-100 + i * 10)), moodIn: m })));
  eq(many.known, true, 'four is enough to say something');
  eq(many.dir, 'up', 'and the direction is available for an axis label');
  ok(!/improv|better|worse|good|bad|well done/i.test(JSON.stringify(many)),
     'with no verdict word anywhere — a red arrow on a dip is a judgement delivered to someone who just said they were struggling');
}

// ---- the shape
{
  eq(normaliseSession({ state: 'vibing' }).state, 'open', 'an unknown state falls back');
  ok(STATES.includes('expired'), 'expiry is a real state, not an absence');
  eq(normaliseSession({}).spent, 0, 'a new session has spent nothing');
  eq(RESOURCES.region, 'IN', 'the helplines are region-specific');
  ok(RESOURCES.verifyBefore, 'and carry a note that they must be verified — a helpline that has moved is worse than no list');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
