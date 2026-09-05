// Placement drives — the deadline you cannot afford to find out about late.
//
// WHY THIS IS DIFFERENT FROM EVERY OTHER SYNC IN THE APP
//
// Attendance is wrong-but-recoverable: a stale number costs you a slightly bad
// decision about skipping a lecture. A placement registration window is not
// recoverable. It opens, it closes at a stated minute, and afterwards there is
// nothing to do about it. Amizone's own page tells you it closed; it does not
// tell you it is closing.
//
// Neel's own list already contains the failure this exists to prevent: Infinite
// Computer Solutions, registration 02/09 to 04/09 06:00 PM, status "Registration
// Closed", never applied to. That row is indistinguishable from a drive he
// looked at and declined. The point of this module is that the next one gets
// announced while there is still time to act.
//
// WHAT THE PAGE ACTUALLY LOOKS LIKE (measured 2026-09-05, signed in)
//
// /Placement/PlacementDetails renders one `.pd-card` per drive:
//
//   .pd-card-company  "SHIBAURA MACHINE CO., LTD, Japan [2027 Batch]"
//   .pd-card-dates    "Reg. 02/09/2026 – 03/09/2026 08:00 PM"
//   .pd-card-status   class pd-status-{applied|closed|ineligible|placed|notstarted}
//   .pd-card-sub      the reason, when ineligible
//   .pd-card-details-link  the drive PDF
//
// /Placement/CorporatEvent is the same idea as a table: organisation, start,
// end, and an action cell that reads "Registration Closed" once it has.
//
// THE HONESTY CONSTRAINT
//
// On the day this was written every drive was applied / closed / ineligible —
// there was no open one to look at, so the markup for an OPEN drive has never
// been observed. Guessing it and being wrong would produce the one output worse
// than no feature at all: a screen that quietly shows nothing while a deadline
// runs out.
//
// So openness is decided by the CLOCK, not by markup this module has not seen.
// A status class it does not recognise becomes 'unknown', and 'unknown' is
// surfaced loudly rather than filtered away. Being told "something is open and
// PLAYER ONE can't read it, go look" is a working outcome. Silence is not.

/** The statuses Amizone's own CSS names, mapped to what they mean here. */
export const STATUS = {
  applied: 'applied',
  placed: 'placed',
  closed: 'closed',
  ineligible: 'ineligible',
  notstarted: 'open',   // Amizone's tile calls this bucket "Not registered"
};

export const STATUS_LABEL = {
  open: 'NOT REGISTERED',
  applied: 'APPLIED',
  placed: 'PLACED',
  closed: 'CLOSED',
  ineligible: 'INELIGIBLE',
  unknown: 'CHECK AMIZONE',
};

const strip = h => String(h || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

/**
 * "02/09/2026" or "03/09/2026 08:00 PM" → a local Date.
 *
 * dd/mm/yyyy, because Amizone is an Indian university portal and 03/09 there is
 * the third of September. Read as mm/dd this would silently land in March and a
 * deadline notification would fire six months late — so the day/month order is
 * asserted in the tests rather than left to the reader.
 *
 * A date with no time means the END of that day: a window stated as closing on
 * the 4th has not closed at midnight on the 4th.
 */
export function parseIndDate(s, endOfDay = false) {
  const m = /(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM)?)?/i.exec(String(s || ''));
  if (!m) return null;
  const [, dd, mm, yyyy, hh, mi, ap] = m;
  let h = hh == null ? (endOfDay ? 23 : 0) : parseInt(hh, 10);
  const min = mi == null ? (endOfDay ? 59 : 0) : parseInt(mi, 10);
  if (ap) {
    const p = ap.toUpperCase();
    if (p === 'PM' && h !== 12) h += 12;
    if (p === 'AM' && h === 12) h = 0;
  }
  const d = new Date(+yyyy, +mm - 1, +dd, h, min, 0, 0);
  return Number.isFinite(d.getTime()) ? d : null;
}

/** "Reg. 02/09/2026 – 03/09/2026 08:00 PM" → { start, end }. */
export function parseWindow(text) {
  const t = String(text || '').replace(/^\s*Reg\.?\s*/i, '');
  // en dash, em dash, hyphen or the word "to" — the separator is cosmetic and
  // has changed before on other Amizone screens.
  const parts = t.split(/\s+[–—-]\s+|\s+to\s+/i);
  const start = parseIndDate(parts[0]);
  const end = parts.length > 1 ? parseIndDate(parts[1], true) : null;
  return { start, end };
}

/** Everything between one `pd-card` and the next. */
function cardChunks(html) {
  const s = String(html || '');
  const out = [];
  const re = /class="[^"]*\bpd-card\b[^"]*"/g;
  const starts = [];
  let m;
  while ((m = re.exec(s))) {
    // pd-card-company, pd-card-dates and friends all match \bpd-card\b as a
    // prefix word only if the boundary is a hyphen, which \b does not treat as
    // one — so require the class token to END there.
    if (/\bpd-card(?![\w-])/.test(m[0])) starts.push(m.index);
  }
  for (let i = 0; i < starts.length; i++) out.push(s.slice(starts[i], starts[i + 1] ?? s.length));
  return out;
}

const grab = (chunk, cls) => {
  const m = new RegExp(`class="[^"]*\\b${cls}\\b[^"]*"[^>]*>([\\s\\S]*?)<\\/`, 'i').exec(chunk);
  return m ? strip(m[1]) : '';
};

/**
 * The drive cards on /Placement/PlacementDetails.
 *
 * Regex rather than a DOM parse because this runs in the GitHub Action, in node,
 * where there is no DOMParser — the same reason the attendance parser next door
 * is written this way.
 */
export function parsePlacements(html, now = new Date()) {
  const rows = [];
  for (const chunk of cardChunks(html)) {
    const company = grab(chunk, 'pd-card-company');
    if (!company) continue;
    const sm = /pd-status-([a-z]+)/i.exec(chunk);
    const raw = sm ? sm[1].toLowerCase() : '';
    const { start, end } = parseWindow(grab(chunk, 'pd-card-dates'));
    const pdf = (/href="(https?:\/\/[^"]*Placement[^"]*\.pdf)"/i.exec(chunk) || [])[1] || '';
    rows.push({
      kind: 'drive',
      company,
      start: start ? start.toISOString() : null,
      end: end ? end.toISOString() : null,
      status: STATUS[raw] || (raw ? 'unknown' : 'unknown'),
      rawStatus: raw,
      note: grab(chunk, 'pd-card-sub'),
      pdf,
    });
  }
  return dedupe(rows);
}

/**
 * The table on /Placement/CorporatEvent. Same shape, different markup, so the
 * app never has to care which page an opportunity came from.
 */
export function parseCorporateEvents(html) {
  const rows = [];
  const body = String(html || '');
  for (const tr of body.match(/<tr[\s\S]*?<\/tr>/gi) || []) {
    const cells = (tr.match(/<td[\s\S]*?<\/td>/gi) || []).map(strip);
    if (cells.length < 4) continue;
    const [, name, s, e, ...rest] = cells;
    const action = rest.join(' ').trim();
    if (!name || !/\d{1,2}[/-]\d{1,2}[/-]\d{4}/.test(s || '')) continue;
    const start = parseIndDate(s);
    const end = parseIndDate(e, true);
    rows.push({
      kind: 'event',
      company: name,
      start: start ? start.toISOString() : null,
      end: end ? end.toISOString() : null,
      // The action cell says "Registration Closed" once it is. It has never been
      // observed saying anything else, so anything else is 'unknown' — not
      // 'open', which would be a claim this parser cannot back up.
      status: /closed/i.test(action) ? 'closed' : /applied|registered|joined/i.test(action) ? 'applied' : 'unknown',
      rawStatus: action.toLowerCase().slice(0, 40),
      note: '',
      pdf: '',
    });
  }
  return dedupe(rows);
}

function dedupe(rows) {
  const seen = new Set();
  return rows.filter(r => {
    const k = `${r.kind}|${r.company}|${r.start || ''}|${r.end || ''}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Stable id for the seen-ledger, so a re-parse does not re-announce. */
export const driveId = r => `${r.kind || 'drive'}:${String(r.company || '').toLowerCase().replace(/\s+/g, ' ').trim()}:${(r.end || '').slice(0, 16)}`;

const ms = r => (r.end ? Date.parse(r.end) : NaN);

/** Hours left to register. Negative once it has closed. */
export function hoursLeft(r, now = new Date()) {
  const t = ms(r);
  return Number.isFinite(t) ? (t - now.getTime()) / 3600000 : null;
}

/**
 * The rows sorted into what you can still do something about and what you
 * cannot.
 *
 * `actionable` is deliberately generous: it holds the drives whose window is
 * still open AND whose status is not one that settles the matter. 'unknown'
 * belongs there — an opportunity this module could not read is a reason to open
 * Amizone, not a reason to say nothing.
 */
export function placementView(rows, now = new Date()) {
  const list = (Array.isArray(rows) ? rows : []).filter(r => r && r.company);
  const settled = new Set(['applied', 'placed', 'ineligible', 'closed']);
  const live = r => {
    const h = hoursLeft(r, now);
    return h == null ? !settled.has(r.status) : h > 0;
  };

  const actionable = list.filter(r => live(r) && !settled.has(r.status))
    .sort((a, b) => (ms(a) || Infinity) - (ms(b) || Infinity));
  const applied = list.filter(r => r.status === 'applied' || r.status === 'placed');
  const ineligible = list.filter(r => r.status === 'ineligible');
  const closed = list.filter(r => r.status === 'closed' || (!live(r) && !settled.has(r.status)));

  // Closed in the last week without a registration. Reported quietly and worded
  // as a fact — "not registered" — because this module cannot tell a drive he
  // missed from one he read and passed on, and calling the second one a miss
  // would make the whole card something he learns to ignore.
  const recentlyGone = closed
    .filter(r => r.status !== 'applied' && r.status !== 'placed' && r.status !== 'ineligible')
    .filter(r => { const h = hoursLeft(r, now); return h != null && h < 0 && h > -24 * 7; })
    .sort((a, b) => (ms(b) || 0) - (ms(a) || 0));

  return { actionable, applied, ineligible, closed, recentlyGone, total: list.length };
}

/** One line for the College card and the HQ reminder row. */
export function placementSummary(rows, now = new Date()) {
  const v = placementView(rows, now);
  if (!v.total) return '';
  if (!v.actionable.length) return '';
  const soonest = v.actionable[0];
  const h = hoursLeft(soonest, now);
  const when = h == null ? 'deadline unknown' : h < 1 ? 'closes within the hour'
    : h < 24 ? `closes in ${Math.round(h)}h` : `closes in ${Math.round(h / 24)}d`;
  const more = v.actionable.length - 1;
  return `${soonest.company} — ${when}${more > 0 ? ` (+${more} more open)` : ''}`;
}

/**
 * When to interrupt him about a deadline.
 *
 * Two moments, not a countdown: a day out, when there is still time to prepare
 * whatever the drive asks for, and two hours out, which is the last honest
 * warning. Each fires once — the bucket is part of the ledger key, so a reload
 * cannot replay them.
 */
export const DEADLINE_BUCKETS = [
  { hours: 24, id: '24h', word: 'tomorrow' },
  { hours: 2, id: '2h', word: 'in under 2 hours' },
];

export function deadlineSoon(rows, now = new Date()) {
  const { actionable } = placementView(rows, now);
  const out = [];
  for (const r of actionable) {
    const h = hoursLeft(r, now);
    if (h == null || h <= 0) continue;
    // The TIGHTEST bucket that still contains the deadline. `find` on a
    // descending list returns the widest one instead, which meant the last-call
    // warning — sent one hour before a window shut — announced that it closed
    // "tomorrow". A test caught it.
    const bucket = DEADLINE_BUCKETS.filter(b => h <= b.hours).pop();
    if (!bucket) continue;
    const unread = r.status === 'unknown';
    out.push({
      thing: `${driveId(r)}:${bucket.id}`,
      title: `${r.company} — registration closes ${bucket.word}`,
      body: unread
        ? 'PLAYER ONE could not read this one’s status. Open Amizone → Placement.'
        : 'You have not registered. Amizone → Student Placement Hub → Placement.',
    });
  }
  return out.slice(0, 2);
}
