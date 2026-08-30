// Excalidraw scenes, on the way in and out of the database.
//
// The old board kept nothing: drawings lived in React state and were gone on a
// tab switch. So everything here is about the one job that was missing — putting
// a scene somewhere and getting the same scene back.
//
// Pure, so the awkward parts (a half-written row, a scene big enough to matter,
// a name someone left blank) can be tested without a browser or a canvas.

// What actually needs storing. Excalidraw's appState carries the whole editor —
// scroll position, which tool is selected, the collaborator list, undo history —
// and persisting that means restoring someone else's cursor position onto a
// drawing. Only the properties of the DRAWING are kept.
const KEEP_APPSTATE = ['viewBackgroundColor', 'gridSize', 'gridModeEnabled', 'theme'];

// A soft ceiling, checked before saving. A page of handwriting is a few thousand
// points; this is roughly a dozen dense pages. It exists so the failure is a
// sentence in the UI rather than a Postgres error the user cannot act on.
export const MAX_SCENE_BYTES = 4_000_000;

export function sanitizeScene(scene) {
  const elements = Array.isArray(scene?.elements)
    ? scene.elements.filter(e => e && typeof e === 'object' && !e.isDeleted)
    : [];
  const appState = {};
  for (const k of KEEP_APPSTATE) {
    const v = scene?.appState?.[k];
    if (v !== undefined && v !== null) appState[k] = v;
  }
  return { elements, appState };
}

/** What comes back from the database, made safe to hand to Excalidraw. */
export function sceneFromRow(row) {
  const scene = sanitizeScene(row?.scene);
  return {
    elements: scene.elements,
    appState: {
      ...scene.appState,
      // Never restored, always recomputed: a saved collaborator list makes
      // Excalidraw render ghost cursors for people who were never there.
      collaborators: new Map(),
    },
    scrollToContent: true,
  };
}

export const sceneBytes = scene => JSON.stringify(sanitizeScene(scene)).length;
export const sceneTooBig = scene => sceneBytes(scene) > MAX_SCENE_BYTES;

/** True when a scene is worth writing — an empty board should not create a row. */
export const sceneHasContent = scene => sanitizeScene(scene).elements.length > 0;

/**
 * Whether anything actually changed.
 *
 * Excalidraw fires onChange on pointer moves and selection, not only on edits,
 * so a save-on-change with no comparison writes to the database several times a
 * second while a pencil is down.
 */
export function sceneChanged(a, b) {
  const x = sanitizeScene(a), y = sanitizeScene(b);
  if (x.elements.length !== y.elements.length) return true;
  for (let i = 0; i < x.elements.length; i++) {
    // `version` increments on every mutation, which is exactly the question
    // being asked, and comparing it beats deep-equalling thousands of points.
    if (x.elements[i].id !== y.elements[i].id) return true;
    if (x.elements[i].version !== y.elements[i].version) return true;
  }
  return JSON.stringify(x.appState) !== JSON.stringify(y.appState);
}

const pad = n => String(n).padStart(2, '0');

/** A default name that says when, because "Untitled 4" says nothing. */
export function defaultBoardName(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

export function boardTitle(row) {
  const n = String(row?.name || '').trim();
  return n || 'Untitled';
}

/** Newest first, which is the order a drawing app is used in. */
export const sortBoards = rows =>
  [...(rows || [])].sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
