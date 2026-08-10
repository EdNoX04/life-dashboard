// The watch diary — one row per VIEWING, not per title.
//
// This is the piece the media tab never had, and everything else asked for
// depends on it. The `movies` table records what is on the shelf and what state
// it is in; it has exactly one row per title and nowhere to put a date. So
// "when did I watch this" had no answer, "what did I watch in June" had no
// answer, and a film seen twice was indistinguishable from a film seen once.
//
// The split that matters, and the one that cannot be fixed later without
// rewriting every row:
//
//   A TITLE is one shelf row.   A VIEWING is one log entry.
//   Watching Heat twice is ONE title and TWO entries.
//
// Collapse those and rewatches are either invisible (second viewing overwrites
// the first) or duplicated (the shelf grows a second Heat). Letterboxd gets this
// right and it is why its diary works at all.
//
// Storage is a memory blob rather than a new table, following the project's
// zero-migration rule — the same reason `media_meta` is a blob. The shape below
// is deliberately table-shaped so it can become one later without touching any
// caller: every entry carries its own id and no entry depends on its position
// in the array.

export const num = v => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Today, in the LOCAL calendar.
 *
 * `new Date().toISOString().slice(0,10)` is the obvious way to do this and it is
 * wrong here. It returns the UTC date, and India runs +5:30 ahead of UTC — so a
 * film finished at 00:30 IST gets filed under the PREVIOUS day, which is
 * precisely the case a diary has to get right. Late-night viewing is most of the
 * viewing.
 */
export function todayLocal(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// A date this app is willing to file. Anything else is treated as undated
// rather than coerced — an import with a broken date should land in a visible
// "no date" bucket, not silently on today.
export function validDate(s) {
  const t = String(s ?? '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const [y, m, d] = t.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  // Rejects 31 February and friends: the Date constructor rolls them forward,
  // so a round-trip that changes the day means the date never existed.
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return t;
}

// The identity of a viewing. Two entries are the SAME viewing when they are the
// same title, on the same day, at the same point in the series — which is what
// makes a re-import idempotent without also merging a genuine double-feature of
// two different episodes.
//
// Note what is NOT in the key: rating and note. Changing your mind about a star
// rating edits the viewing, it does not create a second one.
export function viewingKey(e = {}) {
  const title = String(e.tmdb_id ?? e.title ?? '').toString().toLowerCase().trim();
  const s = e.season == null || e.season === '' ? '' : String(e.season);
  const ep = e.episode == null || e.episode === '' ? '' : String(e.episode);
  const on = validDate(e.on);
  // An UNDATED entry has no date to distinguish it, so the year does that job.
  // Without this, two different films sharing a title fold into one: the
  // Letterboxd films-list import hit exactly that on two separate "Home Alone"
  // entries and came back one film short of the profile, with nothing to
  // indicate anything had gone wrong.
  //
  // Dated entries keep the year OUT of the key on purpose. Two different films
  // with the same title watched on the same day is vanishingly rare; a year one
  // source knows and another does not is routine, and including it there would
  // break the dedupe that keeps a daily re-import from doubling the diary.
  if (!on) return `${title}|undated:${e.year ?? '?'}|${s}|${ep}`;
  return `${title}|${on}|${s}|${ep}`;
}

let seq = 0;
function makeId(e) {
  // Deterministic where possible so a re-import does not churn ids. The counter
  // is only a tiebreak for undated entries, which have no natural identity.
  return `${viewingKey(e)}#${(seq += 1)}`;
}

/**
 * Add a viewing, or update the one it duplicates.
 *
 * Returns a NEW array — callers store it back. An existing entry with the same
 * viewing key is merged rather than appended, so importing the same Letterboxd
 * feed twice does not double your diary.
 */
export function addViewing(list = [], entry = {}, { id = null } = {}) {
  const clean = normaliseEntry(entry);
  if (!clean) return list.slice();
  const key = viewingKey(clean);
  const out = list.slice();
  const at = out.findIndex(e => viewingKey(e) === key);
  if (at >= 0) {
    // Later information wins field by field, but a field the new entry does not
    // mention must not erase what is already recorded. An import that carries no
    // note should not wipe a note you wrote by hand.
    const prev = out[at];
    out[at] = {
      ...prev,
      ...Object.fromEntries(Object.entries(clean).filter(([, v]) => v != null && v !== '')),
      id: prev.id,
    };
    return out;
  }
  out.push({ ...clean, id: id || makeId(clean) });
  return out;
}

export function removeViewing(list = [], id) {
  return list.filter(e => e.id !== id);
}

export function normaliseEntry(e = {}) {
  const title = String(e.title ?? '').trim();
  if (!title) return null;
  return {
    title,
    tmdb_id: e.tmdb_id ?? null,
    // Carried because viewingKey needs it to tell two same-titled films apart
    // when neither has a date.
    year: num(e.year),
    // `kind` is wider than the shelf's movie/tv because anime and sitcoms are
    // asked about separately and collapsing them into "tv" loses the only thing
    // that distinguishes them at a glance.
    kind: String(e.kind || e.type || 'movie').toLowerCase(),
    on: validDate(e.on),
    season: num(e.season),
    episode: num(e.episode),
    rating: num(e.rating),
    runtime: num(e.runtime),
    rewatch: e.rewatch === true,
    // NOTE and REVIEW are different things and collapsing them loses one.
    // A note is a line for yourself — "with Ma", "rewatch for the score". A
    // review is writing you would stand behind, and it wants a paragraph, its
    // own display, and to survive an import that carries one.
    note: String(e.note ?? '').trim() || null,
    review: String(e.review ?? '').trim() || null,
    poster_url: e.poster_url || null,
    source: e.source || 'manual',
  };
}

// ------------------------------------------------------------------- reading

export function sortByDate(list = []) {
  // Undated entries sort last rather than first. They are real viewings with a
  // missing field, and putting them at the top of a diary would make the most
  // recent thing on screen the thing with the least information.
  return list.slice().sort((a, b) => {
    const da = validDate(a.on), db = validDate(b.on);
    if (da && db) return db.localeCompare(da) || String(a.title).localeCompare(String(b.title));
    if (da) return -1;
    if (db) return 1;
    return String(a.title).localeCompare(String(b.title));
  });
}

/**
 * The diary: months, each holding days, each holding viewings.
 *
 * Grouped rather than flat because the shape of the data IS the interesting
 * part — four films in one weekend and nothing for three weeks is a fact about
 * how you watch, and a flat reverse-chronological list hides it behind
 * scrolling.
 */
export function diary(list = []) {
  const dated = sortByDate(list).filter(e => validDate(e.on));
  const months = new Map();
  for (const e of dated) {
    const mk = e.on.slice(0, 7);
    if (!months.has(mk)) months.set(mk, new Map());
    const days = months.get(mk);
    if (!days.has(e.on)) days.set(e.on, []);
    days.get(e.on).push(e);
  }
  return [...months.entries()].map(([key, days]) => ({
    key,
    label: monthLabel(key),
    count: [...days.values()].reduce((s, d) => s + d.length, 0),
    days: [...days.entries()].map(([d, entries]) => ({ date: d, day: Number(d.slice(8, 10)), entries }))
      .sort((a, b) => b.date.localeCompare(a.date)),
  })).sort((a, b) => b.key.localeCompare(a.key));
}

export function monthLabel(key) {
  const [y, m] = String(key).split('-').map(Number);
  if (!y || !m) return String(key);
  return `${['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'][m - 1]} ${y}`;
}

export function undated(list = []) {
  return list.filter(e => !validDate(e.on));
}

/**
 * Everything already seen, as a lookup.
 *
 * The AI suggester needs this to avoid recommending a film you watched last
 * month, and "have I seen this" is asked once per candidate — so it has to be a
 * set, not a scan. Keyed by tmdb id where there is one and by lowercased title
 * where there is not, because a manually-added row has no id and still counts
 * as watched.
 */
export function watchedKeys(list = []) {
  const s = new Set();
  for (const e of list) {
    if (e.tmdb_id != null && e.tmdb_id !== '') s.add(`id:${e.tmdb_id}`);
    if (e.title) s.add(`t:${String(e.title).toLowerCase().trim()}`);
  }
  return s;
}

export function hasWatched(keys, candidate = {}) {
  if (!keys) return false;
  if (candidate.tmdb_id != null && keys.has(`id:${candidate.tmdb_id}`)) return true;
  return !!candidate.title && keys.has(`t:${String(candidate.title).toLowerCase().trim()}`);
}

/**
 * Which viewings of a title were rewatches.
 *
 * Derived from the diary rather than trusted from a checkbox. The first time you
 * saw something is a fact about the dates on record, and asking the user to
 * remember to tick "rewatch" guarantees the flag is wrong. An explicit flag is
 * still honoured — an import may know something the local history does not.
 */
export function withRewatch(list = []) {
  const firstSeen = new Map();
  for (const e of sortByDate(list).slice().reverse()) {
    const k = e.tmdb_id != null ? `id:${e.tmdb_id}` : `t:${String(e.title).toLowerCase()}`;
    if (!firstSeen.has(k)) firstSeen.set(k, e.id);
  }
  return list.map(e => {
    const k = e.tmdb_id != null ? `id:${e.tmdb_id}` : `t:${String(e.title).toLowerCase()}`;
    return { ...e, rewatch: e.rewatch === true || firstSeen.get(k) !== e.id };
  });
}

export const DEFAULT_EPISODE_MIN = 42;
export const DEFAULT_MOVIE_MIN = 110;

/**
 * Totals over a set of viewings.
 *
 * Runtime is reported as a floor plus an estimate, never as one confident
 * number, for the same reason the shelf does it: a viewing with no runtime
 * recorded is unknown, and counting it as zero would make a heavy month look
 * light. `exact` is the only claim made without qualification.
 */
export function summarise(list = []) {
  let minutes = 0, unknown = 0, rated = 0, ratingSum = 0;
  const titles = new Set();
  for (const e of list) {
    const rt = num(e.runtime);
    if (rt && rt > 0) minutes += rt;
    else unknown++;
    const r = num(e.rating);
    if (r != null && r > 0) { rated++; ratingSum += r; }
    titles.add(e.tmdb_id != null ? `id:${e.tmdb_id}` : `t:${String(e.title).toLowerCase()}`);
  }
  const guess = list.reduce((s, e) => {
    const rt = num(e.runtime);
    if (rt && rt > 0) return s + rt;
    return s + (String(e.kind) === 'movie' ? DEFAULT_MOVIE_MIN : DEFAULT_EPISODE_MIN);
  }, 0);
  return {
    viewings: list.length,
    titles: titles.size,
    rewatches: list.length - titles.size,
    minutes,
    hours: minutes / 60,
    estHours: guess / 60,
    unknownRuntime: unknown,
    exact: unknown === 0,
    rated,
    avgRating: rated ? ratingSum / rated : null,
  };
}

/**
 * Consecutive days with at least one viewing, counting back from `from`.
 *
 * Counts back from YESTERDAY when today is empty, so a streak is not reported as
 * broken at breakfast — you have not failed to watch a film today at 9am. This
 * is the one place a small kindness is also the more accurate reading.
 */
export function streak(list = [], from = new Date()) {
  const days = new Set(list.map(e => validDate(e.on)).filter(Boolean));
  if (!days.size) return 0;
  const start = new Date(from.getTime());
  if (!days.has(todayLocal(start))) start.setDate(start.getDate() - 1);
  let n = 0;
  const cursor = new Date(start.getTime());
  while (days.has(todayLocal(cursor))) {
    n++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return n;
}

// Viewings per day for the last `days` days, oldest first — the shape a heat
// strip needs. Days with nothing are zeros rather than gaps, because a gap in a
// calendar is information and a missing bar is just a missing bar.
export function activity(list = [], { days = 120, to = new Date() } = {}) {
  const counts = new Map();
  for (const e of list) {
    const d = validDate(e.on);
    if (d) counts.set(d, (counts.get(d) || 0) + 1);
  }
  const out = [];
  const cursor = new Date(to.getTime());
  cursor.setDate(cursor.getDate() - (days - 1));
  for (let i = 0; i < days; i++) {
    const key = todayLocal(cursor);
    out.push({ date: key, count: counts.get(key) || 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

// ------------------------------------------------- the shelf, from the diary

/**
 * Titles you have watched but never put on a shelf.
 *
 * The shelf reads the `movies` table and the diary reads `media_log`, and after
 * the Letterboxd import those disagreed completely: 58 films watched, an empty
 * shelf, and "0 titles · 0.0h · nothing rated yet" on a screen where the diary
 * one tab over knew all of it. Two stores answering the same question, and the
 * one the landing screen reads was the empty one.
 *
 * The fix is NOT to copy 58 rows into `movies`. That creates a second source of
 * truth immediately: rate a film in the diary and the shelf copy is stale, edit
 * the shelf copy and the diary disagrees, and a re-import has to reconcile two
 * places instead of one. Every bug in this project so far has been two things
 * that should have been one.
 *
 * So the shelf is a VIEW: real rows, plus derived rows for anything in the diary
 * that has no row. Derived rows are marked, so the screen can be honest that
 * they came from a viewing rather than from you filing something.
 */
export function shelfFromLog(rows = [], log = []) {
  const have = new Set();
  for (const r of rows) {
    if (r.tmdb_id != null && r.tmdb_id !== '') have.add(`id:${r.tmdb_id}`);
    if (r.title) have.add(`t:${String(r.title).toLowerCase().trim()}`);
  }

  // One derived row per TITLE, not per viewing — three viewings of Heat are one
  // film on a shelf. The best rating you ever gave it wins, because a shelf
  // shows what you think of a film, not what you thought on one particular
  // Tuesday.
  const byTitle = new Map();
  for (const e of log) {
    if (!e.title) continue;
    const idKey = e.tmdb_id != null && e.tmdb_id !== '' ? `id:${e.tmdb_id}` : null;
    const tKey = `t:${String(e.title).toLowerCase().trim()}`;
    if ((idKey && have.has(idKey)) || have.has(tKey)) continue;

    const key = idKey || tKey;
    const prev = byTitle.get(key);
    const rating = num(e.rating);
    const on = validDate(e.on);
    if (!prev) {
      byTitle.set(key, {
        id: `derived:${key}`,
        title: e.title,
        type: String(e.kind) === 'movie' ? 'movie' : 'tv',
        kind: e.kind || 'movie',
        status: 'completed',
        tmdb_id: e.tmdb_id ?? null,
        poster_url: e.poster_url || null,
        rating,
        year: num(e.year),
        runtime: num(e.runtime),
        last_watched: on,
        viewings: 1,
        // The flag the UI needs to avoid offering "delete" on something that is
        // not a row it can delete.
        derived: true,
      });
      continue;
    }
    prev.viewings += 1;
    if (rating != null && (prev.rating == null || rating > prev.rating)) prev.rating = rating;
    if (on && (!prev.last_watched || on > prev.last_watched)) prev.last_watched = on;
    if (!prev.poster_url && e.poster_url) prev.poster_url = e.poster_url;
    if (prev.runtime == null && num(e.runtime) != null) prev.runtime = num(e.runtime);
    if (prev.year == null && num(e.year) != null) prev.year = num(e.year);
  }

  // Real rows first: a title you actually filed outranks one inferred from a
  // viewing, and if both somehow exist the real one is the one you edited.
  return [...rows, ...byTitle.values()];
}

// The metadata a derived row would otherwise have nowhere to put. Shaped like a
// media_meta entry so the shelf's existing readers need no special case.
export function derivedMeta(shelf = []) {
  const out = {};
  for (const r of shelf) {
    if (!r.derived) continue;
    out[r.id] = {
      year: r.year ?? null,
      runtime: r.type === 'movie' ? r.runtime ?? null : null,
      episode_runtime: r.type === 'movie' ? null : r.runtime ?? null,
      kind: r.kind,
    };
  }
  return out;
}
