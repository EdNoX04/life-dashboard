// ---- Life HQ data layer ----
// Works in two modes:
//  - LOCAL  : localStorage (zero setup, works day one)
//  - REMOTE : Supabase via PostgREST fetch (no client lib needed)
// Cowork (the AI brain) writes to the same Supabase tables from the cloud.

import { authedFetch } from './auth.js';

const cfgKey = 'ldx_config';

// Baked-in defaults: the app is connected out of the box on every device.
// (The publishable key is public by design — safe to ship in the bundle.)
// Anything saved in the Config tab overrides these for that browser.
const DEFAULTS = {
  supabaseUrl: 'https://xroynvkzephebhcztvfo.supabase.co',
  supabaseKey: 'sb_publishable_OVCd6KhOHNVYz1a9vCisbg_OsIF0uhy',
};

export function getConfig() {
  try { return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(cfgKey)) || {}) }; } catch { return { ...DEFAULTS }; }
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

// ---- cross-device config sync ----
// The Supabase URL/key are baked in and stay per-device, but user-added keys
// (market data, TMDB, LeetCode) sync through the shared `memory` table so you
// set them once on any device and every device picks them up.
//
// Adding a key to Settings is only half the job: a key missing from this list is
// saved on the device you typed it on and nowhere else, which looks exactly like
// the sync being broken. `fmpKey` was added to Settings and not to this list,
// which is why the dividend key vanished on the iPad.
//
// What is deliberately NOT here: supabaseUrl and supabaseKey, because they are
// how a device reaches this table in the first place and syncing them through it
// is circular; and anything with write authority. Every key below is a read-only
// data feed. The Binance pair is the case that proves the rule - it can see
// balances and history, so it lives in GitHub Secrets and never touches this
// table or the browser.
//
// claudeKey / openaiKey / geminiKey were here and are now gone. They synced to
// memory.app_config, which was world-readable until migration 003 — and even
// with RLS on, a paid key sitting in a browser is a paid key that leaks with the
// browser. Since api/chat.js they live in Vercel environment variables and no
// client ever sees one. There is nothing left to sync.
const SYNC_KEYS = [
  'finnhubKey', 'twelveKey', 'fmpKey', 'alphaKey', 'tmdbKey', 'leetcodeUser',
];

export async function syncPushConfig() {
  if (!isRemote()) return;
  const c = getConfig();
  // Cleared keys are pushed as empty strings rather than omitted. Omitting them
  // meant a key you deleted on one device came straight back from another,
  // which is indistinguishable from the delete not working.
  const payload = {};
  for (const k of SYNC_KEYS) payload[k] = c[k] || '';
  await upsertMemory('app_config', payload);
}

// Pull synced keys from Supabase into this device's config. Remote non-empty
// values win (that's the whole point — the device that set them is source of truth).
// Returns true if anything changed locally.
export async function syncPullConfig() {
  if (!isRemote()) return false;
  try {
    const rows = await list('memory', { filter: 'key=eq.app_config', order: 'key' });
    const remote = rows?.[0]?.value || {};
    const cur = getConfig();
    const patch = {};
    // A remote empty string is a deliberate clear and is applied; a remote key
    // that is ABSENT is simply unknown to the shared record and leaves the
    // local value alone. The two cases look the same in JSON and mean opposite
    // things, which is why the push above writes '' rather than omitting.
    for (const k of SYNC_KEYS) {
      if (!(k in remote)) continue;
      if (remote[k] !== cur[k]) patch[k] = remote[k];
    }
    if (Object.keys(patch).length) { setConfig(patch); return true; }
  } catch { /* offline / not set up yet */ }
  return false;
}

// Only the non-Authorization bits now. Since migration 003 the publishable key
// grants nothing on its own — it routes, it does not authorise — so the bearer
// token is supplied by authedFetch, which is the only thing that knows whether
// the session is still fresh. Leaving an `Authorization: Bearer <publishable>`
// here would silently win over the real one via the header spread and put every
// request back to anonymous, which reads as "all my data vanished".
function headers() {
  return {
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
// `memory` is a key/value table with no `created_at` column, so the default
// order below is a 400 for it — PostgREST rejects the whole query and the row
// never arrives. Every existing caller worked around this by passing
// order:'key', which meant the workaround looked like a style choice rather than
// a requirement, and the three calls that omitted it failed silently: the media
// diary read 0 viewings while Supabase held 58, and the shelf's runtime blob had
// been failing the same way since long before.
//
// Defaulting per table fixes it for every future caller instead of asking each
// one to remember.
const DEFAULT_ORDER = { memory: 'key' };

export async function list(table, { order = DEFAULT_ORDER[table] || 'created_at', asc = false, filter = '' } = {}) {
  if (!isRemote()) {
    const rows = lread(table);
    return [...rows].sort((a, b) => {
      const x = a[order] ?? '', y = b[order] ?? '';
      return (x < y ? -1 : x > y ? 1 : 0) * (asc ? 1 : -1);
    });
  }
  const q = `${base(table)}?select=*${filter ? '&' + filter : ''}&order=${order}.${asc ? 'asc' : 'desc'}`;
  const r = await authedFetch(q, { headers: headers() });
  if (!r.ok) throw new Error(`${table}: ${r.status} ${await r.text()}`);
  return r.json();
}

// Fetch ALL rows, paging past PostgREST's 1000-row cap (health history is huge).
export async function listAll(table, { order = 'created_at', asc = false, filter = '' } = {}) {
  if (!isRemote()) return list(table, { order, asc, filter });
  const page = 1000; const out = [];
  for (let from = 0; ; from += page) {
    const q = `${base(table)}?select=*${filter ? '&' + filter : ''}&order=${order}.${asc ? 'asc' : 'desc'}`;
    const r = await authedFetch(q, { headers: { ...headers(), Range: `${from}-${from + page - 1}`, 'Range-Unit': 'items' } });
    if (!r.ok) throw new Error(`${table}: ${r.status} ${await r.text()}`);
    const rows = await r.json();
    out.push(...rows);
    if (rows.length < page) break;
  }
  return out;
}

export async function insert(table, row) {
  const withMeta = { id: uid(), created_at: new Date().toISOString(), ...row };
  if (!isRemote()) {
    const rows = lread(table);
    rows.push(withMeta);
    lwrite(table, rows);
    return withMeta;
  }
  const r = await authedFetch(base(table), { method: 'POST', headers: headers(), body: JSON.stringify(withMeta) });
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
  const r = await authedFetch(`${base(table)}?id=eq.${id}`, { method: 'PATCH', headers: headers(), body: JSON.stringify(patch) });
  if (!r.ok) throw new Error(`${table}: ${r.status} ${await r.text()}`);
  const [saved] = await r.json();
  return saved;
}

export async function remove(table, id) {
  if (!isRemote()) {
    lwrite(table, lread(table).filter(r => r.id !== id));
    return;
  }
  const r = await authedFetch(`${base(table)}?id=eq.${id}`, { method: 'DELETE', headers: headers() });
  if (!r.ok) throw new Error(`${table}: ${r.status} ${await r.text()}`);
}

// Upsert a memory row by key (client-side blobs like dsa_solves).
export async function upsertMemory(key, value) {
  if (!isRemote()) {
    const rows = lread('memory').filter(r => r.key !== key);
    rows.push({ key, value, updated_at: new Date().toISOString() });
    lwrite('memory', rows);
    return;
  }
  const r = await authedFetch(`${base('memory')}`, {
    method: 'POST',
    headers: { ...headers(), Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify([{ key, value, updated_at: new Date().toISOString() }]),
  });
  if (!r.ok) throw new Error(`memory upsert: ${r.status} ${await r.text()}`);
}

// Ask Cowork / manual-refresh plumbing: rows in the `requests` table.
// Cowork's scheduled cloud runs pick up `pending` rows, do the work,
// write results back, and mark them `done`.
export async function sendRequest(kind, payload = {}) {
  return insert('requests', { kind, payload, status: 'pending' });
}
