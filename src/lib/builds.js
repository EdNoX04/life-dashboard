// The overnight factory — rules, not plumbing.
//
// Everything here is pure so the parts that decide whether a build is safe to
// ship can be tested without a network, a clock or a GitHub token. The runner
// supplies those; this file supplies the judgement.

// Six phases. Each is restartable: a crash at 04:00 must not mean starting again
// the next night, because a build that cannot resume is a build that never
// finishes on a laptop that might close its lid.
export const PHASES = ['brief', 'plan', 'generate', 'verify', 'repair', 'ship'];

export const PHASE_AFTER = {
  brief: 'plan', plan: 'generate', generate: 'verify',
  verify: 'ship',            // clean verify skips repair entirely
  repair: 'verify',          // repair loops back to be checked again
  ship: null,
};

// ---------------------------------------------------------------- the window
//
// 02:00–06:00 local. Expressed as a predicate rather than a cron line because the
// runner must also STOP at the boundary: a process that only checks the clock on
// launch will happily still be generating at 09:00.

export const WINDOW = { startHour: 2, endHour: 6 };

export function inWindow(date, { startHour, endHour } = WINDOW) {
  const h = date.getHours() + date.getMinutes() / 60;
  return h >= startHour && h < endHour;
}

// Minutes left before the window closes. The runner checks this before starting
// any phase and stops cleanly rather than being killed mid-file — an interrupted
// generate leaves a half-written repo that looks finished.
export function minutesLeft(date, { endHour } = WINDOW) {
  const end = new Date(date);
  end.setHours(endHour, 0, 0, 0);
  return Math.max(0, Math.round((end.getTime() - date.getTime()) / 60000));
}

// ---------------------------------------------------------- request budgeting
//
// NVIDIA's free tier allows 40 requests a minute. That ceiling is not the real
// constraint — a normal build is nowhere near it — so the numbers below are
// deliberately conservative. The limit only ever binds during a retry storm, and
// the cost of tripping it is the whole night.

export const RPM = 20;              // half the ceiling, so a burst cannot trip it
export const NIGHTLY_CAP = 600;     // ends the run cleanly rather than at 06:00 mid-file
export const BACKOFF_MS = [2000, 8000, 30000, 120000];
export const MAX_RETRIES = BACKOFF_MS.length;

export function minGapMs(rpm = RPM) { return Math.ceil(60000 / rpm); }

// Returns how long to wait before the next request, given when the last one went.
// Zero means go now.
export function waitFor(lastAt, now, rpm = RPM) {
  if (!lastAt) return 0;
  const gap = now - lastAt;
  return Math.max(0, minGapMs(rpm) - gap);
}

export function backoffFor(attempt) {
  return BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
}

/**
 * May another request be spent?
 *
 * Three ways to say no, and they are different states rather than one. "Out of
 * budget" is a finished run; "out of time" is a resumable one; "too many retries"
 * is a stuck phase that should fail loudly rather than eat the night. Collapsing
 * them into a boolean is how a stuck build spends 600 requests failing.
 */
export function canSpend({ used = 0, cap = NIGHTLY_CAP, now, attempts = 0 } = {}) {
  if (attempts >= MAX_RETRIES) return { ok: false, why: 'retries', message: `gave up after ${MAX_RETRIES} attempts on one step` };
  if (used >= cap) return { ok: false, why: 'budget', message: `nightly cap of ${cap} requests reached` };
  if (now && !inWindow(now)) return { ok: false, why: 'window', message: 'outside the 02:00–06:00 window' };
  return { ok: true, why: null, message: '' };
}

// ------------------------------------------------------------------- safety
//
// These are the rules that must hold even when everything else has gone wrong at
// four in the morning with nobody watching.

// Repo names the runner may create. Anything that could collide with something
// that already matters is refused rather than sanitised — silently renaming a
// repo is how you end up pushing to the wrong one.
const NAME_OK = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
export const PROTECTED_REPOS = ['life-dashboard', 'dotfiles', '.github'];

export function repoNameOf(idea = '') {
  return String(idea).toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
    .replace(/-+$/, '');
}

export function canCreateRepo(name) {
  const n = String(name || '');
  // Protected FIRST. `.github` fails the name pattern anyway, so the refusal was
  // correct either way — but it reported "not a usable repo name", which is the
  // wrong reason and would send someone off fixing the name. A protected repo is
  // refused because of what it is, and the message should say so.
  if (PROTECTED_REPOS.includes(n)) return { ok: false, why: 'protected', message: `${n} already means something` };
  if (!NAME_OK.test(n)) return { ok: false, why: 'name', message: 'not a usable repo name' };
  return { ok: true, why: null, message: '' };
}

// A generative loop with write access to the repo it lives in is one bad night
// away from destroying the thing that runs it. Stated as a function so it is
// testable, not as a convention someone remembers.
//
// The rule is NOT "only repos created tonight" — that was the first draft, and it
// made the factory a one-shot. The point of this thing is a small idea that grows
// over several nights: v0.1 on Monday, the layout fixed on Tuesday, auth added on
// Thursday. So the runner may push to a repo it created ON ANY PREVIOUS NIGHT,
// identified by the URL stored on the build row rather than by name.
//
// That distinction is the whole safety property. `ownedUrl` comes from our own
// database, written by the runner when it created the repo. A name can be typed,
// guessed, or collided with; a URL we wrote down after creating it cannot be any
// of those. So: match on what we recorded, never on what was supplied.
export function isPushAllowed({ targetUrl = '', ownedUrl = '', isNew = false, private: priv = true } = {}) {
  if (!priv) return { ok: false, why: 'public', message: 'generated repos are created private and the runner never flips that' };
  if (isNew) return { ok: true, why: null, message: '' };
  if (!ownedUrl) return { ok: false, why: 'unowned', message: 'no repo on this build was created by the runner' };
  if (normUrl(targetUrl) !== normUrl(ownedUrl)) {
    return { ok: false, why: 'mismatch', message: 'that is not the repo this build created' };
  }
  return { ok: true, why: null, message: '' };
}

// Trailing slashes, .git suffixes and case differences are the same repo, and a
// string comparison that says otherwise would block every legitimate second night.
function normUrl(u) {
  return String(u || '').trim().toLowerCase().replace(/\.git$/, '').replace(/\/+$/, '');
}

// ---------------------------------------------------------------- iterations
//
// A build is not finished when it ships; it is finished when Neel stops asking
// for more. Each night reads the notes left since the last run and treats them as
// the brief for this one.

export function nextIteration({ status, notes = [], iteration = 0 } = {}) {
  const fresh = (notes || []).filter(n => n && !n.done);
  // Nothing asked for means nothing to do. A factory that regenerates an
  // untouched repo every night burns the budget and churns the diff for nobody.
  if (status === 'done' && !fresh.length) return null;
  return {
    iteration: (Number(iteration) || 0) + 1,
    // The first night builds from the idea; every night after builds from what
    // was asked for since. Sending the original brief again on night four would
    // regenerate work that already exists.
    brief: fresh.length ? fresh.map(n => n.text).join('\n') : null,
    kind: status === 'done' ? 'improve' : 'continue',
  };
}

// Key-shaped strings in generated code. A build that would publish a credential
// fails instead of shipping — even a fake one, because a fake key in a committed
// file is indistinguishable from a real one to everyone who reads it later.
const SECRET_PATTERNS = [
  /\bsk-ant-[A-Za-z0-9_-]{8,}/,
  /\bnvapi-[A-Za-z0-9_-]{8,}/,
  /\bsk-[A-Za-z0-9]{20,}/,
  /\bghp_[A-Za-z0-9]{20,}/,
  /\bAIza[A-Za-z0-9_-]{20,}/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

export function findSecrets(files = {}) {
  const hits = [];
  for (const [path, body] of Object.entries(files)) {
    for (const re of SECRET_PATTERNS) {
      const m = re.exec(String(body || ''));
      if (m) hits.push({ path, match: m[0].slice(0, 12) + '…' });
    }
  }
  return hits;
}

// --------------------------------------------------------------- progression

export function nextPhase(phase, { verifyClean = false, repairRounds = 0 } = {}) {
  if (phase === 'verify') return verifyClean ? 'ship' : (repairRounds < MAX_REPAIR ? 'repair' : 'failed');
  return PHASE_AFTER[phase] ?? null;
}

// Three rounds. A fourth almost never converges and spends the night's remaining
// budget proving it — better to hand over a repo that builds with two known test
// failures and a note saying so.
export const MAX_REPAIR = 3;

export function summarise(b = {}) {
  const used = Number(b.requests_used) || 0;
  const pct = Math.round((used / NIGHTLY_CAP) * 100);
  return {
    phase: b.phase || 'brief',
    used,
    pct,
    // Named rather than implied: "done" and "done with known failures" are
    // different mornings, and a tab that shows the same green tick for both is
    // lying by omission.
    label: b.status === 'done' && b.verify_failures
      ? `built, ${b.verify_failures} check(s) still failing`
      : b.status === 'done' ? 'built and verified'
      : b.status === 'failed' ? (b.fail_reason || 'failed')
      : `${b.phase || 'queued'}…`,
  };
}
