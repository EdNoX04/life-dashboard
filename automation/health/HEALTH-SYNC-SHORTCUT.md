# Health sync — iOS Shortcut

Two shortcuts:

1. **Sync Health History** — run ONCE. Backfills ~1 year of every metric.
2. **Sync Health** — runs automatically every 30 min for today's numbers.

## What changed, and why

These shortcuts used to POST straight to Supabase with the publishable key. Since
row-level security was switched on, that key writes nothing — every sync since has
been rejected with a 401, silently, while the dashboard kept showing the last
numbers that got through.

The obvious fix is to paste the *service* key into the Shortcut instead. That key
bypasses RLS on every table — money, journal, health, read and write and delete —
and a Shortcut lives on a phone you carry and syncs through iCloud. That is a
great deal of authority for a step count.

So the service key stays on the server. The phone posts to **`/api/health`** with a
token that buys exactly one capability: appending health rows. It cannot name a
table, choose a column, or reach anything else, because none of those are things
it sends.

## Setup (once)

On Vercel → Settings → Environment Variables, add:

| Name | Value |
|---|---|
| `HEALTH_TOKEN` | a long random string you invent — 32+ characters |

`SUPABASE_URL` and `SUPABASE_SERVICE_KEY` are already there for the chat proxy.
Redeploy after adding it: environment variables only apply to builds that happen
afterwards.

## What the shortcuts send

- **URL:** `https://life-dashboard-mu-green.vercel.app/api/health`
- **Method:** POST
- **Headers:** `x-health-token: <your HEALTH_TOKEN>` and `Content-Type: application/json`
- **Body:** a JSON array of `{"date":"YYYY-MM-DD","metric":"steps","value":8421}`

Metric names, exactly:
`sleep_hours, steps, resting_hr, hrv, heart_rate, active_energy, exercise_min,
spo2, resp_rate, distance_km, vo2max, weight`

**No DELETE step any more.** The endpoint clears the days it is about to write and
only those days — which is what stops the half-hourly job from being able to wipe
last year on its way in. The old shortcuts sent a DELETE covering everything since
the year 2000; that step must be removed.

---

## Prompt 1 — "Sync Health History" (run once)

```
Create a shortcut named "Sync Health History" that backfills my Apple Health data.

1. Make an empty list called Rows.
2. Repeat with each number X from 0 to 364:
   - Set Day = today's date minus X days, formatted as yyyy-MM-dd (use the start and end of that calendar day when querying Health).
   - Read that day's Apple Health values: hours asleep that night (sleep_hours), total steps (steps), average resting heart rate (resting_hr), average heart rate variability SDNN (hrv), average heart rate (heart_rate), total active energy in kcal (active_energy), total exercise minutes (exercise_min), average blood oxygen percent (spo2), average respiratory rate (resp_rate), total walking+running distance in km (distance_km), latest VO2 max (vo2max), latest body weight in kg (weight).
   - For each of those metrics that HAS a value for that day, add an object to Rows: {"date": Day, "metric": "<the metric name>", "value": <number>}. Skip metrics with no sample.
3. After the loop, make a JSON array text from all of Rows.
4. Send a POST request to https://life-dashboard-mu-green.vercel.app/api/health with headers "x-health-token" set to MY_TOKEN and "Content-Type" set to application/json, and the JSON array as the request body.
5. Show the response so I can see how many rows were written.
```

## Prompt 2 — "Sync Health" (automatic, every 30 min)

```
Create a shortcut named "Sync Health" that sends today's Apple Health numbers to my dashboard.

1. Set Day = today's date formatted as yyyy-MM-dd.
2. Read today's Apple Health values for: sleep_hours, steps, resting_hr, hrv, heart_rate, active_energy, exercise_min, spo2, resp_rate, distance_km, vo2max, weight.
3. Build a JSON array containing one object per metric that has a value: {"date": Day, "metric": "<name>", "value": <number>}. Skip metrics with no sample.
4. Send a POST request to https://life-dashboard-mu-green.vercel.app/api/health with headers "x-health-token" set to MY_TOKEN and "Content-Type" set to application/json, and the JSON array as the body.
```

Then: Shortcuts → Automation → new personal automation → Time of Day → repeat
every 30 minutes → run "Sync Health", and turn OFF "Ask Before Running".

## Reading the response

```json
{ "written": 11, "days": 1, "rejected": 0, "why": [] }
```

`rejected` is the number that matters. A shortcut quietly dropping nine rows in
ten looks exactly like one that is working, so the endpoint returns why each row
was refused rather than accepting it and hoping. Common ones:

- **unknown metric "step"** — the name must match the list above exactly.
- **weight 71400 outside 20–400** — grams instead of kilograms. A technically
  valid number that would quietly ruin every average it landed in.
- **date is in the future** — a timezone bug on the phone, not a reading.
- **duplicate for that day** — normal, and harmless. The half-hourly run re-sends
  today; only the first of each metric is kept.

A `401` means the token header is missing or wrong. A `503` means `HEALTH_TOKEN`
was never set on Vercel, or the deploy that would pick it up has not happened yet.
