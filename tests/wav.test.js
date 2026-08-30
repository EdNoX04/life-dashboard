// Pins the audio path: PCM off the WebAudio graph → 16-bit mono WAV → ASR, and
// the transcript chunks back into one clean piece of prose.
//
// This exists because NVIDIA's ASR takes WAV and MediaRecorder gives webm/opus,
// and because Neel asked NOT to keep the recording — so the audio is buffered,
// sent, and dropped rather than ever becoming a file.

import { downsample, toInt16, encodeWav, durationOf, stitch, TARGET_RATE, CHUNK_SECONDS } from '../src/lib/wav.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log('FAIL ' + n); } };
const is = (a, b, n) => ok(Object.is(a, b), `${n} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

// ---------------------------------------------------------------- downsampling
const tone = n => { const f = new Float32Array(n); for (let i = 0; i < n; i++) f[i] = Math.sin(i / 40); return f; };
is(downsample(tone(48000), 48000, 16000).length, 16000, '48k → 16k is a third of the samples');
is(downsample(tone(44100), 44100, 16000).length, 16000, 'and 44.1k lands on 16k too');
is(downsample(tone(1000), 16000, 16000).length, 1000, 'no resampling when the rate already matches');
is(downsample(tone(1000), 8000, 16000).length, 1000, 'never upsamples — inventing samples helps nothing');
is(downsample(null, 48000).length, 0, 'an empty buffer is not a crash');
// Averaging must not destroy the signal.
const ds = downsample(tone(48000), 48000, 16000);
ok(Math.max(...ds) > 0.5 && Math.min(...ds) < -0.5, 'the waveform survives downsampling');

// ---------------------------------------------------------------- 16-bit
const i16 = toInt16(new Float32Array([0, 1, -1, 0.5, -0.5, 2, -2, NaN]));
is(i16[0], 0, 'silence is zero');
is(i16[1], 32767, 'full scale positive');
is(i16[2], -32768, 'full scale negative');
// Clamping matters: unclamped, a loud room wraps and a shout becomes noise the
// transcriber cannot read.
is(i16[5], 32767, 'above full scale is clamped, not wrapped');
is(i16[6], -32768, 'and below it too');
ok(Number.isInteger(i16[7]), 'a NaN sample does not poison the buffer');

// ---------------------------------------------------------------- the container
const blob = encodeWav(new Float32Array(1600), 16000);
is(blob.type, 'audio/wav', 'the blob is labelled as WAV');
is(blob.size, 44 + 1600 * 2, 'a 44-byte header plus two bytes a sample — no more');

const bytes = new Uint8Array(await encodeWav(new Float32Array([0, 0.5]), 16000).arrayBuffer());
const ascii = (a, b) => String.fromCharCode(...bytes.slice(a, b));
is(ascii(0, 4), 'RIFF', 'RIFF marker');
is(ascii(8, 12), 'WAVE', 'WAVE marker');
is(ascii(12, 16), 'fmt ', 'fmt chunk');
is(ascii(36, 40), 'data', 'data chunk');
const dv = new DataView(bytes.buffer);
is(dv.getUint16(22, true), 1, 'mono — NVIDIA asks for one channel');
is(dv.getUint16(34, true), 16, 'sixteen bits a sample');
is(dv.getUint32(24, true), 16000, 'and the sample rate it was told');

is(durationOf(new Float32Array(TARGET_RATE * 3)), 3, 'duration is samples over rate');
ok(CHUNK_SECONDS >= 30 && CHUNK_SECONDS <= 120, 'chunks are long enough to hold a sentence, short enough to retry');

// ---------------------------------------------------------------- stitching
// Chunks overlap so a word cut at a boundary survives in one of them. Without
// de-duplication every minute leaves a repeated half-sentence, which reads like
// a stutter and makes the whole summary feel untrustworthy.
is(stitch(['the professor said the key idea', 'the key idea is that entropy rises']),
  'the professor said the key idea is that entropy rises', 'the repeated phrase is joined, not duplicated');
is(stitch(['completely different', 'nothing shared here']),
  'completely different nothing shared here', 'unrelated chunks are simply joined');
is(stitch(['Only one']), 'Only one', 'a single chunk passes through');
is(stitch([]), '', 'nothing in, nothing out');
is(stitch(['  a  ', '', null, ' b ']), 'a b', 'blank and null chunks are dropped and spacing normalised');
// A short coincidental repeat must not be treated as an overlap.
is(stitch(['we discussed the', 'the entropy of the system']),
  'we discussed the the entropy of the system', 'a 3-letter coincidence is not treated as an overlap');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
