import React, { useEffect, useMemo, useState } from 'react';
import { useCollection } from '../lib/hooks.js';
import { Card, Empty, StatTile } from '../components/ui.jsx';
import { getConfig, upsertMemory, list } from '../lib/db.js';
import {
  STATUSES, statusOf, normalizeResults, progressOf, statusDisagreement,
  shelfStats, SORTS, sortRows, filterRows,
} from '../lib/media.js';

// The media shelf.
//
// Everything the `movies` table cannot hold — episode counts, runtimes, the
// year, the synopsis — lives in a `media_meta` memory blob keyed by row id.
// That is the project's zero-migration rule, and it is why this component
// carries a `meta` object alongside `items` rather than reading one row shape.
//
// The layout is a poster grid rather than a list because a shelf is something
// you recognise rather than read: covers are how you find the thing you half
// remember. The list view stays available for when you want to compare.

const ep = (n) => `${n} ep${n === 1 ? '' : 's'}`;

function Stars({ value, onChange }) {
  // Five buttons, not a <select>. Rating is the one thing you do repeatedly on
  // this screen and a dropdown costs two clicks and a hunt every time.
  return (
    <span className="mv-stars">
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          className={`mv-star ${value >= n ? 'on' : ''}`}
          title={`${n} star${n === 1 ? '' : 's'}`}
          onClick={() => onChange(value === n ? null : n)}
        >★</button>
      ))}
    </span>
  );
}

function Poster({ row, meta, onPatch, onMeta, onDel, expanded, onExpand }) {
  const m = meta[row.id] || {};
  const p = progressOf(row, meta);
  const dis = statusDisagreement(row, meta);
  const st = statusOf(row.status);

  return (
    <div className={`mv-card ${expanded ? 'mv-open' : ''}`} style={{ '--mv-c': st.color }}>
      <button className="mv-art" onClick={onExpand} title={row.title}>
        {row.poster_url
          ? <img src={row.poster_url} alt="" style={{ imageRendering: 'pixelated' }} />
          : <span className="mv-noart">{row.type === 'tv' ? '📺' : '▶'}</span>}
        <span className="mv-badge">{row.type === 'tv' ? 'TV' : 'FILM'}</span>
        {row.rating ? <span className="mv-rate">{'★'.repeat(row.rating)}</span> : null}
      </button>

      <div className="mv-name" title={row.title}>{row.title}</div>
      <div className="mv-sub">
        {m.year || '—'} · <span style={{ color: st.color }}>{st.label.toLowerCase()}</span>
      </div>

      {/* A bar only when there is something real to draw. An unmeasured series
          gets the episode count in words instead of a bar pinned at zero, which
          would read as "you have watched none of it". */}
      {p.kind === 'tv' && (
        p.known
          ? (
            <div className="mv-prog" title={`${p.watched} of ${p.total}`}>
              <div className="mv-prog-fill" style={{ width: `${p.pct}%` }} />
              <span className="mv-prog-txt">{p.watched}/{p.total}</span>
            </div>
          )
          : <div className="mv-prog-none">{p.watched > 0 ? `${ep(p.watched)} watched · total unknown` : 'no episode count set'}</div>
      )}

      {dis && <div className="mv-flag">{dis.text}</div>}

      {expanded && (
        <div className="mv-detail">
          {m.overview && <p className="mv-overview">{m.overview}</p>}

          <div className="mv-line">
            <span className="mv-lbl">Rating</span>
            <Stars value={Number(row.rating) || 0} onChange={v => onPatch({ rating: v })} />
          </div>

          <div className="mv-line">
            <span className="mv-lbl">Shelf</span>
            <select value={row.status} onChange={e => onPatch({ status: e.target.value })}>
              {STATUSES.map(s => <option key={s.key} value={s.key}>{s.label.toLowerCase()}</option>)}
            </select>
          </div>

          {row.type === 'tv' && (
            <>
              <div className="mv-line">
                <span className="mv-lbl">Episodes</span>
                <input
                  type="number" min="0" className="mv-num" value={m.episodes_watched ?? ''}
                  placeholder="0"
                  onChange={e => onMeta({ episodes_watched: e.target.value === '' ? null : Number(e.target.value) })}
                />
                <span className="muted small">of</span>
                <input
                  type="number" min="0" className="mv-num" value={m.episodes_total ?? ''}
                  placeholder="?"
                  onChange={e => onMeta({ episodes_total: e.target.value === '' ? null : Number(e.target.value) })}
                />
                <button
                  className="btn btn-sm btn-green"
                  title="Watched one more"
                  onClick={() => onMeta({ episodes_watched: (Number(m.episodes_watched) || 0) + 1 })}
                >+1</button>
              </div>
              <div className="mv-line">
                <span className="mv-lbl">Ep length</span>
                <input
                  type="number" min="0" className="mv-num" value={m.episode_runtime ?? ''}
                  placeholder="min"
                  onChange={e => onMeta({ episode_runtime: e.target.value === '' ? null : Number(e.target.value) })}
                />
                <span className="muted small">minutes — used for hours watched</span>
              </div>
            </>
          )}

          {row.type === 'movie' && (
            <div className="mv-line">
              <span className="mv-lbl">Runtime</span>
              <input
                type="number" min="0" className="mv-num" value={m.runtime ?? ''}
                placeholder="min"
                onChange={e => onMeta({ runtime: e.target.value === '' ? null : Number(e.target.value) })}
              />
              <span className="muted small">minutes</span>
            </div>
          )}

          <div className="mv-line" style={{ justifyContent: 'space-between' }}>
            {m.tmdb_score
              ? <span className="chip c-purple">TMDB {Number(m.tmdb_score).toFixed(1)}</span>
              : <span />}
            <button className="btn btn-sm" onClick={onDel}>REMOVE</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Movies() {
  const { items, add, patch, del, refresh } = useCollection('movies');
  const [meta, setMeta] = useState({});
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [shelf, setShelf] = useState('watching');
  const [sort, setSort] = useState('added');
  const [find, setFind] = useState('');
  const [open, setOpen] = useState(null);
  const [view, setView] = useState('grid');
  const tmdbKey = (getConfig().tmdbKey || '').trim();

  useEffect(() => {
    let dead = false;
    list('memory', { filter: 'key=eq.media_meta' })
      .then(rows => { if (!dead && rows?.[0]?.value) setMeta(rows[0].value); })
      .catch(() => {});
    return () => { dead = true; };
  }, []);

  // Written straight back to the blob rather than accumulated locally: a half
  // saved episode count is worse than an unsaved one, because it looks saved.
  async function writeMeta(id, patchObj) {
    const next = { ...meta, [id]: { ...(meta[id] || {}), ...patchObj } };
    setMeta(next);
    try { await upsertMemory('media_meta', next); } catch { /* offline: local state stands */ }
  }

  async function search() {
    const term = q.trim();
    if (!term) return;
    if (!tmdbKey) {
      await add({ title: term, type: 'movie', status: 'watchlist', rating: null, poster_url: null });
      setQ('');
      return;
    }
    setBusy(true);
    try {
      const r = await fetch(`https://api.themoviedb.org/3/search/multi?query=${encodeURIComponent(term)}&api_key=${tmdbKey}`);
      const j = await r.json();
      setResults(normalizeResults(j.results || []).slice(0, 8));
    } catch { setResults([]); }
    finally { setBusy(false); }
  }

  async function addFrom(r) {
    const row = await add({
      title: r.title, type: r.type, status: 'watchlist',
      tmdb_id: r.tmdb_id, poster_url: r.poster_url, rating: null,
    });
    const id = row?.id || row?.[0]?.id;
    if (id) await writeMeta(id, { year: r.year, overview: r.overview, tmdb_score: r.tmdb_score });
    setResults([]); setQ('');
    refresh?.();
  }

  const stats = useMemo(() => shelfStats(items, meta), [items, meta]);
  const shown = useMemo(
    () => sortRows(filterRows(items, { status: shelf, q: find }), sort, meta),
    [items, shelf, find, sort, meta],
  );

  const hours = stats.time.exact
    ? `${stats.time.hours.toFixed(1)}h`
    : `~${stats.time.estHours.toFixed(1)}h`;

  return (
    <>
      <h1 className="tab-title">MEDIA</h1>
      <p className="tab-sub">Your own Letterboxd — movies & TV, tracked.</p>

      <div className="tile-row">
        <StatTile label="Titles" value={stats.total} note={`${stats.movies} film · ${stats.tv} tv`} color="var(--cyan)" />
        <StatTile label="Completed" value={stats.byStatus.completed} note={`${stats.byStatus.watching} in progress`} color="var(--green)" />
        <StatTile
          label="Time watched" value={hours}
          // Never a bare number when runtimes are missing — the tilde and the
          // note are the difference between a measurement and a guess.
          note={stats.time.exact ? 'from recorded runtimes' : `estimated · ${stats.time.unknownEpisodes} eps, ${stats.time.unknownItems} films unmeasured`}
          color="var(--orange)"
        />
        <StatTile
          label="Average rating"
          value={stats.avgRating == null ? '—' : `${stats.avgRating.toFixed(1)}★`}
          note={stats.rated ? `${stats.rated} rated · ${stats.unrated} not` : 'nothing rated yet'}
          color="var(--yellow)"
        />
      </div>

      <Card title="Add title" color="var(--yellow)">
        <div className="flex">
          <input
            placeholder={tmdbKey ? 'Search TMDB…' : 'Title (add a TMDB key in Settings for posters and search)'}
            value={q} onChange={e => setQ(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && search()}
          />
          <button className="btn btn-green" onClick={search} disabled={busy}>
            {busy ? '…' : tmdbKey ? 'SEARCH' : '+ ADD'}
          </button>
        </div>
        {results.length > 0 && (
          <div className="mv-results">
            {results.map(r => (
              <div className="row" key={`${r.type}-${r.tmdb_id}`}>
                {r.poster_url
                  ? <img src={r.poster_url} alt="" className="mv-thumb" style={{ imageRendering: 'pixelated' }} />
                  : <span className="mv-thumb mv-noart">{r.type === 'tv' ? '📺' : '▶'}</span>}
                <span style={{ flex: 1 }}>
                  {r.title} <span className="muted small">({r.year || '—'})</span>
                  {r.overview && <div className="small muted mv-res-over">{r.overview.slice(0, 140)}{r.overview.length > 140 ? '…' : ''}</div>}
                </span>
                <span className="chip c-purple">{r.type}</span>
                <button className="btn btn-sm btn-green" onClick={() => addFrom(r)}>+ ADD</button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="mv-bar">
        <div className="flex">
          {STATUSES.map(s => (
            <button
              key={s.key}
              className={`btn btn-sm ${shelf === s.key ? 'btn-pink' : ''}`}
              onClick={() => { setShelf(s.key); setOpen(null); }}
            >
              {s.label}<span className="news-count">{stats.byStatus[s.key]}</span>
            </button>
          ))}
        </div>
        <div className="flex">
          <input
            className="mv-find" placeholder="find…" value={find}
            onChange={e => setFind(e.target.value)}
          />
          <select value={sort} onChange={e => setSort(e.target.value)} style={{ width: 110 }}>
            {SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <button className="btn btn-sm" onClick={() => setView(view === 'grid' ? 'list' : 'grid')}>
            {view === 'grid' ? 'LIST' : 'GRID'}
          </button>
        </div>
      </div>

      <Card title={`${statusOf(shelf).label} (${shown.length})`} color={statusOf(shelf).color}>
        {shown.length === 0
          ? <Empty icon="▶" text={find ? `Nothing on this shelf matches “${find}”.` : 'Empty shelf.'} />
          : view === 'grid'
            ? (
              <div className="mv-grid">
                {shown.map(r => (
                  <Poster
                    key={r.id} row={r} meta={meta}
                    expanded={open === r.id}
                    onExpand={() => setOpen(open === r.id ? null : r.id)}
                    onPatch={p => patch(r.id, p)}
                    onMeta={p => writeMeta(r.id, p)}
                    onDel={() => del(r.id)}
                  />
                ))}
              </div>
            )
            : (
              <div>
                {shown.map(r => {
                  const p = progressOf(r, meta);
                  return (
                    <div className="row" key={r.id}>
                      <span style={{ flex: 1 }}>{r.title}</span>
                      <span className="chip">{r.type}</span>
                      {p.kind === 'tv' && (
                        <span className="chip c-cyan">{p.known ? `${p.watched}/${p.total}` : `${p.watched} ep`}</span>
                      )}
                      <Stars value={Number(r.rating) || 0} onChange={v => patch(r.id, { rating: v })} />
                      <select value={r.status} onChange={e => patch(r.id, { status: e.target.value })} style={{ width: 130 }}>
                        {STATUSES.map(s => <option key={s.key} value={s.key}>{s.label.toLowerCase()}</option>)}
                      </select>
                      <button className="btn btn-sm" onClick={() => del(r.id)}>✕</button>
                    </div>
                  );
                })}
              </div>
            )}
      </Card>
    </>
  );
}
