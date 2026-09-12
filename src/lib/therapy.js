// The session backbone — lifecycle, cost, mood, and the things that override
// all three.
//
// No chat code here and none intended: this file decides when a session is
// open, when it has expired, what it costs, what may be stored where, and what
// happens when something more important than a session appears. The
// conversation is built on top of it, and every rule below is a test rather
// than a decision made inside a UI at two in the morning.
//
// ─────────────────────────────────────────────────────────────────────────
// FIRST, THE THING THAT IS NOT TRUE AND MUST NOT BE CLAIMED
//
// "End to end encryption during the convo" cannot mean what it usually means.
// The model has to READ the words to answer them — whatever serves the session
// sees plaintext at the moment of inference. That is what inference is, and no
// amount of crypto in the browser changes it.
//
// What is real, and worth having:
//   * nothing is ever STORED in plaintext — not Supabase, not localStorage,
//     not the vault;
//   * the key is derived in the browser from a passphrase only Neel knows, and
//     the server never holds it;
//   * the transcript never touches Supabase at all;
//   * losing the passphrase loses the transcripts, permanently.
//
// The honest name is ENCRYPTED AT REST WITH A CLIENT-HELD KEY. `privacyClaim()`
// below is the exact wording the screen must use, kept here so no component can
// quietly upgrade the promise. A feature that overstates its privacy is worse
// than one that has less of it, because it changes what someone is willing to
// type.
//
// ─────────────────────────────────────────────────────────────────────────
// SECOND, THE THINGS THAT OVERRIDE EVERYTHING
//
//   1. This is not a clinician and never presents as one.
//   2. If risk of harm appears, the session STOPS BEING A SESSION. Resources
//      are surfaced, plainly, and the exercise does not continue. No summary,
//      no mood number, no cost ceiling and no weekly cadence is more important
//      than that — `blocked()` returns true and every other gate is moot.
//   3. Nothing here may scold. A weekly line that goes down is a fact; a red
//      arrow on it is a judgement delivered to someone who just said they were
//      struggling. No streaks, and never "you missed a week" — the likeliest
//      reason to miss one is the reason you would least want a badge about.

const str = v => String(v ?? '').trim();
const amt = v => {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// ---------------------------------------------------------------- lifecycle

export const STATES = ['open', 'paused', 'expired', 'closed'];

/**
 * Thirty hours from when it STARTED, not from the last message.
 *
 * Sliding the window on every message means a session paused on Monday and
 * poked on Wednesday is still "today's session", which it plainly is not. A
 * fixed window from the start is the only reading under which "valid up to 30
 * hours" means anything.
 */
export const VALID_HOURS = 30;
export const MS = 3600000;

export function normaliseSession(s = {}) {
  const state = STATES.includes(s.state) ? s.state : 'open';
  return {
    id: str(s.id) || `s${Date.now()}${Math.random().toString(36).slice(2, 8)}`,
    startedAt: Number.isFinite(Date.parse(s.startedAt ?? '')) ? s.startedAt : null,
    endedAt: Number.isFinite(Date.parse(s.endedAt ?? '')) ? s.endedAt : null,
    state,
    // 1–10, asked at the start and again at the end. Two numbers, never a grade.
    moodIn: clampMood(s.moodIn),
    moodOut: clampMood(s.moodOut),
    // Dollars spent so far, across every meter.
    spent: amt(s.spent) ?? 0,
    turns: amt(s.turns) ?? 0,
    // Written when the session closes. The ONLY thing the app displays.
    summary: str(s.summary),
    // Where the ciphertext went. Never the text itself.
    vaultPath: str(s.vaultPath),
    crisis: !!s.crisis,
  };
}

export const MOOD_MIN = 1, MOOD_MAX = 10;
export function clampMood(v) {
  const n = amt(v);
  if (n === null) return null;
  return Math.max(MOOD_MIN, Math.min(MOOD_MAX, Math.round(n)));
}

export function ageHours(session, now = Date.now()) {
  const t = Date.parse(session?.startedAt ?? '');
  return Number.isFinite(t) ? (now - t) / MS : null;
}

/**
 * What state a session is ACTUALLY in, which is not always what it says.
 *
 * A session left open on a closed laptop is neither open nor finished, and that
 * is the state that quietly loses work — the same failure as a stale Hermes
 * claim, and it gets the same treatment: a deadline, and a transition the
 * system makes on its own rather than waiting to be told.
 */
export function stateOf(session, now = Date.now()) {
  const s = normaliseSession(session);
  if (s.state === 'closed') return 'closed';
  if (!s.startedAt) return 'open';
  const age = ageHours(s, now);
  if (age !== null && age >= VALID_HOURS) return 'expired';
  return s.state === 'paused' ? 'paused' : 'open';
}

export const isLive = (s, now) => ['open', 'paused'].includes(stateOf(s, now));

/** Hours left before it closes itself. Null when it already has. */
export function hoursLeft(session, now = Date.now()) {
  const age = ageHours(session, now);
  if (age === null) return null;
  const left = VALID_HOURS - age;
  return left > 0 ? left : null;
}

// --------------------------------------------------------------- the ceiling

export const CEILING_USD = 20;

/**
 * Rates are INJECTED, never guessed.
 *
 * A hardcoded price is wrong the week after it is written, and a cost meter
 * that is quietly wrong is worse than none — it is the number the ceiling is
 * enforced against. With no rates the meter says it cannot measure, and
 * `canContinue` refuses rather than assuming the session is cheap.
 */
export function costOf(usage = {}, rates = null) {
  if (!rates) return { known: false, usd: null, why: 'no price list — nothing can be metered without one' };
  const inTok = amt(usage.inTokens) ?? 0;
  const outTok = amt(usage.outTokens) ?? 0;
  const sttMin = amt(usage.sttMinutes) ?? 0;
  const ttsChars = amt(usage.ttsChars) ?? 0;
  const r = {
    inPerM: amt(rates.inPerMillion) ?? 0,
    outPerM: amt(rates.outPerMillion) ?? 0,
    sttPerMin: amt(rates.sttPerMinute) ?? 0,
    ttsPerM: amt(rates.ttsPerMillionChars) ?? 0,
  };
  const usd = (inTok / 1e6) * r.inPerM + (outTok / 1e6) * r.outPerM
    + sttMin * r.sttPerMin + (ttsChars / 1e6) * r.ttsPerM;
  return { known: true, usd, parts: { text: (inTok / 1e6) * r.inPerM + (outTok / 1e6) * r.outPerM, stt: sttMin * r.sttPerMin, tts: (ttsChars / 1e6) * r.ttsPerM } };
}

/**
 * Whether the next turn may happen — checked BEFORE it, never after.
 *
 * A ceiling you discover you have crossed is not a ceiling. `estimate` is the
 * worst-case cost of the turn about to be taken; if spending it would cross the
 * line, the turn does not happen.
 *
 * VOICE COUNTS. The transcription going in and the speech coming out are two
 * more meters, and a ceiling that only watches tokens is not a $20 ceiling.
 */
export function canContinue(session, { estimate = 0, ceiling = CEILING_USD } = {}) {
  const s = normaliseSession(session);
  const est = amt(estimate) ?? 0;
  const cap = amt(ceiling) ?? CEILING_USD;
  if (s.spent + est > cap) {
    return {
      ok: false, reason: 'ceiling',
      // Said as a fact about a budget, not as a rebuke or a sales pitch.
      text: `This session has reached its $${cap} limit. It will write its summary now; the next one starts fresh.`,
      spent: s.spent, ceiling: cap,
    };
  }
  return { ok: true, spent: s.spent, ceiling: cap, left: cap - s.spent };
}

// ------------------------------------------------------------------ the line
//
// A net, not a filter. The model is instructed too, and EITHER can raise it —
// this exists so that a miss by one is not a miss by the system. It is
// deliberately broad and will sometimes fire on a song lyric or a figure of
// speech; showing a number to someone who did not need it costs them two
// seconds, and the other error costs something that cannot be undone.

const RISK = [
  /\b(kill|hurt|harm|cut|end)(ing)?\s+(myself|me)\b/i,
  /\bsuicid(e|al)\b/i,
  /\bwant(ed)?\s+to\s+die\b/i,
  /\bdon'?t\s+want\s+to\s+(be\s+here|live|wake up)\b/i,
  /\bno\s+(point|reason)\s+(in\s+)?(living|going on)\b/i,
  /\bbetter\s+off\s+(without me|dead)\b/i,
  /\bend\s+(it|my life)\b/i,
  // Word endings matter in a net: "self-harming" and "overdosed" both failed a
  // \b-terminated match because the word carries on. Broad on purpose.
  /\bself[-\s]?harm\w*/i,
  /\boverdos\w+/i,
];

export const mentionsRisk = text => RISK.some(re => re.test(str(text)));

/**
 * Region-specific and MUST be verified before this ships.
 *
 * Written down here rather than in a component so there is one place to check
 * and one place to correct. A helpline that has moved is worse than no list:
 * someone dials it at the worst possible moment and gets a dead tone.
 */
export const RESOURCES = {
  region: 'IN',
  verifyBefore: 'first release',
  lines: [
    { name: 'Tele-MANAS', number: '14416', note: "India's national mental health helpline, 24×7, free" },
    { name: 'KIRAN', number: '1800-599-0019', note: 'Ministry of Social Justice helpline, 24×7, free' },
  ],
};

/**
 * The override.
 *
 * When this returns true the session is NOT a session any more: no exercise
 * continues, no mood number is collected, no summary is written as if the hour
 * went normally. Every other gate in this file is moot — `blocked()` is checked
 * first and nothing overrules it.
 */
export function crisisCheck(text, { flaggedByModel = false } = {}) {
  const hit = mentionsRisk(text) || flaggedByModel;
  if (!hit) return { blocked: false };
  return {
    blocked: true,
    resources: RESOURCES,
    // No wall of caveats in front of it, and no "as an AI". Someone reading
    // this is not looking for a disclaimer.
    text: 'This sounds heavier than a check-in, and I would rather point you at someone who can actually help than keep going with the session.',
  };
}

export const blocked = (session, text, opts) => !!session?.crisis || crisisCheck(text, opts).blocked;

// ------------------------------------------------------------------- cadence

export const WEEK_MS = 7 * 24 * MS;

/**
 * Whether a session is "due". A DEFAULT, never a lock.
 *
 * `allowed` is always true. Offering a second session in a week should not
 * require an argument with the app — the cadence is a suggestion about when to
 * expect one, and someone reaching for it early is the last person to put a
 * gate in front of.
 */
export function cadence(sessions, now = Date.now()) {
  const done = (Array.isArray(sessions) ? sessions : [])
    .map(normaliseSession)
    .filter(s => s.state === 'closed' && s.startedAt)
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  const last = done[0] || null;
  const since = last ? (now - Date.parse(last.startedAt)) / MS : null;
  return {
    allowed: true,
    last: last?.startedAt || null,
    hoursSince: since,
    due: since === null || since >= WEEK_MS / MS,
    // Deliberately absent: any notion of a streak, a missed week, or a run.
  };
}

// ------------------------------------------------------------- how it is going

export const MIN_FOR_TREND = 4;

/**
 * Mood over time — reported, never scored.
 *
 * Below four closed sessions there is no shape to read, and drawing a line
 * through two points invites a conclusion the data cannot carry. Above it, the
 * answer is a direction and the count behind it, with NO verdict word: not
 * "improving", not "worse", not a colour. `dir` is for an axis label, and the
 * component is forbidden from adding an arrow to it.
 */
export function moodTrend(sessions, { minSessions = MIN_FOR_TREND } = {}) {
  const pts = (Array.isArray(sessions) ? sessions : [])
    .map(normaliseSession)
    .filter(s => s.state === 'closed' && s.startedAt && s.moodIn !== null)
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))
    .map(s => ({ at: s.startedAt, in: s.moodIn, out: s.moodOut }));

  if (pts.length < minSessions) {
    return { known: false, points: pts, n: pts.length, why: `${pts.length} session(s) so far — a shape needs at least ${minSessions}, and a line through two points says more than two points can` };
  }
  const half = Math.floor(pts.length / 2);
  const avg = a => a.reduce((t, p) => t + p.in, 0) / a.length;
  const delta = avg(pts.slice(pts.length - half)) - avg(pts.slice(0, half));
  return {
    known: true, points: pts, n: pts.length, delta,
    dir: Math.abs(delta) < 0.5 ? 'level' : (delta > 0 ? 'up' : 'down'),
  };
}

/**
 * Within one session: how it started and how it ended.
 *
 * A session that ends lower than it started is NOT a failed session, and this
 * returns two numbers and a difference with no language attached so that
 * nothing downstream can imply otherwise.
 */
export function moodShift(session) {
  const s = normaliseSession(session);
  if (s.moodIn === null || s.moodOut === null) return { known: false };
  return { known: true, in: s.moodIn, out: s.moodOut, delta: s.moodOut - s.moodIn };
}

// ------------------------------------------------------------------- storage

/**
 * What may be written where. The whole privacy design in one object, so a
 * component cannot quietly put a transcript somewhere convenient.
 */
export const STORAGE = {
  transcript: { where: 'vault', encrypted: true, plaintextAnywhere: false, supabase: false },
  summary: { where: 'supabase', encrypted: false, note: 'the only thing the app displays' },
  mood: { where: 'supabase', encrypted: false, note: 'two integers' },
  key: { where: 'nowhere', note: 'derived in the browser from a passphrase; the server never holds it' },
};

/** The exact sentence the screen must show. Kept here so it cannot drift. */
export const privacyClaim = () => [
  'Encrypted at rest with a key only you hold. The transcript is encrypted in your browser and stored in your vault; this app keeps only the summary and two numbers.',
  'The model that answers you sees what you type — that is how a reply is possible at all, and no setting changes it.',
  'If you lose the passphrase, the transcripts are gone. There is no recovery and no copy.',
].join(' ');

/** Everything the app is allowed to render for a session. */
export function redactForApp(session) {
  const s = normaliseSession(session);
  return {
    id: s.id, startedAt: s.startedAt, endedAt: s.endedAt, state: s.state,
    moodIn: s.moodIn, moodOut: s.moodOut, summary: s.summary,
    spent: s.spent, turns: s.turns, vaultPath: s.vaultPath, crisis: s.crisis,
  };
}
