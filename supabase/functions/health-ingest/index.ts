// Player One — Apple Health ingest endpoint.
// Receives the "Health Auto Export" iOS app's REST-API JSON and writes it into
// Supabase (health_metrics + workouts). Point HAE's REST automation at:
//   https://<project>.functions.supabase.co/health-ingest?s=<HEALTH_SECRET>
// Deploy with "Verify JWT" DISABLED; protected by HEALTH_SECRET.
//
// HAE payload shape (POST body):
// { "data": {
//     "metrics": [ { "name":"step_count","units":"count","data":[{"date":"2026-07-14 00:00:00 +0530","qty":8421}] },
//                  { "name":"heart_rate","units":"bpm","data":[{"date":"...","Min":52,"Avg":68,"Max":141}] },
//                  { "name":"sleep_analysis","units":"hr","data":[{"date":"...","asleep":7.1,"inBed":7.7,"deep":1.1,"rem":1.4,"core":4.6}] } ],
//     "workouts": [ { "name":"Running","start":"...","end":"...","duration":1830,"activeEnergy":{"qty":260},"distance":{"qty":4.8} } ]
// } }

const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });

// metric name -> {label, pick} where pick extracts the day value from a HAE data point
const METRICS: Record<string, { key: string; unit: string; pick: (d: any) => number | null; note?: (d: any) => string | undefined }> = {
  step_count:               { key: "steps",         unit: "count", pick: d => num(d.qty) },
  heart_rate:               { key: "heart_rate",    unit: "bpm",   pick: d => num(d.Avg ?? d.avg ?? d.qty), note: d => `min ${Math.round(num(d.Min) ?? 0)} / max ${Math.round(num(d.Max) ?? 0)}` },
  resting_heart_rate:       { key: "resting_hr",    unit: "bpm",   pick: d => num(d.Avg ?? d.qty) },
  heart_rate_variability:   { key: "hrv",           unit: "ms",    pick: d => num(d.Avg ?? d.qty) },
  walking_heart_rate_average:{ key: "walking_hr",   unit: "bpm",   pick: d => num(d.Avg ?? d.qty) },
  active_energy:            { key: "active_energy", unit: "kcal",  pick: d => num(d.qty) },
  apple_exercise_time:      { key: "exercise_min",  unit: "min",   pick: d => num(d.qty) },
  sleep_analysis:           { key: "sleep_hours",   unit: "hr",    pick: d => num(d.asleep ?? d.totalSleep ?? d.inBed), note: d => `deep ${fmt(d.deep)} · rem ${fmt(d.rem)} · core ${fmt(d.core)}` },
  respiratory_rate:         { key: "resp_rate",     unit: "bpm",   pick: d => num(d.Avg ?? d.qty) },
  blood_oxygen_saturation:  { key: "spo2",          unit: "%",     pick: d => num(d.Avg ?? d.qty) },
  vo2_max:                  { key: "vo2max",        unit: "ml",    pick: d => num(d.qty) },
  weight_body_mass:         { key: "weight",        unit: "kg",    pick: d => num(d.qty) },
  walking_running_distance: { key: "distance_km",   unit: "km",    pick: d => num(d.qty) },
};

const num = (v: any): number | null => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) / 100 : null; };
const fmt = (v: any) => { const n = num(v); return n == null ? "–" : n + "h"; };
const dayOf = (s: string): string => { const m = String(s).match(/(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[1]}-${m[2]}-${m[3]}` : new Date().toISOString().slice(0, 10); };

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (url.searchParams.get("s") !== Deno.env.get("HEALTH_SECRET")) return json({ error: "forbidden" }, 403);

  const SUPA = Deno.env.get("SUPABASE_URL")!;
  const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
  const rest = (p: string, init?: RequestInit) => fetch(`${SUPA}/rest/v1/${p}`, { ...init, headers: { ...H, ...(init?.headers || {}) } });

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  const data = body?.data ?? body;
  const metrics = data?.metrics ?? [];
  const workouts = data?.workouts ?? [];

  const results: Record<string, number> = { metrics: 0, workouts: 0 };

  // metrics → health_metrics (one row per day+metric; replace on re-ingest)
  for (const m of metrics) {
    const spec = METRICS[m?.name];
    if (!spec || !Array.isArray(m.data)) continue;
    for (const d of m.data) {
      const val = spec.pick(d);
      if (val == null) continue;
      const date = dayOf(d.date ?? d.startDate ?? "");
      try {
        await rest(`health_metrics?date=eq.${date}&metric=eq.${spec.key}`, { method: "DELETE" });
        await rest("health_metrics", { method: "POST", headers: { Prefer: "return=minimal" },
          body: JSON.stringify([{ date, metric: spec.key, value: String(val), unit: spec.unit, note: spec.note?.(d), source: "apple_health" }]) });
        results.metrics++;
      } catch (_) { /* skip one */ }
    }
  }

  // workouts → workouts table (dedupe by date+title+duration)
  for (const w of workouts) {
    const date = dayOf(w?.start ?? w?.startDate ?? "");
    const title = w?.name ?? w?.workoutActivityType ?? "Workout";
    const dur = Math.round(num(w?.duration) ?? 0);
    const durMin = dur > 1000 ? Math.round(dur / 60) : dur; // HAE gives seconds
    try {
      const existing = await (await rest(`workouts?date=eq.${date}&title=eq.${encodeURIComponent(title)}&select=id&limit=1`)).json();
      if (Array.isArray(existing) && existing.length) continue;
      await rest("workouts", { method: "POST", headers: { Prefer: "return=minimal" },
        body: JSON.stringify([{ date, title, duration_min: durMin || null,
          volume_kg: num(w?.activeEnergy?.qty ?? w?.totalEnergy?.qty) , exercises: [], source: "apple_health" }]) });
      results.workouts++;
    } catch (_) { /* skip */ }
  }

  // heartbeat
  await rest("memory", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify([{ key: "health_last_sync", value: { at: new Date().toISOString(), ...results }, updated_at: new Date().toISOString() }]) });

  return json({ ok: true, ...results });
});
