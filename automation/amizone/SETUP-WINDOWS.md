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

## Step 2 — fill in your login
Open `amizone.config.json` and replace the two placeholder values with your real
Amizone username and password. (This file stays on your laptop only — the script
uses it to log into Amizone and nowhere else.)

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
