import React, { useEffect, useRef, useState } from 'react';
import { aiChat } from '../lib/ai.js';
import { homeContext } from '../lib/ally.js';
import { useCollection } from '../lib/hooks.js';
import { signOut } from '../lib/auth.js';

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

const OPENERS = [
  'What is due this week?',
  'When is my next class?',
  'What have I not touched in a while?',
];

export default function PlayerTwo() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const endRef = useRef(null);

  const { items: timetable } = useCollection('timetable', { order: 'id' });
  const { items: todos } = useCollection('todos', { order: 'due_date', asc: true });
  const { items: habits } = useCollection('habits', { order: 'id' });
  const { items: goals } = useCollection('goals', { order: 'id' });
  const { items: calMem } = useCollection('memory', { filter: 'key=eq.calendar_events', order: 'key' });

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [msgs, busy, open]);

  async function send(text) {
    const body = String(text ?? q).trim();
    if (!body || busy) return;
    const next = [...msgs, { role: 'user', content: body }];
    setMsgs(next); setQ(''); setBusy(true); setErr('');
    try {
      const context = homeContext({
        timetable: timetable || [], todos: todos || [], habits: habits || [], goals: goals || [],
        events: calMem?.[0]?.value?.events || [],
      });
      const { text: reply } = await aiChat(next, {
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
  'If the context does not contain the answer, say so plainly and name the tab that would have it. Never invent a class, a task, a date or a number.',
  'You do NOT have access to money or the journal. The Money tab has its own assistant, LEDGER, with data you cannot see — send financial questions there rather than guessing.',
  'A list marked "showing N of M" is a window, not the whole set; do not conclude anything from what is missing from it.',
].join(' ');
