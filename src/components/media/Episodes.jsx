import React, { useEffect, useMemo, useState } from 'react';
import { Card, Empty } from '../ui.jsx';
import { getConfig } from '../../lib/db.js';
import { BASE } from '../../lib/tmdb.js';
import { kindOf } from '../../lib/kinds.js';
import {
  normaliseSeason, seasonList, watchedSet, isWatched, seasonProgress, nextUp,
  seasonAsViewings, showProgress, SPECIALS_SEASON,
} from '../../lib/seasons.js';
import { todayLocal } from '../../lib/medialog.js';

// The episode grid. Click a cell, it is watched — which means a viewing lands in
// the diary with tonight's date, not that a counter goes up.
//
// That is the whole design. An episode is watched when a LOG ENTRY exists for
// it, so the count is derived: it cannot drift from the diary, three episodes on
// one night show up as a binge, and a rewatch is a second entry rather than a
// number that cannot go past 100%.
//
// Seasons load one at a time. A twelve-season sitcom is twelve requests if you
// open all of them, and most people open one — fetching the lot up front would
// spend the rate limit on episodes nobody looked at.

function Cell({ e, on, onToggle }) {
  const future = e.air_date && Date.parse(`${e.air_date}T00:00:00Z`) > Date.now();
  return (
    <button
      className={`ep-cell${on ? ' on' : ''}${future ? ' future' : ''}`}
      disabled={future}
      onClick={() => onToggle(e)}
      title={future
        ? `${e.name} — airs ${e.air_date}`
        : `${e.name}${e.runtime ? ` · ${e.runtime} min` : ''}${on ? ' · watched (click to remove)' : ''}`}
    >
      <b>{e.episode}</b>
      <i>{e.name}</i>
    </button>
  );
}

export default function Episodes({ open, title = '', tmdbId = null, kind = 'tv', poster = null, detail = null, log = [], onLogMany, onUnlog, onClose }) {
  const [seasons, setSeasons] = useState([]);
  const [loaded, setLoaded] = useState({});
  const [active, setActive] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [fillDate, setFillDate] = useState(todayLocal());
  const key = (getConfig().tmdbKey || '').trim();
  const k = kindOf(kind);

  useEffect(() => {
    if (!open) return;
    const list = seasonList(detail || {});
    setSeasons(list);
    // Opens on the first real season, never on Specials — which TMDB returns
    // first and which is never where anyone starts.
    setActive(list.find(s => s.season !== SPECIALS_SEASON)?.season ?? list[0]?.season ?? null);
    setLoaded({});
    setErr(null);
  }, [open, detail]);

  useEffect(() => {
    if (!open || active == null || !tmdbId || !key || loaded[active]) return undefined;
    const ac = new AbortController();
    setBusy(true); setErr(null);
    fetch(`${BASE}/tv/${tmdbId}/season/${active}?api_key=${key}`, { signal: ac.signal })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`TMDB ${r.status}`))))
      .then(j => setLoaded(p => ({ ...p, [active]: normaliseSeason(j) })))
      .catch(e => { if (e.name !== 'AbortError') setErr(e.message); })
      .finally(() => setBusy(false));
    return () => ac.abort();
  }, [open, active, tmdbId, key, loaded]);

  const set = useMemo(() => watchedSet(log, { tmdb_id: tmdbId, title }), [log, tmdbId, title]);
  const season = loaded[active];
  const prog = useMemo(() => (season ? seasonProgress(season.episodes, set) : null), [season, set]);
  const next = useMemo(() => (season ? nextUp(season.episodes, set) : null), [season, set]);
  const show = useMemo(() => showProgress(seasons, loaded, set), [seasons, loaded, set]);

  if (!open) return null;

  const toggle = e => {
    if (isWatched(set, e.season, e.episode)) {
      onUnlog?.({ tmdb_id: tmdbId, title, season: e.season, episode: e.episode });
      return;
    }
    onLogMany?.([{
      title, tmdb_id: tmdbId, kind, poster_url: poster,
      on: todayLocal(), season: e.season, episode: e.episode, runtime: e.runtime ?? null,
      source: 'episode-grid',
    }]);
  };

  const fillSeason = () => {
    if (!season) return;
    const rows = seasonAsViewings(season.episodes, set, {
      on: fillDate, title, tmdb_id: tmdbId, kind, poster_url: poster,
    });
    if (rows.length) onLogMany?.(rows);
  };

  return (
    <div className="ls-back" onClick={onClose}>
      <div className="pv" onClick={e => e.stopPropagation()}>
        <div className="ls-head">
          <span className="ls-title">{title} · episodes</span>
          <button className="btn btn-sm" onClick={onClose}>✕</button>
        </div>

        {!key && <p className="ls-warn">No TMDB key saved, so episode lists cannot be fetched. Add one in Settings.</p>}
        {err && <p className="ls-warn">TMDB refused: {err}</p>}
        {!seasons.length && key && !err && (
          <Empty icon="📺" text="No season data on this title. Open DETAILS first so the seasons load, or this may be a title TMDB has no episode breakdown for." />
        )}

        {seasons.length > 0 && (
          <>
            <div className="ep-seasons">
              {seasons.map(s => (
                <button key={s.season} className={`seg-btn${active === s.season ? ' on' : ''}`}
                  onClick={() => setActive(s.season)}>
                  {s.season === SPECIALS_SEASON ? 'SP' : `S${s.season}`}
                </button>
              ))}
            </div>

            {/* Progress in the terms this KIND deserves. A sitcom gets a
                position and no bar, because there is no honest completion
                figure for a show you dip into. */}
            {prog && (
              <div className="ep-prog">
                {k.progress === 'position' ? (
                  <span>
                    {prog.watched} of {prog.aired} logged this season
                    {next ? <> · next unseen is <b>E{next.episode}</b></> : ' · nothing unseen here'}
                  </span>
                ) : (
                  <>
                    <span className="ep-bar"><i style={{ width: `${prog.pct ?? 0}%` }} /></span>
                    <span>
                      {prog.watched}/{prog.aired}
                      {/* Caught up and finished are different states: one means
                          wait, the other means pick something new. */}
                      {prog.caughtUp
                        ? ` · caught up, ${prog.upcoming} still to air`
                        : prog.complete ? ' · season finished'
                          : next ? ` · next up E${next.episode}` : ''}
                    </span>
                  </>
                )}
              </div>
            )}

            {busy && <p className="pv-none">Loading season {active}…</p>}

            {season && (
              <>
                <div className="ep-grid">
                  {season.episodes.map(e => (
                    <Cell key={`${e.season}-${e.episode}`} e={e}
                      on={isWatched(set, e.season, e.episode)} onToggle={toggle} />
                  ))}
                </div>

                <div className="ep-fill">
                  <input type="date" value={fillDate} max={todayLocal()} onChange={e => setFillDate(e.target.value)} />
                  <button className="btn btn-sm btn-green" onClick={fillSeason}
                    disabled={!!prog && prog.watched === prog.aired}>
                    LOG WHOLE SEASON
                  </button>
                  {/* Said out loud rather than dressed up. Filling a season
                      stamps one date on episodes you watched across weeks; that
                      is a useful shortcut and it is not a real history. */}
                  <span className="muted small">
                    Marks every aired, unwatched episode on that one date — a fair
                    approximation for a season you finished a while ago, not a
                    real day-by-day record. Already-logged episodes are skipped.
                  </span>
                </div>
              </>
            )}

            <p className="pv-fine">
              {show.watched} episode{show.watched === 1 ? '' : 's'} logged across{' '}
              {show.seasonsKnown} of {show.seasonsTotal} seasons
              {show.partial && ' — seasons you have not opened are not counted, so this is a floor rather than a total'}.
              Clicking an episode records a viewing dated today; it shows up in the diary.
            </p>
          </>
        )}

        <div className="ls-acts">
          <button className="btn" onClick={onClose}>DONE</button>
        </div>
      </div>
    </div>
  );
}
