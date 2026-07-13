// ---- Life HQ data layer ----
// Works in two modes:
//  - LOCAL  : localStorage (zero setup, works day one)
//  - REMOTE : Supabase via PostgREST fetch (no client lib needed)
// Cowork (the AI brain) writes to the same Supabase tables from the cloud.

const cfgKey = 'ldx_config';

export function getConfig() {
  try { return JSON.parse(localStorage.getItem(cfgKey)) || {}; } catch { return {}; }
}
export function setConfig(patch) {
  const next = { ...getConfig(), ...patch };
  localStorage.setItem(cfgKey, JSON.stringify(next));
  return next;
}
export function isRemote() {
  const c = getConfig();
  return Boolean(c.supabaseUrl && c.supabaseKey);
}

function headers() {
  const c = getConfig();
  return {
    apikey: c.supabaseKey,
    Authorization: `Bearer ${c.supabaseKey}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };
}

function base(table) {
  const c = getConfig();
  return `${c.supabaseUrl.replace(/\/$/, '')}/rest/v1/${table}`;
}

// ---------- local mode ----------
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));

function lread(table) {
  try { return JSON.parse(localStorage.getItem('ldx_' + table)) || []; } catch { return []; }
}
function lwrite(table, rows) {
  localStorage.setItem('ldx_' + table, JSON.stringify(rows));
}

// ---------- public API ----------
export async function list(table, { order = 'created_at', asc = false, filter = '' } = {}) {
  if (!isRemote()) {
    const rows = lread(table);
    return [...rows].sort((a, b) => {
      const x = a[order] ?? '', y = b[order] ?? '';
      return (x < y ? -1 : x > y ? 1 : 0) * (asc ? 1 : -1);
    });
  }
  const q = `${base(table)}?select=*${filter ? '&' + filter : ''}&order=${order}.${asc ? 'asc' : 'desc'}`;
  const r = await fetch(q, { headers: headers() });
  if (!r.ok) throw new Error(`${table}: ${r.status} ${await r.text()}`);
  return r.json();
}

export async function insert(table, row) {
  const withMeta = { id: uid(), created_at: new Date().toISOString(), ...row };
  if (!isRemote()) {
    const rows = lread(table);
    rows.push(withMeta);
    lwrite(table, rows);
    return withMeta;
  }
  const r = await fetch(base(table), { method: 'POST', headers: headers(), body: JSON.stringify(withMeta) });
  if (!r.ok) throw new Error(`${table}: ${r.status} ${await r.text()}`);
  const [saved] = await r.json();
  return saved;
}

export async function update(table, id, patch) {
  if (!isRemote()) {
    const rows = lread(table).map(r => (r.id === id ? { ...r, ...patch } : r));
    lwrite(table, rows);
    return rows.find(r => r.id === id);
  }
  const r = await fetch(`${base(table)}?id=eq.${id}`, { method: 'PATCH', headers: headers(), body: JSON.stringify(patch) });
  if (!r.ok) throw new Error(`${table}: ${r.status} ${await r.text()}`);
  const [saved] = await r.json();
  return saved;
}

export async function remove(table, id) {
  if (!isRemote()) {
    lwrite(table, lread(table).filter(r => r.id !== id));
    return;
  }
  const r = await fetch(`${base(table)}?id=eq.${id}`, { method: 'DELETE', headers: headers() });
  if (!r.ok) throw new Error(`${table}: ${r.status} ${await r.text()}`);
}

// Ask Cowork / manual-refresh plumbing: rows in the `requests` table.
// Cowork's scheduled cloud runs pick up `pending` rows, do the work,
// write results back, and mark them `done`.
export async function sendRequest(kind, payload = {}) {
  return insert('requests', { kind, payload, status: 'pending' });
}
