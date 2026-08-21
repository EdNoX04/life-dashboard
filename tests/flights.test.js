import { test, expect } from 'bun:test';
import {
  AIRLINES, ICAO_TO_IATA, AIRPORTS, airport,
  toCallsigns, looksLikeReg, looksLikeHex, routeQuery,
  parseAircraft, parseFeed, positioned,
  coverage, fmtAge, phaseOf,
  haversineKm, bearingDeg, greatCircle, project, splitAtHorizon,
  progress, etaMinutes, fmtDuration,
  compass, fmtAlt, fmtSpeed, fmtKm, fmtVs,
  clampRadius, MAX_RADIUS_NM, DEFAULT_RADIUS_NM, sortForList, feedSummary, PRESETS,
} from '../src/lib/flights.js';

// A real record, copied verbatim from a live adsb.lol response over Dubai.
const REAL = {
  hex: '8963a9', type: 'adsb_icao', flight: 'ETD574  ', r: 'A6-EIX', t: 'A320',
  alt_baro: 17025, alt_geom: 18125, gs: 392.5, ias: 318, tas: 418, mach: 0.652,
  wd: 93, ws: 26, oat: -2, tat: 21, track: 107.65, track_rate: 0, roll: -0.18,
  mag_heading: 103.71, true_heading: 106.58, baro_rate: 0, squawk: '1234',
  emergency: 'none', lat: 25.11, lon: 55.9, seen_pos: 0.4, seen: 0.1, mlat: [],
};

// ---------------------------------------------------------------- callsigns

test('IATA flight numbers become the ICAO callsigns actually transmitted', () => {
  expect(toCallsigns('EK2')).toContain('UAE2');
  expect(toCallsigns('AI916')).toContain('AIC916');
  expect(toCallsigns('IX233')).toContain('AXB233');
  expect(toCallsigns('FZ871')).toContain('FDB871');
});

test('a two-character IATA code containing a digit still resolves', () => {
  // 6E (IndiGo), U2 (easyJet), B6 (JetBlue), 5X (UPS) — a [A-Z]{2} regex misses all four.
  expect(toCallsigns('6E1492')).toContain('IGO1492');
  expect(toCallsigns('U2405')).toContain('EZY405');
  expect(toCallsigns('B6100')).toContain('JBU100');
  expect(toCallsigns('5X44')).toContain('UPS44');
});

test('spaces, hyphens and lower case all work — people type what is on the pass', () => {
  for (const q of ['EK 2', 'ek2', 'EK-2', ' ek 2 ', 'Ek/2']) {
    expect(toCallsigns(q)).toContain('UAE2');
  }
});

test('a raw ICAO callsign is passed through unchanged', () => {
  expect(toCallsigns('UAE2')).toContain('UAE2');
  expect(toCallsigns('IGO1492')).toContain('IGO1492');
});

test('the raw input is always among the candidates, even when we mapped it', () => {
  // Guessing wrong silently is worse than trying twice.
  expect(toCallsigns('EK2')).toContain('EK2');
});

test('toCallsigns never returns duplicates and is empty for empty input', () => {
  const r = toCallsigns('UAE2');
  expect(new Set(r).size).toBe(r.length);
  expect(toCallsigns('')).toEqual([]);
  expect(toCallsigns(null)).toEqual([]);
});

test('the airline table round-trips', () => {
  expect(ICAO_TO_IATA.UAE).toBe('EK');
  expect(ICAO_TO_IATA.IGO).toBe('6E');
  Object.entries(AIRLINES).forEach(([iata, icao]) => {
    expect(ICAO_TO_IATA[icao]).toBe(iata);
    expect(icao).toMatch(/^[A-Z]{3}$/);
  });
});

test('query routing distinguishes hex, registration and flight number', () => {
  expect(routeQuery('8963a9')).toEqual({ op: 'hex', q: '8963a9' });
  expect(routeQuery('EK2').op).toBe('callsign');
  expect(routeQuery('A6-EUR')).toEqual({ op: 'reg', q: 'A6-EUR' });
  expect(routeQuery('')).toBe(null);
});

test('a six-hex-digit string is a hex code, not a registration', () => {
  expect(looksLikeHex('8963a9')).toBe(true);
  expect(looksLikeHex('896')).toBe(false);
  expect(looksLikeHex('8963a9z')).toBe(false);
});

test('a known airline prefix beats the hex reading of the same string', () => {
  // "6E1492" is IndiGo 6E 1492 and also six valid hex digits. The passenger
  // looking up their own flight is the commoner user, so the airline wins.
  expect(looksLikeHex('6E1492')).toBe(true);          // it really is valid hex
  expect(routeQuery('6E1492').op).toBe('callsign');   // ...and we still route it right
  // a hex string that is NOT a known airline prefix stays a hex lookup
  expect(routeQuery('8963a9').op).toBe('hex');
  expect(routeQuery('ae07d9').op).toBe('hex');
});

test('registrations are recognised across the formats that matter here', () => {
  expect(looksLikeReg('A6-EUR')).toBe(true);   // UAE
  expect(looksLikeReg('VT-ANB')).toBe(true);   // India
  expect(looksLikeReg('G-EZBC')).toBe(true);   // UK
  expect(looksLikeReg('D-AIMA')).toBe(true);   // Germany
  expect(looksLikeReg('9V-SKA')).toBe(true);   // Singapore
  expect(looksLikeReg('N3864L')).toBe(true);   // United States
});

test('routing a registration keeps the hyphen it depends on', () => {
  // The hyphen IS the signal. Normalising it away before the check turned
  // every hyphenated registration into a failed callsign search.
  ['A6-EUR', 'a6-eur', ' VT-ANB '].forEach(q => {
    expect(routeQuery(q).op).toBe('reg');
    expect(routeQuery(q).q).toContain('-');
  });
});

// ---------------------------------------------------------------- parsing

test('a real live record parses into every field the UI uses', () => {
  const a = parseAircraft(REAL);
  expect(a.hex).toBe('8963a9');
  expect(a.callsign).toBe('ETD574');          // trailing pad stripped
  expect(a.reg).toBe('A6-EIX');
  expect(a.type).toBe('A320');
  expect(a.altFt).toBe(17025);
  expect(a.groundSpeedKt).toBe(392.5);
  expect(a.trackDeg).toBeCloseTo(107.65, 2);
  expect(a.headingDeg).toBeCloseTo(106.58, 2);
  expect(a.lat).toBeCloseTo(25.11, 3);
  expect(a.onGround).toBe(false);
  expect(a.mlat).toBe(false);
});

test('alt_baro of the STRING "ground" is a state, not an altitude', () => {
  // Number('ground') is NaN and `alt || 0` would put a parked A380 at sea level.
  const a = parseAircraft({ ...REAL, alt_baro: 'ground', gs: 12 });
  expect(a.onGround).toBe(true);
  expect(a.altFt).toBe(0);
  expect(Number.isNaN(a.altFt)).toBe(false);
  expect(phaseOf(a).key).toBe('ground');
});

test('the IATA flight number is reconstructed from the ICAO callsign', () => {
  expect(parseAircraft({ ...REAL, flight: 'UAE2   ' }).flightNo).toBe('EK 2');
  expect(parseAircraft({ ...REAL, flight: 'IGO1492' }).flightNo).toBe('6E 1492');
  // An airline we do not have in the table must not invent a number.
  expect(parseAircraft({ ...REAL, flight: 'ZZZ999' }).flightNo).toBe(null);
});

test('missing numeric fields become null, never 0 and never NaN', () => {
  const a = parseAircraft({ hex: 'abc123', flight: 'TEST1' });
  expect(a.altFt).toBe(null);
  expect(a.groundSpeedKt).toBe(null);
  expect(a.lat).toBe(null);
  expect(a.trackDeg).toBe(null);
  // the distinction that matters: null means unknown, 0 means measured zero
  const z = parseAircraft({ ...REAL, gs: 0, baro_rate: 0 });
  expect(z.groundSpeedKt).toBe(0);
  expect(z.verticalRateFpm).toBe(0);
});

test('"emergency": "none" is not an emergency', () => {
  expect(parseAircraft(REAL).emergency).toBe(null);
  expect(parseAircraft({ ...REAL, emergency: 'general' }).emergency).toBe('general');
});

test('parseAircraft rejects rubbish instead of throwing', () => {
  expect(parseAircraft(null)).toBe(null);
  expect(parseAircraft('nope')).toBe(null);
  expect(parseAircraft(42)).toBe(null);
});

test('parseFeed handles the real envelope and every malformed variant', () => {
  expect(parseFeed({ ac: [REAL], total: 1 }).length).toBe(1);
  expect(parseFeed({ ac: [] })).toEqual([]);
  expect(parseFeed({})).toEqual([]);
  expect(parseFeed(null)).toEqual([]);
  expect(parseFeed({ ac: 'not an array' })).toEqual([]);
});

test('positioned drops aircraft with no fix rather than drawing them at 0,0', () => {
  const list = parseFeed({ ac: [REAL, { hex: 'aaa111', flight: 'NOPOS1' }] });
  expect(list.length).toBe(2);
  expect(positioned(list).length).toBe(1);
});

test('military aircraft are flagged from dbFlags', () => {
  expect(parseAircraft({ ...REAL, dbFlags: 1 }).military).toBe(true);
  expect(parseAircraft(REAL).military).toBe(false);
});

// ---------------------------------------------------------------- coverage

test('coverage separates live, stale and out-of-range', () => {
  expect(coverage({ seenPosSec: 2 }).state).toBe('live');
  expect(coverage({ seenPosSec: 120 }).state).toBe('stale');
  expect(coverage({ seenPosSec: 900 }).state).toBe('lost');
});

test('a lost aircraft says so in words, because a frozen marker reads as a real position', () => {
  const c = coverage({ seenPosSec: 1800 });
  expect(c.live).toBe(false);
  expect(c.text).toContain('out of receiver coverage');
  expect(c.text).toContain('30 min');
});

test('coverage falls back to seen when seen_pos is absent, and admits total ignorance', () => {
  expect(coverage({ seenSec: 5 }).state).toBe('live');
  expect(coverage({}).state).toBe('unknown');
  expect(coverage({}).live).toBe(false);
});

test('fmtAge switches units sensibly', () => {
  expect(fmtAge(30)).toBe('30s');
  expect(fmtAge(600)).toBe('10 min');
  expect(fmtAge(7200)).toBe('2.0 h');
  expect(fmtAge(null)).toBe('—');
});

// ---------------------------------------------------------------- phase

test('phase uses a deadband so level flight does not flicker', () => {
  expect(phaseOf({ altFt: 35000, verticalRateFpm: 100 }).key).toBe('cruise');
  expect(phaseOf({ altFt: 35000, verticalRateFpm: -100 }).key).toBe('cruise');
  expect(phaseOf({ altFt: 12000, verticalRateFpm: 1800 }).key).toBe('climb');
  expect(phaseOf({ altFt: 8000, verticalRateFpm: -1200 }).key).toBe('descent');
  expect(phaseOf({ altFt: 5000, verticalRateFpm: 0 }).key).toBe('level');
  expect(phaseOf(null).key).toBe('unknown');
});

// ---------------------------------------------------------------- geometry

test('haversine matches known real-world distances', () => {
  const dxbBom = haversineKm(AIRPORTS.DXB, AIRPORTS.BOM);
  expect(dxbBom).toBeGreaterThan(1900);      // published great-circle ~1,930 km
  expect(dxbBom).toBeLessThan(1960);
  const lhrJfk = haversineKm(AIRPORTS.LHR, AIRPORTS.JFK);
  expect(lhrJfk).toBeGreaterThan(5500);      // ~5,555 km
  expect(lhrJfk).toBeLessThan(5600);
  expect(haversineKm(AIRPORTS.DXB, AIRPORTS.DXB)).toBeCloseTo(0, 5);
});

test('haversine returns null rather than NaN for missing points', () => {
  expect(haversineKm(null, AIRPORTS.DXB)).toBe(null);
  expect(haversineKm(AIRPORTS.DXB, { lat: null, lon: 5 })).toBe(null);
});

test('bearing is correct at the cardinal cases and stays in 0..360', () => {
  expect(bearingDeg({ lat: 0, lon: 0 }, { lat: 10, lon: 0 })).toBeCloseTo(0, 4);
  expect(bearingDeg({ lat: 0, lon: 0 }, { lat: 0, lon: 10 })).toBeCloseTo(90, 4);
  expect(bearingDeg({ lat: 0, lon: 0 }, { lat: -10, lon: 0 })).toBeCloseTo(180, 4);
  expect(bearingDeg({ lat: 0, lon: 0 }, { lat: 0, lon: -10 })).toBeCloseTo(270, 4);
  // Dubai -> Mumbai runs broadly east-south-east.
  const b = bearingDeg(AIRPORTS.DXB, AIRPORTS.BOM);
  expect(b).toBeGreaterThan(90);
  expect(b).toBeLessThan(135);
});

test('the great circle starts and ends on the airports and bends off the straight line', () => {
  const pts = greatCircle(AIRPORTS.DXB, AIRPORTS.BOM, 32);
  expect(pts.length).toBe(33);
  expect(pts[0].lat).toBeCloseTo(AIRPORTS.DXB.lat, 4);
  expect(pts[0].lon).toBeCloseTo(AIRPORTS.DXB.lon, 4);
  expect(pts[32].lat).toBeCloseTo(AIRPORTS.BOM.lat, 4);
  // the midpoint of a great circle is NOT the arithmetic midpoint
  const mid = pts[16];
  const flatMid = (AIRPORTS.DXB.lat + AIRPORTS.BOM.lat) / 2;
  expect(Math.abs(mid.lat - flatMid)).toBeGreaterThan(0.2);
});

test('every great-circle point is a real coordinate', () => {
  for (const [a, b] of [[AIRPORTS.LHR, AIRPORTS.SYD], [AIRPORTS.JFK, AIRPORTS.HND], [AIRPORTS.DXB, AIRPORTS.LAX]]) {
    greatCircle(a, b, 48).forEach(p => {
      expect(Number.isFinite(p.lat)).toBe(true);
      expect(Number.isFinite(p.lon)).toBe(true);
      expect(Math.abs(p.lat)).toBeLessThanOrEqual(90.001);
      expect(Math.abs(p.lon)).toBeLessThanOrEqual(180.001);
    });
  }
});

test('a great circle between identical points does not divide by zero', () => {
  const pts = greatCircle(AIRPORTS.DXB, AIRPORTS.DXB, 16);
  expect(pts.length).toBe(1);
  expect(Number.isFinite(pts[0].lat)).toBe(true);
});

test('projection culls the far side of the sphere', () => {
  const opts = { rotation: 0, tilt: 0, r: 100, cx: 0, cy: 0 };
  expect(project(0, 0, opts).front).toBe(true);       // facing us
  expect(project(0, 180, opts).front).toBe(false);    // behind the globe
  // 0,0 with no rotation sits dead centre
  const c = project(0, 0, opts);
  expect(c.x).toBeCloseTo(0, 6);
  expect(c.y).toBeCloseTo(0, 6);
});

test('projected points never escape the disc', () => {
  const opts = { rotation: 37, tilt: 12, r: 100, cx: 0, cy: 0 };
  for (let lat = -90; lat <= 90; lat += 15) {
    for (let lon = -180; lon <= 180; lon += 15) {
      const p = project(lat, lon, opts);
      expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(100.0001);
    }
  }
});

test('north pole is up and south pole is down (the SVG y-flip is applied)', () => {
  const opts = { rotation: 0, tilt: 0, r: 100, cx: 0, cy: 0 };
  expect(project(90, 0, opts).y).toBeLessThan(0);    // smaller y = higher on screen
  expect(project(-90, 0, opts).y).toBeGreaterThan(0);
});

test('a path crossing the horizon is split, never drawn across the globe', () => {
  const opts = { rotation: 0, tilt: 0, r: 100, cx: 0, cy: 0 };
  // an equatorial ring passes behind the sphere exactly once
  const ring = [];
  for (let lon = -180; lon <= 180; lon += 5) ring.push({ lat: 0, lon });
  const segs = splitAtHorizon(ring, opts);
  expect(segs.length).toBeGreaterThanOrEqual(1);
  segs.flat().forEach(p => expect(p.front).toBe(true));
});

// ---------------------------------------------------------------- progress

test('progress along a route is measured by distance and clamped to 0..100%', () => {
  const half = greatCircle(AIRPORTS.DXB, AIRPORTS.BOM, 2)[1];
  const p = progress(AIRPORTS.DXB, AIRPORTS.BOM, half);
  expect(p.pct).toBeGreaterThan(0.45);
  expect(p.pct).toBeLessThan(0.55);
  expect(p.totalKm).toBeGreaterThan(1900);
});

test('progress cannot go negative before departure or past 100% after arrival', () => {
  const behind = { lat: 25.2532, lon: 50.0 };        // west of Dubai
  const beyond = { lat: 19.0, lon: 85.0 };           // east of Mumbai
  expect(progress(AIRPORTS.DXB, AIRPORTS.BOM, behind).pct).toBeGreaterThanOrEqual(0);
  expect(progress(AIRPORTS.DXB, AIRPORTS.BOM, beyond).pct).toBeLessThanOrEqual(1);
});

test('progress returns null when it cannot know, instead of guessing', () => {
  expect(progress(AIRPORTS.DXB, AIRPORTS.BOM, null)).toBe(null);
  expect(progress(null, AIRPORTS.BOM, { lat: 20, lon: 60 })).toBe(null);
});

test('ETA is null for a stationary aircraft rather than Infinity', () => {
  expect(etaMinutes(1000, 0)).toBe(null);
  expect(etaMinutes(1000, null)).toBe(null);
  expect(etaMinutes(1000, 10)).toBe(null);          // taxiing, not en route
  expect(etaMinutes(null, 450)).toBe(null);
});

test('ETA arithmetic is right', () => {
  // 926 km at 500 kt (=926 km/h) is one hour.
  expect(etaMinutes(926, 500)).toBe(60);
  expect(fmtDuration(60)).toBe('1h 00m');
  expect(fmtDuration(95)).toBe('1h 35m');
  expect(fmtDuration(45)).toBe('45 min');
  expect(fmtDuration(null)).toBe('—');
});

// ---------------------------------------------------------------- formatting

test('compass maps degrees to points, wrapping cleanly at north', () => {
  expect(compass(0)).toBe('N');
  expect(compass(90)).toBe('E');
  expect(compass(180)).toBe('S');
  expect(compass(270)).toBe('W');
  expect(compass(359)).toBe('N');
  expect(compass(360)).toBe('N');
  expect(compass(-10)).toBe('N');
  expect(compass(null)).toBe('—');
});

test('formatters distinguish unknown from zero', () => {
  expect(fmtAlt(null)).toBe('—');
  expect(fmtAlt(0)).toBe('ground');
  expect(fmtAlt(35000)).toBe('35,000 ft');
  expect(fmtSpeed(null)).toBe('—');
  expect(fmtSpeed(500)).toContain('926 km/h');
  expect(fmtVs(null)).toBe('—');
  expect(fmtVs(0)).toBe('level');
  expect(fmtVs(-1200)).toContain('▼');
  expect(fmtKm(null)).toBe('—');
  expect(fmtKm(5.5)).toBe('5.5 km');
});

// ---------------------------------------------------------------- browsing

test('radius is clamped to what the upstream actually accepts', () => {
  expect(clampRadius(9999)).toBe(MAX_RADIUS_NM);
  expect(clampRadius(100)).toBe(100);
  // 0 is falsy but it is a real number someone typed: it clamps UP to the
  // minimum. It must NOT be mistaken for "missing" and silently become 100.
  expect(clampRadius(0)).toBe(1);
  expect(clampRadius(-50)).toBe(1);
  // genuinely absent or unparseable is the only case that gets the default
  expect(clampRadius('abc')).toBe(DEFAULT_RADIUS_NM);
  expect(clampRadius(undefined)).toBe(DEFAULT_RADIUS_NM);
});

test('a flight number is never mistaken for a registration', () => {
  // "AI916" is a valid registration SHAPE. Treating it as one would break the
  // single commonest search in the app.
  expect(looksLikeReg('AI916')).toBe(false);
  expect(looksLikeReg('EK2')).toBe(false);
  expect(routeQuery('AI916').op).toBe('callsign');
  expect(routeQuery('6E1492').op).toBe('callsign');
});

test('the list puts airborne aircraft above parked ones', () => {
  const list = [
    { onGround: true, altFt: 0 },
    { onGround: false, altFt: 35000 },
    { onGround: false, altFt: 12000 },
  ];
  const s = sortForList(list);
  expect(s[0].altFt).toBe(35000);
  expect(s[2].onGround).toBe(true);
});

test('sortForList does not mutate its input', () => {
  const list = [{ onGround: true, altFt: 0 }, { onGround: false, altFt: 100 }];
  const before = list.map(x => x.altFt).join();
  sortForList(list);
  expect(list.map(x => x.altFt).join()).toBe(before);
});

test('feedSummary counts honestly and says when there is nothing', () => {
  expect(feedSummary([])).toContain('nothing in range');
  expect(feedSummary(null)).toContain('nothing in range');
  const s = feedSummary([
    { onGround: false, military: false }, { onGround: false, military: true }, { onGround: true, military: false },
  ]);
  expect(s).toContain('2 airborne');
  expect(s).toContain('1 on the ground');
  expect(s).toContain('1 military');
});

test('every preset is a real place with a legal radius', () => {
  PRESETS.forEach(p => {
    expect(Math.abs(p.lat)).toBeLessThanOrEqual(90);
    expect(Math.abs(p.lon)).toBeLessThanOrEqual(180);
    expect(p.r).toBeLessThanOrEqual(MAX_RADIUS_NM);
    expect(p.id).toMatch(/^[a-z]+$/);
  });
  expect(new Set(PRESETS.map(p => p.id)).size).toBe(PRESETS.length);
});

test('the airport table is well formed', () => {
  Object.entries(AIRPORTS).forEach(([code, a]) => {
    expect(code).toMatch(/^[A-Z]{3}$/);
    expect(Math.abs(a.lat)).toBeLessThanOrEqual(90);
    expect(Math.abs(a.lon)).toBeLessThanOrEqual(180);
    expect(a.name.length).toBeGreaterThan(0);
  });
  expect(airport('dxb').city).toBe('Dubai');
  expect(airport('ZZZ')).toBe(null);
  expect(airport(null)).toBe(null);
});
