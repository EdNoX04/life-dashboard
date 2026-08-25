#!/usr/bin/env bash
# PLAYER ONE — Amizone auto-sync (Linux). Called by the systemd user timer.
#
# The Windows original was a two-line .bat. This does three extra things that
# only matter once nobody is watching the machine:
#
#   1. Runs under Xvfb. The scraper is deliberately HEADFUL — Cloudflare
#      Turnstile fails automated-looking browsers, and that is the whole reason
#      this runs at home instead of on GitHub Actions. Xvfb gives it a real
#      display to draw on that nobody ever sees, so a window never appears on
#      the desktop.
#   2. Rotates its own log. amizone.log grew unbounded on the laptop.
#   3. Propagates the exit code, so `systemctl --user status` shows a failed run
#      as failed instead of reporting success for a sync that logged an error
#      into a file and gave up. That exact failure mode is why the attendance
#      sat unchanged for weeks without anything looking wrong.

set -uo pipefail
cd "$(dirname "$(readlink -f "$0")")" || exit 1

LOG=amizone.log
if [ -f "$LOG" ] && [ "$(stat -c%s "$LOG" 2>/dev/null || echo 0)" -gt 2000000 ]; then
  mv -f "$LOG" "$LOG.1"
fi

{
  echo "=== $(date -Is) — run start ==="
  xvfb-run --auto-servernum --server-args="-screen 0 1366x900x24" \
    node amizone-auto.mjs "$@"
  rc=$?
  echo "=== $(date -Is) — exit $rc ==="
  exit $rc
} >>"$LOG" 2>&1
