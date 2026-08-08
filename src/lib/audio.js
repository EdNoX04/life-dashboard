// Audio sources and what each one can actually deliver.
//
// The brief was "either music streaming service I choose, it gives bit perfect
// music". That is not achievable for three of the four sources, and the honest
// thing is to encode why rather than print a BIT PERFECT badge that is a lie.
//
// What "bit perfect" means: the samples that reach the DAC are byte-identical
// to the samples in the file — no lossy codec, no resampling, no volume applied
// in software, no mixing with other streams. Two separate things have to hold.
//
//   THE SOURCE has to be lossless. Spotify's Web Playback SDK tops out at
//   256–320 kbps Ogg Vorbis and exposes no raw audio; Apple Music's MusicKit JS
//   serves 256 kbps AAC in the browser even though the native apps do ALAC;
//   YouTube Music serves Opus, typically ~256 kbps. All three are lossy by
//   construction, and no amount of client work recovers discarded data.
//
//   THE PATH has to be untouched. Even a genuine FLAC played in a browser goes
//   through the OS mixer, which resamples everything to one shared device rate.
//   True bit-perfect needs exclusive device access — WASAPI exclusive mode on
//   Windows, hog mode on macOS — and a web page cannot request it.
//
// So the ceiling in a browser is: LOSSLESS DECODE, SHARED PATH. That is a real
// and worthwhile thing — a FLAC decoded losslessly and resampled once by the OS
// is audibly better than a 256 kbps AAC — but it is not bit-perfect, and this
// module says so rather than blurring the two.

export const TIERS = {
  lossy: { key: 'lossy', label: 'LOSSY', rank: 1, color: 'var(--orange)' },
  lossless: { key: 'lossless', label: 'LOSSLESS', rank: 2, color: 'var(--green)' },
  hires: { key: 'hires', label: 'HI-RES', rank: 3, color: 'var(--cyan)' },
};

export const SOURCES = [
  {
    key: 'local',
    name: 'Local files',
    label: 'LOCAL FILES',
    color: 'var(--green)',
    tier: 'lossless',
    // The only source whose ceiling is set by your files rather than by a
    // service's licence terms.
    ceiling: null,
    needs: null,
    canBePerfect: false,
    note: 'Decoded losslessly from your own files. The browser still hands the result to the OS mixer, which resamples to the shared device rate — so this is lossless decode, not bit-perfect output.',
  },
  {
    key: 'spotify',
    name: 'Spotify',
    label: 'SPOTIFY',
    color: 'var(--green)',
    tier: 'lossy',
    ceiling: 320,
    needs: 'A Spotify Premium account and a developer app you register yourself (for the client ID). Playback runs through the Web Playback SDK.',
    canBePerfect: false,
    note: 'The Web Playback SDK decodes Ogg Vorbis at up to 320 kbps and exposes no raw audio stream. Lossless is not reachable from a browser at any setting.',
  },
  {
    key: 'apple',
    name: 'Apple Music',
    label: 'APPLE MUSIC',
    color: 'var(--pink)',
    tier: 'lossy',
    ceiling: 256,
    needs: 'An Apple Music subscription and a MusicKit developer token, which requires a paid Apple Developer account.',
    canBePerfect: false,
    note: 'Apple streams ALAC and hi-res to its native apps, but MusicKit JS in a browser is 256 kbps AAC. The lossless tier you pay for is not exposed to the web.',
  },
  {
    key: 'ytmusic',
    name: 'YouTube Music',
    label: 'YOUTUBE MUSIC',
    color: 'var(--red)',
    tier: 'lossy',
    ceiling: 256,
    needs: 'Nothing — playback runs through the YouTube IFrame player, the same route the lofi radio already uses.',
    canBePerfect: false,
    note: 'Opus at roughly 256 kbps at best. No lossless tier exists on YouTube Music at all, so no configuration reaches one.',
  },
];

export const sourceOf = key => SOURCES.find(s => s.key === key) || null;

// Container/codec facts for local files. `lossless` is a property of the codec,
// not of the file's size or the name someone gave it.
export const FORMATS = {
  flac: { ext: 'flac', label: 'FLAC', lossless: true, mime: 'audio/flac' },
  wav: { ext: 'wav', label: 'WAV', lossless: true, mime: 'audio/wav' },
  alac: { ext: 'm4a', label: 'ALAC/AAC', lossless: null, mime: 'audio/mp4' },
  aiff: { ext: 'aiff', label: 'AIFF', lossless: true, mime: 'audio/aiff' },
  mp3: { ext: 'mp3', label: 'MP3', lossless: false, mime: 'audio/mpeg' },
  ogg: { ext: 'ogg', label: 'OGG', lossless: false, mime: 'audio/ogg' },
  opus: { ext: 'opus', label: 'OPUS', lossless: false, mime: 'audio/opus' },
  aac: { ext: 'aac', label: 'AAC', lossless: false, mime: 'audio/aac' },
};

export function formatOf(filename) {
  const m = String(filename || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  if (!m) return null;
  const ext = m[1];
  if (ext === 'm4a' || ext === 'mp4') return FORMATS.alac;
  if (ext === 'aif') return FORMATS.aiff;
  return Object.values(FORMATS).find(f => f.ext === ext) || null;
}

const num = v => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// CD is 44100/16. Anything above either axis is "hi-res" by the usual marketing
// definition, which is worth reporting because it is what the file claims —
// separately from whether the output path preserves it.
export const CD_RATE = 44100;
export const CD_DEPTH = 16;

export function tierOf({ lossless = null, sampleRate = null, bitDepth = null } = {}) {
  if (lossless === false) return TIERS.lossy;
  if (lossless !== true) return null;         // unknown stays unknown
  const sr = num(sampleRate), bd = num(bitDepth);
  if ((sr !== null && sr > CD_RATE) || (bd !== null && bd > CD_DEPTH)) return TIERS.hires;
  return TIERS.lossless;
}

export function formatRate(hz) {
  const n = num(hz);
  if (n === null || n <= 0) return null;
  const k = n / 1000;
  return `${Number.isInteger(k) ? k : k.toFixed(1)} kHz`;
}

// The whole point of the readout. Returns what is true, and separately what is
// NOT true, so the UI never has to decide how much to hedge.
export function qualityReport({
  source = 'local', format = null, sampleRate = null, bitDepth = null,
  bitrate = null, deviceRate = null,
} = {}) {
  const src = sourceOf(source);
  const lossless = format ? format.lossless : null;
  const tier = tierOf({ lossless, sampleRate, bitDepth });
  const sr = num(sampleRate), dr = num(deviceRate);

  // Resampling is the specific thing that stops a lossless decode being
  // bit-perfect, and it is knowable: compare the file's rate to the rate the
  // AudioContext is actually running at.
  const resampled = sr !== null && dr !== null ? sr !== dr : null;

  const parts = [];
  if (format) parts.push(format.label);
  const rate = formatRate(sampleRate);
  if (rate) parts.push(rate);
  if (num(bitDepth)) parts.push(`${num(bitDepth)}-bit`);
  if (num(bitrate)) parts.push(`${Math.round(num(bitrate))} kbps`);

  return {
    source: src,
    tier,
    label: parts.length ? parts.join(' · ') : null,
    lossless,
    resampled,
    deviceRate: dr,
    // Never true. Stated as a field rather than omitted, so the UI shows the
    // reason instead of quietly leaving the claim out.
    bitPerfect: false,
    why: bitPerfectBlocker({ src, lossless, resampled }),
  };
}

export function bitPerfectBlocker({ src, lossless, resampled }) {
  if (src && src.canBePerfect === false && src.key !== 'local') {
    // `name` rather than `label`: the label is shouty on purpose for chips,
    // and a sentence should not shout.
    return `${src.name} delivers lossy audio to browsers${src.ceiling ? ` (max ${src.ceiling} kbps)` : ''}. No client-side setting reaches lossless.`;
  }
  if (lossless === false) return 'This file is a lossy format — the discarded data cannot be recovered.';
  if (resampled) return 'The file rate and the output device rate differ, so the OS mixer is resampling. Match the device rate to stop that.';
  return 'A browser cannot take exclusive control of the audio device, so output always passes through the shared OS mixer.';
}

// Sorting sources by what they can actually deliver, best first. Used for the
// picker order, so the honest option leads.
export function sourcesByQuality() {
  return SOURCES.slice().sort((a, b) => {
    const ra = TIERS[a.tier]?.rank ?? 0, rb = TIERS[b.tier]?.rank ?? 0;
    return rb - ra || (b.ceiling ?? 0) - (a.ceiling ?? 0);
  });
}

// ------------------------------------------------------------------ queue

export function queueNext(queue = [], index = 0, { repeat = 'off', shuffle = false } = {}) {
  if (!queue.length) return null;
  if (repeat === 'one') return index;
  if (shuffle) {
    if (queue.length === 1) return repeat === 'all' ? 0 : null;
    return null;   // caller supplies the random pick; this module stays deterministic
  }
  const next = index + 1;
  if (next < queue.length) return next;
  return repeat === 'all' ? 0 : null;
}

export function queuePrev(queue = [], index = 0, position = 0) {
  if (!queue.length) return null;
  // The universal convention: back within the first few seconds means previous
  // track, later means restart this one.
  if (position > 3) return index;
  return index > 0 ? index - 1 : 0;
}

export function fmtTime(seconds) {
  const n = num(seconds);
  if (n === null || n < 0) return '0:00';
  const m = Math.floor(n / 60);
  const s = Math.floor(n % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
