# Health sync — by hand

**These instructions are out of date and no longer work.**

They tell you to POST directly to Supabase with the publishable key. Since
row-level security was switched on, that key writes nothing: every request is
rejected with a 401, and the dashboard keeps showing whatever last got through —
which is how a fortnight of health data went missing without a single error
anywhere a person would see it.

The phone now posts to `/api/health` with a scoped token instead, so the
credential on the device can append health rows and nothing else.

See **HEALTH-SYNC-SHORTCUT.md** in this folder. Kept as one file rather than two,
because two sets of instructions for the same job drift, and the stale one is
always the one someone follows.
