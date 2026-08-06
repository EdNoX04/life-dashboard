// The pure half of the Amizone sync.
//
// Everything here is deliberately DOM-free so it can be tested without a
// browser. `scripts/amizone-sync.mjs` scrapes candidate rows out of the live
// page and then hands them straight to these functions before anything reaches
// Supabase. The scraping is the part that cannot be tested; the part that
// decides what is true, and whether to overwrite a working timetable, can be.
//
// Four decisions are encoded here, each of them a bug that actually happened:
//
// 1. A slot seen twice is one slot. The old extractor walked `td, div, li`, so
//    a cell rendered as <td><div>…</div></td> yielded the SAME class twice —
//    once for the td, once for the div. Days whose cells happened to carry a
//    wrapper element came out inflated while plainer days came out right, which
//    is exactly the shape of "Wednesday had 2 classes but showed 3".
//
// 2. A slot with no day is not a slot. The old code tracked the current day by
//    watching for an element whose text was exactly a day name. In a column
//    grid, where the day names sit in <th> cells that were never queried, that
//    watch never fires and every row lands with day: null. A null day is not a
//    timetable entry, it is a parse failure wearing one.
//
// 3. Never delete what you cannot replace. The old writer issued an
//    unconditional DELETE over the whole timetable table and only then inserted
//    whatever it had scraped. A run that logged in, hit a changed layout and
//    scraped zero rows therefore did not "fail" — it silently erased the
//    timetable and reported success.
//
// 4. Attendance is a fraction first and a donut second. Amizone renders the
//    percentage twice: as a data-percent on the pie chart, and as an attended/
//    total pair in the row. When the two disagree the pair is the one that came
//    off the register, so it wins; the donut is rounded and occasionally belongs
//    to an adjacent card entirely.

export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// "9:15" and "09:15" are the same time, but they are two different strings, and
// two different strings survive de-duplication as two different classes.
export function normalizeTime(t) {
  const m = String(t == null ? '' : t).trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  if (h > 23 || Number(m[2]) > 59) return null;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

export function normalizeDay(d) {
  const s = String(d == null ? '' : d).trim().toLowerCase();
  return DAYS.find(x => x.toLowerCase() === s) || null;
}

// A row has to name a day, a start, an end and a course before it is allowed to
// stand for a class. Anything short of that is a scrape artefact.
export function validSlot(s) {
  if (!s) return null;
  const day = normalizeDay(s.day);
  const start = normalizeTime(s.start_time);
  const end = normalizeTime(s.end_time);
  const code = String(s.code || '').trim().toUpperCase();
  if (!day || !start || !end || !code) return null;
  if (end <= start) return null; // lexical compare is safe on zero-padded HH:MM
  return {
    day, start_time: start, end_time: end, code,
    room: s.room || null, faculty: s.faculty || null,
  };
}

// Richness, not order, decides which copy of a duplicate survives: a nested
// <div> often carries the room and faculty text that its wrapping <td> lost to
// whitespace, and the reverse happens just as often.
function richness(s) {
  return (s.room ? 1 : 0) + (s.faculty ? 1 : 0);
}

export function dedupeSlots(raw = []) {
  const out = new Map();
  for (const r of raw) {
    const s = validSlot(r);
    if (!s) continue;
    const key = `${s.day}|${s.start_time}|${s.code}`;
    const prev = out.get(key);
    if (!prev || richness(s) > richness(prev)) out.set(key, s);
  }
  return [...out.values()].sort((a, b) =>
    DAYS.indexOf(a.day) - DAYS.indexOf(b.day) ||
    a.start_time.localeCompare(b.start_time) ||
    a.code.localeCompare(b.code));
}

export function countByDay(slots = []) {
  const c = {};
  for (const s of slots) c[s.day] = (c[s.day] || 0) + 1;
  return c;
}

// The replace/refuse decision. `existingCount` is what is already in Supabase.
//
// The collapse threshold is a ratio rather than a fixed number because the
// failure being guarded against is a layout change that silently halves the
// yield, not a term that genuinely has fewer classes. A real timetable change
// of more than half in one run is rare enough that pausing for a look is the
// cheaper mistake — a refusal keeps yesterday's correct data, while a wrongful
// wipe leaves nothing at all and no record of what was lost.
export const COLLAPSE_RATIO = 0.5;

export function replacePlan(scraped = [], existingCount = 0) {
  const slots = dedupeSlots(scraped);
  if (slots.length === 0) {
    return { replace: false, slots, reason: existingCount > 0
      ? `Scraped 0 usable slots but ${existingCount} are already stored — keeping the stored timetable rather than erasing it.`
      : 'Scraped 0 usable slots and none are stored. Nothing to write.' };
  }
  if (existingCount > 0 && slots.length < existingCount * COLLAPSE_RATIO) {
    return { replace: false, slots, reason:
      `Scraped only ${slots.length} slots against ${existingCount} stored — that is more than a halving, which usually means the page layout changed. Keeping the stored timetable.` };
  }
  return { replace: true, slots, reason: `Replacing ${existingCount} stored slots with ${slots.length} scraped.` };
}

// Amizone reports attendance as 0.81 in some views and 81 in others, and the
// donut's rounded percent can be a whole point off the register it claims to
// draw. Where both are present the fraction is recomputed and wins.
export function attendancePct(a) {
  if (!a) return null;
  const at = Number(a.attended), tot = Number(a.total);
  if (Number.isFinite(at) && Number.isFinite(tot) && tot > 0 && at >= 0 && at <= tot) {
    return Math.round((at / tot) * 1000) / 10;
  }
  // Number(null) is 0 and Number('') is 0, so an absent donut would otherwise
  // be written into the database as a confident, wrong 0% attendance.
  if (a.pct == null || a.pct === '') return null;
  let p = Number(a.pct);
  if (!Number.isFinite(p) || p < 0) return null;
  if (p > 0 && p <= 1) p = p * 100;   // a fraction, not a percent
  if (p > 100) return null;
  return Math.round(p * 10) / 10;
}

// A scrape that returns rows but no percentages is a different failure from one
// that returns nothing, and it should not be written as "everyone is at 0%".
const numOrNull = v => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

export function usableAttendance(list = []) {
  return list
    .map(a => ({ code: String(a?.code || '').trim().toUpperCase(), pct: attendancePct(a),
                 attended: numOrNull(a?.attended), total: numOrNull(a?.total) }))
    .filter(a => a.code && a.pct != null);
}
