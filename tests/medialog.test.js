// The watch diary. Batch 1 of the media rebuild, and the foundation the other
// nine items sit on — none of the diary, the day/month grouping, the "don't
// suggest what I've watched" filter or the Letterboxd import can exist without
// a per-viewing record.
//
// The tests that matter here are about identity, not arithmetic:
//   · one title watched twice must be TWO entries, or rewatches vanish
//   · the same viewing imported twice must be ONE entry, or the diary doubles
//     every time the feed is read
// Those two pull in opposite directions and the viewing key is what separates
// them. Most of what follows is pressure on that boundary.

// The local-date tests are meaningless in a UTC process — local and UTC agree,
// so a function that wrongly used toISOString() would pass. Node reads TZ once
// at startup, so the suite re-execs itself in Asia/Kolkata rather than skipping
// the assertions or asserting something weaker. This is the timezone the app is
// actually used in.
if (process.env.TZ !== 'Asia/Kolkata') {
  const { spawnSync } = await import('child_process');
  const r = spawnSync(process.argv[0], [process.argv[1]], {
    stdio: 'inherit',
    env: { ...process.env, TZ: 'Asia/Kolkata' },
  });
  process.exit(r.status ?? 1);
}

import {
  todayLocal, validDate, viewingKey, addViewing, removeViewing, normaliseEntry,
  sortByDate, diary, monthLabel, undated, watchedKeys, hasWatched, withRewatch,
  summarise, streak, activity, DEFAULT_MOVIE_MIN,
} from '../src/lib/medialog.js';

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; } else { fail++; console.log('FAIL ' + name); } };
const eq = (a, b, name) => ok(a === b, `${name} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
const near = (a, b, name, tol = 0.01) => ok(Math.abs(a - b) < tol, `${name} (got ${a}, want ${b})`);

// ------------------------------------------------------------- local dates

// The bug this prevents: toISOString() is UTC, India is +5:30, so a film
// finished at 00:30 IST would be filed under the previous day. Late-night
// viewing is most viewing, so this is not an edge case.
const lateNight = new Date(2026, 5, 15, 0, 30);   // 15 June, 00:30 local
eq(todayLocal(lateNight), '2026-06-15', 'a 00:30 viewing is filed on the day it happened');
ok(todayLocal(lateNight) !== lateNight.toISOString().slice(0, 10),
  'and that is NOT what the UTC date would have said');

eq(todayLocal(new Date(2026, 0, 5)), '2026-01-05', 'single-digit months and days are padded');

// -------------------------------------------------------------- validDate

eq(validDate('2026-06-15'), '2026-06-15', 'a real date passes');
eq(validDate('2026-06-15T22:00:00Z'), '2026-06-15', 'a timestamp is truncated to its day');
eq(validDate('2026-02-31'), null, 'a date that never existed is rejected, not rolled forward');
eq(validDate('2026-13-01'), null, 'month 13 is rejected');
eq(validDate('15/06/2026'), null, 'a non-ISO format is not guessed at');
eq(validDate(''), null, 'empty is undated');
eq(validDate(null), null, 'null is undated');

// ------------------------------------------------- the two opposing pulls

let log = [];
log = addViewing(log, { title: 'Heat', tmdb_id: 949, on: '2026-06-01', rating: 5, runtime: 170 });
eq(log.length, 1, 'first viewing is recorded');

// SAME viewing again — an import re-run. Must not duplicate.
log = addViewing(log, { title: 'Heat', tmdb_id: 949, on: '2026-06-01' });
eq(log.length, 1, 're-importing the same viewing does not duplicate it');
eq(log[0].rating, 5, 'and an import carrying no rating does not erase the one you gave');
eq(log[0].runtime, 170, 'nor the runtime');

// DIFFERENT viewing of the same film — a rewatch. Must be a second entry.
log = addViewing(log, { title: 'Heat', tmdb_id: 949, on: '2026-07-20', rating: 4, runtime: 170 });
eq(log.length, 2, 'watching the same film on another day is a SECOND viewing');

// Same series, same day, different episodes: two viewings, not one.
let tv = [];
tv = addViewing(tv, { title: 'House', kind: 'tv', on: '2026-06-01', season: 1, episode: 1 });
tv = addViewing(tv, { title: 'House', kind: 'tv', on: '2026-06-01', season: 1, episode: 2 });
eq(tv.length, 2, 'two episodes on one evening are two viewings');
tv = addViewing(tv, { title: 'House', kind: 'tv', on: '2026-06-01', season: 1, episode: 2, rating: 4 });
eq(tv.length, 2, 'but re-logging one of them just updates it');
eq(tv[1].rating, 4, 'with the new rating applied');

// Rating and note are deliberately NOT part of identity.
eq(viewingKey({ title: 'Heat', on: '2026-06-01', rating: 5 }),
   viewingKey({ title: 'Heat', on: '2026-06-01', rating: 1 }),
   'changing your mind about a rating edits the viewing, it does not create one');

eq(removeViewing(log, log[0].id).length, 1, 'a viewing can be removed by id');

// --------------------------------------------------------------- entries

eq(normaliseEntry({ title: '  ' }), null, 'a viewing with no title is not a viewing');
eq(normaliseEntry({ title: 'Akira', kind: 'ANIME' }).kind, 'anime', 'kind is lowercased and kept wider than movie/tv');
eq(normaliseEntry({ title: 'X', on: 'garbage' }).on, null, 'an unparseable date becomes undated, NOT today');
eq(normaliseEntry({ title: 'X', rating: '' }).rating, null, 'an empty rating is absent, not zero');
eq(normaliseEntry({ title: 'X', rating: 0 }).rating, 0, 'but an explicit zero survives');

// ---------------------------------------------------------------- sorting

const mixed = [
  { id: 'a', title: 'Alpha', on: null },
  { id: 'b', title: 'Beta', on: '2026-06-01' },
  { id: 'c', title: 'Gamma', on: '2026-07-01' },
];
const sorted = sortByDate(mixed);
eq(sorted[0].id, 'c', 'newest first');
eq(sorted[2].id, 'a', 'and undated LAST — a missing field is not breaking news');

// ----------------------------------------------------------------- diary

const D = [
  { id: '1', title: 'Heat', on: '2026-06-01', runtime: 170, kind: 'movie' },
  { id: '2', title: 'Collateral', on: '2026-06-01', runtime: 120, kind: 'movie' },
  { id: '3', title: 'Sicario', on: '2026-06-14', runtime: 121, kind: 'movie' },
  { id: '4', title: 'Dune', on: '2026-07-02', runtime: 155, kind: 'movie' },
  { id: '5', title: 'Lost', on: null, kind: 'tv' },
];
const dy = diary(D);
eq(dy.length, 2, 'two months present');
eq(dy[0].key, '2026-07', 'newest month first');
eq(dy[0].label, 'July 2026', 'months are named, not numbered');
eq(dy[1].days.length, 2, 'June has two distinct days');
eq(dy[1].days[0].date, '2026-06-14', 'newest day first within a month');
eq(dy[1].days[1].entries.length, 2, 'the double-feature day holds both films');
eq(dy[1].count, 3, 'the month counts viewings, not days');
eq(dy.reduce((s, m) => s + m.count, 0), 4, 'the undated entry is not in the diary');
eq(undated(D).length, 1, 'it is in its own bucket instead of being lost');
eq(monthLabel('nonsense'), 'nonsense', 'an unparseable month key is passed through, not blanked');

// ------------------------------------------------------- already watched

const keys = watchedKeys(D);
ok(hasWatched(keys, { title: 'Heat' }), 'a watched title is recognised by name');
ok(hasWatched(keys, { title: 'HEAT' }), 'case does not matter');
ok(!hasWatched(keys, { title: 'Tenet' }), 'an unwatched film is not');
ok(hasWatched(watchedKeys([{ title: 'A', tmdb_id: 42 }]), { tmdb_id: 42, title: 'renamed' }),
  'a tmdb id matches even when the title differs — this is the AI suggester\'s filter');
ok(!hasWatched(null, { title: 'Heat' }), 'no history means nothing is watched, not everything');

// ------------------------------------------------------------- rewatches

const rw = withRewatch(log);
const byDate = rw.slice().sort((a, b) => String(a.on).localeCompare(String(b.on)));
eq(byDate[0].rewatch, false, 'the FIRST viewing of a film is not a rewatch');
eq(byDate[1].rewatch, true, 'the second one is — derived from the dates, not from a checkbox');
eq(withRewatch([{ id: 'x', title: 'Solo', on: '2026-01-01', rewatch: true }])[0].rewatch, true,
  'an explicit flag is still honoured, since an import may know what local history does not');

// ---------------------------------------------------------------- totals

const s = summarise(D);
eq(s.viewings, 5, 'five viewings');
eq(s.titles, 5, 'of five distinct titles');
eq(s.rewatches, 0, 'so no rewatches');
eq(s.minutes, 170 + 120 + 121 + 155, 'known runtimes are summed');
eq(s.exact, false, 'and the total is NOT called exact, because one runtime is missing');
eq(s.unknownRuntime, 1, 'the missing one is counted rather than treated as zero');
ok(s.estHours > s.hours, 'the estimate is larger than the floor');

const heatTwice = summarise(log);
eq(heatTwice.viewings, 2, 'two viewings');
eq(heatTwice.titles, 1, 'of one title');
eq(heatTwice.rewatches, 1, 'is one rewatch');

eq(summarise([]).avgRating, null, 'an average over no ratings is nothing, not zero');
near(summarise([{ title: 'a', rating: 4 }, { title: 'b', rating: 5 }, { title: 'c' }]).avgRating, 4.5,
  'and unrated viewings do not drag the average down');
eq(summarise([{ title: 'a', kind: 'movie' }]).estHours * 60, DEFAULT_MOVIE_MIN,
  'a movie with no runtime is estimated at a movie length, not an episode length');

// ---------------------------------------------------------------- streak

const T = new Date(2026, 6, 10);   // Friday 10 July
const run = [
  { title: 'a', on: '2026-07-10' }, { title: 'b', on: '2026-07-09' }, { title: 'c', on: '2026-07-08' },
];
eq(streak(run, T), 3, 'three consecutive days');
eq(streak([{ title: 'a', on: '2026-07-08' }], T), 0, 'a gap breaks it');

// Today empty, yesterday watched: the streak is alive. You have not failed to
// watch a film today at nine in the morning.
eq(streak([{ title: 'a', on: '2026-07-09' }, { title: 'b', on: '2026-07-08' }], T), 2,
  'an empty today does not break a streak that ran through yesterday');
eq(streak([], T), 0, 'no viewings, no streak');

// -------------------------------------------------------------- activity

const act = activity(D, { days: 40, to: new Date(2026, 6, 5) });
eq(act.length, 40, 'one cell per day, gaps included');
eq(act[act.length - 1].date, '2026-07-05', 'ending today');
eq(act.find(a => a.date === '2026-06-01').count, 2, 'the double-feature day reads 2');
eq(act.find(a => a.date === '2026-06-02').count, 0, 'a quiet day is a zero, not a missing cell');

console.log(`${pass}/${pass + fail} passing`);
if (fail) process.exit(1);
