// Life HQ — data relay edge function.
// Lets Cowork (whose container can only make plain GET fetches) write to the
// database. Accepts GET with ?s=<secret>&p=<base64url-encoded {"ops":[...]}>.
// Same ops format as scripts/apply-payloads.mjs:
//   { "ops": [
//     { "table":"briefs","method":"upsert","rows":[{...}] },
//     { "table":"requests","method":"update","match":"id=eq.X","row":{...} },
//     { "table":"news","method":"delete","match":"published_at=lt.2026-07-10" }
//   ]}
// Deploy with "Verify JWT" DISABLED; protected by RELAY_SECRET instead.

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const json = (obj: unknown, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

  const secret = url.searchParams.get("s");
  if (!secret || secret !== Deno.env.get("RELAY_SECRET")) return json({ error: "forbidden" }, 403);

  const p = url.searchParams.get("p");
  if (!p) return json({ ok: true, msg: "relay alive, no payload" });

  let ops: Array<{ table: string; method: string; rows?: unknown[]; row?: unknown; match?: string }>;
  try {
    const b64 = p.replace(/-/g, "+").replace(/_/g, "/");
    ops = JSON.parse(atob(b64)).ops ?? [];
  } catch (e) {
    return json({ error: "bad payload: " + String(e) }, 400);
  }

  const SUPA = Deno.env.get("SUPABASE_URL")!;
  const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const H: Record<string, string> = {
    apikey: KEY,
    Authorization: `Bearer ${KEY}`,
    "Content-Type": "application/json",
  };

  const results: unknown[] = [];
  for (const op of ops) {
    const base = `${SUPA}/rest/v1/${op.table}${op.match ? "?" + op.match : ""}`;
    try {
      let r: Response;
      if (op.method === "upsert")
        r = await fetch(`${SUPA}/rest/v1/${op.table}`, { method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates" }, body: JSON.stringify(op.rows) });
      else if (op.method === "insert")
        r = await fetch(`${SUPA}/rest/v1/${op.table}`, { method: "POST", headers: H, body: JSON.stringify(op.rows) });
      else if (op.method === "update")
        r = await fetch(base, { method: "PATCH", headers: H, body: JSON.stringify(op.row) });
      else if (op.method === "delete")
        r = await fetch(base, { method: "DELETE", headers: H });
      else { results.push({ table: op.table, ok: false, err: "unknown method" }); continue; }
      results.push({ table: op.table, method: op.method, ok: r.ok, status: r.status, detail: r.ok ? undefined : await r.text() });
    } catch (e) {
      results.push({ table: op.table, method: op.method, ok: false, err: String(e) });
    }
  }
  return json({ ok: results.every((x: any) => x.ok), results });
});
