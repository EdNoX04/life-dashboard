// Life HQ — data relay edge function (v2, chunked).
// Cowork's container can only make plain GETs with a ~150-char query budget,
// so large payloads arrive as ordered chunks that this function assembles.
//
// Modes (all GET, all require ?s=<RELAY_SECRET>):
//   ?s=…                                  → health check
//   ?s=…&echo=1&<params>                  → returns received param names+lengths (diagnostics)
//   ?s=…&p=<payload>                      → direct: payload = urlencoded JSON or base64url JSON
//   ?s=…&sid=<id>&i=<k>&n=<N>&c=<chunk>   → chunked: chunk k of N (1-based) of base64url JSON.
//                                           On the final missing piece, assembles + executes.
// Ops format: {"ops":[{"table","method":"upsert|insert|update|delete",
//              "rows":[...]|"row":{...},"match":"id=eq.X"}]}
// Chunks are parked in the `memory` table (key: relay_chunk_<sid>_<k>) and
// cleaned up after execution. Stale chunks are ignored/overwritten by sid.
// Deploy with "Verify JWT" DISABLED; protected by RELAY_SECRET instead.

const enc = { "content-type": "application/json" };
const json = (obj: unknown, status = 200) => new Response(JSON.stringify(obj), { status, headers: enc });

function b64urlDecode(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return atob(b64);
}

function parsePayload(p: string): { ops: Op[] } {
  try { return JSON.parse(p); } catch (_) { /* not plain JSON */ }
  return JSON.parse(b64urlDecode(p));
}

type Op = { table: string; method: string; rows?: unknown[]; row?: unknown; match?: string };

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const secret = url.searchParams.get("s");
  if (!secret || secret !== Deno.env.get("RELAY_SECRET")) return json({ error: "forbidden" }, 403);

  const SUPA = Deno.env.get("SUPABASE_URL")!;
  const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const H: Record<string, string> = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

  const rest = (path: string, init?: RequestInit) => fetch(`${SUPA}/rest/v1/${path}`, init);

  async function execute(ops: Op[]) {
    const results: unknown[] = [];
    for (const op of ops) {
      const q = `${op.table}${op.match ? "?" + op.match : ""}`;
      try {
        let r: Response;
        if (op.method === "upsert")
          r = await rest(op.table, { method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates" }, body: JSON.stringify(op.rows) });
        else if (op.method === "insert")
          r = await rest(op.table, { method: "POST", headers: H, body: JSON.stringify(op.rows) });
        else if (op.method === "update")
          r = await rest(q, { method: "PATCH", headers: H, body: JSON.stringify(op.row) });
        else if (op.method === "delete")
          r = await rest(q, { method: "DELETE", headers: H });
        else { results.push({ table: op.table, ok: false, err: "unknown method" }); continue; }
        results.push({ table: op.table, method: op.method, ok: r.ok, status: r.status, detail: r.ok ? undefined : (await r.text()).slice(0, 300) });
      } catch (e) {
        results.push({ table: op.table, method: op.method, ok: false, err: String(e) });
      }
    }
    return results;
  }

  // diagnostics
  if (url.searchParams.get("echo")) {
    const seen: Record<string, number> = {};
    url.searchParams.forEach((v, k) => { if (k !== "s") seen[k] = v.length; });
    return json({ ok: true, echo: seen });
  }

  // direct mode
  const p = url.searchParams.get("p");
  if (p) {
    try {
      const { ops = [] } = parsePayload(p);
      const results = await execute(ops);
      return json({ ok: (results as any[]).every(x => x.ok), results });
    } catch (e) {
      return json({ error: "bad payload: " + String(e) }, 400);
    }
  }

  // chunked mode
  const sid = url.searchParams.get("sid");
  const i = Number(url.searchParams.get("i") || 0);
  const n = Number(url.searchParams.get("n") || 0);
  const c = url.searchParams.get("c");
  if (sid && i >= 1 && n >= 1 && c != null) {
    // park this chunk
    await rest("memory", {
      method: "POST",
      headers: { ...H, Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify([{ key: `relay_chunk_${sid}_${i}`, value: { c }, updated_at: new Date().toISOString() }]),
    });
    // do we have all n?
    const have = await (await rest(`memory?key=like.relay_chunk_${sid}_*&select=key,value`, { headers: H })).json();
    if (!Array.isArray(have) || have.length < n) return json({ ok: true, sid, got: i, have: Array.isArray(have) ? have.length : 0, need: n });

    // assemble in order
    const byIdx = new Map<number, string>();
    for (const row of have) {
      const m = String(row.key).match(/_(\d+)$/);
      if (m) byIdx.set(Number(m[1]), row.value?.c ?? "");
    }
    let joined = "";
    for (let k = 1; k <= n; k++) {
      if (!byIdx.has(k)) return json({ ok: true, sid, waiting_for: k, need: n });
      joined += byIdx.get(k);
    }
    // cleanup + execute
    await rest(`memory?key=like.relay_chunk_${sid}_*`, { method: "DELETE", headers: H });
    try {
      const { ops = [] } = parsePayload(joined);
      const results = await execute(ops);
      return json({ ok: (results as any[]).every(x => x.ok), assembled: n, results });
    } catch (e) {
      return json({ error: "bad assembled payload: " + String(e) }, 400);
    }
  }

  return json({ ok: true, msg: "relay v2 alive, no payload" });
});
