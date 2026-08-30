// /api/transcribe — speech to text, without a key in the browser.
//
// Same rule as /api/chat: the key is an environment variable on Vercel, every
// request carries a Supabase session, and an unauthenticated request costs
// nothing but this function's own runtime.
//
// WHY NVIDIA AND NOT WHISPER
// Anthropic has no speech-to-text at all. NVIDIA's hosted Parakeet turns out to
// be a plain REST endpoint — multipart, Bearer auth, an OpenAI-shaped
// /v1/audio/transcriptions path — on the key that is already here for the free
// chat tier. So a lecture costs nothing extra, and there is no second vendor.
//
// Wispr Flow and FluidVoice were considered and are the wrong shape: both are
// DICTATION tools, turning your own speech into text in a field as you talk.
// Neither accepts an audio file. FluidVoice (whisper.cpp) could run as a service
// on the Omarchy box, which is free and private and always on — worth revisiting
// if this disappoints, but it needs a tunnel to be reachable from a browser and
// that is a lot of moving parts to replace one REST call.
//
// The audio is never stored. It arrives, it is forwarded, the text comes back.
// Neel asked for the notes and not the recording, and the cheapest way to keep a
// promise like that is to have nowhere to break it.

const NVIDIA_ASR = process.env.NVIDIA_ASR_URL
  || 'https://1598d209-5e27-4d3c-8079-4751568b1081.invocation.api.nvcf.nvidia.com/v1/audio/transcriptions';

// A minute of 16 kHz mono WAV is ~1.9 MB. This allows about four minutes, which
// is well past the one-minute chunks the client sends, and far below anything
// that would time out a serverless function.
const MAX_BYTES = 8 * 1024 * 1024;

const json = (res, code, body) => {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
};

async function verifySession(req) {
  const auth = String(req.headers.authorization || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;
  const url = process.env.SUPABASE_URL || 'https://xroynvkzephebhcztvfo.supabase.co';
  const key = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || '';
  try {
    const r = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: key, Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });

  const user = await verifySession(req);
  if (!user) return json(res, 401, { error: 'Sign in first.' });

  const key = process.env.NVIDIA_API_KEY;
  if (!key) return json(res, 503, { error: 'No transcription key is configured on the server.' });

  // Read the raw body ourselves — bodyParser is off, because a WAV through a
  // JSON parser is a corrupted WAV.
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BYTES) return json(res, 413, { error: 'Audio chunk too large.' });
    chunks.push(c);
  }
  const audio = Buffer.concat(chunks);
  if (!audio.length) return json(res, 400, { error: 'No audio received.' });

  const form = new FormData();
  form.append('file', new Blob([audio], { type: 'audio/wav' }), 'chunk.wav');
  form.append('language', String(req.headers['x-language'] || 'en-US'));

  try {
    const r = await fetch(NVIDIA_ASR, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
    const text = await r.text();
    if (!r.ok) {
      // The provider's own words, minus anything that could carry a key.
      const msg = text.replace(/(nvapi)-[A-Za-z0-9_-]+/g, '$1-***').slice(0, 300);
      return json(res, r.status === 404 ? 502 : r.status, { error: `Transcription failed: ${msg}` });
    }
    let out;
    try { out = JSON.parse(text); } catch { out = { text }; }
    // The endpoint is OpenAI-shaped, but be forgiving about where the words are:
    // a shape change should degrade to empty text, not to a crash mid-lecture.
    const transcript = out.text || out.transcript || out.results?.[0]?.alternatives?.[0]?.transcript || '';
    return json(res, 200, { text: String(transcript).trim() });
  } catch (e) {
    const msg = String(e.message || 'Upstream error').replace(/(nvapi)-[A-Za-z0-9_-]+/g, '$1-***');
    return json(res, 502, { error: msg });
  }
}
