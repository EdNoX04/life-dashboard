# Amizone sync on the Mac

**Why this exists:** so you never paste a session cookie again.

## What was actually wrong

The cookie sync in GitHub Actions has run **76 times and succeeded twice** — both
times manually, both on 29 August, seventeen minutes apart. Every scheduled run
has failed with exit code 5: *"cookie is no longer valid — Amizone returned the
login page."*

The design was sound and the interval was not. From the sync script's own header:

> ASP.NET forms auth uses sliding expiration: once a ticket is more than halfway
> to its timeout, the server reissues it on the next request via Set-Cookie…
> the session renews itself indefinitely, for as long as the sync keeps running.

That is correct — **provided a request arrives before the ticket expires.**
Amizone's login page has no "remember me" checkbox, so the ticket is governed by
`<forms timeout>`, whose framework default is **30 minutes**. The workflow ran
**every 2 hours**. So every scheduled run knocked on a door that had already
closed, got the login page, and exited. The renewal mechanism has never once
fired — the telemetry line has never said anything but `same ticket`.

## Why it cannot be fixed on GitHub

Turnstile. Open the Amizone login page in your own Chrome and the Cloudflare
widget says **"Success!"** on its own, without you touching it — a real browser
on a residential connection is handed a token silently. A GitHub runner is an
Azure datacenter IP and is never given one, which is why runs #19–#25 all
reported `turnstile=MISSING` and why the Playwright workflow was disabled.

There is no library route around it either: **go-amizone was archived by its
owner on 4 November 2024** and unmaintained since January 2024 — it predates
Amizone's Turnstile and Salt/Signature layer entirely. Its old hosted instance
would also have meant sending your university password to somebody else's
server, which is not a trade worth making for an attendance percentage.

So the session has to be held somewhere Turnstile says yes. That means your
machine.

## What runs here

`amizone-auto.mjs`, which already existed for the Omarchy laptop. It keeps a
persistent Chrome profile in `.amizone-profile/`, so ordinary runs go straight to
your courses with no login at all — and when the session does finally die, it
logs in again by itself using the stored credentials, in a real browser, on your
own connection, where Turnstile passes without being asked.

Every 20 minutes, which is inside the 30-minute window, so the ticket renews
itself and the dead-session case becomes rare rather than daily.

## Setup

**1. Credentials — in the untracked file.**

```bash
cd /Users/neel/Projects/life-dashboard/automation/amizone
cp amizone.config.json amizone.config.local.json
```

Then edit `amizone.config.local.json` and fill in `amizoneUser`, `amizonePass`
and `supabaseServiceKey`. Set `syncTimetable` to `true` if you want the live
timetable as well as attendance.

`amizone.config.json` **is tracked by git** and must keep its placeholders —
`.local.json` is the one `.gitignore` covers. (Checked on 2026-09-05: the tracked
file still holds `PUT_THE_SERVICE_ROLE_KEY_HERE`, so nothing has leaked.)

**2. Playwright — the small one.**

```bash
cd /Users/neel/Projects/life-dashboard
npm install --no-save playwright-core
```

A few megabytes, not 300. The script drives the real Chrome already on your Mac
via `executablePath`, so the bundled browser builds would never be used.

**3. Prove it can reach Supabase, with no browser involved:**

```bash
node automation/amizone/amizone-auto.mjs --check
```

Wants `write : OK`.

**4. Log in once, by hand.**

```bash
node automation/amizone/amizone-auto.mjs --login
```

A normal Chrome window opens with no automation running in it. Log in, clear
Cloudflare if it asks, then follow the prompt. The session is saved into
`.amizone-profile/` and every later run reuses it.

**5. Install the schedule.**

```bash
cp automation/amizone/launchd/com.playerone.amizone.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.playerone.amizone.plist
```

It runs immediately, then every 20 minutes.

**6. Watch one run:**

```bash
tail -f automation/amizone/amizone.log
```

## Checking on it later

```bash
launchctl list | grep playerone            # second column is the last exit code; 0 is good
tail -40 automation/amizone/amizone.log
```

To stop it:

```bash
launchctl unload ~/Library/LaunchAgents/com.playerone.amizone.plist
```

## Things that will bite

**`node: command not found`, every run exits 127.** launchd gives an agent a
minimal `PATH` with no Homebrew in it. The plist sets `PATH` explicitly for this
reason; if you moved node somewhere unusual, fix it there.

**A Chrome window appears every 20 minutes.** `AMIZONE_OFFSCREEN=1` should park
it at -4000,-4000. If your display arrangement somehow reaches that far, make the
number bigger.

**Nothing runs overnight.** `StartInterval` does not fire while the Mac is
asleep — it fires once on wake. So after a night with the lid shut the first
morning run may find the ticket dead, and will log in again by itself. That is
the designed path, not a failure.

**It disagrees with the GitHub workflow.** Both write the same Supabase rows and
neither corrupts the other, but once this is running the workflow is redundant.
Leave it as a backup or disable it; it costs Actions minutes either way.

## If you want it running 24/7

Use the Omarchy laptop instead — it stays on, and
`systemd/playerone-amizone.{service,timer}` plus `SETUP-ARCH.md` are already
written for it. Same script, same profile trick, no lid to close.
