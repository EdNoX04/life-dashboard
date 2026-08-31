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
// a laptop. Then it was two: click a bookmarklet, paste into the dashboard.
// Now it is one: click the bookmarklet, and the tab it opens files the ticket
// itself.
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

// ---------------------------------------------------------------------------
// The handoff
//
// A bookmarklet on s.amizone.net has the ticket but no way to reach the
// database: writing needs Neel's Supabase session, which lives in this app's
// origin and nowhere else. The two origins cannot see each other's storage, and
// the one channel that survives crossing between them is the URL fragment.
//
// A fragment is not sent to any server — it never leaves the browser. What it
// does do is sit in the address bar and in that tab's history entry, so it is
// taken and scrubbed in the same tick as the page's first script, before React
// renders and long before anything could screenshot or bookmark it. From then on
// it exists only in this module's memory, and only until it is stored.
//
// This is not "a secret in a URL" in the sense that matters — no server sees it,
// no log records it, and it is a read-only ticket that expires by itself. It is
// a courier walking down one corridor.

export const HANDOFF_KEY = 'amizone';

let pending = null;

/** Extract a ticket from a location hash. Pure, so the parsing can be tested. */
export function parseHandoff(hash) {
  const s = String(hash || '').replace(/^#/, '');
  if (!s) return null;
  const m = new RegExp(`(?:^|&)${HANDOFF_KEY}=([^&]+)`).exec(s);
  if (!m) return null;
  let raw;
  try { raw = decodeURIComponent(m[1]); } catch { raw = m[1]; }
  const p = parseCookie(raw);
  return p.ok ? p.cookie : null;
}

/** The hash with the ticket removed, for putting back in the address bar. */
export function scrubHash(hash) {
  const s = String(hash || '').replace(/^#/, '');
  const rest = s.split('&').filter(p => p && !p.startsWith(`${HANDOFF_KEY}=`)).join('&');
  return rest ? `#${rest}` : '';
}

/**
 * Take the ticket out of the URL and hold it. Called once at startup, before
 * render — the Settings card may not mount for another five clicks, and the
 * fragment must not still be sitting there when it does.
 */
export function takeHandoff(loc = typeof window !== 'undefined' ? window.location : null,
                            hist = typeof window !== 'undefined' ? window.history : null) {
  if (!loc) return null;
  const found = parseHandoff(loc.hash);
  if (!found) return null;
  pending = found;
  try {
    hist?.replaceState(null, '', loc.pathname + loc.search + scrubHash(loc.hash));
  } catch {
    // A browser that refuses replaceState is not a reason to drop the ticket;
    // it only means the fragment lingers in the bar until the next navigation.
  }
  return found;
}

/** The ticket waiting to be filed, if the bookmarklet sent one. */
export function pendingHandoff() { return pending; }

/** Forget it — after a successful write, or after a failure the user was told about. */
export function clearHandoff() { pending = null; }

/**
 * The bookmarklet.
 *
 * It still holds no credential and still posts nowhere: all it does is open this
 * app with the ticket in the fragment, which is the one place a value can cross
 * an origin boundary without a server in the middle. If the browser blocks the
 * popup it falls back to the clipboard, and the paste box below is still there.
 */
export function bookmarkletFor(origin) {
  const base = String(origin || '').replace(/\/+$/, '');
  return 'javascript:(function(){'
    + 'var m=/\\.ASPXAUTH=([^;]+)/.exec(document.cookie);'
    + 'if(!m){alert("Not signed in to Amizone in this tab.");return;}'
    + `var u=${JSON.stringify(base)}+"/#${HANDOFF_KEY}="+encodeURIComponent(m[0]);`
    + 'var w=window.open(u,"_blank");'
    + 'if(!w){navigator.clipboard.writeText(m[0]).then(function(){'
    + 'alert("Popup blocked. Ticket copied instead \\u2014 paste it into PLAYER ONE \\u2192 Settings.");'
    + '},function(){prompt("Copy this:",m[0]);});}'
    + '})();';
}

// Kept for the tests and for anywhere an origin is not to hand.
export const BOOKMARKLET =
  'javascript:(function(){var m=/\\.ASPXAUTH=([^;]+)/.exec(document.cookie);'
  + 'if(!m){alert("Not signed in to Amizone in this tab.");return;}'
  + 'navigator.clipboard.writeText(m[0]).then(function(){alert("Amizone ticket copied. Paste it into PLAYER ONE \\u2192 Settings.");},'
  + 'function(){prompt("Copy this:",m[0]);});})();';
