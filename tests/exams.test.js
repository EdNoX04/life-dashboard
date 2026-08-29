import { test, expect } from 'bun:test';
import {
  EXAM_WINDOW, EXAM_DATES, SUBJECTS, FBL_MODULES, FBL_RULE,
  iso, daysBetween, addDays, fmtDay,
  examCountdown, fblStatus, fmtTime,
  EXAM_SCHEDULE, papersOn, examDays, schedule,
  revisionPlan, todayPlan, studyReminders, guideUrl,
} from '../src/lib/exams.js';

// ---------------------------------------------------------------- dates

test('iso uses the LOCAL calendar date, not UTC', () => {
  // The bug this guards: toISOString() on an evening in IST (UTC+5:30) reports
  // tomorrow's date, so every countdown would read one day short after 18:30.
  const d = new Date(2026, 7, 19, 23, 30, 0);
  expect(iso(d)).toBe('2026-08-19');
  const e = new Date(2026, 0, 1, 0, 15, 0);
  expect(iso(e)).toBe('2026-01-01');
});

test('iso returns null for rubbish rather than "NaN-NaN-NaN"', () => {
  expect(iso('not a date')).toBe(null);
  expect(iso(new Date('nope'))).toBe(null);
});

test('daysBetween counts whole days and goes negative in the past', () => {
  expect(daysBetween('2026-08-19', '2026-09-01')).toBe(13);
  expect(daysBetween('2026-09-01', '2026-09-01')).toBe(0);
  expect(daysBetween('2026-09-05', '2026-09-01')).toBe(-4);
});

test('daysBetween survives a month boundary', () => {
  expect(daysBetween('2026-08-31', '2026-09-01')).toBe(1);
  expect(daysBetween('2026-10-24', '2026-11-06')).toBe(13);
});

test('daysBetween rejects malformed input instead of coercing', () => {
  expect(daysBetween('19-08-2026', '2026-09-01')).toBe(null);
  expect(daysBetween(null, '2026-09-01')).toBe(null);
  expect(daysBetween('2026-08-19', undefined)).toBe(null);
});

test('addDays crosses months and years', () => {
  expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
  expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  expect(addDays('2026-09-01', -1)).toBe('2026-08-31');
});

test('fmtDay is human and never throws on bad input', () => {
  expect(fmtDay('2026-09-01').length).toBeGreaterThan(0);
  expect(fmtDay('rubbish')).toBe('');
});

// ---------------------------------------------------------------- countdown

test('examCountdown before, during and after', () => {
  expect(examCountdown('2026-08-19')).toMatchObject({ state: 'before', days: 13 });
  expect(examCountdown('2026-08-31')).toMatchObject({ state: 'before', days: 1 });
  expect(examCountdown('2026-08-31').text).toContain('tomorrow');
  expect(examCountdown('2026-09-01')).toMatchObject({ state: 'during' });
  expect(examCountdown('2026-09-02')).toMatchObject({ state: 'during' });
  expect(examCountdown('2026-09-03')).toMatchObject({ state: 'during', days: 0 });
  expect(examCountdown('2026-09-04')).toMatchObject({ state: 'after' });
});

test('examCountdown never reports a negative day count to the UI', () => {
  for (const d of ['2026-09-04', '2026-10-01', '2027-01-01']) {
    const c = examCountdown(d);
    expect(c.days).toBeGreaterThanOrEqual(0);
    expect(c.text).not.toContain('-');
  }
});

// ---------------------------------------------------------------- FBL

test('FBL windows are contiguous with no gap and no overlap', () => {
  for (let i = 1; i < FBL_MODULES.length; i++) {
    expect(FBL_MODULES[i].from).toBe(addDays(FBL_MODULES[i - 1].to, 1));
  }
});

test('FBL windows match the notice verbatim', () => {
  expect(FBL_MODULES[0]).toMatchObject({ from: '2026-08-17', to: '2026-08-28' });
  expect(FBL_MODULES[1]).toMatchObject({ from: '2026-08-29', to: '2026-09-11' });
  expect(FBL_MODULES[2]).toMatchObject({ from: '2026-09-12', to: '2026-09-25' });
  expect(FBL_MODULES[3]).toMatchObject({ from: '2026-09-26', to: '2026-10-09' });
  expect(FBL_MODULES[4]).toMatchObject({ from: '2026-10-10', to: '2026-10-23' });
  expect(FBL_MODULES[5]).toMatchObject({ from: '2026-10-24', to: '2026-11-06' });
});

test('the no-catch-up rule is carried in the data, not just in a comment', () => {
  expect(FBL_RULE).toContain('cannot be attempted later');
});

test('fblStatus finds the open module and counts days INCLUSIVE of the last day', () => {
  const s = fblStatus('2026-08-19');
  expect(s.state).toBe('open');
  expect(s.current.n).toBe(1);
  expect(s.daysLeft).toBe(9);
  expect(s.next.n).toBe(2);
});

test('fblStatus on the closing day says TODAY and is urgent', () => {
  const s = fblStatus('2026-08-28');
  expect(s.daysLeft).toBe(0);
  expect(s.urgency).toBe('now');
  expect(s.text).toContain('TODAY');
});

test('fblStatus escalates urgency as the deadline approaches', () => {
  expect(fblStatus('2026-08-19').urgency).toBe('later');
  expect(fblStatus('2026-08-24').urgency).toBe('soon');
  expect(fblStatus('2026-08-27').urgency).toBe('now');
});

test('fblStatus rolls straight into the next module with no dead day', () => {
  expect(fblStatus('2026-08-28').current.n).toBe(1);
  expect(fblStatus('2026-08-29').current.n).toBe(2);
});

test('every day from the first open to the last close has a module open', () => {
  let d = FBL_MODULES[0].from;
  const end = FBL_MODULES[FBL_MODULES.length - 1].to;
  let n = 0;
  while (d <= end) {
    expect(fblStatus(d).state).toBe('open');
    d = addDays(d, 1);
    n++;
  }
  expect(n).toBe(82);
});

test('fblStatus before the first window and after the last', () => {
  expect(fblStatus('2026-08-10')).toMatchObject({ state: 'between' });
  expect(fblStatus('2026-08-10').next.n).toBe(1);
  expect(fblStatus('2026-12-01')).toMatchObject({ state: 'done' });
});

// ---------------------------------------------------------------- schedule

test('fmtTime turns 24h into a readable 12h clock', () => {
  expect(fmtTime('10:00')).toBe('10:00 AM');
  expect(fmtTime('16:00')).toBe('4:00 PM');
  expect(fmtTime('00:30')).toBe('12:30 AM');
  expect(fmtTime('12:00')).toBe('12:00 PM');
  expect(fmtTime('nonsense')).toBe('');
});

test('the confirmed timetable has two papers on 3 Sept and none on 1 Sept', () => {
  expect(examDays()).toEqual(['2026-09-02', '2026-09-03']);
  expect(papersOn('2026-09-01').length).toBe(0);
  expect(papersOn('2026-09-02').map(p => p.short)).toEqual(['Blockchain']);
  const third = papersOn('2026-09-03');
  expect(third.map(p => p.short)).toEqual(['Network Security', 'IoT']); // time order
  expect(third[0].start).toBe('10:00');
  expect(third[1].start).toBe('16:00');
});

test('schedule() is date-then-time ordered and subject-merged', () => {
  const sc = schedule();
  expect(sc.map(e => e.short)).toEqual(['Blockchain', 'Network Security', 'IoT']);
  expect(sc.every(e => e.code && e.color && e.start && e.end)).toBe(true);
});

// ---------------------------------------------------------------- planner

test('the plan runs from today to the last paper with no gaps', () => {
  const { days } = revisionPlan('2026-08-19');
  expect(days[0].date).toBe('2026-08-19');
  expect(days[days.length - 1].date).toBe('2026-09-03');
  expect(days.length).toBe(16);
  for (let i = 1; i < days.length; i++) {
    expect(days[i].date).toBe(addDays(days[i - 1].date, 1));
  }
});

test('only the real paper-days are exam days — 1 Sept is not one', () => {
  const { days } = revisionPlan('2026-08-19');
  const exams = days.filter(d => d.kind === 'exam');
  expect(exams.map(d => d.date)).toEqual(['2026-09-02', '2026-09-03']);
  expect(days.find(d => d.date === '2026-09-01').kind).not.toBe('exam');
});

test('the double-paper day carries both papers, in time order', () => {
  const { days } = revisionPlan('2026-08-19');
  const third = days.find(d => d.date === '2026-09-03');
  expect(third.kind).toBe('exam');
  expect(third.papers.map(p => p.short)).toEqual(['Network Security', 'IoT']);
  expect(third.title).toContain('Network Security');
  expect(third.title).toContain('IoT');
  // the between-papers gap is scheduled for the afternoon paper
  expect(third.items.join(' ')).toContain('IoT');
  expect(third.items.some(i => /gap/i.test(i))).toBe(true);
});

test('an exam day that precedes another paper-day flags tonight as the next eve', () => {
  const { days } = revisionPlan('2026-08-19');
  const sep2 = days.find(d => d.date === '2026-09-02');
  expect(sep2.kind).toBe('exam');            // Blockchain paper
  expect(sep2.title).toContain('Blockchain');
  // after the Blockchain paper, tonight becomes the Network Security final pass
  expect(sep2.items.join(' ')).toContain('Network Security');
});

test('the evening before a paper-day is reserved for that day\'s first paper', () => {
  const { days } = revisionPlan('2026-08-19');
  const eve = days.find(d => d.date === '2026-09-01'); // night before Blockchain (2 Sept)
  expect(eve.kind).toBe('eve');
  expect(eve.title).toContain('Blockchain');
  expect(eve.items.join(' ')).not.toContain('IoT');
});

test('every module of every subject appears exactly once in the study days', () => {
  const { days } = revisionPlan('2026-08-19');
  const text = days.filter(d => d.kind === 'study').flatMap(d => d.items).join('\n');
  SUBJECTS.forEach(s => {
    s.modules.forEach(m => {
      const hits = text.split(m).length - 1;
      expect(hits).toBe(1);
    });
  });
});

test('study days interleave subjects rather than blocking one at a time', () => {
  const { days } = revisionPlan('2026-08-19');
  const first = days.find(d => d.kind === 'study');
  const subjectsThatDay = new Set(first.items.map(i => i.split(' · ')[0]));
  expect(subjectsThatDay.size).toBeGreaterThan(1);
});

test('a plan started late still covers every day and never crashes', () => {
  for (const start of ['2026-08-19', '2026-08-25', '2026-08-30', '2026-09-01', '2026-09-02', '2026-09-03']) {
    const p = revisionPlan(start);
    expect(Array.isArray(p.days)).toBe(true);
    expect(p.days[0]?.date).toBe(start);
    p.days.forEach(d => {
      expect(typeof d.label).toBe('string');
      expect(Array.isArray(d.items)).toBe(true);
    });
  }
});

test('a plan asked for after the exams returns empty and says so', () => {
  const p = revisionPlan('2026-09-10');
  expect(p.days).toEqual([]);
  expect(p.note).toContain('passed');
});

test('no study day is left with an empty item list', () => {
  for (const start of ['2026-08-19', '2026-08-22', '2026-08-28']) {
    revisionPlan(start).days.forEach(d => {
      expect(d.items.length).toBeGreaterThan(0);
      expect(d.title).toBeTruthy();
    });
  }
});

test('todayPlan picks out today, and returns null once past the window', () => {
  expect(todayPlan('2026-08-19').date).toBe('2026-08-19');
  expect(todayPlan('2026-09-10')).toBe(null);
});

// ---------------------------------------------------------------- reminders

test('studyReminders surfaces the open FBL module', () => {
  const r = studyReminders('2026-08-19');
  const fbl = r.find(x => x.text.includes('Spanish FBL'));
  expect(fbl).toBeTruthy();
  expect(fbl.chip).toBe('9d left');
  expect(fbl.go).toBe('study');
});

test('studyReminders turns the FBL row red in the last two days', () => {
  expect(studyReminders('2026-08-27').find(x => x.text.includes('FBL')).c).toBe('var(--red)');
  expect(studyReminders('2026-08-19').find(x => x.text.includes('FBL')).c).toBe('var(--cyan)');
});

test('studyReminders shows the exam countdown inside three weeks and reddens near the day', () => {
  expect(studyReminders('2026-08-19').find(x => x.text.includes('Minor exams'))).toBeTruthy();
  expect(studyReminders('2026-08-01').find(x => x.text.includes('Minor exams'))).toBeFalsy();
  expect(studyReminders('2026-08-30').find(x => x.text.includes('Minor exams')).c).toBe('var(--red)');
});

test('studyReminders every row has the shape HQ renders', () => {
  ['2026-08-19', '2026-08-28', '2026-09-02', '2026-11-20'].forEach(d => {
    studyReminders(d).forEach(r => {
      expect(typeof r.icon).toBe('string');
      expect(typeof r.text).toBe('string');
      expect(typeof r.chip).toBe('string');
      expect(r.c).toMatch(/^var\(--/);
      expect(r.go).toBe('study');
    });
  });
});

test('studyReminders is quiet when there is nothing to say', () => {
  expect(studyReminders('2026-12-25')).toEqual([]);
});

// ---------------------------------------------------------------- wiring

test('guideUrl points at a file that the Study tab and a download both use', () => {
  expect(guideUrl('blockchain')).toBe('/study/blockchain.html');
  SUBJECTS.forEach(s => expect(guideUrl(s.slug)).toBe(`/study/${s.slug}.html`));
});

test('subject slugs are unique, url-safe, and match the guide filenames', () => {
  const slugs = SUBJECTS.map(s => s.slug);
  expect(new Set(slugs).size).toBe(slugs.length);
  slugs.forEach(s => expect(s).toMatch(/^[a-z0-9-]+$/));
});

test('every subject declares modules and a colour the theme actually defines', () => {
  SUBJECTS.forEach(s => {
    expect(s.modules.length).toBeGreaterThan(0);
    expect(s.color).toMatch(/^var\(--/);
    expect(s.code).toMatch(/^[A-Z]{3}\d{3}$/);
  });
});

test('EXAM_DATES agree with the window they are supposed to fill', () => {
  expect(EXAM_DATES[0]).toBe(EXAM_WINDOW.from);
  expect(EXAM_DATES[EXAM_DATES.length - 1]).toBe(EXAM_WINDOW.to);
  expect(EXAM_DATES.length).toBe(daysBetween(EXAM_WINDOW.from, EXAM_WINDOW.to) + 1);
});
