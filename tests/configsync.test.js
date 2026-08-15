// Guards the cross-device config sync.
//
// The bug this exists to prevent: a key added to the Settings page but not to
// SYNC_KEYS is saved on the device you typed it on and nowhere else. That looks
// exactly like the sync being broken, and it is invisible until you pick up a
// second device — which is how `fmpKey` went missing on the iPad.
//
// So rather than pin the list's contents, this reads the Settings page and
// asserts that every field it writes is accounted for: either synced, or on an
// explicit per-device list with a reason. Adding a field and forgetting both
// fails the suite.

import { readFileSync } from 'fs';

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; } else { fail++; console.log('FAIL ' + name); } };
const eq = (a, b, name) => ok(a === b, `${name} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const dbSrc = readFileSync(new URL('../src/lib/db.js', import.meta.url), 'utf8');
const setSrc = readFileSync(new URL('../src/tabs/Settings.jsx', import.meta.url), 'utf8');

// Pull SYNC_KEYS out of the source rather than importing db.js — importing it
// drags in localStorage, which does not exist here.
const block = dbSrc.match(/const SYNC_KEYS = \[([\s\S]*?)\];/);
ok(!!block, 'SYNC_KEYS is declared in db.js');
const synced = [...block[1].matchAll(/'([^']+)'/g)].map(m => m[1]);

ok(synced.length >= 5, 'the sync list is not empty');

// The AI keys used to be here. They are gone because api/chat.js holds them on
// the server now, and a paid key in a browser is a paid key that leaks with the
// browser. Asserted rather than assumed: re-adding one to Settings and wiring it
// back into the sync list is a two-line change that would silently undo the whole
// reason /api/chat exists.
for (const k of ['claudeKey', 'openaiKey', 'geminiKey', 'anthropicKey', 'nvidiaKey']) {
  ok(!synced.includes(k), `${k} must never sync — AI keys live in Vercel env, not the browser`);
}
ok(!/sk-ant-|nvapi-/.test(setSrc), 'Settings offers no AI key field to type into');
ok(synced.includes('fmpKey'), 'the dividend key syncs — this is the one that went missing');
ok(synced.includes('finnhubKey'), 'the price key syncs');
ok(synced.includes('twelveKey'), 'the chart key syncs');
ok(synced.includes('tmdbKey'), 'the media key syncs');

// Deliberately NOT synced, each for a stated reason.
//   supabaseUrl/supabaseKey are how a device reaches the table this sync uses;
//   routing them through it is circular.
//   Anything with write authority stays out entirely — the Binance pair lives
//   in GitHub Secrets and never reaches the browser or the database.
const PER_DEVICE = ['supabaseUrl', 'supabaseKey', 'theme', 'themeName'];
for (const k of PER_DEVICE) {
  ok(!synced.includes(k), `${k} is per-device and must not sync`);
}
// The rule that matters most, stated as a test so it cannot quietly lapse.
ok(!synced.some(k => /binance/i.test(k)), 'no Binance credential is ever synced through the database');
ok(!dbSrc.includes('binanceSecret') && !setSrc.includes('binanceSecret'),
  'no Binance secret field exists in the browser at all');

// Every field the Settings page writes must be either synced or per-device.
const written = [...new Set([...setSrc.matchAll(/upd\('([A-Za-z0-9_]+)'\)/g)].map(m => m[1]))];
ok(written.length > 3, 'the Settings page writes several config fields');
for (const k of written) {
  ok(
    synced.includes(k) || PER_DEVICE.includes(k),
    `${k} is written by Settings and is neither synced nor listed as per-device`,
  );
}

// Clearing must propagate. A cleared key pushed as ABSENT comes straight back
// from another device, which is indistinguishable from the delete not working.
ok(/payload\[k\] = c\[k\] \|\| ''/.test(dbSrc),
  'cleared keys are pushed as empty strings rather than omitted');
ok(/if \(!\(k in remote\)\) continue/.test(dbSrc),
  'a key absent from the shared record leaves the local value alone');
// And the pull must not treat an empty remote as "no change" — that would make
// a clear un-clearable.
ok(!/if \(remote\[k\] &&/.test(dbSrc),
  'the pull no longer requires a truthy remote value, which would ignore a clear');

// Both directions have to actually be called, or the list is decoration.
eq(/syncPushConfig\(\)/.test(setSrc), true, 'Settings pushes on save');
const appSrc = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
eq(/syncPullConfig\(\)/.test(appSrc), true, 'the app pulls on boot');

console.log(`${pass}/${pass + fail} passing`);
if (fail) process.exit(1);
