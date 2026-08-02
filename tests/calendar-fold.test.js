// tests/calendar-fold.test.js — the three pure helpers behind the multi-account
// meetings worker.
//
// What is load-bearing here, in order of how much it would cost to get wrong:
//
//   1. foldDuplicates() must never merge two genuinely different meetings. It is
//      the only function in the repo whose failure mode is *removing* something
//      from the calendar, and a removed meeting does not look like a bug — it
//      looks like a free slot. Every "should NOT fold" assertion below is worth
//      more than every "should fold" one.
//   2. splitEventId() must not truncate an id that legitimately contains a colon.
//      Google's own ids never do, but ids from subscribed .ics feeds are opaque
//      strings and some do — and a truncated id deletes nothing, or worse, the
//      wrong thing.
//   3. parseFrom() must not blank out a sender. A blank From reads as a broken
//      renderer and destroys trust in the whole strip.
//
// Run: bun tests/calendar-fold.test.js

import { parseFrom, foldDuplicates, splitEventId } from '../scripts/lib/calendar-fold.mjs';

let pass = 0, fail = 0;
function ok(name, cond, got) {
  if (cond) { pass++; }
  else { fail++; console.log(`FAIL ${name}${got !== undefined ? `  — got ${got}` : ''}`); }
}

// ---------------------------------------------------------------- parseFrom
{
  const t = (h, name, email, why) => {
    const r = parseFrom(h);
    ok(why, r.name === name && r.email === email, `{name:${JSON.stringify(r.name)}, email:${JSON.stringify(r.email)}}`);
  };

  t('Neel Mukherjee <neel@company.com>', 'Neel Mukherjee', 'neel@company.com',
    'the ordinary case: display name and address');
  t('neel@company.com', 'neel', 'neel@company.com',
    'a bare address falls back to the local part rather than a blank name');
  t('<neel@company.com>', 'neel', 'neel@company.com',
    'angle brackets with no name still yield a name');
  t('"Mukherjee, Neel" <neel@company.com>', 'Mukherjee, Neel', 'neel@company.com',
    'a quoted name containing a comma survives intact');
  t('"Neel \\"Ed\\" Mukherjee" <neel@company.com>', 'Neel "Ed" Mukherjee', 'neel@company.com',
    'escaped quotes inside a quoted name are unescaped');
  t('neel@company.com <neel@company.com>', 'neel', 'neel@company.com',
    'a name that merely repeats the address is not shown twice');
  t('  Neel   <neel@company.com>  ', 'Neel', 'neel@company.com',
    'surrounding whitespace is trimmed on both parts');
  t('', '', '', 'an empty header yields empty strings, not a crash');
  t(null, '', '', 'a null header yields empty strings, not the string "null"');
  t(undefined, '', '', 'an undefined header yields empty strings');
  t('GitHub <notifications@github.com>', 'GitHub', 'notifications@github.com',
    'the sender this repo actually gets most of its mail from');

  // The address is taken from the LAST angle-bracket pair. A display name that
  // itself contains something bracket-shaped is rare but real (auto-generated
  // "no-reply <x> team <no-reply@y.com>" style headers), and taking the first
  // pair would put a non-address into the email field.
  const weird = parseFrom('Alerts <old> <alerts@company.com>');
  ok('the address comes from the last bracket pair, not the first',
    weird.email === 'alerts@company.com', weird.email);
}

// ----------------------------------------------------------- foldDuplicates
{
  const ev = (o) => ({ start: '2026-08-03T10:00:00+05:30', summary: 'Standup', accountLabel: 'Personal', ...o });

  // --- the cases that SHOULD fold ---
  {
    const out = foldDuplicates([
      ev({ id: 'personal:a', accountLabel: 'Personal' }),
      ev({ id: 'work:b', accountLabel: 'Work' }),
    ]);
    ok('the same meeting on two accounts becomes one row', out.length === 1, out.length);
    ok('the survivor is the first in input order', out[0]?.id === 'personal:a', out[0]?.id);
    ok('the folded account is recorded in alsoOn, not silently dropped',
      JSON.stringify(out[0]?.alsoOn) === '["Work"]', JSON.stringify(out[0]?.alsoOn));
  }
  {
    const out = foldDuplicates([
      ev({ id: 'p', accountLabel: 'Personal', summary: '  Standup  ' }),
      ev({ id: 'w', accountLabel: 'Work', summary: 'STANDUP' }),
    ]);
    ok('title matching ignores case and surrounding whitespace', out.length === 1, out.length);
  }
  {
    const out = foldDuplicates([
      ev({ id: 'p', accountLabel: 'Personal', meet: '' }),
      ev({ id: 'w', accountLabel: 'Work', meet: 'https://meet.google.com/abc-defg-hij' }),
    ]);
    ok('a joinable link is inherited from the copy that has one',
      out[0]?.meet === 'https://meet.google.com/abc-defg-hij', out[0]?.meet);
  }
  {
    const out = foldDuplicates([
      ev({ id: 'p', accountLabel: 'Personal', meet: 'https://meet.google.com/keep-this' }),
      ev({ id: 'w', accountLabel: 'Work', meet: 'https://meet.google.com/not-this' }),
    ]);
    ok('an existing link is never overwritten by the duplicate\'s',
      out[0]?.meet === 'https://meet.google.com/keep-this', out[0]?.meet);
  }
  {
    const out = foldDuplicates([
      ev({ id: 'a', accountLabel: 'Personal' }),
      ev({ id: 'b', accountLabel: 'Work' }),
      ev({ id: 'c', accountLabel: 'Work' }),
    ]);
    ok('a label already in alsoOn is not repeated',
      JSON.stringify(out[0]?.alsoOn) === '["Work"]', JSON.stringify(out[0]?.alsoOn));
  }
  {
    // Two copies from the SAME account is a pull bug, not a cross-account fold.
    // It should still collapse, but must not claim the meeting was on two places.
    const out = foldDuplicates([
      ev({ id: 'a', accountLabel: 'Personal' }),
      ev({ id: 'a2', accountLabel: 'Personal' }),
    ]);
    ok('a same-account repeat collapses without inventing a second account',
      out.length === 1 && out[0].alsoOn.length === 0, `${out.length}/${JSON.stringify(out[0]?.alsoOn)}`);
  }

  // --- the cases that MUST NOT fold. These are the expensive ones. ---
  {
    const out = foldDuplicates([
      ev({ id: 'a', start: '2026-08-03T10:00:00+05:30' }),
      ev({ id: 'b', start: '2026-08-10T10:00:00+05:30', accountLabel: 'Work' }),
    ]);
    ok('the same title a week apart is two meetings, not one — a weekly 1:1 is not a duplicate',
      out.length === 2, out.length);
  }
  {
    const out = foldDuplicates([
      ev({ id: 'a', start: '2026-08-03T10:00:00+05:30' }),
      ev({ id: 'b', start: '2026-08-03T10:30:00+05:30', accountLabel: 'Work' }),
    ]);
    ok('same title, thirty minutes apart, stays two meetings', out.length === 2, out.length);
  }
  {
    const out = foldDuplicates([
      ev({ id: 'a', summary: 'Design review' }),
      ev({ id: 'b', summary: 'Design review (part 2)', accountLabel: 'Work' }),
    ]);
    ok('a different title at the same time stays two meetings', out.length === 2, out.length);
  }
  {
    // Back-to-back different meetings — the single most common real calendar
    // shape, and the one a sloppier key (say, date-only) would destroy.
    const out = foldDuplicates([
      ev({ id: 'a', start: '2026-08-03T09:00:00+05:30', summary: 'Standup' }),
      ev({ id: 'b', start: '2026-08-03T10:00:00+05:30', summary: 'Client call' }),
      ev({ id: 'c', start: '2026-08-03T11:00:00+05:30', summary: '1:1' }),
    ]);
    ok('a normal three-meeting morning survives untouched', out.length === 3, out.length);
  }
  {
    // Two untitled events at different times. Both fold to a '' title, so this is
    // where a start-insensitive key would quietly eat one.
    const out = foldDuplicates([
      ev({ id: 'a', summary: '', start: '2026-08-03T09:00:00+05:30' }),
      ev({ id: 'b', summary: '', start: '2026-08-03T15:00:00+05:30' }),
    ]);
    ok('two untitled events at different times both survive', out.length === 2, out.length);
  }

  // --- shape and ordering ---
  {
    const out = foldDuplicates([
      ev({ id: 'late', start: '2026-08-05T09:00:00+05:30', summary: 'C' }),
      ev({ id: 'early', start: '2026-08-01T09:00:00+05:30', summary: 'A' }),
      ev({ id: 'mid', start: '2026-08-03T09:00:00+05:30', summary: 'B' }),
    ]);
    ok('output is sorted by start time regardless of input order',
      out.map(e => e.id).join(',') === 'early,mid,late', out.map(e => e.id).join(','));
  }
  {
    ok('an empty list yields an empty list', foldDuplicates([]).length === 0);
    ok('a non-array yields an empty list', foldDuplicates(null).length === 0);
    ok('an undefined input yields an empty list', foldDuplicates(undefined).length === 0);
  }
  {
    // An event with no start cannot be placed on a calendar at all, and letting
    // one through would sort as `undefined` and land at an arbitrary position.
    const out = foldDuplicates([ev({ id: 'a' }), { id: 'nostart', summary: 'X' }, null]);
    ok('events with no start, and null entries, are discarded',
      out.length === 1 && out[0].id === 'a', out.map(e => e?.id).join(','));
  }
  {
    // The caller must be able to re-pull without the previous run's alsoOn
    // accumulating, and must not have its input mutated underneath it.
    const input = [ev({ id: 'a', accountLabel: 'Personal' }), ev({ id: 'b', accountLabel: 'Work' })];
    foldDuplicates(input);
    ok('the input array is not mutated — no alsoOn is written back onto it',
      input[0].alsoOn === undefined, JSON.stringify(input[0].alsoOn));
  }
  {
    // Every surviving row must carry alsoOn, even when nothing folded, so the UI
    // can render `e.alsoOn.length` without a guard on every single row.
    const out = foldDuplicates([ev({ id: 'solo' })]);
    ok('a row that folded nothing still has an empty alsoOn array',
      Array.isArray(out[0].alsoOn) && out[0].alsoOn.length === 0, JSON.stringify(out[0].alsoOn));
  }
  {
    // Fields other than the folded ones must survive the spread untouched.
    const out = foldDuplicates([ev({ id: 'a', location: 'Room 4', response: 'accepted', color: 'var(--cyan)' })]);
    ok('unrelated fields pass through the fold unchanged',
      out[0].location === 'Room 4' && out[0].response === 'accepted' && out[0].color === 'var(--cyan)');
  }
}

// ----------------------------------------------------------- splitEventId
{
  const KNOWN = ['personal', 'work'];
  const t = (input, account, id, why) => {
    const r = splitEventId(input, KNOWN);
    ok(why, r.account === account && r.id === id, JSON.stringify(r));
  };

  t('work:abc123', 'work', 'abc123', 'a known prefix is stripped and reported');
  t('personal:abc123', 'personal', 'abc123', 'the other known prefix works too');
  t('abc123', null, 'abc123', 'a bare id passes through untouched');

  // The dangerous ones.
  t('unknown:abc123', null, 'unknown:abc123',
    'an UNKNOWN prefix is left alone — it is part of the id, not a routing hint');
  t('work:abc:def', 'work', 'abc:def',
    'only the first colon is a separator; the rest of the id keeps its colons');
  t('abc:def', null, 'abc:def',
    'a bare id containing a colon is not truncated (subscribed .ics feeds emit these)');
  t('work:', null, 'work:',
    'a prefix with nothing after it is not a routed id — better to fail loudly at Google');
  t(':abc123', null, ':abc123',
    'a leading colon is not an empty account name');

  t('', null, '', 'an empty id yields an empty id');
  t(null, null, '', 'a null id does not become the string "null"');
  t(undefined, null, '', 'an undefined id does not become the string "undefined"');

  ok('with no known accounts, nothing is ever stripped',
    splitEventId('work:abc', []).id === 'work:abc');
  ok('the known-accounts argument defaults to empty rather than throwing',
    splitEventId('work:abc').id === 'work:abc');
}

console.log(`${pass}/${pass + fail} passing`);
if (fail) process.exit(1);
