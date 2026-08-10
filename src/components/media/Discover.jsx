import React, { useEffect, useMemo, useState } from 'react';
import { Card, Empty } from '../ui.jsx';
import { getConfig } from '../../lib/db.js';
import { RAILS, railOf, fetchRail } from '../../lib/tmdb.js';
import { watchedKeys, hasWatched } from '../../lib/medialog.js';

// The poster wall — adding something without typing its name.
//
// Search assumes you already know what you want. Most of the time you do not:
// you want to see what is out there and recognise something. That is what the
// poster grid at the top of Letterboxd is for, and it is why this screen exists
// rather than a better search box.
//
// Two things make it more than decoration:
//
//   ALREADY-SEEN TITLES ARE MARKED, NOT HIDDEN. Hiding them would be the obvious
//   move and it is wrong twice over — you lose the pleasant "oh I've seen that",
//   and a grid that silently drops rows is one you cannot trust to be showing
//   you everything. They are dimmed and stamped instead, and can be filtered out
//   by choice.
//
//   ANIME AND HINDI FILMS GET THEIR OWN RAILS. TMDB's popularity is global, so
//   both lose to English-language drama on volume and effectively never surface
//   in a "popular" list. A rail each is the only way they appear at all.

function Poster({ card, seen, onOpen, onQuickAdd }) {
  return (
    <div className={`dc-card${seen ? ' seen' : ''}`}>
      <button className="dc-art" onClick={() => onOpen(card)} title={card.title}>
        {card.poster_url
          ? <img src={card.poster_url} alt="" loading="lazy" style={{ imageRendering: 'pixelated' }} />
          : <span className="dc-noart">{card.kind === 'tv' ? '📺' : '▶'}</span>}
        {seen && <span className="dc-seen">SEEN</span>}
        {card.tmdb_score > 0 && (
          <span className="dc-score">{Number(card.tmdb_score).toFixed(1)}</span>
        )}
      </button>
      <div className="dc-name" title={card.title}>{card.title}</div>
      <div className="dc-sub">
        <span>{card.year || '—'}</span>
        {/* One tap to the shelf. The preview is still a tap away on the poster
            itself — this is for the times you already know you want it. */}
        <button className="btn btn-sm" onClick={() => onQuickAdd(card)}>+</button>
      </div>
    </div>
  );
}

export default function Discover({ log = [], onOpen, onAdd }) {
  const [rail, setRail] = useState('trending');
  const [cards, setCards] = useState([]);
  const [state, setState] = useState('loading');
  const [err, setErr] = useState(null);
  const [hideSeen, setHideSeen] = useState(false);
  const key = (getConfig().tmdbKey || '').trim();

  useEffect(() => {
    if (!key) { setState('nokey'); return undefined; }
    const ac = new AbortController();
    setState('loading'); setErr(null);
    fetchRail(rail, key, { signal: ac.signal })
      .then(list => { setCards(list); setState('ready'); })
      .catch(e => {
        if (e.name === 'AbortError') return;
        setErr(e.message); setState('failed');
      });
    return () => ac.abort();
  }, [rail, key]);

  // The diary is what "already seen" means — not the shelf. A film you watched
  // in 2023 and never added to the shelf is still one you have seen, and the
  // whole point of importing Letterboxd was to know that.
  const seenKeys = useMemo(() => watchedKeys(log), [log]);
  const marked = useMemo(
    () => cards.map(c => ({ ...c, seen: hasWatched(seenKeys, c) })),
    [cards, seenKeys],
  );
  const shown = hideSeen ? marked.filter(c => !c.seen) : marked;
  const seenCount = marked.filter(c => c.seen).length;

  return (
    <Card
      title="Discover"
      color="var(--purple)"
      right={seenCount > 0 ? (
        <button className="btn btn-sm" onClick={() => setHideSeen(v => !v)}>
          {hideSeen ? `+ ${seenCount} SEEN` : `HIDE ${seenCount} SEEN`}
        </button>
      ) : null}
    >
      <div className="dc-rails">
        {RAILS.map(r => (
          <button key={r.key} className={`seg-btn${rail === r.key ? ' on' : ''}`} onClick={() => setRail(r.key)}>
            {r.label}
          </button>
        ))}
      </div>
      <p className="dc-note">{railOf(rail).note}</p>

      {state === 'nokey' && (
        <Empty icon="▦" text="No TMDB key saved. Add one in Settings and this fills with posters — it is the same key the preview sheet uses." />
      )}
      {state === 'loading' && <p className="pv-none">Loading…</p>}
      {state === 'failed' && <p className="ls-warn">TMDB refused: {err}</p>}

      {state === 'ready' && shown.length === 0 && (
        <Empty icon="✓" text={hideSeen
          ? 'You have seen everything on this rail. Try another, or bring the seen ones back.'
          : 'This rail came back empty, which usually means TMDB has nothing for it today.'} />
      )}

      {state === 'ready' && shown.length > 0 && (
        <div className="dc-grid">
          {shown.map(c => (
            <Poster
              key={`${c.kind}-${c.tmdb_id}`}
              card={c}
              seen={c.seen}
              onOpen={onOpen}
              onQuickAdd={onAdd}
            />
          ))}
        </div>
      )}

      <p className="pv-fine">
        Posters open the full preview — synopsis, cast, and where to stream.
        <b> +</b> puts it straight on the plan-to-watch shelf.
        {seenCount > 0 && ` ${seenCount} of these are already in your diary and are marked rather than hidden.`}
      </p>
    </Card>
  );
}
