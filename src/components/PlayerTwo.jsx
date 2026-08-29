import React, { useEffect, useRef, useState } from 'react';
import { aiChat } from '../lib/ai.js';
import { homeContext } from '../lib/ally.js';
import { useCollection } from '../lib/hooks.js';
import { signOut } from '../lib/auth.js';
import { ownsTab, PLAYER_TWO } from '../lib/assistants.js';
import * as db from '../lib/db.js';
import { THREAD_KEY, sanitizeThread, trimForStore, trimForSend, threadChanged } from '../lib/thread.js';

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

  const { items: timetable } = useCollection('timetable', { order: 'id' });
  const { items: todos } = useCollection('todos', { order: 'due_date', asc: true });
  const { items: habits } = useCollection('habits', { order: 'id' });
  const { items: goals } = useCollection('goals', { order: 'id' });
  // Attendance lives here. Without it the dock could not answer the most
  // obvious college question there is, which is what its own College tab shows
  // on the front page.
  const { items: subjects } = useCollection('subjects', { order: 'name', asc: true });
  const { items: calMem } = useCollection('memory', { filter: 'key=eq.calendar_events', order: 'key' });

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
    setMsgs(next); setQ(''); setBusy(true); setErr('');
    try {
      const context = homeContext({
        timetable: timetable || [], todos: todos || [], habits: habits || [], goals: goals || [],
        subjects: subjects || [],
        events: calMem?.[0]?.value?.events || [],
      });
      // The tail, not the whole thread. Every message goes to the model on every
      // turn, so an un-capped history makes each reply slower and dearer than
      // the last — and now that the thread outlives the tab, nothing else caps it.
      const { text: reply } = await aiChat(trimForSend(next), {
        system: SYSTEM + '\n\n--- CONTEXT ---\n' + context,
        agent: 'home',
        // Two or three sentences is the whole brief, so 400 is generous. This is
        // the single biggest lever on how long an answer takes: the endpoint is
        // not streaming, so you wait for the LAST token, and every token the model
        // is permitted is time you might spend waiting for it.
        maxTokens: 400,
      });
      setMsgs(m => [...m, { role: 'assistant', content: reply || '(no reply)' }]);
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setBusy(false);
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
                onClick={() => { setMsgs([]); setErr(''); }}
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
            {busy && <div className="p2-msg p2-assistant p2-busy">thinking…</div>}
            {err && <div className="p2-err">{err}</div>}
            <div ref={endRef} />
          </div>

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
].join(' ');
