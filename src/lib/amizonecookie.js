// Refreshing the Amizone session, without going near GitHub.
//
// The ticket expires — measured, roughly a day. It survived several two-hourly
// syncs and then died regardless of use, which is the signature of a FIXED
// expiry rather than a sliding one. If that reading is right, polling cannot
// save it: the only cure is a fresh login, and login means Turnstile, which
// means a residential IP.
//
// The old chore was: open Amizone, open devtools, run copy(document.cookie),
// open GitHub, find Actions secrets, paste, re-run the workflow. Six steps and
// a laptop. This makes it two: click a bookmarklet on the Amizone tab, paste
// into the dashboard.
//
// The value is written with Neel's OWN logged-in session, so no service key goes
// anywhere near a browser or a bookmark.

export const COOKIE_KEY = 'amizone_cookie';

/**
 * Pull the ticket out of whatever was pasted — the whole `document.cookie`
 * string, just the value, or the name=value pair. All three are things a person
 * plausibly ends up with on the clipboard.
 */
export function parseCookie(raw) {
  const s = String(raw || '').trim();
  if (!s) return { ok: false, reason: 'nothing pasted' };

  const named = /\.ASPXAUTH\s*=\s*([^;\s]+)/i.exec(s);
  const value = named ? named[1] : (/^[A-Za-z0-9+/=_-]{40,}$/.test(s) ? s : null);
  if (!value) {
    return { ok: false, reason: 'that does not look like an Amizone ticket — it should contain .ASPXAUTH=' };
  }
  // Real tickets are long. A short one is a truncated copy, and pasting it would
  // replace a working session with a broken one — worse than doing nothing.
  if (value.length < 40) return { ok: false, reason: 'that ticket looks truncated — copy the whole value' };
  return { ok: true, cookie: `.ASPXAUTH=${value}` };
}

/** How old the stored ticket is, in hours, or null when there is none. */
export function ageHours(row, now = Date.now()) {
  const seen = row?.first_seen || row?.updated_at;
  if (!seen) return null;
  const t = Date.parse(seen);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round(((now - t) / 3.6e6) * 10) / 10);
}

/**
 * What to tell him about the ticket he has.
 *
 * The thresholds come from the one measurement available: the last ticket lasted
 * about a day. They are a guess made explicit rather than a silent one, and they
 * move as soon as there is better evidence.
 */
export function cookieState(row, now = Date.now()) {
  if (!row?.value && !row?.cookie) return { tone: 'none', text: 'No ticket stored — the sync cannot run.' };
  const age = ageHours(row, now);
  if (age == null) return { tone: 'ok', text: 'Ticket stored.' };
  if (age >= 24) return { tone: 'stale', text: `Stored ${age}h ago — past the point the last one died. Refresh it.` };
  if (age >= 18) return { tone: 'warn', text: `Stored ${age}h ago. The last ticket lasted about a day.` };
  return { tone: 'ok', text: `Stored ${age}h ago.` };
}

/**
 * The bookmarklet. Copies the ticket and says so.
 *
 * Deliberately does NOT post anywhere: a bookmarklet that talks to a database
 * needs a credential, and a credential in a bookmark is a credential in the
 * browser's sync, in every device signed into it, and in a text file somewhere.
 * Copying costs one extra paste and keeps the secret out of everything.
 */
export const BOOKMARKLET =
  'javascript:(function(){var m=/\\.ASPXAUTH=([^;]+)/.exec(document.cookie);'
  + 'if(!m){alert("Not signed in to Amizone in this tab.");return;}'
  + 'navigator.clipboard.writeText(m[0]).then(function(){alert("Amizone ticket copied. Paste it into PLAYER ONE \\u2192 Settings.");},'
  + 'function(){prompt("Copy this:",m[0]);});})();';
