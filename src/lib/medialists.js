// Custom lists — the Letterboxd kind, not playlists.
//
// The shelf already has statuses, and it is tempting to call those lists and
// stop. They are not the same thing and the difference is the whole feature:
//
//   A STATUS is exclusive and describes YOUR RELATIONSHIP to a title. It is
//   watchlist or watching or completed, never two at once, and every title has
//   exactly one.
//   A LIST is many-to-many and describes the TITLE. "Films that ruined me",
//   "Sunday afternoon", "show Ma" — a film belongs to none, one, or four, and
//   being on a list says nothing about whether you have seen it.
//
// So a list is not a filter over statuses; it is its own membership, and a title
// can sit on three lists while being filed as completed. Building lists as
// saved searches — the shortcut — makes "add this one film to this one list"
// impossible, which is the only operation anyone actually performs.
//
// ORDER IS CONTENT. A ranked top-ten is a different object from the same ten
// films alphabetically, so membership is an ARRAY and stays in the order you put
// it in. Sorting is a view, never a write.
//
// Stored as a memory blob for the same zero-migration reason as the diary, in a
// shape that could become two tables (lists, list_items) without touching a
// caller.

export const num = v => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const slugify = s => String(s || '')
  .toLowerCase().trim()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 48);

// A list needs a name and nothing else. Everything optional stays optional —
// asking for a description before you can save a list is how lists do not get
// made.
export function makeList({ name, description = '', ranked = false, id = null } = {}) {
  const clean = String(name || '').trim();
  if (!clean) return null;
  return {
    id: id || `l:${slugify(clean) || 'list'}`,
    name: clean,
    description: String(description || '').trim() || null,
    // A ranked list numbers itself and refuses to be re-sorted in the UI; an
    // unranked one is a bag you can view any way you like.
    ranked: ranked === true,
    items: [],
    created: null,
  };
}

// The identity of a title across the app: TMDB id when there is one, lowercased
// title when there is not. Manually-added rows have no id and must still be
// list-able.
export function itemKey(t = {}) {
  if (t.tmdb_id != null && t.tmdb_id !== '') return `id:${t.tmdb_id}`;
  return `t:${String(t.title || '').toLowerCase().trim()}`;
}

export function findList(lists = [], id) {
  return lists.find(l => l.id === id) || null;
}

export function addList(lists = [], list) {
  if (!list) return lists.slice();
  // A name collision gets a suffix rather than silently merging into the
  // existing list, which would move films you never asked to move.
  let id = list.id, n = 2;
  while (lists.some(l => l.id === id)) { id = `${list.id}-${n}`; n += 1; }
  return [...lists, { ...list, id }];
}

export function removeList(lists = [], id) {
  return lists.filter(l => l.id !== id);
}

export function renameList(lists = [], id, name) {
  const clean = String(name || '').trim();
  if (!clean) return lists.slice();
  // The id is NOT regenerated from the new name. It is a stable handle, and
  // rewriting it would orphan anything holding a reference.
  return lists.map(l => (l.id === id ? { ...l, name: clean } : l));
}

/**
 * Put a title on a list.
 *
 * Appends rather than prepends: on a ranked list, a new entry belongs at the
 * bottom until you move it, and silently making it number one would be the tool
 * making an editorial claim.
 */
export function addTo(lists = [], listId, title) {
  const key = itemKey(title);
  if (!key || key === 't:') return lists.slice();
  return lists.map(l => {
    if (l.id !== listId) return l;
    if (l.items.some(i => itemKey(i) === key)) return l;   // already on it
    return {
      ...l,
      items: [...l.items, {
        key,
        tmdb_id: title.tmdb_id ?? null,
        title: title.title,
        year: num(title.year),
        kind: title.kind || title.type || 'movie',
        poster_url: title.poster_url || null,
        note: null,
      }],
    };
  });
}

export function removeFrom(lists = [], listId, key) {
  return lists.map(l => (l.id === listId ? { ...l, items: l.items.filter(i => i.key !== key) } : l));
}

// Move an item within a ranked list. Clamped rather than wrapped: dragging past
// the end should stop at the end, not teleport to the top.
export function moveItem(lists = [], listId, key, delta) {
  return lists.map(l => {
    if (l.id !== listId) return l;
    const at = l.items.findIndex(i => i.key === key);
    if (at < 0) return l;
    const to = Math.max(0, Math.min(l.items.length - 1, at + delta));
    if (to === at) return l;
    const items = l.items.slice();
    const [moved] = items.splice(at, 1);
    items.splice(to, 0, moved);
    return { ...l, items };
  });
}

export function noteOn(lists = [], listId, key, note) {
  const clean = String(note || '').trim() || null;
  return lists.map(l => (l.id === listId
    ? { ...l, items: l.items.map(i => (i.key === key ? { ...i, note: clean } : i)) }
    : l));
}

// Which lists a title is already on — for the "add to list" menu, so it can show
// ticks rather than making you remember.
export function listsWith(lists = [], title) {
  const key = itemKey(title);
  return lists.filter(l => l.items.some(i => i.key === key)).map(l => l.id);
}

/**
 * How much of a list you have actually watched.
 *
 * Read off the DIARY rather than the shelf, for the same reason Discover does:
 * a film you saw in 2023 and never shelved is still watched. This is what makes
 * a list like "IMDb top 250" useful — progress against it is the point.
 */
export function listProgress(list, watched) {
  const total = list?.items?.length || 0;
  if (!total) return { total: 0, seen: 0, pct: null, done: false };
  const seen = list.items.filter(i => watched?.has(i.key)
    || (i.tmdb_id != null && watched?.has(`id:${i.tmdb_id}`))
    || watched?.has(`t:${String(i.title).toLowerCase().trim()}`)).length;
  return { total, seen, pct: (seen / total) * 100, done: seen === total };
}

// Sorting is a VIEW. It never writes back, and it refuses to touch a ranked
// list, where the order is the content.
export const LIST_SORTS = [
  { key: 'manual', label: 'AS SET' },
  { key: 'title', label: 'A–Z' },
  { key: 'year', label: 'YEAR' },
];

export function sortItems(list, key = 'manual') {
  const items = list?.items || [];
  if (list?.ranked || key === 'manual') return items;
  const out = items.slice();
  if (key === 'title') out.sort((a, b) => String(a.title).localeCompare(String(b.title)));
  // Newest first, and a title with no year sorts last rather than as year zero.
  if (key === 'year') out.sort((a, b) => (b.year ?? -Infinity) - (a.year ?? -Infinity));
  return out;
}
