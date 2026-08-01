// WhatsApp exported-chat parser.
//
// College announcements and company registrations arrive in group chats, not on
// Amizone. WhatsApp has no read API that a personal web app may legitimately
// use — the linked-device libraries (Baileys, whatsapp-web.js) violate the terms
// and get numbers banned — so the supported path is the one WhatsApp itself
// provides: "Export chat → Without media" produces a .txt, and this file reads
// that .txt. Nothing here touches WhatsApp's network.
//
// FIVE DECISIONS, because a parser reading other people's writing is guessing,
// and where it guesses it must say so.
//
// 1. THE PARSER NEVER INVENTS A DATE. If a message says "register by Friday" the
//    deadline is null, not next Friday. A deadline the reader trusts wrongly is
//    worse than one they have to go and check. Where a year is missing and had
//    to be assumed, `assumedYear` is set and the UI prints the assumption.
//
// 2. NOTHING IMPORTS ITSELF. parseChat proposes; the screen makes Neel confirm
//    each row before it becomes an announcement or a calendar entry. A group
//    chat is other people's writing — the cost of putting a joke on his calendar
//    as a placement drive is paid by him, so the decision is his.
//
// 3. NOISE IS FILTERED STRUCTURALLY, NOT SEMANTICALLY. Joins, leaves, deleted
//    messages, "<Media omitted>" and one-word replies are dropped because of
//    what they ARE, not because of what they seem to mean. Anything the rules
//    cannot place stays in an `unsorted` pile that the UI shows. A silently
//    dropped registration link is the one failure this module cannot recover
//    from, so it never drops silently.
//
// 4. CLASSIFICATION IS A COUNT OF MATCHED SIGNALS, NOT A SCORE. There is no
//    0-100 confidence, because that number would be invented. Each message
//    carries the list of phrases that actually matched, so a wrong answer is
//    legible at a glance and Neel can overrule it knowing why it was made.
//
// 5. DATE ORDER IS RESOLVED ONCE PER FILE, NOT PER LINE. An export is written by
//    one phone with one locale, so 03/07 and 07/03 in the same file mean the
//    same convention. Deciding per line produces a chat whose dates silently
//    jump between conventions mid-scroll, which is worse than being wrong
//    consistently. We scan the whole file for a day > 12 to settle it, and when
//    no line settles it we default to day-first (India) and say the default was
//    used rather than presenting it as read.

export const DISCLAIMER =
  'Read from a chat export you provided. Nothing is synced from WhatsApp and nothing is imported until you confirm it.';

export const HOWTO = [
  'Open the group in WhatsApp',
  'Tap the group name → Export chat',
  'Choose "Without media"',
  'Save the .txt and drop it here',
];

/* ── line shapes ─────────────────────────────────────────────────────────────
   iOS:     [13/07/2026, 9:15:03 AM] Name: text
   Android: 13/07/2026, 9:15 am - Name: text
   Both may carry U+200E / U+200F direction marks around the brackets and before
   the body; iOS puts one before every attachment line. Strip them, don't fight
   them. */

const MARKS = /[‎‏‪-‮]/g;

const IOS_RE =
  /^\[(\d{1,2})[./-](\d{1,2})[./-](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([APap]\.?[Mm]\.?)?\]\s*(?:([^:\n]{1,60}):\s?)?([\s\S]*)$/;

const AND_RE =
  /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([APap]\.?[Mm]\.?)?\s+-\s+(?:([^:\n]{1,60}):\s?)?([\s\S]*)$/;

export function matchHeader(line) {
  const s = String(line).replace(MARKS, '');
  let m = IOS_RE.exec(s), format = 'ios';
  if (!m) { m = AND_RE.exec(s); format = 'android'; }
  if (!m) return null;
  return {
    format,
    a: Number(m[1]), b: Number(m[2]), y: Number(m[3]),
    hh: Number(m[4]), mm: Number(m[5]), ampm: (m[7] || '').replace(/\./g, '').toLowerCase(),
    author: m[8] ? m[8].trim() : null,
    text: m[9] || '',
  };
}

// Decision 5. One pass over the whole file before a single date is built.
export function detectOrder(heads = []) {
  for (const h of heads) if (h.a > 12) return { order: 'dmy', settled: true };
  for (const h of heads) if (h.b > 12) return { order: 'mdy', settled: true };
  return { order: 'dmy', settled: false };
}

const pad = n => String(n).padStart(2, '0');
export const fullYear = y => (y < 100 ? 2000 + y : y);

export function toISO(h, order) {
  const day = order === 'mdy' ? h.b : h.a;
  const mon = order === 'mdy' ? h.a : h.b;
  if (!(day >= 1 && day <= 31 && mon >= 1 && mon <= 12)) return null;
  return `${fullYear(h.y)}-${pad(mon)}-${pad(day)}`;
}

export function to24h(hh, mm, ampm) {
  let h = hh;
  if (ampm === 'pm' && h < 12) h += 12;
  if (ampm === 'am' && h === 12) h = 0;
  if (h > 23 || mm > 59) return null;
  return `${pad(h)}:${pad(mm)}`;
}

/* ── system + noise ─────────────────────────────────────────────────────────── */

// Decision 3: these are structural facts about the export, not opinions about
// the content. Each one is a line WhatsApp itself wrote, or a body it replaced.
const SYSTEM_RE = new RegExp([
  'messages and calls are end-to-end encrypted',
  'joined using this group', 'was added', 'added you', ' added ',
  ' left$', ' left the group', 'removed ', 'changed the subject',
  "changed this group's icon", 'changed the group description',
  'created group', 'created this group', 'changed their phone number',
  'you deleted this message', 'this message was deleted',
  '<media omitted>', 'media omitted', 'image omitted', 'video omitted',
  'sticker omitted', 'audio omitted', 'document omitted', 'gif omitted',
  'missed voice call', 'missed video call', 'missed group',
  'turned on admin approval', 'pinned a message', 'now an admin',
  'security code changed', 'waiting for this message',
  'null', 'this message was edited',
].join('|'), 'i');

// Short social replies. Deliberately anchored and length-capped: "ok" is noise,
// "ok so the drive link is live" is not, and the difference is length, not the
// presence of the word.
const CHITCHAT_RE =
  /^(ok(ay)?|k|hmm+|thanks?|thank you|ty|tysm|welcome|noted|done|sure|yes|yep|yeah|no|nope|great|nice|good|cool|congrats|congratulations|all the best|atb|gm|good morning|good night|gn|hi|hello|hey|bhai|bro|\+1|same|got it|ohk|oh|acha|haan|ha|theek hai)[\s!.,👍🙏😄😅🎉❤️🔥]*$/i;

export function isSystem(m) {
  if (!m.author) return true;                       // Android system lines have no "Name:"
  return SYSTEM_RE.test(m.text);
}

export function isNoise(m) {
  if (isSystem(m)) return true;
  const t = m.text.trim();
  if (!t) return true;
  if (CHITCHAT_RE.test(t)) return true;
  // An emoji-only or punctuation-only reply carries no announcement.
  if (t.length <= 3 && !/\d/.test(t)) return true;
  return false;
}

/* ── links ───────────────────────────────────────────────────────────────────
   Trailing sentence punctuation is stripped, because "register here:
   https://forms.gle/abc." yields a 404 with the full stop attached and that
   failure looks like a dead link rather than a parsing bug. */

const URL_RE = /\bhttps?:\/\/[^\s<>"')\]]+|\bwww\.[^\s<>"')\]]+/gi;

export function linkKind(url) {
  const u = String(url).toLowerCase();
  if (/forms\.gle|docs\.google\.com\/forms|forms\.office\.com|typeform|airtable/.test(u)) return 'form';
  if (/unstop|dare2compete|superset|hirist|naukri|internshala|instahyre|cuvette/.test(u)) return 'portal';
  if (/linkedin\.com/.test(u)) return 'linkedin';
  if (/drive\.google\.com|docs\.google\.com|1drv\.ms|sharepoint/.test(u)) return 'doc';
  if (/chat\.whatsapp\.com/.test(u)) return 'group invite';
  if (/meet\.google\.com|zoom\.us|teams\.microsoft/.test(u)) return 'meeting';
  return 'link';
}

export function extractLinks(text = '') {
  const out = [];
  for (const raw of String(text).match(URL_RE) || []) {
    const url = raw.replace(/[.,;:!?)\]}'"]+$/, '');
    const href = /^www\./i.test(url) ? `https://${url}` : url;
    if (!out.some(l => l.href === href)) out.push({ href, kind: linkKind(href) });
  }
  return out;
}

/* ── signals ─────────────────────────────────────────────────────────────────
   Decision 4. Flat list, each one labelled in the words a human would use, so
   the UI can print "matched: registration link, CTC, eligibility" instead of
   "confidence 0.82". */

export const SIGNALS = [
  // placement
  { key: 'placement', kind: 'placement', label: 'placement', re: /\bplacements?\b/ },
  { key: 'drive', kind: 'placement', label: 'drive', re: /\bdrives?\b/ },
  { key: 'hiring', kind: 'placement', label: 'hiring', re: /\bhiring\b|\brecruit(ment|ing|er)?\b/ },
  { key: 'intern', kind: 'placement', label: 'internship', re: /\bintern(ship)?s?\b/ },
  { key: 'ctc', kind: 'placement', label: 'CTC', re: /\bctc\b|\bstipend\b/ },
  { key: 'pay', kind: 'placement', label: 'package', re: /\b\d+(\.\d+)?\s?(lpa|lakhs?\s?p\.?a\.?)\b|\bpackage\b/ },
  { key: 'eligible', kind: 'placement', label: 'eligibility', re: /\beligib(le|ility)\b|\bcriteria\b|\bcgpa\b|\bbacklogs?\b/ },
  { key: 'jd', kind: 'placement', label: 'job description', re: /\bjob description\b|\bjd\b|\brole\b|\bprofile\b/ },
  { key: 'campus', kind: 'placement', label: 'campus', re: /\b(on|off)[\s-]?campus\b|\bppo\b|\bpre[\s-]?placement\b/ },
  { key: 'resume', kind: 'placement', label: 'resume', re: /\bresumes?\b|\bcv\b|\bshortlist(ed|ing)?\b/ },
  { key: 'batch', kind: 'placement', label: 'batch', re: /\bbatch of 20\d\d\b|\b20\d\d batch\b|\bpassing out\b/ },
  { key: 'apply', kind: 'placement', label: 'apply', re: /\bapply (by|before|now|here|through)\b|\bapplication (link|form|window)\b/ },

  // exam / academics
  { key: 'exam', kind: 'exam', label: 'exam', re: /\bexams?\b|\bmid[\s-]?terms?\b|\bend[\s-]?terms?\b/ },
  { key: 'viva', kind: 'exam', label: 'viva / practical', re: /\bvivas?\b|\bpracticals?\b|\blab exam\b/ },
  { key: 'datesheet', kind: 'exam', label: 'datesheet', re: /\bdate ?sheets?\b|\badmit cards?\b|\bhall tickets?\b/ },
  { key: 'submit', kind: 'exam', label: 'submission', re: /\bassignments?\b|\bsubmissions?\b|\bsubmit\b|\bproject report\b/ },
  { key: 'quiz', kind: 'exam', label: 'quiz / result', re: /\bquiz(zes)?\b|\bresults?\b|\bmarks\b|\bgrade cards?\b/ },
  { key: 'syllabus', kind: 'exam', label: 'syllabus', re: /\bsyllabus\b|\bunit \d\b|\bcurriculum\b/ },

  // general college notice
  { key: 'notice', kind: 'announcement', label: 'notice', re: /\bnotices?\b|\bcirculars?\b|\bnotification\b/ },
  { key: 'holiday', kind: 'announcement', label: 'holiday', re: /\bholidays?\b|\bno class(es)?\b|\bclass(es)? (are |is |will be )?(cancell?ed|off|rescheduled|suspended)\b/ },
  { key: 'attendance', kind: 'announcement', label: 'attendance', re: /\battendance\b|\bshortage\b|\bdetained?\b/ },
  { key: 'fees', kind: 'announcement', label: 'fees', re: /\bfees?\b.{0,20}\b(payment|submission|due|last date)\b|\bfee payment\b/ },
  { key: 'event', kind: 'announcement', label: 'event', re: /\bseminars?\b|\bworkshops?\b|\bwebinars?\b|\bhackathons?\b|\bfest\b|\bguest lecture\b/ },
  { key: 'venue', kind: 'announcement', label: 'venue / time', re: /\bvenue\b|\breporting time\b|\bauditorium\b|\bblock [a-z]\b|\broom no\b/ },
  { key: 'mandatory', kind: 'announcement', label: 'mandatory', re: /\bmandatory\b|\bcompulsory\b|\ball students?\b|\bevery ?one (must|has to)\b/ },
  { key: 'amizone', kind: 'announcement', label: 'Amizone', re: /\bamizone\b|\bamity\b/ },
  { key: 'register', kind: 'announcement', label: 'register', re: /\bregistrations?\b|\bregister\b|\bfill (the |up )?form\b|\bsign ?up\b/ },
];

// Announcement is deliberately NOT in this contest. Its signals — "notice",
// "mandatory", "Amizone", "register" — appear in almost every college message,
// including every exam notice and every drive. Letting it compete on count means
// the generic bucket swallows the specific ones: an exam datesheet notice would
// file itself under "announcements" because it also contained the word "notice".
// So the specific kinds are decided first and announcement catches what is left.
const SPECIFIC = ['placement', 'exam'];

export function classify(m) {
  const t = String(m.text || '').toLowerCase();
  const hit = SIGNALS.filter(s => s.re.test(t));
  if (isNoise(m)) return { kind: 'noise', signals: [], count: 0 };

  const counts = {};
  for (const s of hit) counts[s.kind] = (counts[s.kind] || 0) + 1;

  let best = null, bestN = 0;
  for (const k of SPECIFIC) {
    const n = counts[k] || 0;
    // Strictly greater, and SPECIFIC is walked in order, so a tie between
    // placement and exam resolves to placement.
    if (n > bestN) { best = k; bestN = n; }
  }

  // One lone signal is not enough to call something a placement drive — the word
  // "role" appears in ordinary conversation. Two independent signals, or one
  // signal plus a link, is the bar. The same bar applies to the announcement
  // fallback, so a message that merely says "register" does not become a notice.
  // Everything under the bar is unsorted, which is a pile the UI shows — not
  // noise, which is a pile it hides.
  const links = extractLinks(m.text);
  const clears = n => n >= 2 || (n === 1 && links.length > 0);

  let kind;
  if (best && clears(bestN)) kind = best;
  else kind = clears(counts.announcement || 0) ? 'announcement' : 'unsorted';

  return { kind, signals: hit.map(s => s.label), count: hit.length, links };
}

/* ── company ─────────────────────────────────────────────────────────────────
   Only from a structured position. Guessing a company name from capitalisation
   in a chat message produces "Great News" and "All Students" as employers, and a
   wrong company on a drive card is worse than a blank one Neel fills in. */

const COMPANY_PATTERNS = [
  /\bcompany(?:\s*name)?\s*[:\-–]\s*([^\n,.;(]{2,40})/i,
  /\borganisation\s*[:\-–]\s*([^\n,.;(]{2,40})/i,
  /^\s*([A-Z][A-Za-z0-9&.'-]*(?:\s+[A-Z][A-Za-z0-9&.'-]*){0,3})\s+is\s+hiring\b/m,
  /\b(?:recruitment\s+)?drives?\s*(?:of|by|for|:)\s*([A-Z][A-Za-z0-9&.'-]*(?:\s+[A-Z][A-Za-z0-9&.'-]*){0,3})/,
  /\b([A-Z][A-Za-z0-9&.'-]*(?:\s+[A-Z][A-Za-z0-9&.'-]*){0,3})\s+(?:campus\s+)?drive\b/,
];

const NOT_A_COMPANY = /^(the|a|an|all|dear|hi|hello|note|urgent|important|final|last|new|next|this|that|placement|campus|off|on|great|good|news|students?|reminder|update|attention)$/i;

export function extractCompany(text = '') {
  for (const re of COMPANY_PATTERNS) {
    const m = re.exec(String(text));
    if (!m) continue;
    const name = m[1].trim().replace(/\s+/g, ' ').replace(/[-–:]+$/, '').trim();
    if (!name || name.length < 2) continue;
    if (NOT_A_COMPANY.test(name.split(/\s+/)[0])) continue;
    return name;
  }
  return null;
}

/* ── deadlines ───────────────────────────────────────────────────────────────
   Decision 1. Only a date that is actually written gets returned. "by Friday",
   "tomorrow", "EOD" all return null — resolving them needs the sender's intent,
   not the message's timestamp. */

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
const MON_RE = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t)?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';

const CUE = '\\b(?:last date|last day|dead ?line|due date|due by|registrations? (?:by|before|close)|register (?:by|before)|closes? on|closing on|apply (?:by|before|till)|submit (?:by|before)|till|until|upto|up to|valid till)';

export function extractDeadline(text = '', onISO = null) {
  const s = String(text);
  const found = [];

  // 12 July 2026 · 12th July · July 12
  const rA = new RegExp(`\\b(\\d{1,2})(?!\\d)\\s*(?:st|nd|rd|th)?\\s*(?:of\\s+)?(${MON_RE})\\.?\\s*,?\\s*(\\d{4}|\\d{2})?\\b`, 'gi');
  // slice(0,3) is enough for every name including "sept" → "sep".
  for (const m of s.matchAll(rA)) found.push({ d: +m[1], mo: MONTHS[m[2].toLowerCase().slice(0, 3)], y: m[3], raw: m[0] });

  const rB = new RegExp(`\\b(${MON_RE})\\.?\\s+(\\d{1,2})(?!\\d)\\s*(?:st|nd|rd|th)?\\s*,?\\s*(\\d{4}|\\d{2})?\\b`, 'gi');
  for (const m of s.matchAll(rB)) found.push({ d: +m[2], mo: MONTHS[m[1].toLowerCase().slice(0, 3)], y: m[3], raw: m[0] });

  // 12/07/2026 · 12-07-26. Day-first: this is an Indian college group, and the
  // same reasoning as decision 5 applies — pick one convention and say so.
  for (const m of s.matchAll(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})\b/g)) {
    found.push({ d: +m[1], mo: +m[2], y: m[3], raw: m[0], dayFirstAssumed: true });
  }

  const base = onISO && /^\d{4}-\d{2}-\d{2}$/.test(onISO) ? onISO : null;
  const baseY = base ? +base.slice(0, 4) : null;

  for (const f of found) {
    if (!f.mo || f.mo < 1 || f.mo > 12) continue;
    if (!(f.d >= 1 && f.d <= 31)) continue;
    let assumedYear = false, y;
    if (f.y) {
      y = fullYear(+f.y);
    } else if (baseY) {
      y = baseY;
      assumedYear = true;
      // A December message saying "5 Jan" means next January. Only roll forward,
      // never back — a deadline in the past is a real thing a chat can contain.
      const cand = `${y}-${pad(f.mo)}-${pad(f.d)}`;
      if (daysBetween(base, cand) < -45) y += 1;
    } else {
      continue; // no year written and no message date to lean on → decision 1.
    }
    const iso = `${y}-${pad(f.mo)}-${pad(f.d)}`;
    if (!isRealDate(iso)) continue;
    const idx = s.toLowerCase().indexOf(f.raw.toLowerCase());
    const before = s.slice(Math.max(0, idx - 40), idx).toLowerCase();
    return {
      date: iso,
      raw: f.raw.trim(),
      assumedYear,
      dayFirstAssumed: !!f.dayFirstAssumed,
      // Whether a cue word ("last date", "apply by") sits just before it. A bare
      // date in prose is a mention; a cued date is a deadline, and the UI says
      // which of the two it is rather than promoting every date to a deadline.
      cued: new RegExp(CUE, 'i').test(before),
    };
  }
  return null;
}

export function isRealDate(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  if (!y || !m || !d) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function daysBetween(aISO, bISO) {
  const a = Date.parse(`${aISO}T00:00:00Z`), b = Date.parse(`${bISO}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

/* ── the parse ──────────────────────────────────────────────────────────────── */

export function parseChat(raw = '') {
  const lines = String(raw).replace(/\r\n?/g, '\n').split('\n');
  const heads = [];
  const marked = lines.map(l => { const h = matchHeader(l); if (h) heads.push(h); return h; });
  const { order, settled } = detectOrder(heads);

  const messages = [];
  let cur = null, skipped = 0;
  for (let i = 0; i < lines.length; i++) {
    const h = marked[i];
    if (h) {
      const date = toISO(h, order);
      const time = to24h(h.hh, h.mm, h.ampm);
      if (!date) { skipped++; continue; }
      cur = {
        i: messages.length,
        date, time: time || '00:00',
        author: h.author, text: (h.text || '').replace(MARKS, '').trim(),
        format: h.format,
      };
      messages.push(cur);
    } else if (cur) {
      // Continuation of a multi-line message. Keep the newline: a registration
      // notice is usually a list, and joining with a space turns "Company: X /
      // CTC: 6 LPA" into a run-on that the field patterns can no longer read.
      cur.text = (cur.text + '\n' + lines[i].replace(MARKS, '')).trim();
    } else if (lines[i].trim()) {
      skipped++;
    }
  }

  return {
    messages,
    meta: {
      order,
      orderSettled: settled,
      orderNote: settled
        ? `Dates read as ${order === 'dmy' ? 'day/month' : 'month/day'} — the file proved it.`
        : 'No date in this file had a day above 12, so day/month was assumed (Indian export). If the dates look wrong, that assumption is why.',
      format: messages[0]?.format || null,
      total: messages.length,
      skipped,
      from: messages[0]?.date || null,
      to: messages[messages.length - 1]?.date || null,
      authors: [...new Set(messages.map(m => m.author).filter(Boolean))].length,
    },
  };
}

/* ── digest ─────────────────────────────────────────────────────────────────── */

export function titleOf(text = '') {
  const first = String(text).split('\n').map(s => s.trim()).find(Boolean) || '';
  const clean = first.replace(URL_RE, '').replace(/\s+/g, ' ').trim();
  const body = clean || first.replace(/\s+/g, ' ').trim();
  return body.length > 90 ? body.slice(0, 87).trimEnd() + '…' : body;
}

export function dedupeKey(m) {
  return String(m.text).toLowerCase().replace(/\s+/g, ' ').replace(/[^a-z0-9 ]/g, '').trim().slice(0, 80);
}

export function buildItem(m) {
  const c = classify(m);
  return {
    id: `wa-${m.date}-${m.i}`,
    date: m.date,
    time: m.time,
    author: m.author,
    text: m.text,
    title: titleOf(m.text),
    kind: c.kind,
    signals: c.signals,
    links: c.links || extractLinks(m.text),
    company: c.kind === 'placement' ? extractCompany(m.text) : null,
    deadline: c.kind === 'noise' ? null : extractDeadline(m.text, m.date),
  };
}

export function digest(messages = []) {
  const seen = new Map();
  const items = [];
  let duplicates = 0;
  for (const m of messages) {
    const it = buildItem(m);
    if (it.kind === 'noise') { items.push(it); continue; }
    const k = dedupeKey(m);
    // Forwards are the normal case in college groups — the same notice lands in
    // three groups and gets forwarded twice more. Keep the FIRST, because the
    // first is when it was actually announced, and count the rest.
    if (k && seen.has(k)) { duplicates++; seen.get(k).copies++; continue; }
    it.copies = 1;
    if (k) seen.set(k, it);
    items.push(it);
  }
  const by = k => items.filter(x => x.kind === k);
  return {
    items,
    placement: by('placement'),
    exam: by('exam'),
    announcement: by('announcement'),
    unsorted: by('unsorted'),
    noise: by('noise'),
    duplicates,
  };
}

export const KINDS = [
  { key: 'placement', label: 'Placement', color: 'var(--pink)', tab: 'Placement' },
  { key: 'exam', label: 'Exams & work', color: 'var(--orange)', tab: 'College' },
  { key: 'announcement', label: 'Announcements', color: 'var(--cyan)', tab: 'College' },
  { key: 'unsorted', label: 'Unsorted', color: 'var(--yellow)', tab: '—' },
  { key: 'noise', label: 'Filtered out', color: 'var(--ink-3)', tab: '—' },
];

export function kindMeta(key) {
  return KINDS.find(k => k.key === key) || KINDS[3];
}

// The announcements table has exactly these columns. There is no `link` column
// and adding one would need an ALTER on a live database, so the link travels
// inside the body — where it already was in the original message — and is read
// back out with announcementLink(). Sending a key with no column makes PostgREST
// reject the entire insert with a 400, which would fail the import wholesale
// rather than dropping one field.
export const ANNOUNCEMENT_COLUMNS = ['title', 'body', 'date', 'source'];

// Imported rows are indistinguishable from Amizone ones downstream except for
// `source`, which exists so a bad import can be found and undone later.
export function toAnnouncement(it) {
  const body = String(it.text || '').trim();
  return {
    title: it.title,
    // The whole message, not the leftover after the title. The title is a
    // truncation made for display; the body is the record, and a record that
    // starts mid-sentence is worse than one that repeats its own first line.
    body: body === it.title ? '' : body,
    date: it.deadline?.date || it.date,
    source: 'whatsapp',
  };
}

// Reads the link back out of a stored row. Works on Amizone rows too — any
// announcement whose body happens to contain a URL gets an open button, which
// is why Placement can call this instead of a column that does not exist.
export function announcementLink(row = {}) {
  return extractLinks(`${row.title || ''}\n${row.body || ''}`)[0]?.href || null;
}

export function statLine(d, meta) {
  const kept = d.items.length - d.noise.length;
  return `${meta.total} messages · ${kept} kept · ${d.noise.length} filtered${d.duplicates ? ` · ${d.duplicates} duplicate${d.duplicates === 1 ? '' : 's'} folded` : ''}`;
}
