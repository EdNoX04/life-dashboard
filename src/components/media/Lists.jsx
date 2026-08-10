import React, { useMemo, useState } from 'react';
import { Card, Empty } from '../ui.jsx';
import {
  makeList, addList, removeList, renameList, findList, addTo, removeFrom,
  moveItem, noteOn, listProgress, sortItems, LIST_SORTS, itemKey,
} from '../../lib/medialists.js';
import { watchedKeys } from '../../lib/medialog.js';

// Custom lists. Not saved searches — see lib/medialists.js for why that
// distinction is the entire feature.
//
// The screen is deliberately two panes: the lists themselves, and one open
// list. A single flat view of every list and every film would be the thing
// people actually build and then never use, because the only reason to make a
// list is to look at it on its own.

function Progress({ p }) {
  if (!p.total) return null;
  return (
    <span className="ml-prog" title={`${p.seen} of ${p.total} watched`}>
      <i style={{ width: `${p.pct ?? 0}%` }} />
      <b>{p.seen}/{p.total}</b>
    </span>
  );
}

export default function Lists({ lists = [], log = [], onChange, onOpenTitle }) {
  const [openId, setOpenId] = useState(null);
  const [name, setName] = useState('');
  const [ranked, setRanked] = useState(false);
  const [sort, setSort] = useState('manual');
  const [editing, setEditing] = useState(null);

  const watched = useMemo(() => watchedKeys(log), [log]);
  const open = findList(lists, openId);
  const shown = open ? sortItems(open, sort) : [];

  const create = () => {
    const l = makeList({ name, ranked });
    if (!l) return;
    const next = addList(lists, l);
    onChange(next);
    setName(''); setRanked(false);
    setOpenId(next[next.length - 1].id);
  };

  if (open) {
    const p = listProgress(open, watched);
    return (
      <Card
        title={open.name}
        color="var(--yellow)"
        right={(
          <span className="flex" style={{ gap: 6 }}>
            {/* Sorting is hidden on a ranked list rather than disabled: offering
                a control that refuses to work is worse than not offering it. */}
            {!open.ranked && (
              <select value={sort} onChange={e => setSort(e.target.value)} style={{ width: 100 }}>
                {LIST_SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            )}
            <button className="btn btn-sm" onClick={() => { setOpenId(null); setSort('manual'); }}>← LISTS</button>
          </span>
        )}
      >
        {open.description && <p className="ml-desc">{open.description}</p>}
        <div className="ml-head">
          <Progress p={p} />
          <span className="muted small">
            {open.ranked ? 'ranked — order is the content, so sorting is off' : 'unranked'}
            {p.done && ' · you have watched all of it'}
          </span>
        </div>

        {shown.length === 0 && (
          <Empty icon="☰" text="Nothing on this list yet. Open any title and use ADD TO LIST — a film can sit on as many lists as you like, whatever shelf it is on." />
        )}

        {shown.map((i, idx) => (
          <div className="ml-row" key={i.key}>
            {open.ranked && <span className="ml-rank">{idx + 1}</span>}
            <span className="ml-art">
              {i.poster_url
                ? <img src={i.poster_url} alt="" loading="lazy" style={{ imageRendering: 'pixelated' }} />
                : <b>{i.kind === 'movie' ? '▶' : '📺'}</b>}
            </span>
            <span className="ml-t">
              <button className="ml-link" onClick={() => onOpenTitle?.(i)}>{i.title}</button>
              <i className="muted">{i.year || '—'}</i>
              {i.note && <i className="ml-note">{i.note}</i>}
            </span>
            {/* Watched is read off the diary, so a film seen years ago and never
                shelved still shows as seen here. */}
            {(watched.has(i.key) || watched.has(`t:${String(i.title).toLowerCase()}`)) && (
              <span className="chip c-green">seen</span>
            )}
            {open.ranked && (
              <>
                <button className="btn btn-sm" title="Up" onClick={() => onChange(moveItem(lists, open.id, i.key, -1))}>↑</button>
                <button className="btn btn-sm" title="Down" onClick={() => onChange(moveItem(lists, open.id, i.key, 1))}>↓</button>
              </>
            )}
            <button className="btn btn-sm" title="Note"
              onClick={() => {
                const note = window.prompt('Note on this entry', i.note || '');
                if (note !== null) onChange(noteOn(lists, open.id, i.key, note));
              }}>✎</button>
            <button className="btn btn-sm" onClick={() => onChange(removeFrom(lists, open.id, i.key))}>✕</button>
          </div>
        ))}
      </Card>
    );
  }

  return (
    <Card title="Lists" color="var(--yellow)" right={<span className="chip c-yellow">{lists.length}</span>}>
      <div className="ml-new">
        <input
          placeholder="New list — “Sunday afternoon”, “show Ma”…"
          value={name} onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && create()}
        />
        <label className="ml-check">
          <input type="checkbox" checked={ranked} onChange={e => setRanked(e.target.checked)} />
          ranked
        </label>
        <button className="btn btn-green" onClick={create} disabled={!name.trim()}>+ CREATE</button>
      </div>
      <p className="ml-hint">
        A list is not a shelf. A shelf says where you are with a film — one
        status, always exactly one. A list says something about the film, and a
        film can be on as many as you like whether or not you have seen it. Tick
        <b> ranked</b> when the order matters; the list then numbers itself and
        refuses to be re-sorted.
      </p>

      {lists.length === 0 && (
        <Empty icon="☰" text="No lists yet." />
      )}

      {lists.map(l => {
        const p = listProgress(l, watched);
        return (
          <div className="ml-row" key={l.id}>
            <button className="ml-link ml-name" onClick={() => setOpenId(l.id)}>
              {l.name}
              {l.ranked && <i className="chip c-purple">ranked</i>}
            </button>
            <Progress p={p} />
            <span className="muted small">{l.items.length} title{l.items.length === 1 ? '' : 's'}</span>
            <button className="btn btn-sm" onClick={() => {
              const n = window.prompt('Rename list', l.name);
              if (n) onChange(renameList(lists, l.id, n));
            }}>✎</button>
            <button className="btn btn-sm" onClick={() => {
              // A list is cheap to rebuild but its ORDER is not, so deleting one
              // asks first. Removing a film from a list does not.
              if (window.confirm(`Delete “${l.name}”? The films stay on your shelf; only the list goes.`)) {
                onChange(removeList(lists, l.id));
                if (openId === l.id) setOpenId(null);
              }
            }}>✕</button>
          </div>
        );
      })}
    </Card>
  );
}

// The little menu that puts a title on a list from anywhere — the preview
// sheet, a shelf card, a discover poster. Shows ticks rather than making you
// remember what is already where.
export function AddToList({ lists = [], title, onChange, onClose }) {
  const [fresh, setFresh] = useState('');
  const key = itemKey(title);
  const on = new Set(lists.filter(l => l.items.some(i => i.key === key)).map(l => l.id));

  return (
    <div className="ls-back" onClick={onClose}>
      <div className="ls" onClick={e => e.stopPropagation()} style={{ maxWidth: 380 }}>
        <div className="ls-head">
          <span className="ls-title">Add to list</span>
          <button className="btn btn-sm" onClick={onClose}>✕</button>
        </div>
        <p className="ml-hint" style={{ marginTop: 0 }}>{title?.title}</p>

        {lists.length === 0 && <p className="pv-none">No lists yet — make one below.</p>}

        {lists.map(l => (
          <button
            key={l.id}
            className={`ml-pick${on.has(l.id) ? ' on' : ''}`}
            onClick={() => onChange(on.has(l.id)
              ? removeFrom(lists, l.id, key)
              : addTo(lists, l.id, title))}
          >
            <b>{on.has(l.id) ? '✓' : '+'}</b>
            <span>{l.name}</span>
            <i className="muted">{l.items.length}</i>
          </button>
        ))}

        <div className="ml-new" style={{ marginTop: 10 }}>
          <input placeholder="New list…" value={fresh} onChange={e => setFresh(e.target.value)}
            onKeyDown={e => {
              if (e.key !== 'Enter') return;
              const l = makeList({ name: fresh });
              if (!l) return;
              const next = addList(lists, l);
              onChange(addTo(next, next[next.length - 1].id, title));
              setFresh('');
            }} />
          <span className="muted small">enter to create and add</span>
        </div>
      </div>
    </div>
  );
}
