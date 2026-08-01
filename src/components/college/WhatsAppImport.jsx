import React, { useState, useMemo, useRef } from 'react';
import * as W from '../../lib/whatsapp.js';
import * as db from '../../lib/db.js';
import { Card, Empty } from '../ui.jsx';

// The screen half of lib/whatsapp.js. Its whole job is decision 2 made real:
// the parser proposes, Neel confirms, and nothing crosses into the announcements
// table without a click. Three things follow from that and are worth stating,
// because they all look like friction until you know why they are there.
//
//   Nothing starts selected. Pre-ticking every row would make "Import 47" the
//   default action, which is bulk-accepting a machine's reading of other
//   people's writing — exactly the thing decision 2 exists to prevent. There is
//   a "select all shown" button, so the cost is one click, not forty.
//
//   The filtered-out pile is reachable. It is collapsed, because it is mostly
//   "ok" and "thanks", but a registration link wrongly binned is the one failure
//   this feature cannot recover from, so the bin is never sealed.
//
//   Calendar writing is a separate opt-in from importing. Importing puts a row
//   in a table Neel already reads; the calendar is shared with the rest of his
//   life and a wrong entry there costs more than a wrong row here.

const KIND_ORDER = ['placement', 'exam', 'announcement', 'unsorted'];

export function HowTo() {
  return (
    <ol className="wa-how">
      {W.HOWTO.map((s, i) => (
        <li className="wa-how-step" key={i}>
          <span className="wa-how-n">{i + 1}</span>
          <span>{s}</span>
        </li>
      ))}
    </ol>
  );
}

export function MetaStrip({ meta, digest }) {
  if (!meta) return null;
  return (
    <div className="wa-meta">
      <div className="wa-meta-line">{W.statLine(digest, meta)}</div>
      {meta.from && (
        <div className="wa-meta-line wa-meta-dim">
          {meta.from} → {meta.to} · {meta.authors} {meta.authors === 1 ? 'person' : 'people'} · {meta.format} export
        </div>
      )}
      {/* Decision 5 surfaced. When the file settled its own date order this is a
          statement of fact; when it did not, it is an admission, and the two are
          coloured differently so the reader can tell which one they got. */}
      <p className={`wa-note${meta.orderSettled ? '' : ' wa-note-warn'}`}>{meta.orderNote}</p>
      {meta.skipped > 0 && (
        <p className="wa-note wa-note-warn">
          {meta.skipped} line{meta.skipped === 1 ? '' : 's'} did not look like a WhatsApp export and were ignored.
        </p>
      )}
    </div>
  );
}

export function ItemRow({ item, checked, onToggle }) {
  const meta = W.kindMeta(item.kind);
  const dl = item.deadline;
  return (
    <div className={`wa-item${checked ? ' wa-item-sel' : ''}`}>
      <button
        className={`wa-check${checked ? ' on' : ''}`}
        onClick={() => onToggle(item.id)}
        aria-label={checked ? 'deselect' : 'select'}
      >{checked ? '×' : ''}</button>

      <div className="wa-body">
        <div className="wa-head">
          <span className="wa-title">{item.title}</span>
          {item.company && <span className="wa-co">{item.company}</span>}
        </div>

        <div className="wa-who">
          <span className="wa-when">{item.date} {item.time}</span>
          {item.author && <span className="wa-author">{item.author}</span>}
          {item.copies > 1 && <span className="wa-copies">forwarded ×{item.copies}</span>}
          <span className="wa-kind" style={{ color: meta.color, borderColor: meta.color }}>{meta.label}</span>
        </div>

        {/* Decision 4: the phrases that actually matched, not a number. */}
        {item.signals.length > 0 && (
          <div className="wa-sigs">
            {item.signals.map(s => <span className="wa-sig" key={s}>{s}</span>)}
          </div>
        )}

        {dl && (
          <div className={`wa-dl${dl.cued ? '' : ' wa-dl-soft'}`}>
            <span className="wa-dl-date">{dl.cued ? 'deadline' : 'date mentioned'} {dl.date}</span>
            <span className="wa-dl-raw">“{dl.raw}”</span>
            {/* Decision 1: an assumption is printed, never absorbed. */}
            {dl.assumedYear && <span className="wa-dl-warn">year assumed</span>}
            {dl.dayFirstAssumed && <span className="wa-dl-warn">read day/month</span>}
          </div>
        )}

        {item.links.length > 0 && (
          <div className="wa-links">
            {item.links.map(l => (
              <a className="wa-link" key={l.href} href={l.href} target="_blank" rel="noreferrer">
                {l.kind} ↗
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function WhatsAppImport() {
  const fileRef = useRef(null);
  const [parsed, setParsed] = useState(null);
  const [tab, setTab] = useState('placement');
  const [sel, setSel] = useState(() => new Set());
  const [showNoise, setShowNoise] = useState(false);
  const [toCal, setToCal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');
  const [err, setErr] = useState('');
  const [pasting, setPasting] = useState(false);
  const [draft, setDraft] = useState('');

  function load(text) {
    setErr(''); setDone('');
    const p = W.parseChat(text);
    if (!p.messages.length) {
      setParsed(null);
      setErr('No WhatsApp messages found in that file. Export the chat again with "Without media" and drop the .txt, not the zip.');
      return;
    }
    const d = W.digest(p.messages);
    setParsed({ meta: p.meta, d });
    // Nothing is selected. See the header note.
    setSel(new Set());
    const firstFull = KIND_ORDER.find(k => d[k].length > 0);
    setTab(firstFull || 'placement');
  }

  async function onFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    try { load(await f.text()); }
    catch { setErr('Could not read that file.'); }
    e.target.value = '';
  }

  const shown = parsed ? parsed.d[tab] || [] : [];
  const chosen = useMemo(() => {
    if (!parsed) return [];
    return parsed.d.items.filter(i => sel.has(i.id));
  }, [parsed, sel]);

  const withDates = chosen.filter(i => i.deadline);

  function toggle(id) {
    setSel(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }
  function selectShown() { setSel(prev => new Set([...prev, ...shown.map(i => i.id)])); }
  function clearSel() { setSel(new Set()); }

  async function doImport() {
    if (!chosen.length || busy) return;
    setBusy(true); setErr(''); setDone('');
    let saved = 0, cal = 0;
    try {
      for (const it of chosen) {
        await db.insert('announcements', W.toAnnouncement(it));
        saved++;
        // Only a CUED date goes on the calendar. An uncued date is a date the
        // message happened to mention — "the fest was on 5 July" — and putting
        // that on a calendar invents an appointment out of a reminiscence.
        if (toCal && it.deadline?.cued) {
          await db.sendRequest('calendar_add', {
            summary: it.company ? `${it.company} — ${it.title}` : it.title,
            start: `${it.deadline.date}T09:00:00`,
            end: `${it.deadline.date}T09:30:00`,
            timeZone: 'Asia/Kolkata',
            allDay: true,
          });
          cal++;
        }
      }
      setDone(`Imported ${saved} to announcements${cal ? `, ${cal} queued for the calendar` : ''}. They show up in College, and the placement ones in Placement.`);
      setSel(new Set());
    } catch (e) {
      // Partial success is stated as partial. Saying "failed" after 12 of 20 rows
      // landed would send Neel back to re-import 12 duplicates.
      setErr(`Stopped after ${saved} row${saved === 1 ? '' : 's'}: ${e.message}`);
    }
    setBusy(false);
  }

  return (
    <Card title="Import from WhatsApp" color="var(--green)"
      right={<span className="wa-badge">chat export</span>}>

      {!parsed && (
        <>
          <p className="wa-lede">
            College notices and company registrations arrive in group chats. WhatsApp has no
            API a personal app is allowed to read, so this reads the export WhatsApp gives you.
          </p>
          <HowTo />
          <div className="wa-drop">
            <input ref={fileRef} type="file" accept=".txt,text/plain" style={{ display: 'none' }} onChange={onFile} />
            <button className="btn btn-green" onClick={() => fileRef.current?.click()}>Choose _chat.txt</button>
            <button className="btn btn-sm" onClick={() => setPasting(v => !v)}>
              {pasting ? 'cancel paste' : 'or paste the text'}
            </button>
          </div>
          {pasting && (
            <div className="wa-paste">
              <textarea
                className="wa-textarea"
                rows={6}
                value={draft}
                placeholder={'13/07/2026, 9:01 am - Placement Cell: …'}
                onChange={e => setDraft(e.target.value)}
              />
              <button className="btn btn-cyan btn-sm" onClick={() => load(draft)}>Read it</button>
            </div>
          )}
        </>
      )}

      {err && <p className="wa-err">{err}</p>}

      {parsed && (
        <>
          <MetaStrip meta={parsed.meta} digest={parsed.d} />

          <div className="wa-tabs">
            {KIND_ORDER.map(k => {
              const n = parsed.d[k].length;
              const m = W.kindMeta(k);
              return (
                <button key={k} className={`wa-tab${tab === k ? ' on' : ''}`}
                  style={tab === k ? { color: m.color, borderColor: m.color } : undefined}
                  onClick={() => setTab(k)}>
                  {m.label} <span className="wa-tab-n">{n}</span>
                </button>
              );
            })}
          </div>

          <div className="wa-actions">
            <button className="btn btn-sm" onClick={selectShown} disabled={!shown.length}>select all shown</button>
            <button className="btn btn-sm" onClick={clearSel} disabled={!sel.size}>clear</button>
            <label className="wa-cal">
              <input type="checkbox" checked={toCal} onChange={e => setToCal(e.target.checked)} />
              <span>also put dated ones on the calendar</span>
            </label>
          </div>

          <div className="wa-list">
            {shown.length === 0 && (
              <Empty icon="∅" text={
                tab === 'unsorted'
                  ? 'Nothing was left over — every kept message matched a category.'
                  : `Nothing in this file looked like ${W.kindMeta(tab).label.toLowerCase()}.`
              } />
            )}
            {shown.map(it => (
              <ItemRow key={it.id} item={it} checked={sel.has(it.id)} onToggle={toggle} />
            ))}
          </div>

          <div className="wa-bar">
            <span className="wa-count">
              {sel.size ? `${sel.size} selected` : 'nothing selected'}
              {toCal && withDates.length > 0 && ` · ${withDates.filter(i => i.deadline.cued).length} with a deadline`}
            </span>
            <button className="btn btn-green" onClick={doImport} disabled={!sel.size || busy}>
              {busy ? 'importing…' : `Import ${sel.size || ''}`.trim()}
            </button>
          </div>

          {done && <p className="wa-done">{done}</p>}

          <div className="wa-noise">
            <button className="btn btn-sm" onClick={() => setShowNoise(v => !v)}>
              {showNoise ? 'hide' : 'show'} the {parsed.d.noise.length} filtered out
            </button>
            {showNoise && (
              <>
                <p className="wa-note">
                  Dropped for what they are — system lines, deleted messages, one-word replies —
                  not for what they seemed to mean. If a notice is in here, that is a bug worth telling me about.
                </p>
                <div className="wa-noise-list">
                  {parsed.d.noise.slice(0, 60).map(n => (
                    <div className="wa-noise-row" key={n.id}>
                      <span className="wa-noise-who">{n.author || 'system'}</span>
                      <span className="wa-noise-txt">{n.text.slice(0, 80)}</span>
                    </div>
                  ))}
                  {parsed.d.noise.length > 60 && (
                    <div className="wa-noise-row wa-noise-more">
                      …and {parsed.d.noise.length - 60} more
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          <div className="wa-reset">
            <button className="btn btn-sm" onClick={() => { setParsed(null); setSel(new Set()); setDone(''); }}>
              read a different export
            </button>
          </div>
        </>
      )}

      <p className="wa-disc">{W.DISCLAIMER}</p>
    </Card>
  );
}
