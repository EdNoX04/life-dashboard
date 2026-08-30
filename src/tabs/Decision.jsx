import React, { useState } from 'react';
import { Card, Empty, StatTile } from '../components/ui.jsx';
import { useCollection } from '../lib/hooks.js';
import { decisionsFrom, decisionTemplate } from '../lib/decisions.js';

// DECISION — now a view onto the vault rather than a list of its own.
//
// What this replaced: a form with four inputs writing to memory.decisions_log,
// plus a "similar-situation engine" card that was a promise rather than a
// feature. Its own comment called it a scaffold.
//
// The problem with the old shape was not that it was unfinished. It is that
// "situation / options / chose / why" in four boxes is not how anyone actually
// records a decision, so it did not get used — and the one question a decision
// log exists to answer six months later is "did I already think about this?",
// which needs the rejected options written out, not a dropdown.
//
// So decisions live in `decisions/` in the vault, in Markdown, written wherever
// Markdown can be written — Obsidian on either machine, and the WhatsApp bot
// later. This tab reads the index the vault publishes, and links back into
// Obsidian for editing. It deliberately cannot write: the vault is a private git
// repo and the browser has no way to push to it, and a second write path that
// bypassed git would put the tab and the notes permanently out of step.
//
// The old decisions_log is still read and shown, marked as legacy, because
// silently dropping someone's records to ship a cleaner design is not an upgrade.

export default function Decision() {
  const { items: brainMem } = useCollection('memory', { filter: 'key=eq.brain_index', order: 'key' });
  const { items: legacyMem } = useCollection('memory', { filter: 'key=eq.decisions_log', order: 'key' });
  const [copied, setCopied] = useState('');

  const index = brainMem?.[0]?.value || null;
  const decisions = decisionsFrom(index);
  const legacy = legacyMem?.[0]?.value?.list || [];

  const resolved = decisions.filter(d => d.resolved);
  const worked = resolved.filter(d => d.verdict === 'worked').length;
  const rate = resolved.length ? Math.round((worked / resolved.length) * 100) : null;

  async function copyTemplate() {
    try {
      await navigator.clipboard.writeText(decisionTemplate());
      setCopied('Template copied — new note in Obsidian, paste, write.');
    } catch {
      setCopied('Could not reach the clipboard. Open Obsidian and start from any decision note.');
    }
    setTimeout(() => setCopied(''), 6000);
  }

  return (
    <>
      <h1 className="tab-title">DECISION</h1>
      <p className="tab-sub">Every choice, what you turned down, and how it went. Written in the vault. 🧭</p>

      <div className="tile-row">
        <StatTile label="Decisions" value={decisions.length} color="var(--cyan)" />
        <StatTile label="With an outcome" value={resolved.length} color="var(--purple)" />
        <StatTile label="Worked out" value={rate != null ? `${rate}%` : '—'}
          note={resolved.length ? `${worked}/${resolved.length}` : 'none resolved yet'} color="var(--green)" />
      </div>

      <Card title="Write one" color="var(--yellow)"
        right={<button className="btn btn-sm" onClick={copyTemplate}>copy template</button>}>
        <div className="small" style={{ lineHeight: 1.6 }}>
          Decisions are notes in <code>decisions/</code>. Copy the template, make a new note in
          Obsidian, and write it there — the vault syncs itself and this tab follows within a
          minute of the push.
          {/* The rejected options are the whole point and the thing everyone skips,
              so it gets said here rather than only in CONVENTIONS.md. */}
          <div className="mt" style={{ color: 'var(--ink-2)' }}>
            Write down what you <b style={{ fontWeight: 'normal', color: 'var(--yellow)' }}>rejected</b> and why.
            In six months the question is never “what did I choose” — it is “did I already think about this?”,
            and only the rejected options can answer that.
          </div>
        </div>
        {copied && <div className="small mt" style={{ color: 'var(--green)' }}>{copied}</div>}
      </Card>

      <Card title="Decisions" color="var(--purple)">
        {!index && <Empty icon="◷" text="Waiting for the vault index — it lands on the next push to the brain repo." />}
        {index && decisions.length === 0 && (
          <Empty icon="🧭" text="No decision notes yet. Copy the template above and write the first one." />
        )}
        {decisions.map(d => (
          <div className="dec-item" key={d.path}>
            <div className="spread" style={{ gap: 8, flexWrap: 'wrap' }}>
              <span style={{ flex: 1, minWidth: 200 }}>
                <a href={d.obsidian} className="dec-title">{d.title}</a>
                {d.why && <div className="small muted" style={{ marginTop: 3 }}>{d.why}</div>}
              </span>
              <span className="flex" style={{ gap: 5, alignItems: 'flex-start' }}>
                {d.decided && <span className="chip">{d.decided}</span>}
                {d.resolved
                  ? <span className={`chip ${d.verdict === 'worked' ? 'c-green' : d.verdict === 'didn’t' ? 'c-red' : ''}`}>{d.verdict}</span>
                  : <span className="chip" style={{ color: 'var(--ink-3)' }}>open</span>}
              </span>
            </div>
            {d.rejected && (
              <div className="small mt" style={{ lineHeight: 1.55 }}>
                <span style={{ color: 'var(--yellow)' }}>Rejected — </span>
                <span className="muted">{d.rejected}</span>
              </div>
            )}
            {d.cost && (
              <div className="small" style={{ lineHeight: 1.55 }}>
                <span style={{ color: 'var(--orange)' }}>Cost — </span>
                <span className="muted">{d.cost}</span>
              </div>
            )}
            {d.outcome && (
              <div className="small mt" style={{ lineHeight: 1.55 }}>
                <span style={{ color: 'var(--green)' }}>Outcome — </span>
                <span className="muted">{d.outcome}</span>
              </div>
            )}
            {!d.resolved && (
              // No button here on purpose. Marking an outcome means writing what
              // happened, in the note; a one-click "worked ✓" records a verdict
              // with none of the reasoning, which is the part worth having.
              <div className="small mt" style={{ color: 'var(--ink-3)' }}>
                No outcome yet — add an <code>## Outcome</code> section to the note when you know.
              </div>
            )}
          </div>
        ))}
      </Card>

      <Card title="Ask about a past decision" color="var(--pink)">
        <div className="small" style={{ lineHeight: 1.6 }}>
          {/* This card used to promise a "similar-situation engine" that scanned
              history and predicted odds. It never existed. What DOES exist now is
              retrieval over the vault, so the honest version is: ask. */}
          PLAYER TWO reads these notes. Ask it “what did I decide about X, and what did I reject?”
          and it answers from the note itself rather than from a summary of it.
        </div>
      </Card>

      {legacy.length > 0 && (
        <Card title="Logged in the app, before the vault" color="var(--ink-3)">
          <div className="small muted" style={{ marginBottom: 8, lineHeight: 1.55 }}>
            {legacy.length} decision{legacy.length === 1 ? '' : 's'} recorded by the old form. Still here,
            still readable. Worth rewriting as notes when you next touch them — that is where the
            reasoning has room to live.
          </div>
          {legacy.map(d => (
            <div className="dec-item" key={d.id}>
              <div className="spread" style={{ gap: 8, flexWrap: 'wrap' }}>
                <span style={{ flex: 1, minWidth: 160 }}>
                  {d.situation}
                  <div className="small muted">chose: <span style={{ color: 'var(--cyan)' }}>{d.chosen}</span>{d.note ? ` · ${d.note}` : ''}</div>
                </span>
                <span className="flex" style={{ gap: 5 }}>
                  <span className="chip">{d.at}</span>
                  {d.outcome && d.outcome !== 'pending' && (
                    <span className={`chip ${d.outcome === 'success' ? 'c-green' : 'c-red'}`}>
                      {d.outcome === 'success' ? 'worked' : 'didn’t'}
                    </span>
                  )}
                </span>
              </div>
            </div>
          ))}
        </Card>
      )}
    </>
  );
}
