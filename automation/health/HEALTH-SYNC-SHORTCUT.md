# Health sync — the reliable way (iOS Shortcut, no third-party app)

The "Health Auto Export" app is flaky (manual refresh, half the time it fails,
skips sleep). This replaces it with an **iOS Shortcut automation** that reads
Apple Health directly and posts to your dashboard on a schedule. No app to babysit,
it logs sleep, and it runs itself.

## Why this is better
- Runs on a **Personal Automation** (e.g. every morning at 7am, or when you plug
  in overnight) — no button, ever.
- Reads straight from Apple Health, including **Sleep**, HRV, resting HR, steps,
  active energy, exercise minutes, weight.
- Writes one clean batch to Supabase; it clears the day first so re-runs never
  duplicate.

## Build it once (Shortcuts app → + → New Shortcut → name it "Sync Health")

Add these actions in order. (Search the action name in the bottom search bar.)

**1. Date → today's key**
- Action **Date** (Current Date) → then **Format Date**: Custom, format `yyyy-MM-dd`.
  Call the result **Today** (rename the variable).

**2. Pull each Health metric** — for each one add **Find Health Samples**, set the
type, sort by **End Date**, **Latest**, Limit **1**, then **Calculate Statistics**
(or just take the sample's **Value**). Grab these (skip any you don't track):
- Sleep Analysis → hours asleep → variable **Sleep**
- Steps (today, Sum) → **Steps**
- Resting Heart Rate → **RHR**
- Heart Rate Variability (SDNN) → **HRV**
- Active Energy (today, Sum) → **Kcal**
- Exercise Minutes (today, Sum) → **ExMin**
- Body Mass → **Weight**

Tip: for daily totals (Steps, Active Energy, Exercise) use **Find Health Samples**
where **Start Date is Today**, then **Calculate Statistics → Sum**.

**3. Build the JSON body** — add a **Text** action and paste this, replacing the
CAPS tokens by inserting the matching variables from step 2:
```
[
{"date":"TODAY","metric":"sleep_hours","value":SLEEP},
{"date":"TODAY","metric":"steps","value":STEPS},
{"date":"TODAY","metric":"resting_hr","value":RHR},
{"date":"TODAY","metric":"hrv","value":HRV},
{"date":"TODAY","metric":"active_energy","value":KCAL},
{"date":"TODAY","metric":"exercise_min","value":EXMIN},
{"date":"TODAY","metric":"weight","value":WEIGHT}
]
```

**4. Clear today's rows first (so re-runs don't pile up)** — add **Get Contents of URL**:
- URL: `https://xroynvkzephebhcztvfo.supabase.co/rest/v1/health_metrics?date=eq.` then insert the **Today** variable at the end.
- Method: **DELETE**
- Headers:
  - `apikey` = `sb_publishable_OVCd6KhOHNVYz1a9vCisbg_OsIF0uhy`
  - `Authorization` = `Bearer sb_publishable_OVCd6KhOHNVYz1a9vCisbg_OsIF0uhy`

**5. Post the new rows** — add another **Get Contents of URL**:
- URL: `https://xroynvkzephebhcztvfo.supabase.co/rest/v1/health_metrics`
- Method: **POST**
- Headers: same two as above, plus `Content-Type` = `application/json`
- Request Body: **File** → select the **Text** from step 3 (or set body type to
  raw and pick the Text variable).

**6. (optional) a tiny "Synced ✓" notification** so you know it ran.

Test it: tap the shortcut once. Open the app → Health; today's numbers should
appear within ~a minute (the app polls every 45s).

## Make it automatic (the whole point)
Shortcuts app → **Automation** tab → **+** → **Personal Automation** →
**Time of Day** → 7:00 AM, Daily → action **Run Shortcut → Sync Health** →
turn **Ask Before Running OFF** (iOS runs it silently). Done — health syncs every
morning on its own. (You can add a second automation "When iPhone charger connects"
in the morning window for extra reliability.)

## If a metric reads blank
That metric just has no sample for today (e.g. sleep before you've synced your
watch). It fills in on the next run. Sleep specifically logs after your watch/phone
processes the night — the 7am run catches it.
