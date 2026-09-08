import React, { useEffect, useRef, useState } from 'react';
import { aiChat } from '../lib/ai.js';
import { homeContext } from '../lib/ally.js';
import { useCollection, todayStr } from '../lib/hooks.js';
import { signOut } from '../lib/auth.js';
import { ownsTab, PLAYER_TWO } from '../lib/assistants.js';
import * as db from '../lib/db.js';
import { THREAD_KEY, sanitizeThread, trimForStore, trimForSend, threadChanged } from '../lib/thread.js';
import { useReminderDone } from '../lib/useReminderDone.js';
import { fblStatus } from '../lib/exams.js';
import { brainContext } from '../lib/brain.js';
import { ACTION_INSTRUCTIONS, parseActions, stripActionsLive, describeAction, resolveTodo, resolveHabit, isDestructive } from '../lib/actions.js';

// PLAYER TWO — the co-op partner, reachable from every screen.
//
// It lived inside the HQ tab, which made it the Home assistant rather than a
// system-wide one: the moment you navigated anywhere else it was gone, along with
// the conversation. Mounted at the app root instead, so it follows you across
// tabs and the thread survives navigation — which is most of what makes an
// assistant feel present rather than like a widget you visit.
//
// It does NOT see money. That is enforced twice over: no financial table is read
// here, and the request is tagged agent:'home', which the server routes to the
// free tier. LEDGER owns finance, has data this does not, and refuses advice in
// ways this has no machinery for. The two must not blur — the whole reason the
// Money tab has its own assistant is that a general chat window holding a
// portfolio is a different and worse product.
//
// Which is why it also has to be INVISIBLE there. Not seeing money was only half
// the rule; the other half was never built, so this dock sat on top of LEDGER on
// Money and on top of Ally on Media — the assistant that cannot help, covering
// the one that can, and announcing its own uselessness in its subtitle.
//
// It hides by rendering nothing, NOT by unmounting. Unmounting would take `msgs`
// with it, so a trip to the Money tab would silently end the conversation — the
// exact widget-not-a-partner failure the root mount above exists to avoid. The
// component stays alive, the thread survives, and even the open/closed state is
// where you left it when you come back.

const OPENERS = [
  'When is my next class?',
  'What is my attendance?',
  'What should I study today?',
];

export default function PlayerTwo({ tab }) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const endRef = useRef(null);
  // Nothing may be SAVED until the stored thread has been LOADED. Without this
  // the empty initial state races the load and writes {} over a real
  // conversation — the classic hydrate-then-persist bug, and one that destroys
  // exactly the thing this feature exists to keep.
  const hydrated = useRef(false);
  const savedRef = useRef([]);
  // Proposals from the LATEST reply only, and never persisted. A confirmation
  // card restored after a reload would offer to add a task Neel may already
  // have added by hand — a stale action is worse than no action.
  const [pending, setPending] = useState([]);
  // The reply as it arrives. Kept out of `msgs` until it is complete, so a
  // half-finished sentence is never persisted or sent back as history.
  const [streaming, setStreaming] = useState('');
  const [acting, setActing] = useState(false);
  const [actionNote, setActionNote] = useState('');

  const { items: timetable } = useCollection('timetable', { order: 'id' });
  const { items: todos, refresh: rTodos } = useCollection('todos', { order: 'due_date', asc: true });
  const { items: habits } = useCollection('habits', { order: 'id' });
  const { items: goals } = useCollection('goals', { order: 'id' });
  // Attendance lives here. Without it the dock could not answer the most
  // obvious college question there is, which is what its own College tab shows
  // on the front page.
  const { items: subjects } = useCollection('subjects', { order: 'name', asc: true });
  const { items: calMem } = useCollection('memory', { filter: 'key=eq.calendar_events', order: 'key' });
  // The two things the dock could not previously answer: a question with a
  // DEADLINE behind it, and "is what you are telling me actually current?"
  const { items: placeMem } = useCollection('memory', { filter: 'key=eq.amizone_placements', order: 'key' });
  const { items: syncMem } = useCollection('memory', { filter: 'key=eq.sync_status', order: 'key' });
  // Habit NAMES were already here; what was missing was whether any of them had
  // been done today, which is the only part of a habit anyone asks about.
  // The refresh matters more here than it looks. Without it habitLogs stays
  // stale for the 45s poll after a write, so log_habit's "already logged today"
  // guard reads pre-write data and would insert a duplicate on a second ask —
  // and unlog_habit, run straight after a log, would find no row and report
  // "not logged today", which is both wrong and impossible to make sense of.
  const { items: habitLogs, refresh: rLogs } = useCollection('habit_logs', { order: 'date' });
  // The Obsidian vault, indexed by the `brain` repo on every push. Loaded whole
  // because retrieval happens here, in the browser — see lib/brain.js for where
  // that stops being the right shape.
  const { items: brainMem } = useCollection('memory', { filter: 'key=eq.brain_index', order: 'key' });
  // The same tick map HQ and Study read. Without it the dock would still be
  // chasing a module Neel ticked this morning on the two screens either side.
  const { doneMap, setDone } = useReminderDone();

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [msgs, busy, open]);

  // ---- load once ----
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const rows = await db.list('memory', { filter: `key=eq.${THREAD_KEY}`, order: 'key' });
        const stored = sanitizeThread(rows?.[0]?.value);
        if (dead) return;
        savedRef.current = stored;
        // Only adopt it if nothing has been typed in the meantime. A slow load
        // must never wipe a message sent while it was in flight.
        setMsgs(m => (m.length ? m : stored));
      } catch {
        // A thread that will not load is not worth blocking the assistant over.
      } finally {
        if (!dead) hydrated.current = true;
      }
    })();
    return () => { dead = true; };
  }, []);

  // ---- save, debounced ----
  // Deliberately NOT inside send(): a reply that arrives after an error, or a
  // thread cleared from the header, has to be persisted too, and one effect
  // watching the state covers every path by construction.
  useEffect(() => {
    if (!hydrated.current) return;
    if (!threadChanged(savedRef.current, msgs)) return;
    const t = setTimeout(async () => {
      const body = trimForStore(msgs);
      try {
        await db.upsertMemory(THREAD_KEY, body);
        savedRef.current = body;
      } catch {
        // Left unsaved on purpose. savedRef is unchanged, so the next edit
        // retries; failing to store a chat line is not worth an error banner
        // over the conversation.
      }
    }, 800);
    return () => clearTimeout(t);
  }, [msgs]);

  async function send(text) {
    const body = String(text ?? q).trim();
    if (!body || busy) return;
    const next = [...msgs, { role: 'user', content: body }];
    setMsgs(next); setQ(''); setBusy(true); setErr(''); setPending([]); setActionNote(''); setStreaming('');
    try {
      const context = homeContext({
        timetable: timetable || [], todos: todos || [], habits: habits || [], goals: goals || [],
        subjects: subjects || [],
        events: calMem?.[0]?.value?.events || [],
        habitLogs: habitLogs || [],
        placements: placeMem?.[0]?.value?.rows || [],
        syncStatus: syncMem?.[0]?.value || null,
        doneMap,
      });
      // The tail, not the whole thread. Every message goes to the model on every
      // turn, so an un-capped history makes each reply slower and dearer than
      // the last — and now that the thread outlives the tab, nothing else caps it.
      // Retrieval is per-QUESTION, so it happens here rather than in
      // homeContext: the live context is the same every turn, the notes are not.
      const notes = brainContext(body, brainMem?.[0]?.value);

      const { text: reply } = await aiChat(trimForSend(next), {
        // Show it as it types. The tokens were always arriving this fast; the
        // old code just held them until the last one landed.
        onDelta: partial => setStreaming(stripActionsLive(partial)),
        system: SYSTEM + '\n\n--- CONTEXT ---\n' + context + (notes ? '\n\n' + notes : ''),
        agent: 'home',
        // Two or three sentences is the whole brief, so 400 is generous. This is
        // the single biggest lever on how long an answer takes: the endpoint is
        // not streaming, so you wait for the LAST token, and every token the model
        // is permitted is time you might spend waiting for it.
        maxTokens: 400,
      });
      // The JSON block is machinery, not conversation: it is stripped before the
      // reply is shown or stored, so the thread never contains a confirmation
      // card's raw source.
      const { prose, actions } = parseActions(reply || '');
      setMsgs(m => [...m, { role: 'assistant', content: prose || reply || '(no reply)' }]);
      setPending(actions);
      // Cleared only once the finished message is in the log, or the text would
      // blink out and back in.
      setStreaming('');
    } catch (e) {
      setErr(String(e.message || e));
      // Whatever arrived before the failure is discarded. A truncated answer
      // left on screen under an error message reads as a real answer with a
      // warning attached, which is exactly backwards.
      setStreaming('');
      // And take the question back out. It was added optimistically; leaving it
      // there on a failure means the thread PERSISTS a user turn with no reply,
      // so the next attempt sends two identical questions in a row — which is
      // exactly what happened when the free-tier model was retired. The text
      // goes back in the box so it can simply be sent again.
      setMsgs(m => (m.length && m[m.length - 1].role === 'user' ? m.slice(0, -1) : m));
      setQ(body);
    } finally {
      setBusy(false);
    }
  }

  // Nothing here runs off the model's say-so. `pending` is a proposal; this
  // only ever runs from a click on the card below.
  // Which module fbl_done would tick. Computed here, not taken from the model:
  // the model is allowed to say "mark it done", never to say WHICH.
  const fblOpenKey = fblStatus(todayStr(), doneMap)?.current?.key || '';

  async function runAction(a) {
    if (acting) return;
    setActing(true); setActionNote('');
    try {
      if (a.do === 'add_todo') {
        await db.insert('todos', {
          title: a.title, due_date: a.due || null, due_time: a.time || null,
          duration_min: null, priority: 0, list: 'Inbox', completed: false,
        });
        await rTodos();
        setActionNote(`Added “${a.title}”${a.time ? ` at ${a.time}` : ''}.`);
      } else if (a.do === 'reschedule_todo') {
        // Resolved against OPEN todos only, like complete_todo: moving a task
        // that is already finished is never what was meant.
        const hit = resolveTodo(a.title, todos || []);
        if (!hit.ok) { setActionNote(`Didn't do it — ${hit.reason}.`); return; }
        const patch = { due_date: a.due };
        // Only touch the time when one was actually given. Writing null here
        // would silently strip a time he had set by hand, which is a loss he
        // would not connect to having asked to move the date.
        if (a.time) patch.due_time = a.time;
        await db.update('todos', hit.row.id, patch);
        await rTodos();
        setActionNote(`Moved “${hit.row.title}” to ${a.due}${a.time ? ` at ${a.time}` : ''}.`);
      } else if (a.do === 'delete_todo') {
        // Resolved across OPEN AND COMPLETED todos — unlike complete_todo,
        // which only looks at open ones. He may well want to throw away
        // something he already ticked, and refusing to find it would be
        // baffling. resolveBy still refuses anything ambiguous, which is the
        // guard that matters when the operation cannot be undone.
        const hit = resolveTodo(a.title, todos || [], { includeDone: true });
        if (!hit.ok) { setActionNote(`Didn't do it — ${hit.reason}.`); return; }
        await db.remove('todos', hit.row.id);
        await rTodos();
        setActionNote(`Deleted “${hit.row.title}”.`);
      } else if (a.do === 'complete_todo') {
        const hit = resolveTodo(a.title, todos || []);
        if (!hit.ok) { setActionNote(`Didn't do it — ${hit.reason}.`); return; }
        await db.update('todos', hit.row.id, { completed: true });
        await rTodos();
        setActionNote(`Marked “${hit.row.title}” done.`);
      } else if (a.do === 'log_habit') {
        const hit = resolveHabit(a.name, habits || []);
        if (!hit.ok) { setActionNote(`Didn't do it — ${hit.reason}.`); return; }
        const day = todayStr();
        if ((habitLogs || []).some(l => l.habit_id === hit.row.id && l.date === day)) {
          setActionNote(`“${hit.row.name}” was already logged today.`);
          return;
        }
        await db.insert('habit_logs', { habit_id: hit.row.id, date: day });
        await rLogs();
        setActionNote(`Logged “${hit.row.name}”.`);
      } else if (a.do === 'unlog_habit') {
        const hit = resolveHabit(a.name, habits || []);
        if (!hit.ok) { setActionNote(`Didn't do it — ${hit.reason}.`); return; }
        const day = todayStr();
        // TODAY's row only, found by id — never a filter that could match more
        // than one day. Deleting a week of history because a date comparison was
        // loose is not recoverable from here.
        const row = (habitLogs || []).find(l => l.habit_id === hit.row.id && l.date === day);
        if (!row) { setActionNote(`“${hit.row.name}” was not logged today, so there is nothing to undo.`); return; }
        await db.remove('habit_logs', row.id);
        await rLogs();
        setActionNote(`Removed today's log for “${hit.row.name}”.`);
      } else if (a.do === 'fbl_done') {
        const open = fblOpenKey;
        if (!open) { setActionNote("Didn't do it — no FBL module is open right now."); return; }
        await setDone(open, true);
        setActionNote('Marked the open Spanish module done.');
      }
    } catch (e) {
      setActionNote(`Didn't do it — ${String(e.message || e)}`);
    } finally {
      setActing(false);
      setPending(p => p.filter(x => x !== a));
    }
  }

  // Another assistant owns this screen. Every hook above has already run — this
  // guard is deliberately the LAST thing before the render, because an early
  // return placed among the hooks would change how many run between tabs and
  // React would throw.
  if (!ownsTab(PLAYER_TWO, tab)) return null;

  return (
    <>
      <button
        className={`p2-fab ${open ? 'p2-fab-open' : ''}`}
        onClick={() => setOpen(o => !o)}
        title="PLAYER TWO"
      >
        {open ? '✕' : 'P2'}
      </button>

      {open && (
        <div className="p2-panel">
          <div className="p2-head">
            <span className="p2-title">PLAYER TWO</span>
            <span className="p2-sub">everything except money</span>
            {/* A thread that survives reloads needs a way to end. Without this
                the only way to start fresh would be to scroll past it forever. */}
            {msgs.length > 0 && (
              <button
                className="p2-out"
                onClick={() => { setMsgs([]); setErr(''); setPending([]); setActionNote(''); }}
                title="Start a new thread"
              >NEW</button>
            )}
            <button className="p2-out" onClick={() => signOut()} title="Sign out">SIGN OUT</button>
          </div>

          <div className="p2-log">
            {msgs.length === 0 && (
              <div className="p2-openers">
                {/* Openers that do something. "Hi, how can I help" costs a turn and
                    teaches nothing about what this can actually see. */}
                {OPENERS.map(o => (
                  <button key={o} className="p2-opener" onClick={() => send(o)}>{o}</button>
                ))}
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={`p2-msg p2-${m.role}`}>{m.content}</div>
            ))}
            {/* Once a single token has arrived, "thinking…" is a lie — the
                answer is on screen and still growing. */}
            {busy && !streaming && <div className="p2-msg p2-assistant p2-busy">thinking…</div>}
            {streaming && <div className="p2-msg p2-assistant">{streaming}<span className="p2-caret">▮</span></div>}
            {err && <div className="p2-err">{err}</div>}
            <div ref={endRef} />
          </div>

          {/* The confirmation gate. The model proposed; nothing has happened.
              Each card states exactly what will change in the words of the thing
              itself, because "yes" to a vague description is not consent. */}
          {pending.length > 0 && (
            <div className="p2-actions">
              {pending.map((a, i) => (
                // A destructive action must not be one muscle-memory tap away
                // from the reversible ones. Same row, different colour, and the
                // button says the word — "DO IT" on a delete is exactly how you
                // confirm something you did not read.
                <div className="p2-action" key={i}>
                  <span className="small" style={{ flex: 1, color: isDestructive(a.do) ? 'var(--red)' : undefined }}>
                    {isDestructive(a.do) && <span aria-hidden="true">⚠ </span>}
                    {describeAction(a)}
                  </span>
                  <button
                    className={`btn btn-sm${isDestructive(a.do) ? ' btn-red' : ''}`}
                    disabled={acting}
                    onClick={() => runAction(a)}
                  >
                    {acting ? '·' : isDestructive(a.do) ? 'DELETE' : 'DO IT'}
                  </button>
                  <button
                    className="btn btn-sm"
                    disabled={acting}
                    onClick={() => setPending(p => p.filter(x => x !== a))}
                  >NO</button>
                </div>
              ))}
            </div>
          )}
          {actionNote && <div className="p2-note small">{actionNote}</div>}

          <form className="p2-form" onSubmit={e => { e.preventDefault(); send(); }}>
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Ask about classes, tasks, habits…"
              disabled={busy}
            />
            <button className="btn btn-sm btn-green" type="submit" disabled={busy || !q.trim()}>SEND</button>
          </form>
        </div>
      )}
    </>
  );
}

const SYSTEM = [
  'You are PLAYER TWO, the co-op assistant inside a personal life dashboard styled as a 1980s arcade terminal.',
  'Answer in two or three sentences of plain prose. No headings, no bullet lists unless asked.',
  'Be brief. Do not restate the question, do not explain your reasoning, do not list what you looked at — give the answer.',
  'Answer from the CONTEXT below when it covers the question.',
  'The context begins with the current date and time. Use it for anything involving "next", "now", "today" or "how long" — do not claim you cannot tell the time.',
  'Next class and current class are already computed for you in the context. Repeat them; do not recalculate from the weekly list and do not contradict them.',
  'If the context does not contain the answer, say so plainly and name the tab that would have it. Never invent a class, a task, a date or a number.',
  'You do NOT have access to money or the journal. The Money tab has its own assistant, LEDGER, with data you cannot see — send financial questions there rather than guessing.',
  'A list marked "showing N of M" is a window, not the whole set; do not conclude anything from what is missing from it.',
  'A block headed FROM NEEL\u2019S NOTES is his own vault. Treat it as what HE wrote and believes, not as verified fact, and say which note it came from when you use it. If it contradicts the live context above, the live context wins \u2014 a note can be a year old.',
].join(' ') + '\n\n' + ACTION_INSTRUCTIONS;
