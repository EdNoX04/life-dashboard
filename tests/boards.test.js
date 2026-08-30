// Pins saving and restoring a drawing.
//
// The old Notes board persisted nothing at all — no table, no memory row, not
// even localStorage — so a tab switch threw the drawing away while the page
// controls and PDF export made it look like a notebook. Everything here is about
// the job that was missing.

import {
  sanitizeScene, sceneFromRow, sceneChanged, sceneHasContent,
  sceneBytes, sceneTooBig, MAX_SCENE_BYTES, defaultBoardName, boardTitle, sortBoards,
} from '../src/lib/boards.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log('FAIL ' + n); } };
const is = (a, b, n) => ok(Object.is(a, b), `${n} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const el = (id, version = 1, extra = {}) => ({ id, version, type: 'freedraw', points: [[0, 0]], ...extra });

// ---------------------------------------------------------------- what is kept
const messy = {
  elements: [el('a'), el('b', 1, { isDeleted: true }), null, 'nope'],
  appState: {
    viewBackgroundColor: '#12121a', theme: 'dark',
    // Editor state, not drawing state.
    scrollX: 421, scrollY: -80, selectedElementIds: { a: true },
    collaborators: new Map([['x', {}]]), cursorButton: 'down',
  },
};
const clean = sanitizeScene(messy);
is(clean.elements.length, 1, 'deleted and junk elements are dropped');
is(clean.elements[0].id, 'a', 'the live one survives');
is(clean.appState.viewBackgroundColor, '#12121a', 'drawing properties are kept');
is(clean.appState.theme, 'dark', 'and so is the theme');
is(clean.appState.scrollX, undefined, 'scroll position is not part of the drawing');
is(clean.appState.selectedElementIds, undefined, 'nor is what happened to be selected');
is(clean.appState.collaborators, undefined, 'nor the collaborator list');

is(sanitizeScene(null).elements.length, 0, 'a null scene is empty, not a crash');
is(sanitizeScene({ elements: 'not an array' }).elements.length, 0, 'and so is a malformed one');

// ---------------------------------------------------------------- restoring
const restored = sceneFromRow({ scene: messy });
ok(restored.appState.collaborators instanceof Map, 'collaborators is rebuilt as an empty Map');
is(restored.appState.collaborators.size, 0, 'and it is empty — a saved one draws ghost cursors');
is(restored.scrollToContent, true, 'reopening scrolls to the drawing rather than to wherever 0,0 is');
is(sceneFromRow(undefined).elements.length, 0, 'a missing row opens an empty board');
is(sceneFromRow({ scene: null }).elements.length, 0, 'and so does a null scene');

// ---------------------------------------------------------------- change detection
// Excalidraw fires onChange on pointer moves and selection too, so without this
// a save-on-change writes several times a second while a pencil is down.
const base = { elements: [el('a', 3)], appState: { viewBackgroundColor: '#000' } };
ok(!sceneChanged(base, base), 'an identical scene is not a change');
ok(!sceneChanged(base, { elements: [el('a', 3)], appState: { viewBackgroundColor: '#000', scrollX: 99 } }),
  'scrolling is not a change — this is the one that would hammer the database');
ok(sceneChanged(base, { elements: [el('a', 4)], appState: base.appState }), 'a version bump is a change');
ok(sceneChanged(base, { elements: [el('a', 3), el('b')], appState: base.appState }), 'a new element is a change');
ok(sceneChanged(base, { elements: [el('z', 3)], appState: base.appState }), 'a different element id is a change');
ok(sceneChanged(base, { elements: [el('a', 3)], appState: { viewBackgroundColor: '#fff' } }),
  'changing the paper colour is a change');

// ---------------------------------------------------------------- emptiness
ok(!sceneHasContent({ elements: [] }), 'an empty board has no content');
ok(!sceneHasContent({ elements: [el('a', 1, { isDeleted: true })] }), 'nor does one where everything was erased');
ok(sceneHasContent(base), 'a drawn board does');

// ---------------------------------------------------------------- size
ok(sceneBytes(base) > 0, 'a scene has a size');
ok(!sceneTooBig(base), 'a small scene is fine');
const huge = { elements: Array.from({ length: 2000 }, (_, i) => el('e' + i, 1, { points: Array.from({ length: 600 }, (_, j) => [j * 1.5, j * 2.25]) })), appState: {} };
ok(sceneBytes(huge) > MAX_SCENE_BYTES, 'the fixture is genuinely large');
ok(sceneTooBig(huge), 'and is caught before it reaches Postgres — a sentence in the UI beats a database error');

// ---------------------------------------------------------------- naming
is(defaultBoardName(new Date('2026-08-30T14:05:00')), '2026-08-30 14:05', 'a new board is named for when it was made');
is(boardTitle({ name: '  ' }), 'Untitled', 'a blank name falls back');
is(boardTitle({}), 'Untitled', 'and so does a missing one');
is(boardTitle({ name: 'IoT lecture' }), 'IoT lecture', 'a real name is kept');

is(sortBoards([{ updated_at: '2026-01-01' }, { updated_at: '2026-08-30' }])[0].updated_at, '2026-08-30', 'newest first');
is(sortBoards(null).length, 0, 'a missing list sorts to nothing');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
