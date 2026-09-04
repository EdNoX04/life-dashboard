// The end-of-block alarm.
//
// This is the feature you only notice when it is wrong, and the two ways it can
// be wrong are both bad in the same direction: silence when it should ring, or
// ringing twice. The second is worse than it sounds — two code paths race to
// notice the same deadline on purpose (a scheduled timeout, and the state change
// when something reads the timer), because each one alone has a case where it
// misses. So the de-duplication is not a nicety, it is what makes having both
// safe. Most of what follows is about that.
//
// Web Audio and Notification do not exist in node, so both are faked. The fakes
// record what was asked of them; nothing here asserts on sound, only on the
// instructions given to produce it.

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log('FAIL ' + n); } };
const eq = (a, b, n) => ok(Object.is(a, b), `${n} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
const near = (a, b, tol, n) => ok(Math.abs(a - b) <= tol, `${n} (got ${a}, want ~${b})`);

// ------------------------------------------------------------- fakes
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
};

class Param {
  constructor() { this.calls = []; this.value = 0; }
  setValueAtTime(v, t) { this.calls.push(['set', v, t]); }
  exponentialRampToValueAtTime(v, t) { this.calls.push(['exp', v, t]); }
  linearRampToValueAtTime(v, t) { this.calls.push(['lin', v, t]); }
}
class Node {
  constructor(kind) { this.kind = kind; this.out = []; this.disconnected = false; }
  connect(n) { this.out.push(n); return n; }
  disconnect() { this.disconnected = true; }
}
class Gain extends Node { constructor() { super('gain'); this.gain = new Param(); } }
class Osc extends Node {
  constructor(ctx) { super('osc'); this.ctx = ctx; this.frequency = { value: 0 }; this.type = ''; }
  start(t) { this.startedAt = t; this.ctx.started.push(this); }
  stop(t) { this.stoppedAt = t; }
}
class Ctx {
  constructor() {
    this.currentTime = 100;
    this.state = 'running';
    this.listener = {};
    this.destination = new Node('dest');
    this.started = [];
    this.gains = [];
  }
  createGain() { const g = new Gain(); this.gains.push(g); return g; }
  createOscillator() { return new Osc(this); }
  resume() {}
}
globalThis.AudioContext = Ctx;

let permission = 'default';
let requested = 0;
const shown = [];
class FakeNotification {
  constructor(title, opts) { shown.push({ title, opts, via: 'constructor' }); }
  static get permission() { return permission; }
  static async requestPermission() { requested++; permission = 'granted'; return permission; }
}
globalThis.Notification = FakeNotification;

const alarm = await import('../src/lib/alarm.js');
const bus = await import('../src/lib/audiobus.js');
const ctx = bus.context();          // the one the module will use too

// ------------------------------------------------------------- preferences
{
  const p = alarm.prefs();
  eq(p.sound, true, 'sound is on by default — an alarm you must switch on is not an alarm');
  eq(p.notify, true, 'and so are notifications');

  eq(alarm.normalize({ volume: 9 }).volume, 1, 'a volume above 1 clamps');
  eq(alarm.normalize({ volume: -3 }).volume, 0, 'and below 0');
  eq(alarm.normalize({ volume: 'loud' }).volume, 0.5, 'and nonsense falls back to the default');
  eq(alarm.normalize({ sound: false }).sound, false, 'off stays off');
  eq(alarm.normalize({}).sound, true, 'and anything not explicitly false is on');

  alarm.setPrefs({ volume: 0.8, notify: false });
  eq(alarm.prefs().volume, 0.8, 'a change sticks');
  eq(alarm.prefs().notify, false, 'across fields');
  eq(alarm.prefs().sound, true, 'without disturbing the others');
  ok(store.get('p1_alarm').includes('0.8'), 'and is written to this device');
  alarm.setPrefs({ notify: true });
}

// ------------------------------------------------------------- the chime
{
  const before = ctx.started.length;
  eq(alarm.chime('focus'), true, 'the chime rings');
  const notes = ctx.started.slice(before);
  eq(notes.length, 3, 'the focus phrase is three notes');
  ok(notes[0].frequency.value < notes[2].frequency.value, 'and rises, so "done" sounds like done');
  eq(notes[0].type, 'sine', 'a sine, not a square — a square is what a cheap alarm clock sounds like');
  near(notes[1].startedAt - notes[0].startedAt, 0.13, 0.001, 'the notes are staggered rather than a chord');
  ok(notes[0].stoppedAt > notes[0].startedAt, 'and each one is told when to stop, so nothing is left ringing');

  // The envelope is what stops it clicking: near-instant attack, exponential
  // decay. A gain switched on and off is an audible click on every ring.
  const env = notes[0].out[0].gain.calls;
  eq(env[0][0], 'set', 'the envelope starts from a set value');
  ok(env.some(c => c[0] === 'exp' && c[1] > 0.5), 'attacks');
  ok(env.some(c => c[0] === 'exp' && c[1] < 0.01), 'and decays away');
}
{
  const before = ctx.started.length;
  alarm.chime('break');
  const notes = ctx.started.slice(before);
  eq(notes.length, 2, 'the break phrase is two notes');
  eq(notes[0].frequency.value, notes[1].frequency.value, 'flat, not rising — it means "back to it"');
  ok(notes[0].frequency.value < alarm.PHRASES.focus[0].hz, 'and lower than the focus phrase');
}
{
  // THE POINT: the alarm does not hang off the ambience master gain. Turning the
  // rain down to nothing must not silence the one sound whose job is to be heard.
  const before = ctx.gains.length;
  alarm.chime('focus');
  const out = ctx.gains[before];
  eq(out.out[0], ctx.destination, 'the chime goes straight to the speakers, past the master volume');
}
{
  alarm.setPrefs({ sound: false });
  const before = ctx.started.length;
  eq(alarm.chime('focus'), false, 'sound off means silence');
  eq(ctx.started.length, before, 'and nothing is scheduled');
  eq(alarm.preview('focus'), true, 'but the settings row can still demonstrate it');
  ok(ctx.started.length > before, 'by actually making a sound');
  eq(alarm.prefs().sound, false, 'without turning the preference back on behind your back');
  alarm.setPrefs({ sound: true });
}

// ------------------------------------------------------------- notifications
{
  permission = 'default';
  eq(alarm.notifyPermission(), 'default', 'permission is reported as the browser has it');
  eq(await alarm.notify('t', 'b'), false, 'nothing is shown before permission is given');
  eq(shown.length, 0, 'and nothing is attempted');

  eq(await alarm.askNotify(), 'granted', 'asking works');
  eq(requested, 1, 'and asks once');
  await alarm.askNotify();
  eq(requested, 1, 'a second ask is not made — the browser only answers once');

  eq(await alarm.notify('Focus done', 'Break is next'), true, 'with permission it shows');
  eq(shown.at(-1).title, 'Focus done', 'with the title given');
  eq(shown.at(-1).opts.tag, 'p1-pomodoro', 'tagged, so a new one replaces the old instead of stacking');
  eq(shown.at(-1).opts.requireInteraction, true, 'and stays up — the whole complaint was not noticing it');
  eq(shown.at(-1).opts.silent, true, 'silently, because the chime is the sound');

  alarm.setPrefs({ notify: false });
  const n = shown.length;
  eq(await alarm.notify('x', 'y'), false, 'the preference is honoured');
  eq(shown.length, n, 'and nothing is shown');
  alarm.setPrefs({ notify: true });
}

// ------------------------------------------------------------- announcing once
{
  alarm.resetFired();
  // Relative to now, not a fixed date: a block that ended hours ago is
  // deliberately NOT announced (see the staleness section below), so a hard-
  // coded timestamp would make this suite start failing the day after it was
  // written — the worst kind of failure, because it looks like a real one.
  const at = Date.now();

  eq(await alarm.announce({ mode: 'focus', at, label: 'Blockchain', minutes: 25, next: 'Short break' }), true,
     'a finished block is announced');
  eq(alarm.hasFired(at), true, 'and remembered');
  ok(/Blockchain/.test(shown.at(-1).title), 'the notification names what you were working on');
  ok(/25m/.test(shown.at(-1).title), 'and how long you spent');
  ok(/Short break/.test(shown.at(-1).opts.body), 'and what is loaded next');

  // The race the whole design depends on: the scheduled timeout and the state
  // change both call this for the same block, and exactly one ring must result.
  const rings = ctx.started.length, notes = shown.length;
  eq(await alarm.announce({ mode: 'focus', at, label: 'Blockchain', minutes: 25 }), false,
     'the same deadline is never announced twice');
  eq(ctx.started.length, rings, 'no second chime');
  eq(shown.length, notes, 'and no second notification');

  eq(await alarm.announce({ mode: 'focus', at: at + 1500000, label: 'IoT', minutes: 25 }), true,
     'but the next block is not suppressed by the last one');

  await alarm.announce({ mode: 'short', at: at + 3000000, minutes: 5, next: 'Focus' });
  ok(/break over/i.test(shown.at(-1).title), 'a finished break says so');
  ok(!/undefined|NaN/.test(shown.at(-1).title + ' ' + shown.at(-1).opts.body),
     'and never leaks a missing value into the text');

  await alarm.announce({ mode: 'focus', at: at + 4000000, label: '', minutes: 50 });
  ok(!/—\s*$/.test(shown.at(-1).title), 'an unnamed block does not end in a dangling dash');
  ok(/50m/.test(shown.at(-1).title), 'and still reports the time');
}

// ------------------------------------------------------------- stale blocks
{
  // The timer settles itself against the clock when the app loads. So opening
  // the dashboard the morning after leaving a pomodoro running produces a
  // genuine, correctly-formed finished block dated last night — and without a
  // guard, the first thing the app would do on open is chime and pop up a
  // notification about a session that ended nine hours ago.
  alarm.resetFired();
  const lastNight = Date.now() - 9 * 3600 * 1000;
  const rings = ctx.started.length, notes = shown.length;

  eq(await alarm.announce({ mode: 'focus', at: lastNight, label: 'Blockchain', minutes: 25 }), false,
     'a block that ended hours ago is not announced on open');
  eq(ctx.started.length, rings, 'no chime');
  eq(shown.length, notes, 'and no notification');
  eq(alarm.hasFired(lastNight), true, 'and it is written off, so it cannot surface later either');

  // The tolerance exists for a laptop that slept for a minute or a tab the
  // browser throttled — those alarms are still wanted.
  eq(await alarm.announce({ mode: 'focus', at: Date.now() - 30000, label: 'IoT', minutes: 25 }), true,
     'but a block that ended thirty seconds ago still rings');
  eq(await alarm.announce({ mode: 'focus', at: Date.now() - alarm.STALE_MS - 1000, minutes: 25 }), false,
     'and the boundary is where it says it is');
}

// ------------------------------------------------------------- scheduling
{
  let rang = 0;
  const cancel = alarm.armAt(Date.now() + 25, () => { rang++; });
  eq(rang, 0, 'nothing fires early');
  await new Promise(r => setTimeout(r, 60));
  eq(rang, 1, 'and it fires at the deadline');
  cancel();

  let late = 0;
  alarm.armAt(Date.now() - 60000, () => { late++; });
  await new Promise(r => setTimeout(r, 10));
  eq(late, 1, 'a deadline already past fires at once — a late alarm beats a missed one');

  let cancelled = 0;
  alarm.armAt(Date.now() + 20, () => { cancelled++; })();
  await new Promise(r => setTimeout(r, 50));
  eq(cancelled, 0, 'and a cancelled one does not fire, so changing the timer does not leave a ghost');

  // A stored deadline that has been corrupted must do nothing rather than ring
  // immediately: setTimeout's delay is a signed 32-bit int and wraps around.
  let absurd = 0;
  alarm.armAt(Date.now() + 2 ** 40, () => { absurd++; });
  alarm.armAt('nonsense', () => { absurd++; });
  await new Promise(r => setTimeout(r, 20));
  eq(absurd, 0, 'an impossible deadline is ignored, not fired instantly');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
