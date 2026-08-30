// Pins the streaming reader.
//
// The failure this guards against is invisible on a fast connection: a reader
// hands you BYTES, not messages, so one JSON line routinely arrives split across
// two reads. Code that splits each chunk on newlines and parses the pieces works
// perfectly at a desk and drops tokens on mobile data.

import { createSSEParser } from '../src/lib/sse.js';
import { stripActionsLive, stripActions } from '../src/lib/actions.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log('FAIL ' + n); } };
const is = (a, b, n) => ok(Object.is(a, b), `${n} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
const collect = () => { const got = []; return [got, createSSEParser(e => got.push(e))]; };

// ------------------------------------------------------------ the torn line
let [got, p] = collect();
p.push('data: {"t":"Hel');
p.push('lo"}\ndata: {"t":" there"}\n');
is(got.length, 2, 'a line split across two chunks still produces one event');
is(got[0].t, 'Hello', 'and its content is whole');
is(got[1].t, ' there', 'the following event is unaffected');

// One byte at a time — the pathological case.
[got, p] = collect();
for (const ch of 'data: {"t":"abc"}\n') p.push(ch);
is(got.length, 1, 'character-by-character delivery still yields one event');
is(got[0].t, 'abc', 'with the right payload');

// ------------------------------------------------------------ noise
[got, p] = collect();
p.push(': keepalive comment\n\n\ndata: [DONE]\nevent: ping\nid: 7\ndata: {"done":true}\n');
is(got.length, 1, 'comments, blank lines, [DONE], event: and id: are all ignored');
ok(got[0].done, 'and the real event survives them');

[got, p] = collect();
p.push('data: not json\ndata: {"t":"ok"}\n');
is(got.length, 1, 'an unparseable line is skipped, never thrown');
is(got[0].t, 'ok', 'and does not poison the next one');

// ------------------------------------------------------------ the tail
[got, p] = collect();
p.push('data: {"t":"no trailing newline"}');
is(got.length, 0, 'an unterminated line is held back, not guessed at');
p.flush();
is(got.length, 1, 'flush releases it when the stream ends');
[got, p] = collect();
p.push('data: {"t":"half');
p.flush();
is(got.length, 0, 'but half a line is still not an event');

// ------------------------------------------------------------ live stripping
// While streaming, the closing fence has not been written yet, so the action
// block would type itself out on screen and then vanish.
is(stripActionsLive('Adding it.\n\n```action\n{"do":"add_'), 'Adding it.',
  'a half-written action block never reaches the screen');
is(stripActionsLive('Adding it.\n\n```action\n{"do":"add_todo","title":"x"}\n```'), 'Adding it.',
  'nor does a complete one');
is(stripActionsLive('Just prose'), 'Just prose', 'ordinary text is untouched');
is(stripActionsLive('Answer.\n\n``'), 'Answer.', 'a dangling half-fence is trimmed');
is(stripActions('Adding it.\n\n```action\n{"do":"add_todo","title":"x"}\n```'), 'Adding it.',
  'and the final strip agrees with the live one');


// ------------------------------------------------------- provider translation
// Where a silent failure would live: mistake a field name and the stream still
// "works" — it just never emits a character, and the user sees an empty reply
// with no error anywhere.
const { anthropicStep, nvidiaStep, pumpSSE } = await import('../api/chat.js');

is(anthropicStep({ type: 'content_block_delta', delta: { text: 'hi' } }).text, 'hi', 'anthropic text delta');
is(anthropicStep({ type: 'message_start', message: { usage: { input_tokens: 12 } } }).inTokens, 12, 'anthropic input usage');
is(anthropicStep({ type: 'message_delta', usage: { output_tokens: 7 } }).outTokens, 7, 'anthropic output usage');
is(anthropicStep({ type: 'error', error: { message: 'overloaded' } }).error, 'overloaded', 'anthropic mid-stream error is surfaced');
is(anthropicStep({ type: 'ping' }).text, undefined, 'unknown anthropic events are ignored');
is(anthropicStep(null).text, undefined, 'and so is junk');

is(nvidiaStep({ choices: [{ delta: { content: 'yo' } }] }).text, 'yo', 'nvidia text delta');
is(nvidiaStep({ choices: [{ delta: {} }] }).text, undefined, 'an empty nvidia delta emits nothing');
is(nvidiaStep({ usage: { prompt_tokens: 3, completion_tokens: 4 } }).outTokens, 4, 'nvidia usage arrives in its own chunk');
is(nvidiaStep({ choices: [] }).text, undefined, 'no choices is not a crash');

// pumpSSE against a real ReadableStream, chunked mid-line on purpose.
const enc = new TextEncoder();
const body = new ReadableStream({
  start(c) {
    c.enqueue(enc.encode('data: {"type":"content_block_delta","delta":{"text":"Hel'));
    c.enqueue(enc.encode('lo"}}\ndata: [DONE]\n'));
    c.close();
  },
});
const seen = [];
await pumpSSE(body, ev => seen.push(ev));
is(seen.length, 1, 'pumpSSE reassembles a line torn across chunks');
is(anthropicStep(seen[0]).text, 'Hello', 'and the text survives the tear');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
