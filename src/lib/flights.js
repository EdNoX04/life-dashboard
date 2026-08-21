// Live flight tracking, on top of adsb.lol.
//
// Everything here is pure. The network lives in api/flight.js, because
// adsb.lol sends no CORS headers at all — verified empirically from the
// deployed origin, with a known-CORS endpoint as a control, so this is a fact
// about them and not a guess about us. A browser cannot call it directly.
//
// What the data actually is, and what it is not: adsb.lol is a community
// network of volunteer ADS-B receivers. An aircraft appears when a receiver
// can hear it. Over cities and coastlines that is nearly everything; over open
// ocean it is nothing at all — a live probe of the Dubai–Mumbai corridor found
// 48 aircraft over Dubai, 25 over the Gulf of Oman, 14 over Mumbai, and ZERO
// in the middle of the Arabian Sea. That gap is the single most important
// thing this module models. A tracker that leaves the marker sitting where it
// last saw the aircraft is telling you the plane is there. It is not; nobody
// is listening. Hence `coverage()`.

// ---------------------------------------------------------------- airlines
//
// IATA (what is on your boarding pass) -> ICAO (what is in the callsign).
// EK2 is transmitted as UAE2; 6E1492 as IGO1492. Without this table a search
// for your own flight number finds nothing, which is the first thing anybody
// tries.
export const AIRLINES = {
  EK: 'UAE', FZ: 'FDB', EY: 'ETD', QR: 'QTR', GF: 'GFA', WY: 'OMA', G9: 'ABY',
  KU: 'KAC', J9: 'JZR', SV: 'SVA', XY: 'KNE', MS: 'MSR', RJ: 'RJA', ME: 'MEA',
  AI: 'AIC', IX: 'AXB', '6E': 'IGO', SG: 'SEJ', QP: 'AKJ', UK: 'VTI', I5: 'IAD',
  PK: 'PIA', UL: 'ALK', BG: 'BBC', RA: 'RNA', KB: 'DRK',
  BA: 'BAW', VS: 'VIR', LH: 'DLH', AF: 'AFR', KL: 'KLM', IB: 'IBE', AZ: 'ITY',
  LX: 'SWR', OS: 'AUA', SN: 'BEL', SK: 'SAS', AY: 'FIN', TP: 'TAP', TK: 'THY',
  LO: 'LOT', FR: 'RYR', U2: 'EZY', W6: 'WZZ', VY: 'VLG', EW: 'EWG', DY: 'NOZ',
  AA: 'AAL', UA: 'UAL', DL: 'DAL', WN: 'SWA', AS: 'ASA', B6: 'JBU', NK: 'NKS',
  F9: 'FFT', AC: 'ACA', WS: 'WJA', AM: 'AMX', LA: 'LAN', AV: 'AVA', CM: 'CMP',
  SQ: 'SIA', CX: 'CPA', JL: 'JAL', NH: 'ANA', KE: 'KAL', OZ: 'AAR', TG: 'THA',
  MH: 'MAS', GA: 'GIA', PR: 'PAL', VN: 'HVN', BR: 'EVA', CI: 'CAL', CA: 'CCA',
  MU: 'CES', CZ: 'CSN', HU: 'CHH', QF: 'QFA', NZ: 'ANZ', VA: 'VOZ', JQ: 'JST',
  ET: 'ETH', KQ: 'KQA', SA: 'SAA', MK: 'MAU', TU: 'TAR', AT: 'RAM',
  D0: 'DHK', FX: 'FDX', '5X': 'UPS', CV: 'CLX', SU: 'AFL', KC: 'KZR',
};

// Reverse lookup, built once. Used to show "EK 2" next to a raw "UAE2".
export const ICAO_TO_IATA = Object.fromEntries(Object.entries(AIRLINES).map(([i, o]) => [o, i]));

// ---------------------------------------------------------------- airports
// lat/lon so a route can be drawn and a distance computed without another API.
export const AIRPORTS = {
  DXB: { name: 'Dubai Intl', city: 'Dubai', country: 'AE', lat: 25.2532, lon: 55.3657 },
  DWC: { name: 'Al Maktoum', city: 'Dubai', country: 'AE', lat: 24.8967, lon: 55.1614 },
  AUH: { name: 'Abu Dhabi', city: 'Abu Dhabi', country: 'AE', lat: 24.4330, lon: 54.6511 },
  SHJ: { name: 'Sharjah', city: 'Sharjah', country: 'AE', lat: 25.3286, lon: 55.5172 },
  DOH: { name: 'Hamad Intl', city: 'Doha', country: 'QA', lat: 25.2731, lon: 51.6081 },
  MCT: { name: 'Muscat', city: 'Muscat', country: 'OM', lat: 23.5933, lon: 58.2844 },
  BAH: { name: 'Bahrain Intl', city: 'Manama', country: 'BH', lat: 26.2708, lon: 50.6336 },
  KWI: { name: 'Kuwait Intl', city: 'Kuwait City', country: 'KW', lat: 29.2266, lon: 47.9689 },
  RUH: { name: 'King Khalid', city: 'Riyadh', country: 'SA', lat: 24.9576, lon: 46.6988 },
  JED: { name: 'King Abdulaziz', city: 'Jeddah', country: 'SA', lat: 21.6796, lon: 39.1565 },

  DEL: { name: 'Indira Gandhi', city: 'Delhi', country: 'IN', lat: 28.5562, lon: 77.1000 },
  BOM: { name: 'Chhatrapati Shivaji', city: 'Mumbai', country: 'IN', lat: 19.0887, lon: 72.8679 },
  BLR: { name: 'Kempegowda', city: 'Bengaluru', country: 'IN', lat: 13.1979, lon: 77.7063 },
  MAA: { name: 'Chennai Intl', city: 'Chennai', country: 'IN', lat: 12.9941, lon: 80.1709 },
  HYD: { name: 'Rajiv Gandhi', city: 'Hyderabad', country: 'IN', lat: 17.2403, lon: 78.4294 },
  CCU: { name: 'Netaji Subhas', city: 'Kolkata', country: 'IN', lat: 22.6547, lon: 88.4467 },
  COK: { name: 'Cochin Intl', city: 'Kochi', country: 'IN', lat: 10.1520, lon: 76.4019 },
  AMD: { name: 'Ahmedabad', city: 'Ahmedabad', country: 'IN', lat: 23.0772, lon: 72.6347 },
  GOI: { name: 'Goa Dabolim', city: 'Goa', country: 'IN', lat: 15.3808, lon: 73.8314 },
  TRV: { name: 'Trivandrum', city: 'Thiruvananthapuram', country: 'IN', lat: 8.4821, lon: 76.9200 },
  JAI: { name: 'Jaipur', city: 'Jaipur', country: 'IN', lat: 26.8242, lon: 75.8122 },
  LKO: { name: 'Lucknow', city: 'Lucknow', country: 'IN', lat: 26.7606, lon: 80.8893 },
  PNQ: { name: 'Pune', city: 'Pune', country: 'IN', lat: 18.5822, lon: 73.9197 },
  CMB: { name: 'Bandaranaike', city: 'Colombo', country: 'LK', lat: 7.1808, lon: 79.8841 },
  KHI: { name: 'Jinnah Intl', city: 'Karachi', country: 'PK', lat: 24.9065, lon: 67.1608 },
  KTM: { name: 'Tribhuvan', city: 'Kathmandu', country: 'NP', lat: 27.6966, lon: 85.3591 },
  DAC: { name: 'Shahjalal', city: 'Dhaka', country: 'BD', lat: 23.8433, lon: 90.3978 },

  LHR: { name: 'Heathrow', city: 'London', country: 'GB', lat: 51.4700, lon: -0.4543 },
  LGW: { name: 'Gatwick', city: 'London', country: 'GB', lat: 51.1537, lon: -0.1821 },
  CDG: { name: 'Charles de Gaulle', city: 'Paris', country: 'FR', lat: 49.0097, lon: 2.5479 },
  AMS: { name: 'Schiphol', city: 'Amsterdam', country: 'NL', lat: 52.3105, lon: 4.7683 },
  FRA: { name: 'Frankfurt', city: 'Frankfurt', country: 'DE', lat: 50.0379, lon: 8.5622 },
  MUC: { name: 'Munich', city: 'Munich', country: 'DE', lat: 48.3537, lon: 11.7750 },
  IST: { name: 'Istanbul', city: 'Istanbul', country: 'TR', lat: 41.2753, lon: 28.7519 },
  FCO: { name: 'Fiumicino', city: 'Rome', country: 'IT', lat: 41.8003, lon: 12.2389 },
  MAD: { name: 'Barajas', city: 'Madrid', country: 'ES', lat: 40.4983, lon: -3.5676 },
  ZRH: { name: 'Zurich', city: 'Zurich', country: 'CH', lat: 47.4647, lon: 8.5492 },

  JFK: { name: 'John F Kennedy', city: 'New York', country: 'US', lat: 40.6413, lon: -73.7781 },
  EWR: { name: 'Newark', city: 'New York', country: 'US', lat: 40.6895, lon: -74.1745 },
  LAX: { name: 'Los Angeles', city: 'Los Angeles', country: 'US', lat: 33.9416, lon: -118.4085 },
  SFO: { name: 'San Francisco', city: 'San Francisco', country: 'US', lat: 37.6213, lon: -122.3790 },
  ORD: { name: "O'Hare", city: 'Chicago', country: 'US', lat: 41.9742, lon: -87.9073 },
  DFW: { name: 'Dallas/Fort Worth', city: 'Dallas', country: 'US', lat: 32.8998, lon: -97.0403 },
  ATL: { name: 'Hartsfield', city: 'Atlanta', country: 'US', lat: 33.6407, lon: -84.4277 },
  YYZ: { name: 'Pearson', city: 'Toronto', country: 'CA', lat: 43.6777, lon: -79.6248 },

  SIN: { name: 'Changi', city: 'Singapore', country: 'SG', lat: 1.3644, lon: 103.9915 },
  HKG: { name: 'Hong Kong Intl', city: 'Hong Kong', country: 'HK', lat: 22.3080, lon: 113.9185 },
  BKK: { name: 'Suvarnabhumi', city: 'Bangkok', country: 'TH', lat: 13.6900, lon: 100.7501 },
  KUL: { name: 'Kuala Lumpur', city: 'Kuala Lumpur', country: 'MY', lat: 2.7456, lon: 101.7099 },
  NRT: { name: 'Narita', city: 'Tokyo', country: 'JP', lat: 35.7720, lon: 140.3929 },
  HND: { name: 'Haneda', city: 'Tokyo', country: 'JP', lat: 35.5494, lon: 139.7798 },
  ICN: { name: 'Incheon', city: 'Seoul', country: 'KR', lat: 37.4602, lon: 126.4407 },
  PEK: { name: 'Beijing Capital', city: 'Beijing', country: 'CN', lat: 40.0799, lon: 116.6031 },
  PVG: { name: 'Pudong', city: 'Shanghai', country: 'CN', lat: 31.1443, lon: 121.8083 },
  SYD: { name: 'Kingsford Smith', city: 'Sydney', country: 'AU', lat: -33.9399, lon: 151.1753 },
  MEL: { name: 'Tullamarine', city: 'Melbourne', country: 'AU', lat: -37.6690, lon: 144.8410 },
  AKL: { name: 'Auckland', city: 'Auckland', country: 'NZ', lat: -37.0082, lon: 174.7850 },

  CAI: { name: 'Cairo Intl', city: 'Cairo', country: 'EG', lat: 30.1219, lon: 31.4056 },
  ADD: { name: 'Bole', city: 'Addis Ababa', country: 'ET', lat: 8.9779, lon: 38.7993 },
  NBO: { name: 'Jomo Kenyatta', city: 'Nairobi', country: 'KE', lat: -1.3192, lon: 36.9278 },
  JNB: { name: 'OR Tambo', city: 'Johannesburg', country: 'ZA', lat: -26.1392, lon: 28.2460 },
  GRU: { name: 'Guarulhos', city: 'Sao Paulo', country: 'BR', lat: -23.4356, lon: -46.4731 },
  MEX: { name: 'Benito Juarez', city: 'Mexico City', country: 'MX', lat: 19.4363, lon: -99.0721 },
};

export const airport = code => (code ? AIRPORTS[String(code).toUpperCase().trim()] || null : null);

// ---------------------------------------------------------------- queries

/**
 * Turn whatever someone typed into candidate ADS-B callsigns.
 *
 * "EK2", "ek 2", "EK-2"        -> ["UAE2"]
 * "6E1492"                      -> ["IGO1492"]
 * "UAE2"                        -> ["UAE2"]        (already a callsign)
 * "AI 916"                      -> ["AIC916"]
 *
 * Returns an ARRAY because a bare "AI916" is ambiguous in principle, and
 * because we always also try the raw input — some operators transmit the IATA
 * form, and guessing wrong silently is worse than trying twice.
 */
export function toCallsigns(input) {
  const raw = String(input || '').toUpperCase().replace(/[\s\-_/]/g, '');
  if (!raw) return [];
  const out = [];
  const push = v => { if (v && !out.includes(v)) out.push(v); };

  // Two-character IATA prefix, which may contain a digit (6E, U2, B6, 5X).
  const m2 = /^([A-Z0-9]{2})(\d{1,4}[A-Z]?)$/.exec(raw);
  if (m2 && AIRLINES[m2[1]]) push(AIRLINES[m2[1]] + m2[2]);

  // Three-letter ICAO prefix — already a callsign.
  const m3 = /^([A-Z]{3})(\d{1,4}[A-Z]?)$/.exec(raw);
  if (m3) push(raw);

  push(raw);           // always try it verbatim
  return out;
}

/**
 * Does this look like a registration rather than a flight number?
 *
 * Deliberately narrow: a registration either carries a hyphen (A6-EUR, VT-ANB,
 * G-EZBC, D-AIMA, 9V-SKA) or is a US N-number (N3864L). Anything looser
 * collides with flight numbers — "AI916" is a perfectly good registration
 * shape, and treating it as one would break the commonest search in the app.
 */
export const looksLikeReg = s => {
  const v = String(s || '').trim().toUpperCase();
  if (/^[A-Z0-9]{1,2}-[A-Z0-9]{1,5}$/.test(v)) return true;      // hyphenated, worldwide
  if (/^N\d{1,5}[A-Z]{0,2}$/.test(v)) return true;               // United States
  return false;
};

/** A 24-bit ICAO address: exactly six hex digits. */
export const looksLikeHex = s => /^[0-9a-f]{6}$/i.test(String(s || '').trim());

/**
 * Decide which upstream endpoint a free-text query should hit.
 *
 * Order matters, and one collision forced it. "6E1492" is IndiGo flight 6E 1492
 * AND six perfectly valid hex digits — as are "AI9161", "B6100A" and anything
 * else built from A-F. Checking hex first would send every IndiGo search to the
 * wrong endpoint and return nothing. So a KNOWN airline prefix followed by
 * digits wins; a bare six-hex-digit string that is not a known airline is
 * treated as an ICAO address. An enthusiast hunting hex 6e1492 specifically is
 * a rarer user than a passenger looking up their own flight.
 */
export function routeQuery(q) {
  const s = String(q || '').trim();
  if (!s) return null;
  const bare = s.toUpperCase().replace(/[\s\-_/]/g, '');

  // 1. a known IATA airline code + a flight number
  const m = /^([A-Z0-9]{2})(\d{1,4}[A-Z]?)$/.exec(bare);
  if (m && AIRLINES[m[1]]) return { op: 'callsign', q: s };

  // 2. a known ICAO airline code + a flight number (already a callsign)
  const m3 = /^([A-Z]{3})(\d{1,4}[A-Z]?)$/.exec(bare);
  if (m3 && ICAO_TO_IATA[m3[1]]) return { op: 'callsign', q: s };

  // 3. an unambiguous 24-bit ICAO address
  if (looksLikeHex(bare)) return { op: 'hex', q: bare.toLowerCase() };

  // 4. a registration. NOTE: tested against the ORIGINAL string, not `bare` —
  // the hyphen in A6-EUR is the signal, and `bare` has just removed it.
  const asReg = s.toUpperCase().trim();
  if (looksLikeReg(asReg)) return { op: 'reg', q: asReg };

  // 5. anything else: try it as a callsign
  return { op: 'callsign', q: s };
}

// ---------------------------------------------------------------- normalise

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Normalise one adsb.lol aircraft record.
 *
 * The trap this function exists for: `alt_baro` is the STRING "ground" when
 * the aircraft is on the ground, and a number otherwise. `Number('ground')` is
 * NaN, but a careless `alt || 0` turns a parked A380 into one at sea level and
 * a chart into a cliff. On-ground is a distinct state, not an altitude of nil.
 */
export function parseAircraft(a) {
  if (!a || typeof a !== 'object') return null;
  const onGround = a.alt_baro === 'ground';
  const flight = String(a.flight || '').trim();
  const icaoPrefix = /^([A-Z]{3})\d/.exec(flight)?.[1] || null;
  const iata = icaoPrefix ? ICAO_TO_IATA[icaoPrefix] || null : null;

  return {
    hex: String(a.hex || '').trim().toLowerCase() || null,
    callsign: flight || null,
    // "EK 2" reconstructed from "UAE2", so the row matches the boarding pass.
    flightNo: iata && flight ? `${iata} ${flight.slice(icaoPrefix.length)}` : null,
    airline: icaoPrefix,
    reg: a.r ? String(a.r).trim() : null,
    type: a.t ? String(a.t).trim() : null,
    onGround,
    altFt: onGround ? 0 : num(a.alt_baro),
    altGeomFt: num(a.alt_geom),
    groundSpeedKt: num(a.gs),
    machNo: num(a.mach),
    trackDeg: num(a.track),
    headingDeg: num(a.true_heading) ?? num(a.mag_heading),
    verticalRateFpm: num(a.baro_rate) ?? num(a.geom_rate),
    lat: num(a.lat),
    lon: num(a.lon),
    squawk: a.squawk ? String(a.squawk) : null,
    emergency: a.emergency && a.emergency !== 'none' ? String(a.emergency) : null,
    // seen / seen_pos are SECONDS since the last message. They are how we know
    // whether we are looking at an aircraft or at a memory of one.
    seenSec: num(a.seen),
    seenPosSec: num(a.seen_pos),
    // Multilateration rather than a real ADS-B position: less precise, and
    // worth saying so rather than drawing it with the same confidence.
    mlat: Array.isArray(a.mlat) ? a.mlat.length > 0 : Boolean(a.mlat),
    military: a.dbFlags === 1 || (Number(a.dbFlags) & 1) === 1,
    windDirDeg: num(a.wd),
    windKt: num(a.ws),
    oatC: num(a.oat),
    distanceNm: num(a.dst),
  };
}

export const parseFeed = json => {
  const list = json && Array.isArray(json.ac) ? json.ac : [];
  return list.map(parseAircraft).filter(a => a && a.hex);
};

/** Only those we can actually draw. Everything else has no position yet. */
export const positioned = list => (list || []).filter(a => a && a.lat != null && a.lon != null);

// ---------------------------------------------------------------- coverage

export const COVERAGE_STALE_SEC = 60;
export const COVERAGE_LOST_SEC = 300;

/**
 * Is this a live position, an ageing one, or an aircraft that has flown out of
 * receiver range? The Arabian Sea has no receivers in it, so a Dubai-Mumbai
 * flight WILL go quiet mid-route. Saying "lost coverage" is the truth; leaving
 * the marker sitting there is a lie the user cannot detect.
 */
export function coverage(ac, nowSec = 0) {
  const age = ac?.seenPosSec ?? ac?.seenSec;
  if (age == null) return { state: 'unknown', ageSec: null, live: false, text: 'no position reported' };
  if (age <= COVERAGE_STALE_SEC) return { state: 'live', ageSec: age, live: true, text: 'live' };
  if (age <= COVERAGE_LOST_SEC) {
    return { state: 'stale', ageSec: age, live: false, text: `${Math.round(age)}s since last signal` };
  }
  return {
    state: 'lost', ageSec: age, live: false,
    text: `out of receiver coverage — last seen ${fmtAge(age)} ago`,
  };
}

export function fmtAge(sec) {
  if (sec == null) return '—';
  if (sec < 90) return `${Math.round(sec)}s`;
  if (sec < 5400) return `${Math.round(sec / 60)} min`;
  return `${(sec / 3600).toFixed(1)} h`;
}

// ---------------------------------------------------------------- phase

/**
 * Flight phase from vertical rate and altitude. The ±250 fpm deadband is not
 * arbitrary: real cruise wanders by a hundred feet a minute, and a tighter
 * threshold makes a level aircraft flicker between "climbing" and "descending"
 * on every poll.
 */
export function phaseOf(ac) {
  if (!ac) return { key: 'unknown', label: 'Unknown' };
  if (ac.onGround) return { key: 'ground', label: 'On ground' };
  const vr = ac.verticalRateFpm;
  if (vr != null && vr > 250) return { key: 'climb', label: 'Climbing' };
  if (vr != null && vr < -250) return { key: 'descent', label: 'Descending' };
  if (ac.altFt != null && ac.altFt >= 18000) return { key: 'cruise', label: 'Cruise' };
  return { key: 'level', label: 'Level' };
}

// ---------------------------------------------------------------- geometry

const R_KM = 6371.0088;
const rad = d => (d * Math.PI) / 180;
const deg = r => (r * 180) / Math.PI;

export function haversineKm(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function bearingDeg(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const dLon = rad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) -
    Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(dLon);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/**
 * Points along the great circle from a to b, by spherical linear
 * interpolation. A straight line on a flat map is the wrong path AND the wrong
 * length — Dubai to Mumbai bends visibly north of the rhumb line — so the
 * route arc has to be computed on the sphere even though we then flatten it.
 */
export function greatCircle(a, b, n = 64) {
  if (!a || !b || a.lat == null || b.lat == null) return [];
  const φ1 = rad(a.lat), λ1 = rad(a.lon), φ2 = rad(b.lat), λ2 = rad(b.lon);
  const d = 2 * Math.asin(Math.min(1, Math.sqrt(
    Math.sin((φ2 - φ1) / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin((λ2 - λ1) / 2) ** 2)));
  const pts = [];
  if (d === 0) return [{ lat: a.lat, lon: a.lon }];
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
    const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
    const z = A * Math.sin(φ1) + B * Math.sin(φ2);
    pts.push({ lat: deg(Math.atan2(z, Math.sqrt(x * x + y * y))), lon: deg(Math.atan2(y, x)) });
  }
  return pts;
}

/**
 * Orthographic projection — the globe. `front` is back-face culling: a point
 * on the far side of the sphere must not be drawn, or Australia appears
 * through the Atlantic and the whole thing stops reading as a sphere.
 */
export function project(lat, lon, { rotation = 0, tilt = 0, r = 100, cx = 0, cy = 0 } = {}) {
  const φ = rad(lat), λ = rad(lon + rotation);
  const t = rad(tilt);
  const x = Math.cos(φ) * Math.sin(λ);
  const y = Math.cos(t) * Math.sin(φ) - Math.sin(t) * Math.cos(φ) * Math.cos(λ);
  const z = Math.sin(t) * Math.sin(φ) + Math.cos(t) * Math.cos(φ) * Math.cos(λ);
  return { x: cx + r * x, y: cy - r * y, front: z >= 0, z };
}

/** Split a projected path wherever it crosses the horizon, so no line cuts across the globe. */
export function splitAtHorizon(points, opts) {
  const segs = [];
  let cur = [];
  for (const p of points) {
    const q = project(p.lat, p.lon, opts);
    if (q.front) cur.push(q);
    else if (cur.length) { segs.push(cur); cur = []; }
  }
  if (cur.length) segs.push(cur);
  return segs.filter(s => s.length > 1);
}

// ---------------------------------------------------------------- progress

/**
 * How far along the route, by distance rather than by time — we have a
 * position and no schedule, and distance is the thing we can actually measure.
 * Clamped to 0..1 because an aircraft that has not departed yet, or that is
 * holding past the destination, must not produce -4% or 118%.
 */
export function progress(from, to, pos) {
  const total = haversineKm(from, to);
  if (!total || !pos || pos.lat == null) return null;
  const done = haversineKm(from, pos);
  const left = haversineKm(to, pos);
  if (done == null || left == null) return null;
  const pct = Math.max(0, Math.min(1, done / total));
  return { pct, totalKm: total, doneKm: done, leftKm: left };
}

/** Minutes remaining at the current ground speed. Null if stopped — not Infinity. */
export function etaMinutes(leftKm, groundSpeedKt) {
  if (leftKm == null || !groundSpeedKt || groundSpeedKt < 40) return null;
  const kmh = groundSpeedKt * 1.852;
  return Math.round((leftKm / kmh) * 60);
}

export function fmtDuration(min) {
  if (min == null) return '—';
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`;
}

// ---------------------------------------------------------------- formatting

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export function compass(deg_) {
  if (deg_ == null) return '—';
  return COMPASS[Math.round(((deg_ % 360) + 360) % 360 / 22.5) % 16];
}

export const fmtAlt = ft => (ft == null ? '—' : ft === 0 ? 'ground' : `${Math.round(ft).toLocaleString('en-US')} ft`);
export const fmtSpeed = kt => (kt == null ? '—' : `${Math.round(kt)} kt · ${Math.round(kt * 1.852)} km/h`);
export const fmtKm = km => (km == null ? '—' : km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km).toLocaleString('en-US')} km`);
export const fmtVs = fpm => (fpm == null ? '—' : fpm === 0 ? 'level' : `${fpm > 0 ? '▲' : '▼'} ${Math.abs(Math.round(fpm)).toLocaleString('en-US')} fpm`);

// ---------------------------------------------------------------- browsing

/** Preset areas for "show me what is flying somewhere". */
export const PRESETS = [
  { id: 'dubai', label: 'Dubai', lat: 25.2532, lon: 55.3657, r: 250 },
  { id: 'delhi', label: 'Delhi', lat: 28.5562, lon: 77.1000, r: 250 },
  { id: 'mumbai', label: 'Mumbai', lat: 19.0887, lon: 72.8679, r: 250 },
  { id: 'london', label: 'London', lat: 51.4700, lon: -0.4543, r: 250 },
  { id: 'newyork', label: 'New York', lat: 40.6413, lon: -73.7781, r: 250 },
  { id: 'singapore', label: 'Singapore', lat: 1.3644, lon: 103.9915, r: 250 },
  { id: 'tokyo', label: 'Tokyo', lat: 35.5494, lon: 139.7798, r: 250 },
  { id: 'losangeles', label: 'Los Angeles', lat: 33.9416, lon: -118.4085, r: 250 },
];

// adsb.lol caps the radius at 250 nm. Asking for more is a 4xx, so clamp here
// rather than letting the user discover the limit as a failed request.
export const MAX_RADIUS_NM = 250;
export const DEFAULT_RADIUS_NM = 100;
export const clampRadius = n => {
  // `Number(n) || DEFAULT` would be wrong: 0 is falsy but it is a real number
  // the user typed, and it should clamp up to the minimum rather than silently
  // become 100. Absent or unparseable is the only case that gets the default.
  const v = Number(n);
  if (!Number.isFinite(v)) return DEFAULT_RADIUS_NM;
  return Math.max(1, Math.min(MAX_RADIUS_NM, Math.round(v)));
};

/** Busiest first, so the list leads with something worth looking at. */
export const sortForList = list => [...(list || [])].sort((a, b) => {
  if (a.onGround !== b.onGround) return a.onGround ? 1 : -1;
  return (b.altFt ?? -1) - (a.altFt ?? -1);
});

/** A one-line summary of a feed, for the card header. */
export function feedSummary(list) {
  const all = list || [];
  const air = all.filter(a => !a.onGround);
  const ground = all.length - air.length;
  if (!all.length) return 'nothing in range right now';
  const parts = [`${air.length} airborne`];
  if (ground) parts.push(`${ground} on the ground`);
  const mil = all.filter(a => a.military).length;
  if (mil) parts.push(`${mil} military`);
  return parts.join(' · ');
}
