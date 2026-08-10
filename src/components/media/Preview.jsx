import React, { useEffect, useState } from 'react';
import { getConfig } from '../../lib/db.js';
import {
  fetchDetail, countryName, OFFER_TYPES, providersIn, streamingCountries, providerAge,
} from '../../lib/tmdb.js';

// The preview sheet — what a title actually is, before it goes on your shelf.
//
// Search used to return a row with a name and a poster, and adding was a guess:
// two films share a title, a series has four spin-offs, and "is this the one
// people mean" was answered by the poster alone. This is the sheet Letterboxd
// shows and the reason its search feels certain.
//
// Two things on this screen are quoted rather than asserted, and both are
// labelled as such:
//
//   THE SCORE IS TMDB'S. Not IMDb's, not Rotten Tomatoes' — neither is in this
//   API. Printing a bare "7.4" invites you to read it as the IMDb number you
//   already have a feel for. It says TMDB, and it shows the vote count, because
//   a 9.1 from 40 people and a 7.4 from 40,000 are different objects.
//
//   AVAILABILITY IS JUSTWATCH'S, AND IT AGES. Titles leave Netflix without
//   notice. Every provider answer carries when it was fetched, and past a week
//   it says so, because a stale "it's on Netflix" is worse than no answer — you
//   plan an evening around it.

const HOME = 'IN';

function Stat({ label, value, note }) {
  if (value == null || value === '') return null;
  return (
    <div className="pv-stat">
      <span className="pv-stat-l">{label}</span>
      <span className="pv-stat-v">{value}</span>
      {note && <span className="pv-stat-n">{note}</span>}
    </div>
  );
}

// The offers available in one country, split by how you pay. "On Netflix" and
// "rent for ₹150" answer the same question differently, and merging them sends
// you to a paywall you did not expect.
function Offers({ region, code }) {
  if (!region) {
    return (
      <p className="pv-none">
        No availability data for {countryName(code)}. TMDB returns nothing both
        for a country it does not cover and for a title that is genuinely not
        streaming there, so this means unknown — not unavailable.
      </p>
    );
  }
  return (
    <div className="pv-offers">
      {OFFER_TYPES.filter(t => region.offers[t.key]).map(t => (
        <div className="pv-offer" key={t.key}>
          <span className="pv-offer-t">
            {t.label}<i>{t.note}</i>
          </span>
          <span className="pv-logos">
            {region.offers[t.key].map(p => (
              <span className="pv-prov" key={p.id || p.name} title={p.name}>
                {p.logo ? <img src={p.logo} alt={p.name} /> : <b>{p.name.slice(0, 2)}</b>}
                <i>{p.name}</i>
              </span>
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function Preview({ open, kind = 'movie', tmdbId = null, fallback = null, onAdd, onLog, onClose }) {
  const [data, setData] = useState(null);
  const [state, setState] = useState('idle');
  const [err, setErr] = useState(null);
  const [showAbroad, setShowAbroad] = useState(false);
  const key = (getConfig().tmdbKey || '').trim();

  useEffect(() => {
    if (!open || !tmdbId) return undefined;
    const ac = new AbortController();
    setState('loading'); setErr(null); setData(null); setShowAbroad(false);
    fetchDetail(kind, tmdbId, key, { signal: ac.signal })
      .then(d => { setData(d); setState('ready'); })
      .catch(e => {
        if (e.name === 'AbortError') return;
        setErr(e.message === 'NO_KEY'
          ? 'No TMDB key saved. Add one in Settings and this sheet fills in — search still works without it, but you are adding titles blind.'
          : `TMDB refused: ${e.message}`);
        setState('failed');
      });
    return () => ac.abort();
  }, [open, tmdbId, kind, key]);

  if (!open) return null;

  const d = data || fallback || {};
  const home = data ? providersIn(data.providers, HOME) : null;
  const abroad = data ? streamingCountries(data.providers, { exclude: HOME }) : [];
  const age = data ? providerAge(data.fetched_at) : null;

  const runtimeText = d.runtime
    ? (d.kind === 'tv' ? `${d.runtime} min/ep` : `${Math.floor(d.runtime / 60)}h ${d.runtime % 60}m`)
    : null;

  return (
    <div className="ls-back" onClick={onClose}>
      <div className="pv" onClick={e => e.stopPropagation()}>
        {d.backdrop_url && <div className="pv-back" style={{ backgroundImage: `url(${d.backdrop_url})` }} />}

        <div className="pv-head">
          <span className="pv-art">
            {d.poster_url ? <img src={d.poster_url} alt="" style={{ imageRendering: 'pixelated' }} /> : <b>▶</b>}
          </span>
          <div className="pv-id">
            <h3 className="pv-title">{d.title || 'Loading…'}</h3>
            <div className="pv-meta">
              {d.year || '—'}
              {d.kind === 'tv' && d.seasons ? ` · ${d.seasons} season${d.seasons === 1 ? '' : 's'}` : ''}
              {d.kind === 'tv' && d.episodes ? ` · ${d.episodes} episodes` : ''}
              {runtimeText ? ` · ${runtimeText}` : ''}
            </div>
            {d.tagline && <div className="pv-tag">“{d.tagline}”</div>}
            <div className="pv-genres">
              {(d.genres || []).map(g => <span className="chip c-purple" key={g}>{g}</span>)}
            </div>
          </div>
          <button className="btn btn-sm" onClick={onClose}>✕</button>
        </div>

        {state === 'loading' && <p className="pv-none">Loading details…</p>}
        {state === 'failed' && <p className="ls-warn">{err}</p>}

        {d.overview && <p className="pv-over">{d.overview}</p>}

        <div className="pv-stats">
          <Stat
            label="TMDB"
            value={d.tmdb_score ? `${Number(d.tmdb_score).toFixed(1)}/10` : null}
            // The vote count is not trivia. It is what separates a score you can
            // lean on from one that three people decided.
            note={d.tmdb_votes ? `${Number(d.tmdb_votes).toLocaleString('en-IN')} votes` : 'few votes'}
          />
          <Stat label="Status" value={d.status} />
          <Stat label="Language" value={(d.languages || [])[0]} />
          <Stat label="From" value={(d.countries || []).map(countryName)[0]} />
        </div>

        {data?.crew?.directors?.length > 0 && (
          <p className="pv-crew"><b>Directed by</b> {data.crew.directors.join(', ')}</p>
        )}
        {data?.crew?.writers?.length > 0 && (
          <p className="pv-crew"><b>Written by</b> {data.crew.writers.join(', ')}</p>
        )}

        {data?.cast?.length > 0 && (
          <>
            <h4 className="pv-h">CAST</h4>
            <div className="pv-cast">
              {data.cast.map(c => (
                <span className="pv-actor" key={c.id || c.name}>
                  {c.photo
                    ? <img src={c.photo} alt="" style={{ imageRendering: 'pixelated' }} />
                    : <b>{c.name.split(' ').map(w => w[0]).slice(0, 2).join('')}</b>}
                  <i className="pv-a-n">{c.name}</i>
                  {/* The character is the half that lets you place a face. */}
                  {c.character && <i className="pv-a-c">{c.character}</i>}
                </span>
              ))}
            </div>
          </>
        )}

        {state === 'ready' && (
          <>
            <h4 className="pv-h">
              WHERE TO WATCH · {countryName(HOME)}
              {age?.stale && <span className="chip c-yellow">checked {Math.round(age.days)} days ago</span>}
            </h4>
            <Offers region={home} code={HOME} />

            {/* The VPN question, and only subscription availability counts. A
                title you can RENT in twelve countries is rentable at home too,
                so listing those would bury the one thing being asked. */}
            {abroad.length > 0 && (
              <>
                <button className="btn btn-sm" onClick={() => setShowAbroad(v => !v)}>
                  {showAbroad ? '− HIDE' : `+ STREAMING IN ${abroad.reduce((s, p) => s + p.countries.length, 0)} OTHER REGIONS`}
                </button>
                {showAbroad && (
                  <div className="pv-abroad">
                    {abroad.map(p => (
                      <div className="pv-ab-row" key={p.name}>
                        <span className="pv-prov">
                          {p.logo ? <img src={p.logo} alt={p.name} /> : <b>{p.name.slice(0, 2)}</b>}
                        </span>
                        <b>{p.name}</b>
                        <span className="pv-ab-c">{p.countries.map(countryName).join(', ')}</span>
                      </div>
                    ))}
                    <p className="pv-fine">
                      Included with a subscription in those regions — rentals are
                      left out, since anything rentable abroad is rentable here.
                      Whether your account can actually use another region is a
                      matter for the service&#39;s own terms.
                    </p>
                  </div>
                )}
              </>
            )}

            <p className="pv-fine">
              Availability data is JustWatch&#39;s, via TMDB, fetched{' '}
              {age ? `${age.days < 1 ? 'today' : `${Math.round(age.days)} days ago`}` : 'just now'}.
              It changes weekly — treat it as a strong hint, not a guarantee.
            </p>
          </>
        )}

        <div className="ls-acts">
          <button className="btn" onClick={onClose}>CLOSE</button>
          {onLog && (
            <button className="btn" onClick={() => onLog(d)}>ALREADY SEEN IT</button>
          )}
          {onAdd && <button className="btn btn-green" onClick={() => onAdd(d)}>+ ADD TO SHELF</button>}
        </div>
      </div>
    </div>
  );
}
