# Amizone bridge on the Omarchy laptop

The always-on install. One login, by hand, once — then you never open Amizone
again and the dashboard is current at 3am with your Mac shut and your phone in
your pocket.

**This is not the thing that failed before.** That was `amizone-auto.mjs` trying
to *automate* the login through Cloudflare Turnstile with Playwright, and its
capture step never recorded anything. There is no automated login here. You sign
in like a person, once, and the extension rides that session.

## Why it stays signed in

Amizone's ticket dies quickly when nothing touches it, and ASP.NET renews it on
any request that arrives *before* it expires. The extension makes a request every
30 minutes from the machine that created the session — so the renewal that never
once fired in 76 GitHub runs now fires continuously. Realistically: one login,
and possibly never again.

---

## 1 · Get the repo on the laptop

```bash
cd ~ && git clone https://github.com/EdNoX04/life-dashboard.git
# or, if it is already there:
cd ~/life-dashboard && git pull
```

## 2 · Chromium

Omarchy ships it. If not:

```bash
sudo pacman -S chromium
```

## 3 · Load the extension

Start Chromium normally, then:

1. `chrome://extensions`
2. **Developer mode** on (top right)
3. **Load unpacked** → `~/life-dashboard/automation/amizone/extension`

**After any `git pull` that touches this folder, press Reload (⟳) on the
extension card.** A changed `manifest.json` in particular is only read at load
time, so a new permission silently does nothing until you do.

## 4 · Configure it

Click the extension's icon in the toolbar:

- **Supabase URL** — `https://xroynvkzephebhcztvfo.supabase.co`
- **Service role key** — from Supabase → Settings → API
- **Run every** — 30 minutes
- **Save**

The key lives in this browser's extension storage on this laptop. It is never
written into the repo.

## 5 · Sign into Amizone, once

Go to `https://s.amizone.net` in that same Chromium and log in normally.
Cloudflare will pass on its own — you are a real browser on a home connection,
which is the whole reason this machine is doing the job.

## 6 · Prove it

Click the extension icon → **Run now**.

You want: *"Captured N attendance registers, M diary chunks and the placement page."*

If the placement half says FAILED the attendance still lands — the two are
deliberately independent, because attendance without placements beats neither.

The messages that are not that:

- *"no Amizone cookie in this browser"* → step 5 did not take. Log in on this
  machine's Chromium, not another browser.
- *"cookies present (...) but Amizone still returned the login page"* → you ARE
  signed in and the ticket was rejected anyway. That is a different problem —
  the session was probably invalidated somewhere else. Tell me the message.

### Why it needs the cookie permission

Chrome sends a service worker's `fetch()` with no site-for-cookies, so it counts
as cross-site and a `SameSite=Lax` cookie is withheld — and ASP.NET has issued
its forms-auth ticket as Lax by default since 4.7.2. `credentials: 'include'`
does not override SameSite and never could. Measured directly: the same request
from an Amizone page returns 200 and five courses; from the worker it returns
the login page.

So the extension reads the cookies from Chrome's own jar and attaches them with
a `declarativeNetRequest` session rule scoped to this one host and to its own
tab-less requests — it does not touch your normal browsing. The value is used in
that process and never stored, logged, or sent to Supabase.

---

## Keeping it awake

Three separate things can put this laptop to sleep, and all three have to be told
not to. Missing one is why a machine that "stays on" quietly stops at midnight.

### a) The lid, and systemd's idea of sleep

```bash
sudo nano /etc/systemd/logind.conf
```

Set these (uncomment them — they ship commented out, which means default, not off):

```
HandleLidSwitch=ignore
HandleLidSwitchExternalPower=ignore
HandleLidSwitchDocked=ignore
IdleAction=ignore
```

Then:

```bash
sudo systemctl restart systemd-logind
```

Belt and braces — stop the sleep targets existing at all:

```bash
sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target
```

To undo later: `sudo systemctl unmask sleep.target suspend.target hibernate.target hybrid-sleep.target`

### b) hypridle

Omarchy runs `hypridle`, and it will suspend the machine regardless of what
logind thinks. Edit `~/.config/hypr/hypridle.conf` and **remove or comment out
the listener that runs `systemctl suspend`**. Keep the one that turns the screen
off if you like — a dark screen is fine, a suspended machine is not.

```bash
nano ~/.config/hypr/hypridle.conf
# comment out the block whose on-timeout is `systemctl suspend`
systemctl --user restart hypridle
```

### c) Chromium has to be running

Extensions only run while the browser process is alive. Add this to
`~/.config/hypr/hyprland.conf`:

```
exec-once = chromium --no-startup-window
```

`--no-startup-window` starts Chromium with **no window at all** — the process
runs, extensions load, alarms fire, and nothing appears on screen. Closing your
last window later will no longer kill it either.

Reboot, then confirm it came back:

```bash
pgrep -a chromium | head -3
```

### The session must survive logout

If Omarchy ever drops you to a login screen, the Hyprland session ends and
Chromium with it:

```bash
loginctl enable-linger $USER
```

---

## Checking on it later

**From anywhere:** PLAYER ONE → the Background sync card. It reads
`memory.sync_status.amizone`, which the extension writes on every run, and the
new `sync` notification channel announces a failure rather than letting the
dashboard quietly serve week-old numbers.

**On the laptop:** click the extension icon — the popup remembers the last run.

**The messages that mean something:**

- *"not signed in to Amizone in this browser"* → log in again on the laptop.
  This should be rare; if it is not, tell me, because it means the session is
  being invalidated by something else and that is a different problem.
- *"not configured"* → the options page is empty.
- *"captured pages are Nh old"* → from the GitHub workflow: Chromium is not
  running, or the laptop is off. The workflow **refuses** to publish captures
  older than six hours, because writing week-old HTML out as today's attendance
  is not a visible error — it is a dashboard lying quietly, which has happened
  twice already.

## After this works

Two things become dead weight and should go:

- `AMIZONE_COOKIE`, `AMIZONE_USER` and `AMIZONE_PASS` in GitHub Secrets — nothing
  reads them any more. `AMIZONE_PASS` is your real password sitting in a store
  with no consumer, so that one is worth deleting today.
- The `amizone-keepalive` Supabase function — deployed, never scheduled, and
  based on the stale-ticket idea this replaces.
