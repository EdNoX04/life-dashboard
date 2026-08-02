// Pure helpers for the multi-account meetings worker.
//
// These live in their own file for one reason: they are the only parts of
// meeting-worker.mjs that can be wrong in a way nobody notices. A broken API call
// throws and shows up red in the Actions log within five minutes. A broken
// *fold* silently removes a real meeting from the calendar, and the failure mode
// is you not being somewhere you were supposed to be — which surfaces days later,
// as a person asking where you were, and never as an error message.
//
// So they are exported, and tests/calendar-fold.test.js walks them.

/**
 * Split a raw RFC-5322 From header into a display name and a bare address.
 *
 * The header is genuinely messy in the wild: quoted names containing commas and
 * angle brackets, names that are themselves an email address, and bare addresses
 * with no name part at all. Every one of these shows up in a normal work inbox
 * within a week, so none of them is a hypothetical.
 *
 * Returns { name, email }. When there is no name to be had, `name` falls back to
 * the local part of the address rather than to an empty string, because a row
 * rendering as a blank sender reads as a rendering bug rather than as a plain
 * mailing-list address.
 */
export function parseFrom(header) {
  const raw = String(header ?? '').trim();
  if (!raw) return { name: '', email: '' };

  const angled = raw.match(/<([^>]*)>\s*$/);
  const email = (angled ? angled[1] : raw).trim();

  let name = '';
  if (angled) {
    name = raw.slice(0, raw.lastIndexOf('<')).trim();
    // Strip surrounding quotes, then unescape the pair that quoting exists for.
    if (name.startsWith('"') && name.endsWith('"') && name.length >= 2) {
      name = name.slice(1, -1).replace(/\\(["\\])/g, '$1');
    }
  }
  // A name that is just the address again is noise, not information.
  if (!name || name.toLowerCase() === email.toLowerCase()) {
    name = email.includes('@') ? email.split('@')[0] : email;
  }
  return { name, email };
}

/**
 * Fold the same meeting appearing on more than one connected account.
 *
 * You get invited on the work address; the invitation also lands on the personal
 * one because that address is on the thread. Both accounts return it, and without
 * this the dashboard shows the 10:00 standup twice and a five-meeting day looks
 * like nine.
 *
 * The identity rule is (exact start instant, case-folded trimmed title). It is
 * deliberately strict on time: two meetings with the same name at different times
 * are two meetings — a weekly 1:1 is not a duplicate of last week's — and the
 * cost of being wrong in the two directions is not symmetric. Showing a duplicate
 * is a cosmetic annoyance you can see and dismiss. Hiding a real meeting is
 * invisible until it has already cost you something. When in doubt, keep both.
 *
 * The survivor is the earliest in `events` order, so the caller controls
 * precedence by the order it pulls accounts in. It gains:
 *   alsoOn — labels of the other accounts the same meeting arrived on, so the
 *            fold is visible in the UI instead of being a silent deletion.
 * and it inherits a `meet` link from a duplicate if it had none itself: one copy
 * of an invitation frequently carries the conferencing data and the other does
 * not, and the joinable one is the one worth keeping.
 */
export function foldDuplicates(events) {
  const byKey = new Map();
  const order = [];
  for (const e of Array.isArray(events) ? events : []) {
    if (!e || !e.start) continue;
    const key = `${e.start}|${String(e.summary ?? '').trim().toLowerCase()}`;
    const seen = byKey.get(key);
    if (!seen) {
      const kept = { ...e, alsoOn: [] };
      byKey.set(key, kept);
      order.push(kept);
      continue;
    }
    if (e.accountLabel && e.accountLabel !== seen.accountLabel && !seen.alsoOn.includes(e.accountLabel)) {
      seen.alsoOn.push(e.accountLabel);
    }
    if (!seen.meet && e.meet) seen.meet = e.meet;
  }
  return order.sort((a, b) => String(a.start).localeCompare(String(b.start)));
}

/**
 * Recover the account and the bare Google event id from a dashboard event id.
 *
 * Events are stored prefixed ("work:abc123") so two accounts returning the same
 * id for the same invitation do not collapse into one row. Deletes come back the
 * other way and have to be un-prefixed before Google will accept them.
 *
 * The prefix is only honoured when it names an account we actually have. Google's
 * own ids are base32hex and can contain no colon, but ids from imported .ics
 * feeds are arbitrary strings and some of them do — so a bare id containing a
 * colon must survive untouched rather than being silently truncated at the first
 * one. `rest.join(':')` rather than `rest[0]` matters for the same reason.
 */
export function splitEventId(eventId, knownAccountIds = []) {
  const raw = String(eventId ?? '');
  const i = raw.indexOf(':');
  // `<= 0` rather than `< 0` rejects a leading colon here rather than three lines
  // down. It is deliberately redundant — an empty prefix would fail the
  // known-account check anyway, and a mutation to `< 0` changes no output — but
  // it states the intent at the point the index is taken instead of leaving it to
  // be inferred from a lookup below.
  if (i <= 0) return { account: null, id: raw };
  const prefix = raw.slice(0, i);
  const rest = raw.slice(i + 1);
  if (!rest || !knownAccountIds.includes(prefix)) return { account: null, id: raw };
  return { account: prefix, id: rest };
}
