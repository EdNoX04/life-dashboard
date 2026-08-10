import React, { useEffect, useState } from 'react';
import { todayLocal, validDate } from '../../lib/medialog.js';
import { KINDS, kindOf, guessKind, isEpisodic } from '../../lib/kinds.js';

// Adding something, with the date attached.
//
// Adding used to be one silent action: a title landed on the plan-to-watch shelf
// with no date of any kind, and if you had actually just watched it you then had
// to find it again and log it. Two steps for one fact, and the second step is
// the one people skip — which is how a diary ends up with holes in exactly the
// weeks you were watching most.
//
// So this asks the only question that matters at the moment of adding: is this
// something you are GOING to watch, are IN THE MIDDLE OF, or have ALREADY
// watched. Each answer means a different date, and they are not interchangeable:
//
//   PLAN TO WATCH — the date is when you ADDED it. There is no watch date
//     because you have not watched it, and inventing one would put unwatched
//     films in your diary.
//   WATCHING     — the date is when you STARTED. Also not a viewing: starting a
//     twelve-episode series is not the same as having watched it, and logging it
//     as one would make the diary claim twelve hours you have not spent.
//   WATCHED      — the date is a real viewing, and this is the one that goes in
//     the diary, with a rating and a review if you have them.
//
// A series adds a fourth possibility: you watched ONE episode. That logs the
// episode rather than the show, which is the difference between "I started
// House" and "I watched S01E01".

const MODES = [
  { key: 'watchlist', label: 'PLAN TO WATCH', hint: 'not watched yet — records when you added it' },
  { key: 'watching', label: 'WATCHING', hint: 'part-way through — records when you started' },
  { key: 'completed', label: 'WATCHED', hint: 'goes in your diary with the date' },
];

const backDate = back => {
  const d = new Date();
  d.setDate(d.getDate() - back);
  return todayLocal(d);
};

export default function AddSheet({ open, title = '', kind = 'movie', year = null, poster = null, tmdbId = null, meta = null, onAdd, onClose }) {
  const [mode, setMode] = useState('watchlist');
  const [on, setOn] = useState(todayLocal());
  const [rating, setRating] = useState(null);
  const [review, setReview] = useState('');
  const [season, setSeason] = useState('');
  const [episode, setEpisode] = useState('');
  const [pickedKind, setPickedKind] = useState(kind);

  useEffect(() => {
    if (!open) return;
    setMode('watchlist');
    setOn(todayLocal());
    setRating(null); setReview(''); setSeason(''); setEpisode('');
    // The guess is a starting point the user can override — it is shown as a
    // dropdown, not applied invisibly.
    setPickedKind(guessKind({
      title, type: kind === 'movie' ? 'movie' : 'tv',
      genres: meta?.genres || [], countries: meta?.countries || [], languages: meta?.languages || [],
    }));
  }, [open, title, kind, meta]);

  if (!open) return null;

  const series = isEpisodic(pickedKind);
  const dateOk = !!validDate(on);
  const k = kindOf(pickedKind);

  const submit = () => {
    if (!dateOk) return;
    onAdd({
      title,
      kind: pickedKind,
      type: k.type,
      year,
      poster_url: poster,
      tmdb_id: tmdbId,
      runtime: meta?.runtime ?? null,
      episodes: meta?.episodes ?? null,
      status: mode,
      // One date field, three meanings, named by the mode so nothing downstream
      // has to guess which kind of date it received.
      date: on,
      // Only a completed add produces a viewing. The other two record a date
      // about the SHELF, not about watching.
      log: mode === 'completed',
      rating: mode === 'completed' ? rating : null,
      review: mode === 'completed' ? review.trim() || null : null,
      season: mode === 'completed' && season !== '' ? Number(season) : null,
      episode: mode === 'completed' && episode !== '' ? Number(episode) : null,
    });
  };

  return (
    <div className="ls-back" onClick={onClose}>
      <div className="ls" onClick={e => e.stopPropagation()}>
        <div className="ls-head">
          <span className="ls-title">Add · {title}{year ? ` (${year})` : ''}</span>
          <button className="btn btn-sm" onClick={onClose}>✕</button>
        </div>

        <label className="ls-lbl">WHERE DOES THIS GO</label>
        <div className="as-modes">
          {MODES.map(m => (
            <button key={m.key} className={`as-mode${mode === m.key ? ' on' : ''}`} onClick={() => setMode(m.key)}>
              <b>{m.label}</b>
              <i>{m.hint}</i>
            </button>
          ))}
        </div>

        <label className="ls-lbl">KIND</label>
        <select value={pickedKind} onChange={e => setPickedKind(e.target.value)}>
          {KINDS.filter(x => x.type === k.type || x.key === pickedKind).map(x => (
            <option key={x.key} value={x.key}>{x.label.toLowerCase()}</option>
          ))}
        </select>

        <label className="ls-lbl">
          {mode === 'completed' ? 'WATCHED ON' : mode === 'watching' ? 'STARTED ON' : 'ADDED ON'}
        </label>
        <div className="ls-quick">
          {[['TODAY', 0], ['YESTERDAY', 1], ['2 DAYS AGO', 2]].map(([l, b]) => (
            <button key={l} className={`seg-btn${on === backDate(b) ? ' on' : ''}`} onClick={() => setOn(backDate(b))}>{l}</button>
          ))}
        </div>
        <input type="date" value={on} max={todayLocal()} onChange={e => setOn(e.target.value)} />
        {!dateOk && <p className="ls-warn">That date cannot be read.</p>}

        {mode !== 'completed' && (
          <p className="ls-hint">
            {mode === 'watchlist'
              ? 'Nothing goes in your diary — you have not watched it. The date records when it joined the shelf, so you can see how long something has been waiting.'
              : 'Starting a series is not the same as having watched it, so this records a start date rather than a viewing. Tick episodes off in the episode grid as you go.'}
          </p>
        )}

        {mode === 'completed' && series && (
          <>
            <label className="ls-lbl">EPISODE (OPTIONAL)</label>
            <div className="flex">
              <input type="number" min="0" placeholder="Season" value={season} onChange={e => setSeason(e.target.value)} />
              <input type="number" min="0" placeholder="Episode" value={episode} onChange={e => setEpisode(e.target.value)} />
            </div>
            <p className="ls-hint">
              Fill these in to log one episode; leave them blank to record the
              whole show as watched on that date.
            </p>
          </>
        )}

        {mode === 'completed' && (
          <>
            <label className="ls-lbl">RATING</label>
            <span className="mv-stars">
              {[1, 2, 3, 4, 5].map(n => (
                <button key={n} className={`mv-star ${rating >= n ? 'on' : ''}`}
                  onClick={() => setRating(rating === n ? null : n)}>★</button>
              ))}
              {rating != null && <button className="btn btn-sm" onClick={() => setRating(null)}>clear</button>}
            </span>

            <label className="ls-lbl">REVIEW</label>
            <textarea className="ls-review" rows={4} placeholder="What did you think?"
              value={review} onChange={e => setReview(e.target.value)} />
          </>
        )}

        <div className="ls-acts">
          <button className="btn" onClick={onClose}>CANCEL</button>
          <button className="btn btn-green" onClick={submit} disabled={!dateOk}>
            {mode === 'completed' ? '+ ADD & LOG IT' : '+ ADD'}
          </button>
        </div>
      </div>
    </div>
  );
}
