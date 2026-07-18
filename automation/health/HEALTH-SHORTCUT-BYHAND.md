# Build the "Sync Health" shortcut by hand (all metrics, every 15 min)

Reliable, works on any iOS (beta or not). ~15 min to build once, then it runs
itself every 15 minutes and the app shows what you're doing live (Sleeping /
Working out / Active).

Supabase (already yours):
- Table URL: `https://xroynvkzephebhcztvfo.supabase.co/rest/v1/health_metrics`
- Memory URL: `https://xroynvkzephebhcztvfo.supabase.co/rest/v1/memory`
- Headers (used on every request):
  - `apikey` = `sb_publishable_OVCd6KhOHNVYz1a9vCisbg_OsIF0uhy`
  - `Authorization` = `Bearer sb_publishable_OVCd6KhOHNVYz1a9vCisbg_OsIF0uhy`
  - `Content-Type` = `application/json`

---

## A. The metric list (build one "Find Health Samples" per row)

Two patterns:
- **SUM** = daily total: Find Health Samples → **Filter: Start Date is Today** →
  add **Calculate Statistics → Sum**. Then **Set Variable** to the key name.
- **NOW** = latest reading: Find Health Samples → **Sort by End Date, Latest,
  Limit 1** → the sample's **Value**. Then **Set Variable** to the key name.
- **AVG** = today's average: Find Health Samples → Filter Start Date is Today →
  Calculate Statistics → **Average**.

| Health type (search this in the picker) | Pattern | key |
|---|---|---|
| Sleep → hours asleep last night | special (below) | sleep_hours |
| Steps | SUM | steps |
| Walking + Running Distance (km) | SUM | distance_km |
| Cycling Distance (km) | SUM | cycling_km |
| Flights Climbed | SUM | flights |
| Active Energy (kcal) | SUM | active_energy |
| Resting Energy (kcal) | SUM | basal_energy |
| Exercise Minutes | SUM | exercise_min |
| Stand Hours | SUM | stand_hours |
| Resting Heart Rate | NOW | resting_hr |
| Walking Heart Rate Average | NOW | walking_hr |
| Heart Rate Variability | AVG | hrv |
| Heart Rate | AVG | heart_rate |
| Blood Oxygen | AVG | spo2 |
| Respiratory Rate | AVG | resp_rate |
| Wrist Temperature | NOW | wrist_temp |
| VO2 Max | NOW | vo2max |
| Weight (Body Mass) | NOW | weight |
| Body Fat Percentage | NOW | body_fat |
| Lean Body Mass | NOW | lean_mass |
| Body Mass Index | NOW | bmi |
| Dietary Water (ml) | SUM | water_ml |
| Dietary Energy (kcal) | SUM | dietary_energy |
| Mindful Minutes | SUM | mindful_min |
| Blood Glucose | NOW | blood_glucose |
| Walking Speed | AVG | walking_speed |
| Walking Step Length | AVG | step_length |

Blood Oxygen comes as 0–1; if yours does, add a **Calculate → × 100** after it so
it's a percent. Build as many rows as you care about — you can start with the top
~12 and add the rest later; the app just shows whatever you send.

**Sleep (special):** Find Health Samples → **Sleep Analysis** → Filter **Category
is "Asleep"** (and Start Date is within last 1 day) → **Calculate Statistics →
Sum → Duration** → that's seconds; add **Calculate → ÷ 3600** to get hours → Set
Variable **sleep_hours**.

---

## B. Assemble & send (daily metrics)

1. First action: **Date** (Current Date) → **Format Date**, custom `yyyy-MM-dd` →
   Set Variable **Today**.
2. Then all your Find-Health-Samples rows from section A (each ending in Set
   Variable).
3. Add a **Text** action = this JSON array, inserting each variable where the CAPS
   token is (delete rows for metrics you didn't build):
```
[
{"date":TODAY,"metric":"sleep_hours","value":SLEEP_HOURS},
{"date":TODAY,"metric":"steps","value":STEPS},
{"date":TODAY,"metric":"distance_km","value":DISTANCE_KM},
{"date":TODAY,"metric":"cycling_km","value":CYCLING_KM},
{"date":TODAY,"metric":"flights","value":FLIGHTS},
{"date":TODAY,"metric":"active_energy","value":ACTIVE_ENERGY},
{"date":TODAY,"metric":"basal_energy","value":BASAL_ENERGY},
{"date":TODAY,"metric":"exercise_min","value":EXERCISE_MIN},
{"date":TODAY,"metric":"stand_hours","value":STAND_HOURS},
{"date":TODAY,"metric":"resting_hr","value":RESTING_HR},
{"date":TODAY,"metric":"walking_hr","value":WALKING_HR},
{"date":TODAY,"metric":"hrv","value":HRV},
{"date":TODAY,"metric":"heart_rate","value":HEART_RATE},
{"date":TODAY,"metric":"spo2","value":SPO2},
{"date":TODAY,"metric":"resp_rate","value":RESP_RATE},
{"date":TODAY,"metric":"wrist_temp","value":WRIST_TEMP},
{"date":TODAY,"metric":"vo2max","value":VO2MAX},
{"date":TODAY,"metric":"weight","value":WEIGHT},
{"date":TODAY,"metric":"body_fat","value":BODY_FAT},
{"date":TODAY,"metric":"lean_mass","value":LEAN_MASS},
{"date":TODAY,"metric":"bmi","value":BMI},
{"date":TODAY,"metric":"water_ml","value":WATER_ML},
{"date":TODAY,"metric":"dietary_energy","value":DIETARY_ENERGY},
{"date":TODAY,"metric":"mindful_min","value":MINDFUL_MIN},
{"date":TODAY,"metric":"blood_glucose","value":BLOOD_GLUCOSE},
{"date":TODAY,"metric":"walking_speed","value":WALKING_SPEED},
{"date":TODAY,"metric":"step_length","value":STEP_LENGTH}
]
```
   (Tip: if a variable is empty, put a 0 — Shortcuts usually inserts nothing for a
   missing sample, which would break the JSON, so wrap each in an "If has no value
   → 0" or just default to 0 in Calculate Statistics.)
4. **Get Contents of URL** — Method **DELETE**, URL
   `https://xroynvkzephebhcztvfo.supabase.co/rest/v1/health_metrics?date=eq.` + the
   **Today** variable, Headers = apikey + Authorization.
5. **Get Contents of URL** — Method **POST**, URL
   `https://xroynvkzephebhcztvfo.supabase.co/rest/v1/health_metrics`, Headers =
   apikey + Authorization + Content-Type, Request Body = the **Text** from step 3.

---

## C. The "live status" block (so the app knows you're sleeping / working out)

Right after the above, add:
1. **Find Health Samples → Heart Rate**, Latest, Limit 1 → Value → Set Variable **HRNOW**.
2. **Find Health Samples → Steps**, Filter Start Date is in the **last 1 hour** →
   Calculate Statistics → Sum → Set Variable **STEPSHOUR**.
3. Sleeping check: **Find Health Samples → Sleep Analysis**, Latest, Limit 1. Add
   an **If**: *if its Category contains "Asleep" and its End Date is within the last
   20 minutes* → Set Variable **ASLEEP** = true, **Otherwise** = false.
4. **Text** action:
```
[{"key":"health_live","value":{"at":"NOW_ISO","hr":HRNOW,"steps_hour":STEPSHOUR,"asleep":ASLEEP}}]
```
   where NOW_ISO = a **Format Date** of current date as `yyyy-MM-dd'T'HH:mm:ss`.
5. **Get Contents of URL** — POST to
   `https://xroynvkzephebhcztvfo.supabase.co/rest/v1/memory`, Headers = apikey +
   Authorization + Content-Type + a header `Prefer` = `resolution=merge-duplicates`,
   Body = that Text.

The app reads `health_live` and shows: 😴 Sleeping · 🏋 Working out · 🚶 Active ·
⚡ Awake, with your live heart rate. (Working out is inferred when heart rate is
high; sleeping from the asleep flag.)

---

## D. Run every 15 minutes
iOS time automations don't have a native "every 15 min," so make **four**
automations (Automation tab → + → Time of Day), one each at **:00, :15, :30, :45**,
each set to **Run "Sync Health"** with **Ask Before Running OFF**. That's your
15-minute live sync. (Battery cost is tiny — it's a few Health reads + two small
web requests.)

Test by tapping the shortcut once; the app's Health tab + the live chip on HOME
should update within a minute.
