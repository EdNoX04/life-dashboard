import React, { useMemo, useState } from 'react';
import { Card } from '../ui.jsx';
import { getConfig } from '../../lib/db.js';
import { searchTmdb, fetchRaw } from '../../lib/tmdb.js';
import { normalizeTmdb } from '../../lib/media.js';
import { backfillGroups, pickMatch, applyMatch, markUnmatched, resetChecks } from '../../lib/backfill.js';

// Posters and runtimes, from TMDB.
//
// Letterboxd publishes neither. The films list has no artwork at all and nothing
// anywhere carries a runtime, so an import that worked perfectly still produced
// a shelf of blank rectangles reading "TIME WATCHED ~0.0h · 58 films
// unmeasured". Correct data, useless screen.
//
// This is a button rather than something automatic on load, because it is
// dozens of API calls on a key with a rate limit, and a screen that quietly
// spends your quota every time you open it is a screen you learn to distrust.
// It shows what it will do, does it visibly, and can be stopped.

const PAUSE = 260;   // ms between lookups — TMDB allows far more, this is manners

export default function Backfill({ log = [], onApply }) {
  const [busy, setBusy] = useState(false);
  const [stop, setStop] = useState(false);
  const [done, setDone] = useState(0);
  const [missed, setMissed] = useState([]);
  const [now, setNow] = useState(null);
  const key = (getConfig().tmdbKey || '').trim();

  const groups = useMemo(() => backfillGroups(log), [log]);
  const todo = groups.length;
  const missingPosters = log.filter(e => !e.poster_url).length;
  const missingRuntime = log.filter(e => e.runtime == null).length;

  const run = async () => {
    setBusy(true); setStop(false); setDone(0); setMissed([]);
    let next = log;
    let n = 0;
    const misses = [];

    for (const g of groups) {
      if (stop) break;
      setNow(g.title);
      try {
        const raw = await searchTmdb(g.title, key);
        const cands = raw.map(normalizeTmdb).filter(Boolean).map(c => ({
          tmdb_id: c.tmdb_id,
          title: c.title,
          original_title: c.original_title || null,
          year: c.year,
          votes: c.tmdb_votes ?? 0,
          poster_url: c.poster_url,
          runtime: null,
        }));
        const hit = pickMatch(cands, { title: g.title, year: g.year });
        if (hit) {
          // The search result has a poster but no runtime — runtime only exists
          // on the detail endpoint. One extra call, and only for titles that
          // actually matched, so a miss costs one request rather than two.
          // The detail endpoint differs by kind, and asking the wrong one 404s.
          // A series' length also lives in a different field AND means something
          // different: `episode_run_time` is one episode, not the whole show.
          let runtime = null;
          try {
            const isTv = (g.kind || hit.kind) === 'tv' || hit.type === 'tv';
            const d = await fetchRaw(isTv ? 'tv' : 'movie', hit.tmdb_id, key);
            runtime = isTv
              ? (d?.episode_run_time?.[0] ?? d?.last_episode_to_air?.runtime ?? null)
              : (d?.runtime ?? null);
          } catch { /* poster alone is still worth having */ }
          next = applyMatch(next, g.ids, { ...hit, runtime });
        } else {
          misses.push(g.title);
          next = markUnmatched(next, g.ids);
        }
      } catch {
        // Marked as well as counted. An entry that only gets counted is an entry
        // the next run tries again, and again — the queue never empties.
        misses.push(g.title);
        next = markUnmatched(next, g.ids);
      }
      n += 1;
      setDone(n);
      await new Promise(r => setTimeout(r, PAUSE));
    }

    setNow(null);
    setMissed(misses);
    await onApply(next);
    setBusy(false);
  };

  if (!key) {
    return (
      <Card title="Posters & runtimes" color="var(--cyan)">
        <p className="ml-hint" style={{ marginTop: 0 }}>
          Letterboxd gives no artwork for films read off your profile list, and no
          runtimes at all — which is why the shelf shows blanks and the hours read
          zero. TMDB has both, but there is no key in Settings yet.
        </p>
      </Card>
    );
  }

  return (
    <Card title="Posters & runtimes" color="var(--cyan)"
      right={todo > 0 ? <span className="chip c-cyan">{todo} to look up</span> : <span className="chip c-green">complete</span>}>
      <p className="ml-hint" style={{ marginTop: 0 }}>
        Letterboxd publishes no runtimes and no artwork for films read off your
        profile list, so those arrive blank and the hours total reads zero. This
        fills them from TMDB — one lookup per film, not per viewing.
        {missingPosters > 0 && ` ${missingPosters} viewings have no poster`}
        {missingRuntime > 0 && `, ${missingRuntime} no runtime`}.
      </p>

      {busy && (
        <div className="bf-run">
          <span className="bf-bar"><i style={{ width: `${todo ? (done / todo) * 100 : 0}%` }} /></span>
          <span className="muted small">{done}/{todo}{now ? ` · ${now}` : ''}</span>
          <button className="btn btn-sm" onClick={() => setStop(true)}>STOP</button>
        </div>
      )}

      {!busy && todo > 0 && (
        <button className="btn btn-green" onClick={run}>FILL {todo} TITLES</button>
      )}
      {!busy && todo === 0 && (
        <>
          <p className="im-ok">
            Everything has been looked up. A few may still have no poster or
            runtime — TMDB simply does not carry one for them, and asking again
            gets the same answer.
          </p>
          {/* Not automatic. Re-running is for when TMDB has since added a title,
              or a match came out wrong — both worth a deliberate press. */}
          <button className="btn btn-sm" onClick={() => onApply(resetChecks(log))}>
            ASK AGAIN FOR ALL
          </button>
        </>
      )}

      {/* Named, not hidden. A title TMDB does not carry is a real outcome, and
          knowing WHICH ones beats a silent partial success. */}
      {missed.length > 0 && (
        <p className="ls-warn">
          No confident match for {missed.length}: {missed.slice(0, 8).join(', ')}
          {missed.length > 8 ? '…' : ''}. These are left alone rather than given
          the wrong poster — a near-title match would look right and be wrong.
          Add them by hand from the shelf if you want artwork.
        </p>
      )}
    </Card>
  );
}
