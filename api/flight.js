// /api/flight — the only way the browser reaches live aircraft data.
//
// This proxy is not a preference, it is a requirement. adsb.lol sends no CORS
// headers, which I verified from the deployed origin with a known-CORS
// endpoint (open-meteo) as a control in the same page: the control succeeded,
// adsb.lol failed, and there is no CSP on the app. So the failure is theirs and
// a browser can never call them directly.
//
// It also does two things a browser could not do well even if CORS allowed it:
//
//   1. Rate limiting. adsb.lol asks for roughly one request per second. I hit
//      their 429 during testing at 1.1s spacing, so the real ceiling is tighter
//      than the documented one. Several open tabs polling independently would
//      sail past it and get the whole app blocked.
//   2. Caching. Aircraft positions update every few seconds at best. Serving a
//      cached response for a few seconds costs the user nothing visible and
//      cuts upstream traffic by an order of magnitude.
//
// No API key is involved anywhere. adsb.lol is a volunteer network, BSD-3
// licensed, and free without registration. There is nothing here to leak.

const UPSTREAM = 'https://api.adsb.lol';

// Cache TTLs per operation, in ms. Positions genuinely change; the military
// and emergency feeds are browsed rather than watched, so they can sit longer.
const TTL = { callsign: 6000, hex: 6000, reg: 6000, point: 8000, mil: 20000, sqk: 15000 };

// Minimum gap between two upstream calls from THIS instance. Serverless means
// several instances may exist, so this is a floor rather than a guarantee —
// the cache above is what actually does the heavy lifting.
const MIN_GAP_MS = 1100;

const cache = new Map();          // key -> { at, body }
let lastUpstreamAt = 0;
let chain = Promise.resolve();    // serialises upstream calls within an instance

const json = (res, code, body, cacheSec = 0) => {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  // Let Vercel's edge hold it too, so a reload does not even reach this function.
  if (cacheSec > 0) res.setHeader('Cache-Control', `public, s-maxage=${cacheSec}, stale-while-revalidate=30`);
  else res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Build the upstream path. The client never supplies a URL — only an op and a value. */
function pathFor(op, q, lat, lon, r) {
  switch (op) {
    case 'callsign': return `/v2/callsign/${encodeURIComponent(q)}`;
    case 'hex':      return `/v2/hex/${encodeURIComponent(q)}`;
    case 'reg':      return `/v2/reg/${encodeURIComponent(q)}`;
    case 'mil':      return '/v2/mil';
    case 'sqk':      return `/v2/sqk/${encodeURIComponent(q)}`;
    case 'point':    return `/v2/point/${lat}/${lon}/${r}`;
    default:         return null;
  }
}

/**
 * One upstream fetch, throttled and serialised.
 *
 * The `chain` promise is the important part: without it, two concurrent
 * requests both read `lastUpstreamAt`, both decide they have waited long
 * enough, and both fire at once — which is exactly the burst the throttle
 * exists to prevent.
 */
function fetchUpstream(path) {
  const run = async () => {
    const wait = MIN_GAP_MS - (Date.now() - lastUpstreamAt);
    if (wait > 0) await sleep(wait);
    lastUpstreamAt = Date.now();

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 9000);
    try {
      const r = await fetch(UPSTREAM + path, {
        signal: ctl.signal,
        headers: { accept: 'application/json', 'user-agent': 'player-one-dashboard/1.0 (personal use)' },
      });
      const ct = r.headers.get('content-type') || '';
      const text = await r.text();

      // Their rate limiter answers with an nginx HTML page, not JSON. Parsing
      // that blindly throws a SyntaxError that looks nothing like the "you are
      // going too fast" it actually means.
      if (!ct.includes('json')) {
        const why = r.status === 429 ? 'upstream rate limit — try again in a few seconds'
          : `upstream returned ${r.status} (${ct.split(';')[0] || 'unknown type'})`;
        return { ok: false, status: r.status === 429 ? 429 : 502, error: why };
      }
      try {
        return { ok: true, status: 200, body: JSON.parse(text) };
      } catch {
        return { ok: false, status: 502, error: 'upstream sent malformed JSON' };
      }
    } catch (e) {
      const aborted = e && (e.name === 'AbortError' || String(e).includes('abort'));
      return { ok: false, status: 504, error: aborted ? 'upstream timed out' : String(e.message || e).slice(0, 160) };
    } finally {
      clearTimeout(timer);
    }
  };

  // Queue behind whatever is already in flight, and never let one failure
  // poison the chain for every later caller.
  const queued = chain.then(run, run);
  chain = queued.then(() => {}, () => {});
  return queued;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'GET only' });

  const url = new URL(req.url, 'http://localhost');
  const op = String(url.searchParams.get('op') || '').toLowerCase();
  const q = String(url.searchParams.get('q') || '').trim();

  if (!TTL[op]) {
    return json(res, 400, { error: `unknown op — expected one of ${Object.keys(TTL).join(', ')}` });
  }

  let lat, lon, r;
  if (op === 'point') {
    lat = Number(url.searchParams.get('lat'));
    lon = Number(url.searchParams.get('lon'));
    r = Number(url.searchParams.get('r'));
    // Validated here as well as in the client. A serverless function is a
    // public URL: whatever the UI does, this endpoint can be called directly.
    if (!Number.isFinite(lat) || Math.abs(lat) > 90) return json(res, 400, { error: 'lat must be between -90 and 90' });
    if (!Number.isFinite(lon) || Math.abs(lon) > 180) return json(res, 400, { error: 'lon must be between -180 and 180' });
    r = Number.isFinite(r) ? Math.max(1, Math.min(250, Math.round(r))) : 100;
    lat = Math.round(lat * 1e4) / 1e4;
    lon = Math.round(lon * 1e4) / 1e4;
  } else if (op !== 'mil') {
    if (!q) return json(res, 400, { error: 'q is required' });
    if (q.length > 12 || !/^[A-Za-z0-9-]+$/.test(q)) return json(res, 400, { error: 'q must be short and alphanumeric' });
  }

  const path = pathFor(op, q, lat, lon, r);
  if (!path) return json(res, 400, { error: 'unsupported op' });

  const key = path;
  const hit = cache.get(key);
  const ttl = TTL[op];
  if (hit && Date.now() - hit.at < ttl) {
    return json(res, 200, { ...hit.body, _cache: 'hit', _ageMs: Date.now() - hit.at }, Math.round(ttl / 1000));
  }

  const out = await fetchUpstream(path);
  if (!out.ok) {
    // Serve stale rather than nothing. A thirty-second-old position clearly
    // labelled with its age is far more use than an error box, and the client
    // already knows how to age a position out of "live" on its own.
    if (hit) {
      return json(res, 200, { ...hit.body, _cache: 'stale', _ageMs: Date.now() - hit.at, _warn: out.error });
    }
    return json(res, out.status, { error: out.error });
  }

  cache.set(key, { at: Date.now(), body: out.body });
  // Unbounded growth would be a slow leak across a warm instance's lifetime.
  if (cache.size > 200) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, 60);
    oldest.forEach(([k]) => cache.delete(k));
  }
  return json(res, 200, { ...out.body, _cache: 'miss' }, Math.round(ttl / 1000));
}
