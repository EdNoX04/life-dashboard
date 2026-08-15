// The overnight factory.
//
// This thing runs at four in the morning with nobody watching, holds a GitHub
// token, and writes code it then executes. Most of what follows is not about
// whether it builds well — it is about what it must refuse to do when something
// has already gone wrong and there is no one to notice.

import {
  PHASES, inWindow, minutesLeft, WINDOW,
  RPM, NIGHTLY_CAP, MAX_RETRIES, minGapMs, waitFor, backoffFor, canSpend,
  repoNameOf, canCreateRepo, isPushAllowed, PROTECTED_REPOS,
  findSecrets, nextPhase, MAX_REPAIR, summarise,
} from '../src/lib/builds.js';

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; } else { fail++; console.log('FAIL ' + name); } };
const eq = (a, b, name) => ok(a === b, `${name} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const at = (h, m = 0) => { const d = new Date('2026-08-16T00:00:00'); d.setHours(h, m, 0, 0); return d; };

// ------------------------------------------------------------- the window

eq(inWindow(at(3)), true, '03:00 is inside the window');
eq(inWindow(at(2)), true, 'the window opens at 02:00 exactly');
eq(inWindow(at(6)), false, 'and closes at 06:00 exactly');
eq(inWindow(at(1, 59)), false, 'a minute early is outside');
eq(inWindow(at(14)), false, 'the afternoon is not the night');

// The runner must STOP at the boundary, not merely start inside it. A process
// that checks the clock only on launch is happily still generating at 09:00.
eq(minutesLeft(at(5, 30)), 30, 'half an hour left at 05:30');
eq(minutesLeft(at(6, 30)), 0, 'and nothing left once the window has closed');
ok(minutesLeft(at(2)) === 240, 'a full run is four hours');

// -------------------------------------------------------- the request budget

ok(RPM <= 20, 'the pacing is at most half NVIDIA\'s 40/min ceiling');
eq(minGapMs(20), 3000, 'which is one request every three seconds');
eq(waitFor(null, 1000), 0, 'the first request goes immediately');
eq(waitFor(1000, 1500), 2500, 'a request too soon waits out the gap');
eq(waitFor(1000, 9000), 0, 'and a request after the gap does not wait at all');

// Backoff must grow, and must stop growing. An unbounded schedule sleeps past
// dawn on a service that is simply down.
ok(backoffFor(0) < backoffFor(1) && backoffFor(1) < backoffFor(2), 'backoff grows');
eq(backoffFor(99), backoffFor(MAX_RETRIES - 1), 'and is clamped rather than unbounded');

// Three refusals that are genuinely different mornings. Collapsing them into one
// boolean is how a stuck phase spends 600 requests failing at the same step.
eq(canSpend({ used: 10, now: at(3) }).ok, true, 'mid-window with budget left, go');
eq(canSpend({ used: NIGHTLY_CAP, now: at(3) }).why, 'budget', 'out of budget is a finished run');
eq(canSpend({ used: 10, now: at(7) }).why, 'window', 'out of time is a resumable one');
eq(canSpend({ used: 10, now: at(3), attempts: MAX_RETRIES }).why, 'retries', 'a stuck step fails loudly instead of eating the night');
ok(NIGHTLY_CAP < 40 * 60 * 4, 'the nightly cap is well under what the rate limit alone would allow');

// ------------------------------------------------------------------ repos

eq(repoNameOf('Expense Splitter!'), 'expense-splitter', 'an idea becomes a repo name');
eq(repoNameOf('  A  Modern   Farewell  '), 'a-modern-farewell', 'and collapses its whitespace');
ok(canCreateRepo('expense-splitter').ok, 'a clean name is allowed');
ok(!canCreateRepo('x').ok, 'a one-character name is not');
ok(!canCreateRepo('Has Spaces').ok, 'nor is anything GitHub would reject');

// THE rule. A generative loop with write access to the repo it lives in is one
// bad night from destroying the thing that runs it.
for (const p of PROTECTED_REPOS) {
  eq(canCreateRepo(p).why, 'protected', `${p} is refused outright, not renamed`);
}
ok(PROTECTED_REPOS.includes('life-dashboard'), 'and this repo is on that list');

eq(isPushAllowed({ repoExists: true, isNew: false }).why, 'existing',
   'the runner never pushes to a repo it did not just create');
eq(isPushAllowed({ isNew: true, private: false }).why, 'public',
   'and never to a public one');
ok(isPushAllowed({ isNew: true, private: true }).ok, 'a fresh private repo is the only allowed target');

// ---------------------------------------------------------------- secrets

// Even a fake key fails the build. A fake key in a committed file is
// indistinguishable from a real one to everyone who reads it afterwards, and the
// person who has to decide is never the person who generated it.
const dirty = findSecrets({
  'src/api.js': 'const key = "sk-ant-abcdefghijklmno";',
  'README.md': 'set NVIDIA_API_KEY in your env',
});
eq(dirty.length, 1, 'a key-shaped string is caught');
eq(dirty[0].path, 'src/api.js', 'and named by file');
ok(!/abcdefghijklmno/.test(JSON.stringify(dirty)), 'while the report itself does not reprint the whole thing');

eq(findSecrets({ 'a.js': 'const k = process.env.API_KEY;' }).length, 0,
   'reading a key from the environment is the correct pattern and is not flagged');
eq(findSecrets({}).length, 0, 'no files, no findings');

for (const [label, body] of [
  ['github token', 'ghp_0123456789abcdefghij0123'],
  ['google key', 'AIzaSyA0123456789abcdefghijklmnop'],
  ['private key', '-----BEGIN RSA PRIVATE KEY-----'],
]) {
  eq(findSecrets({ 'f.txt': body }).length, 1, `${label} is caught too`);
}

// ------------------------------------------------------------- progression

eq(nextPhase('brief'), 'plan', 'brief leads to plan');
eq(nextPhase('verify', { verifyClean: true }), 'ship', 'a clean verify ships');
eq(nextPhase('verify', { verifyClean: false, repairRounds: 0 }), 'repair', 'a dirty one repairs');
eq(nextPhase('verify', { verifyClean: false, repairRounds: MAX_REPAIR }), 'failed',
   'but only three times — a fourth round almost never converges and spends the rest of the night proving it');
eq(nextPhase('ship'), null, 'shipping ends the run');
eq(PHASES.length, 6, 'six phases, each restartable');

// ---------------------------------------------------------------- the tab

// "Done" and "done with known failures" are different mornings. A tab showing the
// same green tick for both is lying by omission.
ok(/still failing/.test(summarise({ status: 'done', verify_failures: 2 }).label),
   'a build that shipped with failures says so');
eq(summarise({ status: 'done' }).label, 'built and verified', 'and a clean one says that instead');
eq(summarise({ status: 'failed', fail_reason: 'out of budget' }).label, 'out of budget',
   'a failure carries its reason rather than the word "failed"');

console.log(`${pass}/${pass + fail} passing`);
if (fail) process.exit(1);
