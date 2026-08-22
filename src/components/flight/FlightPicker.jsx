import React, { useMemo, useRef, useState } from 'react';
import {
  AIRLINE_LIST, searchAirlines, airlineByIata,
  isoDate, addDays, dayLabel, trackability, makePlan,
} from '../../lib/flightplan.js';

// Pick an airline, type a number, choose a day.
//
// The airline picker exists because nobody knows their airline's ICAO code.
// You know you are flying IndiGo; the aeroplane transmits IGO1492. Choosing
// "IndiGo" fills in 6E, and the number you type off your boarding pass is then
// enough to build the callsign the radar actually searches for.
//
// The date row is where this component has to be careful. Live ADS-B knows
// only about aircraft that are flying now, so "tomorrow" cannot be tracked —
// it can only be saved. Rather than leaving that to be discovered as an empty
// result, the trackability line under the row says which of the three cases
// you are in, before you press anything.

export default function FlightPicker({ onTrack, onSave, today = isoDate() }) {
  const [iata, setIata] = useState('6E');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [num, setNum] = useState('');
  const [date, setDate] = useState(today);
  const box = useRef(null);

  const airline = airlineByIata(iata);
  const matches = useMemo(() => searchAirlines(q).slice(0, 60), [q]);
  const plan = useMemo(() => makePlan({ iata, number: num, date }), [iata, num, date]);
  const track = trackability(date, today);

  const chips = [
    { d: addDays(today, -1), label: 'Yesterday' },
    { d: today, label: 'Today' },
    { d: addDays(today, 1), label: 'Tomorrow' },
  ];

  function choose(a) {
    setIata(a.iata);
    setQ('');
    setOpen(false);
    box.current?.focus();
  }

  return (
    <div className="fp">
      <div className="fp-row">
        {/* ---- airline ---- */}
        <div className="fp-air">
          <label className="fp-lbl">Airline</label>
          <button className="fp-airbtn" onClick={() => setOpen(o => !o)} type="button">
            <span className="fp-code">{airline?.iata || '—'}</span>
            <span className="fp-name">{airline?.name || 'Choose'}</span>
            <span className="fp-caret">{open ? '▲' : '▼'}</span>
          </button>
          {open && (
            <div className="fp-drop">
              <input
                className="fp-search" autoFocus value={q}
                onChange={e => setQ(e.target.value)}
                placeholder={`Search ${AIRLINE_LIST.length} airlines…`}
                onKeyDown={e => {
                  if (e.key === 'Escape') { setOpen(false); setQ(''); }
                  if (e.key === 'Enter' && matches[0]) choose(matches[0]);
                }}
              />
              <div className="fp-list">
                {matches.map(a => (
                  <button key={a.iata} type="button"
                    className={`fp-item${a.iata === iata ? ' on' : ''}`}
                    onClick={() => choose(a)}>
                    <span className="fp-icode">{a.iata}</span>
                    <span>{a.name}</span>
                    <span className="fp-iicao">{a.icao}</span>
                  </button>
                ))}
                {!matches.length && <div className="small muted" style={{ padding: 10 }}>No airline matches “{q}”.</div>}
              </div>
            </div>
          )}
        </div>

        {/* ---- number ---- */}
        <div className="fp-num">
          <label className="fp-lbl">Flight number</label>
          <div className="fp-numbox">
            {/* The code sits inside the field as a prefix rather than in
                placeholder text, so what you are about to search is visible
                the whole time you are typing. */}
            <span className="fp-prefix">{airline?.iata || '--'}</span>
            <input
              ref={box} className="fp-numin" value={num} inputMode="numeric"
              onChange={e => setNum(e.target.value.replace(/[^0-9a-zA-Z]/g, '').slice(0, 4))}
              placeholder="512"
              onKeyDown={e => { if (e.key === 'Enter' && plan && track.can) onTrack?.(plan); }}
            />
          </div>
        </div>
      </div>

      {/* ---- date ---- */}
      <div className="fp-dates">
        <span className="fp-lbl" style={{ alignSelf: 'center' }}>Date</span>
        {chips.map(c => (
          <button key={c.label} type="button"
            className={`btn btn-sm${date === c.d ? ' btn-cyan' : ''}`}
            onClick={() => setDate(c.d)}>{c.label}</button>
        ))}
        <input type="date" className="fp-date" value={date}
          onChange={e => setDate(e.target.value || today)} />
      </div>

      <div className="fp-go">
        <div className={`fp-note fp-note-${track.state}`}>
          {plan ? <><b>{plan.flightNo}</b> · {dayLabel(date, today)} — {track.text}</> : 'Pick an airline and type the flight number.'}
        </div>
        <div className="flex" style={{ gap: 6 }}>
          <button className="btn btn-sm" type="button" disabled={!plan}
            onClick={() => plan && onSave?.(plan)}>+ Save</button>
          <button className="btn btn-cyan" type="button" disabled={!plan || !track.can}
            onClick={() => plan && onTrack?.(plan)}
            title={track.can ? 'Look for this aircraft now' : track.text}>
            Track live
          </button>
        </div>
      </div>
    </div>
  );
}
