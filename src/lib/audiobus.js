// One AudioContext for the whole app, and the spatial layer built on it.
//
// WHY A SHARED BUS
// The ambience engine and the radio both want Web Audio. Two AudioContexts is
// the obvious way to write that and the wrong one: browsers cap how many a page
// may create (Safari has historically allowed four), each carries its own
// hardware buffer and latency, and — the part that actually shows up — a
// listener position set on one context means nothing to sound coming out of the
// other. Spatial audio only works if everything shares one listener, so
// everything shares one context.
//
// WHAT "SPATIAL" MEANS HERE
// Each source is placed at a point around the head and rendered through a
// PannerNode using the HRTF panning model, which is a real head-related transfer
// function convolution rather than a left/right volume split. With headphones it
// puts rain behind you and a fire off to one side, and the effect is strong
// enough that a stationary loop stops sounding like a loop.
//
// Positions are polar — an azimuth in degrees and a distance — because that is
// how a person thinks about it ("rain behind me, café to my left"). The
// conversion to the Web Audio coordinate system is the one piece of real
// arithmetic in this file, so it is a pure function and it is tested.

const KEY = 'p1_spatial';

let ctx = null;
let master = null;
let masterVol = 0.6;
let spatial = load();

const subs = new Set();
const emit = () => { for (const f of [...subs]) f(); };
export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }

function load() {
  try { return globalThis.localStorage?.getItem(KEY) !== '0'; } catch { return true; }
}
function persist() {
  try { globalThis.localStorage?.setItem(KEY, spatial ? '1' : '0'); } catch { /* private mode */ }
}

/** Is spatial rendering on? Defaults to on; remembered per device. */
export function spatialOn() { return spatial; }

/**
 * Turn spatial rendering on or off. Existing sources are re-routed by their
 * owners on the next `emit`, because rebuilding a graph mid-note clicks.
 */
export function setSpatial(on) {
  spatial = Boolean(on);
  persist();
  emit();
}

/** The shared context, created on first use and resumed if the browser suspended it. */
export function context() {
  if (!ctx) {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = masterVol;
    master.connect(ctx.destination);
    resetListener();
  }
  // Browsers start the context suspended until a gesture, and suspend it again
  // when a tab is backgrounded on some platforms. Resuming is cheap and safe.
  if (ctx.state === 'suspended') { try { ctx.resume(); } catch { /* nothing to do */ } }
  return ctx;
}

/** Everything connects here rather than to destination, so one gain rules them all. */
export function masterOut() { context(); return master; }

export function masterVolume() { return masterVol; }
export function setMasterVolume(v) {
  masterVol = Math.max(0, Math.min(1, v));
  if (master) master.gain.value = masterVol;
  emit();
}

/**
 * The listener sits at the origin facing −Z with +Y up — the Web Audio default,
 * set explicitly because the older `setOrientation` API and the newer
 * AudioParam form disagree about defaults across browsers.
 */
function resetListener() {
  const l = ctx.listener;
  if (l.positionX) {
    l.positionX.value = 0; l.positionY.value = 0; l.positionZ.value = 0;
    l.forwardX.value = 0; l.forwardY.value = 0; l.forwardZ.value = -1;
    l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
  } else if (l.setPosition) {
    l.setPosition(0, 0, 0);
    l.setOrientation(0, 0, -1, 0, 1, 0);
  }
}

/**
 * Polar to Cartesian, in the Web Audio convention.
 *
 * Azimuth is measured in degrees clockwise from straight ahead, which is how the
 * UI presents it: 0 is in front, 90 to the right, 180 behind, 270 to the left.
 * The listener faces −Z, so "ahead" is negative Z and "right" is positive X.
 * Elevation lifts the source above the horizontal plane.
 *
 * Pure, and exported, because this is the only arithmetic here that can be
 * wrong in a way you would not immediately hear.
 */
export function polarToXYZ(azimuthDeg, distance = 1, elevationDeg = 0) {
  const az = (Number(azimuthDeg) || 0) * Math.PI / 180;
  const el = (Number(elevationDeg) || 0) * Math.PI / 180;
  const d = Math.max(0.1, Number(distance) || 1);
  const horizontal = d * Math.cos(el);
  return {
    x: horizontal * Math.sin(az),
    y: d * Math.sin(el),
    z: -horizontal * Math.cos(az),
  };
}

/** Set a panner's position from polar coordinates, gliding rather than jumping. */
export function place(panner, azimuthDeg, distance = 1, elevationDeg = 0, glideSec = 0.08) {
  if (!panner) return;
  const { x, y, z } = polarToXYZ(azimuthDeg, distance, elevationDeg);
  const t = (ctx?.currentTime ?? 0) + glideSec;
  if (panner.positionX) {
    // A ramp rather than an assignment: a source that teleports produces an
    // audible click, which is exactly what a slider dragged across the head
    // would otherwise do on every frame.
    panner.positionX.linearRampToValueAtTime(x, t);
    panner.positionY.linearRampToValueAtTime(y, t);
    panner.positionZ.linearRampToValueAtTime(z, t);
  } else if (panner.setPosition) {
    panner.setPosition(x, y, z);
  }
}

/**
 * A panner configured for headphone listening.
 *
 * `inverse` distance with a small `refDistance` keeps the level sane at the
 * distances the UI offers, and `maxDistance` stops a far source disappearing
 * entirely. HRTF costs more CPU than equal-power panning; on the handful of
 * simultaneous sources this app plays, that cost is irrelevant and the
 * difference in the result is not.
 */
export function makePanner(azimuthDeg = 0, distance = 1, elevationDeg = 0) {
  const c = context();
  if (!c || !c.createPanner) return null;
  const p = c.createPanner();
  try { p.panningModel = 'HRTF'; } catch { /* older browsers keep equalpower */ }
  p.distanceModel = 'inverse';
  p.refDistance = 1;
  p.maxDistance = 20;
  p.rolloffFactor = 0.6;
  place(p, azimuthDeg, distance, elevationDeg, 0);
  return p;
}

/**
 * Slowly drift a source around the listener.
 *
 * Real environments are never still, and a perfectly fixed point source is the
 * thing that makes a two-minute loop start to sound like a two-minute loop. The
 * motion is deliberately far too slow to notice directly — a full circle takes
 * minutes — so it registers as the sound being alive rather than as an effect.
 *
 * Returns a stop function. Uses a timer rather than requestAnimationFrame on
 * purpose: rAF stops in a background tab, and the ambience is most often playing
 * in one.
 */
export function orbit(panner, { from = 0, degreesPerSecond = 1.5, distance = 1, elevation = 0, tickMs = 500 } = {}) {
  if (!panner) return () => {};
  let deg = from;
  const step = degreesPerSecond * (tickMs / 1000);
  const id = setInterval(() => {
    deg = (deg + step) % 360;
    place(panner, deg, distance, elevation, tickMs / 1000);
  }, tickMs);
  return () => clearInterval(id);
}

/** Evenly spread n sources around the head, starting slightly off-centre. */
export function spread(index, count) {
  if (count <= 1) return 0;
  return Math.round((360 / count) * index + 25) % 360;
}

/** Human-readable direction for an azimuth, for the UI. */
export function bearing(azimuthDeg) {
  const a = ((Number(azimuthDeg) || 0) % 360 + 360) % 360;
  if (a < 23 || a >= 337) return 'ahead';
  if (a < 68) return 'front right';
  if (a < 113) return 'right';
  if (a < 158) return 'behind right';
  if (a < 203) return 'behind';
  if (a < 248) return 'behind left';
  if (a < 293) return 'left';
  return 'front left';
}
