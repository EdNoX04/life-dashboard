import React, { useEffect, useMemo, useRef, useState } from 'react';
import { aiChat, pickProvider, providerLabel } from '../lib/ai.js';
import { buildContext, systemPrompt, scopeFor, PROMPTS, asText } from '../lib/ally.js';

// ALLY — the floating terminal.
//
// A CRT window that knows what screen you are on and nothing else. The scoping
// is enforced in lib/ally.js, not here: this component asks for a context by tab
// name and receives either a string or null. It has no access to the stores it
// is not given, which is what makes "only the open tab" a property rather than a
// promise.
//
// The retro is doing a job, not just decoration. A chat that looks like a chat
// invites you to talk to it like a chatbot; a terminal with a blinking block
// cursor and a > prompt invites short commands, which is what actually gets
// used. The typewriter reveal exists for the same reason a modem screeched:
// it makes the wait legible instead of dead.

const BOOT = [
  'ALLY v1.0 — ARCADE TERMINAL',
  'READY.',
];

// Types the answer out rather than dropping it in. Deliberately fast enough not
// to be annoying and slow enough to read as arriving.
function useTypewriter(text, speed = 9) {
  const [shown, setShown] = useState('');
  useEffect(() => {
    if (!text) { setShown(''); return undefined; }
    let i = 0;
    setShown('');
    const id = setInterval(() => {
      i += Math.max(1, Math.round(text.length / 400));
      setShown(text.slice(0, i));
      if (i >= text.length) clearInterval(id);
    }, speed);
    return () => clearInterval(id);
  }, [text, speed]);
  return shown;
}

function Line({ m, live }) {
  // asText, not m.content directly. A message body that is not a string reaches
  // `.slice` in the typewriter and React's child renderer, and both of those
  // throw — one bad bubble would take the whole dock down. See lib/ally.js.
  const content = asText(m.content);
  const typed = useTypewriter(live ? content : '');
  const body = live ? typed : content;
  if (m.role === 'system') return <div className="al-sys">{content}</div>;
  return (
    <div className={`al-line al-${m.role}`}>
      <span className="al-who">{m.role === 'user' ? 'YOU' : 'ALLY'}</span>
      <span className="al-body">{body}{live && typed.length < content.length && <i className="al-cur" />}</span>
    </div>
  );
}

export default function Ally({ tab, data = {} }) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [liveId, setLiveId] = useState(null);
  const endRef = useRef(null);

  const provider = pickProvider();
  const scope = scopeFor(tab);
  const context = useMemo(() => buildContext(tab, data), [tab, data]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs, open]);

  // Changing tabs resets the conversation. It has to: the context it was
  // answering from no longer applies, and continuing would let a media answer
  // be followed by a money question the model still thinks it can see films for.
  useEffect(() => {
    setMsgs([]);
    setLiveId(null);
  }, [tab]);

  const send = async text => {
    const q = String(text ?? input).trim();
    if (!q || busy) return;
    setInput('');
    const next = [...msgs, { role: 'user', content: q }];
    setMsgs(next);
    setBusy(true);
    try {
      // Destructured. `aiChat` resolves to { text, provider, model, citations };
      // taking the whole object as the reply is what crashed this dock on every
      // answer it ever gave.
      const { text: reply } = await aiChat(
        next.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: m.content })),
        // The tab name is already the routing key for what data may enter the
        // prompt (see ally.js SCOPES), so it is the right key for where that
        // prompt may be sent. Same decision, enforced twice, in the same word.
        { system: systemPrompt(tab, context), agent: tab },
      );
      const id = `a${next.length}`;
      setMsgs([...next, { role: 'assistant', content: reply, id }]);
      setLiveId(id);
    } catch (e) {
      setMsgs([...next, { role: 'system', content: `✗ ${e.message}` }]);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button className="al-fab" onClick={() => setOpen(true)} title="Ask ALLY about this screen">
        <span className="al-fab-i">▮</span>
        <span className="al-fab-t">ALLY</span>
      </button>
    );
  }

  return (
    <div className="al">
      <div className="al-bar">
        <span className="al-dot" />
        <span className="al-title">ALLY</span>
        {/* What it can see, always visible. A scoped assistant that does not say
            what its scope is asks you to take the boundary on trust. */}
        <span className="al-scope" title={scope ? `Reading ${scope.blurb}` : 'No data from this screen'}>
          {scope ? `▸ ${scope.label.toUpperCase()}` : '▸ NO DATA'}
        </span>
        <span className="al-sp" />
        {provider && <span className="al-prov">{providerLabel(provider)}</span>}
        <button className="al-x" onClick={() => setOpen(false)}>✕</button>
      </div>

      <div className="al-screen">
        <div className="al-scan" aria-hidden="true" />
        {BOOT.map((b, i) => <div className="al-boot" key={i}>{b}</div>)}

        {!scope && (
          <div className="al-sys">
            This screen is not wired for context, so I answer from general
            knowledge only — I cannot see anything on it.
          </div>
        )}
        {scope && msgs.length === 0 && (
          <div className="al-sys">
            Reading {scope.blurb} — nothing else in the app. Ask away.
          </div>
        )}

        {msgs.map((m, i) => (
          <Line key={m.id || i} m={m} live={m.id != null && m.id === liveId} />
        ))}
        {busy && <div className="al-line al-assistant"><span className="al-who">ALLY</span><span className="al-body">▮ thinking</span></div>}
        <div ref={endRef} />
      </div>

      {msgs.length === 0 && scope && (
        <div className="al-quick">
          {PROMPTS.map(p => (
            <button key={p.label} className="al-chip" onClick={() => send(p.text)}>{p.label}</button>
          ))}
        </div>
      )}

      <div className="al-input">
        <span className="al-caret">&gt;</span>
        <input
          value={input}
          disabled={busy}
          placeholder="type a question…"
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && send()}
        />
        <button className="btn btn-sm btn-green" disabled={busy || !input.trim()} onClick={() => send()}>
          SEND
        </button>
      </div>
    </div>
  );
}
