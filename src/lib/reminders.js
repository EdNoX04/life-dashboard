// Marking a reminder done.
//
// The Reminders card mixes two kinds of row and only one of them could ever be
// finished. Todo-backed rows have a `completed` column; the derived ones —
// "Spanish FBL Module 2, 13d left" — are computed from a date table in
// exams.js and have nowhere to record that Neel actually did the module. So he
// did it, and the card kept telling him to, every day, until the window closed.
// A reminder you cannot dismiss stops being a reminder and becomes noise, and
// noise is how the genuinely urgent row on that card gets skipped over.
//
// Two different completions, deliberately kept apart:
//
//   { kind: 'todo',   id }   → set completed on the real row. Ticking it here
//                              and in the Todo tab must be the same act, not two
//                              records of it that can disagree.
//   { kind: 'memory', key }  → there is no row to complete, so the fact is
//                              stored on its own in memory.reminder_done.
//
// A row with no `done` descriptor gets no checkbox, and that is a judgement, not
// an omission: "attendance is 67%" and "exams in 3 days" are states of the
// world. Letting someone tick them would only hide the truth from them.

export const DONE_KEY = 'reminder_done';

// Keyed on the window's start date, not the module number. Module 2 exists in
// every semester; the window starting 2026-08-29 exists once. A key that repeats
// would silently pre-tick next term's module.
export const fblDoneKey = mod => `fbl:${mod.from}`;

export function isDone(map, descriptor) {
  if (!descriptor || descriptor.kind !== 'memory') return false;
  return Boolean(map && Object.prototype.hasOwnProperty.call(map, descriptor.key) && map[descriptor.key]);
}

// Returns a NEW map. The caller writes the whole blob back, so mutating the one
// React is holding would make the optimistic update and the server copy diverge
// on failure — the update would stick on screen and be gone after a refresh.
export function withDone(map, key, on, at = new Date().toISOString()) {
  const next = { ...(map || {}) };
  if (on) next[key] = at;
  else delete next[key];
  return next;
}

// Whether a reminder should still be shown. Todo-backed rows are already
// filtered by `completed` upstream, so only memory-backed ones are dropped here.
export const isHidden = (map, r) => isDone(map, r?.done);
