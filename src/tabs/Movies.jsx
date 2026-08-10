import React, { useEffect, useMemo, useState } from 'react';
import { useCollection } from '../lib/hooks.js';
import { Card, Empty, StatTile } from '../components/ui.jsx';
import { getConfig, upsertMemory, list } from '../lib/db.js';
import {
  STATUSES, statusOf, normalizeResults, progressOf, statusDisagreement,
  shelfStats, SORTS, sortRows, filterRows,
} from '../lib/media.js';
import { addViewing, removeViewing } from '../lib/medialog.js';
import Diary from '../components/media/Diary.jsx';
import LogSheet from '../components/media/LogSheet.jsx';
import Preview from '../components/media/Preview.jsx';
import Episodes from '../components/media/Episodes.jsx';
import Discover from '../components/media/Discover.jsx';
import Lists, { AddToList } from '../components/media/Lists.jsx';
import { searchTmdb, fetchRaw } from '../lib/tmdb.js';
import { KINDS, kindOf, isEpisodic, guessKind, progressFor } from '../lib/kinds.js';

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

function Poster({ row, meta, onPatch, onMeta, onDel, onLog, onPreview, onEpisodes, onList, expanded, onExpand }) {
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
        {/* The badge carries the finer kind now. A sitcom and a drama are both
            "TV" and are not the same thing to track. */}
        <span className="mv-badge" style={{ color: kindOf(m.kind || row.type).color }}>
          {kindOf(m.kind || row.type).label}
        </span>
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
            <span className="mv-lbl">Kind</span>
            <select value={m.kind || row.type} onChange={e => onMeta({ kind: e.target.value })}>
              {KINDS.filter(k => k.type === row.type).map(k => (
                <option key={k.key} value={k.key}>{k.label.toLowerCase()}</option>
              ))}
            </select>
            <span className="muted small">
              {kindOf(m.kind || row.type).progress === 'position'
                ? 'tracked by where you are, not how much is left'
                : 'tracked toward finishing it'}
            </span>
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

          {/* The one action that turns this shelf into a diary. Placed with the
              other controls rather than hidden behind the status dropdown,
              because "I watched this tonight" is the thing you came here to
              say - and if it costs a hunt, it stops getting said. */}
          <div className="mv-line">
            <button className="btn btn-sm btn-green" onClick={onLog}>+ LOG A VIEWING</button>
            {row.tmdb_id && <button className="btn btn-sm" onClick={onPreview}>DETAILS</button>}
            <button className="btn btn-sm" onClick={onList}>ADD TO LIST</button>
            {row.type === 'tv' && row.tmdb_id && (
              <button className="btn btn-sm btn-cyan" onClick={onEpisodes}>EPISODES</button>
            )}
            <span className="muted small">date watched · cast · where to stream</span>
          </div>

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
  // SHELF is what you own and plan to watch. DIARY is what you actually
  // watched, and when. They answer different questions off different data, so
  // they are separate screens rather than a filter on one.
  const [screen, setScreen] = useState('shelf');
  const [log, setLog] = useState([]);
  const [sheet, setSheet] = useState(null);   // {entry} | {title, kind, ...}
  // The preview sheet. Opened from a search result BEFORE adding, which is the
  // whole point of it: two films share a title and a series has four spin-offs,
  // and a poster alone was never enough to tell them apart.
  const [preview, setPreview] = useState(null);
  // The episode grid. Needs the TMDB detail payload for its season list, so it
  // is opened with whatever DETAILS already fetched rather than refetching.
  const [episodes, setEpisodes] = useState(null);
  const [detailCache, setDetailCache] = useState({});
  const [lists, setLists] = useState([]);
  const [listFor, setListFor] = useState(null);   // title being filed
  const [searchErr, setSearchErr] = useState(null);
  const [loadErr, setLoadErr] = useState(null);
  const tmdbKey = (getConfig().tmdbKey || '').trim();

  useEffect(() => {
    let dead = false;
    list('memory', { filter: 'key=eq.media_meta', order: 'key' })
      .then(rows => { if (!dead && rows?.[0]?.value) setMeta(rows[0].value); })
      .catch(e => { if (!dead) setLoadErr(String(e.message || e)); });
    // The viewing log. A blob rather than a table, like media_meta, but shaped
    // like rows - every entry carries its own id and nothing depends on array
    // position, so it can become a real table later without touching a caller.
    list('memory', { filter: 'key=eq.media_log', order: 'key' })
      .then(rows => { if (!dead && Array.isArray(rows?.[0]?.value?.entries)) setLog(rows[0].value.entries); })
      // NOT swallowed. A caught-and-ignored read turns "the request was
      // rejected" into "you have watched nothing", which is a lie the screen
      // then repeats confidently — and is exactly how a 400 hid behind an empty
      // diary while 58 viewings sat in the database.
      .catch(e => { if (!dead) setLoadErr(String(e.message || e)); });
    list('memory', { filter: 'key=eq.media_lists', order: 'key' })
      .then(rows => { if (!dead && Array.isArray(rows?.[0]?.value?.lists)) setLists(rows[0].value.lists); })
      .catch(e => { if (!dead) setLoadErr(String(e.message || e)); });
    return () => { dead = true; };
  }, []);

  async function writeLists(next) {
    setLists(next);
    try { await upsertMemory('media_lists', { lists: next }); } catch { /* offline: local state stands */ }
  }

  async function writeLog(next) {
    setLog(next);
    try { await upsertMemory('media_log', { entries: next }); } catch { /* offline: local state stands */ }
  }

  // Logging a viewing does two things, and doing only the first is the bug this
  // avoids: it records WHEN you watched it, and it moves the shelf row to
  // completed. A diary entry sitting behind a title still filed as "watching"
  // is two screens disagreeing about the same evening.
  // Several viewings at once — a season fill, or one episode click. Written in
  // a single round trip rather than one per episode: filling a 24-episode season
  // as 24 sequential writes is 24 chances to half-succeed, and a half-filled
  // season looks exactly like one you half-watched.
  async function logMany(entries) {
    let next = log;
    for (const e of entries) next = addViewing(next, e);
    await writeLog(next);
  }

  async function unlog({ tmdb_id, title, season, episode }) {
    const hit = log.find(e => (tmdb_id != null ? e.tmdb_id === tmdb_id
      : String(e.title).toLowerCase() === String(title).toLowerCase())
      && e.season === season && e.episode === episode);
    if (hit) await writeLog(removeViewing(log, hit.id));
  }

  async function saveViewing(entry) {
    await writeLog(addViewing(log, entry, { id: entry.id }));
    const row = items.find(r => (entry.tmdb_id != null && r.tmdb_id === entry.tmdb_id)
      || String(r.title).toLowerCase() === String(entry.title).toLowerCase());
    if (row && row.status !== 'completed' && String(row.type) !== 'tv') {
      await patch(row.id, { status: 'completed', ...(entry.rating ? { rating: entry.rating } : {}) });
    }
    setSheet(null);
  }

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
      setResults(normalizeResults(await searchTmdb(term, tmdbKey)).slice(0, 8));
      setSearchErr(null);
    } catch (e) {
      setResults([]);
      // Named rather than swallowed. A search that silently returns nothing is
      // indistinguishable from a search with no matches, and the difference here
      // was a credential in the wrong format.
      setSearchErr(String(e.message || e));
    }
    finally { setBusy(false); }
  }

  async function addFrom(r) {
    const row = await add({
      title: r.title, type: r.type, status: 'watchlist',
      tmdb_id: r.tmdb_id, poster_url: r.poster_url, rating: null,
    });
    const id = row?.id || row?.[0]?.id;
    // Everything the preview already fetched is stored with the row. Without
    // this the runtime is thrown away and "time watched" goes back to guessing
    // at a title we had the exact length of two seconds ago.
    if (id) {
      await writeMeta(id, {
        year: r.year, overview: r.overview, tmdb_score: r.tmdb_score,
        // A SUGGESTION, stored so the shelf has something sensible on day one.
        // Every card can override it, and the selector shows what it picked.
        kind: guessKind({
          title: r.title, type: r.type || r.kind,
          genres: r.genres || [], countries: r.countries || [], languages: r.languages || [],
        }),
        ...(r.runtime ? (r.kind === 'tv' || r.type === 'tv'
          ? { episode_runtime: r.runtime } : { runtime: r.runtime }) : {}),
        ...(r.episodes ? { episodes_total: r.episodes } : {}),
        ...(r.genres?.length ? { genres: r.genres } : {}),
      });
    }
    setResults([]); setQ('');
    refresh?.();
  }

  // The season list lives on the RAW detail payload - normaliseDetail folds it
  // away, deliberately, because the preview sheet has no use for it. So the
  // grid fetches the raw shape once per show and caches it for the session.
  async function openEpisodes(row) {
    setEpisodes({ title: row.title, tmdbId: row.tmdb_id, kind: meta[row.id]?.kind || row.type, poster: row.poster_url, detail: detailCache[row.tmdb_id] || null });
    if (!tmdbKey || !row.tmdb_id || detailCache[row.tmdb_id]) return;
    try {
      const j = await fetchRaw('tv', row.tmdb_id, tmdbKey);
      setDetailCache(c => ({ ...c, [row.tmdb_id]: j }));
      setEpisodes(e => (e ? { ...e, detail: j } : e));
    } catch { /* the grid shows its own empty state */ }
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

      {loadErr && (
        <p className="ls-warn">
          Could not read your saved media data: <code>{loadErr}</code>. The
          screens below will look empty — that is this error, not an empty diary.
        </p>
      )}

      <div className="mv-screens">
        {[['shelf', 'SHELF'], ['diary', 'DIARY'], ['discover', 'DISCOVER'], ['lists', 'LISTS']].map(([k, l]) => (
          <button key={k} className={`seg-btn${screen === k ? ' on' : ''}`} onClick={() => setScreen(k)}>{l}</button>
        ))}
        <span className="muted small" style={{ marginLeft: 8 }}>
          {screen === 'shelf' ? 'what you own and plan to watch'
            : screen === 'diary' ? `${log.length} viewing${log.length === 1 ? '' : 's'} on record`
              : screen === 'lists' ? `${lists.length} list${lists.length === 1 ? '' : 's'}`
                : 'what is out there — no typing required'}
        </span>
      </div>

      {screen === 'lists' && (
        <Lists
          lists={lists}
          log={log}
          onChange={writeLists}
          onOpenTitle={i => setPreview({ kind: i.kind, tmdbId: i.tmdb_id, fallback: i })}
        />
      )}

      {screen === 'discover' && (
        <>
          <Discover
            log={log}
            onOpen={c => setPreview({ kind: c.kind, tmdbId: c.tmdb_id, fallback: c })}
            onAdd={c => addFrom({ ...c, type: c.kind })}
          />
          <Preview
            open={!!preview}
            kind={preview?.kind || 'movie'}
            tmdbId={preview?.tmdbId ?? null}
            fallback={preview?.fallback || null}
            onAdd={async d => { await addFrom({ ...d, type: d.kind }); setPreview(null); }}
            onLog={d => { setPreview(null); setSheet({ title: d.title, kind: d.kind, poster: d.poster_url, tmdbId: d.tmdb_id }); }}
            onClose={() => setPreview(null)}
          />
          <LogSheet
            open={!!sheet}
            entry={sheet?.entry || null}
            title={sheet?.title || ''}
            kind={sheet?.kind || 'movie'}
            poster={sheet?.poster || null}
            tmdbId={sheet?.tmdbId ?? null}
            onSave={saveViewing}
            onClose={() => setSheet(null)}
          />
        </>
      )}

      {screen === 'diary' && (
        <>
          <Diary
            log={log}
            onEdit={e => setSheet({ entry: e })}
            onDelete={e => writeLog(removeViewing(log, e.id))}
            onAdd={() => setSheet({ title: '', kind: 'movie' })}
          />
          <LogSheet
            open={!!sheet}
            entry={sheet?.entry || null}
            title={sheet?.title || ''}
            kind={sheet?.kind || 'movie'}
            poster={sheet?.poster || null}
            tmdbId={sheet?.tmdbId ?? null}
            onSave={saveViewing}
            onClose={() => setSheet(null)}
          />
        </>
      )}
      {screen === 'shelf' && (
        <>

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
        {searchErr && <p className="ls-warn">{searchErr}</p>}
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
                {/* Preview first. Adding straight from a search row is how the
                    wrong Dune ends up on the shelf. */}
                <button className="btn btn-sm" onClick={() => setPreview({ kind: r.type, tmdbId: r.tmdb_id, fallback: r })}>
                  PREVIEW
                </button>
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
                    onLog={() => setSheet({
                      title: r.title, kind: r.type, poster: r.poster_url, tmdbId: r.tmdb_id,
                    })}
                    onPreview={() => setPreview({
                      kind: r.type, tmdbId: r.tmdb_id,
                      fallback: { title: r.title, poster_url: r.poster_url, kind: r.type },
                    })}
                    onEpisodes={() => openEpisodes(r)}
                    onList={() => setListFor({
                      tmdb_id: r.tmdb_id, title: r.title, year: meta[r.id]?.year,
                      kind: meta[r.id]?.kind || r.type, poster_url: r.poster_url,
                    })}
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
                      <button className="btn btn-sm btn-green" title="Log a viewing with a date"
                        onClick={() => setSheet({ title: r.title, kind: r.type, poster: r.poster_url, tmdbId: r.tmdb_id })}>
                        + LOG
                      </button>
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

      <LogSheet
        open={!!sheet}
        entry={sheet?.entry || null}
        title={sheet?.title || ''}
        kind={sheet?.kind || 'movie'}
        poster={sheet?.poster || null}
        tmdbId={sheet?.tmdbId ?? null}
        onSave={saveViewing}
        onClose={() => setSheet(null)}
      />

      <Preview
        open={!!preview}
        kind={preview?.kind || 'movie'}
        tmdbId={preview?.tmdbId ?? null}
        fallback={preview?.fallback || null}
        onAdd={async d => { await addFrom({ ...d, type: d.kind, poster_url: d.poster_url }); setPreview(null); }}
        // "Already seen it" goes straight to the log rather than to the shelf.
        // Adding something you watched years ago as plan-to-watch and then
        // immediately marking it done is three taps to record one fact.
        onLog={d => { setPreview(null); setSheet({ title: d.title, kind: d.kind, poster: d.poster_url, tmdbId: d.tmdb_id }); }}
        onClose={() => setPreview(null)}
      />

      {listFor && (
        <AddToList
          lists={lists}
          title={listFor}
          onChange={writeLists}
          onClose={() => setListFor(null)}
        />
      )}

      <Episodes
        open={!!episodes}
        title={episodes?.title || ''}
        tmdbId={episodes?.tmdbId ?? null}
        kind={episodes?.kind || 'tv'}
        poster={episodes?.poster || null}
        detail={episodes?.detail || null}
        log={log}
        onLogMany={logMany}
        onUnlog={unlog}
        onClose={() => setEpisodes(null)}
      />
        </>
      )}
    </>
  );
}
