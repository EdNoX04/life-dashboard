// Procedural ambient sound engine (Web Audio API). No external files — every sound
// is synthesized from filtered noise, so it works offline and never 404s.
// Singleton: one AudioContext + master gain; each sound is a node graph we start/stop.

let ctx = null, master = null;
const active = new Map(); // key -> { stop() }

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.6;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function setMasterVolume(v) { if (master) master.gain.value = Math.max(0, Math.min(1, v)); }

function noiseBuffer(c, brown) {
  const len = c.sampleRate * 2;
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    else d[i] = w;
  }
  return buf;
}
function noiseSource(c, brown) { const s = c.createBufferSource(); s.buffer = noiseBuffer(c, brown); s.loop = true; return s; }
function filt(c, type, freq, q) { const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; if (q != null) f.Q.value = q; return f; }

// per-sound recipe: base noise + filter chain + gain + optional LFO / crackle
const RECIPES = {
  noise:  { brown: false, chain: [], gain: 0.22 },
  rain:   { brown: false, chain: [['highpass', 800], ['lowpass', 7000]], gain: 0.42, lfo: { rate: 0.7, depth: 0.08 } },
  snow:   { brown: false, chain: [['highpass', 3000]], gain: 0.12 },
  fire:   { brown: true,  chain: [['lowpass', 500]], gain: 0.42, crackle: true },
  forest: { brown: true,  chain: [['lowpass', 1200]], gain: 0.28, lfo: { rate: 0.25, depth: 0.06 } },
  cafe:   { brown: true,  chain: [['lowpass', 850]], gain: 0.32 },
  waves:  { brown: true,  chain: [['lowpass', 650]], gain: 0.5, lfo: { rate: 0.12, depth: 0.35 } },
  night:  { brown: true,  chain: [['lowpass', 950], ['highpass', 200]], gain: 0.22, lfo: { rate: 0.4, depth: 0.05 } },
};

function build(key) {
  const c = ac();
  const r = RECIPES[key] || RECIPES.noise;
  const s = noiseSource(c, r.brown);
  const g = c.createGain(); g.gain.value = r.gain;
  let node = s;
  for (const [type, freq] of r.chain) { const f = filt(c, type, freq); node.connect(f); node = f; }
  node.connect(g);
  g.connect(master);
  let lfoOsc, crackleTimer;
  if (r.lfo) {
    lfoOsc = c.createOscillator(); lfoOsc.frequency.value = r.lfo.rate;
    const lg = c.createGain(); lg.gain.value = r.lfo.depth;
    lfoOsc.connect(lg); lg.connect(g.gain); lfoOsc.start();
  }
  s.start();
  if (r.crackle) {
    crackleTimer = setInterval(() => {
      try {
        const n = noiseSource(c, false); const ng = c.createGain(); ng.gain.value = 0;
        const hp = filt(c, 'highpass', 1500); n.connect(hp); hp.connect(ng); ng.connect(master);
        const t = c.currentTime;
        ng.gain.setValueAtTime(0, t);
        ng.gain.linearRampToValueAtTime(0.25 * Math.random(), t + 0.005);
        ng.gain.exponentialRampToValueAtTime(0.0008, t + 0.09);
        n.start(t); n.stop(t + 0.12);
      } catch {}
    }, 150);
  }
  return { stop() { try { s.stop(); } catch {} if (lfoOsc) { try { lfoOsc.stop(); } catch {} } if (crackleTimer) clearInterval(crackleTimer); try { g.disconnect(); } catch {} } };
}

export function isOn(key) { return active.has(key); }
export function stop(key) { const a = active.get(key); if (a) { a.stop(); active.delete(key); } }
export function start(key) { if (active.has(key)) return; try { active.set(key, build(key)); } catch {} }
export function toggle(key) { if (active.has(key)) { stop(key); return false; } start(key); return true; }
export function stopAll() { for (const k of [...active.keys()]) stop(k); }
