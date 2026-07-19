// One-time helper: turn a Google OAuth "Desktop app" client into a long-lived
// refresh token that the meetings worker uses. Run this ONCE on your Mac.
//
//   node scripts/get-google-token.mjs
//
// Prereqs (see MEETINGS-SETUP.md for the click-by-click):
//   1. Google Cloud Console → enable "Google Calendar API".
//   2. OAuth consent screen → External → add yourself as a Test user.
//   3. Credentials → Create OAuth client ID → type "Desktop app".
//   4. Export the client id/secret before running:
//        export GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
//        export GOOGLE_CLIENT_SECRET=yyyy
//
// It prints a URL, you approve in the browser, paste the code back, and it
// prints your GOOGLE_REFRESH_TOKEN. Put that + the id/secret into GitHub secrets.

import { createServer } from 'http';
import { exec } from 'child_process';
import readline from 'readline';

const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;
if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
  console.error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET first (export them), then re-run.');
  process.exit(1);
}

const SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const REDIRECT = 'http://localhost:53682';

const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id: GOOGLE_CLIENT_ID,
  redirect_uri: REDIRECT,
  response_type: 'code',
  scope: SCOPE,
  access_type: 'offline',
  prompt: 'consent',
});

async function exchange(code) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: REDIRECT, grant_type: 'authorization_code',
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(j));
  return j;
}

function localCatch() {
  return new Promise(resolve => {
    const server = createServer((req, res) => {
      const u = new URL(req.url, REDIRECT);
      const code = u.searchParams.get('code');
      res.end('You can close this tab and return to the terminal.');
      if (code) { server.close(); resolve(code); }
    }).listen(53682);
  });
}

console.log('\nOpen this URL, pick your Google account, approve:\n\n' + authUrl + '\n');
exec(`open "${authUrl}" 2>/dev/null || xdg-open "${authUrl}" 2>/dev/null`);

// Either catch the redirect automatically, or let the user paste the code.
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const manual = new Promise(res => rl.question('...or paste the "code" query param here if it did not auto-catch: ', res));

const code = await Promise.race([localCatch(), manual.then(c => c.trim())]);
rl.close();

try {
  const tok = await exchange(code);
  if (!tok.refresh_token) {
    console.error('\nNo refresh_token returned. Remove app access at https://myaccount.google.com/permissions and retry (prompt=consent forces it).');
    process.exit(1);
  }
  console.log('\n==================  GITHUB SECRETS  ==================');
  console.log('GOOGLE_CLIENT_ID      =', GOOGLE_CLIENT_ID);
  console.log('GOOGLE_CLIENT_SECRET  =', GOOGLE_CLIENT_SECRET);
  console.log('GOOGLE_REFRESH_TOKEN  =', tok.refresh_token);
  console.log('GOOGLE_CALENDAR_ID    = primary   (or your ednox042004@gmail.com)');
  console.log('=====================================================\n');
} catch (e) {
  console.error('Exchange failed:', e.message);
  process.exit(1);
}
process.exit(0);
