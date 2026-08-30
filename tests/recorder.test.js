// Pins the two decisions that make or break lecture capture: which frames are
// worth keeping, and what that costs.
//
// The old recorder heard only Neel's own room and transcribed with the browser's
// speech API. The rebuild captures the lecturer and the slides — and slide
// sampling is where a $0.14 lecture becomes a $13 one, so it gets tested rather
// than tuned by eye.

import {
  frameDifference, framesDiffer, slideDecision, estimateTokens, estimateCost,
  fmtElapsed, lecturePath, modeWarning, CAPTURE_MODES, MAX_SLIDES, DIFF_THRESHOLD,
} from '../src/lib/recorder.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log('FAIL ' + n); } };
const is = (a, b, n) => ok(Object.is(a, b), `${n} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
const frame = (fill, changes = 0) => {
  const f = new Uint8Array(1000).fill(fill);
  for (let i = 0; i < changes; i++) f[i] = fill > 127 ? 0 : 255;
  return f;
};

// ---------------------------------------------------------------- comparing frames
is(frameDifference(frame(50), frame(50)), 0, 'identical frames differ by nothing');
is(frameDifference(frame(50), frame(50, 50)), 0.05, '50 of 1000 pixels is 5%');
is(frameDifference(null, frame(50)), 1, 'a missing frame counts as completely different');
is(frameDifference(frame(50), new Uint8Array(10)), 1, 'so does a size mismatch — never a false "same"');

// Compression shimmer and a moving cursor must not read as a new slide; each one
// kept is an image paid for.
const shimmer = frame(50);
for (let i = 0; i < 1000; i++) shimmer[i] = 50 + (i % 3) * 5;   // ±10, under the 18 floor
ok(!framesDiffer(frame(50), shimmer), 'small per-pixel noise is not a slide change');
ok(!framesDiffer(frame(50), frame(50, 20)), '2% of the frame changing is a cursor, not a slide');
ok(framesDiffer(frame(50), frame(50, 200)), '20% changing is a slide');
ok(DIFF_THRESHOLD > 0.02 && DIFF_THRESHOLD < 0.1, 'the threshold sits between a cursor and a slide');

// ---------------------------------------------------------------- keeping slides
const A = frame(50), B = frame(200), MID = frame(120);
is(slideDecision({ current: A, lastKept: null, lastSeen: null, keptCount: 0 }).keep, true, 'the first slide is always kept');
is(slideDecision({ current: A, lastKept: A, lastSeen: A, keptCount: 1 }).keep, false, 'an unchanged slide is not kept again');
is(slideDecision({ current: B, lastKept: A, lastSeen: B, keptCount: 1 }).keep, true, 'a new, settled slide is kept');

// The transition case. Without it a fade between slides is stored as three
// blurred half-slides and paid for three times.
is(slideDecision({ current: MID, lastKept: A, lastSeen: A, keptCount: 1 }).keep, false, 'a frame still mid-transition is skipped');
ok(/settle/.test(slideDecision({ current: MID, lastKept: A, lastSeen: A, keptCount: 1 }).why), 'and says why');

is(slideDecision({ current: B, lastKept: A, lastSeen: B, keptCount: MAX_SLIDES }).keep, false, 'the hard limit stops runaway capture');

// ---------------------------------------------------------------- cost
// The whole argument for sampling, in two numbers.
const sane = estimateCost({ minutes: 50, slides: 25 });
const naive = estimateCost({ minutes: 50, slides: 3000 });
ok(sane < 1, `a 50-minute lecture with 25 slides is under $1 (got $${sane})`);
ok(naive > 10, `sampling every second instead would be over $10 (got $${naive})`);
ok(naive / sane > 50, 'two orders of magnitude apart — this is where the budget is won');

const t = estimateTokens({ minutes: 50, slides: 25 });
ok(t.transcript > 5000, 'an hour of speech is thousands of tokens');
ok(t.images > t.transcript, 'and the slides still outweigh it — which is the point');
is(estimateCost({}).valueOf(), 0, 'nothing recorded costs nothing');

// ---------------------------------------------------------------- capture modes
ok(CAPTURE_MODES.tab.audio && CAPTURE_MODES.tab.video, 'a shared tab gives both audio and slides');
ok(CAPTURE_MODES.screen.video && !CAPTURE_MODES.screen.audio, 'a shared screen gives slides but no system audio');
ok(/macOS/.test(modeWarning('screen')), 'and the UI warns about it before the lecture, not after');
is(modeWarning('tab'), '', 'a tab share needs no warning');

// ---------------------------------------------------------------- odds and ends
is(fmtElapsed(0), '0:00', 'zero');
is(fmtElapsed(75), '1:15', 'minutes and seconds');
is(fmtElapsed(3725), '1:02:05', 'past an hour it grows an hours field — lectures do run long');
is(fmtElapsed(-5), '0:00', 'negative time is not displayed as negative');

is(lecturePath({ subject: 'IoT System Design', date: '2026-08-30' }), 'college/lectures/2026-08-30-iot-system-design.md',
  'a lecture lands somewhere the indexer already reads');
ok(lecturePath({}).startsWith('college/lectures/'), 'even with nothing filled in');
ok(!/[^a-z0-9/.-]/.test(lecturePath({ subject: 'Prof. Sharma / ANS!!' })),
  'the path is scrubbed — vault_inbox would reject odd characters anyway');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
