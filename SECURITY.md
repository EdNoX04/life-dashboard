# Security notes

Why the headers in `vercel.json` are what they are. The reasoning lives here
because `vercel.json` cannot hold it: JSON has no comments, and Vercel validates
the file against a strict schema that rejects any unrecognised key — a `$comment`
property failed the build outright rather than being ignored.

## The threat this is actually aimed at

Not password guessing. The password is strong and Supabase rate-limits its token
endpoint. The realistic attack on a single-user dashboard is **script
injection**: the session token lives in `localStorage`, so any script that runs
on this origin can read it and then holds a valid authenticated session. RLS is
no defence — the stolen token *is* the credential RLS asks for.

## The CSP

- **`script-src` is the directive that matters.** Measured on the live site
  rather than assumed: the built app loads exactly one script of its own,
  same-origin, and has zero inline scripts. So an injected `<script src=…>` or
  inline handler has nothing to fall back on.
- **There is exactly one exception, and it is YouTube.** `script-src` admits
  `https://www.youtube.com` and `https://s.ytimg.com`, and `frame-src` admits
  the player. This is the only third-party script in the app, and the story of
  how it got here is worth keeping, because it contains two separate mistakes:

  1. **The security pass set `script-src 'self'` and silently broke the radio.**
     The walkthrough that found 0 violations never caught it, because nobody
     pressed play during the walk — the radio fetches the API only on first
     play, so a passive tour of all 25 tabs could not trigger it. *Lesson: a CSP
     walkthrough has to exercise the features, not just render the pages.*
  2. **Then I narrowed it again for the wrong reason.** With the script allowed,
     one video id returned error 150 (embedding disabled by the owner) and I
     generalised that single measurement into "YouTube does not work here" and
     removed the transport. Synth and Jazz — the same channel — had been playing
     the whole time. *Lesson: one refusal is a fact about one video, not about a
     transport.*

  So the exception is back, deliberately. What it costs is honestly stated: a
  script from `youtube.com` executes in this origin, and if Google ever serves
  something hostile from it, CSP is not what stops it. What it buys is the one
  feature Neel actually asked for by name. The mitigations are that no token
  lives anywhere reachable by script (see above — `sessionStorage`, never
  `localStorage`), `object-src 'none'` and `frame-ancestors 'none'` are
  untouched, and `radio.js` rejects loudly on any future CSP refusal rather than
  spinning forever. **`tests/radio.test.js` asserts that both directives still
  admit YouTube**, so the first mistake cannot be made silently a second time.

  Direct Icecast streams remain in every station as the last fallback, so a
  future decision to drop the exception costs a station's audio quality and
  nothing else.
- **`style-src` keeps `'unsafe-inline'` on purpose.** React writes `style={{…}}`
  attributes throughout this app (the attendance bars, for one) and CSP counts
  those as inline styles. Styles cannot exfiltrate a token, so the cost is close
  to zero and the alternative is a broken layout.
- **`connect-src`, `img-src`, `media-src`, `frame-src` are deliberately wide.**
  This dashboard talks to a long tail of APIs — Supabase, market data, news,
  TMDB, flights. An allowlist assembled by guesswork breaks whichever one nobody
  exercised before deploying, and a tab that silently stops loading a week later
  is worse than the narrow gain. None of these is what stops token theft.

**It shipped as `Content-Security-Policy-Report-Only` first, and is now
enforcing.** An enforcing policy with one directive wrong breaks a tab quietly,
which is not a thing to find out from a user. So it went out in report-only mode,
then all 25 tabs were walked with a `securitypolicyviolation` listener attached:
**0 violations**. Only then was the header renamed. That was not sufficient — see
the YouTube note above. Rendering a tab is not exercising it.

The walk exercises what each tab loads on mount, not every interaction inside it.
If something ever stops working with a "Refused to…" line in the console, the
revert is one word — put `-Report-Only` back on that header key and redeploy.

## The other headers

`Strict-Transport-Security`, `X-Content-Type-Options: nosniff`,
`X-Frame-Options: DENY` and `frame-ancestors 'none'` (clickjacking),
`Referrer-Policy`, and `Cross-Origin-Opener-Policy`.

`Permissions-Policy` denies camera, microphone, payment and USB. **Geolocation is
deliberately left permitted** — Flights and Globe may want it, and denying it
here would break them in a way that looks like a bug in those tabs.

## Auth

TOTP was removed in migration `006-drop-mfa-requirement.sql`; `004` had required
`aal2` in every RLS policy. Anon is still unpolicied, so the publishable key in
the bundle grants nothing — the boundary stays where `003` put it. The real cost:
a stolen password now reads every row instead of being useless without the phone.

To put the factor back: enroll and verify in Settings → Security, **then** re-run
`004`. In that order — `004` against an account with no verified factor locks it
out of its own data.

`LoginGate`'s cool-down after failed attempts is **not** a security boundary. It
lives in the browser; an attacker posts to the token endpoint and never loads the
component. It brakes the realistic case and keeps the app from burning Supabase's
per-IP budget so fast a legitimate retry gets refused. Real brute-force
protection is the server-side rate limit and leaked-password blocking configured
in the Supabase console.
