> **Superseded — the Windows laptop was reformatted to Omarchy on 25 Aug 2026.**
> Use **[SETUP-ARCH.md](SETUP-ARCH.md)** instead. Kept for reference only.
>
> Two things in here are now WRONG and were wrong on Windows too:
> - It says to fill in `amizone.config.json`. That file is **tracked by git**.
>   Fill in `amizone.config.local.json` — the gitignored name the script now
>   prefers — or your service_role key rides along with your next commit.
> - Step 3's `npx playwright install chromium` is unnecessary once Chrome is
>   installed from a package manager.

# Amizone auto-sync — Windows setup (one time, ~10 min)

After this, your laptop scrapes Amizone on its own several times a day and pushes
attendance + timetable straight to PLAYER ONE. Lid closed, no buttons, no Claude
session needed. You just open the app and it's current.

## What you need
- The laptop stays **on** (you already set it to never sleep — perfect). Lid can be closed.
- Chrome installed (you have it).
- Node.js 18+ — if `node -v` in a terminal errors, install from https://nodejs.org (LTS).

## Step 1 — put the folder on the laptop
Copy the whole `automation/amizone` folder somewhere permanent, e.g.
`C:\PlayerOne\amizone`. (If you cloned the repo on the laptop, it's already at
`life-dashboard\automation\amizone`.)

## Step 2 — fill in the config

Open `amizone.config.json` and fill in all four values:

```json
{
  "amizoneUser": "your enrolment number",
  "amizonePass": "your Amizone password",
  "supabaseUrl": "https://xroynvkzephebhcztvfo.supabase.co",
  "supabaseServiceKey": "<Supabase → Project Settings → API → service_role>",
  "syncTimetable": true
}
```

**The service_role key, not the publishable one.** This changed on 15 August, when
row-level security was switched on. The publishable key stopped being able to
write anything, and because this script logs its failures into `amizone.log` on
this laptop, the dashboard simply carried on showing the last attendance that got
through — no error anywhere a person would see it. If your data froze on a date,
this is why.

That key bypasses row-level security on every table, so this file stays on this
laptop and is never committed. The copy in the repo is a template of placeholders.

`syncTimetable: true` also pulls the live timetable. It is off by default because
Amizone's diary is a per-day feed, so a weekly view rebuilt from it unions both
batches, makeups and extra classes into a noisy superset — the dashboard keeps a
hand-verified weekly timetable instead. Turn it on if you would rather have the
live one with that noise.

## Step 2b — prove it can write, before anything else

```powershell
node amizone-auto.mjs --check
```

Two seconds, no browser, no Amizone. It reads and then writes, and tells you which
of the two failed. Worth doing first because the real sync takes two minutes and
fails at the very END — after the scraping, at the write — so a broken key looks
like a broken scraper.

```
read   : OK
write  : OK — this laptop can update the dashboard
```

If the write fails with a 401, it prints exactly which key to change and where.

## Step 3 — install the browser driver (once)
Open **PowerShell** in that folder and run:
```powershell
npm install playwright
npx playwright install chromium
```

## Step 4 — seed the login (once)
```powershell
node amizone-auto.mjs --login
```
A Chrome window opens on Amizone. Log in normally (do the Cloudflare check if it
asks). Once you land on your dashboard, the script says *"Login captured"* and
closes. Your session is now saved in a `.amizone-profile` folder — future runs
reuse it with **no login and no Cloudflare**.

## Step 5 — test one real run
```powershell
node amizone-auto.mjs
```
It should print your subjects with attendance % and the number of class slots.
Open PLAYER ONE → College and confirm it updated. (Output is also logged to
`amizone.log` in the folder.)

## Step 6 — schedule it (the "no buttons ever again" part)
Paste this into the same PowerShell window (adjust the folder path if you didn't
use `C:\PlayerOne\amizone`). It runs at 7:00 AM and then every 3 hours until
10 PM — so an added/removed class shows up within a few hours:
```powershell
$bat = "C:\PlayerOne\amizone\run-amizone.bat"
schtasks /Create /TN "PlayerOne-Amizone" /TR "$bat" /SC DAILY /ST 07:00 /RI 180 /DU 15:00 /F /RL LIMITED
```
That's it. To check it later:
```powershell
schtasks /Query /TN "PlayerOne-Amizone"      # see it / next run
schtasks /Run   /TN "PlayerOne-Amizone"      # force a run right now
schtasks /Delete /TN "PlayerOne-Amizone" /F  # remove it
```

## If it ever stops updating
The Amizone session cookie can expire after a while. The script tries to log back
in on its own using your config. If that fails, it flags **"needs manual login"**
in the app — just run `node amizone-auto.mjs --login` once more and it's hands-off
again. You can see the last sync status/time in Config → the `amizone_last_sync`
heartbeat.

## Notes
- Keep the window logic simple: it scrapes a ±window of diary events and rebuilds
  the weekly timetable each run, so classes added or dropped are reflected.
- Nothing here touches your main Chrome profile — it uses a separate
  `.amizone-profile` folder so your normal browsing is untouched.
