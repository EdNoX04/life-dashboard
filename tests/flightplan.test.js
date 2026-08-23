import { test, expect } from 'bun:test';
import {
  AIRLINE_LIST, airlineByIata, searchAirlines,
  isoDate, addDays, dayLabel, trackability,
  makePlan, planKey, flightsFromCalendar,
  parseSchedule, delayMinutes, fmtLocal, SCHEDULE_UNAVAILABLE, hubFor,
} from '../src/lib/flightplan.js';
import { AIRLINES } from '../src/lib/flights.js';

// ---------------------------------------------------------------- airlines

test('every airline offered in the picker can be turned into a callsign', () => {
  // Offering one we cannot resolve would be offering a search that always fails.
  AIRLINE_LIST.forEach(a => {
    expect(AIRLINES[a.iata]).toBe(a.icao);
    expect(a.name.length).toBeGreaterThan(2);
  });
  expect(AIRLINE_LIST.length).toBeGreaterThan(60);
});

test('the list is sorted by name and has no duplicates', () => {
  const names = AIRLINE_LIST.map(a => a.name);
  expect([...names].sort((x, y) => x.localeCompare(y))).toEqual(names);
  expect(new Set(AIRLINE_LIST.map(a => a.iata)).size).toBe(AIRLINE_LIST.length);
});

test('picking IndiGo gives 6E, which is the whole point of the picker', () => {
  const ig = airlineByIata('6E');
  expect(ig.name).toBe('IndiGo');
  expect(ig.icao).toBe('IGO');
  expect(airlineByIata('ek').name).toBe('Emirates');
  expect(airlineByIata('ZZ')).toBe(null);
});

test('airline search matches name, IATA and ICAO', () => {
  expect(searchAirlines('indigo')[0].iata).toBe('6E');
  expect(searchAirlines('6E')[0].iata).toBe('6E');
  expect(searchAirlines('IGO')[0].iata).toBe('6E');
  expect(searchAirlines('emir')[0].name).toBe('Emirates');
  expect(searchAirlines('')).toEqual(AIRLINE_LIST);
  expect(searchAirlines('zzzz')).toEqual([]);
});

// ---------------------------------------------------------------- dates

test('isoDate uses the LOCAL day, not UTC', () => {
  expect(isoDate(new Date(2026, 7, 22, 23, 45))).toBe('2026-08-22');
  expect(isoDate(new Date(2026, 0, 1, 0, 5))).toBe('2026-01-01');
});

test('addDays crosses months and years', () => {
  expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
  expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  expect(addDays('rubbish', 1)).toBe(null);
});

test('dayLabel names today, tomorrow and yesterday', () => {
  const t = '2026-08-22';
  expect(dayLabel('2026-08-22', t)).toBe('Today');
  expect(dayLabel('2026-08-23', t)).toBe('Tomorrow');
  expect(dayLabel('2026-08-21', t)).toBe('Yesterday');
  expect(dayLabel('2026-09-05', t)).toContain('Sep');
});

// ---------------------------------------------------------------- trackability

test('only today can actually be tracked, and the other cases say why', () => {
  const t = '2026-08-22';
  expect(trackability('2026-08-22', t).can).toBe(true);
  expect(trackability('2026-08-23', t).can).toBe(false);
  expect(trackability('2026-08-23', t).state).toBe('future');
  expect(trackability('2026-08-21', t).can).toBe(false);
  expect(trackability('2026-08-21', t).state).toBe('past');
});

test('a future date explains that there is nothing to find yet', () => {
  const r = trackability('2026-08-23', '2026-08-22');
  expect(r.text).toContain('airborne');
  expect(r.text.toLowerCase()).toContain('tomorrow');
});

test('a past date does not pretend history is replayable', () => {
  expect(trackability('2026-08-01', '2026-08-22').text).toContain('live only');
});

// ---------------------------------------------------------------- plans

test('a plan is built from a picked airline and a typed number', () => {
  const p = makePlan({ iata: '6E', number: '1492', date: '2026-08-22' });
  expect(p.flightNo).toBe('6E 1492');
  expect(p.callsign).toBe('IGO1492');       // what the aircraft actually transmits
  expect(p.airline).toBe('IndiGo');
  expect(planKey(p)).toBe('6E1492|2026-08-22');
});

test('makePlan tolerates the ways people type a flight number', () => {
  for (const n of ['1492', ' 1492 ', '1492 ', 'IGO-1492'.replace('IGO-', '')]) {
    expect(makePlan({ iata: '6E', number: n, date: '2026-08-22' }).number).toBe('1492');
  }
});

test('makePlan refuses rubbish rather than producing a broken plan', () => {
  expect(makePlan({ iata: 'ZZ', number: '1', date: '2026-08-22' })).toBe(null);
  expect(makePlan({ iata: '6E', number: '', date: '2026-08-22' })).toBe(null);
  expect(makePlan({ iata: '6E', number: 'abcd', date: '2026-08-22' })).toBe(null);
  expect(makePlan({ iata: '6E', number: '99999', date: '2026-08-22' })).toBe(null);
});

// ---------------------------------------------------------------- calendar

const EVENTS = [
  { summary: 'EK 512 Dubai (DXB) to Mumbai (BOM)', start: '2026-08-25T18:40:00+04:00' },
  { summary: 'Emirates 2', start: '2026-08-26T09:00:00+04:00' },
  { summary: '6E 1492 to Delhi', description: 'Dep (DXB) Arr (DEL)', start: '2026-08-27T02:15:00+04:00' },
  { summary: 'Team standup', start: '2026-08-23T09:00:00+04:00' },
  { summary: 'Invoice AI 2024 review', start: '2026-08-24T09:00:00+04:00' },
  { summary: 'Meeting room 6E', start: '2026-08-24T11:00:00+04:00' },
];

test('flights are pulled out of calendar events with their date and airports', () => {
  const f = flightsFromCalendar(EVENTS, '2026-08-22');
  const ek = f.find(x => x.flightNo === 'EK 512');
  expect(ek).toBeTruthy();
  expect(ek.date).toBe('2026-08-25');
  expect(ek.from).toBe('DXB');
  expect(ek.to).toBe('BOM');
  expect(ek.callsign).toBe('UAE512');
  expect(ek.source).toBe('calendar');
});

test('airport codes are found in the description as well as the summary', () => {
  const f = flightsFromCalendar(EVENTS, '2026-08-22');
  const ig = f.find(x => x.flightNo === '6E 1492');
  expect(ig.from).toBe('DXB');
  expect(ig.to).toBe('DEL');
});

test('a bare flight-number match needs corroboration to count', () => {
  const t = '2026-08-22';
  // no flight words, no airports, not at the start -> refused
  expect(flightsFromCalendar([{ summary: 'Invoice AI 2024 review', start: '2026-08-24' }], t)).toEqual([]);
  expect(flightsFromCalendar([{ summary: 'Budget EK 500 approved', start: '2026-08-24' }], t)).toEqual([]);
  // ...but any one of the three signals is enough
  expect(flightsFromCalendar([{ summary: 'AI 2024', start: '2026-08-24' }], t).length).toBe(1);
  expect(flightsFromCalendar([{ summary: 'Your flight AI 2024', start: '2026-08-24' }], t).length).toBe(1);
  expect(flightsFromCalendar([{ summary: 'x AI 2024 (DEL) (BOM)', start: '2026-08-24' }], t).length).toBe(1);
});

test('ordinary calendar events are NOT turned into flights', () => {
  // This is the guard that matters. "Invoice AI 2024" and "Meeting room 6E"
  // both match a naive two-letters-then-digits pattern; a fabricated flight
  // would send someone looking for an aeroplane that does not exist.
  const f = flightsFromCalendar(EVENTS, '2026-08-22');
  expect(f.some(x => x.title.includes('standup'))).toBe(false);
  expect(f.some(x => x.number === '2024')).toBe(false);
  expect(f.find(x => x.title === 'Meeting room 6E')).toBeFalsy();
});

test('an event with no parseable date is skipped rather than dated today', () => {
  expect(flightsFromCalendar([{ summary: 'EK 512', start: 'sometime' }], '2026-08-22')).toEqual([]);
  expect(flightsFromCalendar([{ summary: 'EK 512' }], '2026-08-22')).toEqual([]);
});

test('duplicate flights across events collapse to one', () => {
  const dup = [
    { summary: 'EK 512', start: '2026-08-25T18:40:00+04:00' },
    { summary: 'EK 512 reminder', start: '2026-08-25T10:00:00+04:00' },
  ];
  expect(flightsFromCalendar(dup, '2026-08-22').length).toBe(1);
});

test('upcoming flights sort before past ones', () => {
  const mixed = [
    { summary: 'EK 1', start: '2026-08-30T10:00:00+04:00' },
    { summary: 'EK 2', start: '2026-08-10T10:00:00+04:00' },
    { summary: 'EK 3', start: '2026-08-24T10:00:00+04:00' },
  ];
  const f = flightsFromCalendar(mixed, '2026-08-22');
  expect(f.map(x => x.number)).toEqual(['3', '1', '2']);
});

test('flightsFromCalendar survives every malformed input', () => {
  expect(flightsFromCalendar(null)).toEqual([]);
  expect(flightsFromCalendar([])).toEqual([]);
  expect(flightsFromCalendar([null, 'nope', 42])).toEqual([]);
  expect(flightsFromCalendar([{}])).toEqual([]);
});

// ---------------------------------------------------------------- schedule

const ADB = {
  number: 'EK 512', status: 'Expected',
  airline: { name: 'Emirates' },
  aircraft: { model: 'Boeing 777-300ER', reg: 'A6-EQI' },
  departure: {
    airport: { iata: 'DXB', name: 'Dubai' }, terminal: '3', gate: 'A12',
    checkInDesk: '1-40',
    scheduledTime: { local: '2026-08-25 18:40+04:00', utc: '2026-08-25 14:40Z' },
    revisedTime: { local: '2026-08-25 19:05+04:00' },
    quality: ['Basic', 'Live'],
  },
  arrival: {
    airport: { iata: 'BOM', name: 'Mumbai' }, terminal: '2', baggageBelt: '7',
    scheduledTime: { local: '2026-08-25 23:35+05:30' },
    quality: ['Basic'],
  },
};

test('a schedule record yields terminal, gate and baggage belt', () => {
  const s = parseSchedule(ADB);
  expect(s.departure.terminal).toBe('3');
  expect(s.departure.gate).toBe('A12');
  expect(s.departure.checkInDesk).toBe('1-40');
  expect(s.arrival.terminal).toBe('2');
  expect(s.arrival.belt).toBe('7');
  expect(s.aircraft).toBe('Boeing 777-300ER');
  expect(s.reg).toBe('A6-EQI');
});

test('parseSchedule accepts the array form the API actually returns', () => {
  expect(parseSchedule([ADB]).number).toBe('EK 512');
});

test('the quality array is carried through, because it is what says what to trust', () => {
  const s = parseSchedule(ADB);
  expect(s.departure.quality).toContain('Live');
  expect(s.arrival.quality).toEqual(['Basic']);
});

test('missing fields stay null rather than becoming empty strings', () => {
  const s = parseSchedule({ number: 'XX 1', departure: { airport: { iata: 'AAA' } } });
  expect(s.departure.terminal).toBe(null);
  expect(s.departure.gate).toBe(null);
  expect(s.arrival).toBe(null);
});

test('parseSchedule rejects rubbish', () => {
  expect(parseSchedule(null)).toBe(null);
  expect(parseSchedule([])).toBe(null);
  expect(parseSchedule('nope')).toBe(null);
});

test('delay is computed only when both times exist — silence is not "on time"', () => {
  expect(delayMinutes(parseSchedule(ADB).departure)).toBe(25);
  expect(delayMinutes(parseSchedule(ADB).arrival)).toBe(null);
  expect(delayMinutes(null)).toBe(null);
  expect(delayMinutes({ scheduled: 'x', revised: 'y' })).toBe(null);
});

test('times show the AIRPORT clock, not the viewer\'s', () => {
  // The number people want is the one on the departure board. Parsing through
  // Date and calling getHours() re-expresses it in the viewer's timezone, so a
  // 23:35 Mumbai arrival read as 22:05 in Dubai and 18:10 in London.
  expect(fmtLocal('2026-08-25 18:40+04:00')).toBe('18:40');   // Dubai board
  expect(fmtLocal('2026-08-25 23:35+05:30')).toBe('23:35');   // Mumbai board
  expect(fmtLocal('2026-08-25T06:05-05:00')).toBe('06:05');   // T form too
  expect(fmtLocal(null)).toBe(null);
  expect(fmtLocal('nonsense')).toBe(null);
});

test('the airport clock is independent of the machine running the code', () => {
  const was = process.env.TZ;
  for (const tz of ['UTC', 'Asia/Kolkata', 'America/New_York', 'Pacific/Auckland']) {
    process.env.TZ = tz;
    expect(fmtLocal('2026-08-25 18:40+04:00')).toBe('18:40');
  }
  process.env.TZ = was;
});

test('the no-key message says what is missing and why', () => {
  expect(SCHEDULE_UNAVAILABLE).toContain('ADS-B does not carry them');
});

// ---------------------------------------------------------------- hubs

test('every hub we name is a real airport in the table', () => {
  // A hub pointing at an airport flights.js does not know would make the
  // fallback query silently impossible.
  const { AIRPORTS } = require('../src/lib/flights.js');
  AIRLINE_LIST.forEach(a => {
    const h = hubFor(a.iata);
    if (h) expect(AIRPORTS[h]).toBeTruthy();
  });
});

test('the airlines most likely to be searched here all have a hub', () => {
  expect(hubFor('EK')).toBe('DXB');
  expect(hubFor('6E')).toBe('DEL');
  expect(hubFor('AI')).toBe('DEL');
  expect(hubFor('FZ')).toBe('DXB');
  expect(hubFor('QR')).toBe('DOH');
});

test('an airline with no hub returns null rather than a wrong airport', () => {
  expect(hubFor('ZZ')).toBe(null);
  expect(hubFor(null)).toBe(null);
  expect(hubFor('')).toBe(null);
});
