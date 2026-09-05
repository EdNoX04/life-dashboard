// The notification system.
//
// The failure this whole module is a reaction to: the pomodoro chime shipped,
// worked, and did nothing for a month, because the switch that turned it on was
// at the bottom of one card in one tab and was never pressed. The second failure
// waiting behind it is the opposite — a system that interrupts you about six
// things at once, which you switch off wholesale, taking the one that mattered
// with it.
//
// So what is tested here is restraint as much as correctness: nothing fires
// twice, nothing fires for a class that already started, the noisy channels
// default to off, and the money wording never drifts into telling him what to do
// with his own money.

import {
  CHANNELS, CHANNEL_IDS, defaults, normalize, enabledFor,
  seenKey, hasSeen, markSeen, prune, dayStamp,
  classSoon, todosDue, bigMoves, sipTrouble, examSoon,
  MIN_MOVE, MAX_MOVE, DEFAULT_MOVE, EXAM_MILESTONES,
} from '../src/lib/notify.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log('FAIL ' + n); } };
const eq = (a, b, n) => ok(Object.is(a, b), `${n} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

// ---------------------------------------------------------------- channels
{
  ok(CHANNELS.length >= 5, 'there are several things worth being told about');
  ok(CHANNELS.every(c => c.id && c.label && c.note), 'each says what it is');
  // `needs` is the honest field: which tab has to be open for it to fire at all.
  // Without it the settings panel would imply a watcher that does not exist.
  ok(CHANNELS.every(c => c.needs), 'and each admits what it needs to be open');
  eq(new Set(CHANNEL_IDS).size, CHANNEL_IDS.length, 'ids are unique');

  const on = CHANNELS.filter(c => c.on).map(c => c.id);
  ok(on.includes('focus'), 'the focus timer is on by default — it is the one he asked for');
  ok(!on.includes('money'), 'market moves are OFF by default');
  ok(!on.includes('todo'), 'and so are task reminders');
  ok(on.length <= 3, 'at most three things interrupt out of the box — a dashboard that opens by interrupting you six times gets switched off wholesale');
  ok(on.includes('sip'), 'but a failed SIP is on, because it is the one that needs action');
}

// ---------------------------------------------------------------- prefs
{
  eq(normalize(null).movePct, DEFAULT_MOVE, 'nothing stored means the defaults');
  eq(normalize({ movePct: 999 }).movePct, MAX_MOVE, 'an absurd threshold clamps down');
  eq(normalize({ movePct: 0 }).movePct, MIN_MOVE, 'and zero clamps up — a 0% threshold would fire for everything');
  eq(normalize({ movePct: 'lots' }).movePct, DEFAULT_MOVE, 'nonsense falls back');
  eq(normalize({ enabled: { money: true } }).enabled.money, true, 'a stored choice is honoured');
  eq(normalize({ enabled: { money: true } }).enabled.focus, true, 'without disturbing the others');
  eq(normalize({ enabled: { nonsense: true } }).enabled.nonsense, undefined, 'an unknown channel is not invented');
  eq(normalize({ enabled: 'yes' }).enabled.focus, true, 'a corrupt prefs blob falls back rather than throwing');
  eq(enabledFor({ enabled: { focus: false } }, 'focus'), false, 'and off means off');
  eq(enabledFor(null, 'focus'), true, 'with no prefs at all, the defaults apply');
}

// ---------------------------------------------------------------- the ledger
{
  const now = Date.parse('2026-09-05T10:00:00+05:30');
  let seen = {};
  eq(hasSeen(seen, 'class', 'x'), false, 'nothing has been said yet');
  seen = markSeen(seen, 'class', 'x', now);
  eq(hasSeen(seen, 'class', 'x'), true, 'and then it has');
  eq(hasSeen(seen, 'todo', 'x'), false, 'channels do not share a ledger — the same key in two channels is two things');
  eq(seenKey('a', 'b'), 'a:b', 'the key is stable');

  // Unbounded, this grows for the life of the browser profile and is re-parsed
  // on every check.
  const old = { 'class:ancient': now - 10 * 86400000, 'class:today': now };
  const kept = prune(old, now);
  eq(Object.keys(kept).length, 1, 'entries older than three days are dropped');
  eq(kept['class:today'], now, 'and recent ones survive');
  eq(Object.keys(prune(null, now)).length, 0, 'pruning nothing is fine');

  // Local calendar, not toISOString — in IST that reports tomorrow after 18:30.
  eq(dayStamp(new Date(2026, 8, 5, 23, 30)), '2026-09-05', 'a late-evening stamp is still today');
}

// ---------------------------------------------------------------- class soon
{
  // Friday 5 Sept 2026, 09:22 local.
  const now = new Date(2026, 8, 4, 9, 22);
  // THE REAL SHAPE. The `timetable` table stores the day as a name and the time
  // as `start_time`. A numeric `dow` would have matched nothing and this whole
  // channel would have shipped silent — which is the exact way the pomodoro
  // popup failed, so it is worth a test rather than a glance.
  const day = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getDay()];
  const tt = [
    { day, start_time: '09:30', subject: 'Blockchain', room: 'LT-3' },
    { day, start_time: '09:15', subject: 'Already started' },
    { day, start_time: '11:00', subject: 'Later' },
    { day: 'Sunday' === day ? 'Monday' : 'Sunday', start_time: '09:30', subject: 'Tomorrow' },
  ];
  const hits = classSoon(tt, now, 10);
  eq(hits.length, 1, 'only the next class, not every class in the window');
  ok(/Blockchain/.test(hits[0].title), 'the right one');
  ok(/8 min/.test(hits[0].title), 'with how long you have');
  ok(/LT-3/.test(hits[0].body), 'and where to go');
  ok(!/Already started/.test(JSON.stringify(hits)), 'a class that began seven minutes ago is not news');
  ok(!/Tomorrow/.test(JSON.stringify(hits)), "and neither is tomorrow's");

  eq(classSoon(tt, new Date(2026, 8, 4, 8, 0), 10).length, 0, 'nothing fires an hour and a half early');
  eq(classSoon(null, now).length, 0, 'no timetable, no notification');
  eq(classSoon([{ day, subject: 'No time given' }], now).length, 0, 'a row with no start time is skipped, not crashed on');
  // The legacy numeric form still works, so a schema change does not break it.
  eq(classSoon([{ dow: now.getDay(), start: '09:30', subject: 'Numeric' }], now).length, 1,
     'a numeric day column is still understood');
  ok(hits[0].thing.includes(dayStamp(now)), 'the identity is day-stamped, so the same class fires again next week');
}

// ---------------------------------------------------------------- todos
{
  const now = new Date(2026, 8, 4, 9, 0);
  const today = dayStamp(now);
  const todos = [
    { title: 'IoT lab record', completed: false, due_date: today },
    { title: 'Old thing', completed: false, due_date: '2026-08-30' },
    { title: 'Done', completed: true, due_date: today },
    { title: 'Next week', completed: false, due_date: '2026-09-20' },
  ];
  const hits = todosDue(todos, now);
  eq(hits.length, 1, 'everything due arrives as ONE notification, not one per task');
  ok(/2 tasks/.test(hits[0].title), 'counting only what is open and due');
  ok(/overdue/.test(hits[0].body), 'and saying plainly that one is late');
  eq(hits[0].thing, today, 'identified by the day, so it can never fire twice in one');
  eq(todosDue([{ title: 'x', completed: false, due_date: today }], now)[0].title, 'x',
     'a single task is named rather than counted');
  eq(todosDue([], now).length, 0, 'nothing due, nothing said');
  eq(todosDue(null, now).length, 0, 'and no list at all is not a crash');
}

// ---------------------------------------------------------------- money
{
  const now = new Date(2026, 8, 4, 15, 0);
  const holdings = [
    { symbol: 'NVDA', day_change_pct: -7.2 },
    { symbol: 'QQQ', day_change_pct: 0.4 },
    { symbol: 'TSM', changePct: 6.1 },
    { symbol: 'GOLDBEES', day_change_pct: null },
  ];
  const hits = bigMoves(holdings, 5, now);
  eq(hits.length, 2, 'only the ones past the threshold');
  ok(/NVDA/.test(hits[0].title), 'biggest mover first');
  ok(/down 7\.2%/.test(hits[0].title), 'stated as what it did');
  ok(/TSM/.test(hits[1].title), 'and the other field name is understood too');
  ok(/up 6\.1%/.test(hits[1].title), 'with its direction');
  eq(bigMoves(holdings, 8, now).length, 0, 'a higher threshold says less');
  eq(bigMoves(null, 5, now).length, 0, 'no holdings, nothing said');
  ok(hits.every(h => h.thing.includes(dayStamp(now))), 'day-stamped, so one move is announced once');

  // THE STANDING RULE. Money is read-only and there is no advice in this app. A
  // notification is a particularly bad place to break that: it arrives without
  // context and is read in three seconds.
  const words = JSON.stringify(hits).toLowerCase();
  ok(!/\b(buy|sell|should|consider|opportunity|recommend|trim|add to)\b/.test(words),
     'the wording states a fact and never suggests an action');
  ok(/no action implied/.test(words), 'and says so out loud');
}

// ---------------------------------------------------------------- SIPs
{
  const now = new Date(2026, 8, 4);
  const sips = [
    { name: 'QQQ weekly', last_status: 'SUCCESS' },
    { name: 'Nifty 50', last_status: 'FAILED' },
  ];
  const hits = sipTrouble(sips, now);
  eq(hits.length, 1, 'a failed installment is worth saying');
  ok(/Nifty 50/.test(hits[0].title), 'named');
  ok(/INDmoney app/.test(hits[0].body), 'and it says where the fix has to happen — nothing here can retry it');
  eq(sipTrouble([{ name: 'fine', last_status: 'SUCCESS' }], now).length, 0, 'healthy SIPs are silent');
  eq(sipTrouble(null, now).length, 0, 'and no data is silent too');
}

// ---------------------------------------------------------------- exams
{
  const now = new Date(2026, 8, 4, 9, 0);
  const mk = days => {
    const d = new Date(2026, 8, 4 + days);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  // THE REAL SHAPE from exams.js: { slug, name, short, code, date, start, end }.
  // Written against `subject`/`title` this produced "undefined in 7 days" — and
  // said it perfectly happily, because a missing field is not an error.
  const exams = [
    { name: 'Blockchain', code: 'CSE475', date: mk(7), start: '16:00' },
    { name: 'ANS', date: mk(3) },
    { short: 'IoT', date: mk(1), start: '10:00' },
    { name: 'Quiet', date: mk(5) },      // not a milestone
    { name: 'Past', date: mk(-2) },
    { date: mk(3) },                      // no name at all
  ];
  const hits = examSoon(exams, now);
  eq(hits.length, 3, 'only the milestones — a countdown every single day is not news');
  ok(hits.some(h => /^Blockchain in 7 days$/.test(h.title)), 'named from the field exams.js actually uses');
  ok(hits.some(h => /IoT is tomorrow/.test(h.title)), 'including the short form');
  ok(!/undefined/.test(JSON.stringify(hits)), 'and a row with no name is dropped rather than announced as "undefined"');
  ok(EXAM_MILESTONES.every(d => [7, 3, 1].includes(d)), 'seven, three and one');
  ok(hits.some(h => /tomorrow/i.test(h.title)), 'the last one reads as tomorrow, not "in 1 days"');
  ok(hits.some(h => /10:00/.test(h.body)), 'and carries the time when there is one');
  ok(!/Quiet|Past/.test(JSON.stringify(hits)), 'nothing for a non-milestone or a paper already sat');
  eq(examSoon([{ subject: 'x', date: 'nonsense' }], now).length, 0, 'an unparseable date is skipped');
  eq(examSoon(null, now).length, 0, 'and no exams is no notifications');
}

// ---------------------------------------------------------------- nothing says "undefined"
//
// The failure this guards against is the one that has now happened twice in this
// codebase: a field renamed or misremembered does not throw, it renders. The
// exam channel shipped reading "undefined in 7 days" until a real row was
// printed and looked at. So every trigger is swept for the words that mean a
// field was missing, using shapes with holes in them.
{
  const now = new Date(2026, 8, 4, 9, 22);
  const day = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getDay()];
  const everything = [
    ...classSoon([{ day, start_time: '09:30' }], now),
    ...todosDue([{ completed: false, due_date: dayStamp(now) }], now),
    ...bigMoves([{ day_change_pct: -9 }], 5, now),
    ...sipTrouble([{ last_status: 'FAILED' }], now),
    ...examSoon([{ name: 'X', date: '2026-09-11' }], now),
  ];
  ok(everything.length > 0, 'the sweep actually produced notifications to check');
  const blob = JSON.stringify(everything);
  ok(!/undefined/.test(blob), 'no notification ever contains the word undefined');
  ok(!/\bNaN\b/.test(blob), 'or NaN');
  ok(!/\[object Object\]/.test(blob), 'or a stringified object');
  ok(everything.every(n => n.title && n.body && n.thing), 'and every one has a title, a body and an identity');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
