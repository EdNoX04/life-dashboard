// Lecture capture — the decisions, separated from the plumbing.
//
// The old recorder took the microphone and ran the browser's speech API. That is
// Chrome-only, degrades badly across an hour, and cannot hear a Teams or Meet
// call at all — it only ever heard Neel's own room.
//
// The rebuild captures the mic AND the shared tab, and samples the slides while
// a professor is screen-sharing. Everything in this file is the part worth
// testing: which frames are worth keeping, what an hour will cost, and what the
// browser will actually give us. The media plumbing lives in the component.

// ---------------------------------------------------------------- what a browser can do
//
// Stated here rather than discovered in front of a lecturer:
//
//   getUserMedia            → the microphone. Always.
//   getDisplayMedia + tab   → video AND audio. This is Meet or Teams in a TAB.
//   getDisplayMedia + window/screen → video only. Chrome on macOS offers audio
//                             for a shared tab and nothing else, so the Teams
//                             DESKTOP app gives slides but no voice unless the
//                             system audio is routed through a virtual device.
//
export const CAPTURE_MODES = {
  mic: { label: 'Microphone only', audio: true, video: false, hint: 'A room you are sitting in.' },
  tab: { label: 'Shared tab + mic', audio: true, video: true, hint: 'Meet or Teams open in a browser tab — voices and slides.' },
  screen: { label: 'Shared screen + mic', audio: false, video: true, hint: 'Teams desktop: slides captured, voice from your mic only.' },
};

export function modeWarning(mode) {
  if (mode === 'screen') {
    return 'Sharing a window or screen gives no system audio on macOS — only your microphone will be heard. '
      + 'Join in a browser tab, or route the audio through a virtual device, to record the lecturer.';
  }
  return '';
}

// ---------------------------------------------------------------- slide sampling
//
// This single number decides whether a lecture costs cents or tens of dollars.
// Sampling a frame per second for 50 minutes is 3,000 images; keeping only the
// frames that MATERIALLY change is roughly 25. Same lecture, two orders of
// magnitude apart.
export const SAMPLE_EVERY_MS = 4000;
export const DIFF_THRESHOLD = 0.035;   // fraction of the thumbnail that changed
export const MAX_SLIDES = 60;          // a hard stop; a lecture is not 200 slides

/**
 * Compare two downscaled greyscale frames.
 *
 * Downscaled on purpose: at full resolution a cursor moving, a webcam thumbnail,
 * or video compression noise all register as change, and every one of those
 * would be paid for as a new slide.
 */
export function frameDifference(a, b) {
  if (!a || !b || a.length !== b.length || !a.length) return 1;
  let changed = 0;
  for (let i = 0; i < a.length; i++) {
    // 18/255 ignores compression shimmer while still catching a line of text.
    if (Math.abs(a[i] - b[i]) > 18) changed++;
  }
  return changed / a.length;
}

export const framesDiffer = (a, b, threshold = DIFF_THRESHOLD) => frameDifference(a, b) >= threshold;

/**
 * Should this frame be kept?
 *
 * A slide that has just appeared is often mid-transition, so a frame is only
 * kept once it has been STABLE for one sample — otherwise a fade between slides
 * is stored as three blurred half-slides and paid for as three.
 */
export function slideDecision({ current, lastKept, lastSeen, keptCount }) {
  if (keptCount >= MAX_SLIDES) return { keep: false, why: 'slide limit reached' };
  if (!lastKept) return { keep: true, why: 'first slide' };
  if (!framesDiffer(lastKept, current)) return { keep: false, why: 'same as the last kept slide' };
  if (lastSeen && framesDiffer(lastSeen, current)) return { keep: false, why: 'still changing — wait for it to settle' };
  return { keep: true, why: 'new and settled' };
}

// ---------------------------------------------------------------- cost
//
// Neel's ceiling is about $1 a lecture. These are rough by design — the point is
// to show the shape before spending, and to make it obvious that slides, not
// speech, are what can run away.
const WORDS_PER_MIN = 130;
const TOKENS_PER_WORD = 1.35;
const TOKENS_PER_IMAGE = 1500;

export function estimateTokens({ minutes = 0, slides = 0 } = {}) {
  const transcript = Math.round(minutes * WORDS_PER_MIN * TOKENS_PER_WORD);
  const images = Math.round(slides * TOKENS_PER_IMAGE);
  return { transcript, images, total: transcript + images };
}

/** Sonnet-ish input pricing, in dollars. Deliberately the expensive assumption. */
export function estimateCost({ minutes = 0, slides = 0 } = {}) {
  const { total } = estimateTokens({ minutes, slides });
  return Math.round((total / 1e6) * 3 * 100) / 100;
}

// ---------------------------------------------------------------- misc
export function fmtElapsed(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const pad = n => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
}

/** Where a finished lecture lands in the vault. */
export function lecturePath({ subject, date }) {
  const slug = String(subject || 'lecture').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'lecture';
  const day = String(date || '').slice(0, 10) || new Date().toISOString().slice(0, 10);
  return `college/lectures/${day}-${slug}.md`;
}
