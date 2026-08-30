// PCM → WAV, in the browser.
//
// Needed because NVIDIA's ASR takes 16-bit mono WAV and MediaRecorder gives
// webm/opus. The alternative is converting server-side, which means ffmpeg in a
// serverless function — a heavy dependency and a cold start on every lecture.
//
// The audio is already flowing through a WebAudio graph to mix the microphone
// with the shared tab, so taking float samples off that graph and writing a WAV
// header is both cheaper and simpler than re-encoding something we encoded.
//
// It also matches what Neel actually wants: he asked not to keep the recording.
// Buffering raw PCM per chunk, sending it, and dropping it means the audio never
// becomes a file at all.

export const TARGET_RATE = 16000;   // what ASR models want; more is wasted upload

/**
 * Downsample by simple averaging.
 *
 * Not a real anti-aliasing filter, and that is a deliberate trade: speech ASR is
 * unbothered by the aliasing this leaves, and a proper filter in JS on an hour of
 * audio costs more than it returns. If transcripts ever come back tinny, this is
 * the line to reconsider.
 */
export function downsample(input, fromRate, toRate = TARGET_RATE) {
  if (!input?.length) return new Float32Array(0);
  if (toRate >= fromRate) return Float32Array.from(input);
  const ratio = fromRate / toRate;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(Math.floor((i + 1) * ratio), input.length);
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    out[i] = end > start ? sum / (end - start) : 0;
  }
  return out;
}

/** Float [-1,1] → signed 16-bit, clamped. Unclamped, a loud room wraps around
 *  and a shout becomes a burst of noise the transcriber has no chance with. */
export function toInt16(float32) {
  const out = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

/** A 44-byte canonical WAV header + the samples. Mono, 16-bit. */
export function encodeWav(float32, sampleRate = TARGET_RATE) {
  const pcm = toInt16(float32);
  const buf = new ArrayBuffer(44 + pcm.length * 2);
  const v = new DataView(buf);
  const str = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };

  str(0, 'RIFF');
  v.setUint32(4, 36 + pcm.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);          // PCM chunk size
  v.setUint16(20, 1, true);           // format: PCM
  v.setUint16(22, 1, true);           // channels: mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);  // byte rate
  v.setUint16(32, 2, true);           // block align
  v.setUint16(34, 16, true);          // bits per sample
  str(36, 'data');
  v.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, pcm[i], true);
  return new Blob([buf], { type: 'audio/wav' });
}

/** Seconds of audio in a float buffer. Used to decide when a chunk is full. */
export const durationOf = (float32, rate = TARGET_RATE) => (float32?.length || 0) / rate;

/**
 * How long a chunk should be.
 *
 * Long enough that a sentence is rarely split across two requests, short enough
 * that an hour is not one enormous upload and a failure loses a minute rather
 * than the lecture. Overlap exists so a word cut at a boundary appears whole in
 * at least one of the two chunks.
 */
export const CHUNK_SECONDS = 60;
export const OVERLAP_SECONDS = 2;

/**
 * Join transcript chunks, removing the duplication the overlap creates.
 *
 * Without this every minute boundary leaves a repeated half-sentence in the
 * notes, which reads like a stutter and is the sort of thing that makes a
 * generated summary feel untrustworthy.
 */
export function stitch(parts) {
  const clean = (parts || []).map(p => String(p || '').trim()).filter(Boolean);
  if (!clean.length) return '';
  let out = clean[0];
  for (let i = 1; i < clean.length; i++) {
    const next = clean[i];
    // Find the longest tail of `out` that starts `next`, within a sane window.
    let overlap = 0;
    const max = Math.min(200, out.length, next.length);
    for (let n = max; n >= 12; n--) {
      if (out.slice(-n).toLowerCase() === next.slice(0, n).toLowerCase()) { overlap = n; break; }
    }
    out += (overlap ? next.slice(overlap) : ' ' + next);
  }
  return out.replace(/\s+/g, ' ').trim();
}
