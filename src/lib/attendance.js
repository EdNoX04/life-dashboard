// One attendance-percentage reader, shared by College, HQ and PLAYER TWO.
//
// All three used to carry their own copy of:
//
//     const attPct = raw => { const n = Number(raw) || 0; ... };
//
// `Number(raw) || 0` folds null, undefined, '' AND a real 0 into the same value,
// so 0 became the sentinel for "not synced yet". Every caller then tested
// `p > 0`, which reads as "has data" — and quietly means "has data AND is not
// zero". A subject at a genuine 0% therefore rendered as "—", was left out of
// the average, and never triggered the below-75% warning. Spanish, at 0/1 after
// one missed class, is exactly the case that most needed the warning, and it was
// the one case the code could not represent.
//
// So: missing is null, zero is 0, and callers test `!= null`.
export function attPct(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  // Amizone sends 0-100. Some older rows hold a 0-1 fraction, so anything in
  // (0, 1] is scaled — 1 reads as 100%, not 1%, which is the safer misread for a
  // threshold nobody wants to trip by accident.
  return n > 0 && n <= 1 ? Math.round(n * 1000) / 10 : n;
}

// Below the university's 75% requirement — and known to be below it. A subject
// with no attendance data is not "low", it is unknown, and must not raise an alarm.
export const isLowAttendance = pct => pct != null && pct < 75;
