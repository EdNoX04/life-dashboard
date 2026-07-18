# Health sync — iOS Shortcut (full history + auto every 30 min)

Replaces the flaky Health Auto Export app. Two shortcuts:
1. **Sync Health History** — run ONCE. Backfills ~1 year of every metric.
2. **Sync Health** — runs automatically every 30 min for today's numbers.

On iOS 26/27 beta you can paste the prompts below into "create a shortcut" and it
builds them for you.

Supabase (baked in, safe to include):
- URL: `https://xroynvkzephebhcztvfo.supabase.co/rest/v1/health_metrics`
- key (apikey + `Bearer` Authorization): `sb_publishable_OVCd6KhOHNVYz1a9vCisbg_OsIF0uhy`

Metrics + the exact `metric` names the app expects:
sleep_hours, steps, resting_hr, hrv, heart_rate, active_energy, exercise_min,
spo2, resp_rate, distance_km, vo2max, weight.

---

## Prompt 1 — "Sync Health History" (run once)
```
Create a shortcut named "Sync Health History" that backfills my Apple Health data to my database.

1. Make an empty list called Rows.
2. Repeat with each number X from 0 to 364:
   - Set Day = today's date minus X days, formatted as yyyy-MM-dd (use the start and end of that calendar day when querying Health).
   - Read that day's Apple Health values: hours asleep that night (sleep_hours), total steps (steps), average resting heart rate (resting_hr), average heart rate variability SDNN (hrv), average heart rate (heart_rate), total active energy in kcal (active_energy), total exercise minutes (exercise_min), average blood oxygen percent (spo2), average respiratory rate (resp_rate), total walking+running distance in km (distance_km), latest VO2 max (vo2max), latest body weight in kg (weight).
   - For each of those metrics that HAS a value for that day, add an object to Rows: {"date": Day, "metric": "<the metric name>", "value": <number>}. Skip metrics with no sample.
3. After the loop, make a JSON array text from all of Rows.
4. Send a DELETE request to https://xroynvkzephebhcztvfo.supabase.co/rest/v1/health_metrics?date=gte.2000-01-01 with headers apikey and Authorization set to "Bearer sb_publishable_OVCd6KhOHNVYz1a9vCisbg_OsIF0uhy" (apikey is the raw key without Bearer).
5. Send a POST request to https://xroynvkzephebhcztvfo.supabase.co/rest/v1/health_metrics with the same apikey and Authorization headers, plus Content-Type application/json, and the JSON array as the request body.
6. Show a notification "History synced ✓".
```
Run it once (it may take a few minutes — it's reading a year of data). Change 364
to 729 for two years.

---

## Prompt 2 — "Sync Health" (the every-30-min one)
```
Create a shortcut named "Sync Health" that syncs today's Apple Health data to my database.

1. Set Today = current date formatted yyyy-MM-dd.
2. Read today's Apple Health values (use today's start-to-now; sums for totals): hours asleep last night (sleep_hours), total steps (steps), average resting heart rate (resting_hr), average heart rate variability SDNN (hrv), average heart rate (heart_rate), total active energy kcal (active_energy), total exercise minutes (exercise_min), average blood oxygen percent (spo2), average respiratory rate (resp_rate), total distance km (distance_km), latest VO2 max (vo2max), latest body weight kg (weight). Use 0 for any with no sample.
3. Build a JSON array with one object per metric: {"date": Today, "metric": "<name>", "value": <number>}, using the metric names in parentheses above.
4. Send a DELETE request to https://xroynvkzephebhcztvfo.supabase.co/rest/v1/health_metrics?date=eq.[Today] with headers apikey = sb_publishable_OVCd6KhOHNVYz1a9vCisbg_OsIF0uhy and Authorization = Bearer sb_publishable_OVCd6KhOHNVYz1a9vCisbg_OsIF0uhy.
5. Send a POST request to https://xroynvkzephebhcztvfo.supabase.co/rest/v1/health_metrics with the same two headers plus Content-Type application/json and the JSON array as the body.
6. Show a brief "Health synced ✓" notification (or none).
```

---

## Make it automatic
Shortcuts → **Automation** → **+** → **Time of Day** → set a start time, **Repeat
Hourly** (and every 30 min if your beta shows the option) → **Run "Sync Health"**
→ **Ask Before Running: OFF**. If it only repeats hourly, make two automations at
:00 and :30. Leave "Sync Health History" as manual — you only need it once.

The app polls Supabase every 45s, so new numbers show within a minute of a run.
Sleep only updates after your watch processes the night; the frequent runs just
keep everything ≤30 min fresh.
