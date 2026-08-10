import React, { useEffect, useState } from 'react';
import { todayLocal, validDate } from '../../lib/medialog.js';

// The "when did you watch this" sheet.
//
// Item 1 of the rebuild, and the smallest-looking one: it is a date field. What
// makes it worth its own component is that the date has to be EASY, because a
// diary is only as good as the friction of logging to it. If recording a film
// costs four taps and a calendar picker, the diary goes stale in a fortnight and
// every screen built on it becomes decoration.
//
// So: the date defaults to today, yesterday is one tap away, and the field is
// still there for anything older. Everything else on this sheet is optional and
// looks optional.
//
// The date defaults to the LOCAL today, never the UTC one. India runs +5:30, so
// a film finished at 00:30 would otherwise be filed under yesterday — and
// after-midnight is when films actually finish.

const QUICK = [
  { label: 'TODAY', back: 0 },
  { label: 'YESTERDAY', back: 1 },
  { label: '2 DAYS AGO', back: 2 },
];

const backDate = back => {
  const d = new Date();
  d.setDate(d.getDate() - back);
  return todayLocal(d);
};

export default function LogSheet({ open, entry = null, title = '', kind = 'movie', poster = null, tmdbId = null, onSave, onClose }) {
  const [on, setOn] = useState(todayLocal());
  const [rating, setRating] = useState(null);
  const [season, setSeason] = useState('');
  const [episode, setEpisode] = useState('');
  const [note, setNote] = useState('');
  const [runtime, setRuntime] = useState('');

  // Editing an existing viewing loads it; logging a new one starts clean at
  // today. Without this reset, closing an edit and opening a fresh log would
  // silently inherit the last thing you edited.
  useEffect(() => {
    if (!open) return;
    setOn(validDate(entry?.on) || todayLocal());
    setRating(entry?.rating ?? null);
    setSeason(entry?.season ?? '');
    setEpisode(entry?.episode ?? '');
    setNote(entry?.note ?? '');
    setRuntime(entry?.runtime ?? '');
  }, [open, entry]);

  if (!open) return null;

  const isSeries = String(entry?.kind || kind) !== 'movie';
  const heading = entry ? `Edit viewing · ${entry.title}` : `Log · ${title}`;
  const dateOk = !!validDate(on);

  const save = () => {
    if (!dateOk) return;
    onSave({
      ...(entry || {}),
      title: entry?.title || title,
      kind: entry?.kind || kind,
      tmdb_id: entry?.tmdb_id ?? tmdbId,
      poster_url: entry?.poster_url ?? poster,
      on,
      rating: rating ?? null,
      season: season === '' ? null : Number(season),
      episode: episode === '' ? null : Number(episode),
      runtime: runtime === '' ? null : Number(runtime),
      note: note.trim() || null,
    });
  };

  return (
    <div className="ls-back" onClick={onClose}>
      <div className="ls" onClick={e => e.stopPropagation()}>
        <div className="ls-head">
          <span className="ls-title">{heading}</span>
          <button className="btn btn-sm" onClick={onClose}>✕</button>
        </div>

        <label className="ls-lbl">WATCHED ON</label>
        <div className="ls-quick">
          {QUICK.map(q => {
            const d = backDate(q.back);
            return (
              <button key={q.label} className={`seg-btn${on === d ? ' on' : ''}`} onClick={() => setOn(d)}>
                {q.label}
              </button>
            );
          })}
        </div>
        <input type="date" value={on} max={todayLocal()} onChange={e => setOn(e.target.value)} />
        {!dateOk && (
          <p className="ls-warn">
            That date cannot be read. A viewing saved without a valid date still
            counts in your totals, but it will sit in the &ldquo;no date&rdquo;
            list rather than in the diary.
          </p>
        )}

        {isSeries && (
          <>
            <label className="ls-lbl">EPISODE</label>
            <div className="flex">
              <input type="number" min="0" placeholder="Season" value={season} onChange={e => setSeason(e.target.value)} />
              <input type="number" min="0" placeholder="Episode" value={episode} onChange={e => setEpisode(e.target.value)} />
            </div>
            <p className="ls-hint">
              Leave both blank to log the night rather than the episode. Two
              episodes on one evening are two entries, so the diary can show what
              a binge actually looked like.
            </p>
          </>
        )}

        <label className="ls-lbl">RATING</label>
        <span className="mv-stars">
          {[1, 2, 3, 4, 5].map(n => (
            <button key={n} className={`mv-star ${rating >= n ? 'on' : ''}`}
              onClick={() => setRating(rating === n ? null : n)}>★</button>
          ))}
          {rating != null && <button className="btn btn-sm" onClick={() => setRating(null)}>clear</button>}
        </span>

        <label className="ls-lbl">RUNTIME (MIN)</label>
        <input type="number" min="0" placeholder="e.g. 170" value={runtime} onChange={e => setRuntime(e.target.value)} />
        {/* Stated rather than assumed: an unrecorded runtime is not zero, and
            the totals say "about" instead of pretending otherwise. */}
        <p className="ls-hint">
          Optional. Left blank, this viewing is counted but its length is
          estimated, and the time totals are marked approximate rather than
          quietly counting it as nothing.
        </p>

        <label className="ls-lbl">NOTE</label>
        <input placeholder="Who you watched it with, what you thought…" value={note} onChange={e => setNote(e.target.value)} />

        <div className="ls-acts">
          <button className="btn" onClick={onClose}>CANCEL</button>
          <button className="btn btn-green" onClick={save}>{entry ? 'SAVE' : '+ LOG IT'}</button>
        </div>
      </div>
    </div>
  );
}
