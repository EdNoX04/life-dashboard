# PLAYER ONE — Amizone bridge (Chrome extension)

**What it does:** fetches your Amizone pages from this browser, on your own
connection, using the session already signed in here, and parks the raw pages in
Supabase. The GitHub workflow parses them exactly as it always has.

**What it means for you:** you never open Amizone, and you never paste a cookie.

## Why an extension, after everything else failed

Two things were measured on 2026-09-05, not assumed:

**`.ASPXAUTH` is HttpOnly.** On a logged-in Amizone page, `document.cookie`
returns the empty string while requests from that same page are perfectly
authenticated. So the bookmarklet — which reads `document.cookie` — cannot work
any more, and neither can anything else in the web sandbox. `chrome.cookies` is
the only API that can see an HttpOnly cookie, and only an extension has it.

**The session does not travel.** A ticket that had been serving the browser
happily for 33 minutes died within minutes of being used from two datacenters.
Whether the cause is IP binding or one-session-per-user was never separated — and
it does not need to be, because both are avoided by never moving the credential
off this machine.

So the fetching moved to where the session already is. **The cookie is read by
Chrome itself and is never stored, never transmitted, and never written to
Supabase.** Only the resulting pages are.

## Install

1. `chrome://extensions` → turn on **Developer mode** (top right)
2. **Load unpacked** → select this folder
   (`/Users/neel/Projects/life-dashboard/automation/amizone/extension`)
3. Click the extension's icon → paste your **Supabase URL** and **service role
   key** → **Save**
4. Make sure you are signed into Amizone in this browser, then press **Run now**

You want: *"Captured N attendance registers and M diary chunks."*

The key is kept in this browser's extension storage. It is never written into the
repo — same trust boundary as `amizone.config.local.json`.

## Make it run with Chrome closed

**`chrome://settings/system` → turn on "Continue running background apps when
Google Chrome is closed".**

This is the setting that matters. With it on, Chrome keeps a background process
alive after you close the last window, and the extension's alarm keeps firing —
so the sync runs whenever your Mac is awake, whether or not you are looking at a
browser. Without it, the extension only runs while a window is open.

Nothing runs while the Mac is asleep. Nothing can; when it wakes, the alarm fires
and catches up.

## Want it genuinely 24/7?

Install this same extension in Chromium on the Omarchy laptop and sign into
Amizone there once. It stays on and has no lid to close. No new code, no
Playwright, and none of the automated-login machinery that never got past its
capture step.

## How often

Default every 30 minutes, adjustable in the options. There is no reason to go
lower — attendance is marked a handful of times a day, and the workflow that
parses the captures runs eight times daily anyway.

## When something is wrong

The extension writes its state into `memory.sync_status.amizone`, which the
dashboard's Background sync card already reads, and the `sync` notification
channel announces. The messages are the actionable ones:

- *"not signed in to Amizone in this browser"* — open s.amizone.net and log in
- *"not configured"* — the options page is empty
- *"captured pages are Nh old"* — from the workflow: Chrome has not run recently,
  so it refused to publish stale attendance as current

That last one matters. Parsing week-old HTML and writing it out as today's
figures is not a visible error — it is a dashboard confidently showing numbers
from another week, which is exactly the failure this project has hit twice.
