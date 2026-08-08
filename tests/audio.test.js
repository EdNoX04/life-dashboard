// Pins the audio-source facts and the quality readout. The load-bearing claim
// is a negative one: nothing here may ever report bit-perfect output, because a
// browser cannot deliver it. Hand-typed literals throughout.

import {
  TIERS, SOURCES, sourceOf, FORMATS, formatOf, CD_RATE, CD_DEPTH, tierOf,
  formatRate, qualityReport, bitPerfectBlocker, sourcesByQuality,
  queueNext, queuePrev, fmtTime,
} from '../src/lib/audio.js';

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; } else { fail++; console.log('FAIL ' + name); } };
const eq = (a, b, name) => ok(a === b, `${name} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

// ---------------------------------------------------------------- sources
eq(SOURCES.length, 4, 'four sources');
eq(sourceOf('spotify').ceiling, 320, "Spotify's browser ceiling is 320 kbps");
eq(sourceOf('apple').ceiling, 256, "Apple MusicKit JS is 256 kbps in a browser");
eq(sourceOf('ytmusic').ceiling, 256, 'YouTube Music tops out around 256 kbps');
eq(sourceOf('local').ceiling, null, 'local files have no service-imposed ceiling');
eq(sourceOf('nope'), null, 'an unknown source is null, not a default');

// THE LOAD-BEARING ASSERTION. If this ever passes with `true`, the app is
// lying to the person about what they are hearing.
for (const s of SOURCES) {
  eq(s.canBePerfect, false, `${s.key} does not claim bit-perfect output`);
}
eq(sourceOf('local').tier, 'lossless', 'local files are the only lossless tier');
eq(sourceOf('spotify').tier, 'lossy', 'Spotify is lossy');
eq(sourceOf('apple').tier, 'lossy', 'Apple Music in a browser is lossy');
eq(sourceOf('ytmusic').tier, 'lossy', 'YouTube Music is lossy');
// Every lossy source must explain itself, or the badge is just an insult.
for (const s of SOURCES) ok(s.note && s.note.length > 40, `${s.key} explains its ceiling`);
// Only the source needing no account says so.
eq(sourceOf('ytmusic').needs.startsWith('Nothing'), true, 'YouTube Music needs no account');
ok(sourceOf('spotify').needs.includes('Premium'), 'Spotify names the Premium requirement');
// Prose name and chip label are deliberately different: chips shout, sentences
// do not, and the blocker text is a sentence.
eq(sourceOf('apple').name, 'Apple Music', 'sources carry a prose name');
eq(sourceOf('apple').label, 'APPLE MUSIC', 'and a shouty chip label');

eq(sourcesByQuality()[0].key, 'local', 'the picker leads with the only honest lossless option');

// ---------------------------------------------------------------- formats
eq(formatOf('song.flac').label, 'FLAC', 'flac detected');
eq(formatOf('song.FLAC').lossless, true, 'extension matching is case-insensitive');
eq(formatOf('song.mp3').lossless, false, 'mp3 is lossy');
eq(formatOf('song.wav').lossless, true, 'wav is lossless');
eq(formatOf('a.b.opus').lossless, false, 'the last extension wins');
// m4a is genuinely ambiguous — it can hold ALAC or AAC — so it must not claim.
eq(formatOf('song.m4a').lossless, null, 'm4a is ambiguous and refuses to claim either way');
eq(formatOf('noextension'), null, 'a file with no extension has no known format');
eq(formatOf(''), null, 'an empty name has no format');
eq(formatOf(null), null, 'a null name does not crash');
eq(FORMATS.flac.mime, 'audio/flac', 'formats carry a mime type');

// ------------------------------------------------------------------ tiers
eq(CD_RATE, 44100, 'CD rate is 44.1k');
eq(CD_DEPTH, 16, 'CD depth is 16-bit');
eq(tierOf({ lossless: false }).key, 'lossy', 'a lossy codec is the lossy tier whatever its rate');
eq(tierOf({ lossless: false, sampleRate: 96000, bitDepth: 24 }).key, 'lossy',
  'a high sample rate does not make a lossy codec lossless');
eq(tierOf({ lossless: true, sampleRate: 44100, bitDepth: 16 }).key, 'lossless', 'CD quality is lossless');
eq(tierOf({ lossless: true, sampleRate: 96000, bitDepth: 24 }).key, 'hires', 'above CD on both axes is hi-res');
eq(tierOf({ lossless: true, sampleRate: 48000, bitDepth: 16 }).key, 'hires', 'above CD on rate alone is hi-res');
eq(tierOf({ lossless: true, sampleRate: 44100, bitDepth: 24 }).key, 'hires', 'above CD on depth alone is hi-res');
// Unknown must stay unknown rather than defaulting to a flattering answer.
eq(tierOf({ lossless: null }), null, 'an unknown codec has no tier');
eq(tierOf({}), null, 'nothing known means no tier');
eq(TIERS.hires.rank > TIERS.lossless.rank, true, 'hi-res outranks lossless');
eq(TIERS.lossless.rank > TIERS.lossy.rank, true, 'lossless outranks lossy');

eq(formatRate(44100), '44.1 kHz', 'a fractional rate keeps one decimal');
eq(formatRate(48000), '48 kHz', 'a whole rate drops the decimal');
eq(formatRate(0), null, 'a zero rate is not a rate');
eq(formatRate(null), null, 'a null rate is not a rate');

// -------------------------------------------------------- quality report
const flac = qualityReport({ source: 'local', format: FORMATS.flac, sampleRate: 44100, bitDepth: 16, deviceRate: 44100 });
eq(flac.tier.key, 'lossless', 'a CD-rate FLAC reports lossless');
eq(flac.label, 'FLAC · 44.1 kHz · 16-bit', 'the readout names format, rate and depth');
eq(flac.resampled, false, 'matching device and file rates means no resampling');
eq(flac.bitPerfect, false, 'even an unresampled FLAC does not claim bit-perfect');
ok(flac.why.includes('exclusive'), 'and it says the reason is exclusive device access');

const resamp = qualityReport({ source: 'local', format: FORMATS.flac, sampleRate: 96000, bitDepth: 24, deviceRate: 48000 });
eq(resamp.tier.key, 'hires', '96/24 reports hi-res');
eq(resamp.resampled, true, 'a device/file rate mismatch is detected');
ok(resamp.why.includes('resampling'), 'the resampling case names resampling as the blocker');

const sp = qualityReport({ source: 'spotify', bitrate: 320 });
eq(sp.bitPerfect, false, 'Spotify never claims bit-perfect');
ok(sp.why.includes('320'), "the Spotify blocker quotes the service's own ceiling");
eq(sp.label, '320 kbps', 'a stream with no file format reports its bitrate');
// Unknown rate: resampled must be null, not a guess in either direction.
eq(qualityReport({ source: 'local', format: FORMATS.flac }).resampled, null,
  'with no device rate, resampling is unknown rather than assumed');
eq(qualityReport({}).label, null, 'a readout with nothing known has no label');
eq(qualityReport({}).tier, null, 'a readout with nothing known has no tier');

ok(bitPerfectBlocker({ src: sourceOf('apple'), lossless: null, resampled: false }).includes('Apple'),
  'the Apple blocker names Apple');
ok(bitPerfectBlocker({ src: sourceOf('local'), lossless: false, resampled: false }).includes('lossy'),
  'a lossy local file is blocked by its own codec first');

// ------------------------------------------------------------------ queue
const Q = ['a', 'b', 'c'];
eq(queueNext(Q, 0), 1, 'next advances');
eq(queueNext(Q, 2), null, 'the end of the queue stops');
eq(queueNext(Q, 2, { repeat: 'all' }), 0, 'repeat-all wraps to the start');
eq(queueNext(Q, 1, { repeat: 'one' }), 1, 'repeat-one stays put');
eq(queueNext([], 0), null, 'an empty queue has no next');
eq(queueNext(['a'], 0, { repeat: 'all', shuffle: true }), 0, 'shuffling one track repeats it');

eq(queuePrev(Q, 2, 0), 1, 'back near the start of a track goes to the previous one');
eq(queuePrev(Q, 2, 30), 2, 'back later in a track restarts it');
eq(queuePrev(Q, 0, 0), 0, 'back from the first track stays on the first track');
eq(queuePrev([], 0, 0), null, 'an empty queue has no previous');

eq(fmtTime(0), '0:00', 'zero renders as 0:00');
eq(fmtTime(61), '1:01', 'seconds pad to two digits');
eq(fmtTime(599), '9:59', 'just under ten minutes');
eq(fmtTime(3600), '60:00', 'an hour is shown in minutes');
eq(fmtTime(null), '0:00', 'an unknown position renders as zero');
eq(fmtTime(-5), '0:00', 'a negative position renders as zero');

console.log(`${pass}/${pass + fail} passing`);
if (fail) process.exit(1);
