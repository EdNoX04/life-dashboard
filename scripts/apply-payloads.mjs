// Applies payload files to Supabase. Runs inside GitHub Actions (full network),
// using the service_role key from repo secrets. This is the write-relay for
// Cowork, whose own container can only reach the GitHub API.
//
// Payload format (payloads/*.json):
// { "ops": [
//     { "table": "briefs", "method": "upsert", "rows": [ {...} ] },
//     { "table": "news",   "method": "insert", "rows": [ {...} ] },
//     { "table": "requests", "method": "update", "match": "id=eq.XXX", "row": { "status": "done" } },
//     { "table": "news",   "method": "delete", "match": "published_at=lt.2026-07-10" }
// ] }

import { readdirSync, readFileSync } from 'fs';
import path from 'path';

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
if (!URL || !KEY) { console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }

const H = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
};

async function call(method, table, { match = '', body, prefer } = {}) {
  const url = `${URL.replace(/\/$/, '')}/rest/v1/${table}${match ? '?' + match : ''}`;
  const r = await fetch(url, {
    method,
    headers: { ...H, ...(prefer ? { Prefer: prefer } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${method} ${table}: ${r.status} ${await r.text()}`);
  return r;
}

const dir = 'payloads';
const files = readdirSync(dir).filter(f => f.endsWith('.json'));
if (!files.length) { console.log('No payloads.'); process.exit(0); }

for (const f of files.sort()) {
  const parsed = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
  // A payload whose shape this script does not understand used to destructure
  // to `ops = []`, print "0 ops", write nothing and still get filed as
  // processed. That is how the scanned investments file — a bare array rather
  // than an {ops:[...]} envelope — was silently discarded, which is why the
  // Indian holding never appeared on the India desk. A file we cannot apply is
  // a failure, not an empty success.
  if (!Array.isArray(parsed?.ops)) {
    console.error(`  FAIL: ${f} has no "ops" array — expected {"ops":[{table,method,rows}]}. Not applied.`);
    process.exitCode = 1;
    continue;
  }
  const ops = parsed.ops;
  if (ops.length === 0) {
    console.error(`  FAIL: ${f} declares an empty ops array. Nothing to apply — remove the file or fill it in.`);
    process.exitCode = 1;
    continue;
  }
  console.log(`Applying ${f} (${ops.length} ops)`);
  for (const op of ops) {
    const { table, method, rows, row, match } = op;
    try {
      if (method === 'upsert') await call('POST', table, { body: rows, prefer: 'resolution=merge-duplicates' });
      else if (method === 'insert') await call('POST', table, { body: rows });
      else if (method === 'update') await call('PATCH', table, { match, body: row });
      else if (method === 'delete') await call('DELETE', table, { match });
      else throw new Error(`unknown method ${method}`);
      console.log(`  ok: ${method} ${table} ${match || ''} (${rows?.length ?? 1})`);
    } catch (e) {
      console.error(`  FAIL: ${e.message}`);
      process.exitCode = 1;
    }
  }
}
