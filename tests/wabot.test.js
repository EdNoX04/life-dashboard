// The WhatsApp bot's decisions.
//
// This is the first thing in the project reachable by anyone who knows a phone
// number, and it is wired to a dashboard holding his money, his health and his
// calendar. So the tests are weighted accordingly: the allowlist, the
// signature and the retry behaviour come first, and the features come after.
//
// The property that matters most is that an unknown sender gets SILENCE. Not
// an error, not "unauthorised" — any reply at all confirms the number is live
// and that something is listening.

import { createHmac } from 'node:crypto';
import {
  verifyChallenge, safeEqual, verifySignature, inboundMessages, isStatusOnly,
  normNumber, allowed, seenBefore, remember, SEEN_MAX, route, gate,
  chunk, outboundPayload, windowOpen, WINDOW_H, MAX_BODY, HELP_TEXT,
  isYes, isNo, resolveConfirm, confirmPrompt, CONFIRM_TTL_MIN,
} from '../src/lib/wabot.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log('FAIL ' + n); } };
const eq = (a, b, n) => ok(Object.is(a, b), `${n} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const hmacHex = (secret, body) => createHmac('sha256', secret).update(body).digest('hex');
const MINE = '919876543210';
const msg = (over = {}) => ({ id: 'wamid.1', from: MINE, type: 'text', text: 'add a task', unsupported: false, ...over });

const payload = (messages, extra = {}) => ({
  entry: [{ changes: [{ value: { contacts: [{ wa_id: MINE, profile: { name: 'Neel' } }], messages, ...extra } }] }],
});

// =========================================================================
// 1. WHO MAY TALK TO IT
// =========================================================================
{
  eq(allowed(MINE, [MINE]).ok, true, 'his number is allowed');
  eq(allowed('+91 98765 43210', [MINE]).ok, true, 'however it is formatted — spaces and a country prefix are not a different number');
  eq(allowed(MINE, `${MINE},919999999999`).ok, true, 'a comma-separated env var works too');

  const stranger = allowed('447700900000', [MINE]);
  eq(stranger.ok, false, 'anyone else is refused');
  eq(stranger.reply, false,
     'AND GETS NO REPLY AT ALL — not an error, not "unauthorised". Any answer confirms the number is live and that something is listening');

  const misconfigured = allowed(MINE, []);
  eq(misconfigured.ok, false,
     'an EMPTY allowlist refuses everyone, including him — a missing env var must never turn this into a public assistant wired to his life');
  eq(misconfigured.reply, false, 'silently');
  eq(allowed(MINE, null).ok, false, 'and no allowlist at all is the same closed door');
  eq(normNumber('+91 (987) 654-3210'), '919876543210', 'numbers normalise to digits');
}

// =========================================================================
// 2. IS IT REALLY FROM META
// =========================================================================
{
  const body = JSON.stringify(payload([{ id: 'wamid.1', from: MINE, type: 'text', text: { body: 'hi' } }]));
  const good = `sha256=${hmacHex('s3cret', body)}`;

  eq(verifySignature(body, good, 's3cret', hmacHex).ok, true, 'a correctly signed body passes');
  eq(verifySignature(body, good, 'wrong', hmacHex).ok, false, 'the wrong secret does not');
  eq(verifySignature(`${body} `, good, 's3cret', hmacHex).ok, false,
     'and neither does a body that differs by ONE SPACE — which is why the RAW body is verified, never a re-serialised parse');
  eq(verifySignature(body, 'sha1=abc', 's3cret', hmacHex).reason, 'missing or malformed signature header', 'a wrong algorithm prefix is rejected');
  eq(verifySignature(body, '', 's3cret', hmacHex).ok, false, 'so is a missing header');
  eq(verifySignature(body, good, '', hmacHex).ok, false, 'an unconfigured secret refuses rather than skipping the check');
  eq(verifySignature(body, good, 's3cret', null).ok, false, 'and so does a missing hmac implementation — never a silent pass');

  ok(safeEqual('abc', 'abc'), 'equal strings are equal');
  ok(!safeEqual('abc', 'abd'), 'unequal ones are not');
  ok(!safeEqual('abc', 'abcd'), 'nor are different lengths');
}

// ------------------------------------------------------------- the handshake
{
  eq(verifyChallenge({ 'hub.mode': 'subscribe', 'hub.verify_token': 'tok', 'hub.challenge': '12345' }, 'tok').challenge, '12345',
     'the one-time handshake echoes the challenge');
  const bad = verifyChallenge({ 'hub.mode': 'subscribe', 'hub.verify_token': 'guess', 'hub.challenge': '12345' }, 'tok');
  eq(bad.ok, false, 'a wrong token fails');
  eq(bad.challenge, undefined,
     'and the challenge is NOT echoed — doing so would hand anyone who guesses the URL a working handshake');
  eq(verifyChallenge({ 'hub.mode': 'subscribe' }, '').ok, false, 'with no token configured, nothing verifies');
}

// =========================================================================
// 3. META RETRIES
// =========================================================================
{
  const seen = remember('wamid.1', []);
  ok(seenBefore('wamid.1', seen), 'a handled message is remembered');
  ok(!seenBefore('wamid.2', seen), 'a new one is not');
  eq(remember('wamid.1', seen).length, 1, 'remembering it twice does not grow the list');

  const g = gate({ message: msg(), allowlist: [MINE], seen });
  eq(g.act, false, 'a RETRY of the same message does nothing');
  eq(g.reply, false, 'and says nothing — he already got the answer');
  ok(/retried/.test(g.reason), 'naming why');

  let big = [];
  for (let i = 0; i < SEEN_MAX + 50; i++) big = remember(`m${i}`, big);
  eq(big.length, SEEN_MAX, 'the list is capped — it lives in a memory blob and an unbounded one grows forever');
  ok(seenBefore(`m${SEEN_MAX + 49}`, big), 'keeping the most recent');
}

// =========================================================================
// 4. WHAT ARRIVED
// =========================================================================
{
  const m = inboundMessages(payload([{ id: 'wamid.9', from: MINE, type: 'text', text: { body: 'what is next' }, timestamp: '1789000000' }]));
  eq(m.length, 1, 'a text message is read');
  eq(m[0].text, 'what is next', 'with its body');
  eq(m[0].name, 'Neel', 'and the sender name from contacts');
  eq(m[0].at, 1789000000000, 'and a timestamp in milliseconds');

  // Delivery receipts arrive on the SAME webhook.
  const statuses = { entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.9', status: 'delivered' }] } }] }] };
  eq(inboundMessages(statuses).length, 0,
     'a delivery receipt is NOT a message — a bot that answers its own receipt talks to itself forever');
  eq(isStatusOnly(statuses), true, 'and is recognisable as such so the webhook can return early');
  eq(isStatusOnly(payload([{ id: 'a', from: MINE, type: 'text', text: { body: 'x' } }])), false, 'a real message is not status-only');

  const img = inboundMessages(payload([{ id: 'wamid.i', from: MINE, type: 'image', image: { id: 'x' } }]));
  eq(img[0].unsupported, true, 'an image is carried through and marked unsupported');
  eq(img[0].text, '', 'with no text');

  eq(inboundMessages(null).length, 0, 'rubbish in is nothing out');
  eq(inboundMessages({ entry: [{}] }).length, 0, 'as is a half-empty envelope');
  eq(inboundMessages(payload([{ from: MINE, type: 'text', text: { body: 'no id' } }])).length, 0,
     'and a message with no id is dropped — without one it cannot be deduped, and acting twice is worse than not acting');
}

// =========================================================================
// 5. THE GATE, IN ORDER
// =========================================================================
{
  const clean = gate({ message: msg(), allowlist: [MINE], seen: [] });
  eq(clean.act, true, 'his new text message is acted on');
  eq(clean.route.lane, 'fast', 'down the fast lane');

  eq(gate({ message: msg({ from: '447700900000' }), allowlist: [MINE], seen: ['wamid.1'] }).reply, false,
     'a stranger is refused BEFORE the dedupe — an unknown sender should not even occupy a slot in the seen list');

  const img = gate({ message: msg({ unsupported: true, type: 'image', text: '' }), allowlist: [MINE], seen: [] });
  eq(img.act, false, 'an image is not acted on');
  eq(img.reply, true, 'but HE gets an answer — he is allowed, and silence here would read as the bot being broken rather than as a limit');
  ok(/only read text/.test(img.text), 'saying what it can do instead');
}

// =========================================================================
// 6. WHICH LANE
// =========================================================================
{
  eq(route('add a task to call the bank').lane, 'fast', 'a task goes down the fast lane');
  eq(route('what is my next class').lane, 'fast', 'so does a question');
  eq(route('build me a tracker for my reading').lane, 'queued', 'a build is QUEUED — it takes minutes to hours, and a chat reply has seconds');
  eq(route('build me a tracker').kind, 'build', 'tagged as a build');
  eq(route('help').lane, 'help', 'help is its own lane');
  eq(route('?').lane, 'help', 'however it is asked');
  eq(route('').lane, 'ignore', 'and an empty message is ignored rather than sent to a model');

  ok(/only answers you/.test(HELP_TEXT),
     'the help text describes a personal dashboard remote, not a general assistant — Meta bans general-purpose AI assistants on the platform and the framing is the compliance');
  ok(!/anything|any question|ask me anything/i.test(HELP_TEXT), 'so it never claims to answer anything');
}

// =========================================================================
// 7. GETTING AN ANSWER BACK OUT
// =========================================================================
{
  eq(chunk('short').length, 1, 'a short answer is one message');
  eq(chunk('').length, 0, 'an empty one is none');
  const long = `${'a'.repeat(3000)}\n\n${'b'.repeat(3000)}`;
  const parts = chunk(long);
  eq(parts.length, 2, 'a long answer is split');
  ok(parts.every(p => p.length <= MAX_BODY), `each part within WhatsApp's ${MAX_BODY} limit`);
  ok(parts[0].endsWith('a'), 'and split at the paragraph break rather than mid-word — a badly split answer reads as an answer that went wrong');

  const noBreaks = chunk('x'.repeat(9000));
  ok(noBreaks.every(p => p.length <= MAX_BODY), 'text with nowhere good to split is still split safely');
  eq(noBreaks.join('').length, 9000, 'losing nothing');

  const p = outboundPayload('+91 98765 43210', 'hi');
  eq(p.to, MINE, 'the outbound number is normalised');
  eq(p.text.preview_url, false, 'link previews are off — a preview expands a URL he did not ask to see');
  eq(outboundPayload(MINE, 'x'.repeat(9000)).text.body.length, MAX_BODY, 'and an over-long body is truncated rather than rejected by Meta');
}

// =========================================================================
// 8. THE 24-HOUR WINDOW — the thing that breaks the proactive half
// =========================================================================
{
  const now = Date.parse('2026-09-13T12:00:00Z');
  eq(windowOpen(now - 3600000, now).open, true, 'an hour after his message, the bot may reply freely');
  eq(Math.round(windowOpen(now - 3600000, now).leftH), 23, 'with the time left stated');

  const shut = windowOpen(now - 30 * 3600000, now);
  eq(shut.open, false, `past ${WINDOW_H} hours it is shut`);
  ok(/approved template/.test(shut.why),
     'and says what would actually get through — a build that finishes three hours later may find the window closed, and knowing that in advance beats discovering it as a failed send');

  eq(windowOpen(null, now).open, false, 'with no prior message there is no window');
  eq(windowOpen('never', now).open, false, 'and an unparseable time is closed, not open');
}

// =========================================================================
// 9. CONSENT, WITHOUT A CONFIRMATION CARD
// =========================================================================
{
  const now = Date.parse('2026-09-13T12:00:00Z');
  const held = { action: { do: 'cancel_event', title: 'Standup' }, at: now - 60000 };

  eq(resolveConfirm(held, 'yes', now).state, 'confirmed', 'a plain yes confirms');
  eq(resolveConfirm(held, 'Yeah', now).state, 'confirmed', 'so do the obvious variants');
  eq(resolveConfirm(held, 'no', now).state, 'declined', 'and no declines');
  ok(isYes('ok') && isYes('do it') && !isYes('ok so what about tuesday'), 'a yes is a WHOLE message, not a word inside one');
  ok(isNo("don't"), 'and a refusal is read generously');

  const moved = resolveConfirm(held, 'actually add milk to the list', now);
  eq(moved.state, 'moved-on',
     'anything that is not a clear yes or no DROPS the hold — reading "add milk" as consent to cancel a meeting would be the worst possible reading');

  const stale = resolveConfirm(held, 'yes', now + (CONFIRM_TTL_MIN + 1) * 60000);
  eq(stale.state, 'expired', `a yes typed more than ${CONFIRM_TTL_MIN} minutes later is not consent — he has forgotten the question`);
  ok(/have not done it/.test(stale.text), 'and it says plainly that nothing happened');
  eq(resolveConfirm(null, 'yes', now).state, 'none', 'with nothing held, "yes" is just a word');

  // The question has to name the CONSEQUENCE, or "yes" is not informed.
  ok(/for everyone on it/.test(confirmPrompt({ do: 'cancel_event', title: 'Standup' })),
     'cancelling an event says it comes off other people\u2019s calendars');
  ok(/destroys the task rather than completing/.test(confirmPrompt({ do: 'delete_todo', title: 'x' })),
     'and deleting a task says it is not the same as finishing it');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
