// Choosing a flight, rather than watching one.
//
// lib/flights.js is about aircraft that are transmitting right now. This module
// is about the flight you have a booking for — picking the airline, the number
// and the date, pulling flights out of your calendar, and folding in schedule
// data (terminal, gate, baggage belt) when a key for it exists.
//
// The honesty problem this module has to solve, stated plainly:
//
//   ADS-B has no schedules. It tells you where an aeroplane is, not that a
//   flight exists, when it is due, or which belt your bag lands on. So a
//   date picker is inherently a promise the radar cannot keep — you cannot
//   "track" tomorrow's flight, because tomorrow's aeroplane is not flying yet.
//
// The answer is to keep the two apart everywhere: a PLAN (airline, number,
// date — something you chose) is a different object from a SIGHTING (a live
// position). A plan for a future date is saved and waits; only a plan for
// today can go looking for an aircraft.

import { AIRLINES, ICAO_TO_IATA } from './flights.js';

// ---------------------------------------------------------------- airlines

// Names for the picker. Only airlines that also have an ICAO mapping in
// flights.js are listed — offering one we cannot turn into a callsign would be
// offering a search that always fails.
const NAMES = {
  EK: 'Emirates', FZ: 'flydubai', EY: 'Etihad Airways', QR: 'Qatar Airways',
  GF: 'Gulf Air', WY: 'Oman Air', G9: 'Air Arabia', KU: 'Kuwait Airways',
  J9: 'Jazeera Airways', SV: 'Saudia', XY: 'flynas', MS: 'EgyptAir',
  RJ: 'Royal Jordanian', ME: 'Middle East Airlines',
  AI: 'Air India', IX: 'Air India Express', '6E': 'IndiGo', SG: 'SpiceJet',
  QP: 'Akasa Air', UK: 'Vistara', I5: 'AIX Connect',
  PK: 'Pakistan Intl', UL: 'SriLankan', BG: 'Biman Bangladesh',
  RA: 'Nepal Airlines', KB: 'Druk Air',
  BA: 'British Airways', VS: 'Virgin Atlantic', LH: 'Lufthansa', AF: 'Air France',
  KL: 'KLM', IB: 'Iberia', AZ: 'ITA Airways', LX: 'SWISS', OS: 'Austrian',
  SN: 'Brussels Airlines', SK: 'SAS', AY: 'Finnair', TP: 'TAP Portugal',
  TK: 'Turkish Airlines', LO: 'LOT Polish', FR: 'Ryanair', U2: 'easyJet',
  W6: 'Wizz Air', VY: 'Vueling', EW: 'Eurowings', DY: 'Norwegian',
  AA: 'American Airlines', UA: 'United Airlines', DL: 'Delta Air Lines',
  WN: 'Southwest', AS: 'Alaska Airlines', B6: 'JetBlue', NK: 'Spirit',
  F9: 'Frontier', AC: 'Air Canada', WS: 'WestJet', AM: 'Aeromexico',
  LA: 'LATAM', AV: 'Avianca', CM: 'Copa Airlines',
  SQ: 'Singapore Airlines', CX: 'Cathay Pacific', JL: 'Japan Airlines',
  NH: 'ANA', KE: 'Korean Air', OZ: 'Asiana', TG: 'Thai Airways',
  MH: 'Malaysia Airlines', GA: 'Garuda Indonesia', PR: 'Philippine Airlines',
  VN: 'Vietnam Airlines', BR: 'EVA Air', CI: 'China Airlines',
  CA: 'Air China', MU: 'China Eastern', CZ: 'China Southern', HU: 'Hainan',
  QF: 'Qantas', NZ: 'Air New Zealand', VA: 'Virgin Australia', JQ: 'Jetstar',
  ET: 'Ethiopian', KQ: 'Kenya Airways', SA: 'South African', MK: 'Air Mauritius',
  TU: 'Tunisair', AT: 'Royal Air Maroc',
  D0: 'DHL Air', FX: 'FedEx', '5X': 'UPS Airlines', CV: 'Cargolux',
  SU: 'Aeroflot', KC: 'Air Astana',
};

/** The picker's list: every airline we can actually resolve to a callsign. */
export const AIRLINE_LIST = Object.keys(AIRLINES)
  .filter(iata => NAMES[iata])
  .map(iata => ({ iata, icao: AIRLINES[iata], name: NAMES[iata] }))
  .sort((a, b) => a.name.localeCompare(b.name));

export const airlineByIata = iata =>
  AIRLINE_LIST.find(a => a.iata === String(iata || '').toUpperCase()) || null;

/** Substring match on name or code, for a type-ahead. */
export function searchAirlines(q) {
  const s = String(q || '').trim().toLowerCase();
  if (!s) return AIRLINE_LIST;
  return AIRLINE_LIST.filter(a =>
    a.name.toLowerCase().includes(s) ||
    a.iata.toLowerCase() === s ||
    a.icao.toLowerCase() === s);
}

// ---------------------------------------------------------------- dates

const pad = n => String(n).padStart(2, '0');

/** Local calendar date. Never toISOString — in IST that reports tomorrow after 18:30. */
export const isoDate = (d = new Date()) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function addDays(iso, n) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim());
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  d.setDate(d.getDate() + n);
  return isoDate(d);
}

export function dayLabel(iso, today = isoDate()) {
  if (!iso) return '';
  if (iso === today) return 'Today';
  if (iso === addDays(today, 1)) return 'Tomorrow';
  if (iso === addDays(today, -1)) return 'Yesterday';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return '';
  return new Date(+m[1], +m[2] - 1, +m[3])
    .toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}

/**
 * What the radar can honestly do with a plan on this date.
 *
 * This is the function that stops the date picker from lying. Live ADS-B only
 * knows about aircraft in the air now, so:
 *   - today      -> we can look for it
 *   - future     -> we can save it and wait; there is nothing to find yet
 *   - past       -> gone; adsb.lol keeps no history we can query
 */
export function trackability(date, today = isoDate()) {
  if (!date) return { can: false, state: 'none', text: 'Pick a date.' };
  if (date === today) {
    return { can: true, state: 'today', text: 'Live tracking — looking for it on the radar now.' };
  }
  if (date > today) {
    const days = Math.round((new Date(date) - new Date(today)) / 86400000);
    return {
      can: false, state: 'future',
      text: `Saved for ${dayLabel(date, today).toLowerCase()}. Live tracking starts once the aircraft is airborne — ADS-B has nothing to show ${days === 1 ? 'a day' : `${days} days`} ahead.`,
    };
  }
  return {
    can: false, state: 'past',
    text: 'In the past. This radar is live only — it keeps no history to replay.',
  };
}

// ---------------------------------------------------------------- plans

/** Normalise a picked airline + typed number into a plan. */
export function makePlan({ iata, number, date, from = null, to = null, source = 'manual' }) {
  const air = airlineByIata(iata);
  const num = String(number || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (!air || !num || !/^\d{1,4}[A-Z]?$/.test(num)) return null;
  return {
    id: `${air.iata}${num}|${date}`,
    iata: air.iata,
    icao: air.icao,
    airline: air.name,
    number: num,
    flightNo: `${air.iata} ${num}`,
    callsign: `${air.icao}${num}`,
    date: date || isoDate(),
    from, to, source,
  };
}

export const planKey = p => (p ? `${p.iata}${p.number}|${p.date}` : null);

// ---------------------------------------------------------------- calendar

// Flight numbers inside free text. Requires a real IATA airline code so that
// "Room 6E 204" and "Invoice AI 2024" do not become flights — the airline
// table is what makes this safe rather than a generic two-letters-then-digits
// pattern, which matches an enormous amount of ordinary prose.
const FLIGHT_RE = /\b([A-Z0-9]{2})\s?-?\s?(\d{1,4})\b/g;
const IATA3_RE = /\(([A-Z]{3})\)/g;

// Words that only show up around actual travel.
const FLIGHT_WORDS = /\b(flight|flights|depart|departs|departure|arrive|arrives|arrival|boarding|terminal|gate|check-?in|pnr|booking ref|airport|airways|airlines|air india|indigo|emirates|etihad|qatar|seat)\b/i;

/**
 * Is this really a flight, or just two letters next to a number?
 *
 * The airline-code check alone is not enough, and a test caught why: "Invoice
 * AI 2024 review" contains a real IATA code (AI) followed by a plausible
 * flight number, and became Air India 2024. Putting a fabricated flight in
 * someone's list sends them looking for an aeroplane that does not exist, so
 * the match now needs corroboration — any ONE of:
 *
 *   - the text talks about flying at all (FLIGHT_WORDS), or
 *   - it names two airports in brackets, as Gmail's auto-added events do, or
 *   - the flight number is the very start of the summary, which is the shape
 *     of every airline confirmation email.
 *
 * "Invoice AI 2024 review" has none of the three and is correctly ignored.
 */
function looksLikeFlightEvent(text, match, ports) {
  if (FLIGHT_WORDS.test(text)) return true;
  if (ports.length >= 2) return true;
  return match.index === 0 || /^\s*$/.test(text.slice(0, match.index));
}

/**
 * Pull flights out of Google Calendar events.
 *
 * Gmail auto-adds flights with summaries like "Emirates 512" or
 * "EK 512 Dubai to Mumbai", and often puts "(DXB)" / "(BOM)" in the summary or
 * location. We take the airline code, the number, the date from the event
 * start, and any airport codes we can find.
 *
 * Deliberately conservative: an event only becomes a flight if the two-letter
 * prefix is a real airline in our table. A false positive here would put a
 * fictional flight in the user's list and send them looking for an aeroplane
 * that does not exist.
 */
export function flightsFromCalendar(events, today = isoDate()) {
  const out = [];
  const seen = new Set();

  for (const ev of Array.isArray(events) ? events : []) {
    if (!ev || typeof ev !== 'object') continue;
    const text = [ev.summary, ev.description, ev.location].filter(Boolean).join(' \n ');
    if (!text) continue;

    const date = String(ev.start || ev.date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

    // airport codes, if the event names them
    const ports = [];
    let pm;
    IATA3_RE.lastIndex = 0;
    while ((pm = IATA3_RE.exec(text))) ports.push(pm[1]);

    FLIGHT_RE.lastIndex = 0;
    let m;
    while ((m = FLIGHT_RE.exec(text))) {
      const iata = m[1].toUpperCase();
      if (!AIRLINES[iata]) continue;              // must be a real airline...
      if (!looksLikeFlightEvent(text, m, ports)) continue;   // ...and look like a flight
      const plan = makePlan({
        iata, number: m[2], date,
        from: ports[0] || null, to: ports[1] || null,
        source: 'calendar',
      });
      if (!plan || seen.has(plan.id)) continue;
      seen.add(plan.id);
      out.push({ ...plan, title: String(ev.summary || '').slice(0, 90), when: ev.start || null });
    }
  }

  // Soonest first, but anything already past drops to the bottom rather than
  // pushing the flight you are actually about to take off the screen.
  return out.sort((a, b) => {
    const ap = a.date < today, bp = b.date < today;
    if (ap !== bp) return ap ? 1 : -1;
    return a.date.localeCompare(b.date);
  });
}

// ---------------------------------------------------------------- schedule

/**
 * Normalise one AeroDataBox flight record.
 *
 * Their `quality` array is the important part and the reason this is worth
 * doing carefully: it lists which classes of information are actually backed
 * by a source for this flight. A missing terminal and an unknown terminal look
 * identical in the JSON, and only `quality` distinguishes "there is no gate
 * yet" from "we do not have gate data for this airport at all".
 */
export function parseSchedule(raw) {
  const f = Array.isArray(raw) ? raw[0] : raw;
  if (!f || typeof f !== 'object') return null;

  const side = s => {
    if (!s || typeof s !== 'object') return null;
    const t = k => s[k]?.local || s[k]?.utc || null;
    return {
      airport: s.airport?.iata || s.airport?.icao || null,
      airportName: s.airport?.name || null,
      terminal: s.terminal || null,
      gate: s.gate || null,
      belt: s.baggageBelt || null,
      checkInDesk: s.checkInDesk || null,
      scheduled: t('scheduledTime'),
      revised: t('revisedTime'),
      runway: t('runwayTime'),
      quality: Array.isArray(s.quality) ? s.quality : [],
    };
  };

  return {
    number: f.number || null,
    status: f.status || null,
    airline: f.airline?.name || null,
    aircraft: f.aircraft?.model || null,
    reg: f.aircraft?.reg || null,
    departure: side(f.departure),
    arrival: side(f.arrival),
    codeshare: Boolean(f.isCargo === false && f.codeshareStatus === 'IsCodeshared'),
  };
}

/**
 * Minutes late, positive = delayed. Null when we cannot tell, which is not the
 * same as on time — an aircraft with no revised time has simply not been
 * updated, and reporting that as "on time" would be inventing good news.
 */
export function delayMinutes(side) {
  if (!side?.scheduled || !side?.revised) return null;
  const a = new Date(side.scheduled), b = new Date(side.revised);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return Math.round((b - a) / 60000);
}

/**
 * The departure-board time, read straight off the string.
 *
 * AeroDataBox sends airport-LOCAL times with their offset, e.g.
 * "2026-08-25 18:40+04:00". Parsing that with Date and calling getHours()
 * converts it into the VIEWER's timezone — so a Mumbai arrival at 23:35 IST
 * showed as 22:05 to someone sitting in Dubai, and 18:10 to someone in London.
 * That is wrong for this purpose: the number people want is the one on the
 * board at the airport, which is exactly the wall clock already in the string.
 * So take the digits and do no conversion at all.
 */
export function fmtLocal(t) {
  if (!t) return null;
  const m = /(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(String(t));
  if (!m) return null;
  return `${m[4]}:${m[5]}`;
}

/** What the schedule panel should say when there is no key configured. */
export const SCHEDULE_UNAVAILABLE =
  'Terminal, gate and baggage belt need a schedule provider — ADS-B does not carry them. ' +
  'Add an AeroDataBox key in Settings to switch this panel on.';
