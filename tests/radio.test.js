// The radio, tested without a browser.
//
// WHAT THIS SUITE IS FOR
//
// The radio has now broken twice, and both times the bug was a wrong belief
// about a third party rather than a wrong line of code. First a CSP I added
// blocked YouTube's script. Then one video id — Lofi Girl's main study stream —
// came back with error 150, "embedding disabled by the owner", and I concluded
// from that single measurement that YouTube was unusable and removed the whole
// transport. Synth and Jazz had been playing the entire time. They are Lofi
// Girl streams too.
//
// So the thing worth pinning down is not "does YouTube work" — that is not ours
// to decide and it changes without notice. It is: WHEN A SOURCE REFUSES, DOES
// THE STATION MOVE ON? A station is a list of sources now, and the behaviour
// that must never regress is that a dead source costs the listener one silent
// beat and nothing else. Everything below exists to hold that line.
//
// `Audio`, `document` and YouTube's API do not exist in node, so fakes are
// installed before the module is imported. Each one records what was asked of it
// and lets a test fire the events a real browser would.

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log('FAIL ' + n); } };
const eq = (a, b, n) => ok(Object.is(a, b), `${n} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

// Let queued macrotasks run — the fakes resolve on setTimeout(0) the way a real
// player resolves on a network round-trip.
const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));

// ------------------------------------------------------------- the fake audio
class FakeAudio {
  constructor() {
    this.src = '';
    this.volume = 1;
    this.preload = '';
    this.error = null;
    this.loads = 0;
    this.plays = 0;
    this.pauses = 0;
    this.playRejects = null;      // set to an Error to make play() reject
    this._l = {};
    FakeAudio.last = this;
  }
  addEventListener(type, fn) { (this._l[type] ||= []).push(fn); }
  emit(type) { (this._l[type] || []).forEach(f => f()); }
  load() { this.loads++; }
  pause() { this.pauses++; }
  play() {
    this.plays++;
    return this.playRejects ? Promise.reject(this.playRejects) : Promise.resolve();
  }
  // Convenience: behave like a stream that connects, or one whose URL is wrong.
  arrives() { this.emit('playing'); }
  refuses(code = 4) { this.error = { code }; this.emit('error'); }
}
globalThis.Audio = FakeAudio;

// ------------------------------------------------------------- the fake DOM
// Only the four calls radio.js actually makes. Anything more would be a second
// implementation of a browser, which is how test suites start lying.
const stubEl = () => ({ id: '', src: '', style: {}, onerror: null, appendChild() {} });
globalThis.document = {
  head: { appendChild() {} },
  body: { appendChild() {} },
  getElementById: () => null,
  createElement: stubEl,
  addEventListener() {},
  removeEventListener() {},
};

// ------------------------------------------------------------- the fake YouTube
// Real YT.Player answers asynchronously and reports a refused embed through
// onError, never through a rejected promise. Both are reproduced, because the
// second one is exactly what the old code failed to handle.
class FakePlayer {
  constructor(_el, opts) {
    FakePlayer.last = this;
    this.ev = opts.events || {};
    this.loaded = [];
    this.vol = null;
    this.id = null;
    setTimeout(() => this.ev.onReady && this.ev.onReady(), 0);
  }
  loadVideoById(id) { this.loaded.push(id); this.id = id; }
  setVolume(v) { this.vol = v; }
  playVideo() {
    const id = this.id;
    setTimeout(() => {
      if (FakePlayer.blocked.has(id)) this.ev.onError?.({ data: 150 });
      else this.ev.onStateChange?.({ data: 1 });
    }, 0);
  }
  pauseVideo() {}
  stopVideo() {}
}
FakePlayer.blocked = new Set();
globalThis.YT = { Player: FakePlayer };

const radio = await import('../src/lib/radio.js');

// ------------------------------------------------------------- normalising
// Three station shapes are in the wild — the new list, and the two single-source
// forms that predate it. Tabs are updated one at a time, so all three must work.
{
  const n = radio.normalizeStation;
  eq(n({ label: 'A', url: 'https://x.test/a' }).sources[0].kind, 'stream', 'a bare url is a stream source');
  eq(n({ label: 'B', id: 'vid123' }).sources[0].kind, 'yt', 'a bare id is a youtube source');
  eq(n({ label: 'B', id: 'vid123' }).sources[0].id, 'vid123', 'and keeps the id');
  eq(n({ label: 'C', sources: [{ kind: 'yt', id: 'x' }, { kind: 'stream', url: 'u' }] }).sources.length, 2,
     'a list of sources passes through intact');
  eq(n({ label: 'D' }), null, 'a station with no source at all is dropped, not half-built');
  eq(n(null), null, 'and so is nothing');
}

const S1 = { url: 'https://example.test/one', label: 'One' };
const S2 = { url: 'https://example.test/two', label: 'Two' };
const S3 = { url: 'https://example.test/three', label: 'Three' };

// ------------------------------------------------------------- stations
radio.setStations([S1, S2], 'study');
eq(radio.snap().stations.length, 2, 'a tab can offer its stations');
eq(radio.snap().station.label, 'One', 'and the first is selected');
eq(radio.snap().source, 'study', 'the source is recorded');

radio.setStations([], 'sleep');
eq(radio.snap().source, 'study', 'an empty list is ignored rather than clearing the dial');

radio.setStations([S3], 'sleep');
eq(radio.snap().station.label, 'Three', 'an idle radio hands over to another tab');

radio.setStations([S1, S2], 'study');
eq(radio.snap().stations.length, 2, 'and back again');

// ------------------------------------------------------------- volume
radio.setVolume(45);
eq(radio.snap().vol, 45, 'volume is stored');
eq(radio.setVolume(140) ?? radio.snap().vol, 100, 'above 100 clamps down');
radio.setVolume(-20);
eq(radio.snap().vol, 0, 'below 0 clamps up');
radio.setVolume(60);
eq(radio.snap().vol, 60, 'and a normal value round-trips');

// ------------------------------------------------------------- play, one source
{
  const p = radio.play(0);
  await tick();
  const a = FakeAudio.last;
  eq(a.src, S1.url, 'play() points the element at the station URL');
  ok(!a.src.includes('?_='), 'and does not append a cache-buster an Icecast mount could reject');
  eq(a.loads, 1, 'load() forces a fresh connection');
  eq(a.plays, 1, 'and play() is called');
  eq(a.volume, 0.6, 'the stored volume is applied as a 0–1 fraction');
  eq(radio.snap().loading, true, 'until audio actually arrives it is loading, not playing');
  eq(radio.snap().playing, false, 'and not yet playing');

  a.arrives();
  await p;
  eq(radio.snap().playing, true, 'the playing event flips it to playing');
  eq(radio.snap().loading, false, 'and clears loading');
  eq(radio.snap().err, '', 'and clears any old error');
  eq(radio.via(), 'stream', 'and records what is carrying the sound');
  eq(radio.isOn(), true, 'isOn reports it');
}

// A tab must NOT be able to swap the stations out from under live audio.
radio.setStations([S3], 'sleep');
eq(radio.snap().station.label, 'One', 'a playing radio keeps its own stations');

// ------------------------------------------------------------- pick & pause
{
  const p = radio.pick(1);
  await tick();
  eq(radio.snap().idx, 1, 'pick changes the station');
  eq(FakeAudio.last.src, S2.url, 'and retunes because it was already playing');
  FakeAudio.last.arrives();
  await tick();
  void p;
}

radio.pause();
eq(radio.snap().playing, false, 'pause stops it');
eq(radio.snap().loading, false, 'and is not left loading');
eq(radio.isOn(), false, 'isOn agrees');

// Picking while OFF must not start the audio — that would be a surprise noise.
{
  const playsBefore = FakeAudio.last.plays;
  radio.pick(0);
  await tick();
  eq(FakeAudio.last.plays, playsBefore, 'picking while paused does not start playback');
  eq(radio.snap().idx, 0, 'but it does move the selection');
}

// =============================================================== THE FALLBACK
// This section is the reason the module was rewritten. Everything above is
// housekeeping; this is the behaviour Neel actually noticed was missing.

// ---- a refused embed hands over to the next source, and the music plays ----
{
  FakePlayer.blocked.add('refused-1');
  radio.setStations([{
    label: 'Lofi',
    sources: [
      { kind: 'yt', id: 'refused-1' },     // the owner has embedding off
      { kind: 'yt', id: 'allowed-1' },     // her next stream
      { kind: 'stream', url: 'https://example.test/lofi-fallback' },
    ],
  }], 'fallback-a');

  const p = radio.play(0);
  await tick(40);
  await p;

  eq(radio.snap().playing, true, 'a refused first source does not stop the station playing');
  eq(radio.via(), 'yt', 'the second youtube source carried it');
  eq(FakePlayer.last.loaded[FakePlayer.last.loaded.length - 1], 'allowed-1', 'and it is the one on air');
  eq(radio.snap().err, '', 'nothing is reported to the person, because nothing failed for them');
  eq(radio.isDead({ kind: 'yt', id: 'refused-1' }), true, 'the refused source is remembered as dead');
  eq(radio.isDead({ kind: 'yt', id: 'allowed-1' }), false, 'the working one is not');
  // The 3D toggle must not claim to affect sound it cannot reach: a YouTube
  // source plays inside a cross-origin iframe, invisible to Web Audio.
  eq(radio.isSpatial(), false, 'youtube audio is honestly reported as not spatial');
}

// ---- and the SECOND play does not pay for the same refusal again ----
{
  const before = FakePlayer.last.loaded.length;
  radio.pause();
  const p = radio.play(0);
  await tick(40);
  await p;
  const loadedSince = FakePlayer.last.loaded.slice(before);
  ok(!loadedSince.includes('refused-1'), 'a source known dead is skipped, not re-probed');
  eq(loadedSince[0], 'allowed-1', 'so the working source starts immediately');
  radio.pause();
}

// ---- youtube refusing entirely still leaves a stream to fall back to ----
{
  FakePlayer.blocked.add('refused-2');
  radio.setStations([{
    label: 'Chill',
    sources: [
      { kind: 'yt', id: 'refused-2' },
      { kind: 'stream', url: 'https://example.test/chill-icecast' },
    ],
  }], 'fallback-b');

  const p = radio.play(0);
  await tick(40);
  eq(FakeAudio.last.src, 'https://example.test/chill-icecast', 'the stream is reached for');
  FakeAudio.last.arrives();
  await p;
  eq(radio.snap().playing, true, 'and plays');
  eq(radio.via(), 'stream', 'via() names the transport that actually worked');
  eq(radio.snap().err, '', 'again with nothing said to the person');
  radio.pause();
}

// ---- only when EVERY source fails does anyone hear about it ----
{
  FakePlayer.blocked.add('refused-3');
  radio.setStations([{
    label: 'Ghost',
    sources: [
      { kind: 'yt', id: 'refused-3' },
      { kind: 'stream', url: 'https://example.test/ghost' },
    ],
  }], 'fallback-c');

  const p = radio.play(0);
  await tick(40);
  FakeAudio.last.refuses(4);              // MEDIA_ERR_SRC_NOT_SUPPORTED
  await p;

  eq(radio.snap().playing, false, 'a station with nothing left does not claim to play');
  eq(radio.snap().loading, false, 'and does not spin forever');
  ok(/Ghost/.test(radio.snap().err), 'the message names the station rather than blaming a transport');
  ok(/would play/i.test(radio.snap().err), 'and says every source was tried');
}

// ---- a single-source station says something simpler ----
{
  radio.setStations([{ label: 'Solo', sources: [{ kind: 'stream', url: 'https://example.test/solo' }] }], 'fallback-d');
  const p = radio.play(0);
  await tick();
  FakeAudio.last.refuses(4);
  await p;
  ok(/unavailable right now/i.test(radio.snap().err), 'one dead source reads as one dead station');
}

// ---- a network blip is NOT a dead source ----
// Live radio drops connections all day. Treating that as "this source is gone"
// would burn through a station's whole fallback list on a bad train journey.
{
  radio.setStations([{ label: 'Blip', sources: [{ kind: 'stream', url: 'https://example.test/blip' }] }], 'fallback-e');
  const p = radio.play(0);
  await tick();
  FakeAudio.last.arrives();
  await p;
  eq(radio.snap().playing, true, 'connected');

  FakeAudio.last.refuses(2);              // MEDIA_ERR_NETWORK
  eq(radio.snap().err, '', 'a network blip is retried silently, not reported');
  eq(radio.snap().loading, true, 'and shows as loading while it reconnects');
  eq(radio.isDead({ kind: 'stream', url: 'https://example.test/blip' }), false,
     'and the source is NOT written off for the session');
  radio.pause();
}

// ---- a blocked autoplay blames the browser, not the station ----
{
  radio.setStations([{ label: 'Gesture', sources: [{ kind: 'stream', url: 'https://example.test/gesture' }] }], 'fallback-f');
  FakeAudio.last.playRejects = Object.assign(new Error('no'), { name: 'NotAllowedError' });
  const p = radio.play(0);
  await tick();
  await p;
  ok(/browser blocked autoplay/i.test(radio.snap().err),
     'a blocked autoplay blames the browser, not the station');
  ok(!/try another/i.test(radio.snap().err),
     'and does not send the person round every station for a problem no station can fix');
  // And crucially it is NOT written off: the next click has a gesture behind it.
  eq(radio.isDead({ kind: 'stream', url: 'https://example.test/gesture' }), false,
     'a source that only needed a click is not dead');
  FakeAudio.last.playRejects = null;

  const p2 = radio.play(0);
  await tick();
  FakeAudio.last.arrives();
  await p2;
  eq(radio.snap().playing, true, 'so pressing play again works');
  eq(radio.snap().err, '', 'and clears the message');
  radio.pause();
}

// ---- a timeout is not a death sentence either ----
// A source that simply took too long once may be fine thirty seconds later; only
// an owner-disabled embed or a wrong URL is permanent.
{
  radio.setStations([{ label: 'Slow', sources: [{ kind: 'stream', url: 'https://example.test/slow' }] }], 'fallback-g');
  const p = radio.play(0);
  await tick();
  radio.pause();                       // supersede it rather than wait out 9s
  await tick();
  eq(radio.isDead({ kind: 'stream', url: 'https://example.test/slow' }), false,
     'a source abandoned mid-attempt is not marked dead');
  void p;
}

// ------------------------------------------------------------- guards
{
  const before = radio.snap();
  await radio.play(99);
  eq(radio.snap().idx, before.idx, 'playing a station that does not exist changes nothing');
}

// ------------------------------------------------------------- sleep timer
radio.cancelSleep();
eq(radio.sleepLeft(), 0, 'no sleep timer by default');
radio.setSleep(30);
ok(radio.sleepLeft() > 1790 && radio.sleepLeft() <= 1800, 'a 30-minute timer reports ~1800s');
radio.cancelSleep();
eq(radio.sleepLeft(), 0, 'and it can be cancelled');
radio.setSleep(0);
eq(radio.sleepLeft(), 0, 'setting zero minutes clears rather than schedules');

// ------------------------------------------------------------- the CSP
// This is the regression that started all of it. The security pass set
// `script-src 'self'`, which blocked YouTube's iframe API, and the failure was
// silent — a play button that span forever. A header is not something a unit
// test can normally reach, but it is checked into this repo, so it can be read.
{
  const fs = await import('node:fs/promises');
  const cfg = JSON.parse(await fs.readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  const csp = cfg.headers?.[0]?.headers?.find(h => h.key === 'Content-Security-Policy')?.value || '';
  const dir = name => (csp.split(';').find(d => d.trim().startsWith(name + ' ')) || '');

  ok(/https:\/\/www\.youtube\.com/.test(dir('script-src')), 'script-src allows the YouTube iframe API');
  ok(/https:\/\/s\.ytimg\.com/.test(dir('script-src')), 'and the player bundle it pulls in turn');
  ok(/https:\/\/www\.youtube\.com/.test(dir('frame-src')), 'frame-src allows the player itself');
  ok(/media-src/.test(csp) && /https:/.test(dir('media-src')), 'media-src allows the Icecast fallbacks');
  ok(/object-src 'none'/.test(csp), 're-opening for YouTube did not loosen anything else');
  ok(/frame-ancestors 'none'/.test(csp), 'and the app still refuses to be framed');
}

console.log(`\n${pass} passed, ${fail} failed`);
// Explicit: a stalled attempt keeps a 9-second timer alive, and a suite that
// takes nine seconds to say "done" is a suite people stop running.
process.exit(fail ? 1 : 0);
