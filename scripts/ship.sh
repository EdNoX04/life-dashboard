#!/usr/bin/env bash
# commit → pull --rebase → push, in that order, every time.
#
# The order is the whole point. `git pull --rebase` refuses to run on a dirty
# tree, so pulling FIRST fails with "cannot pull with rebase: You have unstaged
# changes" — and if that failure is buried in a && chain, the commit still runs,
# the push still runs, and the push is rejected for exactly the reason the pull
# was meant to fix. That has now happened three times in this repo, twice from
# instructions I wrote out in the wrong order.
#
# And the rejection is not a fluke. The apply-payloads workflow archives applied
# payloads by committing them into payloads/processed/ and pushing as
# life-hq-bot, so EVERY payload push moves the remote ahead of you by one
# commit. A plain `git push` after that will always be rejected. Pulling is not
# a recovery step here, it is the normal path.
#
#   ./scripts/ship.sh "Media batch 2: preview before you add"
#
# With no message it just syncs and pushes whatever is already committed.

set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

MSG="${1:-}"

if [ -n "$(git status --porcelain)" ]; then
  if [ -z "$MSG" ]; then
    echo "There are uncommitted changes but no commit message was given." >&2
    echo "Usage: ./scripts/ship.sh \"what changed\"" >&2
    exit 1
  fi
  git add -A
  # -F - rather than -m: subjects with backticks, arrows or parentheses get
  # mangled by the shell before git ever sees them.
  printf '%s\n' "$MSG" | git commit -F -
else
  echo "Nothing to commit."
fi

echo "→ syncing with origin/main"
git pull --rebase origin main

echo "→ pushing"
git push

echo "✓ $(git rev-parse --short HEAD) is on origin/main"
