// /api/whatsapp — the always-on ear and mouth.
//
// WHY IT LIVES HERE AND NOT IN COWORK
//
// Meta delivers every message as an inbound HTTPS POST and expects an answer in
// seconds. A Cowork session is something that STARTS — on a schedule, or when
// you open it — and makes outbound calls; nothing can POST into one. So Cowork
// cannot be the ear. This function is, it runs on Vercel, and it does not care
// whether the MacBook is on.
//
// Cowork is still the right home for the SLOW half: a "build me X" is queued as
// a spec in the vault and answered later. MCP is how Cowork reaches back into
// the dashboard (see src/lib/mcpguard.js). That is the outbound direction.
//
// EVERY DECISION IN HERE IS IN src/lib/wabot.js WITH ITS TESTS. This file does
// the network and the database and nothing else, so the rules can be read and
// changed without a webhook in the way.
//
// ENV (Vercel project settings — never in the repo):
//   WA_APP_SECRET      Meta app secret. Signs every webhook.
//   WA_VERIFY_TOKEN    a string you invent; Meta echoes it once at setup.
//   WA_TOKEN           permanent access token for the phone number.
//   WA_PHONE_ID        the phone number id (NOT the phone number).
//   WA_ALLOW           comma-separated numbers allowed to use it. THE boundary.
//   SUPABASE_URL, SUPABASE_SERVICE_KEY
//   ANTHROPIC_API_KEY

import { createHmac } from 'node:crypto';
import {
  verifyChallenge, verifySignature, inboundMessages, isStatusOnly,
  gate, remember, chunk, outboundPayload, HELP_TEXT,
  resolveConfirm, confirmPrompt,
} from '../src/lib/wabot.js';
import { parseActions, describeAction, isDestructive, resolveTodo } from '../src/lib/actions.js';
import { dayRows } from '../src/lib/today.js';
import { agendaFor, nextUp } from '../src/lib/agenda.js';

export const config = { api: { bodyParser: false }, maxDuration: 30 };

const {
  WA_APP_SECRET = '', WA_VERIFY_TOKEN = '', WA_TOKEN = '', WA_PHONE_ID = '',
  WA_ALLOW = '', SUPABASE_URL = '', SUPABASE_SERVICE_KEY = '', ANTHROPIC_API_KEY = '',
} = process.env;

const GRAPH = 'https://graph.facebook.com/v21.0';
const hmacHex = (secret, body) => createHmac('sha256', secret).update(body).digest('hex');

// ---------------------------------------------------------------- supabase

const H = { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' };
const rest = (p, init = {}) => fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${p}`, { ...init, headers: { ...H, ...(init.headers || {}) } });

/** null on ANY failure — never [], for the reason night-summary.mjs spells out. */
async function table(path) {
  try { const r = await rest(path); return r.ok ? await r.json() : null; } catch { return null; }
}
const memGet = async key => {
  const rows = await table(`memory?key=eq.${encodeURIComponent(key)}&select=value`);
  return rows?.[0]?.value ?? null;
};
const memPut = (key, value) => rest('memory?on_conflict=key', {
  method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' },
  body: JSON.stringify([{ key, value, updated_at: new Date().toISOString() }]),
});

// ------------------------------------------------------------------ sending

async function send(to, body) {
  if (!WA_TOKEN || !WA_PHONE_ID) return { ok: false, reason: 'not configured' };
  // Long answers go as several messages, in order. Awaited one at a time
  // because WhatsApp does not guarantee ordering on concurrent sends, and an
  // answer whose halves arrive backwards is worse than a slow one.
  for (const part of chunk(body)) {
    try {
      await fetch(`${GRAPH}/${WA_PHONE_ID}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(outboundPayload(to, part)),
      });
    } catch { /* a failed send must not take the webhook down — Meta would retry the whole message */ }
  }
  return { ok: true };
}

// ------------------------------------------------------------------ context
//
// The same facts the dock has, built from Supabase instead of from React
// collections — and through the SAME pure functions (today.js, agenda.js), so
// the bot cannot disagree with the screen about what is on.

const IST = 5.5 * 3600000;
const z = n => String(n).padStart(2, '0');
const istToday = () => { const d = new Date(Date.now() + IST); return `${d.getUTCFullYear()}-${z(d.getUTCMonth() + 1)}-${z(d.getUTCDate())}`; };

async function buildContext() {
  const [todos, timetable, mem] = await Promise.all([
    table('todos?select=id,title,completed,due_date,due_time&completed=is.false&order=due_date'),
    table('timetable?select=day,subject,code,start_time,end_time,room'),
    table('memory?select=key,value&key=in.(amizone_raw_diary,calendar_events,meetings)'),
  ]);
  const at = k => (mem || []).find(r => r.key === k)?.value ?? null;
  const today = istToday();
  const noon = new Date(Date.parse(`${today}T12:00:00Z`) - IST);
  const dayView = timetable ? dayRows(at('amizone_raw_diary'), timetable, noon) : null;
  const day = agendaFor(today, {
    classes: dayView || [], events: at('calendar_events')?.events || [],
    meetings: at('meetings')?.list || [], todos: todos || [],
  });
  const next = nextUp(day.items, Date.now());

  const lines = [`Today is ${today} (IST). The time is ${new Date(Date.now() + IST).toISOString().slice(11, 16)}.`];
  if (next) lines.push(`NEXT UP: ${next.title}${next.where ? ` (${next.where})` : ''} — ${next.live ? 'happening now' : `in ${next.inMin} minutes`}.`);
  else lines.push('NEXT UP: nothing left today.');
  if (day.items.length) {
    lines.push('TODAY:');
    for (const i of day.items.slice(0, 12)) {
      const t = i.at ? new Date(i.at).toTimeString().slice(0, 5) : 'all day';
      lines.push(`  ${t} ${i.title}${i.where ? ` — ${i.where}` : ''} [${i.source}]`);
    }
  }
  if (day.conflicts.length) lines.push(`CLASH: ${day.conflicts[0][0].title} and ${day.conflicts[0][1].title} are at the same time.`);
  if (todos === null) lines.push('TASKS: could not be read just now.');
  else if (!todos.length) lines.push('TASKS: nothing open.');
  else {
    lines.push(`OPEN TASKS (${todos.length}):`);
    for (const t of todos.slice(0, 15)) lines.push(`  ${t.title}${t.due_date ? ` — due ${t.due_date}` : ''}${t.due_time ? ` at ${t.due_time}` : ''}`);
  }
  return { text: lines.join('\n'), todos: todos || [], today };
}

const SYSTEM = [
  'You are PLAYER ONE reached over WhatsApp — the remote control for Neel’s own dashboard.',
  'Answer in one or two short sentences. This is a chat message, not a document: no headings, no bullet lists, no markdown.',
  'Answer from the CONTEXT below when it covers the question, and say plainly when it does not. Never invent a class, a task, a date or a number.',
  'You have no access to money, health or journal data. Say so and stop rather than guessing.',
].join(' ');

// ------------------------------------------------------------------- the brain

async function think(userText, ctx) {
  if (!ANTHROPIC_API_KEY) return { text: 'My brain is not configured on the server yet.', actions: [] };
  const { ACTION_INSTRUCTIONS } = await import('../src/lib/actions.js');
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        // Haiku for the same reason the dock moved to it: this proposes actions
        // against real data and has to hold a format, and it has to do it fast
        // enough that a chat reply still feels like one.
        model: 'claude-haiku-4-5',
        max_tokens: 400,
        system: `${SYSTEM}\n\n--- CONTEXT ---\n${ctx.text}\n\n${ACTION_INSTRUCTIONS}`,
        messages: [{ role: 'user', content: userText }],
      }),
    });
    const j = await r.json();
    if (!r.ok) return { text: `I could not reach my brain just now (${j?.error?.type || r.status}).`, actions: [] };
    const raw = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
    const parsed = parseActions(raw, { today: new Date(`${ctx.today}T12:00:00`) });
    return { text: parsed.prose || raw, actions: parsed.actions, rejected: parsed.rejected };
  } catch (e) {
    return { text: 'I could not reach my brain just now.', actions: [] };
  }
}

// ------------------------------------------------------------------- doing it

async function perform(action, ctx) {
  const a = action;
  if (a.do === 'add_todo') {
    await rest('todos', { method: 'POST', body: JSON.stringify([{
      title: a.title, due_date: a.due || null, due_time: a.time || null,
      priority: 0, list: 'Inbox', completed: false,
    }]) });
    return `Added “${a.title}”${a.due ? ` for ${a.due}` : ''}${a.time ? ` at ${a.time}` : ''}.`;
  }
  if (a.do === 'complete_todo') {
    const hit = resolveTodo(a.title, ctx.todos);
    if (!hit.ok) return `Didn't do it — ${hit.reason}.`;
    await rest(`todos?id=eq.${hit.row.id}`, { method: 'PATCH', body: JSON.stringify({ completed: true, completed_at: new Date().toISOString() }) });
    return `Ticked off “${hit.row.title}”.`;
  }
  if (a.do === 'reschedule_todo') {
    const hit = resolveTodo(a.title, ctx.todos);
    if (!hit.ok) return `Didn't do it — ${hit.reason}.`;
    const patch = { due_date: a.due };
    if (a.time) patch.due_time = a.time;
    await rest(`todos?id=eq.${hit.row.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
    return `Moved “${hit.row.title}” to ${a.due}${a.time ? ` at ${a.time}` : ''}.`;
  }
  if (a.do === 'delete_todo') {
    const hit = resolveTodo(a.title, ctx.todos);
    if (!hit.ok) return `Didn't do it — ${hit.reason}.`;
    await rest(`todos?id=eq.${hit.row.id}`, { method: 'DELETE' });
    return `Deleted “${hit.row.title}”.`;
  }
  if (a.do === 'remember' || a.do === 'queue_build') {
    const { inboxRow } = await import('../src/lib/vault.js');
    const { specNote } = await import('../src/lib/buildspec.js');
    const made = a.do === 'queue_build'
      ? inboxRow({ title: a.title, body: specNote({ title: a.title, why: a.why, steps: a.steps, status: 'queued' }), folder: 'projects', tags: ['build'], source: 'whatsapp' })
      : inboxRow({ title: a.title, body: a.body, folder: a.folder, source: 'whatsapp' });
    if (!made.ok) return `Didn't do it — ${made.reason}.`;
    await rest('vault_inbox', { method: 'POST', body: JSON.stringify([made.row]) });
    return a.do === 'queue_build'
      ? `Queued the spec for ${made.row.path}. I'll message you when it's done.`
      : `Saved to ${made.row.path}. It reaches the vault within 15 minutes.`;
  }
  // Anything else is declared in actions.js but has no server-side path yet.
  // Said plainly rather than silently doing nothing.
  return `I can't do “${a.do}” from WhatsApp yet — it works in the app.`;
}

// --------------------------------------------------------------------- handler

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const v = verifyChallenge(req.query || {}, WA_VERIFY_TOKEN);
    if (!v.ok) { res.statusCode = 403; return res.end('forbidden'); }
    res.statusCode = 200;
    return res.end(v.challenge);
  }
  if (req.method !== 'POST') { res.statusCode = 405; return res.end('POST only'); }

  // The RAW body. Re-serialising the parse changes key order and whitespace and
  // the signature then never matches — which presents as "Meta is sending bad
  // signatures" and costs a day.
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');

  const sig = verifySignature(raw, req.headers['x-hub-signature-256'], WA_APP_SECRET, hmacHex);
  if (!sig.ok) { res.statusCode = 401; return res.end('bad signature'); }

  let payload = null;
  try { payload = JSON.parse(raw); } catch { payload = null; }

  // 200 to everything from here on. Meta retries anything else, and a retry of
  // a message we have already handled is dedupe work we do not need to create.
  const done = () => { res.statusCode = 200; res.end('ok'); };
  if (!payload || isStatusOnly(payload)) return done();

  const messages = inboundMessages(payload);
  if (!messages.length) return done();

  const seen = (await memGet('wa_seen')) || [];
  let seenNext = seen;

  for (const m of messages) {
    const g = gate({ message: m, allowlist: WA_ALLOW, seen: seenNext });
    // An unknown sender gets nothing at all — no reply, and no slot in the seen
    // list either.
    if (!g.act && !g.reply) continue;
    seenNext = remember(m.id, seenNext);
    if (!g.act) { await send(m.from, g.text); continue; }

    // A held destructive action is answered before anything else is considered.
    const pending = await memGet('wa_pending');
    const c = resolveConfirm(pending, m.text);
    if (c.state !== 'none') {
      await memPut('wa_pending', null);
      if (c.state === 'confirmed') {
        const ctx = await buildContext();
        await send(m.from, await perform(c.action, ctx));
        continue;
      }
      if (c.text) { await send(m.from, c.text); continue; }
      // 'moved-on' falls through and is treated as the new message it is.
    }

    if (g.route.lane === 'help') { await send(m.from, HELP_TEXT); continue; }
    if (g.route.lane === 'ignore') continue;

    const ctx = await buildContext();
    const out = await think(g.route.text, ctx);
    const replies = [out.text];

    for (const a of (out.actions || []).slice(0, 2)) {
      if (isDestructive(a.do)) {
        // Held, not done. The prompt names the consequence so a "yes" means
        // something.
        await memPut('wa_pending', { action: a, at: Date.now() });
        replies.push(confirmPrompt(a));
      } else {
        replies.push(await perform(a, ctx));
      }
    }
    if (!out.actions?.length && out.rejected?.length) {
      replies.push(`(I tried to act on that and could not read my own instruction — ${out.rejected[0]}. Say it again with the date or time spelled out.)`);
    }

    await send(m.from, replies.filter(Boolean).join('\n\n'));

    // The thread, so the same conversation is visible inside the dashboard.
    const thread = (await memGet('wa_thread')) || { list: [] };
    const list = [...(thread.list || []), { at: m.at || Date.now(), from: 'neel', text: m.text }, { at: Date.now(), from: 'bot', text: replies.join('\n\n') }];
    await memPut('wa_thread', { list: list.slice(-200), lastInboundAt: m.at || Date.now() });
  }

  await memPut('wa_seen', seenNext);
  return done();
}
