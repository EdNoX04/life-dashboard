// Reading a Binance sync failure correctly.
//
// THE MISTAKE THIS EXISTS TO STOP
//
// The Crypto tab's empty state said: "No balances returned. The account is
// empty, or the key cannot read it." Both of those are wrong, and both send you
// looking in the wrong place. What actually happened, every time since
// 2026-08-08, is HTTP 451:
//
//   "Service unavailable from a restricted location according to
//    'b. Eligibility' in https://www.binance.com/en/terms"
//
// That is not authentication and it is not permissions. Binance decided, from
// the IP the request came from, that it will not serve this account at all. A
// perfectly valid read-only key gets the identical response. So the fix is
// never "check the key" — it is "ask from somewhere eligible", and the account
// is eligible from India.
//
// This is worth its own module because the wrong diagnosis is expensive: it sent
// Neel to add credentials to Vercel, which cannot help, because nothing on
// Vercel calls Binance and Vercel's default regions are American too.

/** HTTP 451, however it arrives in the reason string. */
export const isGeoBlocked = reason =>
  /\b451\b/.test(String(reason || '')) || /restricted location|b\. Eligibility/i.test(String(reason || ''));

export const isAuthProblem = reason =>
  /\b401\b|\b403\b|invalid api|signature|api-key format/i.test(String(reason || ''));

/**
 * What went wrong, what it means, and the one thing that fixes it.
 *
 * Returns null when there is nothing to explain, so a healthy sync renders
 * nothing rather than a reassuring box nobody reads.
 */
export function explain(status) {
  if (!status || status.ok !== false) return null;
  const reason = String(status.reason || '');

  if (isGeoBlocked(reason)) {
    return {
      kind: 'geo',
      headline: 'Binance refused the request because of where it came from',
      what: 'HTTP 451 — the account is not served from that IP. This is not the key: a perfectly valid read-only key gets the same answer.',
      fix: 'Run the sync from your MacBook, on your own connection. scripts/binance-local.sh exists for exactly this.',
      // Said explicitly because it is the wrong turn that was actually taken.
      notThis: 'Adding the key to Vercel or to GitHub Secrets cannot help — no code there calls Binance, and both run on American IPs.',
    };
  }
  if (isAuthProblem(reason)) {
    return {
      kind: 'auth',
      headline: 'Binance rejected the key',
      what: reason.slice(0, 200),
      fix: 'Recreate the key with "Enable Reading" only, and check it is not IP-restricted to an address the sync no longer runs from.',
    };
  }
  return { kind: 'other', headline: 'The Binance sync failed', what: reason.slice(0, 300), fix: 'Run scripts/binance-local.sh by hand and read the output.' };
}

/**
 * How old the ledger is, and whether it is worth believing.
 *
 * A blob with rows is data. A blob with none is either an empty account or a
 * failed run that wrote its emptiness down — and those look identical on screen,
 * which is the whole problem. When the sync is also reporting failure, the
 * emptiness is the failure's fault and must not be shown as "you own nothing".
 */
export function ledgerState(blob, status, now = new Date()) {
  const b = blob || {};
  const rows = Array.isArray(b.rows) ? b.rows.length : 0;
  const balances = Array.isArray(b.balances) ? b.balances.length : 0;
  const at = Date.parse(b.updated || '');
  const ageH = Number.isFinite(at) ? (now.getTime() - at) / 3600000 : null;
  const failing = Boolean(status && status.ok === false);

  if (!b.updated && !status) return { state: 'never', ageH: null, rows, balances };
  if (!balances && failing) return { state: 'blank-because-failed', ageH, rows, balances };
  if (!balances) return { state: 'empty', ageH, rows, balances };
  if (failing) return { state: 'stale', ageH, rows, balances };
  if (ageH != null && ageH > 48) return { state: 'old', ageH, rows, balances };
  return { state: 'ok', ageH, rows, balances };
}
