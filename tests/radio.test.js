// The radio, tested without a browser.
//
// This module went wrong twice in ways no test would have caught — a CSP that
// blocked YouTube's script, and then YouTube refusing to embed at all — so the
// point here is not to re-litigate those. It is to pin the parts that ARE ours:
// the state machine, the station handover between tabs, volume clamping, and the
// promise that a station whose URL is simply wrong reports itself instead of
// retrying forever.
//
// `Audio` and the DOM do not exist in node, so a fake element is installed before
// the module is imported. It records what was asked of it and lets each test
// fire the events a real browser would.

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log('FAIL ' + n); } };
const eq = (a, b, n) => ok(Object.is(a, b), `${n} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

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
}
globalThis.Audio = FakeAudio;

// react is imported by the module for its useRadio hook; stub the two hooks so
// the import resolves without pulling React into a node test.
const { default: Module } = { default: null };

const radio = await import('../src/lib/radio.js');

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

// ------------------------------------------------------------- play
await radio.play(0);
const a = FakeAudio.last;
eq(a.src, S1.url, 'play() points the element at the station URL');
ok(!a.src.includes('?_='), 'and does not append a cache-buster an Icecast mount could reject');
eq(a.loads, 1, 'load() forces a fresh connection');
eq(a.plays, 1, 'and play() is called');
eq(a.volume, 0.6, 'the stored volume is applied as a 0–1 fraction');
eq(radio.snap().loading, true, 'until audio actually arrives it is loading, not playing');
eq(radio.snap().playing, false, 'and not yet playing');

a.emit('playing');
eq(radio.snap().playing, true, 'the playing event flips it to playing');
eq(radio.snap().loading, false, 'and clears loading');
eq(radio.snap().err, '', 'and clears any old error');
eq(radio.isOn(), true, 'isOn reports it');

// A tab must NOT be able to swap the stations out from under live audio.
radio.setStations([S3], 'sleep');
eq(radio.snap().station.label, 'One', 'a playing radio keeps its own stations');

// ------------------------------------------------------------- pick & pause
radio.pick(1);
eq(radio.snap().idx, 1, 'pick changes the station');
eq(FakeAudio.last.src, S2.url, 'and retunes because it was already playing');

radio.pause();
eq(radio.snap().playing, false, 'pause stops it');
eq(radio.snap().loading, false, 'and is not left loading');
eq(radio.isOn(), false, 'isOn agrees');

// Picking while OFF must not start the audio — that would be a surprise noise.
const playsBefore = FakeAudio.last.plays;
radio.pick(0);
eq(FakeAudio.last.plays, playsBefore, 'picking while paused does not start playback');
eq(radio.snap().idx, 0, 'but it does move the selection');

// ------------------------------------------------------------- errors
// MEDIA_ERR_SRC_NOT_SUPPORTED (4) means the URL is wrong. Retrying repeats the
// failure forever, so this is the one case that must surface to the person.
await radio.play(0);
FakeAudio.last.error = { code: 4 };
FakeAudio.last.emit('error');
ok(/not reachable/i.test(radio.snap().err), 'an unsupported source says so instead of retrying');
eq(radio.snap().loading, false, 'and stops loading');
eq(radio.snap().playing, false, 'and stops playing');

// A network blip (code 2) is normal for live radio and must NOT be surfaced.
await radio.play(0);
FakeAudio.last.error = { code: 2 };
FakeAudio.last.emit('error');
eq(radio.snap().err, '', 'a network blip is retried silently, not reported');
eq(radio.snap().loading, true, 'and shows as loading while it reconnects');
radio.pause();

// A rejected play() must name the real reason.
await radio.play(0);
FakeAudio.last.playRejects = Object.assign(new Error('no'), { name: 'NotAllowedError' });
await radio.play(0);
ok(/browser blocked/i.test(radio.snap().err), 'a blocked autoplay blames the browser, not the station');
FakeAudio.last.playRejects = null;
radio.pause();

// ------------------------------------------------------------- guards
const before = radio.snap();
await radio.play(99);
eq(radio.snap().idx, before.idx, 'playing a station that does not exist changes nothing');

// ------------------------------------------------------------- sleep timer
eq(radio.sleepLeft(), 0, 'no sleep timer by default');
radio.setSleep(30);
ok(radio.sleepLeft() > 1790 && radio.sleepLeft() <= 1800, 'a 30-minute timer reports ~1800s');
radio.cancelSleep();
eq(radio.sleepLeft(), 0, 'and it can be cancelled');
radio.setSleep(0);
eq(radio.sleepLeft(), 0, 'setting zero minutes clears rather than schedules');

// ------------------------------------------------------------- no youtube
// The whole point of the rewrite. If this ever fails, someone has reintroduced a
// dependency on a third party's permission to embed — and the CSP will block it.
const src = await (await import('node:fs/promises')).readFile(
  new URL('../src/lib/radio.js', import.meta.url), 'utf8');
const code = src.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
ok(!/YT\.Player|iframe_api|onYouTubeIframeAPIReady/.test(code), 'no YouTube API is loaded');
ok(!/createElement\(.iframe.\)/.test(code), 'and no iframe is created');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
