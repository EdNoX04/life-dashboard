// How old is what the College tab is showing?
//
// The tab presented three-week-old attendance exactly as it presents today's:
// same numbers, same layout, same confidence. The only hint anywhere was a small
// "as of 25 Jul" on one card, in a place you would read only if you already
// suspected something — and suspecting it is the whole difficulty, because
// attendance that has not moved looks identical to attendance nobody recorded.
//
// The sync itself had been failing on a Windows laptop for weeks, loudly, into a
// log file in another room. Loud in a place nobody reads is silent.
//
// So: freshness is a first-class fact on this screen, with a threshold that means
// something rather than a generic "updated N days ago".

// A weekday with classes should produce a sync the same day. Two days covers a
// weekend; past that, term-time data has genuinely stopped arriving.
export const STALE_DAYS = 2;
export const DEAD_DAYS = 7;

export function ageOf(iso, now = new Date()) {
  if (!iso) return { days: null, state: 'never', label: 'never synced' };
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return { days: null, state: 'never', label: 'never synced' };

  const days = Math.floor((now.getTime() - t) / 86400000);
  // A clock that is behind the server produces a negative age. Reporting "-1
  // days" would be nonsense; treating it as fresh is the honest reading.
  if (days < 0) return { days: 0, state: 'fresh', label: 'just now' };

  const label = days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
  if (days <= STALE_DAYS) return { days, state: 'fresh', label };
  if (days < DEAD_DAYS) return { days, state: 'stale', label };
  return { days, state: 'dead', label };
}

/**
 * The sentence the tab prints at the top.
 *
 * `state` drives colour AND wording, because a colour alone is a warning you stop
 * seeing by the third day. The wording names the consequence — what you are
 * looking at is old — rather than the mechanism, which the reader cannot act on.
 */
export function freshnessNote(lastSync, status, now = new Date()) {
  const age = ageOf(lastSync, now);

  if (age.state === 'never') {
    return {
      state: 'never',
      text: 'Amizone has never synced to this dashboard. Everything below is whatever was entered by hand.',
    };
  }
  // A sync that ran and FAILED is different from one that never ran, and the
  // difference is what you do next. The reason comes from the worker itself.
  if (status && status.ok === false) {
    return {
      state: 'error',
      text: `Amizone sync last failed ${age.label}${status.reason ? ` — ${status.reason}` : ''}. `
        + 'The attendance below is from before that.',
    };
  }
  if (age.state === 'fresh') return { state: 'fresh', text: `Synced ${age.label}.` };
  if (age.state === 'stale') {
    return { state: 'stale', text: `Last synced ${age.label}. Attendance below may have moved since.` };
  }
  return {
    state: 'dead',
    text: `Last synced ${age.label}. This is not current — treat every figure below as historical `
      + 'until the sync runs again.',
  };
}

export const TONE = {
  fresh: 'var(--green)',
  stale: 'var(--yellow)',
  dead: 'var(--red)',
  error: 'var(--red)',
  never: 'var(--ink-3)',
};
