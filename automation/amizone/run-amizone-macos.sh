#!/usr/bin/env bash
# PLAYER ONE — Amizone auto-sync (macOS). Called by the launchd agent.
#
# The macOS sibling of run-amizone.sh, and it differs in exactly one interesting
# way: there is no Xvfb.
#
# The scraper is deliberately HEADFUL. That is not an oversight — it is the whole
# reason this runs at home instead of on GitHub Actions. Cloudflare Turnstile
# will not issue a token to a datacenter IP or to an obviously automated browser,
# and it hands one over silently to a real Chrome on a residential connection.
# On Linux, Xvfb gives that real browser a display nobody ever looks at. macOS
# has no equivalent, so AMIZONE_OFFSCREEN=1 parks the window four thousand
# pixels off the top-left corner instead. Same effect: fully real, never seen.
#
# Everything else matches the Linux version, including the part that matters
# most: it PROPAGATES THE EXIT CODE. The original Windows .bat swallowed failures
# into a log file, which is how attendance sat frozen for weeks with nothing
# looking wrong.

set -uo pipefail
cd "$(dirname "$0")" || exit 1

LOG=amizone.log
# stat is not portable: -c%s is GNU, -f%z is BSD/macOS. Try both rather than
# silently skipping rotation, which is how the log grew unbounded on the laptop.
SIZE=$(stat -f%z "$LOG" 2>/dev/null || stat -c%s "$LOG" 2>/dev/null || echo 0)
if [ -f "$LOG" ] && [ "$SIZE" -gt 2000000 ]; then
  mv -f "$LOG" "$LOG.1"
fi

export AMIZONE_OFFSCREEN=1

{
  echo "=== $(date '+%Y-%m-%d %H:%M:%S %z') ==="
  node amizone-auto.mjs "$@"
} >> "$LOG" 2>&1
rc=$?

if [ "$rc" -ne 0 ]; then
  echo "amizone: run failed with exit $rc — see $(pwd)/$LOG" >&2
fi
exit "$rc"
