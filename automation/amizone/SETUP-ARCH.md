# Amizone auto-sync — Omarchy / Arch setup (one time, ~15 min)

Replaces the Windows laptop. After this, the Arch box scrapes Amizone six times
a day and pushes attendance + timetable into PLAYER ONE on its own. No window
ever appears on screen.

## Why this runs on your machine at all

It is not a preference. `.github/workflows/amizone-sync.yml` did exactly this job
on GitHub Actions and failed every run from 22–25 July with:

```
LOGIN FAILED. turnstile=MISSING hidden={ sig: 64, salt: 16, chal: 64 }
```

Amizone's own Salt/Signature challenge was fine. What never arrived was a
Cloudflare Turnstile token — Turnstile hands one out passively to a browser that
looks legitimate, and a GitHub runner is an Azure datacenter IP, so it doesn't.
The workflow is now disabled and should stay disabled; no amount of fixing the
scraper will change the IP it runs from.

This script takes the other route: you clear Cloudflare **once**, by hand, in a
real window. The session is saved into `.amizone-profile/` and every run after
that reuses it — no login, no challenge, nothing to solve.

## Step 1 — packages

```bash
sudo pacman -S --needed nodejs npm xorg-server-xvfb
yay -S google-chrome
```

Chrome from the AUR rather than the Chromium that Omarchy ships, because
Turnstile is measurably happier with real Chrome and that is the one thing this
whole design rests on. If you would rather not pull from the AUR,
`sudo pacman -S chromium` works — the script tries Chrome, then Chromium, then
Playwright's own build, and tells you all four if none of them start.

## Step 2 — clone and install

```bash
git clone https://github.com/EdNoX04/life-dashboard.git ~/life-dashboard
cd ~/life-dashboard/automation/amizone
npm install playwright@1.48.0
```

Skip `npx playwright install chromium` — it downloads ~300 MB you don't need
once Chrome is installed from pacman/AUR, and `playwright install-deps` has no
Arch support anyway.

## Step 3 — config

**Create `amizone.config.local.json`.** Not `amizone.config.json` — that one is
tracked by git, and a service_role key in it is one `git add -A` away from being
public. The `.local.json` name is the one `.gitignore` covers, and the script now
prefers it.

```bash
cp amizone.config.json amizone.config.local.json
$EDITOR amizone.config.local.json
```

```json
{
  "amizoneUser": "your enrolment number",
  "amizonePass": "your Amizone password",
  "supabaseUrl": "https://xroynvkzephebhcztvfo.supabase.co",
  "supabaseServiceKey": "<Supabase → Project Settings → API → service_role>",
  "syncTimetable": true
}
```

**The service_role key, not the publishable one.** Row-level security went on 15
August and the publishable key can no longer write anything. The script refuses
to start if it sees a publishable key rather than failing later with a 401 into a
log nobody reads.

**`syncTimetable: true`** is what makes the timetable live. It defaults to
`false` because Amizone's diary is a per-day feed, so a weekly grid rebuilt from
it unions both batches, makeups and extra classes into a noisy superset — the
hand-verified weekly timetable in the app is cleaner. Turn it on if you would
rather have the real one with that noise; turn it back off if the noise annoys
you more than the staleness did.

## Step 4 — prove it can write, before anything else

```bash
node amizone-auto.mjs --check
```

Two seconds, no browser, no Amizone. Worth doing first because a real run takes
~90 seconds and fails at the very END, at the write — so a bad key looks exactly
like a broken scraper.

```
read   : OK
write  : OK — this laptop can update the dashboard
```

## Step 5 — seed the login (once, with a real window)

```bash
node amizone-auto.mjs --login
```

A Chrome window opens on Amizone. Log in normally and clear the Cloudflare check
yourself. Once you land on your dashboard it says *"Login captured"* and closes.
This is the only step that needs a visible window — do it from a terminal inside
your Hyprland session, not over SSH.

> **If a sync ever says Amizone served the login page**, and `strings
> .amizone-profile/Default/Cookies | grep -c amizone` returns a number
> greater than zero, the cookies are present but unreadable — that is the
> keyring/password-store mismatch. Both launches pass
> `--password-store=basic` to avoid it; changing that setting invalidates
> every previously saved cookie and requires a fresh `--login`.

## Step 6 — one real run, the way the timer will do it

```bash
chmod +x run-amizone.sh      # only if git didn't preserve the bit
./run-amizone.sh
tail -40 amizone.log
```

Nothing appears on screen — that is Xvfb doing its job. You should see your
subjects with attendance percentages and a count of class slots. Open PLAYER ONE
→ College and confirm it moved.

## Step 7 — schedule it

```bash
mkdir -p ~/.config/systemd/user
cp systemd/playerone-amizone.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now playerone-amizone.timer
loginctl enable-linger "$USER"
```

That last line is the one people forget. Without it, user services stop when you
log out of Hyprland — so the sync would only run while you were sitting at the
machine, which defeats the point of having an always-on box.

Check it:

```bash
systemctl --user list-timers playerone-amizone.timer   # next run
systemctl --user start playerone-amizone.service       # force one now
journalctl --user -u playerone-amizone -n 50           # what systemd saw
tail -f amizone.log                                     # what the script saw
```

## Step 8 — stop the laptop sleeping (the lid question)

The timer is only as reliable as the machine being awake. Three separate things
can put it to sleep, and they are controlled in three different places.

**What does NOT matter:** the screen locking, blanking, or the screensaver. The
sync runs under Xvfb on a display nobody is looking at, so `omarchy toggle idle`
and the lock timings are irrelevant to it. Let the screen do whatever it likes —
it saves power and costs nothing. Only real *suspend* stops the sync.

**Lid close.** Handled by systemd-logind, which suspends by default. Override it
with a drop-in — deliberately in `/etc`, because Omarchy updates have been known
to reset files under `~/.config/hypr`:

```bash
sudo mkdir -p /etc/systemd/logind.conf.d
sudo tee /etc/systemd/logind.conf.d/99-playerone.conf >/dev/null <<'CONF'
[Login]
HandleLidSwitch=ignore
HandleLidSwitchDocked=ignore
HandleLidSwitchExternalPower=ignore
CONF
```

**Idle suspend.** Lives in `~/.config/hypr/hypridle.conf`. Comment out or delete
the listener whose `on-timeout` runs `systemctl suspend`. Leave the lock and
screen-off listeners alone.

**The belt-and-braces.** Because hypridle.conf can be reset by an Omarchy update
and a reset would silently reintroduce sleep, mask the sleep targets outright.
On a machine whose entire job is to stay on, this is the setting that actually
expresses the intent:

```bash
sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target
```

After that, lid close and hypridle can both ask for suspend and nothing happens.
To undo it later: `sudo systemctl unmask sleep.target suspend.target
hibernate.target hybrid-sleep.target`.

Reboot, then confirm:

```bash
systemctl status suspend.target | head -3
journalctl -b -u systemd-logind | grep -i lid
```

Close the lid for a minute, open it, and check the machine never went down:

```bash
uptime
systemctl --user list-timers playerone-amizone.timer
```

If `uptime` shows no interruption and the timer's next run is still in the
future, it is set up correctly.

### Why `Persistent=true` is still on the timer

Belt and braces again. If sleep ever does slip through — a kernel update resets
something, someone unmasks a target — a missed 13:00 slot runs once on resume
instead of being skipped silently to tomorrow. Silent skipping is the failure
mode this whole rebuild exists to eliminate.

## A note on the Windows-in-Docker container

Running the old Windows setup inside `dockurr/windows` would work, and is still
the wrong choice: it needs KVM and several GB of RAM permanently, puts you back
on Task Scheduler and a GUI session inside a VM, and gains nothing — the only
thing that made the Windows laptop work was its residential IP, which Arch has
natively. Run it on the host.

One thing to watch: if the Windows container is set `restart: always`, it and a
headful Chromium will both want memory at 07:00. If the box is tight on RAM,
give the container a hard `mem_limit`, or stagger it away from the sync slots.

## If it ever stops updating

The saved Amizone session expires eventually. The script tries to log back in on
its own using the config; if that fails it writes **"needs manual login"** into
the `amizone_last_sync` heartbeat, which the College tab surfaces. Then:

```bash
cd ~/life-dashboard/automation/amizone && node amizone-auto.mjs --login
```

Don't run `--login` while a scheduled run is in flight — Chrome will not open the
same profile directory twice, and the run that loses will just fail.

## Notes

- Nothing here touches your normal browser profile. `.amizone-profile/` is
  separate and gitignored.
- `Persistent=true` on the timer means a slot missed while the machine was off
  runs once on resume instead of being skipped to the next day.
- The runner propagates the script's exit code, so a failed sync shows as failed
  in `systemctl --user status` — the Windows version swallowed it into a log
  file, which is how attendance stayed frozen for weeks with nothing visibly
  wrong.
