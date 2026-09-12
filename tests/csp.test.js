// The Content-Security-Policy, as a test.
//
// A CSP failure is the quietest failure a web app has. The browser refuses the
// resource, the page carries on, and the only sign is a console line nobody is
// looking at — so the symptom arrives as "it doesn't work" with no trail. That
// is exactly how it went: Spotify connected, reported the account, and then sat
// on "starting the player…" forever, because script-src did not list
// sdk.scdn.co and the SDK script was never allowed to load. The error the panel
// showed said "almost always the connection rather than the account", which was
// confidently wrong.
//
// So every host this app depends on is pinned here. Adding an integration
// without adding its host is now a failing test rather than a silent nothing.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log('FAIL ' + n); } };
const eq = (a, b, n) => ok(Object.is(a, b), `${n} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'));
const headers = cfg.headers?.[0]?.headers || [];
const by = k => headers.find(h => h.key.toLowerCase() === k.toLowerCase())?.value || '';
const csp = by('Content-Security-Policy');
const directive = name => {
  const m = new RegExp(`(?:^|;)\\s*${name}\\s+([^;]+)`).exec(csp);
  return m ? m[1].trim().split(/\s+/) : [];
};

// ------------------------------------------------------------ it still exists
{
  ok(csp.length > 0, 'there is a Content-Security-Policy at all');
  eq(directive('default-src').join(' '), "'self'", 'and it defaults to refusing everything off-origin');
  eq(directive('object-src').join(' '), "'none'", 'no plugins');
  eq(directive('frame-ancestors').join(' '), "'none'", 'and the app cannot be framed');
}

// ------------------------------------------------- every script host it needs
{
  const scripts = directive('script-src');
  ok(scripts.includes("'self'"), 'the app may run its own code');
  ok(!scripts.includes("'unsafe-inline'"), "and NOT inline script — the one relaxation that would undo most of the policy's value");
  ok(!scripts.includes("'unsafe-eval'"), 'nor eval');

  // Each of these is here because something in the app stops working without
  // it, and stops working SILENTLY.
  for (const [host, why] of [
    ['https://www.youtube.com', 'the lofi radio and YouTube Music both run through the IFrame player'],
    ['https://s.ytimg.com', "YouTube's player loads its own code from here"],
    ['https://sdk.scdn.co', 'the Spotify Web Playback SDK — without this the player never starts and the page says nothing'],
  ]) {
    ok(scripts.includes(host), `${host} is allowed — ${why}`);
  }
}

// ------------------------------------------------------- the Spotify player
//
// The SDK is not just a script. It opens a websocket, plays DRM-protected
// audio through EME, and does it inside its own cross-origin iframe — so three
// more directives have to permit it or the script loads and the player still
// never becomes a device.
{
  const connect = directive('connect-src');
  ok(connect.includes('https:') || connect.includes('https://api.spotify.com'),
     'the Spotify Web API is reachable');
  ok(connect.includes('wss:'), 'and so is the websocket the player holds open — without it the SDK connects and immediately drops');

  const frames = directive('frame-src');
  ok(frames.includes('https:') || frames.includes('https://sdk.scdn.co'),
     "the SDK's own iframe is allowed");

  const media = directive('media-src');
  ok(media.includes('blob:'), 'audio arrives as a blob URL');

  // EME in a CROSS-ORIGIN iframe is not granted by default — it has to be
  // delegated explicitly, and without it playback fails only once a track is
  // actually asked for, which is the worst moment to discover it.
  const pp = by('Permissions-Policy');
  ok(/encrypted-media=\(self "https:\/\/sdk\.scdn\.co"\)/.test(pp),
     'and encrypted-media is delegated to the SDK iframe, or DRM playback fails at the first track rather than at setup');
}

// --------------------------------------------------------- the other headers
{
  ok(/max-age=\d+/.test(by('Strict-Transport-Security')), 'HSTS is set');
  eq(by('X-Content-Type-Options'), 'nosniff', 'and no MIME sniffing');
  eq(by('Referrer-Policy'), 'strict-origin-when-cross-origin', 'referrers are trimmed off-origin');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
