// One-time helper: turn a Google OAuth "Desktop app" client into a long-lived
// refresh token that the meetings worker uses. Run this ONCE PER ACCOUNT on your Mac.
//
//   node scripts/get-google-token.mjs            -> GOOGLE_REFRESH_TOKEN      (personal)
//   node scripts/get-google-token.mjs work       -> GOOGLE_WORK_REFRESH_TOKEN (company Workspace)
//
// The same OAuth client issues both: sign in as whichever account you want the
// token for when the browser page opens. There is no second Cloud project to set
// up, and the two tokens are independent, so revoking one leaves the other alone.
//
// Prereqs (see MEETINGS-SETUP.md for the click-by-click):
//   1. Google Cloud Console → enable "Google Calendar API" AND "Gmail API".
//   2. OAuth consent screen → External → add yourself as a Test user.
//   3. Credentials → Create OAuth client ID → type "Desktop app".
//   4. Export the client id/secret before running:
//        export GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
//        export GOOGLE_CLIENT_SECRET=yyyy
//
// It prints a URL, you approve in the browser, paste the code back, and it
// prints your refresh token. Put that + the id/secret into GitHub secrets.
//
// If you already have a calendar-only token from before Gmail was added: it will
// keep working for calendar, and the worker will say so rather than throwing a
// bare 403 — but mail stays dark until you re-run this and replace the secret.

import { createServer } from 'http';
import { exec } from 'child_process';
import readline from 'readline';

const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;
if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
  console.error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET first (export them), then re-run.');
  process.exit(1);
}

// Which account this run is for. Only affects the wording and the name of the
// secret printed at the end — Google decides the actual account from whoever you
// are signed in as on the consent page.
const WHICH = (process.argv[2] || 'personal').toLowerCase();
const SECRET_NAME = WHICH === 'work' ? 'GOOGLE_WORK_REFRESH_TOKEN' : 'GOOGLE_REFRESH_TOKEN';

// calendar.events writes meetings; gmail.readonly powers the unread strip. The
// read-only Gmail scope is deliberate: the worker has no send path at all, so the
// token it holds cannot be used to mail anyone even if something goes wrong with
// it. Google shows both on the consent screen, and declining mail still yields a
// working calendar token.
const SCOPE = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/gmail.readonly',
].join(' ');
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
  const granted = (tok.scope || '').split(' ').filter(Boolean);
  const pad = SECRET_NAME.length > 20 ? SECRET_NAME.length : 20;
  console.log('\n==================  GITHUB SECRETS  ==================');
  console.log('GOOGLE_CLIENT_ID'.padEnd(pad), '=', GOOGLE_CLIENT_ID);
  console.log('GOOGLE_CLIENT_SECRET'.padEnd(pad), '=', GOOGLE_CLIENT_SECRET);
  console.log(SECRET_NAME.padEnd(pad), '=', tok.refresh_token);
  console.log((WHICH === 'work' ? 'GOOGLE_WORK_CALENDAR_ID' : 'GOOGLE_CALENDAR_ID').padEnd(pad), '= primary');
  console.log('=====================================================');
  console.log(`Account: ${WHICH}`);
  console.log(`Scopes granted: ${granted.map(x => x.split('/').pop()).join(', ') || '(none reported)'}`);
  if (!granted.some(x => x.includes('gmail'))) {
    console.log('NOTE: Gmail was not granted, so the inbox strip will stay empty.');
    console.log('      Calendar still works. Re-run and tick the mail box to add it.');
  }
  console.log('');
} catch (e) {
  console.error('Exchange failed:', e.message);
  process.exit(1);
}
process.exit(0);
