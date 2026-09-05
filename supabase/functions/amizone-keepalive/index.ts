// Amizone session keepalive.
//
// WHAT THIS IS FOR
//
// The Amizone ticket dies fast — Neel reports being asked to log in again after
// about fifteen minutes — and ASP.NET forms auth uses SLIDING expiration, which
// means the server reissues the ticket on any request that arrives before it
// expires. So a session can live indefinitely without anyone logging in again,
// provided something knocks on the door often enough.
//
// Nothing was knocking. The GitHub workflow ran every two hours against a thing
// that lasts minutes: 76 runs, 2 successes, both manual. The renewal mechanism
// the whole design rested on had never once fired.
//
// WHY IT LIVES HERE AND NOT ON A LAPTOP
//
// Every other option needs a machine that is awake:
//
//   · a launchd/systemd job          — needs the Mac open
//   · a Chrome extension             — needs Chrome running
//   · Playwright with a warm profile — needs both, and the Omarchy attempt
//                                      never got past its capture step
//   · GitHub Actions cron            — the right idea, but its scheduler is
//                                      routinely 10-20 minutes late, which is
//                                      useless against a timeout of ~15
//
// A Supabase Edge Function on pg_cron has none of those problems. pg_cron fires
// on time, Postgres is already running, and this costs one tiny fetch every few
// minutes. It is the only option here that works at 3am with every device shut.
//
// WHAT IT DELIBERATELY DOES NOT DO
//
// It does not log in. It has no username, no password, and it never touches the
// login form — so Cloudflare Turnstile is never involved, which is what killed
// every previous cloud attempt. It only carries a ticket a human already
// created, and hands back whatever the server reissues.
//
// When the ticket does finally die, this cannot revive it. It says so, loudly,
// in sync_status — and the dashboard's `sync` notification channel turns that
// into something Neel actually sees, rather than an attendance card quietly
// serving three-week-old numbers.

const AMIZONE = 'https://s.amizone.net';
const PROBE = '/Academics/MyCourses';

const SUPA_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPA_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const SHARED = Deno.env.get('KEEPALIVE_SECRET') ?? '';

const H = {
  apikey: SUPA_KEY,
  Authorization: `Bearer ${SUPA_KEY}`,
  'Content-Type': 'application/json',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function memGet(key: string) {
  const r = await fetch(`${SUPA_URL}/rest/v1/memory?key=eq.${key}&select=value`, { headers: H });
  if (!r.ok) throw new Error(`memory read failed: ${r.status}`);
  const rows = await r.json();
  return rows?.[0]?.value ?? null;
}

async function memPut(key: string, value: unknown) {
  const r = await fetch(`${SUPA_URL}/rest/v1/memory`, {
    method: 'POST',
    headers: { ...H, Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ key, value }),
  });
  if (!r.ok) throw new Error(`memory write failed: ${r.status} ${await r.text()}`);
}

/** Merge one worker's health into sync_status without clobbering the others. */
async function report(state: Record<string, unknown>) {
  try {
    const cur = (await memGet('sync_status')) ?? {};
    await memPut('sync_status', {
      ...cur,
      amizone_keepalive: { ...state, at: new Date().toISOString() },
    });
  } catch { /* a health note is not worth failing the run over */ }
}

/**
 * The lifetime bracket, from the two timestamps already in the store.
 *
 * This is the number the whole schedule depends on and nothing was reading it.
 * `first_seen` is when this exact ticket value appeared; `updated_at` is the
 * last run that proved it still worked. When the ticket dies, those two bracket
 * the session's real lifetime — measured, rather than assumed from a framework
 * default, which is the mistake that produced a 2-hour schedule for a
 * 15-minute session.
 */
function lifetime(firstSeen?: string, lastOk?: string) {
  const mins = (t?: string) => (t ? Math.round((Date.now() - Date.parse(t)) / 60000) : null);
  const age = mins(firstSeen);
  const since = mins(lastOk);
  const parts: string[] = [];
  if (age !== null) parts.push(`ticket was ${age} min old`);
  if (since !== null) parts.push(`last confirmed working ${since} min ago`);
  if (age !== null && since !== null && age >= since) {
    parts.push(`survived at least ${since} min, dead by ${age} min`);
  }
  return parts.length ? parts.join(' · ') : 'no timestamps stored yet';
}

const normalise = (raw: string) => {
  const v = String(raw || '').trim();
  const m = /\.ASPXAUTH=([^;]+)/i.exec(v);
  return m ? `.ASPXAUTH=${m[1]}` : (v ? `.ASPXAUTH=${v}` : '');
};

/** The login page has a username field and a Turnstile widget; MyCourses has neither. */
const loggedOut = (html: string) =>
  /name=['"]?_?UserName/i.test(html) || /challenges\.cloudflare\.com/i.test(html);

Deno.serve(async (req) => {
  // Deployed with --no-verify-jwt so pg_cron can call it without minting a JWT,
  // so it checks its own shared secret instead. Without this the endpoint would
  // be an open proxy that anyone could use to burn the session.
  if (SHARED && req.headers.get('x-keepalive-secret') !== SHARED) {
    return json({ error: 'forbidden' }, 403);
  }
  if (!SUPA_URL || !SUPA_KEY) return json({ error: 'function env not configured' }, 500);

  try {
    const stored = await memGet('amizone_cookie');
    const cookie = normalise(typeof stored === 'string' ? stored : stored?.value);
    if (!cookie) {
      await report({ ok: false, configured: false, reason: 'no ticket stored — use the bookmarklet in Settings' });
      return json({ ok: false, reason: 'no cookie stored' }, 200);
    }
    const firstSeen = stored?.first_seen ?? undefined;
    const lastOk = stored?.updated_at ?? undefined;

    const res = await fetch(AMIZONE + PROBE, {
      headers: {
        cookie,
        // Cloudflare's managed rules drop obvious script user-agents outright.
        // This is not an attempt to defeat anything — the request carries a real
        // session a human created, and is exactly what that human's browser
        // would send.
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
    });
    const html = await res.text();

    if (loggedOut(html)) {
      const life = lifetime(firstSeen, lastOk);
      await report({
        ok: false, configured: true,
        reason: `Amizone session expired — re-paste .ASPXAUTH from Settings (${life})`,
        lifetime: life,
      });
      return json({ ok: false, reason: 'expired', lifetime: life }, 200);
    }

    // getSetCookie keeps multiple Set-Cookie headers separate; headers.get folds
    // them into one unparseable string.
    const setCookies = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
    const reissued = setCookies
      .map((c) => /\.ASPXAUTH=([^;]+)/i.exec(c)?.[1])
      .filter(Boolean)[0];

    const now = new Date().toISOString();
    const renewed = Boolean(reissued && `.ASPXAUTH=${reissued}` !== cookie);
    const value = renewed ? `.ASPXAUTH=${reissued}` : cookie;

    // first_seen tracks THIS ticket value. It resets when the server hands over
    // a new one, which is what makes the age figure mean "how long has this
    // particular ticket been alive" rather than "how long since the first paste".
    await memPut('amizone_cookie', {
      value,
      first_seen: renewed || !firstSeen ? now : firstSeen,
      updated_at: now,
    });

    await report({ ok: true, configured: true, renewed, reason: renewed ? 'server reissued the ticket' : 'session still alive' });
    return json({ ok: true, renewed, age: lifetime(renewed ? now : firstSeen, lastOk) }, 200);
  } catch (e) {
    const reason = String((e as Error)?.message ?? e).slice(0, 300);
    await report({ ok: false, configured: true, reason });
    return json({ ok: false, reason }, 200);
  }
});
