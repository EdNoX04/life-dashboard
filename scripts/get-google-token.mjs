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
  // "export them" was true and a dead end — it did not say where to get them,
  // which is the only hard part. Same failure the Meetings tab had.
  console.error('\nThis needs the OAuth client credentials in your shell first.\n');
  console.error('  Client ID (public, already recorded in claude/google-oauth.md):');
  console.error('    1055390146832-5isuruvjq6fdsnj2q22vh890ts106dub.apps.googleusercontent.com\n');
  console.error('  Client secret — Google Cloud Console → APIs & Services → Credentials');
  console.error('    → project marine-guard-439012-u0 → "PLAYER ONE token minter".');
  console.error('    If it is no longer displayed, "Add secret" makes a new one.\n');
  console.error('  Then, in THIS shell:\n');
  console.error('    export GOOGLE_CLIENT_ID=1055390146832-5isuruvjq6fdsnj2q22vh890ts106dub.apps.googleusercontent.com');
  console.error('    read -rs "?Client secret: " GOOGLE_CLIENT_SECRET && export GOOGLE_CLIENT_SECRET\n');
  console.error('  The `read -rs` form is deliberate: it does not echo the secret and');
  console.error('  does not put it in your shell history, which `export FOO=value` does.\n');
  console.error('  Run ONE account at a time — each opens a browser and needs THAT');
  console.error('  account signed in at the chooser.\n');
  process.exit(1);
}

// Which account this run is for. Only affects the wording and the name of the
// secret printed at the end — Google decides the actual account from whoever you
// are signed in as on the consent page.
const WHICH = (process.argv[2] || 'personal').toLowerCase();
// One mapping table rather than nested ternaries. Adding the third account
// through a chain of `x === 'work' ? ... : ...` is how the calendar-id line
// below would have kept saying GOOGLE_CALENDAR_ID for it — silently telling you
// to store the third account's id under the first account's name.
//
// `email` is what this slot is SUPPOSED to be. Google decides the real account
// from whoever is signed in on the consent page, and it has no idea which
// argument you typed — so running `... work` while the browser is still signed
// in as the personal account mints a personal token and files it under
// GOOGLE_WORK_REFRESH_TOKEN. Nothing errors. The work calendar simply shows
// personal events forever, and the cause is three commands back.
//
// So the token is checked against this before it is printed.
const SLOTS = {
  personal: { token: 'GOOGLE_REFRESH_TOKEN', cal: 'GOOGLE_CALENDAR_ID', email: 'nilabhamukherjee04@gmail.com' },
  work: { token: 'GOOGLE_WORK_REFRESH_TOKEN', cal: 'GOOGLE_WORK_CALENDAR_ID', email: 'nilabha.mukherjee@skopiaai.com' },
  third: { token: 'GOOGLE_THIRD_REFRESH_TOKEN', cal: 'GOOGLE_THIRD_CALENDAR_ID', email: 'ednox042004@gmail.com' },
};
if (!SLOTS[WHICH]) {
  console.error(`Unknown account "${WHICH}". Use one of: ${Object.keys(SLOTS).join(', ')}`);
  process.exit(1);
}
const SECRET_NAME = SLOTS[WHICH].token;
const CAL_NAME = SLOTS[WHICH].cal;
const EXPECT = SLOTS[WHICH].email;

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
  // select_account as well as consent: without it Google silently reuses the
  // session you already have, so the second and third runs would hand back a
  // token for the first account without ever asking. The chooser is the only
  // thing that makes "which account is this" a decision rather than an
  // accident.
  prompt: 'select_account consent',
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

// THE PROMPT BELOW LOOKS LIKE A SHELL PROMPT AND IS NOT ONE.
//
// This printed `...or paste the "code" here: ` and then blocked on stdin, one
// line under a wall of output, which reads exactly like the shell handing
// control back. The next command typed — `node scripts/get-google-token.mjs
// personal` — was swallowed as the auth code, sent to Google, and came back
// "Malformed auth code", which points at everything except what happened.
//
// Three changes, because the fix is not just clearer wording:
//   1. The waiting state is announced BEFORE the prompt, in its own block.
//   2. Anything that is not shaped like a Google auth code is rejected HERE,
//      by name, instead of being posted to Google and bouncing back as a
//      generic grant error.
//   3. The prompt says it is optional, since the local catcher handles this
//      almost every time and typing into it is the unusual path.
console.log('Waiting for the approval to come back on http://localhost:53682 …');
console.log('(Leave this terminal alone. It will continue on its own once you approve.)\n');

// A Google authorization code always starts "4/". Rejecting locally turns a
// confusing round trip into an immediate, specific message.
const looksLikeCode = c => /^4\//.test(String(c || '').trim());

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = () => new Promise(res => rl.question(
  'Only if it did not open — paste the "code" value from the URL (starts with 4/): ', res,
));
const manual = (async () => {
  // Keep asking rather than failing on the first mistyped line: a wrong entry
  // here used to end the run and mean starting the whole browser flow again.
  for (;;) {
    const c = (await ask()).trim();
    if (looksLikeCode(c)) return c;
    if (!c) continue;
    console.log(`\nThat is not an auth code — it was read as: ${c.slice(0, 60)}${c.length > 60 ? '…' : ''}`);
    console.log('An auth code starts with "4/". If you meant to run a command, this prompt');
    console.log('is not a shell — press Ctrl+C first, or just approve in the browser and');
    console.log('leave this alone.\n');
  }
})();

const code = await Promise.race([localCatch(), manual]);
rl.close();

try {
  const tok = await exchange(code);
  if (!tok.refresh_token) {
    console.error('\nNo refresh_token returned. Remove app access at https://myaccount.google.com/permissions and retry (prompt=consent forces it).');
    process.exit(1);
  }
  const granted = (tok.scope || '').split(' ').filter(Boolean);

  // Whose token is this REALLY? Asked of Google, not inferred from the
  // argument. gmail.readonly is already granted, so the profile endpoint costs
  // nothing extra and answers it exactly.
  let actual = null;
  if (granted.some(x => x.includes('gmail'))) {
    try {
      const pr = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
        headers: { Authorization: `Bearer ${tok.access_token}` },
      });
      const pj = await pr.json();
      actual = pj?.emailAddress || null;
    } catch { /* leave it unknown rather than claiming a match */ }
  }

  if (actual && EXPECT && actual.toLowerCase() !== EXPECT.toLowerCase()) {
    console.error('\n=====================  WRONG ACCOUNT  =====================');
    console.error(`You asked for "${WHICH}", which is ${EXPECT}`);
    console.error(`but you approved as                  ${actual}`);
    console.error('');
    console.error('Nothing has been saved. Storing this under ' + SECRET_NAME);
    console.error('would leave that calendar showing the wrong account forever,');
    console.error('with nothing to indicate why.');
    console.error('');
    console.error('Sign out of the wrong account, or re-run and pick the right one');
    console.error('at the chooser.');
    console.error('===========================================================\n');
    process.exit(1);
  }
  const pad = SECRET_NAME.length > 20 ? SECRET_NAME.length : 20;
  // BOTH destinations, named. Saying only "GitHub secrets" is what caused a
  // whole afternoon of confusion on 2026-09-05: the calendar sync reads these
  // from GitHub Actions, but the Meetings tab calls /api/meet, which runs on
  // Vercel and cannot see GitHub secrets at all. Same names, two stores, and
  // this heading only ever mentioned one of them.
  console.log('\n======  PUT THESE IN **BOTH** PLACES  ======');
  console.log('  1. GitHub → repo → Settings → Secrets → Actions   (the calendar sync)');
  console.log('  2. Vercel → project → Settings → Environment Variables   (the Meetings tab)');
  console.log('  Vercel needs a redeploy afterwards; env vars only apply to a new build.');
  console.log('===========================================================');
  console.log('GOOGLE_CLIENT_ID'.padEnd(pad), '=', GOOGLE_CLIENT_ID);
  console.log('GOOGLE_CLIENT_SECRET'.padEnd(pad), '=', GOOGLE_CLIENT_SECRET);
  console.log(SECRET_NAME.padEnd(pad), '=', tok.refresh_token);
  console.log(CAL_NAME.padEnd(pad), '= primary');
  console.log('=====================================================');
  console.log(`Account: ${WHICH}${actual ? ` — confirmed as ${actual}` : ''}`);
  if (!actual) {
    console.log('NOTE: could not confirm which account this token belongs to,');
    console.log(`      because Gmail was not granted. It SHOULD be ${EXPECT}.`);
  }
  console.log(`Scopes granted: ${granted.map(x => x.split('/').pop()).join(', ') || '(none reported)'}`);
  if (!granted.some(x => x.includes('gmail'))) {
    console.log('NOTE: Gmail was not granted, so the inbox strip will stay empty.');
    console.log('      Calendar still works. Re-run and tick the mail box to add it.');
  }
  console.log('');
} catch (e) {
  console.error('\nExchange failed:', e.message);
  if (/invalid_grant/.test(e.message)) {
    console.error('\ninvalid_grant means Google rejected the code itself. Usually one of:');
    console.error('  · the code was already used — they are single-use, so start again');
    console.error('  · more than a few minutes passed between approving and exchanging');
    console.error('  · something other than the code reached this script');
    console.error('Re-run the command and approve in the browser without typing here.');
  }
  if (/access_denied/.test(e.message)) {
    console.error('\naccess_denied means this Google account is not on the test-user list');
    console.error('for the app, or you declined. Add it under Google Auth Platform →');
    console.error('Audience → Test users, and confirm it appears in the SAVED table.');
  }
  process.exit(1);
}
process.exit(0);
