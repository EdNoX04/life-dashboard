// Which timetable day the app should be showing right now.
//
// Once the evening is over there's no point staring at a day that's already done,
// so after ROLLOVER_HOUR we look ahead to the next day instead. Sunday has no
// classes at all, so it folds forward to Monday.

export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const ROLLOVER_HOUR = 21; // 9pm — day's done, show what's next

// Monday=0 … Saturday=5, Sunday=-1 (no classes)
function dayIndex(d) {
  const js = d.getDay();
  return js === 0 ? -1 : js - 1;
}

// Returns { name, rolled, isTomorrow }
//   name      — the timetable day to display
//   rolled    — true when we're showing something other than the real today
//   isTomorrow— true when the rolled day is literally the next calendar day
export function activeDay(now = new Date()) {
  const todayIdx = dayIndex(now);
  const past = now.getHours() >= ROLLOVER_HOUR;

  // Sunday, or after the rollover hour: look forward to the next day that has classes.
  if (todayIdx === -1 || past) {
    const next = new Date(now);
    next.setDate(next.getDate() + 1);
    let guard = 0;
    while (dayIndex(next) === -1 && guard++ < 7) next.setDate(next.getDate() + 1);
    const isTomorrow = Math.round((next - now) / 86400000) <= 1;
    return { name: DAYS[dayIndex(next)] || 'Monday', rolled: true, isTomorrow };
  }
  return { name: DAYS[todayIdx] || 'Monday', rolled: false, isTomorrow: false };
}

// Label for a card header: "Today — Monday" / "Tomorrow — Tuesday" / "Next up — Monday"
export function dayLabel(a) {
  if (!a.rolled) return `Today — ${a.name}`;
  return `${a.isTomorrow ? 'Tomorrow' : 'Next up'} — ${a.name}`;
}
