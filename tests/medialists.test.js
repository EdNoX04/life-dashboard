// Custom lists — batch 5.
//
// The shortcut here is to implement lists as saved filters over the existing
// statuses. That is wrong in a way that only shows up later: a status is
// exclusive and describes your relationship to a title (watchlist OR completed,
// never both), while a list is many-to-many and describes the title ("Sunday
// afternoon", "show Ma"). Build them as filters and "put this one film on this
// one list" — the only operation anyone performs — becomes impossible.
//
// The other thing worth defending: ORDER IS CONTENT. A ranked top ten is a
// different object from the same ten films sorted A–Z, so membership is an
// array and sorting is a view that never writes.

import {
  makeList, addList, removeList, renameList, itemKey, findList,
  addTo, removeFrom, moveItem, noteOn, listsWith, listProgress, sortItems,
} from '../src/lib/medialists.js';

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; } else { fail++; console.log('FAIL ' + name); } };
const eq = (a, b, name) => ok(a === b, `${name} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

// ------------------------------------------------------------- making them

const l1 = makeList({ name: 'Sunday afternoon' });
eq(l1.id, 'l:sunday-afternoon', 'the id is slugged from the name');
eq(l1.items.length, 0, 'a new list is empty');
eq(l1.ranked, false, 'and unranked unless asked');
eq(makeList({ name: '' }), null, 'a nameless list is not a list');
eq(makeList({ name: '   ' }), null, 'nor is a whitespace one');
eq(makeList({ name: 'Films that ruined me!!! ★' }).id, 'l:films-that-ruined-me',
  'punctuation and symbols are stripped from the handle');

let lists = addList([], l1);
eq(lists.length, 1, 'it is added');

// A name collision must not silently merge into the existing list — that would
// move films the user never asked to move.
lists = addList(lists, makeList({ name: 'Sunday afternoon' }));
eq(lists.length, 2, 'a second list of the same name is a SECOND list');
eq(lists[1].id, 'l:sunday-afternoon-2', 'with a distinct handle');
lists = removeList(lists, lists[1].id);

// Renaming keeps the handle. Regenerating it would orphan every reference.
lists = renameList(lists, 'l:sunday-afternoon', 'Lazy Sundays');
eq(lists[0].name, 'Lazy Sundays', 'the name changes');
eq(lists[0].id, 'l:sunday-afternoon', 'the id does NOT — it is a stable handle');
eq(renameList(lists, 'l:sunday-afternoon', '  ')[0].name, 'Lazy Sundays',
  'and an empty rename is ignored rather than blanking it');

// ------------------------------------------------------------------ identity

eq(itemKey({ tmdb_id: 949, title: 'Heat' }), 'id:949', 'a TMDB id is the identity when present');
eq(itemKey({ title: 'Heat' }), 't:heat', 'and the lowercased title when not');
eq(itemKey({ title: 'HEAT' }), 't:heat', 'case does not matter');
eq(itemKey({ tmdb_id: 949, title: 'Renamed' }), 'id:949',
  'so a retitled row still matches — manually-added titles must be list-able too');

// ---------------------------------------------------------------- membership

const heat = { tmdb_id: 949, title: 'Heat', year: 1995, kind: 'movie' };
const dune = { tmdb_id: 438631, title: 'Dune', year: 2021, kind: 'movie' };

lists = addTo(lists, 'l:sunday-afternoon', heat);
lists = addTo(lists, 'l:sunday-afternoon', dune);
eq(findList(lists, 'l:sunday-afternoon').items.length, 2, 'two films on the list');

lists = addTo(lists, 'l:sunday-afternoon', heat);
eq(findList(lists, 'l:sunday-afternoon').items.length, 2, 'adding the same film twice is a no-op');

lists = addTo(lists, 'l:sunday-afternoon', { title: '' });
eq(findList(lists, 'l:sunday-afternoon').items.length, 2, 'and a title with no name is not added');

// The many-to-many property that separates a list from a status.
lists = addList(lists, makeList({ name: 'Show Ma', ranked: true }));
lists = addTo(lists, 'l:show-ma', heat);
eq(listsWith(lists, heat).length, 2, 'one film can sit on two lists at once');
eq(listsWith(lists, dune).length, 1, 'while another sits on one');
eq(listsWith(lists, { title: 'Unseen' }).length, 0, 'and a film on none is on none');

lists = removeFrom(lists, 'l:show-ma', itemKey(heat));
eq(findList(lists, 'l:show-ma').items.length, 0, 'removing from one list…');
eq(findList(lists, 'l:sunday-afternoon').items.length, 2, '…leaves the other alone');

// -------------------------------------------------------------------- order

let ranked = addList([], makeList({ name: 'Top', ranked: true }));
for (const t of [{ title: 'A' }, { title: 'B' }, { title: 'C' }]) ranked = addTo(ranked, 'l:top', t);
eq(ranked[0].items.map(i => i.title).join(''), 'ABC', 'new entries append');
// Appending matters on a ranked list: making a new entry number one would be
// the tool making an editorial claim on your behalf.

ranked = moveItem(ranked, 'l:top', 't:c', -1);
eq(ranked[0].items.map(i => i.title).join(''), 'ACB', 'an item moves up one');
ranked = moveItem(ranked, 'l:top', 't:c', -5);
eq(ranked[0].items.map(i => i.title).join(''), 'CAB', 'and is CLAMPED at the top, never wrapped');
ranked = moveItem(ranked, 'l:top', 't:c', 99);
eq(ranked[0].items.map(i => i.title).join(''), 'ABC', 'clamped at the bottom too');
eq(moveItem(ranked, 'l:top', 't:zzz', 1)[0].items.map(i => i.title).join(''), 'ABC',
  'moving something that is not there changes nothing');

// Sorting is a VIEW and must never touch a ranked list.
eq(sortItems(ranked[0], 'title').map(i => i.title).join(''), 'ABC',
  'a ranked list ignores sorting — the order IS the content');
const bag = addTo(addTo(addList([], makeList({ name: 'Bag' })), 'l:bag',
  { title: 'Zodiac', year: 2007 }), 'l:bag', { title: 'Alien', year: 1979 });
eq(sortItems(bag[0], 'title').map(i => i.title).join(','), 'Alien,Zodiac', 'an unranked list sorts A–Z');
eq(sortItems(bag[0], 'year').map(i => i.title).join(','), 'Zodiac,Alien', 'and by year, newest first');
eq(bag[0].items.map(i => i.title).join(','), 'Zodiac,Alien', 'while the stored order is untouched');
eq(sortItems(addTo(bag, 'l:bag', { title: 'Undated' })[0], 'year').slice(-1)[0].title, 'Undated',
  'a film with no year sorts last rather than as year zero');

// --------------------------------------------------------------- progress

// Read off the DIARY, not the shelf: a film watched in 2023 and never shelved is
// still watched, and progress against a list is the reason to keep one.
const watched = new Set(['id:949']);
const p = listProgress(findList(lists, 'l:sunday-afternoon'), watched);
eq(p.total, 2, 'two films on the list');
eq(p.seen, 1, 'one of them seen');
eq(p.pct, 50, 'which is half');
eq(p.done, false, 'so not finished');

eq(listProgress(findList(lists, 'l:sunday-afternoon'), new Set(['id:949', 'id:438631'])).done, true,
  'seeing both finishes it');
eq(listProgress({ items: [] }, watched).pct, null,
  'an empty list has no percentage — 0% would imply a target you have failed');
eq(listProgress(null, watched).total, 0, 'and a missing list is simply empty');

// A title matched by NAME because it was added by hand with no TMDB id.
eq(listProgress({ items: [{ key: 't:solaris', title: 'Solaris' }] }, new Set(['t:solaris'])).seen, 1,
  'a hand-added title still counts as watched');

// ---------------------------------------------------------------- notes

lists = noteOn(lists, 'l:sunday-afternoon', 'id:949', '  the diner scene  ');
eq(findList(lists, 'l:sunday-afternoon').items.find(i => i.key === 'id:949').note, 'the diner scene',
  'a note is trimmed and kept');
lists = noteOn(lists, 'l:sunday-afternoon', 'id:949', '');
eq(findList(lists, 'l:sunday-afternoon').items.find(i => i.key === 'id:949').note, null,
  'and cleared to null rather than an empty string');

console.log(`${pass}/${pass + fail} passing`);
if (fail) process.exit(1);
